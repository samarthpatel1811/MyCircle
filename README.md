# MyCircle — Private Messaging Website

> **Your circle. Your conversations.**  
> A complete, modern, mobile-friendly, end-to-end encrypted private messaging website with **zero central chat database**.

---

## 🛡️ Core Highlights

- **Official Brand & Aesthetics**: Uses the official **MyCircle** emblem on a warm cream (`#FAF7F2`) and forest green (`#1B4332`, `#2D6A4F`) palette with subtle light green (`#D8F3DC`, `#52B788`) accents. Available in **Warm Cream (Light Mode)** and **Forest Midnight (Dark Mode)**.
- **Real End-to-End Encryption (E2EE)**:
  - **Key Agreement**: Elliptic Curve Diffie-Hellman (**ECDH** on the `P-256` curve) deriving pairwise symmetric keys.
  - **Message Encryption**: Authenticated Encryption with Associated Data (**AES-256-GCM**) with a fresh, cryptographically secure 12-byte (96-bit) IV for every message.
  - **Message Authenticity & Integrity**: **ECDSA** digital signatures on `P-256` with `SHA-256` digest to guarantee that messages cannot be spoofed or tampered with.
  - **Signal-Style Safety Numbers**: 60-digit safety numbers formatted into 12 groups of 5 for out-of-band identity verification and MITM protection.
- **Zero Central Chat Database**:
  - The server **NEVER** stores chat messages, message history, or private keys.
  - All chat history is stored strictly on the user's local device inside **IndexedDB** (`MyCircleDB`).
- **Hybrid Communication Architecture (P2P + Ephemeral Relay)**:
  - Direct **WebRTC DataChannel** peer-to-peer transmission when both parties are connected.
  - **Transient Ephemeral Mailbox Relay**: When a peer is offline, the already-encrypted ciphertext is temporarily held in server RAM only until the recipient reconnects, after which it is immediately flushed and deleted.
  - **Real Delivery Confirmations**: Single checkmark (`✓`) when sent to relay; double green checkmark (`✓✓`) when delivered to the recipient's device; failure indicators with a retry button when network is unavailable.
- **Forward-Secure Group Messaging & Key Rotation**:
  - Circle groups encrypt messages with an epoch-based AES-256-GCM group key.
  - **Member Removal Rekeying**: Whenever a member is removed from a circle, the group key is immediately rotated to a new epoch and distributed *only* to the remaining active members. The removed member can never decrypt future messages.
- **Account Access & WebAuthn Passkeys**:
  - Standard **WebAuthn Passkey** registration & login (`@simplewebauthn`).
  - Fallback **Device Security PIN** option for devices or virtual environments without hardware biometric authenticators.
  - Authentication is strictly decoupled from message encryption keys.
- **Invitations & Contacts**:
  - Interactive **QR Code generator** rendered directly on HTML5 Canvas using pure client-side code.
  - Shareable invitation link with Web Share API and one-click copy.
  - Contact search by username with public key fingerprint preview.

---

## 📂 Project Structure

```
MyCirlce/
├── assets/
│   └── mycircle-logo.png             # Official high-resolution logo
├── public/
│   ├── assets/
│   │   ├── mycircle-logo.png         # Web-optimized branding logo
│   │   ├── favicon-32.png            # 32x32 Favicon
│   │   ├── favicon-16.png            # 16x16 Favicon
│   │   ├── apple-touch-icon.png      # 180x180 iOS App Icon
│   │   ├── icon-192.png              # 192x192 PWA Icon
│   │   └── icon-512.png              # 512x512 PWA Icon
│   ├── css/
│   │   └── style.css                 # Forest green & warm cream design system
│   ├── js/
│   │   ├── app.js                    # UI controller, routing, and DOM handling
│   │   ├── crypto.js                 # Web Crypto API: ECDH, ECDSA, AES-GCM, Safety Numbers
│   │   ├── storage.js                # Local IndexedDB storage for device-only history
│   │   ├── auth.js                   # WebAuthn Passkeys & Device PIN fallback
│   │   ├── signaling.js              # WebSocket client + WebRTC DataChannel manager
│   │   ├── group-crypto.js           # Epoch-based group keys & key rotation on member removal
│   │   └── vendor/
│   │       ├── simplewebauthn-browser.min.js  # WebAuthn browser ceremony handler
│   │       └── qrcode.min.js                  # Pure client-side Canvas QR code generator
│   ├── index.html                    # Responsive single-page app (mobile & desktop)
│   └── manifest.json                 # PWA web app manifest
├── server/
│   ├── index.js                      # Express HTTP + WebSocket server entry point (Port 3030)
│   ├── auth-routes.js                # WebAuthn options/verify endpoints + PIN auth
│   ├── signaling.js                  # WebRTC signaling + ephemeral encrypted relay buffer
│   ├── users-directory.js            # Account discovery & public key directory
│   └── data/
│       └── users.json                # Persisted public key directory (no chat content)
├── tests/
│   ├── crypto-test.js                # Unit tests for Web Crypto, AEAD, and Key Rotation
│   └── e2e-integration-test.js       # Real-time multi-client E2EE and offline relay test
├── package.json
└── README.md
```

