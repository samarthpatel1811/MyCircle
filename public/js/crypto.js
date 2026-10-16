/**
 * MyCircle Cryptographic Engine
 * End-to-End Encryption (E2EE) using Web Crypto API (SubtleCrypto)
 * - P-256 ECDH for Key Agreement
 * - P-256 ECDSA for Digital Signatures (Integrity & Non-repudiation)
 * - 256-bit AES-GCM with fresh 12-byte IVs for Authenticated Message Encryption
 * - Cryptographic Safety Numbers (Fingerprints) for MITM verification
 * - Dynamic Group Key Derivation & Rotation on member removal
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MyCircleCrypto = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const cryptoObj = typeof window !== 'undefined' ? window.crypto : globalThis.crypto;
  const subtle = cryptoObj.subtle;

  // ----------------------------------------------------
  // Buffer & Encoding Utilities
  // ----------------------------------------------------
  function bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  function base64ToBuffer(base64) {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  function bufferToHex(buffer) {
    return Array.from(new Uint8Array(buffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  function stringToBuffer(str) {
    return new TextEncoder().encode(str);
  }

  function bufferToString(buf) {
    return new TextDecoder().decode(buf);
  }

  // ----------------------------------------------------
  // Identity Key Generation & Management
  // ----------------------------------------------------

  /**
   * Generates both ECDH (encryption/agreement) and ECDSA (signing) key pairs
   */
  async function generateIdentityKeyPairs() {
    // 1. ECDH Key Pair for Key Exchange
    const ecdhPair = await subtle.generateKey(
      {
        name: 'ECDH',
        namedCurve: 'P-256'
      },
      true, // extractable
      ['deriveKey', 'deriveBits']
    );

    // 2. ECDSA Key Pair for Signing & Identity Verification
    const ecdsaPair = await subtle.generateKey(
      {
        name: 'ECDSA',
        namedCurve: 'P-256'
      },
      true, // extractable
      ['sign', 'verify']
    );

    // Export public keys as JWK
    const ecdhPublicJwk = await subtle.exportKey('jwk', ecdhPair.publicKey);
    const ecdsaPublicJwk = await subtle.exportKey('jwk', ecdsaPair.publicKey);

    // Export private keys as JWK
    const ecdhPrivateJwk = await subtle.exportKey('jwk', ecdhPair.privateKey);
    const ecdsaPrivateJwk = await subtle.exportKey('jwk', ecdsaPair.privateKey);

    // Compute initial individual fingerprint
    const fingerprint = await computeKeyFingerprint(ecdhPublicJwk);

    return {
      ecdhPair,
      ecdsaPair,
      jwk: {
        ecdhPublic: ecdhPublicJwk,
        ecdsaPublic: ecdsaPublicJwk,
        ecdhPrivate: ecdhPrivateJwk,
        ecdsaPrivate: ecdsaPrivateJwk
      },
      fingerprint
    };
  }

  /**
   * Imports an ECDH public JWK
   */
  async function importECDHPublicKey(jwk) {
    return await subtle.importKey(
      'jwk',
      jwk,
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      []
    );
  }

  /**
   * Imports an ECDH private JWK
   */
  async function importECDHPrivateKey(jwk) {
    return await subtle.importKey(
      'jwk',
      jwk,
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits']
    );
  }

  /**
   * Imports an ECDSA public JWK
   */
  async function importECDSAPublicKey(jwk) {
    return await subtle.importKey(
      'jwk',
      jwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['verify']
    );
  }

  /**
   * Imports an ECDSA private JWK
   */
  async function importECDSAPrivateKey(jwk) {
    return await subtle.importKey(
      'jwk',
      jwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign']
    );
  }

  // ----------------------------------------------------
  // Pairwise Key Agreement & Safety Numbers
  // ----------------------------------------------------

  /**
   * Derives a 256-bit AES-GCM shared symmetric key using ECDH
   */
  async function derivePairwiseKey(localPrivateKey, remotePublicKey) {
    return await subtle.deriveKey(
      {
        name: 'ECDH',
        public: remotePublicKey
      },
      localPrivateKey,
      {
        name: 'AES-GCM',
        length: 256
      },
      true, // extractable
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Computes a SHA-256 fingerprint for a single public key
   */
  async function computeKeyFingerprint(jwk) {
    const normalized = `${jwk.x}:${jwk.y}`;
    const hash = await subtle.digest('SHA-256', stringToBuffer(normalized));
    return bufferToHex(hash).slice(0, 32);
  }

  /**
   * Generates Signal-style 60-digit Safety Numbers for two users
   * Always sorts the public keys so Alice & Bob get the EXACT SAME numbers.
   */
  async function generateSafetyNumbers(jwkA, jwkB) {
    const keyA = `${jwkA.x}:${jwkA.y}`;
    const keyB = `${jwkB.x}:${jwkB.y}`;
    const sorted = [keyA, keyB].sort().join('|');

    const digest = await subtle.digest('SHA-256', stringToBuffer(sorted));
    const bytes = new Uint8Array(digest);

    // Convert into 12 groups of 5 digits (total 60 digits)
    const groups = [];
    for (let i = 0; i < 12; i++) {
      // Pick 2 bytes per group
      const val = (bytes[i * 2] << 8) | bytes[i * 2 + 1];
      const digits = (val % 100000).toString().padStart(5, '0');
      groups.push(digits);
    }

    return {
      formatted: groups.join(' '),
      groups,
      fingerprintShort: bufferToHex(digest).slice(0, 16)
    };
  }

  // ----------------------------------------------------
  // Digital Signatures
  // ----------------------------------------------------

  async function signData(ecdsaPrivateKey, dataString) {
    const dataBuf = stringToBuffer(dataString);
    const signature = await subtle.sign(
      {
        name: 'ECDSA',
        hash: { name: 'SHA-256' }
      },
      ecdsaPrivateKey,
      dataBuf
    );
    return bufferToBase64(signature);
  }

  async function verifyData(ecdsaPublicKey, dataString, signatureB64) {
    try {
      const dataBuf = stringToBuffer(dataString);
      const sigBuf = base64ToBuffer(signatureB64);
      return await subtle.verify(
        {
          name: 'ECDSA',
          hash: { name: 'SHA-256' }
        },
        ecdsaPublicKey,
        sigBuf,
        dataBuf
      );
    } catch (err) {
      console.error('Signature verification error:', err);
      return false;
    }
  }

  // ----------------------------------------------------
  // One-to-One Message Encryption & Decryption
  // ----------------------------------------------------

  /**
   * Encrypts a message directly for a recipient
   */
  async function encryptDirectMessage(sharedKey, senderEcdsaPrivateKey, messageData) {
    // messageData: { sender, recipient, content, timestamp, id }
    const payloadStr = JSON.stringify(messageData);

    // 1. Generate digital signature for non-repudiation and authenticity
    const signature = await signData(senderEcdsaPrivateKey, payloadStr);

    // Combine payload + signature
    const envelope = JSON.stringify({
      payload: messageData,
      signature
    });

    // 2. Generate a fresh 12-byte (96-bit) cryptographically random IV
    const iv = cryptoObj.getRandomValues(new Uint8Array(12));

    // 3. Encrypt with AES-GCM (AEAD)
    const ciphertext = await subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv,
        tagLength: 128
      },
      sharedKey,
      stringToBuffer(envelope)
    );

    return {
      iv: bufferToBase64(iv),
      ciphertext: bufferToBase64(ciphertext)
    };
  }

  /**
   * Decrypts a direct message received from a sender
   */
  async function decryptDirectMessage(sharedKey, senderEcdsaPublicKey, ivB64, ciphertextB64) {
    const iv = base64ToBuffer(ivB64);
    const ciphertext = base64ToBuffer(ciphertextB64);

    // 1. Decrypt with AES-GCM
    const decryptedBuffer = await subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: new Uint8Array(iv),
        tagLength: 128
      },
      sharedKey,
      ciphertext
    );

    const envelopeStr = bufferToString(decryptedBuffer);
    const envelope = JSON.parse(envelopeStr);

    // 2. Verify digital signature against sender's public ECDSA key
    const payloadStr = JSON.stringify(envelope.payload);
    const isVerified = await verifyData(senderEcdsaPublicKey, payloadStr, envelope.signature);

    return {
      payload: envelope.payload,
      isVerified
    };
  }

  // ----------------------------------------------------
  // Group Messaging & Key Rotation
  // ----------------------------------------------------

  /**
   * Generates a 256-bit AES-GCM Group Encryption Key
   */
  async function generateGroupKey() {
    return await subtle.generateKey(
      {
        name: 'AES-GCM',
        length: 256
      },
      true, // extractable so admin can export and distribute pairwise
      ['encrypt', 'decrypt']
    );
  }

  async function exportRawKey(key) {
    const raw = await subtle.exportKey('raw', key);
    return bufferToBase64(raw);
  }

  async function importRawGroupKey(rawB64) {
    const raw = base64ToBuffer(rawB64);
    return await subtle.importKey(
      'raw',
      raw,
      { name: 'AES-GCM' },
      true,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Encrypts the raw group key for a specific member using their pairwise shared key
   */
  async function encryptGroupKeyForMember(pairwiseSharedKey, rawGroupKeyB64, groupId, epoch) {
    const iv = cryptoObj.getRandomValues(new Uint8Array(12));
    const dataStr = JSON.stringify({
      groupId,
      epoch,
      rawGroupKey: rawGroupKeyB64
    });

    const ciphertext = await subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv,
        tagLength: 128
      },
      pairwiseSharedKey,
      stringToBuffer(dataStr)
    );

    return {
      iv: bufferToBase64(iv),
      ciphertext: bufferToBase64(ciphertext)
    };
  }

  /**
   * Decrypts a group key received from admin
   */
  async function decryptGroupKeyFromAdmin(pairwiseSharedKey, ivB64, ciphertextB64) {
    const iv = base64ToBuffer(ivB64);
    const ciphertext = base64ToBuffer(ciphertextB64);

    const decrypted = await subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: new Uint8Array(iv),
        tagLength: 128
      },
      pairwiseSharedKey,
      ciphertext
    );

    const parsed = JSON.parse(bufferToString(decrypted));
    const groupKey = await importRawGroupKey(parsed.rawGroupKey);
    return {
      groupId: parsed.groupId,
      epoch: parsed.epoch,
      rawGroupKey: parsed.rawGroupKey,
      groupKey
    };
  }

  /**
   * Encrypts a message intended for a group
   */
  async function encryptGroupMessage(groupKey, senderEcdsaPrivateKey, messageData) {
    const payloadStr = JSON.stringify(messageData);
    const signature = await signData(senderEcdsaPrivateKey, payloadStr);

    const envelope = JSON.stringify({
      payload: messageData,
      signature
    });

    const iv = cryptoObj.getRandomValues(new Uint8Array(12));
    const ciphertext = await subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv,
        tagLength: 128
      },
      groupKey,
      stringToBuffer(envelope)
    );

    return {
      iv: bufferToBase64(iv),
      ciphertext: bufferToBase64(ciphertext)
    };
  }

  /**
   * Decrypts a group message
   */
  async function decryptGroupMessage(groupKey, senderEcdsaPublicKey, ivB64, ciphertextB64) {
    const iv = base64ToBuffer(ivB64);
    const ciphertext = base64ToBuffer(ciphertextB64);

    const decrypted = await subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: new Uint8Array(iv),
        tagLength: 128
      },
      groupKey,
      ciphertext
    );

    const envelopeStr = bufferToString(decrypted);
    const envelope = JSON.parse(envelopeStr);

    const payloadStr = JSON.stringify(envelope.payload);
    const isVerified = await verifyData(senderEcdsaPublicKey, payloadStr, envelope.signature);

    return {
      payload: envelope.payload,
      isVerified
    };
  }

  return {
    generateIdentityKeyPairs,
    importECDHPublicKey,
    importECDHPrivateKey,
    importECDSAPublicKey,
    importECDSAPrivateKey,
    derivePairwiseKey,
    generateSafetyNumbers,
    computeKeyFingerprint,
    signData,
    verifyData,
    encryptDirectMessage,
    decryptDirectMessage,
    generateGroupKey,
    exportRawKey,
    importRawGroupKey,
    encryptGroupKeyForMember,
    decryptGroupKeyFromAdmin,
    encryptGroupMessage,
    decryptGroupMessage,
    bufferToBase64,
    base64ToBuffer,
    bufferToHex
  };
});
