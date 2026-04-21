import { WebSocketServer } from 'ws';
import { verifyAPIKey, verifyToken } from './auth.js';
import { getStateDB, sessionOps } from './state-db.js';
import { randomUUID } from 'crypto';

/**
 * WebSocket Hub - Manages all WebSocket connections
 */
class WSHub {
  constructor(server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.connections = new Map(); // sessionId -> { ws, type, ip, lastSeen }
    this.db = getStateDB();

    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));

    // Cleanup stale sessions every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60 * 1000);

    console.log('🔌 WebSocket Hub initialized on /ws');
  }

  async handleConnection(ws, req) {
    const sessionId = randomUUID();
    const ip = req.socket.remoteAddress;

    try {
      // Authenticate connection
      const authResult = await this.authenticate(req);

      if (!authResult) {
        ws.close(1008, 'Authentication failed');
        return;
      }

      const { type, user } = authResult;

      // Register connection
      this.connections.set(sessionId, {
        ws,
        type,
        ip,
        user,
        lastSeen: Date.now()
      });

      // Update session in database
      sessionOps.upsert(this.db, {
        session_id: sessionId,
        type,
        last_seen: Date.now(),
        ip
      });

      console.log(`✅ WS Connected: ${sessionId} (${type}) from ${ip}`);

      // Send welcome message
      this.sendTo(sessionId, {
        type: 'connected',
        session_id: sessionId,
        server_time: Date.now()
      });

      // Handle incoming messages
      ws.on('message', (data) => this.handleMessage(sessionId, data));

      // Handle disconnect
      ws.on('close', () => this.handleDisconnect(sessionId));

      // Handle errors
      ws.on('error', (error) => {
        console.error(`❌ WS Error ${sessionId}:`, error.message);
      });

      // Update last seen on activity
      ws.on('ping', () => this.updateLastSeen(sessionId));

    } catch (error) {
      console.error('Connection error:', error);
      ws.close(1011, 'Internal server error');
    }
  }

  async authenticate(req) {
    // Check API Key (for agent)
    const authHeader = req.headers['authorization'];

    if (authHeader?.startsWith('Bearer ')) {
      const key = authHeader.substring(7);

      if (verifyAPIKey(key)) {
        return { type: 'agent' };
      }
    }

    // Check JWT token (for web UI)
    const token = this.extractCookie(req, 'access_token');

    if (token) {
      const decoded = verifyToken(token);

      if (decoded) {
        return { type: 'web_ui', user: decoded };
      }
    }

    return null;
  }

  extractCookie(req, name) {
    const cookies = req.headers.cookie;
    if (!cookies) return null;

    const match = cookies.match(new RegExp(`(^| )${name}=([^;]+)`));
    return match ? match[2] : null;
  }

  handleMessage(sessionId, data) {
    try {
      const message = JSON.parse(data.toString());
      this.updateLastSeen(sessionId);

      // Emit message event for sync-handler to process
      this.emit('message', sessionId, message);

    } catch (error) {
      console.error(`❌ Invalid message from ${sessionId}:`, error.message);
      this.sendTo(sessionId, {
        type: 'error',
        message: 'Invalid message format'
      });
    }
  }

  handleDisconnect(sessionId) {
    const conn = this.connections.get(sessionId);

    if (conn) {
      console.log(`❌ WS Disconnected: ${sessionId} (${conn.type})`);
      this.connections.delete(sessionId);

      // Remove from database
      sessionOps.delete(this.db, sessionId);
    }
  }

  updateLastSeen(sessionId) {
    const conn = this.connections.get(sessionId);

    if (conn) {
      conn.lastSeen = Date.now();
      sessionOps.upsert(this.db, {
        session_id: sessionId,
        type: conn.type,
        last_seen: conn.lastSeen,
        ip: conn.ip
      });
    }
  }

  /**
   * Send message to specific session
   */
  sendTo(sessionId, message) {
    const conn = this.connections.get(sessionId);

    if (conn?.ws?.readyState === 1) { // WebSocket.OPEN
      conn.ws.send(JSON.stringify(message));
      return true;
    }

    return false;
  }

  /**
   * Broadcast message to all connected clients
   * Optionally exclude a specific session (to prevent echo)
   */
  broadcast(message, excludeSessionId = null) {
    let sent = 0;

    for (const [sessionId, conn] of this.connections.entries()) {
      if (sessionId !== excludeSessionId && conn.ws?.readyState === 1) {
        try {
          conn.ws.send(JSON.stringify(message));
          sent++;
        } catch (error) {
          console.error(`Broadcast failed to ${sessionId}:`, error.message);
        }
      }
    }

    return sent;
  }

  /**
   * Get connection info
   */
  getConnection(sessionId) {
    return this.connections.get(sessionId);
  }

  /**
   * Get all connections
   */
  getConnections() {
    return Array.from(this.connections.entries()).map(([sessionId, conn]) => ({
      sessionId,
      type: conn.type,
      ip: conn.ip,
      lastSeen: conn.lastSeen
    }));
  }

  /**
   * Cleanup stale connections
   */
  cleanup() {
    const now = Date.now();
    const staleThreshold = 5 * 60 * 1000; // 5 minutes

    for (const [sessionId, conn] of this.connections.entries()) {
      if (now - conn.lastSeen > staleThreshold) {
        console.log(`🧹 Cleaning up stale connection: ${sessionId}`);

        if (conn.ws?.readyState === 1) {
          conn.ws.close(1000, 'Stale connection');
        }

        this.connections.delete(sessionId);
        sessionOps.delete(this.db, sessionId);
      }
    }

    // Also cleanup database sessions
    sessionOps.cleanupStale(this.db, staleThreshold);
  }

  /**
   * Event emitter for message handling
   */
  on(event, callback) {
    if (!this.callbacks) {
      this.callbacks = new Map();
    }

    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, []);
    }

    this.callbacks.get(event).push(callback);
  }

  emit(event, ...args) {
    if (this.callbacks?.has(event)) {
      for (const callback of this.callbacks.get(event)) {
        try {
          callback(...args);
        } catch (error) {
          console.error(`Event callback error (${event}):`, error);
        }
      }
    }
  }

  /**
   * Graceful shutdown
   */
  shutdown() {
    console.log('🔌 Shutting down WebSocket Hub...');

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Close all connections
    for (const [sessionId, conn] of this.connections.entries()) {
      if (conn.ws?.readyState === 1) {
        conn.ws.close(1001, 'Server shutting down');
      }
    }

    this.connections.clear();

    if (this.wss) {
      this.wss.close();
    }

    console.log('✅ WebSocket Hub shut down');
  }
}

export default WSHub;
