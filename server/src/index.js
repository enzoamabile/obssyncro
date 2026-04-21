import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { getStateDB, sessionOps, fileOps } from './state-db.js';
import { requireAuth, verifyAdminPassword, generateAccessToken, generateRefreshToken, verifyToken } from './auth.js';
import { generalLimiter, authLimiter } from './middleware/rate-limit.js';
import { pathGuard } from './middleware/path-guard.js';
import WSHub from './ws-hub.js';
import SyncHandler from './sync-handler.js';
import FileStore from './file-store.js';

// Validate config on startup
config.validate();

const app = express();
const db = getStateDB();
let wsHub = null;
let syncHandler = null;

// Middleware
app.use(express.json({ limit: '100mb' }));
app.use(cookieParser());

// Health check endpoint (public, no auth)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    env: config.NODE_ENV
  });
});

// Auth endpoints
app.post('/auth/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;

  // Validate input
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  // Check email
  if (email !== config.ADMIN_EMAIL) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Verify password
  const isValid = await verifyAdminPassword(password);
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Generate tokens
  const payload = { email, type: 'web_ui' };
  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken(payload);

  // Set httpOnly cookies
  res.cookie('access_token', accessToken, {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 15 * 60 * 1000 // 15 minutes
  });

  res.cookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });

  res.json({
    success: true,
    message: 'Login successful'
  });
});

app.post('/auth/refresh', (req, res) => {
  const refreshToken = req.cookies?.refresh_token;

  if (!refreshToken) {
    return res.status(401).json({ error: 'No refresh token provided' });
  }

  const decoded = verifyToken(refreshToken);

  if (!decoded) {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }

  // Generate new access token
  const payload = { email: decoded.email, type: decoded.type };
  const accessToken = generateAccessToken(payload);

  res.cookie('access_token', accessToken, {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 15 * 60 * 1000 // 15 minutes
  });

  res.json({
    success: true,
    message: 'Token refreshed'
  });
});

app.post('/auth/logout', (req, res) => {
  res.clearCookie('access_token');
  res.clearCookie('refresh_token');

  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

// Protected API endpoint example
app.get('/api/manifest', requireAuth, (req, res) => {
  const manifest = fileOps.getManifest(db);

  res.json({
    files: manifest,
    count: manifest.length
  });
});

// Serve files from vault
app.get('/api/files/*', requireAuth, pathGuard, (req, res) => {
  const path = req.params[0]; // Everything after /api/files/
  const fileStore = new FileStore();

  try {
    const file = fileStore.read(path);

    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Set content type
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Content-Length', file.size);
    res.setHeader('Cache-Control', 'no-cache');

    // Send base64 decoded content
    const content = Buffer.from(file.content, 'base64');
    res.send(content);

  } catch (error) {
    console.error(`Error serving file ${path}:`, error);
    res.status(500).json({ error: 'Failed to read file' });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: config.NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});

// Start server
const server = app.listen(config.PORT, () => {
  console.log(`🚀 Obsidian Sync Server running on port ${config.PORT}`);
  console.log(`📊 Environment: ${config.NODE_ENV}`);
  console.log(`💾 Database: ${config.DB_PATH}`);
  console.log(`📁 Vault: ${config.VAULT_ROOT}`);
});

// Initialize WebSocket hub and sync handler
wsHub = new WSHub(server);
syncHandler = new SyncHandler(db, wsHub);

// Graceful shutdown
const shutdown = () => {
  console.log('Shutting down gracefully...');

  if (wsHub) {
    wsHub.shutdown();
  }

  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });

  // Force close after 10 seconds
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export { app };
