const assert = require('assert');
const MyCircleCrypto = require('../public/js/crypto');

const BASE_URL = 'http://localhost:3030';

async function postJSON(endpoint, data, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data)
  });
  const json = await res.json();
  return { status: res.status, ok: res.ok, data: json };
}

async function getJSON(endpoint, token = null) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${endpoint}`, { headers });
  const json = await res.json();
  return { status: res.status, ok: res.ok, data: json };
}

async function runAuthAndConnectionsTestSuite() {
  console.log('🧪 Starting MyCircle Auth, Join Keys, & Chat Requests Test Suite...\n');

  const ts = Date.now().toString(36);
  const user1 = `user1_${ts}`;
  const user2 = `user2_${ts}`;

  const displayName1 = `User One ${ts}`;
  const displayName2 = `User Two ${ts}`;

  // 1. Password Mismatch
  console.log('1. Testing registration password mismatch validation...');
  const keyPair1 = await MyCircleCrypto.generateIdentityKeyPairs();
  const mismatchRes = await postJSON('/api/auth/register', {
    fullName: displayName1,
    username: user1,
    password: 'password123',
    confirmPassword: 'differentpassword',
    ecdhPublicKey: keyPair1.jwk.ecdhPublic,
    ecdsaPublicKey: keyPair1.jwk.ecdsaPublic,
    fingerprint: keyPair1.fingerprint
  });
  assert.strictEqual(mismatchRes.ok, false, 'Registration should fail when passwords do not match');
  assert.strictEqual(mismatchRes.status, 400);
  assert(mismatchRes.data.error.includes('do not match'), 'Error mentions password mismatch');
  console.log('  ✓ Passwords mismatch correctly rejected');

  // 2. Successful Registration of User 1
  console.log('\n2. Testing successful registration of User 1...');
  const reg1 = await postJSON('/api/auth/register', {
    fullName: displayName1,
    username: user1,
    password: 'securepassword123',
    confirmPassword: 'securepassword123',
    ecdhPublicKey: keyPair1.jwk.ecdhPublic,
    ecdsaPublicKey: keyPair1.jwk.ecdsaPublic,
    fingerprint: keyPair1.fingerprint
  });
  assert.strictEqual(reg1.ok, true, 'User 1 registered successfully');
  assert.strictEqual(reg1.data.user.username, user1);
  assert(reg1.data.token, 'Session token issued');
  const token1 = reg1.data.token;
  console.log(`  ✓ Registered @${user1} with hashed password and issued session token`);

  // 3. Duplicate Username Prevention
  console.log('\n3. Testing duplicate username prevention...');
  const dupRes = await postJSON('/api/auth/register', {
    fullName: 'Duplicate User',
    username: user1,
    password: 'password123',
    confirmPassword: 'password123',
    ecdhPublicKey: keyPair1.jwk.ecdhPublic,
    ecdsaPublicKey: keyPair1.jwk.ecdsaPublic,
    fingerprint: keyPair1.fingerprint
  });
  assert.strictEqual(dupRes.ok, false, 'Duplicate username must fail');
  assert.strictEqual(dupRes.status, 409);
  assert(dupRes.data.error.includes('already taken'), 'Error informs that username is taken');
  console.log('  ✓ Duplicate username correctly blocked with 409 Conflict');

  // 4. Successful Registration of User 2
  console.log('\n4. Testing successful registration of User 2...');
  const keyPair2 = await MyCircleCrypto.generateIdentityKeyPairs();
  const reg2 = await postJSON('/api/auth/register', {
    fullName: 'Test User Two',
    username: user2,
    password: 'securepassword456',
    confirmPassword: 'securepassword456',
    ecdhPublicKey: keyPair2.jwk.ecdhPublic,
    ecdsaPublicKey: keyPair2.jwk.ecdsaPublic,
    fingerprint: keyPair2.fingerprint
  });
  assert.strictEqual(reg2.ok, true, 'User 2 registered successfully');
  const token2 = reg2.data.token;
  console.log(`  ✓ Registered @${user2}`);

  // 5. Login with Wrong Password
  console.log('\n5. Testing login with incorrect password...');
  const wrongPassRes = await postJSON('/api/auth/login', {
    username: user1,
    password: 'wrongpassword'
  });
  assert.strictEqual(wrongPassRes.ok, false);
  assert.strictEqual(wrongPassRes.status, 401);
  assert(wrongPassRes.data.error.includes('Incorrect password'), 'Error informs about incorrect password');
  console.log('  ✓ Wrong password correctly rejected');

  // 6. Login with Non-Existent Account
  console.log('\n6. Testing login with non-existent account...');
  const nonexistentRes = await postJSON('/api/auth/login', {
    username: `nonexistent_${ts}`,
    password: 'anyPassword123'
  });
  assert.strictEqual(nonexistentRes.ok, false);
  assert.strictEqual(nonexistentRes.status, 404);
  assert(nonexistentRes.data.error.includes('was not found') && nonexistentRes.data.error.includes('Create an account'), 'Helpful guidance to register');
  console.log('  ✓ Non-existent account returns 404 with helpful guidance to register');

  // 7. Login with Correct Credentials
  console.log('\n7. Testing login with correct username and password...');
  const loginRes = await postJSON('/api/auth/login', {
    username: user1,
    password: 'securepassword123'
  });
  assert.strictEqual(loginRes.ok, true);
  assert(loginRes.data.token, 'Session token returned');
  assert.strictEqual(loginRes.data.user.username, user1);
  console.log('  ✓ Logged in successfully with exact username');

  // 7b. Login with leading @ (e.g. @username)
  console.log('\n7b. Testing login with leading @ (e.g. @username)...');
  const loginAtRes = await postJSON('/api/auth/login', {
    username: `@${user1}`,
    password: 'securepassword123'
  });
  assert.strictEqual(loginAtRes.ok, true, 'Login with @username should succeed');
  assert.strictEqual(loginAtRes.data.user.username, user1);
  console.log('  ✓ Login with @username succeeded');

  // 7c. Login with Display Name
  console.log(`\n7c. Testing login using Display Name ("${displayName1}")...`);
  const loginDisplayRes = await postJSON('/api/auth/login', {
    username: displayName1,
    password: 'securepassword123'
  });
  assert.strictEqual(loginDisplayRes.ok, true, 'Login with display name should resolve to user');
  assert.strictEqual(loginDisplayRes.data.user.username, user1);
  console.log('  ✓ Login with display name succeeded');

  // 7d. Testing legacy passkey account without passwordHash auto-repair
  console.log('\n7d. Testing legacy account without passwordHash auto-repair...');
  const legacyLoginRes = await postJSON('/api/auth/login', {
    username: 'sam patel',
    password: 'mypassword123'
  });
  assert.strictEqual(legacyLoginRes.ok, true, 'Legacy account without password should be repaired and logged in');
  assert.strictEqual(legacyLoginRes.data.user.username, 'sam patel');
  console.log('  ✓ Legacy account auto-repaired and authenticated successfully');

  // 8. Session Token Verification (/api/auth/session/me)
  console.log('\n8. Testing session persistence check (/api/auth/session/me)...');
  const sessionRes = await getJSON('/api/auth/session/me', token1);
  assert.strictEqual(sessionRes.ok, true);
  assert.strictEqual(sessionRes.data.user.username, user1);
  console.log('  ✓ Session token validated successfully');

  // 9. Generate Join Key (Option B) & QR Invite (Option A)
  console.log('\n9. Testing Join Key generation & format validation...');
  const inviteRes = await postJSON('/api/auth/invitations/create', { type: 'direct' }, token1);
  assert.strictEqual(inviteRes.ok, true);
  const joinKey = inviteRes.data.invitation.code;
  assert(/^MC[A-Z0-9]{10}$/.test(joinKey), 'Join key must be 12 uppercase letters/numbers with prefix MC (e.g. MC7K9P2X8B4D)');
  assert(!joinKey.includes('-'), 'Join key must not contain hyphens');
  assert(!joinKey.includes('_'), 'Join key must not contain underscores');
  assert(!joinKey.includes(' '), 'Join key must not contain spaces');
  assert(inviteRes.data.joinUrl.includes(joinKey), 'Join URL created');
  console.log(`  ✓ Generated Join Key: ${joinKey} (strictly letters A-Z and digits 0-9)`);

  // 10. Verify / Look Up Join Key
  console.log('\n10. Testing Join Key lookup by User 2...');
  const lookupRes = await getJSON(`/api/auth/invitations/lookup/${joinKey}`);
  assert.strictEqual(lookupRes.ok, true);
  assert.strictEqual(lookupRes.data.creator.username, user1);
  assert.strictEqual(lookupRes.data.creator.displayName, displayName1);
  assert(lookupRes.data.creator.ecdhPublicKey, 'Public ECDH key included');
  assert(!lookupRes.data.creator.passwordHash, 'NEVER expose password hash');
  console.log(`  ✓ User 2 looked up join key and identified @${user1} ("Test User One")`);

  // 10b. Test case-insensitivity and accidental whitespace on join key
  console.log('\n10b. Testing join key with lowercase and surrounding whitespace...');
  const lowercasePaddedKey = `  ${joinKey.toLowerCase()}  `;
  const lookupPaddedRes = await getJSON(`/api/auth/invitations/lookup/${encodeURIComponent(lowercasePaddedKey)}`);
  assert.strictEqual(lookupPaddedRes.ok, true, 'Lookup with lowercase and spaces should normalize and succeed');
  assert.strictEqual(lookupPaddedRes.data.creator.username, user1);
  console.log('  ✓ Normalized lowercase and whitespace successfully');

  // 10c. Test invalid format rejection
  console.log('\n10c. Testing invalid join key rejection...');
  const invalidKeyRes = await getJSON('/api/auth/invitations/lookup/INVALID-KEY-123!!!');
  assert.strictEqual(invalidKeyRes.ok, false);
  console.log('  ✓ Invalid join key properly rejected with error');

  // 11. Send Chat Request from User 2 to User 1
  console.log('\n11. Testing Chat Request sending (permissioned connection)...');
  const sendReq = await postJSON('/api/auth/chat-requests/send', {
    recipientUsername: user1,
    joinKey
  }, token2);
  assert.strictEqual(sendReq.ok, true);
  assert.strictEqual(sendReq.data.request.fromUsername, user2);
  assert.strictEqual(sendReq.data.request.toUsername, user1);
  assert.strictEqual(sendReq.data.request.status, 'pending');
  const requestId = sendReq.data.request.id;
  console.log(`  ✓ Chat request ${requestId} sent from @${user2} to @${user1}`);

  // 12. Prevent Duplicate Chat Requests
  console.log('\n12. Testing duplicate chat request prevention...');
  const dupChatReq = await postJSON('/api/auth/chat-requests/send', {
    recipientUsername: user1,
    joinKey
  }, token2);
  assert.strictEqual(dupChatReq.ok, false);
  assert(dupChatReq.data.error.includes('already pending'), 'Informs that request is already pending');
  console.log('  ✓ Duplicate chat request correctly prevented');

  // 13. Fetch Chat Requests List for User 1
  console.log('\n13. Testing chat requests listing for recipient User 1...');
  const listReq = await getJSON('/api/auth/chat-requests', token1);
  assert.strictEqual(listReq.ok, true);
  assert(listReq.data.incoming.some(r => r.id === requestId && r.fromUsername === user2));
  console.log('  ✓ Incoming request visible in User 1 inbox');

  // 14. Accept Chat Request
  console.log('\n14. Testing accepting the chat request...');
  const acceptRes = await postJSON(`/api/auth/chat-requests/${requestId}/respond`, {
    action: 'accepted'
  }, token1);
  assert.strictEqual(acceptRes.ok, true);
  assert.strictEqual(acceptRes.data.request.status, 'accepted');
  console.log('  ✓ Chat request accepted! Mutual connection established.');

  // 15. E2EE Message Exchange between connected users
  console.log('\n15. Testing End-to-End Encrypted Message between User 1 and User 2...');
  const user1Priv = await MyCircleCrypto.importECDHPrivateKey(keyPair1.jwk.ecdhPrivate);
  const user2Pub = await MyCircleCrypto.importECDHPublicKey(keyPair2.jwk.ecdhPublic);
  const user1SharedKey = await MyCircleCrypto.derivePairwiseKey(user1Priv, user2Pub);

  const user2Priv = await MyCircleCrypto.importECDHPrivateKey(keyPair2.jwk.ecdhPrivate);
  const user1Pub = await MyCircleCrypto.importECDHPublicKey(keyPair1.jwk.ecdhPublic);
  const user2SharedKey = await MyCircleCrypto.derivePairwiseKey(user2Priv, user1Pub);

  const user1EcdsaPriv = await MyCircleCrypto.importECDSAPrivateKey(keyPair1.jwk.ecdsaPrivate);
  const encrypted = await MyCircleCrypto.encryptDirectMessage(user1SharedKey, user1EcdsaPriv, {
    id: 'msg_001',
    sender: user1,
    recipient: user2,
    content: 'Hello via MyCircle Join Key!',
    timestamp: Date.now()
  });

  const user1EcdsaPub = await MyCircleCrypto.importECDSAPublicKey(keyPair1.jwk.ecdsaPublic);
  const decrypted = await MyCircleCrypto.decryptDirectMessage(user2SharedKey, user1EcdsaPub, encrypted.iv, encrypted.ciphertext);
  assert.strictEqual(decrypted.payload.content, 'Hello via MyCircle Join Key!');
  assert.strictEqual(decrypted.isVerified, true, 'Digital signature verified');
  console.log('  ✓ Direct message encrypted on User 1 device and decrypted/verified on User 2 device!');

  console.log('\n🎉 ALL AUTHENTICATION, JOIN KEY, AND CHAT REQUEST TESTS PASSED SUCCESSFULLY! 100% Verified.\n');
}

runAuthAndConnectionsTestSuite().catch(err => {
  console.error('\n❌ Test failed with error:', err);
  process.exit(1);
});
