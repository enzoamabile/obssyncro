import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { getStateDB, sessionOps, fileOps } from './state-db.js';
import { requireAuth, verifyAdminPassword, generateAccessToken, generateRefreshToken, verifyToken } from './auth.js';
import { generalLimiter, authLimiter } from './middleware/rate-limit.js';
import { pathGuard } from './middleware/path-guard.js';
import WSHub from './ws-hub.js';
import SyncHandler from './sync-handler.js';
import FileStore from './file-store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Validate config on startup
config.validate();

const app = express();
const db = getStateDB();
let wsHub = null;
let syncHandler = null;

// Middleware
app.use(express.json({ limit: '100mb' }));
app.use(cookieParser());

// Serve static files from client
const clientDistPath = path.join(__dirname, '../client/dist');
app.use(express.static(clientDistPath));

// Health check endpoint (public, no auth)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    env: config.NODE_ENV,
    hasAdminEmail: !!config.ADMIN_EMAIL,
    hasAdminHash: !!config.ADMIN_PASSWORD_HASH
  });
});

// Test password verification (temporary, for debugging)
app.get('/test-auth', async (req, res) => {
  const testPassword = 'AdminPassword123!';
  const isValid = await verifyAdminPassword(testPassword);

  res.json({
    testPassword,
    adminEmail: config.ADMIN_EMAIL,
    adminHashLength: config.ADMIN_PASSWORD_HASH?.length,
    hashStart: config.ADMIN_PASSWORD_HASH?.substring(0, 10),
    isValid
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

// List all files
app.get('/api/list', requireAuth, (req, res) => {
  try {
    const manifest = fileOps.getManifest(db);

    // Convert manifest to file list with metadata
    const files = manifest.map(entry => ({
      path: entry.path,
      type: entry.type,
      size: entry.size || 0,
      mtime: entry.mtime || new Date().toISOString(),
      hash: entry.hash || ''
    }));

    res.json({ files });
  } catch (error) {
    console.error('Error listing files:', error);
    res.status(500).json({ error: 'Failed to list files' });
  }
});

// Get file content
app.get('/api/file/*', requireAuth, pathGuard, (req, res) => {
  const filePath = req.params[0];
  const fileStore = new FileStore();

  try {
    const file = fileStore.read(filePath);

    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Return JSON with content and metadata
    const content = file.content.toString('utf8');

    res.json({
      path: filePath,
      content,
      hash: file.hash,
      size: file.size,
      mtime: file.mtime
    });

  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error);
    res.status(500).json({ error: 'Failed to read file' });
  }
});

// Create or update file
app.post('/api/file/*', requireAuth, pathGuard, (req, res) => {
  const filePath = req.params[0];
  const { content } = req.body;
  const fileStore = new FileStore();

  try {
    // Convert content to base64 for file-store
    const base64Content = Buffer.from(content).toString('base64');

    // Calculate hash
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(content).digest('hex');

    // Write file
    const result = fileStore.write(filePath, base64Content);

    // Update database
    fileOps.upsert(db, {
      path: filePath,
      type: 'file',
      size: result.size,
      mtime: result.mtime,
      hash
    });

    // Broadcast to WebSocket clients
    if (syncHandler) {
      syncHandler.handleLocalChange(filePath, content, hash);
    }

    res.json({
      success: true,
      path: filePath,
      hash,
      size: result.size
    });

  } catch (error) {
    console.error(`Error writing file ${filePath}:`, error);
    res.status(500).json({ error: 'Failed to write file' });
  }
});

// Delete file (soft delete)
app.delete('/api/file/*', requireAuth, pathGuard, (req, res) => {
  const filePath = req.params[0];
  const fileStore = new FileStore();

  try {
    // Soft delete - move to trash
    fileStore.softDelete(filePath);

    // Remove from database
    fileOps.delete(db, filePath);

    // Broadcast to WebSocket clients
    if (syncHandler) {
      syncHandler.handleLocalDelete(filePath);
    }

    res.json({
      success: true,
      path: filePath
    });

  } catch (error) {
    console.error(`Error deleting file ${filePath}:`, error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// Create folder
app.post('/api/folder/*', requireAuth, pathGuard, (req, res) => {
  const folderPath = req.params[0];
  const fileStore = new FileStore();

  try {
    // Create folder
    fileStore.createFolder(folderPath);

    // Add to database
    fileOps.upsert(db, {
      path: folderPath,
      type: 'folder',
      size: 0,
      mtime: new Date().toISOString(),
      hash: ''
    });

    res.json({
      success: true,
      path: folderPath
    });

  } catch (error) {
    console.error(`Error creating folder ${folderPath}:`, error);
    res.status(500).json({ error: 'Failed to create folder' });
  }
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

// SPA fallback - serve index.html for non-API routes
app.get('*', (req, res) => {
  // Don't intercept API routes
  if (req.path.startsWith('/api') || req.path.startsWith('/auth') || req.path === '/health' || req.path === '/ws') {
    return res.status(404).json({ error: 'Not found' });
  }

  res.sendFile(path.join(clientDistPath, 'index.html'));
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
