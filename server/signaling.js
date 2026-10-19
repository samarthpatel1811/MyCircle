const { WebSocketServer } = require('ws');
const { verifySessionToken } = require('./session');
const usersDirectory = require('./users-directory');

class SignalingServer {
  constructor() {
    this.wss = null;
    // Map: username -> Set of active WebSocket connections
    this.userSockets = new Map();
    // Ephemeral in-memory mailbox for offline or in-flight encrypted delivery
    // Map: recipientUsername -> Array of encrypted packets (NO database, strictly in-memory)
    this.ephemeralMailbox = new Map();
    // Delivery ACKs in flight
    this.pendingAcks = new Map();
  }

  attach(server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws, req) => {
      let authenticatedUser = null;

      // Heartbeat ping-pong
      ws.isAlive = true;
      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleMessage(ws, msg, (user) => {
            authenticatedUser = user;
          });
        } catch (err) {
          console.error('Invalid WS payload received:', err);
        }
      });

      ws.on('close', () => {
        if (authenticatedUser) {
          this.removeUserSocket(authenticatedUser, ws);
        }
      });

      ws.on('error', (err) => {
        console.error('WS client error:', err);
      });
    });

    // Liveness sweep every 30 seconds
    const interval = setInterval(() => {
      if (!this.wss) return;
      this.wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);

    this.wss.on('close', () => {
      clearInterval(interval);
    });
  }

  addUserSocket(username, ws) {
    const user = username.toLowerCase();
    if (!this.userSockets.has(user)) {
      this.userSockets.set(user, new Set());
    }
    this.userSockets.get(user).add(ws);
    usersDirectory.setUserOnline(user, true);

    // Notify contacts / peers of presence
    this.broadcastPresence(user, true);

    // Flush any ephemeral encrypted packets waiting for this user
    this.flushMailbox(user, ws);
    this.flushAcks(user, ws);
    this.flushChatRequests(user, ws);
  }

  flushChatRequests(username, ws) {
    try {
      const invitationsService = require('./invitations-service');
      const requests = invitationsService.getRequestsForUser(username);
      const pendingIncoming = requests.incoming.filter(r => r.status === 'pending');
      if (pendingIncoming.length > 0 && ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'chat-requests-sync',
          requests: pendingIncoming
        }));
      }
    } catch (e) {
      console.warn('Error flushing chat requests:', e);
    }
  }

  removeUserSocket(username, ws) {
    const user = username.toLowerCase();
    const sockets = this.userSockets.get(user);
    if (sockets) {
      sockets.delete(ws);
      if (sockets.size === 0) {
        this.userSockets.delete(user);
        usersDirectory.setUserOnline(user, false);
        this.broadcastPresence(user, false);
      }
    }
  }

  isUserOnline(username) {
    const user = username.toLowerCase();
    const sockets = this.userSockets.get(user);
    return !!(sockets && sockets.size > 0);
  }

  sendToUser(username, payload) {
    const user = username.toLowerCase();
    const sockets = this.userSockets.get(user);
    if (!sockets || sockets.size === 0) return false;

    const data = JSON.stringify(payload);
    let sent = false;
    for (const ws of sockets) {
      if (ws.readyState === 1) { // OPEN
        ws.send(data);
        sent = true;
      }
    }
    return sent;
  }

  broadcastPresence(username, isOnline) {
    const payload = JSON.stringify({
      type: 'presence',
      username,
      isOnline,
      timestamp: new Date().toISOString()
    });

    for (const sockets of this.userSockets.values()) {
      for (const ws of sockets) {
        if (ws.readyState === 1) {
          ws.send(payload);
        }
      }
    }
  }

  flushMailbox(username, ws) {
    const user = username.toLowerCase();
    const packets = this.ephemeralMailbox.get(user);
    if (packets && packets.length > 0) {
      const now = Date.now();
      // Send queued encrypted packets or control events to client
      packets.forEach(item => {
        // Discard expired messages
        if (item.expiresAt && now > item.expiresAt) {
          return;
        }
        if (item.packet && item.packet.expiresAt && now > item.packet.expiresAt) {
          return;
        }

        if (ws.readyState === 1) {
          if (item.type) {
            // Already a typed packet (e.g. message-reaction, disappearing-setting-changed, group-rekey)
            ws.send(JSON.stringify(item));
          } else {
            // Standard direct encrypted packet
            ws.send(JSON.stringify({
              type: 'encrypted-message',
              packet: item,
              fromRelay: true
            }));
          }
        }
      });
      // Immediately clear in-memory mailbox (no persistent chat database)
      this.ephemeralMailbox.delete(user);
    }
  }

  flushAcks(username, ws) {
    const user = username.toLowerCase();
    const acks = this.pendingAcks.get(user);
    if (acks && acks.length > 0) {
      acks.forEach(ack => {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: 'delivery-ack',
            ...ack
          }));
        }
      });
      this.pendingAcks.delete(user);
    }
  }

  handleMessage(ws, msg, setAuthUser) {
    const type = msg.type;

    // 1. Authenticate WebSocket session
    if (type === 'auth') {
      const session = verifySessionToken(msg.token);
      if (!session) {
        ws.send(JSON.stringify({ type: 'auth-error', error: 'Invalid or expired session token' }));
        return;
      }

      setAuthUser(session.username);
      this.addUserSocket(session.username, ws);

      ws.send(JSON.stringify({
        type: 'auth-success',
        username: session.username,
        timestamp: new Date().toISOString()
      }));
      return;
    }

    // Require authentication for all subsequent actions
    // Sender must match ws or session
    const sender = (msg.sender || '').toLowerCase();
    if (!sender || !this.userSockets.has(sender)) {
      ws.send(JSON.stringify({ type: 'error', error: 'Unauthorized or unauthenticated session' }));
      return;
    }

    switch (type) {
      // 2. WebRTC P2P Signaling (Offer, Answer, ICE Candidates)
      case 'rtc-offer':
      case 'rtc-answer':
      case 'rtc-ice-candidate': {
        const target = (msg.target || '').toLowerCase();
        if (!target) return;

        const sent = this.sendToUser(target, {
          type,
          from: sender,
          data: msg.data
        });

        if (!sent) {
          ws.send(JSON.stringify({
            type: 'signal-failed',
            target,
            reason: 'Peer is currently offline or unreachable'
          }));
        }
        break;
      }

      // 3. Ephemeral End-to-End Encrypted Message Relay
      // Note: server only sees already-encrypted ciphertext, never plaintext.
      case 'relay-encrypted-message': {
        const { packet } = msg;
        if (!packet || !packet.recipient) {
          ws.send(JSON.stringify({ type: 'error', error: 'Missing packet recipient' }));
          return;
        }

        const recipient = packet.recipient.toLowerCase();
        const isOnline = this.isUserOnline(recipient);

        if (isOnline) {
          // Deliver immediately
          this.sendToUser(recipient, {
            type: 'encrypted-message',
            packet,
            fromRelay: true
          });

          // Notify sender that packet reached the relay and was pushed
          ws.send(JSON.stringify({
            type: 'relay-status',
            messageId: packet.id,
            status: 'sent',
            recipientOnline: true
          }));
        } else {
          // Buffer in ephemeral in-memory mailbox until recipient reconnects
          if (!this.ephemeralMailbox.has(recipient)) {
            this.ephemeralMailbox.set(recipient, []);
          }
          const queue = this.ephemeralMailbox.get(recipient);
          // Limit memory queue per recipient (up to 100 pending messages)
          if (queue.length > 100) {
            queue.shift();
          }
          queue.push(packet);

          // Inform sender that recipient is currently offline and packet is in ephemeral queue
          ws.send(JSON.stringify({
            type: 'relay-status',
            messageId: packet.id,
            status: 'sent',
            recipientOnline: false,
            note: 'Recipient offline. Encrypted message will be delivered when they connect.'
          }));
        }
        break;
      }

      // 4. Delivery Confirmation ACK
      // Sent by recipient once message is successfully received and written to local IndexedDB
      case 'ack-delivery': {
        const { messageId, originalSender } = msg;
        if (!messageId || !originalSender) return;

        const senderUser = originalSender.toLowerCase();
        const sent = this.sendToUser(senderUser, {
          type: 'delivery-ack',
          messageId,
          recipient: sender,
          deliveredAt: new Date().toISOString()
        });

        if (!sent) {
          // Queue ACK in memory until original sender comes online
          if (!this.pendingAcks.has(senderUser)) {
            this.pendingAcks.set(senderUser, []);
          }
          this.pendingAcks.get(senderUser).push({
            messageId,
            recipient: sender,
            deliveredAt: new Date().toISOString()
          });
        }
        break;
      }

      // 5. Typing Indicators
      case 'typing': {
        const recipient = (msg.recipient || '').toLowerCase();
        if (recipient) {
          this.sendToUser(recipient, {
            type: 'typing',
            sender,
            isTyping: !!msg.isTyping
          });
        }
        break;
      }

      // 6. Group Encrypted Relay
      case 'group-relay-message': {
        const { packet, memberList } = msg;
        if (!packet || !Array.isArray(memberList)) return;

        memberList.forEach(member => {
          const m = member.toLowerCase();
          if (m === sender) return; // Don't echo to sender

          if (this.isUserOnline(m)) {
            this.sendToUser(m, {
              type: 'group-encrypted-message',
              packet
            });
          } else {
            // Buffer in ephemeral queue
            if (!this.ephemeralMailbox.has(m)) {
              this.ephemeralMailbox.set(m, []);
            }
            this.ephemeralMailbox.get(m).push(packet);
          }
        });

        // Acknowledge to sender that group message was relayed
        ws.send(JSON.stringify({
          type: 'relay-status',
          messageId: packet.id,
          status: 'sent',
          group: packet.groupId
        }));
        break;
      }

      // 7. Group Rekey / Member Removal Event Distribution
      case 'group-rekey-distribution': {
        const { groupId, epoch, keyDistributionList } = msg;
        if (!Array.isArray(keyDistributionList)) return;

        // keyDistributionList contains: [{ recipient, encryptedKeyPacket }]
        keyDistributionList.forEach(item => {
          const recipient = item.recipient.toLowerCase();
          const payload = {
            type: 'group-rekey',
            groupId,
            epoch,
            admin: sender,
            encryptedKey: item.encryptedKeyPacket
          };

          if (this.isUserOnline(recipient)) {
            this.sendToUser(recipient, payload);
          } else {
            if (!this.ephemeralMailbox.has(recipient)) {
              this.ephemeralMailbox.set(recipient, []);
            }
            this.ephemeralMailbox.get(recipient).push(payload);
          }
        });
        break;
      }

      // 8. Message Reactions (Direct & Group)
      case 'message-reaction': {
        const { conversationId, messageId, emoji, action, isGroup, memberList, recipient } = msg;
        if (!messageId || !emoji) return;

        const payload = {
          type: 'message-reaction',
          conversationId,
          messageId,
          emoji,
          action: action || 'toggle',
          sender,
          timestamp: Date.now()
        };

        if (isGroup && Array.isArray(memberList)) {
          memberList.forEach(m => {
            const member = m.toLowerCase();
            if (member === sender) return;
            if (this.isUserOnline(member)) {
              this.sendToUser(member, payload);
            } else {
              if (!this.ephemeralMailbox.has(member)) {
                this.ephemeralMailbox.set(member, []);
              }
              this.ephemeralMailbox.get(member).push(payload);
            }
          });
        } else if (recipient) {
          const rec = recipient.toLowerCase();
          if (this.isUserOnline(rec)) {
            this.sendToUser(rec, payload);
          } else {
            if (!this.ephemeralMailbox.has(rec)) {
              this.ephemeralMailbox.set(rec, []);
            }
            this.ephemeralMailbox.get(rec).push(payload);
          }
        }
        break;
      }

      // 9. Disappearing Messages Setting Changed
      case 'disappearing-setting-changed': {
        const { conversationId, ttl, isGroup, memberList, recipient } = msg;
        const payload = {
          type: 'disappearing-setting-changed',
          conversationId,
          ttl: Number(ttl) || 0,
          sender,
          timestamp: Date.now()
        };

        if (isGroup && Array.isArray(memberList)) {
          memberList.forEach(m => {
            const member = m.toLowerCase();
            if (member === sender) return;
            if (this.isUserOnline(member)) {
              this.sendToUser(member, payload);
            } else {
              if (!this.ephemeralMailbox.has(member)) {
                this.ephemeralMailbox.set(member, []);
              }
              this.ephemeralMailbox.get(member).push(payload);
            }
          });
        } else if (recipient) {
          const rec = recipient.toLowerCase();
          if (this.isUserOnline(rec)) {
            this.sendToUser(rec, payload);
          } else {
            if (!this.ephemeralMailbox.has(rec)) {
              this.ephemeralMailbox.set(rec, []);
            }
            this.ephemeralMailbox.get(rec).push(payload);
          }
        }
        break;
      }

      default:
        console.warn('Unknown message type:', type);
    }
  }
}

module.exports = new SignalingServer();
