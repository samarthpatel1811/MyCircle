/**
 * MyCircle Group Cryptography & Key Rotation Module
 * Implements forward-secure group key distribution and automatic key rotation
 * upon member removal so removed members cannot read future conversations.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MyCircleGroupCrypto = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * Helper to get pairwise shared key with a contact
   */
  async function getPairwiseSharedKey(contactUsername, currentUserAccount) {
    const contact = await window.MyCircleStorage.getContact(contactUsername);
    if (!contact || !contact.ecdhPublicKey) {
      throw new Error(`Public key for @${contactUsername} not found. Please add contact first.`);
    }

    const localPriv = await window.MyCircleCrypto.importECDHPrivateKey(currentUserAccount.jwk.ecdhPrivate);
    const remotePub = await window.MyCircleCrypto.importECDHPublicKey(contact.ecdhPublicKey);
    return await window.MyCircleCrypto.derivePairwiseKey(localPriv, remotePub);
  }

  /**
   * Initialize a new group with Epoch 1 key
   */
  async function createGroup(groupName, memberUsernames, currentAccount) {
    const groupId = 'grp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
    const epoch = 1;
    const members = Array.from(new Set([currentAccount.username, ...memberUsernames.map(m => m.toLowerCase())]));

    // 1. Generate Epoch 1 AES-GCM 256-bit Group Key
    const groupKey = await window.MyCircleCrypto.generateGroupKey();
    const rawKeyB64 = await window.MyCircleCrypto.exportRawKey(groupKey);

    // Save locally
    await window.MyCircleStorage.saveGroupKey(groupId, epoch, rawKeyB64);

    // 2. Encrypt key for each other member individually using pairwise ECDH+AES
    const distributionList = [];
    for (const member of members) {
      if (member === currentAccount.username) continue;
      try {
        const pairwiseKey = await getPairwiseSharedKey(member, currentAccount);
        const encryptedKeyPacket = await window.MyCircleCrypto.encryptGroupKeyForMember(
          pairwiseKey,
          rawKeyB64,
          groupId,
          epoch
        );
        distributionList.push({
          recipient: member,
          encryptedKeyPacket
        });
      } catch (err) {
        console.warn(`Could not distribute initial group key to @${member}:`, err.message);
      }
    }

    // 3. Save conversation record in IndexedDB
    const convRecord = {
      id: `group:${groupId}`,
      type: 'group',
      groupId,
      name: groupName,
      members,
      admin: currentAccount.username,
      epoch,
      unreadCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await window.MyCircleStorage.saveConversation(convRecord);

    // 4. Send key distribution to relay
    if (distributionList.length > 0) {
      window.MyCircleSignaling.sendGroupRekeyDistribution(groupId, epoch, distributionList);
    }

    return convRecord;
  }

  /**
   * Handle incoming group key (from invite, new group, or rekey)
   */
  async function handleGroupRekeyPacket(packet, currentAccount) {
    const { groupId, epoch, admin, encryptedKey } = packet;

    // Admin's public key
    const pairwiseKey = await getPairwiseSharedKey(admin, currentAccount);
    const decrypted = await window.MyCircleCrypto.decryptGroupKeyFromAdmin(
      pairwiseKey,
      encryptedKey.iv,
      encryptedKey.ciphertext
    );

    // Save rotated key for this epoch in IndexedDB
    await window.MyCircleStorage.saveGroupKey(groupId, epoch, decrypted.rawGroupKey);

    // Update conversation epoch
    const convId = `group:${groupId}`;
    const conv = await window.MyCircleStorage.getConversation(convId);
    if (conv) {
      conv.epoch = epoch;
      await window.MyCircleStorage.saveConversation(conv);
    }

    console.log(`✓ Group @${groupId} encryption key rotated to Epoch ${epoch}`);
    return decrypted;
  }

  /**
   * Forward-Secure Key Rotation upon member removal
   * Generates Epoch (N+1) key and distributes ONLY to remaining active members!
   */
  async function rotateGroupKeyOnMemberRemoval(groupId, removedMemberUsername, currentAccount) {
    const convId = `group:${groupId}`;
    const conv = await window.MyCircleStorage.getConversation(convId);
    if (!conv) throw new Error('Group not found');

    const cleanRemoved = removedMemberUsername.toLowerCase();
    // Exclude the removed member
    const updatedMembers = conv.members.filter(m => m.toLowerCase() !== cleanRemoved);
    const newEpoch = (conv.epoch || 1) + 1;

    // 1. Generate brand-new Epoch (N+1) Group Key
    const newGroupKey = await window.MyCircleCrypto.generateGroupKey();
    const newRawKeyB64 = await window.MyCircleCrypto.exportRawKey(newGroupKey);

    // Save locally
    await window.MyCircleStorage.saveGroupKey(groupId, newEpoch, newRawKeyB64);

    // 2. Encrypt ONLY for remaining active members (Removed member NEVER receives this key)
    const distributionList = [];
    for (const member of updatedMembers) {
      if (member === currentAccount.username) continue;
      try {
        const pairwiseKey = await getPairwiseSharedKey(member, currentAccount);
        const encryptedKeyPacket = await window.MyCircleCrypto.encryptGroupKeyForMember(
          pairwiseKey,
          newRawKeyB64,
          groupId,
          newEpoch
        );
        distributionList.push({
          recipient: member,
          encryptedKeyPacket
        });
      } catch (err) {
        console.warn(`Could not distribute rotated key to @${member}:`, err.message);
      }
    }

    // 3. Update conversation in IndexedDB
    conv.members = updatedMembers;
    conv.epoch = newEpoch;
    conv.updatedAt = Date.now();
    await window.MyCircleStorage.saveConversation(conv);

    // 4. Distribute to remaining members
    if (distributionList.length > 0) {
      window.MyCircleSignaling.sendGroupRekeyDistribution(groupId, newEpoch, distributionList);
    }

    // Add local system notice to conversation
    const systemNotice = {
      id: 'sys_' + Date.now(),
      conversationId: convId,
      sender: 'system',
      senderName: 'System',
      content: `@${cleanRemoved} was removed. Group encryption keys rotated (Epoch ${newEpoch}). Removed member cannot read future messages.`,
      timestamp: Date.now(),
      status: 'delivered',
      isOutgoing: false,
      isSystem: true
    };
    await window.MyCircleStorage.saveMessage(systemNotice);

    return conv;
  }

  /**
   * Encrypt a message for the group
   */
  async function encryptGroupMessage(groupId, content, currentAccount) {
    const convId = `group:${groupId}`;
    const conv = await window.MyCircleStorage.getConversation(convId);
    if (!conv) throw new Error('Group conversation not found');

    const epoch = conv.epoch || 1;
    const groupKeyRecord = await window.MyCircleStorage.getGroupKey(groupId, epoch);
    if (!groupKeyRecord) {
      throw new Error(`Group key for epoch ${epoch} not found on this device.`);
    }

    const groupKey = await window.MyCircleCrypto.importRawGroupKey(groupKeyRecord.rawGroupKey);
    const ecdsaPriv = await window.MyCircleCrypto.importECDSAPrivateKey(currentAccount.jwk.ecdsaPrivate);

    const messageData = {
      id: 'grp_msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      groupId,
      epoch,
      sender: currentAccount.username,
      senderName: currentAccount.displayName || currentAccount.username,
      content,
      timestamp: Date.now()
    };

    const encrypted = await window.MyCircleCrypto.encryptGroupMessage(groupKey, ecdsaPriv, messageData);

    return {
      id: messageData.id,
      groupId,
      epoch,
      sender: messageData.sender,
      senderName: messageData.senderName,
      iv: encrypted.iv,
      ciphertext: encrypted.ciphertext,
      timestamp: messageData.timestamp
    };
  }

  /**
   * Decrypt an incoming group message
   */
  async function decryptGroupMessage(packet, currentAccount) {
    const { groupId, epoch, sender, iv, ciphertext } = packet;

    const groupKeyRecord = await window.MyCircleStorage.getGroupKey(groupId, epoch);
    if (!groupKeyRecord) {
      throw new Error(`Cannot decrypt message: No group key available for Epoch ${epoch}. (You may not have been a member during this epoch).`);
    }

    const groupKey = await window.MyCircleCrypto.importRawGroupKey(groupKeyRecord.rawGroupKey);

    // Get sender's public ECDSA key to verify authenticity
    let senderContact = await window.MyCircleStorage.getContact(sender);
    let senderEcdsaPub;
    if (senderContact && senderContact.ecdsaPublicKey) {
      senderEcdsaPub = await window.MyCircleCrypto.importECDSAPublicKey(senderContact.ecdsaPublicKey);
    } else {
      // Try to fetch public key from directory
      try {
        const res = await fetch(`/api/auth/users/${sender}`);
        if (res.ok) {
          const data = await res.json();
          if (data.user && data.user.ecdsaPublicKey) {
            senderEcdsaPub = await window.MyCircleCrypto.importECDSAPublicKey(data.user.ecdsaPublicKey);
          }
        }
      } catch (e) {}
    }

    if (!senderEcdsaPub) {
      throw new Error(`Could not find verification key for sender @${sender}`);
    }

    const decrypted = await window.MyCircleCrypto.decryptGroupMessage(groupKey, senderEcdsaPub, iv, ciphertext);
    return decrypted;
  }

  return {
    createGroup,
    handleGroupRekeyPacket,
    rotateGroupKeyOnMemberRemoval,
    encryptGroupMessage,
    decryptGroupMessage
  };
});
