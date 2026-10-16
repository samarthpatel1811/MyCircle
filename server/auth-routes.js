const express = require('express');
const crypto = require('crypto');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const usersDirectory = require('./users-directory');

const router = express.Router();

// Helper to determine RP ID & origin from request
function getRpConfig(req) {
  const host = req.get('host') || 'localhost:3000';
  const hostname = host.split(':')[0];
  const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  const origin = `${protocol}://${host}`;
  return { rpID: hostname, origin };
}

// In-memory challenge store: username -> { challenge, timestamp }
const challengeStore = new Map();

// Helper for session token
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
function createSessionToken(username) {
  const payload = JSON.stringify({
    username: username.toLowerCase(),
    iat: Date.now(),
    exp: Date.now() + (7 * 24 * 60 * 60 * 1000) // 7 days
  });
  const b64Payload = Buffer.from(payload).toString('base64url');
  const hmac = crypto.createHmac('sha256', SESSION_SECRET).update(b64Payload).digest('base64url');
  return `${b64Payload}.${hmac}`;
}

function verifySessionToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [b64Payload, signature] = parts;
  const expectedHmac = crypto.createHmac('sha256', SESSION_SECRET).update(b64Payload).digest('base64url');
  if (signature !== expectedHmac) return null;
  try {
    const payload = JSON.parse(Buffer.from(b64Payload, 'base64url').toString('utf8'));
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

// 1. Passkey Registration - Step 1: Generate Options
router.post('/passkey/register-options', async (req, res) => {
  try {
    const { username, displayName } = req.body;
    if (!username || !username.trim()) {
      return res.status(400).json({ error: 'Username is required' });
    }
    const cleanUsername = username.toLowerCase().trim();

    // Check if user already exists
    if (usersDirectory.hasUser(cleanUsername)) {
      return res.status(409).json({ error: `Username @${cleanUsername} is already taken` });
    }

    const { rpID } = getRpConfig(req);
    const options = await generateRegistrationOptions({
      rpName: 'MyCircle',
      rpID,
      userName: cleanUsername,
      userDisplayName: displayName || cleanUsername,
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    challengeStore.set(`reg:${cleanUsername}`, {
      challenge: options.challenge,
      timestamp: Date.now()
    });

    res.json(options);
  } catch (err) {
    console.error('Error generating registration options:', err);
    res.status(500).json({ error: err.message || 'Failed to start registration' });
  }
});

// 2. Passkey Registration - Step 2: Verify and Register User
router.post('/passkey/register-verify', async (req, res) => {
  try {
    const { username, displayName, registrationResponse, ecdhPublicKey, ecdsaPublicKey, fingerprint } = req.body;
    if (!username || !registrationResponse || !ecdhPublicKey || !ecdsaPublicKey) {
      return res.status(400).json({ error: 'Missing registration details or public keys' });
    }

    const cleanUsername = username.toLowerCase().trim();
    const stored = challengeStore.get(`reg:${cleanUsername}`);
    if (!stored) {
      return res.status(400).json({ error: 'Registration session expired. Please try again.' });
    }

    const { rpID, origin } = getRpConfig(req);
    const verification = await verifyRegistrationResponse({
      response: registrationResponse,
      expectedChallenge: stored.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'Passkey verification failed.' });
    }

    challengeStore.delete(`reg:${cleanUsername}`);

    const { credential } = verification.registrationInfo;

    // Convert Buffer/Uint8Array to base64url or hex
    const credentialRecord = {
      id: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      transports: registrationResponse.response.transports || []
    };

    const newUser = usersDirectory.registerUser({
      username: cleanUsername,
      displayName: displayName || cleanUsername,
      ecdhPublicKey,
      ecdsaPublicKey,
      fingerprint,
      passkeyCredentials: [credentialRecord]
    });

    const token = createSessionToken(cleanUsername);

    res.json({
      success: true,
      user: {
        username: newUser.username,
        displayName: newUser.displayName,
        fingerprint: newUser.fingerprint,
        ecdhPublicKey: newUser.ecdhPublicKey,
        ecdsaPublicKey: newUser.ecdsaPublicKey
      },
      token
    });
  } catch (err) {
    console.error('Error verifying registration:', err);
    res.status(500).json({ error: err.message || 'Passkey registration failed' });
  }
});

// 3. Passkey Authentication - Step 1: Generate Options
router.post('/passkey/login-options', async (req, res) => {
  try {
    const { username } = req.body;
    const { rpID } = getRpConfig(req);

    let allowCredentials = [];
    let cleanUsername = '';

    if (username && username.trim()) {
      cleanUsername = username.toLowerCase().trim();
      const user = usersDirectory.getUser(cleanUsername);
      if (!user) {
        return res.status(404).json({ error: `Account @${cleanUsername} not found` });
      }
      if (user.passkeyCredentials && user.passkeyCredentials.length > 0) {
        allowCredentials = user.passkeyCredentials.map(cred => ({
          id: cred.id,
          transports: cred.transports,
        }));
      }
    }

    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials,
      userVerification: 'preferred',
    });

    const sessionKey = cleanUsername ? `auth:${cleanUsername}` : `auth_anon:${options.challenge}`;
    challengeStore.set(sessionKey, {
      challenge: options.challenge,
      username: cleanUsername || null,
      timestamp: Date.now()
    });

    res.json({ ...options, sessionKey });
  } catch (err) {
    console.error('Error generating login options:', err);
    res.status(500).json({ error: err.message || 'Failed to start passkey login' });
  }
});

