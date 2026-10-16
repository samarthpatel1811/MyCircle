const http = require('http');
const path = require('path');
const express = require('express');
const { router: authRouter } = require('./auth-routes');
const signalingServer = require('./signaling');

const app = express();
const PORT = process.env.PORT || 3030;

// Enable trust proxy for HTTPS public tunnels & cloud reverse proxies
app.set('trust proxy', 1);

// Body parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Security headers (standard WebAuthn & Crypto friendly)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// API Routes
app.use('/api/auth', authRouter);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'MyCircle Encrypted Messaging',
    version: '1.0.0',
    crypto: 'End-to-End P-256 ECDH + AES-256-GCM',
    storage: 'Local IndexedDB (Zero central chat database)'
  });
});

// Serve assets folder
app.use('/assets', express.static(path.join(__dirname, '..', 'assets')));

// Serve public static frontend
app.use(express.static(path.join(__dirname, '..', 'public')));

// SPA Fallback for any client-side routes
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Create HTTP server & attach signaling WebSocket server
const server = http.createServer(app);
signalingServer.attach(server);

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`  MyCircle — Private Messaging Website`);
  console.log(`  Tagline: Your circle. Your conversations.`);
  console.log(`  Server running at: http://localhost:${PORT}`);
  console.log(`  WebSocket signaling active on /ws`);
  console.log(`  E2EE Web Crypto + Local IndexedDB Active`);
  console.log(`=======================================================`);
});
