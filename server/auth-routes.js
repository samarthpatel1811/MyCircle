const express = require('express');
const crypto = require('crypto');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const usersDirectory = require('./users-directory');
const invitationsService = require('./invitations-service');
const signalingServer = require('./signaling');

const router = express.Router();

// Helper to determine RP ID & origin from request
function getRpConfig(req) {
  const host = req.get('host') || 'localhost:3030';
  const hostname = host.split(':')[0];
  const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  const origin = `${protocol}://${host}`;
  return { rpID: hostname, origin };
}

// In-memory challenge store: username -> { challenge, timestamp }
const challengeStore = new Map();

// Helper for session token
const { createSessionToken, verifySessionToken } = require('./session');

// Middleware to extract authenticated user from Bearer token
function requireAuth(req, res, next) {
  const authHeader = req.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const session = verifySessionToken(token);
  if (!session) {
    return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
  }
  const user = usersDirectory.getUser(session.username);
  if (!user) {
    return res.status(401).json({ error: 'User account not found. Please log in again.' });
  }
  req.user = user;
  next();
}

// ==========================================================================
// 1. Primary Simple Registration (Full Name, Username, Password, Confirm)
// ==========================================================================
function handleRegister(req, res) {
  try {
    const { fullName, displayName, username, password, confirmPassword, pin, ecdhPublicKey, ecdsaPublicKey, fingerprint } = req.body;

    if (!username || !username.trim()) {
      return res.status(400).json({ error: 'Username is required.' });
    }

    const cleanUsername = username.toLowerCase().trim();

    // Username format check
    if (!/^[a-zA-Z0-9_-]{3,24}$/.test(cleanUsername)) {
      return res.status(400).json({
        error: 'Username must be 3-24 characters long and can only contain letters, numbers, hyphens, and underscores.'
      });
    }

    if (usersDirectory.hasUser(cleanUsername)) {
      return res.status(409).json({
        error: `Username @${cleanUsername} is already taken. Please choose a different username.`
      });
    }

    const effectivePassword = password || pin;
    const effectiveConfirm = confirmPassword || pin || effectivePassword;

    if (!effectivePassword) {
      return res.status(400).json({ error: 'Password is required.' });
    }

    const isPin = Boolean(pin && !password);
    const minLength = isPin ? 4 : 6;

    if (effectivePassword.length < minLength) {
      return res.status(400).json({
        error: isPin ? 'Device PIN must be at least 4 digits.' : 'Password must be at least 6 characters long.'
      });
    }

    if (effectivePassword !== effectiveConfirm) {
      return res.status(400).json({ error: 'Passwords do not match. Please verify both password fields.' });
    }

    if (!ecdhPublicKey || !ecdsaPublicKey) {
      return res.status(400).json({ error: 'Cryptographic identity keys could not be generated on this browser.' });
    }

    const name = fullName || displayName || cleanUsername;

    const newUser = usersDirectory.registerUserWithPassword({
      username: cleanUsername,
      displayName: (name && name.trim()) || cleanUsername,
      password: effectivePassword,
      ecdhPublicKey,
      ecdsaPublicKey,
      fingerprint
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
    console.error('Registration error:', err);
    res.status(500).json({ error: err.message || 'An error occurred during registration. Please try again.' });
  }
}

router.post('/register', handleRegister);
router.post('/register-fallback', handleRegister);

// ==========================================================================
// 2. Primary Simple Login (Username + Password)
// ==========================================================================
function handleLogin(req, res) {
  try {
    const { username, password, pin } = req.body;

    if (!username || !username.trim()) {
      return res.status(400).json({ error: 'Please enter your username.' });
    }

    const effectivePassword = password || pin;

    if (!effectivePassword) {
      return res.status(400).json({ error: 'Please enter your password.' });
    }

    const cleanUsername = username.toLowerCase().trim();
    const result = usersDirectory.verifyUserCredentials(cleanUsername, effectivePassword);

    if (!result.ok) {
      if (result.reason === 'ACCOUNT_NOT_FOUND') {
        return res.status(404).json({
          error: `Account @${cleanUsername} was not found. Don't have an account yet? Click "Create an account" to get started!`
        });
      }
      if (result.reason === 'INVALID_PASSWORD') {
        return res.status(401).json({
          error: 'Incorrect password. Please check your credentials and try again.'
        });
      }
      return res.status(401).json({
        error: 'Unable to authenticate account with this password. If you registered using a Passkey, please sign in with your Passkey.'
      });
    }

    const user = result.user;
    const token = createSessionToken(user.username);

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
    console.error('Login error:', err);
    res.status(500).json({ error: err.message || 'An error occurred during login. Please try again.' });
  }
}

router.post('/login', handleLogin);
router.post('/login-fallback', handleLogin);

// ==========================================================================
// 3. Invitations API (QR Code & Join Keys)
// ==========================================================================

// Create or retrieve active invite code for current user
router.post('/invitations/create', requireAuth, (req, res) => {
  try {
    const { type, groupId, groupName } = req.body;

    // Check if user already has an active direct invite
    let existing = null;
    if (type !== 'group') {
      existing = invitationsService.getLatestUserInvitation(req.user.username, 'direct');
    }

    if (existing) {
      return res.json({
        invitation: existing,
        joinUrl: `${getRpConfig(req).origin}/?join=${existing.code}`
      });
    }

    const invitation = invitationsService.createInvitation({
      creatorUsername: req.user.username,
      creatorDisplayName: req.user.displayName,
      type: type || 'direct',
      groupId,
      groupName
    });

    res.json({
      invitation,
      joinUrl: `${getRpConfig(req).origin}/?join=${invitation.code}`
    });
  } catch (err) {
    console.error('Create invitation error:', err);
    res.status(500).json({ error: 'Failed to create invitation.' });
  }
});

// Look up invitation by join code
router.get('/invitations/lookup/:code', (req, res) => {
  try {
    const result = invitationsService.getInvitation(req.params.code);
    if (!result) {
      return res.status(404).json({ error: 'Invalid invitation key. Please check the code and try again.' });
    }
    if (result.error) {
      return res.status(410).json({ error: result.error });
    }

    // Attach creator's public profile (never private keys)
    const creator = usersDirectory.getPublicProfile(result.creatorUsername);
    if (!creator) {
      return res.status(404).json({ error: 'The person who created this invitation no longer exists.' });
    }

    res.json({
      valid: true,
      invitation: {
        code: result.code,
        type: result.type,
        groupName: result.groupName,
        groupId: result.groupId,
        expiresAt: result.expiresAt
      },
      creator
    });
  } catch (err) {
    console.error('Lookup invitation error:', err);
    res.status(500).json({ error: 'Failed to verify invitation key.' });
  }
});

// Revoke an invitation
router.post('/invitations/revoke', requireAuth, (req, res) => {
  try {
    const { code } = req.body;
    const success = invitationsService.revokeInvitation(code, req.user.username);
    if (!success) {
      return res.status(400).json({ error: 'Could not revoke invitation.' });
    }
    res.json({ success: true, message: 'Invitation key revoked successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to revoke invitation.' });
  }
});

// ==========================================================================
// 4. Chat Requests API (Permissioned 1-on-1 Connections)
// ==========================================================================

// Send a chat request
router.post('/chat-requests/send', requireAuth, (req, res) => {
  try {
    const { recipientUsername, joinKey } = req.body;
    if (!recipientUsername) {
      return res.status(400).json({ error: 'Recipient username is required.' });
    }

    const cleanRecipient = recipientUsername.toLowerCase().trim();
    if (cleanRecipient === req.user.username) {
      return res.status(400).json({ error: 'You cannot send a chat request to yourself.' });
    }

    const recipient = usersDirectory.getUser(cleanRecipient);
    if (!recipient) {
      return res.status(404).json({ error: `User @${cleanRecipient} not found.` });
    }

    const request = invitationsService.createChatRequest({
      fromUsername: req.user.username,
      fromDisplayName: req.user.displayName,
      toUsername: cleanRecipient,
      joinKey
    });

    // Notify recipient in real time over WebSocket if connected
    signalingServer.sendToUser(cleanRecipient, {
      type: 'chat-request-received',
      request,
      senderProfile: usersDirectory.getPublicProfile(req.user.username)
    });

    res.json({ success: true, request });
  } catch (err) {
    console.error('Send chat request error:', err);
    res.status(400).json({ error: err.message || 'Failed to send chat request.' });
  }
});

// List incoming and outgoing chat requests
router.get('/chat-requests', requireAuth, (req, res) => {
  try {
    const requests = invitationsService.getRequestsForUser(req.user.username);
    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch chat requests.' });
  }
});

// Respond to chat request (accept / reject / cancel)
router.post('/chat-requests/:id/respond', requireAuth, (req, res) => {
  try {
    const { action } = req.body; // 'accepted' | 'rejected' | 'cancelled'
    if (!['accepted', 'rejected', 'cancelled'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action.' });
    }

    const updated = invitationsService.updateRequestStatus(req.params.id, action, req.user.username);

    // Notify other party over WebSocket
    const targetUser = (req.user.username === updated.fromUsername) ? updated.toUsername : updated.fromUsername;
    signalingServer.sendToUser(targetUser, {
      type: 'chat-request-updated',
      request: updated,
      responderProfile: usersDirectory.getPublicProfile(req.user.username)
    });

    res.json({ success: true, request: updated });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to update chat request.' });
  }
});

// ==========================================================================
// 5. Existing Routes: Passkeys & Fallback PIN
// ==========================================================================

router.post('/passkey/register-options', async (req, res) => {
  try {
    const { username, displayName } = req.body;
    if (!username || !username.trim()) return res.status(400).json({ error: 'Username is required' });
    const cleanUsername = username.toLowerCase().trim();

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
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' }
    });

    challengeStore.set(`reg:${cleanUsername}`, { challenge: options.challenge, timestamp: Date.now() });
    res.json(options);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to start passkey registration' });
  }
});

router.post('/passkey/register-verify', async (req, res) => {
  try {
    const { username, displayName, registrationResponse, ecdhPublicKey, ecdsaPublicKey, fingerprint } = req.body;
    const cleanUsername = username.toLowerCase().trim();
    const stored = challengeStore.get(`reg:${cleanUsername}`);
    if (!stored) return res.status(400).json({ error: 'Registration session expired.' });

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
    res.status(500).json({ error: err.message || 'Passkey registration failed' });
  }
});

router.post('/passkey/login-options', async (req, res) => {
  try {
    const { username } = req.body;
    const { rpID } = getRpConfig(req);
    let allowCredentials = [];
    let cleanUsername = '';

    if (username && username.trim()) {
      cleanUsername = username.toLowerCase().trim();
      const user = usersDirectory.getUser(cleanUsername);
      if (!user) return res.status(404).json({ error: `Account @${cleanUsername} not found` });
      if (user.passkeyCredentials && user.passkeyCredentials.length > 0) {
        allowCredentials = user.passkeyCredentials.map(cred => ({ id: cred.id, transports: cred.transports }));
      }
    }

    const options = await generateAuthenticationOptions({ rpID, allowCredentials, userVerification: 'preferred' });
    const sessionKey = cleanUsername ? `auth:${cleanUsername}` : `auth_anon:${options.challenge}`;
    challengeStore.set(sessionKey, { challenge: options.challenge, username: cleanUsername || null, timestamp: Date.now() });
    res.json({ ...options, sessionKey });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to start passkey login' });
  }
});

router.post('/passkey/login-verify', async (req, res) => {
  try {
    const { sessionKey, authenticationResponse, username } = req.body;
    const stored = challengeStore.get(sessionKey);
    if (!stored) return res.status(400).json({ error: 'Login session expired.' });

    let targetUsername = username || stored.username;
    let targetUser = targetUsername ? usersDirectory.getUser(targetUsername) : null;

    if (!targetUser) {
      for (const u of usersDirectory.users.values()) {
        const found = (u.passkeyCredentials || []).some(c => c.id === authenticationResponse.id);
        if (found) {
          targetUser = u;
          break;
        }
      }
    }

    if (!targetUser) return res.status(404).json({ error: 'No account matching this passkey was found' });

    const credentialRecord = (targetUser.passkeyCredentials || []).find(c => c.id === authenticationResponse.id);
    if (!credentialRecord) return res.status(400).json({ error: 'Credential not recognized for this user' });

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

    if (!verification.verified) return res.status(400).json({ error: 'Passkey verification failed' });
    challengeStore.delete(sessionKey);

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
    res.status(500).json({ error: err.message || 'Passkey authentication failed' });
  }
});

// 6. User Directory Search
router.get('/users/search', (req, res) => {
  const query = req.query.q || '';
  const exclude = req.query.exclude || '';
  const results = usersDirectory.searchUsers(query, exclude);
  res.json({ users: results });
});

router.get('/users/:username', (req, res) => {
  const user = usersDirectory.getPublicProfile(req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

// 7. Verify Current Session Token
router.get('/session/me', (req, res) => {
  const authHeader = req.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const session = verifySessionToken(token);
  if (!session) return res.status(401).json({ error: 'Invalid or expired session' });

  const user = usersDirectory.getUser(session.username);
  if (!user) return res.status(404).json({ error: 'User account no longer exists' });

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