// 4. Passkey Authentication - Step 2: Verify
router.post('/passkey/login-verify', async (req, res) => {
  try {
    const { sessionKey, authenticationResponse, username } = req.body;
    if (!authenticationResponse) {
      return res.status(400).json({ error: 'Missing authentication response' });
    }

    const stored = challengeStore.get(sessionKey);
    if (!stored) {
      return res.status(400).json({ error: 'Login session expired or invalid' });
    }

    let targetUsername = username || stored.username;
    let targetUser = targetUsername ? usersDirectory.getUser(targetUsername) : null;

    // If username was not pre-specified (discoverable credential / resident key), look up user by credential id
    if (!targetUser) {
      for (const u of usersDirectory.users.values()) {
        const found = (u.passkeyCredentials || []).some(c => c.id === authenticationResponse.id);
        if (found) {
          targetUser = u;
          targetUsername = u.username;
          break;
        }
      }
    }

    if (!targetUser) {
      return res.status(404).json({ error: 'No user matching this passkey was found' });
    }

    const credentialRecord = (targetUser.passkeyCredentials || []).find(c => c.id === authenticationResponse.id);
    if (!credentialRecord) {
      return res.status(400).json({ error: 'Credential not recognized for this user' });
    }

    const { rpID, origin } = getRpConfig(req);
    const verification = await verifyAuthenticationResponse({
      response: authenticationResponse,
      expectedChallenge: stored.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: credentialRecord.id,
        publicKey: Buffer.from(credentialRecord.publicKey, 'base64url'),
        counter: credentialRecord.counter || 0,
        transports: credentialRecord.transports || []
      }
    });

    if (!verification.verified) {
      return res.status(400).json({ error: 'Passkey verification failed' });
    }

    challengeStore.delete(sessionKey);

    // Update credential counter
    if (verification.authenticationInfo) {
      credentialRecord.counter = verification.authenticationInfo.newCounter;
      usersDirectory.save();
    }

    const token = createSessionToken(targetUser.username);

    res.json({
      success: true,
      user: {
        username: targetUser.username,
        displayName: targetUser.displayName,
        fingerprint: targetUser.fingerprint,
        ecdhPublicKey: targetUser.ecdhPublicKey,
        ecdsaPublicKey: targetUser.ecdsaPublicKey
      },
      token
    });
  } catch (err) {
    console.error('Error verifying login:', err);
    res.status(500).json({ error: err.message || 'Passkey authentication failed' });
  }
});

