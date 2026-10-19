const assert = require('assert');
const WebSocket = require('ws');
const MyCircleCrypto = require('../public/js/crypto');

const BASE_URL = 'http://localhost:3030';
const WS_URL = 'ws://localhost:3030/ws';

async function postJSON(endpoint, data, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data)
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

async function getJSON(endpoint, token) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${endpoint}`, { headers });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

function createClientWebSocket(token, onMessage) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token }));
    });
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'auth-success') {
        resolve(ws);
      }
      if (onMessage) onMessage(msg);
    });
    ws.on('error', reject);
  });
}

async function runComprehensiveTests() {
  console.log('===============================================================');
  console.log('🧪 Starting MyCircle Comprehensive Features Verification Suite');
  console.log('===============================================================\n');

  // Generate 2 users: User A (Alice) and User B (Bob)
  const ts = Date.now().toString(36);
  const aliceUsername = `alice_${ts}`;
  const bobUsername = `bob_${ts}`;

  console.log('1. Setting up User Accounts & Cryptographic Identities...');
  const aliceKeys = await MyCircleCrypto.generateIdentityKeyPairs();
  const bobKeys = await MyCircleCrypto.generateIdentityKeyPairs();

  const aliceReg = await postJSON('/api/auth/register-fallback', {
    username: aliceUsername,
    displayName: 'Alice Forest',
    pin: '1234',
    ecdhPublicKey: aliceKeys.jwk.ecdhPublic,
    ecdsaPublicKey: aliceKeys.jwk.ecdsaPublic,
    fingerprint: aliceKeys.fingerprint
  });

  const bobReg = await postJSON('/api/auth/register-fallback', {
    username: bobUsername,
    displayName: 'Bob Cream',
    pin: '5678',
    ecdhPublicKey: bobKeys.jwk.ecdhPublic,
    ecdsaPublicKey: bobKeys.jwk.ecdsaPublic,
    fingerprint: bobKeys.fingerprint
  });

  assert(aliceReg.token && bobReg.token, 'Both tokens generated');
  console.log(`  ✓ Registered @${aliceUsername} and @${bobUsername}`);

  // Test Public Key Update endpoint
  console.log('\n2. Testing Public Key Sync / Update Mechanism...');
  const newAliceKeys = await MyCircleCrypto.generateIdentityKeyPairs();
  const updateRes = await postJSON('/api/auth/update-keys', {
    ecdhPublicKey: newAliceKeys.jwk.ecdhPublic,
    ecdsaPublicKey: newAliceKeys.jwk.ecdsaPublic,
    fingerprint: newAliceKeys.fingerprint
  }, aliceReg.token);
  assert.strictEqual(updateRes.success, true, 'Public key updated');
  const bobFetchedAlice = await getJSON(`/api/auth/users/${aliceUsername}`);
  assert.strictEqual(bobFetchedAlice.user.fingerprint, newAliceKeys.fingerprint, 'Server directory updated with new key');
  console.log('  ✓ Public key update verified — solves new login session key mismatch');

  // Reset Alice keys to known variable
  const activeAliceKeys = newAliceKeys;

  // Derive Pairwise Shared AES-256-GCM Key
  const alicePriv = await MyCircleCrypto.importECDHPrivateKey(activeAliceKeys.jwk.ecdhPrivate);
  const bobPub = await MyCircleCrypto.importECDHPublicKey(bobKeys.jwk.ecdhPublic);
  const aliceSharedKey = await MyCircleCrypto.derivePairwiseKey(alicePriv, bobPub);

  const bobPriv = await MyCircleCrypto.importECDHPrivateKey(bobKeys.jwk.ecdhPrivate);
  const alicePub = await MyCircleCrypto.importECDHPublicKey(activeAliceKeys.jwk.ecdhPublic);
  const bobSharedKey = await MyCircleCrypto.derivePairwiseKey(bobPriv, alicePub);

  const aliceEcdsaPriv = await MyCircleCrypto.importECDSAPrivateKey(activeAliceKeys.jwk.ecdsaPrivate);
  const aliceEcdsaPub = await MyCircleCrypto.importECDSAPublicKey(activeAliceKeys.jwk.ecdsaPublic);

  const bobEcdsaPriv = await MyCircleCrypto.importECDSAPrivateKey(bobKeys.jwk.ecdsaPrivate);
  const bobEcdsaPub = await MyCircleCrypto.importECDSAPublicKey(bobKeys.jwk.ecdsaPublic);

  // Setup WebSockets
  console.log('\n3. Connecting Real-Time Signaling WebSockets...');
  const aliceInbox = [];
  const bobInbox = [];

  const aliceWs = await createClientWebSocket(aliceReg.token, (msg) => aliceInbox.push(msg));
  const bobWs = await createClientWebSocket(bobReg.token, (msg) => bobInbox.push(msg));
  console.log('  ✓ Alice and Bob connected to real-time relay');

  // ------------------------------------------------------------------------
  // Test 1: Bidirectional Message Sending & Delivery Statuses
  // ------------------------------------------------------------------------
  console.log('\n4. Testing Bidirectional Direct Message Delivery...');
  const msg1Id = `msg_ab_${Date.now()}`;
  const msg1Payload = {
    id: msg1Id,
    sender: aliceUsername,
    recipient: bobUsername,
    content: 'Hello Bob! Message 1 from Alice.',
    timestamp: Date.now()
  };
  const enc1 = await MyCircleCrypto.encryptDirectMessage(aliceSharedKey, aliceEcdsaPriv, msg1Payload);

  aliceWs.send(JSON.stringify({
    type: 'relay-encrypted-message',
    sender: aliceUsername,
    packet: {
      id: msg1Id,
      recipient: bobUsername,
      sender: aliceUsername,
      iv: enc1.iv,
      ciphertext: enc1.ciphertext,
      timestamp: msg1Payload.timestamp
    }
  }));

  await new Promise(r => setTimeout(r, 200));
  const bobMsg1 = bobInbox.find(m => m.type === 'encrypted-message' && m.packet.id === msg1Id);
  assert(bobMsg1, 'Bob received message 1');
  const dec1 = await MyCircleCrypto.decryptDirectMessage(bobSharedKey, aliceEcdsaPub, bobMsg1.packet.iv, bobMsg1.packet.ciphertext);
  assert.strictEqual(dec1.payload.content, msg1Payload.content);
  assert.strictEqual(dec1.isVerified, true, 'Signature verified');
  console.log('  ✓ Alice -> Bob delivered and decrypted successfully');

  // Bob replies to Alice
  const msg2Id = `msg_ba_${Date.now()}`;
  const msg2Payload = {
    id: msg2Id,
    sender: bobUsername,
    recipient: aliceUsername,
    content: 'Hi Alice! Message 2 reply from Bob.',
    replyTo: { id: msg1Id, sender: aliceUsername, snippet: msg1Payload.content.slice(0, 30) },
    timestamp: Date.now()
  };
  const enc2 = await MyCircleCrypto.encryptDirectMessage(bobSharedKey, bobEcdsaPriv, msg2Payload);

  bobWs.send(JSON.stringify({
    type: 'relay-encrypted-message',
    sender: bobUsername,
    packet: {
      id: msg2Id,
      recipient: aliceUsername,
      sender: bobUsername,
      iv: enc2.iv,
      ciphertext: enc2.ciphertext,
      timestamp: msg2Payload.timestamp
    }
  }));

  await new Promise(r => setTimeout(r, 200));
  const aliceMsg2 = aliceInbox.find(m => m.type === 'encrypted-message' && m.packet.id === msg2Id);
  assert(aliceMsg2, 'Alice received message 2');
  const dec2 = await MyCircleCrypto.decryptDirectMessage(aliceSharedKey, bobEcdsaPub, aliceMsg2.packet.iv, aliceMsg2.packet.ciphertext);
  assert.strictEqual(dec2.payload.content, msg2Payload.content);
  assert.strictEqual(dec2.payload.replyTo.id, msg1Id, 'Reply quote preserved in E2EE envelope');
  console.log('  ✓ Bob -> Alice delivered and reply reference verified');

  // Delivery ACK check
  bobWs.send(JSON.stringify({
    type: 'ack-delivery',
    sender: bobUsername,
    originalSender: aliceUsername,
    messageId: msg1Id
  }));
  await new Promise(r => setTimeout(r, 150));
  const ack = aliceInbox.find(m => m.type === 'delivery-ack' && m.messageId === msg1Id);
  assert(ack, 'Alice received delivery ACK');
  console.log('  ✓ Delivery ACK processed: status moves from sent (✓) to delivered (✓✓)');

  // ------------------------------------------------------------------------
  // Test 2: Message Reactions
  // ------------------------------------------------------------------------
  console.log('\n5. Testing Emoji Reactions...');
  bobWs.send(JSON.stringify({
    type: 'message-reaction',
    sender: bobUsername,
    conversationId: `direct:${aliceUsername}`,
    messageId: msg1Id,
    emoji: '❤️',
    action: 'toggle',
    recipient: aliceUsername
  }));

  await new Promise(r => setTimeout(r, 200));
  const reactionMsg = aliceInbox.find(m => m.type === 'message-reaction' && m.messageId === msg1Id);
  assert(reactionMsg, 'Alice received reaction notification');
  assert.strictEqual(reactionMsg.emoji, '❤️');
  assert.strictEqual(reactionMsg.sender, bobUsername);
  console.log('  ✓ Emoji reaction ❤️ added and synced in real-time');

  // ------------------------------------------------------------------------
  // Test 3: Photo & Document Sharing with End-to-End Encryption
  // ------------------------------------------------------------------------
  console.log('\n6. Testing Encrypted Photo & Document Sharing (Zero-Knowledge Server)...');
  
  // 6.1 Sample image buffer (e.g. 500 KB binary data)
  const sampleImageBytes = new Uint8Array(1024 * 100);
  for (let i = 0; i < sampleImageBytes.length; i++) sampleImageBytes[i] = (i * 17) % 256;

  // Alice encrypts the image using AES-256-GCM with shared key
  const encImage = await MyCircleCrypto.encryptBinaryData(aliceSharedKey, sampleImageBytes.buffer);
  assert(encImage.iv && encImage.ciphertext, 'Image encrypted with AES-256-GCM');

  // Alice uploads encrypted ciphertext to /api/attachments/upload
  const uploadRes = await postJSON('/api/attachments/upload', {
    ciphertext: encImage.ciphertext,
    contentType: 'image/jpeg'
  }, aliceReg.token);
  assert(uploadRes.success && uploadRes.attachmentId, 'Attachment saved on server');
  console.log(`  ✓ Encrypted image uploaded. Attachment ID: ${uploadRes.attachmentId}`);

  // Inspect server storage: verify server has ZERO plaintext
  const downloadRes = await fetch(`${BASE_URL}/api/attachments/${uploadRes.attachmentId}`);
  assert(downloadRes.ok, 'Download succeeded');
  const serverCipherBuf = await downloadRes.arrayBuffer();
  assert.strictEqual(serverCipherBuf.byteLength, Buffer.from(encImage.ciphertext, 'base64').length);
  // Verify that server buffer does not match raw plaintext
  const serverFirstBytes = new Uint8Array(serverCipherBuf.slice(0, 32));
  assert.notDeepStrictEqual(serverFirstBytes, sampleImageBytes.slice(0, 32), 'Server storage is completely ciphertext');

  // Bob decrypts the downloaded ciphertext
  const decryptedImageBuf = await MyCircleCrypto.decryptBinaryData(bobSharedKey, encImage.iv, serverCipherBuf);
  const decryptedBytes = new Uint8Array(decryptedImageBuf);
  assert.strictEqual(decryptedBytes.length, sampleImageBytes.length);
  assert.deepStrictEqual(decryptedBytes, sampleImageBytes, 'Decrypted photo matches original bytes byte-for-byte');
  console.log('  ✓ Bob downloaded and decrypted photo byte-for-byte with AES-256-GCM');

  // 6.2 Test file size limit (>10MB rejected)
  console.log('  -> Testing 10MB file size limit validation...');
  try {
    const oversizedCipher = Buffer.alloc(11 * 1024 * 1024).toString('base64');
    await postJSON('/api/attachments/upload', { ciphertext: oversizedCipher }, aliceReg.token);
    assert.fail('Should have rejected oversized attachment');
  } catch (err) {
    assert(err.message.includes('10 MB') || err.message.includes('10MB') || err.message.includes('limit') || err.message.includes('too large') || err.message.includes('HTTP 413') || err.message.includes('HTTP 400'), `Properly rejected oversized attachment: ${err.message}`);
    console.log('  ✓ File size limit correctly enforced (>10MB rejected)');
  }

  // ------------------------------------------------------------------------
  // Test 4: Message Editing
  // ------------------------------------------------------------------------
  console.log('\n7. Testing Message Editing...');
  const editedContent = 'Hello Bob! Message 1 from Alice (Edited with corrections).';
  aliceWs.send(JSON.stringify({
    type: 'message-edit',
    sender: aliceUsername,
    conversationId: `direct:${aliceUsername}`,
    messageId: msg1Id,
    newContent: editedContent,
    recipient: bobUsername
  }));

  await new Promise(r => setTimeout(r, 200));
  const editEvent = bobInbox.find(m => m.type === 'message-edit' && m.messageId === msg1Id);
  assert(editEvent, 'Bob received message-edit event');
  assert.strictEqual(editEvent.newContent, editedContent);
  console.log('  ✓ Message edited and real-time update received by recipient');

  // ------------------------------------------------------------------------
  // Test 5: Message Deletion (Delete for Everyone)
  // ------------------------------------------------------------------------
  console.log('\n8. Testing Message Deletion (Delete for Everyone)...');
  aliceWs.send(JSON.stringify({
    type: 'message-delete',
    sender: aliceUsername,
    conversationId: `direct:${aliceUsername}`,
    messageId: msg1Id,
    recipient: bobUsername
  }));

  await new Promise(r => setTimeout(r, 200));
  const deleteEvent = bobInbox.find(m => m.type === 'message-delete' && m.messageId === msg1Id);
  assert(deleteEvent, 'Bob received message-delete event');
  console.log('  ✓ Message delete-for-everyone event received by recipient');

  // ------------------------------------------------------------------------
  // Test 6: Group Polls (Creation, Voting, Live Sync, Closing)
  // ------------------------------------------------------------------------
  console.log('\n9. Testing Group Polls...');
  const groupId = `grp_${Date.now()}`;
  const pollMsgId = `poll_msg_${Date.now()}`;

  // Alice creates a poll and broadcasts to group
  const pollData = {
    id: `poll_${Date.now()}`,
    question: 'Where should our circle meet this Saturday?',
    options: [
      { text: 'Greenwood Forest Park', votes: [] },
      { text: 'The Botanical Gardens', votes: [] },
      { text: 'Artisan Coffee Roasters', votes: [] }
    ],
    isMultipleChoice: false,
    isAnonymous: false,
    closingTime: Date.now() + 86400000,
    closed: false,
    creator: aliceUsername,
    totalVotes: 0
  };

  // Broadcast poll packet
  aliceWs.send(JSON.stringify({
    type: 'group-relay-message',
    sender: aliceUsername,
    memberList: [aliceUsername, bobUsername],
    packet: {
      id: pollMsgId,
      groupId,
      epoch: 1,
      sender: aliceUsername,
      content: `📊 Poll: ${pollData.question}`,
      type: 'poll',
      poll: pollData,
      timestamp: Date.now()
    }
  }));

  await new Promise(r => setTimeout(r, 200));
  const bobPollMsg = bobInbox.find(m => m.type === 'group-encrypted-message' && m.packet.id === pollMsgId);
  assert(bobPollMsg, 'Bob received poll message');
  assert.strictEqual(bobPollMsg.packet.poll.question, pollData.question);
  console.log('  ✓ Group poll created and distributed to circle members');

  // Bob votes for Option 0 ('Greenwood Forest Park')
  bobWs.send(JSON.stringify({
    type: 'group-poll-vote',
    sender: bobUsername,
    groupId,
    messageId: pollMsgId,
    optionIndexes: [0],
    voter: bobUsername,
    memberList: [aliceUsername, bobUsername]
  }));

  await new Promise(r => setTimeout(r, 200));
  const voteEvent = aliceInbox.find(m => m.type === 'group-poll-vote' && m.messageId === pollMsgId);
  assert(voteEvent, 'Alice received Bob\'s poll vote event');
  assert.strictEqual(voteEvent.voter, bobUsername);
  assert.deepStrictEqual(voteEvent.optionIndexes, [0]);
  console.log('  ✓ Member vote cast and synchronized in real-time');

  // Alice closes the poll
  aliceWs.send(JSON.stringify({
    type: 'group-poll-close',
    sender: aliceUsername,
    groupId,
    messageId: pollMsgId,
    closedBy: aliceUsername,
    memberList: [aliceUsername, bobUsername]
  }));

  await new Promise(r => setTimeout(r, 200));
  const closeEvent = bobInbox.find(m => m.type === 'group-poll-close' && m.messageId === pollMsgId);
  assert(closeEvent, 'Bob received group-poll-close event');
  console.log('  ✓ Poll closed by creator and close event received by members');

  // Clean up
  aliceWs.close();
  bobWs.close();

  console.log('\n===============================================================');
  console.log('🎉 ALL 6 COMPREHENSIVE FEATURES TESTS PASSED 100%!');
  console.log('===============================================================\n');
}

runComprehensiveTests().catch(err => {
  console.error('\n❌ Comprehensive test failed:', err);
  process.exit(1);
});
