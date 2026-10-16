/**
 * MyCircle Authentication Module
 * Simple, reliable username/password authentication with server-side scrypt hashing
 * Decouples authentication from client-side Web Crypto identity keys.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MyCircleAuth = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * Register a new user with Full Name, Username, Password and Confirm Password
   */
  async function register(fullName, username, password, confirmPassword) {
    const cleanUsername = (username || '').toLowerCase().trim();
    const cleanFullName = (fullName || '').trim() || cleanUsername;

    if (!cleanFullName) {
      throw new Error('Please enter your full name.');
    }
    if (!cleanUsername) {
      throw new Error('Please choose a username.');
    }
    if (!/^[a-zA-Z0-9_-]{3,24}$/.test(cleanUsername)) {
      throw new Error('Username must be 3-24 characters (letters, numbers, hyphens, underscores).');
    }
    if (!password) {
      throw new Error('Please enter a password.');
    }
    if (password.length < 6) {
      throw new Error('Password must be at least 6 characters long.');
    }
    if (password !== confirmPassword) {
      throw new Error('Passwords do not match. Please verify both password fields.');
    }

    // Step 1: Generate identity encryption & signing keys locally on this device
    const identity = await window.MyCircleCrypto.generateIdentityKeyPairs();

    // Step 2: Register with server
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: cleanFullName,
        username: cleanUsername,
        password,
        confirmPassword,
        ecdhPublicKey: identity.jwk.ecdhPublic,
        ecdsaPublicKey: identity.jwk.ecdsaPublic,
        fingerprint: identity.fingerprint
      })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Registration failed. Please try again.');
    }

    // Step 3: Save account and private keys in local IndexedDB
    const accountRecord = {
      username: cleanUsername,
      displayName: cleanFullName,
      jwk: identity.jwk,
      fingerprint: identity.fingerprint,
      sessionToken: data.token,
      authMethod: 'password'
    };

    await window.MyCircleStorage.saveAccount(accountRecord);
    return accountRecord;
  }

  /**
   * Log in an existing user with Username and Password
   */
  async function login(username, password) {
    const cleanUsername = (username || '').trim().replace(/^@+/, '');

    if (!cleanUsername) {
      throw new Error('Please enter your username.');
    }
    if (!password) {
      throw new Error('Please enter your password.');
    }

    let res;
    try {
      res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: cleanUsername,
          password
        })
      });
    } catch (netErr) {
      throw new Error('Unable to connect to the server. Please check your internet connection and try again.');
    }

    let data;
    try {
      data = await res.json();
    } catch (parseErr) {
      throw new Error('Server returned an unexpected response. Please try again.');
    }

    if (!res.ok) {
      throw new Error((data && data.error) || 'Login failed. Please check your credentials.');
    }

    // Check if this device already has identity keys for this username
    let account = await window.MyCircleStorage.getAccount();
    if (!account || account.username !== data.user.username || !account.jwk) {
      // Generate device identity keys if signing in on a new device/browser
      const identity = await window.MyCircleCrypto.generateIdentityKeyPairs();
      account = {
        username: data.user.username,
        displayName: data.user.displayName,
        jwk: identity.jwk,
        fingerprint: identity.fingerprint,
        sessionToken: data.token,
        authMethod: 'password'
      };
    } else {
      account.sessionToken = data.token;
      account.displayName = data.user.displayName || account.displayName;
    }

    await window.MyCircleStorage.saveAccount(account);
    return account;
  }

  /**
   * Check if current stored session is valid
   */
  async function checkSession() {
    const account = await window.MyCircleStorage.getAccount();
    if (!account || !account.sessionToken) return null;

    try {
      const res = await fetch('/api/auth/session/me', {
        headers: { Authorization: `Bearer ${account.sessionToken}` }
      });
      if (res.status === 401 || res.status === 403) {
        // Token expired or invalid
        return null;
      }
      if (!res.ok) {
        // Server temporary error (e.g. 502/503 during restart) - preserve session
        return account;
      }
      const data = await res.json();
      if (data && data.user) {
        account.displayName = data.user.displayName || account.displayName;
        await window.MyCircleStorage.saveAccount(account);
      }
      return account;
    } catch (err) {
      // Offline fallback: allow accessing local chat history when network is disconnected
      console.warn('Network offline, using local cached account');
      return account;
    }
  }

  /**
   * Logout
   */
  async function logout() {
    const account = await window.MyCircleStorage.getAccount();
    if (account) {
      account.sessionToken = null;
      await window.MyCircleStorage.saveAccount(account);
    }
  }

  return {
    register,
    login,
    checkSession,
    logout
  };
});
