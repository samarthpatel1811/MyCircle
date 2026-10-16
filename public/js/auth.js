/**
 * MyCircle Authentication Module
 * Handles WebAuthn Passkeys and Fallback PIN/Device Authentication
 * Keeps Authentication strictly separate from Encryption Keys as required.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MyCircleAuth = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function isWebAuthnSupported() {
    return !!(
      window.PublicKeyCredential &&
      navigator.credentials &&
      navigator.credentials.create &&
      navigator.credentials.get
    );
  }

  /**
   * Register a new user with WebAuthn Passkey
   */
  async function registerWithPasskey(username, displayName) {
    if (!isWebAuthnSupported()) {
      throw new Error('Your browser or device does not support WebAuthn passkeys. Please use the Device Key / PIN setup below.');
    }

    const cleanUsername = username.toLowerCase().trim();
    if (!cleanUsername) {
      throw new Error('Please enter a username');
    }

    // Step 1: Generate identity encryption & signing keys locally on this device
    const identity = await window.MyCircleCrypto.generateIdentityKeyPairs();

    // Step 2: Fetch registration options from server
    const optionsRes = await fetch('/api/auth/passkey/register-options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: cleanUsername,
        displayName: displayName || cleanUsername
      })
    });

    const optionsData = await optionsRes.json();
    if (!optionsRes.ok) {
      throw new Error(optionsData.error || 'Failed to start passkey registration');
    }

    // Step 3: Trigger browser passkey creation modal (Touch ID, Face ID, Windows Hello, YubiKey)
    let regResponse;
    try {
      regResponse = await window.SimpleWebAuthnBrowser.startRegistration({
        optionsJSON: optionsData
      });
    } catch (err) {
      console.warn('WebAuthn registration error:', err);
      if (err.name === 'NotAllowedError') {
        throw new Error('Passkey creation was cancelled or timed out.');
      }
      throw new Error(`Passkey creation failed: ${err.message}. You can use Device Key / PIN setup instead.`);
    }

    // Step 4: Verify passkey response with server & submit public keys
    const verifyRes = await fetch('/api/auth/passkey/register-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: cleanUsername,
        displayName: displayName || cleanUsername,
        registrationResponse: regResponse,
        ecdhPublicKey: identity.jwk.ecdhPublic,
        ecdsaPublicKey: identity.jwk.ecdsaPublic,
        fingerprint: identity.fingerprint
      })
    });

    const verifyData = await verifyRes.json();
    if (!verifyRes.ok) {
      throw new Error(verifyData.error || 'Passkey verification failed on server');
    }

    // Step 5: Save identity keys and credentials to local device storage (IndexedDB)
    const accountRecord = {
      username: cleanUsername,
      displayName: displayName || cleanUsername,
      jwk: identity.jwk,
      fingerprint: identity.fingerprint,
      sessionToken: verifyData.token,
      authMethod: 'passkey'
    };

    await window.MyCircleStorage.saveAccount(accountRecord);
    return accountRecord;
  }

  /**
   * Log in existing user with WebAuthn Passkey
   */
  async function loginWithPasskey(username) {
    if (!isWebAuthnSupported()) {
      throw new Error('Your browser or device does not support WebAuthn passkeys.');
    }

    const cleanUsername = (username || '').toLowerCase().trim();

    // Step 1: Fetch authentication options from server
    const optionsRes = await fetch('/api/auth/passkey/login-options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: cleanUsername })
    });

    const optionsData = await optionsRes.json();
    if (!optionsRes.ok) {
      throw new Error(optionsData.error || 'Failed to initiate passkey sign-in');
    }

    const { sessionKey } = optionsData;

    // Step 2: Trigger browser passkey ceremony
    let authResponse;
    try {
      authResponse = await window.SimpleWebAuthnBrowser.startAuthentication({
        optionsJSON: optionsData
      });
    } catch (err) {
      console.warn('WebAuthn login error:', err);
      if (err.name === 'NotAllowedError') {
        throw new Error('Passkey sign-in was cancelled or timed out.');
      }
      throw new Error(`Passkey sign-in failed: ${err.message}`);
    }

    // Step 3: Verify with server
    const verifyRes = await fetch('/api/auth/passkey/login-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionKey,
        authenticationResponse: authResponse,
        username: cleanUsername
      })
    });

    const verifyData = await verifyRes.json();
    if (!verifyRes.ok) {
      throw new Error(verifyData.error || 'Passkey verification failed');
    }

    // Check if local device already has identity keys
    let account = await window.MyCircleStorage.getAccount();
    if (!account || account.username !== verifyData.user.username) {
      // If keys are not in local storage on this specific device,
      // generate fresh local identity keys for this device session
      const identity = await window.MyCircleCrypto.generateIdentityKeyPairs();
      account = {
        username: verifyData.user.username,
        displayName: verifyData.user.displayName,
        jwk: identity.jwk,
        fingerprint: identity.fingerprint,
        sessionToken: verifyData.token,
        authMethod: 'passkey'
      };
    } else {
      account.sessionToken = verifyData.token;
      account.authMethod = 'passkey';
    }

    await window.MyCircleStorage.saveAccount(account);
    return account;
  }

  /**
   * Fallback Device-Key / Secure PIN Registration
   */
  async function registerFallback(username, displayName, pin) {
    const cleanUsername = username.toLowerCase().trim();
    if (!cleanUsername) throw new Error('Please enter a username');

    // Generate local cryptographic identity keys
    const identity = await window.MyCircleCrypto.generateIdentityKeyPairs();

    const res = await fetch('/api/auth/register-fallback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: cleanUsername,
        displayName: displayName || cleanUsername,
        pin,
        ecdhPublicKey: identity.jwk.ecdhPublic,
        ecdsaPublicKey: identity.jwk.ecdsaPublic,
        fingerprint: identity.fingerprint
      })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Registration failed');
    }

    const accountRecord = {
      username: cleanUsername,
      displayName: displayName || cleanUsername,
      jwk: identity.jwk,
      fingerprint: identity.fingerprint,
      sessionToken: data.token,
      authMethod: 'device-pin'
    };

    await window.MyCircleStorage.saveAccount(accountRecord);
    return accountRecord;
  }

  /**
   * Fallback Device-Key / Secure PIN Login
   */
  async function loginFallback(username, pin) {
    const cleanUsername = (username || '').toLowerCase().trim();
    if (!cleanUsername) throw new Error('Please enter your username');

    const res = await fetch('/api/auth/login-fallback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: cleanUsername, pin })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Sign in failed');
    }

    let account = await window.MyCircleStorage.getAccount();
    if (!account || account.username !== data.user.username) {
      const identity = await window.MyCircleCrypto.generateIdentityKeyPairs();
      account = {
        username: data.user.username,
        displayName: data.user.displayName,
        jwk: identity.jwk,
        fingerprint: identity.fingerprint,
        sessionToken: data.token,
        authMethod: 'device-pin'
      };
    } else {
      account.sessionToken = data.token;
      account.authMethod = 'device-pin';
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
      if (!res.ok) {
        return null;
      }
      return account;
    } catch (err) {
      // Offline fallback: if network is down, allow accessing local offline history
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
    isWebAuthnSupported,
    registerWithPasskey,
    loginWithPasskey,
    registerFallback,
    loginFallback,
    checkSession,
    logout
  };
});
