/**
 * MyCircle Local Storage Engine (IndexedDB)
 * Stores encrypted keys, contacts, conversations, and chat history locally on device.
 * NO central chat database. Zero plaintext chat stored on servers.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MyCircleStorage = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DB_NAME = 'MyCircle_DeviceStorage';
  const DB_VERSION = 1;
  let dbPromise = null;

  function openDatabase() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 1. Account store (Local identity, private keys, auth token)
        if (!db.objectStoreNames.contains('account')) {
          db.createObjectStore('account', { keyPath: 'id' });
        }

        // 2. Contacts store (Verified users, public keys, safety numbers)
        if (!db.objectStoreNames.contains('contacts')) {
          const contactStore = db.createObjectStore('contacts', { keyPath: 'username' });
          contactStore.createIndex('displayName', 'displayName', { unique: false });
        }

        // 3. Conversations store (Thread metadata, last message, unread)
        if (!db.objectStoreNames.contains('conversations')) {
          const convStore = db.createObjectStore('conversations', { keyPath: 'id' });
          convStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        }

        // 4. Messages store (Local encrypted/decrypted history on this device)
        if (!db.objectStoreNames.contains('messages')) {
          const msgStore = db.createObjectStore('messages', { keyPath: 'id' });
          msgStore.createIndex('conversationId', 'conversationId', { unique: false });
          msgStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // 5. Group Keys store (Stores AES-GCM group keys per epoch)
        if (!db.objectStoreNames.contains('groupKeys')) {
          db.createObjectStore('groupKeys', { keyPath: 'keyId' }); // keyId = `${groupId}:${epoch}`
        }

        // 6. Settings store (Theme, preferences)
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return dbPromise;
  }

  // Helper for generic transaction
  async function perform(storeName, mode, callback) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;

      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);

      result = callback(store);
    });
  }

  // ----------------------------------------------------
  // Account & Identity API
  // ----------------------------------------------------
  async function saveAccount(accountData) {
    return perform('account', 'readwrite', (store) => {
      store.put({ id: 'current_user', ...accountData });
    });
  }

  async function getAccount() {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('account', 'readonly');
      const store = tx.objectStore('account');
      const req = store.get('current_user');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function clearAccount() {
    return perform('account', 'readwrite', (store) => {
      store.delete('current_user');
    });
  }

  // ----------------------------------------------------
  // Contacts API
  // ----------------------------------------------------
  async function saveContact(contact) {
    const cleanUsername = contact.username.toLowerCase();
    return perform('contacts', 'readwrite', (store) => {
      store.put({
        ...contact,
        username: cleanUsername,
        savedAt: contact.savedAt || new Date().toISOString()
      });
    });
  }

  async function getContact(username) {
    if (!username) return null;
    const cleanUsername = username.toLowerCase();
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('contacts', 'readonly');
      const store = tx.objectStore('contacts');
      const req = store.get(cleanUsername);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAllContacts() {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('contacts', 'readonly');
      const store = tx.objectStore('contacts');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function markContactVerified(username, isVerified = true) {
    const contact = await getContact(username);
    if (!contact) return null;
    contact.isVerified = isVerified;
    await saveContact(contact);
    return contact;
  }

  // ----------------------------------------------------
  // Conversations API
  // ----------------------------------------------------
  async function saveConversation(conv) {
    return perform('conversations', 'readwrite', (store) => {
      store.put({
        ...conv,
        updatedAt: conv.updatedAt || Date.now()
      });
    });
  }

  async function getConversation(id) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('conversations', 'readonly');
      const store = tx.objectStore('conversations');
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAllConversations() {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('conversations', 'readonly');
      const store = tx.objectStore('conversations');
      const req = store.getAll();
      req.onsuccess = () => {
        const list = req.result || [];
        list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteConversation(id) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['conversations', 'messages'], 'readwrite');
      tx.objectStore('conversations').delete(id);

      // Delete all messages belonging to this conversation
      const msgStore = tx.objectStore('messages');
      const idx = msgStore.index('conversationId');
      const req = idx.openKeyCursor(IDBKeyRange.only(id));
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          msgStore.delete(cursor.primaryKey);
          cursor.continue();
        }
      };

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  // ----------------------------------------------------
  // Messages API
  // ----------------------------------------------------
  async function saveMessage(msg) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['messages', 'conversations'], 'readwrite');
      const msgStore = tx.objectStore('messages');
      const convStore = tx.objectStore('conversations');

      msgStore.put(msg);

      // Update conversation's lastMessage and timestamp
      const convReq = convStore.get(msg.conversationId);
      convReq.onsuccess = () => {
        const conv = convReq.result;
        if (conv) {
          conv.lastMessage = {
            content: msg.content,
            timestamp: msg.timestamp,
            sender: msg.sender,
            status: msg.status
          };
          conv.updatedAt = msg.timestamp;
          if (!msg.isOutgoing && msg.status !== 'read') {
            conv.unreadCount = (conv.unreadCount || 0) + 1;
          }
          convStore.put(conv);
        }
      };

      tx.oncomplete = () => resolve(msg);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getMessages(conversationId) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('messages', 'readonly');
      const store = tx.objectStore('messages');
      const index = store.index('conversationId');
      const req = index.getAll(IDBKeyRange.only(conversationId));
      req.onsuccess = () => {
        const list = req.result || [];
        list.sort((a, b) => a.timestamp - b.timestamp);
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function updateMessageStatus(messageId, status) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['messages', 'conversations'], 'readwrite');
      const msgStore = tx.objectStore('messages');
      const convStore = tx.objectStore('conversations');

      const req = msgStore.get(messageId);
      req.onsuccess = () => {
        const msg = req.result;
        if (msg) {
          msg.status = status;
          msgStore.put(msg);

          // Update conversation last message status if this is the last message
          const convReq = convStore.get(msg.conversationId);
          convReq.onsuccess = () => {
            const conv = convReq.result;
            if (conv && conv.lastMessage && conv.lastMessage.timestamp === msg.timestamp) {
              conv.lastMessage.status = status;
              convStore.put(conv);
            }
          };
        }
      };

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  // ----------------------------------------------------
  // Group Keys Store (Epoch-based)
  // ----------------------------------------------------
  async function saveGroupKey(groupId, epoch, rawGroupKey) {
    const keyId = `${groupId}:${epoch}`;
    return perform('groupKeys', 'readwrite', (store) => {
      store.put({ keyId, groupId, epoch, rawGroupKey, savedAt: Date.now() });
    });
  }

  async function getGroupKey(groupId, epoch) {
    const keyId = `${groupId}:${epoch}`;
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('groupKeys', 'readonly');
      const store = tx.objectStore('groupKeys');
      const req = store.get(keyId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  // ----------------------------------------------------
  // Settings API
  // ----------------------------------------------------
  async function getSetting(key, defaultValue = null) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('settings', 'readonly');
      const store = tx.objectStore('settings');
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : defaultValue);
      req.onerror = () => reject(req.error);
    });
  }

  async function setSetting(key, value) {
    return perform('settings', 'readwrite', (store) => {
      store.put({ key, value });
    });
  }

  // ----------------------------------------------------
  // Clear All Local History & Data
  // ----------------------------------------------------
  async function clearAllLocalData() {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(
        ['contacts', 'conversations', 'messages', 'groupKeys'],
        'readwrite'
      );
      tx.objectStore('contacts').clear();
      tx.objectStore('conversations').clear();
      tx.objectStore('messages').clear();
      tx.objectStore('groupKeys').clear();

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function wipeEntireDatabase() {
    if (dbPromise) {
      const db = await dbPromise;
      db.close();
      dbPromise = null;
    }
    return new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  return {
    openDatabase,
    saveAccount,
    getAccount,
    clearAccount,
    saveContact,
    getContact,
    getAllContacts,
    markContactVerified,
    saveConversation,
    getConversation,
    getAllConversations,
    deleteConversation,
    saveMessage,
    getMessages,
    updateMessageStatus,
    saveGroupKey,
    getGroupKey,
    getSetting,
    setSetting,
    clearAllLocalData,
    wipeEntireDatabase
  };
});
