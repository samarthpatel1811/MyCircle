const crypto = require('crypto');

const SESSION_SECRET = process.env.SESSION_SECRET || 'mycircle_secure_session_secret_p256_e2ee';

function createSessionToken(username) {
  const payload = JSON.stringify({
    username: username.toLowerCase().trim(),
    iat: Date.now(),
    exp: Date.now() + (30 * 24 * 60 * 60 * 1000) // 30 days
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

module.exports = {
  createSessionToken,
  verifySessionToken
};
