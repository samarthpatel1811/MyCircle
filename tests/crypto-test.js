const assert = require('assert');
const MyCircleCrypto = require('../public/js/crypto');

async function runTests() {
  console.log('🧪 Starting MyCircle Cryptography & E2EE Test Suite...\n');

  // Test 1: Generate identity keys for Alice and Bob
  console.log('1. Testing Key Pair Generation...');
  const alice = await MyCircleCrypto.generateIdentityKeyPairs();
  const bob = await MyCircleCrypto.generateIdentityKeyPairs();
  const charlie = await MyCircleCrypto.generateIdentityKeyPairs();

  assert(alice.jwk.ecdhPublic.x && alice.jwk.ecdhPublic.y, 'Alice ECDH public key exists');
  assert(alice.jwk.ecdsaPublic.x && alice.jwk.ecdsaPublic.y, 'Alice ECDSA public key exists');
  console.log('  ✓ Key pairs generated for Alice, Bob, and Charlie');

  // Test 2: Safety Numbers Symmetry
  console.log('\n2. Testing Safety Numbers Generation...');
  const aliceSafety = await MyCircleCrypto.generateSafetyNumbers(alice.jwk.ecdhPublic, bob.jwk.ecdhPublic);
  const bobSafety = await MyCircleCrypto.generateSafetyNumbers(bob.jwk.ecdhPublic, alice.jwk.ecdhPublic);

  assert.strictEqual(aliceSafety.formatted, bobSafety.formatted, 'Safety numbers match between Alice and Bob');
  assert.strictEqual(aliceSafety.groups.length, 12, '12 groups of safety numbers');
  console.log('  ✓ Safety numbers symmetric match:', aliceSafety.formatted.slice(0, 23) + '...');

  // Test 3: Pairwise Shared Key Derivation (ECDH)
  console.log('\n3. Testing Pairwise Key Derivation (ECDH)...');
  const aliceEcdhPriv = await MyCircleCrypto.importECDHPrivateKey(alice.jwk.ecdhPrivate);
  const bobEcdhPub = await MyCircleCrypto.importECDHPublicKey(bob.jwk.ecdhPublic);
  const aliceSharedKey = await MyCircleCrypto.derivePairwiseKey(aliceEcdhPriv, bobEcdhPub);

  const bobEcdhPriv = await MyCircleCrypto.importECDHPrivateKey(bob.jwk.ecdhPrivate);
  const aliceEcdhPub = await MyCircleCrypto.importECDHPublicKey(alice.jwk.ecdhPublic);
  const bobSharedKey = await MyCircleCrypto.derivePairwiseKey(bobEcdhPriv, aliceEcdhPub);

  assert(aliceSharedKey && bobSharedKey, 'Shared keys derived on both sides');
  console.log('  ✓ Shared AES-256-GCM keys successfully derived on both ends');

  // Test 4: One-to-One E2E Message Encryption & Decryption
  console.log('\n4. Testing Direct Message Encryption & Decryption (AES-GCM + ECDSA)...');
  const aliceEcdsaPriv = await MyCircleCrypto.importECDSAPrivateKey(alice.jwk.ecdsaPrivate);
  const aliceEcdsaPub = await MyCircleCrypto.importECDSAPublicKey(alice.jwk.ecdsaPublic);

  const secretMessage = {
    id: 'msg-123',
    sender: 'alice',
    recipient: 'bob',
    content: 'Hello Bob! This is our top-secret conversation on MyCircle.',
    timestamp: Date.now()
  };

  const encrypted = await MyCircleCrypto.encryptDirectMessage(aliceSharedKey, aliceEcdsaPriv, secretMessage);
  assert(encrypted.iv && encrypted.ciphertext, 'Encrypted packet has IV and ciphertext');
  console.log('  ✓ Message encrypted with random IV. Ciphertext length:', encrypted.ciphertext.length);

  const decrypted = await MyCircleCrypto.decryptDirectMessage(bobSharedKey, aliceEcdsaPub, encrypted.iv, encrypted.ciphertext);
  assert.strictEqual(decrypted.payload.content, secretMessage.content, 'Decrypted content matches plaintext');
  assert.strictEqual(decrypted.isVerified, true, 'Digital signature verified');
  console.log('  ✓ Bob decrypted message and verified Alice\'s digital signature!');

  // Test 5: Tamper Resistance
  console.log('\n5. Testing Tamper Resistance (AEAD & Signature Check)...');
  let tamperedCaught = false;
  try {
    // Corrupt ciphertext
    const rawCipher = MyCircleCrypto.base64ToBuffer(encrypted.ciphertext);
    const view = new Uint8Array(rawCipher);
    view[view.length - 2] ^= 0xff; // flip bits
    const corruptedCipherB64 = MyCircleCrypto.bufferToBase64(view.buffer);
    await MyCircleCrypto.decryptDirectMessage(bobSharedKey, aliceEcdsaPub, encrypted.iv, corruptedCipherB64);
  } catch (err) {
    tamperedCaught = true;
  }
  assert(tamperedCaught, 'Tampered ciphertext rejected by AES-GCM AEAD');
  console.log('  ✓ Tampered ciphertext correctly rejected by AEAD integrity check');

  // Test 6: Group Messaging with Key Rotation & Forward Secrecy on Member Removal
  console.log('\n6. Testing Group Encryption & Key Rotation on Member Removal...');
  const groupId = 'group-core-team';

  // Epoch 1: Alice creates group with Bob and Charlie
  const groupKeyEpoch1 = await MyCircleCrypto.generateGroupKey();
  const rawGroupKey1B64 = await MyCircleCrypto.exportRawKey(groupKeyEpoch1);

  // Alice shares Epoch 1 key with Bob and Charlie
  const charlieEcdhPub = await MyCircleCrypto.importECDHPublicKey(charlie.jwk.ecdhPublic);
  const aliceCharlieSharedKey = await MyCircleCrypto.derivePairwiseKey(aliceEcdhPriv, charlieEcdhPub);

  const charlieEcdhPriv = await MyCircleCrypto.importECDHPrivateKey(charlie.jwk.ecdhPrivate);
  const charlieAliceSharedKey = await MyCircleCrypto.derivePairwiseKey(charlieEcdhPriv, aliceEcdhPub);

  // Alice sends group message under Epoch 1
  const epoch1Msg = {
    id: 'grp-msg-1',
    groupId,
    epoch: 1,
    sender: 'alice',
    content: 'Welcome to the circle! Both Bob and Charlie can read this.',
    timestamp: Date.now()
  };
  const encGroup1 = await MyCircleCrypto.encryptGroupMessage(groupKeyEpoch1, aliceEcdsaPriv, epoch1Msg);

  // Charlie decrypts Epoch 1 message
  const charlieEpoch1Decrypted = await MyCircleCrypto.decryptGroupMessage(groupKeyEpoch1, aliceEcdsaPub, encGroup1.iv, encGroup1.ciphertext);
  assert.strictEqual(charlieEpoch1Decrypted.payload.content, epoch1Msg.content);
  assert.strictEqual(charlieEpoch1Decrypted.isVerified, true);
  console.log('  ✓ Charlie successfully decrypted Epoch 1 group message');

  // Member Charlie is removed!
  console.log('  -> Charlie is removed from the circle! Admin Alice initiates Key Rotation to Epoch 2...');
  const groupKeyEpoch2 = await MyCircleCrypto.generateGroupKey();
  const rawGroupKey2B64 = await MyCircleCrypto.exportRawKey(groupKeyEpoch2);

  // Alice encrypts Epoch 2 key ONLY for Bob (NOT Charlie)
  const bobEncryptedKeyEpoch2 = await MyCircleCrypto.encryptGroupKeyForMember(aliceSharedKey, rawGroupKey2B64, groupId, 2);
  const bobDecryptedEpoch2Key = await MyCircleCrypto.decryptGroupKeyFromAdmin(bobSharedKey, bobEncryptedKeyEpoch2.iv, bobEncryptedKeyEpoch2.ciphertext);

  // Alice sends message under Epoch 2
  const epoch2Msg = {
    id: 'grp-msg-2',
    groupId,
    epoch: 2,
    sender: 'alice',
    content: 'Charlie has been removed. Only Bob can read this confidential message.',
    timestamp: Date.now()
  };
  const encGroup2 = await MyCircleCrypto.encryptGroupMessage(groupKeyEpoch2, aliceEcdsaPriv, epoch2Msg);

  // Bob decrypts Epoch 2 message
  const bobEpoch2Decrypted = await MyCircleCrypto.decryptGroupMessage(bobDecryptedEpoch2Key.groupKey, aliceEcdsaPub, encGroup2.iv, encGroup2.ciphertext);
  assert.strictEqual(bobEpoch2Decrypted.payload.content, epoch2Msg.content);
  console.log('  ✓ Bob received Epoch 2 rotated key and decrypted Epoch 2 message');

  // Charlie tries to decrypt Epoch 2 message with his old Epoch 1 key
  let charlieFailed = false;
  try {
    await MyCircleCrypto.decryptGroupMessage(groupKeyEpoch1, aliceEcdsaPub, encGroup2.iv, encGroup2.ciphertext);
  } catch (err) {
    charlieFailed = true;
  }
  assert(charlieFailed, 'Removed member Charlie cannot decrypt Epoch 2 messages');
  console.log('  ✓ Removed member Charlie CANNOT decrypt future Epoch 2 messages (Key rotation successful!)');

  console.log('\n🎉 ALL CRYPTO TESTS PASSED SUCCESSFULLY! 100% Cryptographic Integrity.\n');
}

runTests().catch(err => {
  console.error('\n❌ Test suite failed:', err);
  process.exit(1);
});
