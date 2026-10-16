const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Secure password hashing with scrypt (NIST / OWASP approved)
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, key] = storedHash.split(':');
  const keyBuffer = Buffer.from(key, 'hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(keyBuffer, derivedKey);
}

class UsersDirectory {
  constructor() {
    this.users = new Map();
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(USERS_FILE)) {
        const raw = fs.readFileSync(USERS_FILE, 'utf8');
        const list = JSON.parse(raw);
        list.forEach(u => {
          const cleanUser = (u.username || '').toLowerCase().trim();
          if (cleanUser) {
            this.users.set(cleanUser, {
              ...u,
              username: cleanUser,
              isOnline: false,
              currentChallenge: null
            });
          }
        });
      }
    } catch (err) {
      console.error('Error loading users file:', err);
      this.users = new Map();
    }
  }

  save() {
    try {
      const list = Array.from(this.users.values()).map(u => ({
        username: u.username,
        displayName: u.displayName,
        passwordHash: u.passwordHash || null,
        ecdhPublicKey: u.ecdhPublicKey,
        ecdsaPublicKey: u.ecdsaPublicKey,
        fingerprint: u.fingerprint,
        passkeyCredentials: u.passkeyCredentials || [],
        pinHash: u.pinHash || null,
        createdAt: u.createdAt || new Date().toISOString(),
        lastSeen: u.lastSeen || new Date().toISOString()
      }));
      fs.writeFileSync(USERS_FILE, JSON.stringify(list, null, 2), 'utf8');
    } catch (err) {
      console.error('Error saving users file:', err);
    }
  }

  getUser(username) {
    if (!username) return null;
    return this.users.get(username.toLowerCase().trim()) || null;
  }

  hasUser(username) {
    if (!username) return false;
    return this.users.has(username.toLowerCase().trim());
  }

  registerUserWithPassword({ username, displayName, password, ecdhPublicKey, ecdsaPublicKey, fingerprint }) {
    const cleanUsername = username.toLowerCase().trim();
    if (this.users.has(cleanUsername)) {
      throw new Error(`Username @${cleanUsername} is already taken. Please choose another username.`);
    }

    if (!password || password.length < 4) {
      throw new Error('Password must be at least 4 characters long.');
    }

    const passwordHash = hashPassword(password);

    const record = {
      username: cleanUsername,
      displayName: (displayName && displayName.trim()) || cleanUsername,
      passwordHash,
      ecdhPublicKey,
      ecdsaPublicKey,
      fingerprint,
      passkeyCredentials: [],
      pinHash: null,
      createdAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      isOnline: false,
      currentChallenge: null
    };

    this.users.set(cleanUsername, record);
    this.save();
    return record;
  }

  verifyUserCredentials(username, password) {
    const clean = (username || '').toLowerCase().trim();
    const user = this.getUser(clean);
    if (!user) {
      return { ok: false, reason: 'ACCOUNT_NOT_FOUND' };
    }

    // 1. Check scrypt password hash
    if (user.passwordHash) {
      const valid = verifyPassword(password, user.passwordHash);
      if (valid) {
        return { ok: true, user };
      }
      return { ok: false, reason: 'INVALID_PASSWORD' };
    }

    // 2. Check legacy pinHash if user originally created with PIN
    if (user.pinHash) {
      const testPinHash = crypto.createHash('sha256').update(password + clean).digest('hex');
      if (testPinHash === user.pinHash) {
        // Upgrade user to scrypt password hash seamlessly!
        user.passwordHash = hashPassword(password);
        this.save();
        return { ok: true, user };
      }
      return { ok: false, reason: 'INVALID_PASSWORD' };
    }

    return { ok: false, reason: 'NO_PASSWORD_SET' };
  }

  registerUser(userObj) {
    const username = userObj.username.toLowerCase().trim();
    if (this.users.has(username)) {
      throw new Error(`User @${username} already exists`);
    }

    const record = {
      username,
      displayName: userObj.displayName || username,
      passwordHash: userObj.passwordHash || null,
      ecdhPublicKey: userObj.ecdhPublicKey,
      ecdsaPublicKey: userObj.ecdsaPublicKey,
      fingerprint: userObj.fingerprint,
      passkeyCredentials: userObj.passkeyCredentials || [],
      pinHash: userObj.pinHash || null,
      createdAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      isOnline: false,
      currentChallenge: null
    };

    this.users.set(username, record);
    this.save();
    return record;
  }

  updateUser(username, updates) {
    const user = this.getUser(username);
    if (!user) return null;
    Object.assign(user, updates);
    this.save();
    return user;
  }

  setUserOnline(username, isOnline) {
    const user = this.getUser(username);
    if (user) {
      user.isOnline = !!isOnline;
      user.lastSeen = new Date().toISOString();
    }
  }

  searchUsers(query, excludeUsername = '') {
    const q = (query || '').toLowerCase().trim();
    const exclude = (excludeUsername || '').toLowerCase().trim();
    const results = [];

    for (const user of this.users.values()) {
      if (user.username === exclude) continue;
      if (!q || user.username.includes(q) || (user.displayName && user.displayName.toLowerCase().includes(q))) {
        results.push({
          username: user.username,
          displayName: user.displayName,
          ecdhPublicKey: user.ecdhPublicKey,
          ecdsaPublicKey: user.ecdsaPublicKey,
          fingerprint: user.fingerprint,
          isOnline: !!user.isOnline,
          lastSeen: user.lastSeen
        });
      }
    }
    return results;
  }

  getPublicProfile(username) {
    const user = this.getUser(username);
    if (!user) return null;
    return {
      username: user.username,
      displayName: user.displayName,
      ecdhPublicKey: user.ecdhPublicKey,
      ecdsaPublicKey: user.ecdsaPublicKey,
      fingerprint: user.fingerprint,
      isOnline: !!user.isOnline,
      lastSeen: user.lastSeen
    };
  }
}

module.exports = new UsersDirectory();
