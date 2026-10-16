const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const INVITATIONS_FILE = path.join(DATA_DIR, 'invitations.json');
const REQUESTS_FILE = path.join(DATA_DIR, 'chat-requests.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

class InvitationsService {
  constructor() {
    this.invitations = new Map(); // code -> invitation
    this.chatRequests = new Map(); // id -> request
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(INVITATIONS_FILE)) {
        const raw = fs.readFileSync(INVITATIONS_FILE, 'utf8');
        const list = JSON.parse(raw);
        list.forEach(inv => this.invitations.set(inv.code.toUpperCase(), inv));
      }
    } catch (e) {
      console.error('Error loading invitations:', e);
      this.invitations = new Map();
    }

    try {
      if (fs.existsSync(REQUESTS_FILE)) {
        const raw = fs.readFileSync(REQUESTS_FILE, 'utf8');
        const list = JSON.parse(raw);
        list.forEach(req => this.chatRequests.set(req.id, req));
      }
    } catch (e) {
      console.error('Error loading chat requests:', e);
      this.chatRequests = new Map();
    }
  }

  save() {
    try {
      fs.writeFileSync(INVITATIONS_FILE, JSON.stringify(Array.from(this.invitations.values()), null, 2), 'utf8');
      fs.writeFileSync(REQUESTS_FILE, JSON.stringify(Array.from(this.chatRequests.values()), null, 2), 'utf8');
    } catch (e) {
      console.error('Error saving invitations/requests:', e);
    }
  }

  // Generate clean, readable join keys e.g. MYC-7K9P-4X2M
  generateJoinKey() {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // exclude ambiguous 0,1,O,I
    let part1 = '';
    let part2 = '';
    const bytes = crypto.randomBytes(8);
    for (let i = 0; i < 4; i++) part1 += chars[bytes[i] % chars.length];
    for (let i = 4; i < 8; i++) part2 += chars[bytes[i] % chars.length];
    return `MYC-${part1}-${part2}`;
  }

  createInvitation({ creatorUsername, creatorDisplayName, type = 'direct', groupId = null, groupName = null, expiresInDays = 7 }) {
    // Revoke any existing active direct invitations for this user to keep it clean, or allow new
    const code = this.generateJoinKey();
    const expiresAt = Date.now() + (expiresInDays * 24 * 60 * 60 * 1000);

    const invitation = {
      code,
      creatorUsername: creatorUsername.toLowerCase().trim(),
      creatorDisplayName: creatorDisplayName || creatorUsername,
      type, // 'direct' or 'group'
      groupId: groupId || null,
      groupName: groupName || null,
      createdAt: Date.now(),
      expiresAt,
      isRevoked: false,
      useCount: 0
    };

    this.invitations.set(code, invitation);
    this.save();
    return invitation;
  }

  getInvitation(code) {
    if (!code) return null;
    const cleanCode = code.toUpperCase().trim();
    const inv = this.invitations.get(cleanCode);
    if (!inv) return null;

    if (inv.isRevoked) {
      return { error: 'This invitation key has been revoked by the creator.' };
    }
    if (Date.now() > inv.expiresAt) {
      return { error: 'This invitation key has expired. Please ask for a new invite.' };
    }

    return inv;
  }

  getLatestUserInvitation(username, type = 'direct') {
    const clean = username.toLowerCase().trim();
    for (const inv of Array.from(this.invitations.values()).reverse()) {
      if (inv.creatorUsername === clean && inv.type === type && !inv.isRevoked && Date.now() < inv.expiresAt) {
        return inv;
      }
    }
    return null;
  }

  revokeInvitation(code, username) {
    const cleanCode = code.toUpperCase().trim();
    const inv = this.invitations.get(cleanCode);
    if (!inv) return false;
    if (inv.creatorUsername !== username.toLowerCase().trim()) return false;
    inv.isRevoked = true;
    this.save();
    return true;
  }

  // ----------------------------------------------------
  // Chat Requests API (Option A & Option B connection flow)
  // ----------------------------------------------------

  createChatRequest({ fromUsername, fromDisplayName, toUsername, joinKey = null }) {
    const from = fromUsername.toLowerCase().trim();
    const to = toUsername.toLowerCase().trim();

    if (from === to) {
      throw new Error('You cannot send a chat request to yourself.');
    }

    // Check if there is already an existing pending request
    for (const req of this.chatRequests.values()) {
      if (req.fromUsername === from && req.toUsername === to && req.status === 'pending') {
        throw new Error(`A chat request to @${to} is already pending.`);
      }
    }

    const id = 'req_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
    const newRequest = {
      id,
      fromUsername: from,
      fromDisplayName: fromDisplayName || from,
      toUsername: to,
      joinKey,
      status: 'pending', // 'pending' | 'accepted' | 'rejected' | 'cancelled'
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    this.chatRequests.set(id, newRequest);
    this.save();
    return newRequest;
  }

  getRequestById(id) {
    return this.chatRequests.get(id) || null;
  }

  getRequestsForUser(username) {
    const clean = username.toLowerCase().trim();
    const incoming = [];
    const outgoing = [];

    for (const req of this.chatRequests.values()) {
      if (req.toUsername === clean) {
        incoming.push(req);
      } else if (req.fromUsername === clean) {
        outgoing.push(req);
      }
    }

    incoming.sort((a, b) => b.createdAt - a.createdAt);
    outgoing.sort((a, b) => b.createdAt - a.createdAt);

    return { incoming, outgoing };
  }

  findRequestBetween(userA, userB) {
    const a = userA.toLowerCase().trim();
    const b = userB.toLowerCase().trim();

    for (const req of this.chatRequests.values()) {
      if ((req.fromUsername === a && req.toUsername === b) || (req.fromUsername === b && req.toUsername === a)) {
        return req;
      }
    }
    return null;
  }

  updateRequestStatus(id, newStatus, currentUsername) {
    const req = this.chatRequests.get(id);
    if (!req) throw new Error('Chat request not found.');

    const cleanUser = currentUsername.toLowerCase().trim();

    if (newStatus === 'accepted' || newStatus === 'rejected') {
      if (req.toUsername !== cleanUser) {
        throw new Error('Only the recipient can accept or reject this request.');
      }
    } else if (newStatus === 'cancelled') {
      if (req.fromUsername !== cleanUser) {
        throw new Error('Only the sender can cancel this request.');
      }
    }

    req.status = newStatus;
    req.updatedAt = Date.now();
    this.save();
    return req;
  }
}

module.exports = new InvitationsService();
