/**
 * MyCircle — Main Application Controller
 * Handles UI state, routing, real-time message sending/receiving,
 * WebRTC P2P coordination, modals, invitations, and local IndexedDB sync.
 */

(function () {
  'use strict';

  // Application State
  let currentAccount = null;
  let activeConversation = null;
  let typingTimeout = null;
  let isTyping = false;
  let activeJoinKey = null;
  let chatRequests = { incoming: [], outgoing: [] };
  let selectedMemberForProfile = null;

  // DOM Elements - Auth
  const authView = document.getElementById('auth-view');
  const mainView = document.getElementById('main-view');
  const authError = document.getElementById('auth-error');
  const authSuccess = document.getElementById('auth-success');
  const viewLogin = document.getElementById('view-login');
  const viewSignup = document.getElementById('view-signup');
  const formLogin = document.getElementById('form-login');
  const formSignup = document.getElementById('form-signup');
  const linkGotoSignup = document.getElementById('link-goto-signup');
  const linkGotoLogin = document.getElementById('link-goto-login');
  const btnLoginSubmit = document.getElementById('btn-login-submit');
  const btnSignupSubmit = document.getElementById('btn-signup-submit');

  // DOM Elements - User Bar & Navigation
  const myStatusDot = document.getElementById('my-status-dot');
  const myDisplayName = document.getElementById('my-display-name');
  const myHandle = document.getElementById('my-handle');
  const networkPill = document.getElementById('network-pill');
  const requestsBadge = document.getElementById('requests-badge');

  // DOM Elements - Conversations & Sidebar
  const convSearchInput = document.getElementById('conv-search-input');
  const conversationsContainer = document.getElementById('conversations-container');
  const sidebarEmpty = document.getElementById('sidebar-empty');
  const btnEmptyConnect = document.getElementById('btn-empty-connect');
  const btnOpenConnect = document.getElementById('btn-open-connect');
  const btnOpenNewGroup = document.getElementById('btn-open-new-group');
  const btnOpenSettings = document.getElementById('btn-open-settings');

  // DOM Elements - Chat Pane
  const chatUnselected = document.getElementById('chat-unselected');
  const chatActive = document.getElementById('chat-active');
  const chatHeaderClickable = document.getElementById('chat-header-clickable');
  const activeChatAvatar = document.getElementById('active-chat-avatar');
  const activeChatName = document.getElementById('active-chat-name');
  const activeStatusDot = document.getElementById('active-status-dot');
  const activeStatusText = document.getElementById('active-status-text');
  const btnMobileBack = document.getElementById('btn-mobile-back');
  const btnVerifySafety = document.getElementById('btn-verify-safety');
  const btnGroupManage = document.getElementById('btn-group-manage');

  // DOM Elements - Messages & Input
  const messagesScroll = document.getElementById('messages-scroll');
  const typingIndicator = document.getElementById('typing-indicator');
  const typingText = document.getElementById('typing-text');
  const messageInput = document.getElementById('message-input');
  const btnSendMessage = document.getElementById('btn-send-message');
  const toastContainer = document.getElementById('toast-container');

  // ==========================================================================
  // Toast & Formatting Utilities
  // ==========================================================================
  function showToast(message, duration = 3200) {
    if (!toastContainer) return;
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
    return String(str).replace(/[&<>'"]/g, tag => ({
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

  function formatDateDivider(timestamp) {
    const d = new Date(timestamp);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Today';
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // Format group member count with proper singular / plural
  function formatMemberCount(count) {
    const n = Math.max(0, count || 0);
    return `${n} ${n === 1 ? 'member' : 'members'}`;
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

  const btnConfirmYes = document.getElementById('btn-confirm-yes');
  if (btnConfirmYes) {
    btnConfirmYes.addEventListener('click', () => {
      closeModal('modal-confirm');
      if (confirmCallback) {
        confirmCallback();
        confirmCallback = null;
      }
    });
  }

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
  // Show/Hide Password Toggle Buttons
  // ==========================================================================
  document.querySelectorAll('.password-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const input = document.getElementById(targetId);
      if (!input) return;

      const isPassword = input.getAttribute('type') === 'password';
      input.setAttribute('type', isPassword ? 'text' : 'password');

      btn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
      btn.innerHTML = isPassword
        ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
             <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
             <line x1="1" y1="1" x2="23" y2="23"></line>
           </svg>`
        : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
             <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
             <circle cx="12" cy="12" r="3"></circle>
           </svg>`;
    });
  });

  // ==========================================================================
  // Authentication UI Handlers (Clean & Reliable)
  // ==========================================================================
  function showAuthError(msg) {
    if (authSuccess) {
      authSuccess.textContent = '';
      authSuccess.classList.remove('visible');
    }
    if (authError) {
      authError.innerHTML = escapeHTML(msg);
      authError.classList.add('visible');
    }
  }

  function showAuthSuccess(msg) {
    if (authError) {
      authError.textContent = '';
      authError.classList.remove('visible');
    }
    if (authSuccess) {
      authSuccess.innerHTML = escapeHTML(msg);
      authSuccess.classList.add('visible');
    }
  }

  function clearAuthAlerts() {
    if (authError) {
      authError.textContent = '';
      authError.classList.remove('visible');
    }
    if (authSuccess) {
      authSuccess.textContent = '';
      authSuccess.classList.remove('visible');
    }
  }

  // Switch between Login and Signup forms
  if (linkGotoSignup) {
    linkGotoSignup.addEventListener('click', () => {
      viewLogin.style.display = 'none';
      viewSignup.style.display = 'block';
      clearAuthAlerts();
      const input = document.getElementById('signup-fullname');
      if (input) input.focus();
    });
  }

  if (linkGotoLogin) {
    linkGotoLogin.addEventListener('click', () => {
      viewSignup.style.display = 'none';
      viewLogin.style.display = 'block';
      clearAuthAlerts();
      const input = document.getElementById('login-username');
      if (input) input.focus();
    });
  }

  // Handle Login Form Submission
  if (formLogin) {
    formLogin.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAuthAlerts();

      const usernameInput = document.getElementById('login-username');
      const passwordInput = document.getElementById('login-password');
      const username = usernameInput.value.trim();
      const password = passwordInput.value;

      if (!username) {
        return showAuthError('Please enter your username.');
      }
      if (!password) {
        return showAuthError('Please enter your password.');
      }

      btnLoginSubmit.disabled = true;
      const originalText = btnLoginSubmit.innerHTML;
      btnLoginSubmit.innerHTML = '<span>Logging in...</span>';

      try {
        const account = await window.MyCircleAuth.login(username, password);
        onAuthSuccess(account);
      } catch (err) {
        // Helpful error handling: if account doesn't exist, show clear action
        if (err.message && err.message.toLowerCase().includes('not found')) {
          authError.innerHTML = `
            <span>Account <strong>@${escapeHTML(username)}</strong> does not exist yet.</span>
            <div style="margin-top: 0.35rem;">
              <a href="javascript:void(0)" id="link-error-signup" style="color: inherit; text-decoration: underline; font-weight: 700;">Create an account now</a>
            </div>
          `;
          authError.classList.add('visible');
          const errLink = document.getElementById('link-error-signup');
          if (errLink) {
            errLink.addEventListener('click', () => {
              viewLogin.style.display = 'none';
              viewSignup.style.display = 'block';
              clearAuthAlerts();
              const signupUser = document.getElementById('signup-username');
              if (signupUser) signupUser.value = username;
              const signupName = document.getElementById('signup-fullname');
              if (signupName) signupName.focus();
            });
          }
        } else {
          showAuthError(err.message || 'Login failed. Please verify your credentials.');
        }
      } finally {
        btnLoginSubmit.disabled = false;
        btnLoginSubmit.innerHTML = originalText;
      }
    });
  }

  // Handle Signup Form Submission
  if (formSignup) {
    formSignup.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAuthAlerts();

      const fullName = document.getElementById('signup-fullname').value.trim();
      const username = document.getElementById('signup-username').value.trim();
      const password = document.getElementById('signup-password').value;
      const confirmPassword = document.getElementById('signup-confirmpassword').value;

      if (!fullName) {
        return showAuthError('Please enter your full name.');
      }
      if (!username) {
        return showAuthError('Please enter a username.');
      }
      if (!/^[a-zA-Z0-9_-]{3,24}$/.test(username)) {
        return showAuthError('Username must be 3-24 characters (letters, numbers, hyphens, underscores).');
      }
      if (!password || password.length < 6) {
        return showAuthError('Password must be at least 6 characters long.');
      }
      if (password !== confirmPassword) {
        return showAuthError('Passwords do not match. Please verify both password fields.');
      }

      btnSignupSubmit.disabled = true;
      const originalText = btnSignupSubmit.innerHTML;
      btnSignupSubmit.innerHTML = '<span>Creating Secure Account...</span>';

      try {
        const account = await window.MyCircleAuth.register(fullName, username, password, confirmPassword);
        showAuthSuccess('Account created successfully! Welcome to MyCircle.');
        setTimeout(() => {
          onAuthSuccess(account);
        }, 400);
      } catch (err) {
        showAuthError(err.message || 'Registration failed. Please choose another username.');
      } finally {
        btnSignupSubmit.disabled = false;
        btnSignupSubmit.innerHTML = originalText;
      }
    });
  }

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
    document.getElementById('settings-auth-badge').textContent = 'Password Verified';

    // Connect WebSocket Signaling with session token
    window.MyCircleSignaling.connect(account.username, account.sessionToken);

    // Load Conversations List from IndexedDB
    await loadConversations();

    // Fetch or Generate Join Key & Load Chat Requests
    await fetchOrCreateUserJoinKey();
    await loadChatRequests();

    // Check if URL has join key / invite params
    checkUrlJoinParams();

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
    loadConversations(convSearchInput ? convSearchInput.value : '');
  });

  window.MyCircleSignaling.on('typing', ({ sender, isTyping: peerTyping }) => {
    if (activeConversation && activeConversation.peerUsername && activeConversation.peerUsername.toLowerCase() === sender.toLowerCase()) {
      if (peerTyping) {
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
      showToast(`Circle security key updated to Epoch ${packet.epoch}`);
    } catch (err) {
      console.error('Error handling group rekey:', err);
    }
  });

  // Real-time Chat Request Notifications
  window.MyCircleSignaling.on('chat-request-received', async (msg) => {
    const sender = msg.request.fromDisplayName || msg.request.fromUsername;
    showToast(`New chat request from ${sender}!`);
    await loadChatRequests();
  });

  window.MyCircleSignaling.on('chat-request-updated', async (msg) => {
    const req = msg.request;
    if (req.status === 'accepted') {
      showToast(`@${req.toUsername} accepted your chat request!`);
      // Create conversation locally
      const peer = (req.fromUsername === currentAccount.username) ? req.toUsername : req.fromUsername;
      const convId = `direct:${peer.toLowerCase()}`;
      let conv = await window.MyCircleStorage.getConversation(convId);
      if (!conv) {
        // Fetch peer profile to get displayName
        let peerName = peer;
        try {
          const res = await fetch(`/api/auth/users/${peer}`);
          if (res.ok) {
            const data = await res.json();
            if (data.user) {
              peerName = data.user.displayName || peer;
              await window.MyCircleStorage.saveContact(data.user);
            }
          }
        } catch (e) {
          console.warn('Could not fetch peer profile:', e);
        }
        conv = {
          id: convId,
          type: 'direct',
          name: peerName,
          peerUsername: peer.toLowerCase(),
          unreadCount: 0,
          updatedAt: Date.now()
        };
        await window.MyCircleStorage.saveConversation(conv);
      }
      await loadConversations();
    } else if (req.status === 'rejected') {
      showToast(`Chat request to @${req.toUsername} was declined.`);
    }
    await loadChatRequests();
  });

  window.MyCircleSignaling.on('chat-requests-sync', async () => {
    await loadChatRequests();
  });

  // Handle Delivery ACK
  window.MyCircleSignaling.on('delivery-ack', async ({ messageId }) => {
    await window.MyCircleStorage.updateMessageStatus(messageId, 'delivered');
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

    const query = (filterQuery || '').toLowerCase().trim();
    const filtered = list.filter(c => !query || (c.name && c.name.toLowerCase().includes(query)) || (c.peerUsername && c.peerUsername.toLowerCase().includes(query)));

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
          tick = conv.lastMessage.status === 'delivered' ? '<span style="color: var(--color-online);">✓✓</span> ' : '<span>✓</span> ';
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

  if (convSearchInput) {
    convSearchInput.addEventListener('input', (e) => {
      loadConversations(e.target.value);
    });
  }

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

    // Header info setup
    const isGroup = conv.type === 'group';
    const initial = (conv.name || conv.peerUsername || '?').charAt(0).toUpperCase();
    activeChatAvatar.textContent = initial;
    activeChatAvatar.className = `avatar ${isGroup ? 'group' : ''}`;
    
    // Set actual conversation title
    const titleSpan = activeChatName.querySelector('span') || activeChatName;
    titleSpan.textContent = conv.name || (isGroup ? 'Circle Group' : `@${conv.peerUsername}`);

    if (isGroup) {
      activeStatusDot.style.display = 'none';
      const count = Array.isArray(conv.members) ? conv.members.length : 1;
      activeStatusText.textContent = `${formatMemberCount(count)} • End-to-End Encrypted`;
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
    await loadConversations(convSearchInput ? convSearchInput.value : '');

    // Focus input and scroll to bottom
    setTimeout(() => {
      scrollToBottom();
      messageInput.focus();
    }, 50);
  }

  // Mobile Back Button: return to sidebar
  if (btnMobileBack) {
    btnMobileBack.addEventListener('click', () => {
      document.querySelector('.app-layout').classList.remove('conversation-open');
    });
  }

  // Clickable Header: Open Group Info when clicking the group title/header
  if (chatHeaderClickable) {
    chatHeaderClickable.addEventListener('click', () => {
      if (activeConversation && activeConversation.type === 'group') {
        openGroupInfoModal();
      } else if (activeConversation && activeConversation.type === 'direct') {
        // Open safety numbers for direct chat
        btnVerifySafety.click();
      }
    });
  }

  if (btnGroupManage) {
    btnGroupManage.addEventListener('click', () => {
      openGroupInfoModal();
    });
  }

  // ==========================================================================
  // Group Info Modal & Clickable Member Details
  // ==========================================================================
  async function openGroupInfoModal() {
    if (!activeConversation || activeConversation.type !== 'group') return;
    openModal('modal-group-info');

    const groupAvatar = document.getElementById('group-info-avatar');
    const groupNameEl = document.getElementById('group-info-name');
    const memberCountEl = document.getElementById('group-info-member-count');

    const groupName = activeConversation.name || 'Circle Group';
    if (groupNameEl) groupNameEl.textContent = groupName;
    if (groupAvatar) groupAvatar.textContent = groupName.charAt(0).toUpperCase();

    const members = Array.isArray(activeConversation.members) ? activeConversation.members : [];
    // Deduplicate members
    const uniqueMembers = Array.from(new Set(members.map(m => m.toLowerCase())));
    if (memberCountEl) memberCountEl.textContent = formatMemberCount(uniqueMembers.length);

    await renderGroupMembersList(uniqueMembers);
  }

  async function renderGroupMembersList(membersList) {
    const listEl = document.getElementById('group-members-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    const isAdmin = activeConversation.admin === currentAccount.username;

    for (const memberUsername of membersList) {
      const isSelf = memberUsername.toLowerCase() === currentAccount.username.toLowerCase();

      // Retrieve contact profile from IndexedDB or API
      let contact = await window.MyCircleStorage.getContact(memberUsername);
      if (!contact) {
        try {
          const res = await fetch(`/api/auth/users/${encodeURIComponent(memberUsername)}`);
          if (res.ok) {
            const data = await res.json();
            if (data.user) {
              contact = data.user;
              await window.MyCircleStorage.saveContact(contact);
            }
          }
        } catch (e) {
          // Fallback
        }
      }

      const displayName = (contact && contact.displayName) || memberUsername;
      const initial = displayName.charAt(0).toUpperCase();

      const item = document.createElement('div');
      item.className = 'group-member-item';
      item.style.cursor = 'pointer';
      item.innerHTML = `
        <div class="group-member-avatar avatar" style="width: 36px; height: 36px; font-size: 0.9rem;">${initial}</div>
        <div class="group-member-info" style="flex: 1;">
          <div style="font-weight: 600; font-size: 0.88rem; color: var(--text-main); display: flex; align-items: center; gap: 0.4rem;">
            <span>${escapeHTML(displayName)}</span>
            ${memberUsername === activeConversation.admin ? '<span class="auth-e2e-badge" style="font-size: 0.65rem; padding: 1px 6px;">Admin</span>' : ''}
            ${isSelf ? '<span style="font-size: 0.75rem; color: var(--text-muted);">(You)</span>' : ''}
          </div>
          <div style="font-size: 0.76rem; color: var(--text-muted);">@${escapeHTML(memberUsername)}</div>
        </div>
        ${(isAdmin && !isSelf) ? `
          <button type="button" class="btn-secondary btn-remove-member" data-member="${escapeHTML(memberUsername)}" style="width: auto; padding: 0.35rem 0.65rem; font-size: 0.75rem; color: var(--color-danger); border-color: rgba(192, 57, 43, 0.3);" title="Remove member and rotate keys">
            Remove
          </button>
        ` : `
          <span style="font-size: 0.75rem; color: var(--brand-secondary); font-weight: 600;">View Profile ›</span>
        `}
      `;

      // Clicking member opens member profile modal
      item.addEventListener('click', (e) => {
        if (e.target.closest('.btn-remove-member')) return;
        openMemberDetailsModal({
          username: memberUsername,
          displayName,
          fingerprint: (contact && contact.fingerprint) || 'Public key on server',
          isSelf
        });
      });

      listEl.appendChild(item);
    }

    // Attach Remove Listeners (Admin only)
    listEl.querySelectorAll('.btn-remove-member').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
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
              openGroupInfoModal();
              await loadMessages(activeConversation.id);
              await loadConversations();
              showToast(`@${member} removed. Security key rotated to Epoch ${updatedConv.epoch}!`);
            } catch (err) {
              showToast(err.message || 'Failed to remove member');
            }
          }
        );
      });
    });
  }

  // Add Member to Group
  const btnAddMemberSubmit = document.getElementById('btn-add-member-submit');
  if (btnAddMemberSubmit) {
    btnAddMemberSubmit.addEventListener('click', async () => {
      const input = document.getElementById('add-member-username');
      const member = input.value.trim().toLowerCase();
      if (!member) return showToast('Please enter a username');

      if (activeConversation.members.map(m => m.toLowerCase()).includes(member)) {
        return showToast(`@${member} is already in this circle`);
      }

      try {
        let contact = await window.MyCircleStorage.getContact(member);
        if (!contact) {
          const res = await fetch(`/api/auth/users/${member}`);
          if (!res.ok) throw new Error(`User @${member} not found`);
          const data = await res.json();
          contact = data.user;
          await window.MyCircleStorage.saveContact(contact);
        }

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
        await openGroupInfoModal();
        showToast(`@${member} added to the circle!`);
      } catch (err) {
        showToast(err.message || 'Failed to add member');
      }
    });
  }

  // Leave Group
  const btnLeaveGroup = document.getElementById('btn-leave-group');
  if (btnLeaveGroup) {
    btnLeaveGroup.addEventListener('click', () => {
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
  }

  // ==========================================================================
  // Member Details Modal (Open Private Chat or Send Request)
  // ==========================================================================
  async function openMemberDetailsModal(member) {
    selectedMemberForProfile = member;
    openModal('modal-member-details');

    document.getElementById('member-detail-avatar').textContent = member.displayName.charAt(0).toUpperCase();
    document.getElementById('member-detail-name').textContent = member.displayName;
    document.getElementById('member-detail-handle').textContent = `@${member.username}`;
    document.getElementById('member-detail-fingerprint').textContent = member.fingerprint || 'Identity key verified';

    const actionContainer = document.getElementById('member-detail-action-container');
    actionContainer.innerHTML = '';

    if (member.isSelf) {
      actionContainer.innerHTML = `
        <div style="font-size: 0.85rem; color: var(--text-muted); padding: 0.5rem;">
          This is your profile.
        </div>
      `;
      return;
    }

    // Check if conversation already exists with this member
    const convId = `direct:${member.username.toLowerCase()}`;
    const existingConv = await window.MyCircleStorage.getConversation(convId);

    if (existingConv) {
      const btnOpen = document.createElement('button');
      btnOpen.className = 'btn-primary';
      btnOpen.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 0.4rem;">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
        Open Private Chat
      `;
      btnOpen.addEventListener('click', () => {
        closeModal('modal-member-details');
        closeModal('modal-group-info');
        openConversation(existingConv);
      });
      actionContainer.appendChild(btnOpen);
      return;
    }

    // Check if there is already an outgoing request pending
    const hasPending = chatRequests.outgoing.some(r => r.toUsername.toLowerCase() === member.username.toLowerCase() && r.status === 'pending');

    const btnRequest = document.createElement('button');
    btnRequest.className = 'btn-primary';

    if (hasPending) {
      btnRequest.disabled = true;
      btnRequest.innerHTML = '<span>Request Sent (Waiting for response...)</span>';
    } else {
      btnRequest.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 0.4rem;">
          <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
          <circle cx="8.5" cy="7" r="4"></circle>
          <line x1="20" y1="8" x2="20" y2="14"></line>
          <line x1="23" y1="11" x2="17" y2="11"></line>
        </svg>
        Request Private Chat
      `;
      btnRequest.addEventListener('click', async () => {
        btnRequest.disabled = true;
        btnRequest.innerHTML = '<span>Sending Request...</span>';
        try {
          const res = await fetch('/api/auth/chat-requests/send', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${currentAccount.sessionToken}`
            },
            body: JSON.stringify({ recipientUsername: member.username })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to send chat request');

          showToast(`Private chat request sent to @${member.username}!`);
          btnRequest.innerHTML = '<span>Request Sent (Waiting...)</span>';
          await loadChatRequests();
        } catch (err) {
          btnRequest.disabled = false;
          btnRequest.innerHTML = '<span>Request Private Chat</span>';
          showToast(err.message || 'Could not send request');
        }
      });
    }

    actionContainer.appendChild(btnRequest);
  }

  // ==========================================================================
  // Connect with People (QR Code & Join Key System)
  // ==========================================================================
  const tabConnectShare = document.getElementById('tab-connect-share');
  const tabConnectJoin = document.getElementById('tab-connect-join');
  const tabConnectRequests = document.getElementById('tab-connect-requests');
  const connectViewShare = document.getElementById('connect-view-share');
  const connectViewJoin = document.getElementById('connect-view-join');
  const connectViewRequests = document.getElementById('connect-view-requests');

  function switchConnectTab(tabName) {
    if (!tabConnectShare || !tabConnectJoin || !tabConnectRequests) return;

    tabConnectShare.classList.toggle('active', tabName === 'share');
    tabConnectJoin.classList.toggle('active', tabName === 'join');
    tabConnectRequests.classList.toggle('active', tabName === 'requests');

    connectViewShare.style.display = tabName === 'share' ? 'flex' : 'none';
    connectViewJoin.style.display = tabName === 'join' ? 'flex' : 'none';
    connectViewRequests.style.display = tabName === 'requests' ? 'flex' : 'none';

    if (tabName === 'requests') {
      renderChatRequestsUI();
    }
  }

  if (tabConnectShare) tabConnectShare.addEventListener('click', () => switchConnectTab('share'));
  if (tabConnectJoin) tabConnectJoin.addEventListener('click', () => switchConnectTab('join'));
  if (tabConnectRequests) tabConnectRequests.addEventListener('click', () => switchConnectTab('requests'));

  // Open Connect Modal Buttons
  function showConnectModal(defaultTab = 'share') {
    openModal('modal-connect');
    switchConnectTab(defaultTab);
    fetchOrCreateUserJoinKey();
  }

  if (btnOpenConnect) btnOpenConnect.addEventListener('click', () => showConnectModal('share'));
  if (btnEmptyConnect) btnEmptyConnect.addEventListener('click', () => showConnectModal('share'));
  const btnEmptyOpenConnect = document.getElementById('btn-empty-open-connect');
  if (btnEmptyOpenConnect) btnEmptyOpenConnect.addEventListener('click', () => showConnectModal('share'));

  // Fetch or Generate Join Key & QR
  async function fetchOrCreateUserJoinKey(forceNew = false) {
    if (!currentAccount) return;
    try {
      const res = await fetch('/api/auth/invitations/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentAccount.sessionToken}`
        },
        body: JSON.stringify({ type: 'direct' })
      });
      const data = await res.json();
      if (res.ok && data.invitation) {
        activeJoinKey = data.invitation.code;
        const keyEl = document.getElementById('my-join-key-text');
        if (keyEl) keyEl.textContent = activeJoinKey;

        const userLabel = document.getElementById('invite-qr-user-label');
        if (userLabel) userLabel.textContent = `@${currentAccount.username}`;

        // Render QR Code Canvas
        const canvas = document.getElementById('invite-qr-canvas');
        if (canvas && window.QRCode) {
          const inviteUrl = `${window.location.origin}/?join=${encodeURIComponent(activeJoinKey)}`;
          window.QRCode.toCanvas(canvas, inviteUrl, {
            width: 200,
            margin: 2,
            color: {
              dark: '#1B4332',
              light: '#FFFFFF'
            }
          }, (err) => {
            if (err) console.error('QR code error:', err);
          });
        }
      }
    } catch (err) {
      console.error('Error fetching join key:', err);
    }
  }

  // Copy Join Key
  const btnCopyJoinKey = document.getElementById('btn-copy-join-key');
  if (btnCopyJoinKey) {
    btnCopyJoinKey.addEventListener('click', async () => {
      if (!activeJoinKey) return;
      try {
        await navigator.clipboard.writeText(activeJoinKey);
        showToast(`Join Key ${activeJoinKey} copied!`);
      } catch (e) {
        showToast(`Key: ${activeJoinKey}`);
      }
    });
  }

  // Share Native Link
  const btnShareNativeLink = document.getElementById('btn-share-native-link');
  if (btnShareNativeLink) {
    btnShareNativeLink.addEventListener('click', async () => {
      if (!activeJoinKey) return;
      const joinUrl = `${window.location.origin}/?join=${encodeURIComponent(activeJoinKey)}`;
      if (navigator.share) {
        try {
          await navigator.share({
            title: 'Connect on MyCircle',
            text: `Join my private circle on MyCircle! Use Join Key: ${activeJoinKey}`,
            url: joinUrl
          });
        } catch (e) {}
      } else {
        await navigator.clipboard.writeText(joinUrl);
        showToast('Invite link copied to clipboard!');
      }
    });
  }

  // Refresh / Revoke & Generate New Key
  const btnRefreshJoinKey = document.getElementById('btn-refresh-join-key');
  if (btnRefreshJoinKey) {
    btnRefreshJoinKey.addEventListener('click', async () => {
      if (activeJoinKey) {
        await fetch('/api/auth/invitations/revoke', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${currentAccount.sessionToken}`
          },
          body: JSON.stringify({ code: activeJoinKey })
        });
      }
      await fetchOrCreateUserJoinKey(true);
      showToast('Generated fresh Join Key!');
    });
  }

  // Look Up Join Key
  const btnVerifyJoinKey = document.getElementById('btn-verify-join-key');
  const inputEnterJoinKey = document.getElementById('input-enter-join-key');
  const joinKeyPreview = document.getElementById('join-key-preview');
  let verifiedInvitation = null;

  async function lookupJoinKey(code) {
    const cleanCode = (code || '').toUpperCase().trim();
    if (!cleanCode) {
      return showToast('Please enter a join key.');
    }

    btnVerifyJoinKey.disabled = true;
    btnVerifyJoinKey.textContent = 'Verifying...';

    try {
      const res = await fetch(`/api/auth/invitations/lookup/${encodeURIComponent(cleanCode)}`);
      const data = await res.json();

      if (!res.ok) {
        joinKeyPreview.style.display = 'none';
        throw new Error(data.error || 'Invalid or expired invitation key.');
      }

      verifiedInvitation = data;
      const creator = data.creator;

      if (creator.username.toLowerCase() === currentAccount.username.toLowerCase()) {
        joinKeyPreview.style.display = 'none';
        throw new Error('This is your own Join Key.');
      }

      // Populate preview card
      document.getElementById('join-preview-avatar').textContent = (creator.displayName || creator.username).charAt(0).toUpperCase();
      document.getElementById('join-preview-name').textContent = creator.displayName || creator.username;
      document.getElementById('join-preview-handle').textContent = `@${creator.username}`;
      document.getElementById('join-preview-status').textContent = 'Key verified. Tap below to send a chat request.';

      joinKeyPreview.style.display = 'block';
    } catch (err) {
      showToast(err.message || 'Could not verify join key.');
    } finally {
      btnVerifyJoinKey.disabled = false;
      btnVerifyJoinKey.textContent = 'Look Up';
    }
  }

  if (btnVerifyJoinKey) {
    btnVerifyJoinKey.addEventListener('click', () => {
      lookupJoinKey(inputEnterJoinKey.value);
    });
  }

  if (inputEnterJoinKey) {
    inputEnterJoinKey.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        lookupJoinKey(inputEnterJoinKey.value);
      }
    });
  }

  // Send Chat Request from Verified Join Key
  const btnSendJoinRequest = document.getElementById('btn-send-join-request');
  if (btnSendJoinRequest) {
    btnSendJoinRequest.addEventListener('click', async () => {
      if (!verifiedInvitation) return;
      const creator = verifiedInvitation.creator;

      btnSendJoinRequest.disabled = true;
      btnSendJoinRequest.textContent = 'Sending Request...';

      try {
        const res = await fetch('/api/auth/chat-requests/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${currentAccount.sessionToken}`
          },
          body: JSON.stringify({
            recipientUsername: creator.username,
            joinKey: verifiedInvitation.invitation.code
          })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to send chat request.');

        // Save contact locally
        await window.MyCircleStorage.saveContact(creator);

        showToast(`Chat request sent to @${creator.username}! Waiting for approval.`);
        joinKeyPreview.style.display = 'none';
        inputEnterJoinKey.value = '';
        verifiedInvitation = null;

        await loadChatRequests();
        switchConnectTab('requests');
      } catch (err) {
        showToast(err.message || 'Failed to send chat request.');
      } finally {
        btnSendJoinRequest.disabled = false;
        btnSendJoinRequest.textContent = 'Send Chat Request';
      }
    });
  }

  // Load and Render Chat Requests
  async function loadChatRequests() {
    if (!currentAccount || !currentAccount.sessionToken) return;
    try {
      const res = await fetch('/api/auth/chat-requests', {
        headers: { Authorization: `Bearer ${currentAccount.sessionToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        chatRequests = data || { incoming: [], outgoing: [] };

        const pendingIncoming = (chatRequests.incoming || []).filter(r => r.status === 'pending');
        const count = pendingIncoming.length;

        // Update badges
        if (requestsBadge) {
          requestsBadge.textContent = count;
          requestsBadge.style.display = count > 0 ? 'inline-block' : 'none';
        }
        const tabBadge = document.getElementById('requests-tab-badge');
        if (tabBadge) {
          tabBadge.textContent = count;
          tabBadge.style.display = count > 0 ? 'inline-block' : 'none';
        }

        renderChatRequestsUI();
      }
    } catch (e) {
      console.warn('Error loading chat requests:', e);
    }
  }

  function renderChatRequestsUI() {
    const incomingList = document.getElementById('incoming-requests-list');
    const outgoingList = document.getElementById('outgoing-requests-list');
    if (!incomingList || !outgoingList) return;

    // 1. Incoming Requests
    incomingList.innerHTML = '';
    const pendingIncoming = (chatRequests.incoming || []).filter(r => r.status === 'pending');

    if (pendingIncoming.length === 0) {
      incomingList.innerHTML = '<p style="font-size: 0.82rem; color: var(--text-muted); padding: 0.4rem;">No incoming requests.</p>';
    } else {
      pendingIncoming.forEach(req => {
        const item = document.createElement('div');
        item.className = 'group-member-item';
        item.innerHTML = `
          <div class="avatar" style="width: 36px; height: 36px; font-size: 0.9rem;">
            ${(req.fromDisplayName || req.fromUsername).charAt(0).toUpperCase()}
          </div>
          <div style="flex: 1;">
            <div style="font-weight: 600; font-size: 0.88rem; color: var(--text-main);">
              ${escapeHTML(req.fromDisplayName || req.fromUsername)}
            </div>
            <div style="font-size: 0.76rem; color: var(--text-muted);">@${escapeHTML(req.fromUsername)}</div>
          </div>
          <div style="display: flex; gap: 0.4rem;">
            <button type="button" class="btn-primary btn-accept-req" data-id="${req.id}" style="width: auto; padding: 0.4rem 0.8rem; font-size: 0.78rem;">
              Accept
            </button>
            <button type="button" class="btn-secondary btn-reject-req" data-id="${req.id}" style="width: auto; padding: 0.4rem 0.8rem; font-size: 0.78rem; color: var(--color-danger);">
              Decline
            </button>
          </div>
        `;

        item.querySelector('.btn-accept-req').addEventListener('click', () => respondToRequest(req.id, 'accepted'));
        item.querySelector('.btn-reject-req').addEventListener('click', () => respondToRequest(req.id, 'rejected'));

        incomingList.appendChild(item);
      });
    }

    // 2. Outgoing Requests
    outgoingList.innerHTML = '';
    const outList = chatRequests.outgoing || [];

    if (outList.length === 0) {
      outgoingList.innerHTML = '<p style="font-size: 0.82rem; color: var(--text-muted); padding: 0.4rem;">No outgoing requests.</p>';
    } else {
      outList.slice(0, 8).forEach(req => {
        const item = document.createElement('div');
        item.className = 'group-member-item';

        let statusText = 'Waiting for response';
        let statusColor = 'var(--text-muted)';
        if (req.status === 'accepted') {
          statusText = 'Accepted ✓';
          statusColor = 'var(--color-online)';
        } else if (req.status === 'rejected') {
          statusText = 'Declined';
          statusColor = 'var(--color-danger)';
        } else if (req.status === 'cancelled') {
          statusText = 'Cancelled';
        }

        item.innerHTML = `
          <div class="avatar" style="width: 36px; height: 36px; font-size: 0.9rem;">
            ${req.toUsername.charAt(0).toUpperCase()}
          </div>
          <div style="flex: 1;">
            <div style="font-weight: 600; font-size: 0.88rem; color: var(--text-main);">
              @${escapeHTML(req.toUsername)}
            </div>
            <div style="font-size: 0.76rem; color: ${statusColor}; font-weight: 500;">${statusText}</div>
          </div>
          ${req.status === 'pending' ? `
            <button type="button" class="btn-secondary btn-cancel-req" data-id="${req.id}" style="width: auto; padding: 0.35rem 0.65rem; font-size: 0.75rem;">
              Cancel
            </button>
          ` : ''}
        `;

        const cancelBtn = item.querySelector('.btn-cancel-req');
        if (cancelBtn) {
          cancelBtn.addEventListener('click', () => respondToRequest(req.id, 'cancelled'));
        }

        outgoingList.appendChild(item);
      });
    }
  }

  async function respondToRequest(requestId, action) {
    try {
      const res = await fetch(`/api/auth/chat-requests/${requestId}/respond`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentAccount.sessionToken}`
        },
        body: JSON.stringify({ action })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to respond to request.');

      if (action === 'accepted') {
        const req = data.request;
        const peer = (req.fromUsername === currentAccount.username) ? req.toUsername : req.fromUsername;

        // Fetch peer public keys
        let peerDisplayName = peer;
        try {
          const uRes = await fetch(`/api/auth/users/${peer}`);
          if (uRes.ok) {
            const uData = await uRes.json();
            if (uData.user) {
              peerDisplayName = uData.user.displayName || peer;
              await window.MyCircleStorage.saveContact(uData.user);
            }
          }
        } catch (e) {}

        const convId = `direct:${peer.toLowerCase()}`;
        let conv = await window.MyCircleStorage.getConversation(convId);
        if (!conv) {
          conv = {
            id: convId,
            type: 'direct',
            name: peerDisplayName,
            peerUsername: peer.toLowerCase(),
            unreadCount: 0,
            updatedAt: Date.now()
          };
          await window.MyCircleStorage.saveConversation(conv);
        }

        closeModal('modal-connect');
        await loadConversations();
        openConversation(conv);
        showToast(`Connected with @${peer}! Start chatting.`);
      } else if (action === 'rejected') {
        showToast('Request declined.');
      } else if (action === 'cancelled') {
        showToast('Request cancelled.');
      }

      await loadChatRequests();
    } catch (err) {
      showToast(err.message || 'Error updating request');
    }
  }

  // Check URL parameters for ?join= or ?invite=
  function checkUrlJoinParams() {
    const params = new URLSearchParams(window.location.search);
    const joinCode = params.get('join') || params.get('invite');
    if (joinCode && currentAccount) {
      showConnectModal('join');
      inputEnterJoinKey.value = joinCode;
      lookupJoinKey(joinCode);
      // Clean query parameter without reload
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }

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
    if (messagesScroll) {
      messagesScroll.scrollTop = messagesScroll.scrollHeight;
    }
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
    if (!activeConversation) return;
    const messages = await window.MyCircleStorage.getMessages(activeConversation.id);
    const msg = messages.find(m => m.id === msgId);
    if (!msg) return;

    messageInput.value = msg.content;
    await window.MyCircleStorage.updateMessageStatus(msgId, 'sending');
    sendMessage();
  };

  // ==========================================================================
  // New Group Modal
  // ==========================================================================
  if (btnOpenNewGroup) {
    btnOpenNewGroup.addEventListener('click', async () => {
      openModal('modal-new-group');
      document.getElementById('group-name-input').value = '';
      const picker = document.getElementById('group-members-picker');
      picker.innerHTML = '';

      const contacts = await window.MyCircleStorage.getAllContacts();
      if (contacts.length === 0) {
        picker.innerHTML = '<p style="font-size: 0.82rem; color: var(--text-muted); padding: 0.5rem;">No contacts saved yet. Connect with people first to add them to a circle.</p>';
        return;
      }

      contacts.forEach(c => {
        const label = document.createElement('label');
        label.className = 'group-member-item';
        label.style.cursor = 'pointer';
        label.innerHTML = `
          <div class="avatar" style="width: 32px; height: 32px; font-size: 0.85rem;">${c.displayName.charAt(0).toUpperCase()}</div>
          <div style="flex: 1;">
            <div style="font-size: 0.88rem; font-weight: 600;">${escapeHTML(c.displayName)}</div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">@${escapeHTML(c.username)}</div>
          </div>
          <input type="checkbox" name="group-member" value="${escapeHTML(c.username)}" style="width: 18px; height: 18px; accent-color: var(--brand-primary); cursor: pointer;">
        `;
        picker.appendChild(label);
      });
    });
  }

  const btnEmptyOpenGroup = document.getElementById('btn-empty-open-group');
  if (btnEmptyOpenGroup) {
    btnEmptyOpenGroup.addEventListener('click', () => {
      if (btnOpenNewGroup) btnOpenNewGroup.click();
    });
  }

  const btnCreateGroupConfirm = document.getElementById('btn-create-group-confirm');
  if (btnCreateGroupConfirm) {
    btnCreateGroupConfirm.addEventListener('click', async () => {
      const name = document.getElementById('group-name-input').value.trim();
      if (!name) return showToast('Please enter a circle name');

      const checkedBoxes = Array.from(document.querySelectorAll('input[name="group-member"]:checked'));
      const members = checkedBoxes.map(b => b.value);

      btnCreateGroupConfirm.disabled = true;
      btnCreateGroupConfirm.textContent = 'Creating Circle...';

      try {
        const conv = await window.MyCircleGroupCrypto.createGroup(name, members, currentAccount);
        closeModal('modal-new-group');
        showToast(`Circle "${name}" created with Epoch 1 key!`);
        await loadConversations();
        openConversation(conv);
      } catch (err) {
        showToast(err.message || 'Failed to create group');
      } finally {
        btnCreateGroupConfirm.disabled = false;
        btnCreateGroupConfirm.textContent = 'Create Circle';
      }
    });
  }

  // ==========================================================================
  // Safety Numbers Verification Modal
  // ==========================================================================
  if (btnVerifySafety) {
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
  }

  // ==========================================================================
  // Settings & Privacy Modal
  // ==========================================================================
  if (btnOpenSettings) {
    btnOpenSettings.addEventListener('click', () => {
      openModal('modal-settings');
    });
  }

  // Theme selector
  const themeSelect = document.getElementById('theme-select');
  if (themeSelect) {
    themeSelect.addEventListener('change', async (e) => {
      const theme = e.target.value;
      document.documentElement.setAttribute('data-theme', theme);
      await window.MyCircleStorage.setSetting('theme', theme);
    });
  }

  // Clear Chat History
  const btnClearHistory = document.getElementById('btn-clear-history');
  if (btnClearHistory) {
    btnClearHistory.addEventListener('click', () => {
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
  }

  // Sign Out
  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      closeModal('modal-settings');
      window.MyCircleSignaling.disconnect();
      await window.MyCircleAuth.logout();
      currentAccount = null;
      activeConversation = null;
      mainView.style.display = 'none';
      authView.style.display = 'flex';
      viewLogin.style.display = 'block';
      viewSignup.style.display = 'none';
      clearAuthAlerts();
      document.querySelector('.app-layout').classList.remove('conversation-open');
      showToast('Signed out securely');
    });
  }

  // ==========================================================================
  // Mobile Visual Viewport & Keyboard Handling
  // ==========================================================================
  if (window.visualViewport) {
    const handleViewportChange = () => {
      const vh = window.visualViewport.height;
      document.documentElement.style.setProperty('--app-height', `${vh}px`);
      if (activeConversation) {
        scrollToBottom();
      }
    };
    window.visualViewport.addEventListener('resize', handleViewportChange);
    window.visualViewport.addEventListener('scroll', handleViewportChange);
    handleViewportChange();
  }

  if (messageInput) {
    messageInput.addEventListener('focus', () => {
      setTimeout(scrollToBottom, 200);
    });
  }

  // ==========================================================================
  // Application Bootstrap
  // ==========================================================================
  async function init() {
    // 1. Initialize IndexedDB
    await window.MyCircleStorage.openDatabase();

    // 2. Load stored theme
    const savedTheme = await window.MyCircleStorage.getSetting('theme', 'light');
    document.documentElement.setAttribute('data-theme', savedTheme);
    if (themeSelect) themeSelect.value = savedTheme;

    // 3. Check for existing valid session
    const account = await window.MyCircleAuth.checkSession();
    if (account) {
      await onAuthSuccess(account);
    } else {
      authView.style.display = 'flex';
      mainView.style.display = 'none';
      viewLogin.style.display = 'block';
      viewSignup.style.display = 'none';
    }
  }

  // Launch app
  init().catch(err => {
    console.error('Error during app bootstrap:', err);
  });

})();
