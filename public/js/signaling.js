/**
 * MyCircle Networking, Signaling & WebRTC Client
 * Manages WebSocket connection, WebRTC P2P DataChannels,
 * Ephemeral Encrypted Relay, and Delivery Confirmations.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MyCircleSignaling = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  class SignalingManager {
    constructor() {
      this.ws = null;
      this.currentUser = null;
      this.token = null;
      this.isConnected = false;
      this.reconnectTimer = null;
      this.peerConnections = new Map(); // username -> RTCPeerConnection
      this.dataChannels = new Map();    // username -> RTCDataChannel
      this.listeners = new Map();
      this.iceServers = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ];
      this.onlineUsers = new Set();
    }

    on(event, callback) {
      if (!this.listeners.has(event)) {
        this.listeners.set(event, new Set());
      }
      this.listeners.get(event).add(callback);
    }

    off(event, callback) {
      if (this.listeners.has(event)) {
        this.listeners.get(event).delete(callback);
      }
    }

    emit(event, data) {
      if (this.listeners.has(event)) {
        for (const cb of this.listeners.get(event)) {
          try {
            cb(data);
          } catch (e) {
            console.error(`Error in event listener for ${event}:`, e);
          }
        }
      }
    }

    connect(user, token) {
      this.currentUser = user.toLowerCase();
      this.token = token;

      if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
        return;
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;

      try {
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          this.isConnected = true;
          this.emit('connection-change', { status: 'connected' });
          // Send auth packet
          this.send({
            type: 'auth',
            token: this.token
          });
        };

        this.ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            this.handleMessage(msg);
          } catch (err) {
            console.error('Error parsing WS message:', err);
          }
        };

        this.ws.onclose = () => {
          this.isConnected = false;
          this.emit('connection-change', { status: 'disconnected' });
          this.scheduleReconnect();
        };

        this.ws.onerror = (err) => {
          console.warn('WebSocket error:', err);
          this.emit('connection-change', { status: 'error' });
        };
      } catch (err) {
        console.error('WebSocket connection failed:', err);
        this.scheduleReconnect();
      }
    }

    scheduleReconnect() {
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => {
        if (this.currentUser && this.token) {
          this.connect(this.currentUser, this.token);
        }
      }, 3000);
    }

    disconnect() {
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
      this.closeAllPeerConnections();
      this.isConnected = false;
      this.onlineUsers.clear();
      this.emit('connection-change', { status: 'disconnected' });
    }

    send(msg) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(msg));
        return true;
      }
      return false;
    }

    // ----------------------------------------------------
    // Incoming Message Handler
    // ----------------------------------------------------
    async handleMessage(msg) {
      switch (msg.type) {
        case 'auth-success':
          this.emit('auth-success', msg);
          break;

        case 'auth-error':
          this.emit('auth-error', msg);
          break;

        case 'presence':
          if (msg.isOnline) {
            this.onlineUsers.add(msg.username.toLowerCase());
          } else {
            this.onlineUsers.delete(msg.username.toLowerCase());
          }
          this.emit('presence', msg);
          break;

        case 'encrypted-message':
          // Delivered via Ephemeral Relay
          this.emit('encrypted-message-received', msg.packet);
          break;

        case 'delivery-ack':
          this.emit('delivery-ack', msg);
          break;

        case 'relay-status':
          this.emit('relay-status', msg);
          break;

        case 'typing':
          this.emit('typing', msg);
          break;

        case 'group-encrypted-message':
          this.emit('group-encrypted-message-received', msg.packet);
          break;

        case 'group-rekey':
          this.emit('group-rekey-received', msg);
          break;

        // WebRTC Signaling messages
        case 'rtc-offer':
          await this.handleRtcOffer(msg.from, msg.data);
          break;

        case 'rtc-answer':
          await this.handleRtcAnswer(msg.from, msg.data);
          break;

        case 'rtc-ice-candidate':
          await this.handleRtcIceCandidate(msg.from, msg.data);
          break;

        default:
          console.log('Unhandled signaling message:', msg.type);
      }
    }

    // ----------------------------------------------------
    // WebRTC PeerConnection Management
    // ----------------------------------------------------
    getOrCreatePeerConnection(targetUsername) {
      const user = targetUsername.toLowerCase();
      if (this.peerConnections.has(user)) {
        return this.peerConnections.get(user);
      }

      const pc = new RTCPeerConnection({ iceServers: this.iceServers });

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          this.send({
            type: 'rtc-ice-candidate',
            sender: this.currentUser,
            target: user,
            data: event.candidate
          });
        }
      };

      pc.ondatachannel = (event) => {
        const channel = event.channel;
        this.setupDataChannel(user, channel);
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        this.emit('p2p-state-change', { user, state });
        if (state === 'failed' || state === 'closed' || state === 'disconnected') {
          this.cleanupPeer(user);
        }
      };

      this.peerConnections.set(user, pc);
      return pc;
    }

    setupDataChannel(user, channel) {
      channel.onopen = () => {
        this.dataChannels.set(user, channel);
        this.emit('p2p-connected', { user });
      };

      channel.onclose = () => {
        this.dataChannels.delete(user);
        this.emit('p2p-disconnected', { user });
      };

      channel.onmessage = (event) => {
        try {
          const packet = JSON.parse(event.data);
          this.emit('encrypted-message-received', packet);
        } catch (e) {
          console.error('Error parsing P2P data channel message:', e);
        }
      };
    }

    async initiateP2P(targetUsername) {
      const user = targetUsername.toLowerCase();
      const pc = this.getOrCreatePeerConnection(user);

      // Create DataChannel
      const dc = pc.createDataChannel('mycircle-e2ee', { ordered: true });
      this.setupDataChannel(user, dc);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      this.send({
        type: 'rtc-offer',
        sender: this.currentUser,
        target: user,
        data: offer
      });
    }

    async handleRtcOffer(sender, offer) {
      const user = sender.toLowerCase();
      const pc = this.getOrCreatePeerConnection(user);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      this.send({
        type: 'rtc-answer',
        sender: this.currentUser,
        target: user,
        data: answer
      });
    }

    async handleRtcAnswer(sender, answer) {
      const user = sender.toLowerCase();
      const pc = this.peerConnections.get(user);
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      }
    }

    async handleRtcIceCandidate(sender, candidate) {
      const user = sender.toLowerCase();
      const pc = this.peerConnections.get(user);
      if (pc && candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.warn('Error adding ICE candidate:', e);
        }
      }
    }

    cleanupPeer(user) {
      if (this.dataChannels.has(user)) {
        try { this.dataChannels.get(user).close(); } catch (e) {}
        this.dataChannels.delete(user);
      }
      if (this.peerConnections.has(user)) {
        try { this.peerConnections.get(user).close(); } catch (e) {}
        this.peerConnections.delete(user);
      }
    }

    closeAllPeerConnections() {
      for (const [user] of this.peerConnections) {
        this.cleanupPeer(user);
      }
    }

    // ----------------------------------------------------
    // Sending Encrypted Packets (Hybrid P2P & Ephemeral Relay)
    // ----------------------------------------------------
    async sendEncryptedPacket(packet) {
      const recipient = packet.recipient.toLowerCase();

      // Check if direct P2P DataChannel is open
      const dc = this.dataChannels.get(recipient);
      if (dc && dc.readyState === 'open') {
        try {
          dc.send(JSON.stringify(packet));
          // Sent directly via P2P
          return { method: 'p2p', status: 'sent' };
        } catch (e) {
          console.warn('Failed to send over WebRTC DC, falling back to relay:', e);
        }
      }

      // Fallback: Send encrypted ciphertext via server ephemeral relay
      if (!this.isConnected) {
        throw new Error('Network is offline. Message could not be sent.');
      }

      const sent = this.send({
        type: 'relay-encrypted-message',
        sender: this.currentUser,
        packet
      });

      if (!sent) {
        throw new Error('Connection error. Could not send message to relay.');
      }

      // Also trigger a background P2P connection attempt if peer is online
      if (this.onlineUsers.has(recipient) && !this.peerConnections.has(recipient)) {
        this.initiateP2P(recipient).catch(e => console.log('Background P2P init note:', e.message));
      }

      return { method: 'relay', status: 'sent' };
    }

    sendDeliveryAck(messageId, originalSender) {
      this.send({
        type: 'ack-delivery',
        sender: this.currentUser,
        originalSender: originalSender.toLowerCase(),
        messageId
      });
    }

    sendTyping(recipient, isTyping) {
      this.send({
        type: 'typing',
        sender: this.currentUser,
        recipient: recipient.toLowerCase(),
        isTyping: !!isTyping
      });
    }

    sendGroupEncryptedPacket(packet, memberList) {
      if (!this.isConnected) {
        throw new Error('Network is offline. Group message could not be sent.');
      }

      this.send({
        type: 'group-relay-message',
        sender: this.currentUser,
        packet,
        memberList
      });
    }

    sendGroupRekeyDistribution(groupId, epoch, keyDistributionList) {
      this.send({
        type: 'group-rekey-distribution',
        sender: this.currentUser,
        groupId,
        epoch,
        keyDistributionList
      });
    }

    isPeerOnline(username) {
      return this.onlineUsers.has(username.toLowerCase());
    }
  }

  return new SignalingManager();
});
