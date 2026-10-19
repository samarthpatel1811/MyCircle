const express = require('express');
const attachmentsService = require('./attachments-service');
const { verifySessionToken } = require('./session');

const router = express.Router();

function requireAuth(req, res, next) {
  const authHeader = req.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const session = verifySessionToken(token);
  if (!session) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  req.user = session;
  next();
}

/**
 * Upload an encrypted attachment
 * Accepts encrypted ciphertext bytes as base64 in JSON payload or raw octet-stream
 */
router.post('/upload', requireAuth, (req, res) => {
  try {
    let buffer = null;
    let contentType = 'application/octet-stream';
    let customId = null;

    if (req.body && req.body.ciphertext) {
      // Base64 encoded payload
      buffer = Buffer.from(req.body.ciphertext, 'base64');
      contentType = req.body.contentType || contentType;
      customId = req.body.id || null;
    } else if (Buffer.isBuffer(req.body)) {
      buffer = req.body;
    } else {
      return res.status(400).json({ error: 'Missing encrypted ciphertext buffer or payload' });
    }

    if (!buffer || buffer.length === 0) {
      return res.status(400).json({ error: 'Empty file payload' });
    }

    const saved = attachmentsService.saveEncryptedAttachment({
      id: customId,
      uploader: req.user.username,
      buffer,
      contentType
    });

    res.json({
      success: true,
      attachmentId: saved.id,
      size: saved.size,
      createdAt: saved.createdAt
    });
  } catch (err) {
    console.error('Attachment upload error:', err);
    res.status(400).json({ error: err.message || 'Failed to upload encrypted attachment' });
  }
});

/**
 * Download an encrypted attachment
 */
router.get('/:id', (req, res) => {
  try {
    const fileData = attachmentsService.getEncryptedAttachment(req.params.id);
    if (!fileData) {
      return res.status(404).json({ error: 'Attachment not found or has expired' });
    }

    res.setHeader('Content-Type', fileData.meta.contentType || 'application/octet-stream');
    res.setHeader('Content-Length', fileData.buffer.length);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(fileData.buffer);
  } catch (err) {
    console.error('Attachment download error:', err);
    res.status(500).json({ error: 'Failed to retrieve encrypted attachment' });
  }
});

module.exports = router;
