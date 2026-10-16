/**
 * MyCircle — Main Application Controller
 * Handles UI state, routing, real-time message sending/receiving,
 * WebRTC P2P coordination, modals, invitations, and local IndexedDB sync.
 */

(function () {
  'use strict';

  // State
  let currentAccount = null;
  let activeConversation = null;
  let typingTimeout = null;
  let isTyping = false;

  // DOM Elements
  const authView = document.getElementById('auth-view');
  const mainView = document.getElementById('main-view');
  const authError = document.getElementById('auth-error');

  const tabLogin = document.getElementById('tab-login');
  const tabSignup = document.getElementById('tab-signup');
  const formLogin = document.getElementById('form-login');
  const formSignup = document.getElementById('form-signup');

  const toggleLoginPin = document.getElementById('toggle-login-pin');
  const loginPinPanel = document.getElementById('login-pin-panel');
  const toggleSignupPin = document.getElementById('toggle-signup-pin');
  const signupPinPanel = document.getElementById('signup-pin-panel');

  const myStatusDot = document.getElementById('my-status-dot');
  const myDisplayName = document.getElementById('my-display-name');
  const myHandle = document.getElementById('my-handle');
  const networkPill = document.getElementById('network-pill');

  const convSearchInput = document.getElementById('conv-search-input');
  const conversationsContainer = document.getElementById('conversations-container');
  const sidebarEmpty = document.getElementById('sidebar-empty');

  const chatUnselected = document.getElementById('chat-unselected');
  const chatActive = document.getElementById('chat-active');
  const activeChatAvatar = document.getElementById('active-chat-avatar');
  const activeChatName = document.getElementById('active-chat-name');
  const activeStatusDot = document.getElementById('active-status-dot');
  const activeStatusText = document.getElementById('active-status-text');
  const btnMobileBack = document.getElementById('btn-mobile-back');
  const btnVerifySafety = document.getElementById('btn-verify-safety');
  const btnGroupManage = document.getElementById('btn-group-manage');

  const messagesScroll = document.getElementById('messages-scroll');
  const typingIndicator = document.getElementById('typing-indicator');
  const typingText = document.getElementById('typing-text');
  const messageInput = document.getElementById('message-input');
  const btnSendMessage = document.getElementById('btn-send-message');

  const toastContainer = document.getElementById('toast-container');

  // ==========================================================================
  // Toast Notification Helper
  // ==========================================================================
  function showToast(message, duration = 3000) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="16" x2="12" y2="12"></line>
        <line x1="12" y1="8" x2="12.01" y2="8"></line>
      </svg>
      <span>${escapeHTML(message)}</span>
    `;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.25s ease';
      setTimeout(() => toast.remove(), 250);
    }, duration);
  }

  function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }

  function formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  // ==========================================================================
  // Confirmation Dialog Helper
  // ==========================================================================
  let confirmCallback = null;
  function showConfirm(title, message, onConfirm) {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    confirmCallback = onConfirm;
    openModal('modal-confirm');
  }

  document.getElementById('btn-confirm-yes').addEventListener('click', () => {
    closeModal('modal-confirm');
    if (confirmCallback) {
      confirmCallback();
      confirmCallback = null;
    }
  });

  // ==========================================================================
  // Modal Helpers
  // ==========================================================================
  function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('open');
    }
  }

  function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('open');
    }
  }

  document.querySelectorAll('.modal-close-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.getAttribute('data-close');
      if (modalId) closeModal(modalId);
    });
  });

  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        backdrop.classList.remove('open');
      }
    });
  });

  // ==========================================================================
  // Authentication UI Handlers
  // ==========================================================================
  tabLogin.addEventListener('click', () => {
    tabLogin.classList.add('active');
    tabSignup.classList.remove('active');
    formLogin.style.display = 'flex';
    formSignup.style.display = 'none';
    hideAuthError();
  });

  tabSignup.addEventListener('click', () => {
    tabSignup.classList.add('active');
    tabLogin.classList.remove('active');
    formSignup.style.display = 'flex';
    formLogin.style.display = 'none';
    hideAuthError();
  });

  toggleLoginPin.addEventListener('click', () => {
    loginPinPanel.classList.toggle('open');
  });

  toggleSignupPin.addEventListener('click', () => {
    signupPinPanel.classList.toggle('open');
  });

  function showAuthError(msg) {
    authError.textContent = msg;
    authError.classList.add('visible');
  }

  function hideAuthError() {
    authError.textContent = '';
    authError.classList.remove('visible');
  }

  // Passkey Login
  formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAuthError();
    const username = document.getElementById('login-username').value.trim();
    const btn = document.getElementById('btn-login-passkey');
    btn.disabled = true;
    btn.textContent = 'Verifying Passkey...';

    try {
      const account = await window.MyCircleAuth.loginWithPasskey(username);
      onAuthSuccess(account);
    } catch (err) {
      showAuthError(err.message);
      loginPinPanel.classList.add('open');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 0 0 8 11a4 4 0 1 1 8 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0 0 15.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 0 0 4 11m0 0a8 8 0 0 0 .528 2.86"></path>
        </svg>
        Sign In with Passkey
      `;
    }
  });

  // Fallback PIN Login
  document.getElementById('btn-login-pin').addEventListener('click', async () => {
    hideAuthError();
    const username = document.getElementById('login-username').value.trim();
    const pin = document.getElementById('login-pin').value.trim();
    if (!username) return showAuthError('Please enter your username');
    if (!pin) return showAuthError('Please enter your device PIN');

    try {
      const account = await window.MyCircleAuth.loginFallback(username, pin);
      onAuthSuccess(account);
    } catch (err) {
      showAuthError(err.message);
    }
  });

  // Passkey Signup
  formSignup.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAuthError();
    const username = document.getElementById('signup-username').value.trim();
    const displayName = document.getElementById('signup-displayname').value.trim() || username;
    const btn = document.getElementById('btn-signup-passkey');
    btn.disabled = true;
    btn.textContent = 'Creating Passkey...';

    try {
      const account = await window.MyCircleAuth.registerWithPasskey(username, displayName);
      onAuthSuccess(account);
    } catch (err) {
      showAuthError(err.message);
      signupPinPanel.classList.add('open');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 0 0 8 11a4 4 0 1 1 8 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0 0 15.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 0 0 4 11m0 0a8 8 0 0 0 .528 2.86"></path>
        </svg>
        Create Account with Passkey
      `;
    }
  });

  // Fallback PIN Signup
  document.getElementById('btn-signup-pin').addEventListener('click', async () => {
    hideAuthError();
    const username = document.getElementById('signup-username').value.trim();
    const displayName = document.getElementById('signup-displayname').value.trim() || username;
    const pin = document.getElementById('signup-pin').value.trim();
    if (!username) return showAuthError('Please choose a username');
    if (!pin || pin.length < 4) return showAuthError('Please enter a PIN with at least 4 digits');

    try {
      const account = await window.MyCircleAuth.registerFallback(username, displayName, pin);
      onAuthSuccess(account);
    } catch (err) {
      showAuthError(err.message);
    }
  });

  // ==========================================================================
  // Session / Logged In State Transitions
  // ==========================================================================
  async function onAuthSuccess(account) {
    currentAccount = account;
    authView.style.display = 'none';
    mainView.style.display = 'flex';

    // Update Top/Sidebar User Bar
    myDisplayName.textContent = account.displayName || account.username;
    myHandle.textContent = `@${account.username}`;

    // Update Settings Modal Labels
    document.getElementById('settings-username-label').textContent = `@${account.username}`;
    document.getElementById('settings-display-label').textContent = account.displayName || account.username;
    document.getElementById('settings-fingerprint').textContent = account.fingerprint || 'Pending key generation';
    document.getElementById('settings-auth-badge').textContent = account.authMethod === 'passkey' ? 'Passkey Verified' : 'Device PIN';

    // Connect WebSocket Signaling
    window.MyCircleSignaling.connect(account.username, account.sessionToken);

    // Load Conversations List
    await loadConversations();

    // Check if URL has invite params
    checkInviteUrl();

    showToast(`Welcome back, ${account.displayName || account.username}!`);
  }

  // ==========================================================================
  // Signaling & Real-Time Event Listeners
  // ==========================================================================
  window.MyCircleSignaling.on('connection-change', ({ status }) => {
    if (status === 'connected') {
      myStatusDot.className = 'status-dot online';
      networkPill.textContent = 'Connected (E2EE Active)';
      networkPill.style.color = 'var(--color-online)';
    } else {
      myStatusDot.className = 'status-dot';
      networkPill.textContent = 'Offline (Local Only)';
      networkPill.style.color = 'var(--text-muted)';
    }
  });

  window.MyCircleSignaling.on('presence', ({ username, isOnline }) => {
    // Update active conversation presence if this peer matches
    if (activeConversation && activeConversation.peerUsername && activeConversation.peerUsername.toLowerCase() === username.toLowerCase()) {
      activeStatusDot.className = isOnline ? 'status-dot online' : 'status-dot';
      activeStatusText.textContent = isOnline ? 'Online • End-to-End Encrypted' : 'Offline • Local IndexedDB';
    }
    // Update presence dot in conversation list
    loadConversations();
  });

  window.MyCircleSignaling.on('typing', ({ sender, isTyping }) => {
    if (activeConversation && activeConversation.peerUsername && activeConversation.peerUsername.toLowerCase() === sender.toLowerCase()) {
      if (isTyping) {
        typingText.textContent = `@${sender} is typing...`;
        typingIndicator.classList.add('visible');
      } else {
        typingIndicator.classList.remove('visible');
      }
    }
  });

  // Handle Incoming Direct Encrypted Message
  window.MyCircleSignaling.on('encrypted-message-received', async (packet) => {
    try {
      const sender = packet.sender.toLowerCase();
      // Ensure sender contact exists
      let contact = await window.MyCircleStorage.getContact(sender);
      if (!contact) {
        // Fetch public keys from directory
        const res = await fetch(`/api/auth/users/${sender}`);
        if (res.ok) {
          const data = await res.json();
          if (data.user) {
            contact = data.user;
            await window.MyCircleStorage.saveContact(contact);
          }
        }
      }

      if (!contact || !contact.ecdhPublicKey || !contact.ecdsaPublicKey) {
        console.error(`Missing public keys for sender @${sender}`);
        return;
      }

      // 1. Derive pairwise key
      const localPriv = await window.MyCircleCrypto.importECDHPrivateKey(currentAccount.jwk.ecdhPrivate);
      const remotePub = await window.MyCircleCrypto.importECDHPublicKey(contact.ecdhPublicKey);
      const sharedKey = await window.MyCircleCrypto.derivePairwiseKey(localPriv, remotePub);

      // 2. Decrypt & verify digital signature
      const senderEcdsaPub = await window.MyCircleCrypto.importECDSAPublicKey(contact.ecdsaPublicKey);
      const decrypted = await window.MyCircleCrypto.decryptDirectMessage(sharedKey, senderEcdsaPub, packet.iv, packet.ciphertext);

      const convId = `direct:${sender}`;

      // 3. Ensure conversation exists
      let conv = await window.MyCircleStorage.getConversation(convId);
      if (!conv) {
        conv = {
          id: convId,
          type: 'direct',
          name: contact.displayName || sender,
          peerUsername: sender,
          unreadCount: 0,
          updatedAt: Date.now()
        };
        await window.MyCircleStorage.saveConversation(conv);
      }

      // 4. Save message to IndexedDB
      const msgRecord = {
        id: packet.id || ('msg_' + Date.now()),
        conversationId: convId,
        sender,
        senderName: contact.displayName || sender,
        recipient: currentAccount.username,
        content: decrypted.payload.content,
        timestamp: packet.timestamp || Date.now(),
        status: 'delivered',
        isOutgoing: false,
        isVerified: decrypted.isVerified
      };

      await window.MyCircleStorage.saveMessage(msgRecord);

      // 5. Send Delivery ACK back to sender
      window.MyCircleSignaling.sendDeliveryAck(msgRecord.id, sender);

      // 6. Update UI
      if (activeConversation && activeConversation.id === convId) {
        appendMessageBubble(msgRecord);
        scrollToBottom();
      }

      await loadConversations();
    } catch (err) {
      console.error('Error handling direct message:', err);
    }
  });

  // Handle Incoming Group Encrypted Message
  window.MyCircleSignaling.on('group-encrypted-message-received', async (packet) => {
    try {
      const decrypted = await window.MyCircleGroupCrypto.decryptGroupMessage(packet, currentAccount);
      const convId = `group:${packet.groupId}`;

      let conv = await window.MyCircleStorage.getConversation(convId);
      if (!conv) {
        conv = {
          id: convId,
          type: 'group',
          groupId: packet.groupId,
          name: 'Circle Group',
          members: [packet.sender, currentAccount.username],
          unreadCount: 0,
          updatedAt: Date.now()
        };
        await window.MyCircleStorage.saveConversation(conv);
      }

      const msgRecord = {
        id: packet.id,
        conversationId: convId,
        groupId: packet.groupId,
        epoch: packet.epoch,
        sender: packet.sender,
        senderName: packet.senderName || packet.sender,
        content: decrypted.payload.content,
        timestamp: packet.timestamp || Date.now(),
        status: 'delivered',
        isOutgoing: false,
        isVerified: decrypted.isVerified
      };

      await window.MyCircleStorage.saveMessage(msgRecord);

      if (activeConversation && activeConversation.id === convId) {
        appendMessageBubble(msgRecord);
        scrollToBottom();
      }

      await loadConversations();
    } catch (err) {
      console.warn('Failed to decrypt group message (Key may have rotated):', err.message);
    }
  });

  // Handle Group Rekey Packet
  window.MyCircleSignaling.on('group-rekey-received', async (packet) => {
    try {
      await window.MyCircleGroupCrypto.handleGroupRekeyPacket(packet, currentAccount);
      showToast(`Group encryption key updated to Epoch ${packet.epoch}`);
      if (activeConversation && activeConversation.groupId === packet.groupId) {
        document.getElementById('group-epoch-display').textContent = `Epoch: ${packet.epoch}`;
      }
    } catch (err) {
      console.error('Error handling group rekey:', err);
    }
  });

  // Handle Delivery ACK
  window.MyCircleSignaling.on('delivery-ack', async ({ messageId }) => {
    await window.MyCircleStorage.updateMessageStatus(messageId, 'delivered');
    // Update tick icon in DOM if open
    const tickEl = document.getElementById(`tick-${messageId}`);
    if (tickEl) {
      tickEl.className = 'delivery-tick delivered';
      tickEl.innerHTML = '✓✓';
      tickEl.title = 'Delivered to recipient device';
    }
    await loadConversations();
  });

  // Handle Relay Status
  window.MyCircleSignaling.on('relay-status', async ({ messageId, status }) => {
    await window.MyCircleStorage.updateMessageStatus(messageId, status);
    const tickEl = document.getElementById(`tick-${messageId}`);
    if (tickEl && !tickEl.classList.contains('delivered')) {
      tickEl.innerHTML = '✓';
      tickEl.title = 'Sent to relay';
    }
  });

  // ==========================================================================
  // Conversations List & Thread Management
  // ==========================================================================
  async function loadConversations(filterQuery = '') {
    const list = await window.MyCircleStorage.getAllConversations();
    conversationsContainer.innerHTML = '';

    const query = filterQuery.toLowerCase().trim();
    const filtered = list.filter(c => !query || c.name.toLowerCase().includes(query) || (c.peerUsername && c.peerUsername.toLowerCase().includes(query)));

    if (filtered.length === 0) {
      sidebarEmpty.style.display = 'flex';
      return;
    }

    sidebarEmpty.style.display = 'none';

    filtered.forEach(conv => {
      const item = document.createElement('div');
      item.className = 'conversation-item';
      if (activeConversation && activeConversation.id === conv.id) {
        item.classList.add('active');
      }

      const isGroup = conv.type === 'group';
      const isOnline = !isGroup && window.MyCircleSignaling.isPeerOnline(conv.peerUsername || '');

      const initial = (conv.name || conv.peerUsername || '?').charAt(0).toUpperCase();

      let lastText = 'No messages yet';
      let lastTime = '';
      let tick = '';

      if (conv.lastMessage) {
        lastText = escapeHTML(conv.lastMessage.content);
        lastTime = formatTime(conv.lastMessage.timestamp);
        if (conv.lastMessage.sender === currentAccount.username) {
          tick = conv.lastMessage.status === 'delivered' ? '<span style="color: #52B788;">✓✓</span> ' : '<span>✓</span> ';
        }
      }

      item.innerHTML = `
        <div class="conv-avatar-wrapper">
          <div class="avatar ${isGroup ? 'group' : ''}">${initial}</div>
          ${!isGroup ? `<div class="avatar-status-badge ${isOnline ? 'online' : ''}"></div>` : ''}
        </div>
        <div class="conv-content">
          <div class="conv-top-row">
            <span class="conv-name">${escapeHTML(conv.name)}</span>
            <span class="conv-time">${lastTime}</span>
          </div>
          <div class="conv-bottom-row">
            <span class="conv-preview">${tick}${lastText}</span>
            ${conv.unreadCount > 0 ? `<span class="unread-badge">${conv.unreadCount}</span>` : ''}
          </div>
        </div>
      `;

      item.addEventListener('click', () => {
        openConversation(conv);
      });

      conversationsContainer.appendChild(item);
    });
  }

  convSearchInput.addEventListener('input', (e) => {
    loadConversations(e.target.value);
  });

  // Open Conversation
  async function openConversation(conv) {
    activeConversation = conv;

    // Reset unread count
    conv.unreadCount = 0;
    await window.MyCircleStorage.saveConversation(conv);

    // Responsive Mobile layout: slide in chat pane
    document.querySelector('.app-layout').classList.add('conversation-open');

    // Toggle views
    chatUnselected.style.display = 'none';
    chatActive.classList.add('visible');

    // Header info
    const isGroup = conv.type === 'group';
    const initial = (conv.name || conv.peerUsername || '?').charAt(0).toUpperCase();
    activeChatAvatar.textContent = initial;
    activeChatAvatar.className = `avatar ${isGroup ? 'group' : ''}`;
    activeChatName.textContent = conv.name;

    if (isGroup) {
      activeStatusDot.style.display = 'none';
      activeStatusText.textContent = `${conv.members.length} members • Epoch ${conv.epoch || 1}`;
      btnGroupManage.style.display = 'flex';
      btnVerifySafety.style.display = 'none';
    } else {
      activeStatusDot.style.display = 'inline-block';
      const isOnline = window.MyCircleSignaling.isPeerOnline(conv.peerUsername || '');
      activeStatusDot.className = isOnline ? 'status-dot online' : 'status-dot';
      activeStatusText.textContent = isOnline ? 'Online • End-to-End Encrypted' : 'Offline • Local IndexedDB';
      btnGroupManage.style.display = 'none';
      btnVerifySafety.style.display = 'flex';

      // Attempt P2P DataChannel connection in background
      if (isOnline) {
        window.MyCircleSignaling.initiateP2P(conv.peerUsername).catch(e => console.log('P2P connection note:', e.message));
      }
    }

    // Load Messages
    await loadMessages(conv.id);

    // Refresh conversation list to highlight active item
    await loadConversations(convSearchInput.value);

    // Focus input
    messageInput.focus();
  }

  // Mobile Back Button: return to sidebar
  btnMobileBack.addEventListener('click', () => {
    document.querySelector('.app-layout').classList.remove('conversation-open');
  });

  // ==========================================================================
  // Messages Area & Bubble Rendering
  // ==========================================================================
  async function loadMessages(conversationId) {
    messagesScroll.innerHTML = '';
    const messages = await window.MyCircleStorage.getMessages(conversationId);

    let lastDate = null;
    messages.forEach(msg => {
      const msgDate = new Date(msg.timestamp).toDateString();
      if (msgDate !== lastDate) {
        lastDate = msgDate;
        const divider = document.createElement('div');
        divider.className = 'date-divider';
        divider.innerHTML = `<span>${formatDateDivider(msg.timestamp)}</span>`;
        messagesScroll.appendChild(divider);
      }
      appendMessageBubble(msg, false);
    });

    scrollToBottom();
  }

  function formatDateDivider(timestamp) {
    const d = new Date(timestamp);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Today';
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function appendMessageBubble(msg, shouldScroll = true) {
    if (msg.isSystem) {
      const sysEl = document.createElement('div');
      sysEl.className = 'system-message';
      sysEl.textContent = msg.content;
      messagesScroll.appendChild(sysEl);
      if (shouldScroll) scrollToBottom();
      return;
    }

    const row = document.createElement('div');
    row.className = `message-row ${msg.isOutgoing ? 'outgoing' : 'incoming'}`;
    row.id = `bubble-${msg.id}`;

    let tickHtml = '';
    if (msg.isOutgoing) {
      if (msg.status === 'delivered') {
        tickHtml = `<span id="tick-${msg.id}" class="delivery-tick delivered" title="Delivered to recipient device">✓✓</span>`;
      } else if (msg.status === 'sent') {
        tickHtml = `<span id="tick-${msg.id}" class="delivery-tick" title="Sent to relay">✓</span>`;
      } else if (msg.status === 'failed') {
        tickHtml = `<span id="tick-${msg.id}" class="delivery-tick failed" title="Delivery failed">⚠️</span>`;
      } else {
        tickHtml = `<span id="tick-${msg.id}" class="delivery-tick" title="Sending...">⏳</span>`;
      }
    }

    const isGroup = activeConversation && activeConversation.type === 'group';
    const senderTag = (!msg.isOutgoing && isGroup)
      ? `<span class="message-sender-tag">${escapeHTML(msg.senderName || msg.sender)}</span>`
      : '';

    row.innerHTML = `
      ${senderTag}
      <div class="message-bubble">
        <div class="message-text">${escapeHTML(msg.content)}</div>
        <div class="message-meta">
          <span>${formatTime(msg.timestamp)}</span>
          ${tickHtml}
        </div>
      </div>
      ${msg.status === 'failed' ? `<div class="message-failed-action" onclick="window.retryMessage('${msg.id}')">Failed. Tap to retry</div>` : ''}
    `;

    messagesScroll.appendChild(row);
    if (shouldScroll) scrollToBottom();
  }

  function scrollToBottom() {
    messagesScroll.scrollTop = messagesScroll.scrollHeight;
  }

  // ==========================================================================
  // Sending Messages
  // ==========================================================================
  async function sendMessage() {
    if (!activeConversation) return;
    const text = messageInput.value.trim();
    if (!text) return;

    messageInput.value = '';
    btnSendMessage.disabled = true;

    const messageId = 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const timestamp = Date.now();
    const isGroup = activeConversation.type === 'group';

    // Create local message record
    const msgRecord = {
      id: messageId,
      conversationId: activeConversation.id,
      sender: currentAccount.username,
      senderName: currentAccount.displayName || currentAccount.username,
      recipient: isGroup ? activeConversation.groupId : activeConversation.peerUsername,
      content: text,
      timestamp,
      status: 'sending',
      isOutgoing: true
    };

    // Save immediately to local IndexedDB
    await window.MyCircleStorage.saveMessage(msgRecord);
    appendMessageBubble(msgRecord);
    await loadConversations();

    try {
      if (isGroup) {
        // Group Encryption
        const groupPacket = await window.MyCircleGroupCrypto.encryptGroupMessage(
          activeConversation.groupId,
          text,
          currentAccount
        );

        window.MyCircleSignaling.sendGroupEncryptedPacket(groupPacket, activeConversation.members);
        await window.MyCircleStorage.updateMessageStatus(messageId, 'sent');
      } else {
        // One-to-One E2EE
        const peer = activeConversation.peerUsername.toLowerCase();
        let contact = await window.MyCircleStorage.getContact(peer);
        if (!contact || !contact.ecdhPublicKey) {
          // Fetch public key from directory
          const res = await fetch(`/api/auth/users/${peer}`);
          if (res.ok) {
            const data = await res.json();
            if (data.user) {
              contact = data.user;
              await window.MyCircleStorage.saveContact(contact);
            }
          }
        }

        if (!contact || !contact.ecdhPublicKey) {
          throw new Error(`Unable to fetch encryption key for @${peer}`);
        }

        // Derive pairwise AES-GCM shared key
        const localPriv = await window.MyCircleCrypto.importECDHPrivateKey(currentAccount.jwk.ecdhPrivate);
        const remotePub = await window.MyCircleCrypto.importECDHPublicKey(contact.ecdhPublicKey);
        const sharedKey = await window.MyCircleCrypto.derivePairwiseKey(localPriv, remotePub);

        // Sign & Encrypt
        const ecdsaPriv = await window.MyCircleCrypto.importECDSAPrivateKey(currentAccount.jwk.ecdsaPrivate);
        const encrypted = await window.MyCircleCrypto.encryptDirectMessage(sharedKey, ecdsaPriv, {
          id: messageId,
          sender: currentAccount.username,
          recipient: peer,
          content: text,
          timestamp
        });

        const packet = {
          id: messageId,
          recipient: peer,
          sender: currentAccount.username,
          iv: encrypted.iv,
          ciphertext: encrypted.ciphertext,
          timestamp
        };

        // Send via hybrid P2P DataChannel / Ephemeral Relay
        await window.MyCircleSignaling.sendEncryptedPacket(packet);
        await window.MyCircleStorage.updateMessageStatus(messageId, 'sent');
      }
    } catch (err) {
      console.error('Failed to send message:', err);
      await window.MyCircleStorage.updateMessageStatus(messageId, 'failed');
      showToast(err.message || 'Message delivery failed. Tap to retry.');
    } finally {
      btnSendMessage.disabled = false;
      // Reload active message bubble status
      await loadMessages(activeConversation.id);
      await loadConversations();
    }
  }

  btnSendMessage.addEventListener('click', sendMessage);
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Typing state dispatch
  messageInput.addEventListener('input', () => {
    if (!activeConversation || activeConversation.type === 'group') return;
    if (!isTyping) {
      isTyping = true;
      window.MyCircleSignaling.sendTyping(activeConversation.peerUsername, true);
    }
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      isTyping = false;
      window.MyCircleSignaling.sendTyping(activeConversation.peerUsername, false);
    }, 1800);
  });

  // Global Retry Message Handler
  window.retryMessage = async function (msgId) {
    const messages = await window.MyCircleStorage.getMessages(activeConversation.id);
    const msg = messages.find(m => m.id === msgId);
    if (!msg) return;

    messageInput.value = msg.content;
    // Delete failed record and resend
    await window.MyCircleStorage.updateMessageStatus(msgId, 'sending');
    sendMessage();
  };

  // ==========================================================================
  // New Chat & User Search Modal
  // ==========================================================================
  document.getElementById('btn-open-search').addEventListener('click', () => {
    openModal('modal-search');
    document.getElementById('user-search-field').focus();
    searchUsers('');
  });

  document.getElementById('btn-empty-start-chat').addEventListener('click', () => {
    openModal('modal-search');
    searchUsers('');
  });

  document.getElementById('btn-empty-search-top').addEventListener('click', () => {
    openModal('modal-search');
    searchUsers('');
  });

  let searchDebounce = null;
  document.getElementById('user-search-field').addEventListener('input', (e) => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      searchUsers(e.target.value);
    }, 250);
  });

  async function searchUsers(query) {
    const listEl = document.getElementById('search-results-list');
    listEl.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem; padding: 0.5rem;">Searching users...</div>';

    try {
      const res = await fetch(`/api/auth/users/search?q=${encodeURIComponent(query)}&exclude=${encodeURIComponent(currentAccount.username)}`);
      const data = await res.json();
      const users = data.users || [];

      if (users.length === 0) {
        listEl.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem; padding: 0.5rem;">No matching users found.</div>';
        return;
      }

      listEl.innerHTML = '';
      users.forEach(u => {
        const item = document.createElement('div');
        item.className = 'conversation-item';
        item.style.padding = '0.65rem 0.75rem';
        item.innerHTML = `
          <div class="conv-avatar-wrapper">
            <div class="avatar">${u.displayName.charAt(0).toUpperCase()}</div>
            <div class="avatar-status-badge ${u.isOnline ? 'online' : ''}"></div>
          </div>
          <div class="conv-content">
            <div class="conv-top-row">
              <span class="conv-name">${escapeHTML(u.displayName)}</span>
              <span style="font-size: 0.75rem; color: var(--text-muted);">@${escapeHTML(u.username)}</span>
            </div>
            <div class="conv-bottom-row">
              <span style="font-size: 0.75rem; font-family: var(--font-mono); color: var(--brand-secondary);">
                Fingerprint: ${u.fingerprint ? u.fingerprint.slice(0, 10) + '...' : 'Available'}
              </span>
            </div>
          </div>
        `;

        item.addEventListener('click', async () => {
          closeModal('modal-search');
          // Save contact to IndexedDB
          await window.MyCircleStorage.saveContact(u);

          // Create or retrieve conversation
          const convId = `direct:${u.username.toLowerCase()}`;
          let conv = await window.MyCircleStorage.getConversation(convId);
          if (!conv) {
            conv = {
              id: convId,
              type: 'direct',
              name: u.displayName || u.username,
              peerUsername: u.username.toLowerCase(),
              unreadCount: 0,
              updatedAt: Date.now()
            };
            await window.MyCircleStorage.saveConversation(conv);
          }

          openConversation(conv);
        });

        listEl.appendChild(item);
      });
    } catch (err) {
      listEl.innerHTML = `<div style="color: var(--color-danger); font-size: 0.85rem;">Error: ${err.message}</div>`;
    }
  }

  // ==========================================================================
  // New Group Modal
  // ==========================================================================
  document.getElementById('btn-open-new-group').addEventListener('click', async () => {
    openModal('modal-new-group');
    document.getElementById('group-name-input').value = '';
    const picker = document.getElementById('group-members-picker');
    picker.innerHTML = '';

    const contacts = await window.MyCircleStorage.getAllContacts();
    if (contacts.length === 0) {
      picker.innerHTML = '<p style="font-size: 0.82rem; color: var(--text-muted);">No contacts saved yet. Find users first to add them to a circle.</p>';
      return;
    }

    contacts.forEach(c => {
      const label = document.createElement('label');
      label.className = 'settings-item';
      label.style.cursor = 'pointer';
      label.innerHTML = `
        <div style="display: flex; align-items: center; gap: 0.6rem;">
          <div class="avatar" style="width: 32px; height: 32px; font-size: 0.85rem;">${c.displayName.charAt(0).toUpperCase()}</div>
          <div>
            <div style="font-size: 0.88rem; font-weight: 600;">${escapeHTML(c.displayName)}</div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">@${escapeHTML(c.username)}</div>
          </div>
        </div>
        <input type="checkbox" name="group-member" value="${escapeHTML(c.username)}" style="width: 18px; height: 18px; accent-color: var(--brand-primary);">
      `;
      picker.appendChild(label);
    });
  });

  document.getElementById('btn-create-group-confirm').addEventListener('click', async () => {
    const name = document.getElementById('group-name-input').value.trim();
    if (!name) return showToast('Please enter a circle name');

    const checkedBoxes = Array.from(document.querySelectorAll('input[name="group-member"]:checked'));
    const members = checkedBoxes.map(b => b.value);

    try {
      const conv = await window.MyCircleGroupCrypto.createGroup(name, members, currentAccount);
      closeModal('modal-new-group');
      showToast(`Circle "${name}" created with Epoch 1 key!`);
      await loadConversations();
      openConversation(conv);
    } catch (err) {
      showToast(err.message || 'Failed to create group');
    }
  });

  // ==========================================================================
  // Group Info & Member Management (Key Rotation)
  // ==========================================================================
  btnGroupManage.addEventListener('click', async () => {
    if (!activeConversation || activeConversation.type !== 'group') return;
    openModal('modal-group-info');
    document.getElementById('group-info-title').textContent = activeConversation.name;
    document.getElementById('group-epoch-display').textContent = `Epoch: ${activeConversation.epoch || 1} • AES-256-GCM Active`;

    renderGroupMembersList();
  });

  function renderGroupMembersList() {
    const listEl = document.getElementById('group-members-list');
    listEl.innerHTML = '';

    const isAdmin = activeConversation.admin === currentAccount.username;

    activeConversation.members.forEach(member => {
      const isSelf = member.toLowerCase() === currentAccount.username.toLowerCase();
      const row = document.createElement('div');
      row.className = 'settings-item';
      row.innerHTML = `
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <span style="font-size: 0.88rem; font-weight: 600;">@${escapeHTML(member)}</span>
          ${member === activeConversation.admin ? '<span class="auth-e2e-badge" style="font-size: 0.68rem; padding: 0.15rem 0.4rem;">Admin</span>' : ''}
          ${isSelf ? '<span style="font-size: 0.75rem; color: var(--text-muted);">(You)</span>' : ''}
        </div>
        ${(isAdmin && !isSelf) ? `
          <button type="button" class="btn-secondary btn-remove-member" data-member="${escapeHTML(member)}" style="width: auto; padding: 0.35rem 0.7rem; font-size: 0.78rem; color: var(--color-danger); border-color: rgba(192, 57, 43, 0.3);">
            Remove & Rekey
          </button>
        ` : ''}
      `;

      listEl.appendChild(row);
    });

    // Add remove listeners
    listEl.querySelectorAll('.btn-remove-member').forEach(btn => {
      btn.addEventListener('click', () => {
        const member = btn.getAttribute('data-member');
        showConfirm(
          'Remove Member & Rotate Keys',
          `Are you sure you want to remove @${member}? This will rotate the group encryption key. @${member} will be permanently blocked from decrypting future messages.`,
          async () => {
            try {
              const updatedConv = await window.MyCircleGroupCrypto.rotateGroupKeyOnMemberRemoval(
                activeConversation.groupId,
                member,
                currentAccount
              );
              activeConversation = updatedConv;
              document.getElementById('group-epoch-display').textContent = `Epoch: ${updatedConv.epoch} • AES-256-GCM Rotated`;
              renderGroupMembersList();
              await loadMessages(activeConversation.id);
              await loadConversations();
              showToast(`@${member} removed. Encryption key rotated to Epoch ${updatedConv.epoch}!`);
            } catch (err) {
              showToast(err.message || 'Failed to remove member');
            }
          }
        );
      });
    });
  }

  // Add Member to Group
  document.getElementById('btn-add-member-submit').addEventListener('click', async () => {
    const input = document.getElementById('add-member-username');
    const member = input.value.trim().toLowerCase();
    if (!member) return showToast('Please enter a username');

    if (activeConversation.members.map(m => m.toLowerCase()).includes(member)) {
      return showToast(`@${member} is already in this circle`);
    }

    try {
      // Ensure member contact exists
      let contact = await window.MyCircleStorage.getContact(member);
      if (!contact) {
        const res = await fetch(`/api/auth/users/${member}`);
        if (!res.ok) throw new Error(`User @${member} not found`);
        const data = await res.json();
        contact = data.user;
        await window.MyCircleStorage.saveContact(contact);
      }

      // Add member to group conversation
      activeConversation.members.push(member);
      await window.MyCircleStorage.saveConversation(activeConversation);

      // Distribute active epoch key to new member
      const epoch = activeConversation.epoch || 1;
      const keyRecord = await window.MyCircleStorage.getGroupKey(activeConversation.groupId, epoch);
      if (keyRecord) {
        const localPriv = await window.MyCircleCrypto.importECDHPrivateKey(currentAccount.jwk.ecdhPrivate);
        const remotePub = await window.MyCircleCrypto.importECDHPublicKey(contact.ecdhPublicKey);
        const pairwiseKey = await window.MyCircleCrypto.derivePairwiseKey(localPriv, remotePub);

        const encKeyPacket = await window.MyCircleCrypto.encryptGroupKeyForMember(
          pairwiseKey,
          keyRecord.rawGroupKey,
          activeConversation.groupId,
          epoch
        );

        window.MyCircleSignaling.sendGroupRekeyDistribution(activeConversation.groupId, epoch, [
          { recipient: member, encryptedKeyPacket: encKeyPacket }
        ]);
      }

      input.value = '';
      renderGroupMembersList();
      showToast(`@${member} added to the circle!`);
    } catch (err) {
      showToast(err.message || 'Failed to add member');
    }
  });

  // Leave Group
  document.getElementById('btn-leave-group').addEventListener('click', () => {
    showConfirm('Leave Circle', 'Are you sure you want to leave this circle? You will no longer receive new messages.', async () => {
      closeModal('modal-group-info');
      await window.MyCircleStorage.deleteConversation(activeConversation.id);
      activeConversation = null;
      chatActive.classList.remove('visible');
      chatUnselected.style.display = 'flex';
      document.querySelector('.app-layout').classList.remove('conversation-open');
      await loadConversations();
      showToast('You left the circle');
    });
  });

  // ==========================================================================
  // Invite Friends & QR Code
  // ==========================================================================
  document.getElementById('btn-open-invite').addEventListener('click', showInviteModal);
  document.getElementById('btn-empty-invite').addEventListener('click', showInviteModal);

  async function showInviteModal() {
    openModal('modal-invite');
    document.getElementById('invite-qr-user-label').textContent = `@${currentAccount.username}`;

    const inviteUrl = `${window.location.origin}/?invite=${encodeURIComponent(currentAccount.username)}&key=${encodeURIComponent(currentAccount.fingerprint || '')}`;
    document.getElementById('invite-link-text').textContent = inviteUrl;

    // Render Canvas QR Code
    const canvas = document.getElementById('invite-qr-canvas');
    if (window.QRCode && canvas) {
      try {
        await window.QRCode.toCanvas(canvas, inviteUrl, {
          width: 200,
          margin: 2,
          color: {
            dark: '#1B4332',
            light: '#FFFFFF'
          }
        });
      } catch (err) {
        console.error('QR code generation error:', err);
      }
    }
  }

  // Copy Invite Link
  document.getElementById('btn-copy-invite').addEventListener('click', async () => {
    const inviteUrl = document.getElementById('invite-link-text').textContent;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      showToast('Invite link copied to clipboard!');
    } catch (err) {
      showToast('Could not copy automatically. Please select and copy text.');
    }
  });

  // Native Web Share API
  document.getElementById('btn-share-native').addEventListener('click', async () => {
    const inviteUrl = document.getElementById('invite-link-text').textContent;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'MyCircle — Private Messaging',
          text: `Connect with me on MyCircle for secure, end-to-end encrypted private messaging!`,
          url: inviteUrl
        });
      } catch (err) {
        console.log('Share dismissed');
      }
    } else {
      await navigator.clipboard.writeText(inviteUrl);
      showToast('Share link copied to clipboard!');
    }
  });

  // Check if current URL contains an invite parameter
  async function checkInviteUrl() {
    const params = new URLSearchParams(window.location.search);
    const inviteUser = params.get('invite');
    if (inviteUser && currentAccount && inviteUser.toLowerCase() !== currentAccount.username.toLowerCase()) {
      try {
        const res = await fetch(`/api/auth/users/${encodeURIComponent(inviteUser)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.user) {
            await window.MyCircleStorage.saveContact(data.user);

            const convId = `direct:${data.user.username.toLowerCase()}`;
            let conv = await window.MyCircleStorage.getConversation(convId);
            if (!conv) {
              conv = {
                id: convId,
                type: 'direct',
                name: data.user.displayName || data.user.username,
                peerUsername: data.user.username.toLowerCase(),
                unreadCount: 0,
                updatedAt: Date.now()
              };
              await window.MyCircleStorage.saveConversation(conv);
            }

            openConversation(conv);
            showToast(`Connected with @${data.user.username}!`);

            // Clean URL parameter without reloading
            window.history.replaceState({}, document.title, window.location.pathname);
          }
        }
      } catch (err) {
        console.error('Error accepting invite URL:', err);
      }
    }
  }

  // ==========================================================================
  // Safety Numbers Verification Modal
  // ==========================================================================
  btnVerifySafety.addEventListener('click', async () => {
    if (!activeConversation || activeConversation.type === 'group') return;
    openModal('modal-safety');

    const peer = activeConversation.peerUsername.toLowerCase();
    const contact = await window.MyCircleStorage.getContact(peer);
    if (!contact || !contact.ecdhPublicKey) {
      showToast('Public keys not yet exchanged for this contact.');
      return;
    }

    const safety = await window.MyCircleCrypto.generateSafetyNumbers(
      currentAccount.jwk.ecdhPublic,
      contact.ecdhPublicKey
    );

    const grid = document.getElementById('safety-numbers-container');
    grid.innerHTML = '';
    safety.groups.forEach(chunk => {
      const div = document.createElement('div');
      div.className = 'safety-chunk';
      div.textContent = chunk;
      grid.appendChild(div);
    });

    const check = document.getElementById('check-mark-verified');
    check.checked = !!contact.isVerified;

    check.onchange = async () => {
      await window.MyCircleStorage.markContactVerified(peer, check.checked);
      showToast(check.checked ? 'Marked as verified!' : 'Verification badge removed');
    };
  });

  // ==========================================================================
  // Settings & Privacy Modal
  // ==========================================================================
  document.getElementById('btn-open-settings').addEventListener('click', () => {
    openModal('modal-settings');
  });

  // Theme selector
  const themeSelect = document.getElementById('theme-select');
  themeSelect.addEventListener('change', async (e) => {
    const theme = e.target.value;
    document.documentElement.setAttribute('data-theme', theme);
    await window.MyCircleStorage.setSetting('theme', theme);
  });

  // Clear Chat History
  document.getElementById('btn-clear-history').addEventListener('click', () => {
    showConfirm(
      'Clear Local Chat History',
      'WARNING: This will permanently delete all locally stored encrypted messages, contacts, and circles on this device. Since MyCircle does not store your messages on a central database, this cannot be undone.',
      async () => {
        closeModal('modal-settings');
        await window.MyCircleStorage.clearAllLocalData();
        activeConversation = null;
        chatActive.classList.remove('visible');
        chatUnselected.style.display = 'flex';
        document.querySelector('.app-layout').classList.remove('conversation-open');
        await loadConversations();
        showToast('All local chat history cleared.');
      }
    );
  });

  // Sign Out
  document.getElementById('btn-logout').addEventListener('click', async () => {
    closeModal('modal-settings');
    window.MyCircleSignaling.disconnect();
    await window.MyCircleAuth.logout();
    currentAccount = null;
    activeConversation = null;
    mainView.style.display = 'none';
    authView.style.display = 'flex';
    document.querySelector('.app-layout').classList.remove('conversation-open');
    showToast('Signed out securely');
  });

  // ==========================================================================
  // Application Bootstrap
  // ==========================================================================
  async function init() {
    // 1. Initialize IndexedDB
    await window.MyCircleStorage.openDatabase();

    // 2. Load stored theme
    const savedTheme = await window.MyCircleStorage.getSetting('theme', 'light');
    document.documentElement.setAttribute('data-theme', savedTheme);
    themeSelect.value = savedTheme;

    // 3. Check for existing logged-in session
    const account = await window.MyCircleAuth.checkSession();
    if (account) {
      await onAuthSuccess(account);
    } else {
      authView.style.display = 'flex';
      mainView.style.display = 'none';
    }
  }

  // Start app
  init().catch(err => {
    console.error('Error during app bootstrap:', err);
  });

})();