// 5. Fallback Device-Key / Secure PIN Registration & Login
// (Ensures accessibility for all devices, environments, and automated testing)
router.post('/register-fallback', async (req, res) => {
  try {
    const { username, displayName, pin, ecdhPublicKey, ecdsaPublicKey, fingerprint } = req.body;
    if (!username || !username.trim() || !ecdhPublicKey || !ecdsaPublicKey) {
      return res.status(400).json({ error: 'Username and public keys are required' });
    }

    const cleanUsername = username.toLowerCase().trim();
    if (usersDirectory.hasUser(cleanUsername)) {
      return res.status(409).json({ error: `Username @${cleanUsername} is already taken` });
    }

    let pinHash = null;
    if (pin && pin.length >= 4) {
      pinHash = crypto.createHash('sha256').update(pin + cleanUsername).digest('hex');
    }

    const newUser = usersDirectory.registerUser({
      username: cleanUsername,
      displayName: displayName || cleanUsername,
      ecdhPublicKey,
      ecdsaPublicKey,
      fingerprint,
      pinHash
    });

    const token = createSessionToken(cleanUsername);

    res.json({
      success: true,
      user: {
        username: newUser.username,
        displayName: newUser.displayName,
        fingerprint: newUser.fingerprint,
        ecdhPublicKey: newUser.ecdhPublicKey,
        ecdsaPublicKey: newUser.ecdsaPublicKey
      },
      token
    });
  } catch (err) {
    console.error('Fallback registration error:', err);
    res.status(500).json({ error: err.message || 'Registration failed' });
  }
});

router.post('/login-fallback', async (req, res) => {
  try {
    const { username, pin } = req.body;
    if (!username || !username.trim()) {
      return res.status(400).json({ error: 'Username is required' });
    }

    const cleanUsername = username.toLowerCase().trim();
    const user = usersDirectory.getUser(cleanUsername);
    if (!user) {
      return res.status(404).json({ error: `Account @${cleanUsername} not found` });
    }

    if (user.pinHash) {
      if (!pin) {
        return res.status(400).json({ error: 'Device security PIN is required for this account' });
      }
      const testHash = crypto.createHash('sha256').update(pin + cleanUsername).digest('hex');
      if (testHash !== user.pinHash) {
        return res.status(401).json({ error: 'Incorrect security PIN' });
      }
    }

    const token = createSessionToken(cleanUsername);

    res.json({
      success: true,
      user: {
        username: user.username,
        displayName: user.displayName,
        fingerprint: user.fingerprint,
        ecdhPublicKey: user.ecdhPublicKey,
        ecdsaPublicKey: user.ecdsaPublicKey
      },
      token
    });
  } catch (err) {
    console.error('Fallback login error:', err);
    res.status(500).json({ error: err.message || 'Login failed' });
  }
});

// 6. User Directory & Public Profile Search
router.get('/users/search', (req, res) => {
  const query = req.query.q || '';
  const exclude = req.query.exclude || '';
  const results = usersDirectory.searchUsers(query, exclude);
  res.json({ users: results });
});

router.get('/users/:username', (req, res) => {
  const user = usersDirectory.getPublicProfile(req.params.username);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json({ user });
});

// 7. Verify Current Session Token
router.get('/session/me', (req, res) => {
  const authHeader = req.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const session = verifySessionToken(token);
  if (!session) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  const user = usersDirectory.getUser(session.username);
  if (!user) {
    return res.status(404).json({ error: 'User account no longer exists' });
  }

  res.json({
    user: {
      username: user.username,
      displayName: user.displayName,
      fingerprint: user.fingerprint,
      ecdhPublicKey: user.ecdhPublicKey,
      ecdsaPublicKey: user.ecdsaPublicKey
    }
  });
});

module.exports = {
  router,
  verifySessionToken
};