---

## 🚀 Getting Started

### 1. Installation
Make sure you have Node.js (v18+) installed.

```bash
npm install
```

### 2. Run the Server
Start the MyCircle server:

```bash
npm start
```
The server will be running at:
**`http://localhost:3030`**

### 3. Run Cryptographic & Integration Tests
Verify the full end-to-end cryptographic and networking implementation:

```bash
# Run Web Crypto unit tests (ECDH, ECDSA, AES-GCM, Group Rekeying)
npm test

# Run real-time multi-client integration test (Registration, E2EE, ACKs, Offline Relay)
node tests/e2e-integration-test.js
```

---

## 🔐 Cryptographic Architecture Breakdown

### 1. Identity Key Pairs
When a user registers on MyCircle, their browser immediately generates two key pairs using `crypto.subtle`:
1. **ECDH (`P-256`)**: Used for Diffie-Hellman key agreement to establish shared symmetric secret keys.
2. **ECDSA (`P-256` with `SHA-256`)**: Used for creating digital signatures to verify sender identity and ensure tamper-resistance.

### 2. Pairwise Message Encryption
- Alice and Bob establish an AES-256-GCM symmetric key via ECDH:
  $$\text{SharedKey} = \text{ECDH}(\text{AlicePrivateKey}, \text{BobPublicKey})$$
- For each message, a fresh 96-bit (12-byte) cryptographically random IV is generated.
- Alice signs the payload with her ECDSA private key.
- The payload and signature are encrypted with AES-256-GCM:
  $$\text{Ciphertext} = \text{AES-GCM-Encrypt}(\text{SharedKey}, \text{IV}, \{\text{payload}, \text{signature}\})$$
- Bob decrypts the ciphertext using $\text{SharedKey}$ and verifies the signature using Alice's public ECDSA key.

### 3. Forward-Secure Group Rekeying on Member Removal
- Each circle group has an active `epoch` (starting at 1) and a 256-bit AES-GCM group key.
- The admin distributes the group key to each member encrypted pairwise.
- When an admin removes a member from the group:
  1. The epoch increments: $\text{Epoch} \leftarrow \text{Epoch} + 1$.
  2. A new 256-bit AES-GCM group key is generated.
  3. The new key is encrypted and distributed **only** to the remaining active members.
  4. The removed member never receives the new key and cannot decrypt any future messages.

### 4. Zero Central Chat Database & Ephemeral Relay
- Chat messages are stored **only on the user's physical device** using IndexedDB (`MyCircleDB`).
- If a recipient is offline when a message is sent:
  - The already-encrypted ciphertext packet is placed in the server's transient in-memory mailbox.
  - When the recipient connects, the packets are delivered to their WebSocket and immediately purged from memory.
  - The server never has access to plaintext or encryption keys.

---

## 📱 Mobile-First Responsive Design
- **Mobile Screens**: Single-column clean chat list. Tapping any conversation smoothly slides in the conversation pane with a comfortable back button (`<`) to return to the chat list.
- **Desktop Screens**: Two-pane split view with conversations on the left (380px) and active chat on the right.
- **PWA Ready**: Includes `manifest.json`, high-resolution app icons, and responsive meta tags.
