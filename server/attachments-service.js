const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ATTACHMENTS_DIR = path.join(__dirname, 'data', 'attachments');

// Ensure attachments directory exists
if (!fs.existsSync(ATTACHMENTS_DIR)) {
  fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
}

// 10 MB maximum encrypted file payload
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

class AttachmentsService {
  constructor() {
    this.meta = new Map();
    this.metaFile = path.join(__dirname, 'data', 'attachments-meta.json');
    this.loadMeta();
  }

  loadMeta() {
    try {
      if (fs.existsSync(this.metaFile)) {
        const raw = fs.readFileSync(this.metaFile, 'utf8');
        const list = JSON.parse(raw);
        list.forEach(item => {
          if (item && item.id) {
            this.meta.set(item.id, item);
          }
        });
      }
    } catch (e) {
      console.warn('Error loading attachments metadata:', e.message);
      this.meta = new Map();
    }
  }

  saveMeta() {
    try {
      const list = Array.from(this.meta.values());
      fs.writeFileSync(this.metaFile, JSON.stringify(list, null, 2), 'utf8');
    } catch (e) {
      console.warn('Error saving attachments metadata:', e.message);
    }
  }

  /**
   * Save an encrypted file buffer
   * Server only stores encrypted ciphertext bytes. Zero plaintext access.
   */
  saveEncryptedAttachment({ id, uploader, buffer, contentType = 'application/octet-stream' }) {
    if (!id) {
      id = 'att_' + Date.now().toString(36) + '_' + crypto.randomBytes(8).toString('hex');
    }

    if (buffer.length > MAX_ATTACHMENT_SIZE) {
      throw new Error(`Attachment exceeds maximum allowable size of 10 MB (size: ${(buffer.length / (1024 * 1024)).toFixed(2)} MB)`);
    }

    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '');
    const filePath = path.join(ATTACHMENTS_DIR, `${safeId}.enc`);

    fs.writeFileSync(filePath, buffer);

    const record = {
      id: safeId,
      uploader: (uploader || '').toLowerCase(),
      size: buffer.length,
      contentType,
      createdAt: new Date().toISOString()
    };

    this.meta.set(safeId, record);
    this.saveMeta();

    return record;
  }

  /**
   * Retrieve encrypted attachment file buffer
   */
  getEncryptedAttachment(id) {
    const safeId = (id || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safeId) return null;

    const filePath = path.join(ATTACHMENTS_DIR, `${safeId}.enc`);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const meta = this.meta.get(safeId) || { id: safeId, size: fs.statSync(filePath).size, contentType: 'application/octet-stream' };
    const buffer = fs.readFileSync(filePath);
    return { buffer, meta };
  }

  /**
   * Delete an attachment
   */
  deleteAttachment(id) {
    const safeId = (id || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const filePath = path.join(ATTACHMENTS_DIR, `${safeId}.enc`);
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (e) {}
    }
    this.meta.delete(safeId);
    this.saveMeta();
  }
}

module.exports = new AttachmentsService();
