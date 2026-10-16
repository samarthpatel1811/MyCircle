const assert = require('assert');
const WebSocket = require('ws');
const MyCircleCrypto = require('../public/js/crypto');

const BASE_URL = 'http://localhost:3030';
const WS_URL = 'ws://localhost:3030/ws';

async function postJSON(endpoint, data) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error || `HTTP ${res.status}`);
  }
  return json;
}

async function getJSON(endpoint) {
  const res = await fetch(`${BASE_URL}${endpoint}`);
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error || `HTTP ${res.status}`);
  }
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

async function runEndToEndTests() {
  console.log('🚀 Running MyCircle Real-Time E2EE End-to-End Integration Tests...\n');

  // Step 1: Generate identity keys for Alice and Bob
  console.log('1. Generating local device P-256 keys for Alice and Bob...');
  const aliceIdentity = await MyCircleCrypto.generateIdentityKeyPairs();
  const bobIdentity = await MyCircleCrypto.generateIdentityKeyPairs();

  const timestamp = Date.now().toString(36);
  const aliceUsername = `alice_${timestamp}`;
  const bobUsername = `bob_${timestamp}`;

  // Step 2: Register both users via Fallback PIN (device credentials)
  console.log('\n2. Registering Alice and Bob on server public key directory...');
  const aliceReg = await postJSON('/api/auth/register-fallback', {
    username: aliceUsername,
    displayName: 'Alice In Wonderland',
    pin: '1234',
    ecdhPublicKey: aliceIdentity.jwk.ecdhPublic,
    ecdsaPublicKey: aliceIdentity.jwk.ecdsaPublic,
    fingerprint: aliceIdentity.fingerprint
  });
  assert(aliceReg.token, 'Alice received session token');

  const bobReg = await postJSON('/api/auth/register-fallback', {
    username: bobUsername,
    displayName: 'Bob The Builder',
    pin: '5678',
    ecdhPublicKey: bobIdentity.jwk.ecdhPublic,
    ecdsaPublicKey: bobIdentity.jwk.ecdsaPublic,
    fingerprint: bobIdentity.fingerprint
  });
  assert(bobReg.token, 'Bob received session token');
  console.log(`  ✓ Registered @${aliceUsername} and @${bobUsername}`);

  // Step 3: Test user search and directory discovery
  console.log('\n3. Testing User Directory & Public Key Discovery...');
  const searchRes = await getJSON(`/api/auth/users/search?q=${bobUsername}`);
  assert(searchRes.users.length >= 1, 'Found Bob in search');
  assert.strictEqual(searchRes.users[0].username, bobUsername);
  console.log('  ✓ Public key retrieved for @' + bobUsername);

  // Step 4: Connect both users to WebSocket
  console.log('\n4. Connecting Alice and Bob to WebSocket signaling / relay...');
  let bobReceivedMessages = [];
  let aliceReceivedAcks = [];

  const bobWs = await createClientWebSocket(bobReg.token, (msg) => {
    if (msg.type === 'encrypted-message') {
      bobReceivedMessages.push(msg.packet);
    }
  });

  const aliceWs = await createClientWebSocket(aliceReg.token, (msg) => {
    if (msg.type === 'delivery-ack') {
      aliceReceivedAcks.push(msg);
    }
  });

  console.log('  ✓ Alice and Bob authenticated over WebSockets');

  // Step 5: Derive Pairwise Shared Key & Encrypt Direct Message
  console.log('\n5. Performing ECDH Key Agreement and Encrypting direct message...');
  const alicePrivKey = await MyCircleCrypto.importECDHPrivateKey(aliceIdentity.jwk.ecdhPrivate);
  const bobPubKey = await MyCircleCrypto.importECDHPublicKey(bobIdentity.jwk.ecdhPublic);
  const aliceSharedKey = await MyCircleCrypto.derivePairwiseKey(alicePrivKey, bobPubKey);

  const aliceEcdsaPriv = await MyCircleCrypto.importECDSAPrivateKey(aliceIdentity.jwk.ecdsaPrivate);
  const rawMessage = {
    id: 'test-msg-001',
    sender: aliceUsername,
    recipient: bobUsername,
    content: 'Hi Bob! Welcome to our confidential end-to-end encrypted circle.',
    timestamp: Date.now()
  };

  const encrypted = await MyCircleCrypto.encryptDirectMessage(aliceSharedKey, aliceEcdsaPriv, rawMessage);
  assert(encrypted.iv && encrypted.ciphertext);

  // Alice sends encrypted packet via relay
  aliceWs.send(JSON.stringify({
    type: 'relay-encrypted-message',
    sender: aliceUsername,
    packet: {
      id: rawMessage.id,
      recipient: bobUsername,
      sender: aliceUsername,
      iv: encrypted.iv,
      ciphertext: encrypted.ciphertext,
      timestamp: rawMessage.timestamp
    }
  }));

  // Wait for Bob to receive
  await new Promise(r => setTimeout(r, 200));
  assert.strictEqual(bobReceivedMessages.length, 1, 'Bob received encrypted packet');
  console.log('  ✓ Bob received ciphertext packet over relay');

  // Step 6: Bob decrypts and verifies digital signature
  console.log('\n6. Bob decrypting packet with ECDH shared secret & verifying signature...');
  const bobPrivKey = await MyCircleCrypto.importECDHPrivateKey(bobIdentity.jwk.ecdhPrivate);
  const alicePubKey = await MyCircleCrypto.importECDHPublicKey(aliceIdentity.jwk.ecdhPublic);
  const bobSharedKey = await MyCircleCrypto.derivePairwiseKey(bobPrivKey, alicePubKey);

  const aliceEcdsaPub = await MyCircleCrypto.importECDSAPublicKey(aliceIdentity.jwk.ecdsaPublic);
  const decrypted = await MyCircleCrypto.decryptDirectMessage(
    bobSharedKey,
    aliceEcdsaPub,
    bobReceivedMessages[0].iv,
    bobReceivedMessages[0].ciphertext
  );

  assert.strictEqual(decrypted.payload.content, rawMessage.content);
  assert.strictEqual(decrypted.isVerified, true, 'Alice signature verified by Bob');
  console.log('  ✓ Bob decrypted: "' + decrypted.payload.content + '"');
  console.log('  ✓ Digital signature verified: Alice is authentic sender');

  // Step 7: Bob sends Delivery ACK
  console.log('\n7. Bob sending Delivery ACK back to Alice...');
  bobWs.send(JSON.stringify({
    type: 'ack-delivery',
    sender: bobUsername,
    originalSender: aliceUsername,
    messageId: rawMessage.id
  }));

  await new Promise(r => setTimeout(r, 200));
  assert.strictEqual(aliceReceivedAcks.length, 1, 'Alice received delivery ACK');
  assert.strictEqual(aliceReceivedAcks[0].messageId, rawMessage.id);
  console.log('  ✓ Alice received delivery confirmation ACK for message ' + rawMessage.id);

  // Step 8: Offline Ephemeral Mailbox Relay Test
  console.log('\n8. Testing Offline Transient Delivery (Zero Chat DB)...');
  console.log('  -> Bob disconnects (goes offline)...');
  bobWs.close();
  await new Promise(r => setTimeout(r, 100));

  const offlineMsg = {
    id: 'offline-msg-002',
    sender: aliceUsername,
    recipient: bobUsername,
    content: 'Are you there Bob? Sending while you are offline.',
    timestamp: Date.now()
  };
  const encOffline = await MyCircleCrypto.encryptDirectMessage(aliceSharedKey, aliceEcdsaPriv, offlineMsg);

  let relayStatusReceived = null;
  const relayStatusHandler = (data) => {
    const parsed = JSON.parse(data.toString());
    if (parsed.type === 'relay-status' && parsed.messageId === offlineMsg.id) {
      relayStatusReceived = parsed;
    }
  };
  aliceWs.on('message', relayStatusHandler);

  aliceWs.send(JSON.stringify({
    type: 'relay-encrypted-message',
    sender: aliceUsername,
    packet: {
      id: offlineMsg.id,
      recipient: bobUsername,
      sender: aliceUsername,
      iv: encOffline.iv,
      ciphertext: encOffline.ciphertext,
      timestamp: offlineMsg.timestamp
    }
  }));

  await new Promise(r => setTimeout(r, 200));
  assert(relayStatusReceived, 'Alice notified that message was queued in ephemeral relay');
  assert.strictEqual(relayStatusReceived.recipientOnline, false, 'Recipient noted as offline');
  console.log('  ✓ Sender notified: "Recipient offline. Encrypted message will be delivered when they connect."');

  // Bob comes back online
  console.log('  -> Bob reconnects to MyCircle...');
  let bobReconnectedMessages = [];
  const bobWs2 = await createClientWebSocket(bobReg.token, (msg) => {
    if (msg.type === 'encrypted-message') {
      bobReconnectedMessages.push(msg.packet);
    }
  });

  await new Promise(r => setTimeout(r, 200));
  assert.strictEqual(bobReconnectedMessages.length, 1, 'Bob received queued message upon reconnecting');
  const decryptedOffline = await MyCircleCrypto.decryptDirectMessage(
    bobSharedKey,
    aliceEcdsaPub,
    bobReconnectedMessages[0].iv,
    bobReconnectedMessages[0].ciphertext
  );
  assert.strictEqual(decryptedOffline.payload.content, offlineMsg.content);
  console.log('  ✓ Bob received and decrypted queued message immediately upon reconnecting!');

  // Cleanup WebSockets
  bobWs2.close();
  aliceWs.close();

  console.log('\n=======================================================');
  console.log('🎉 ALL INTEGRATION TESTS PASSED WITH 100% SUCCESS!');
  console.log('=======================================================\n');
}

runEndToEndTests().catch(err => {
  console.error('\n❌ Integration test failed:', err);
  process.exit(1);
});
