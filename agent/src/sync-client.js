import WebSocket from 'ws';
import { config } from './config.js';
import { fileOps } from './state-store.js';

/**
 * WebSocket Sync Client - Connects to server and handles sync messages
 */
class SyncClient {
  constructor() {
    this.ws = null;
    this.sessionId = null;
    this.connected = false;
    this.reconnectTimer = null;
    this.reconnectDelay = config.RECONNECT_INITIAL_DELAY;
    this.messageQueue = []; // Messages to send when connected
    this.pendingUploads = new Map(); // Files waiting to be uploaded
  }

  /**
   * Connect to server
   */
  connect() {
    console.log(`🔌 Connecting to ${config.SERVER_URL}...`);

    try {
      this.ws = new WebSocket(config.SERVER_URL, {
        headers: {
          'Authorization': `Bearer ${config.API_KEY}`
        }
      });

      this.setupEventHandlers();

    } catch (error) {
      console.error('Connection error:', error.message);
      this.scheduleReconnect();
    }
  }

  /**
   * Set up WebSocket event handlers
   */
  setupEventHandlers() {
    this.ws.on('open', () => this.handleOpen());
    this.ws.on('message', (data) => this.handleMessage(data));
    this.ws.on('error', (error) => this.handleError(error));
    this.ws.on('close', (code, reason) => this.handleClose(code, reason));
  }

  /**
   * Handle connection open
   */
  handleOpen() {
    console.log('✅ Connected to server');
    this.connected = true;
    this.reconnectDelay = config.RECONNECT_INITIAL_DELAY; // Reset delay

    // Clear reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Send queued messages
    this.flushMessageQueue();
  }

  /**
   * Handle incoming message
   */
  async handleMessage(data) {
    try {
      const message = JSON.parse(data.toString());
      console.log('📩 Received:', message.type);

      switch (message.type) {
        case 'connected':
          this.sessionId = message.session_id;
          console.log(`📝 Session ID: ${this.sessionId}`);
          this.emit('connected', message);
          break;

        case 'sync_delta':
          this.emit('sync_delta', message);
          break;

        case 'file_upsert':
          await this.handleFileUpsert(message);
          break;

        case 'file_delete':
          await this.handleFileDelete(message);
          break;

        case 'file_rename':
          await this.handleFileRename(message);
          break;

        case 'conflict_created':
          this.emit('conflict', message);
          break;

        case 'ack':
          console.log(`✅ Acknowledged: ${message.action} - ${message.path}`);
          this.emit('ack', message);
          break;

        case 'pong':
          // Handle pong
          break;

        case 'error':
          console.error('❌ Server error:', message.message);
          this.emit('error', message);
          break;

        default:
          console.warn('Unknown message type:', message.type);
      }

    } catch (error) {
      console.error('Error handling message:', error);
    }
  }

  /**
   * Handle file upsert from server
   */
  async handleFileUpsert(message) {
    if (message.origin_session_id === this.sessionId) {
      // Ignore our own broadcasts (anti-loop)
      return;
    }

    const { payload } = message;
    console.log(`📥 Server pushed file: ${payload.path}`);

    // Emit event for index.js to handle
    this.emit('file_upsert', payload);
  }

  /**
   * Handle file delete from server
   */
  async handleFileDelete(message) {
    if (message.origin_session_id === this.sessionId) {
      return;
    }

    const { payload } = message;
    console.log(`📥 Server deleted file: ${payload.path}`);

    this.emit('file_delete', payload);
  }

  /**
   * Handle file rename from server
   */
  async handleFileRename(message) {
    if (message.origin_session_id === this.sessionId) {
      return;
    }

    const { payload } = message;
    console.log(`📥 Server renamed file: ${payload.old_path} -> ${payload.new_path}`);

    this.emit('file_rename', payload);
  }

  /**
   * Handle connection error
   */
  handleError(error) {
    console.error('❌ WebSocket error:', error.message);
  }

  /**
   * Handle connection close
   */
  handleClose(code, reason) {
    console.log(`🔌 Disconnected: ${code} - ${reason || 'No reason'}`);
    this.connected = false;
    this.sessionId = null;

    // Schedule reconnect
    this.scheduleReconnect();
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  scheduleReconnect() {
    if (this.reconnectTimer) {
      return; // Already scheduled
    }

    console.log(`🔄 Reconnecting in ${Math.round(this.reconnectDelay / 1000)}s...`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();

      // Increase delay for next attempt (exponential backoff)
      this.reconnectDelay = Math.min(
        this.reconnectDelay * config.RECONNECT_BACKOFF_MULTIPLIER,
        config.RECONNECT_MAX_DELAY
      );
    }, this.reconnectDelay);
  }

  /**
   * Send message (queue if not connected)
   */
  send(message) {
    if (this.connected && this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.log('⏳ Queueing message (not connected)');
      this.messageQueue.push(message);
    }
  }

  /**
   * Flush queued messages
   */
  flushMessageQueue() {
    while (this.messageQueue.length > 0 && this.connected) {
      const message = this.messageQueue.shift();
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Send sync manifest
   */
  sendManifest(files) {
    this.send({
      type: 'sync_manifest',
      session_id: this.sessionId,
      client_type: 'agent',
      files: files
    });
  }

  /**
   * Send file upsert
   */
  sendFileUpsert(fileData) {
    this.send({
      type: 'file_upsert',
      session_id: this.sessionId,
      payload: {
        path: fileData.path,
        content: fileData.content,
        hash: fileData.hash,
        size: fileData.size,
        mime: fileData.mime,
        mtime: fileData.mtime
      }
    });
  }

  /**
   * Send file delete
   */
  sendFileDelete(path) {
    this.send({
      type: 'file_delete',
      session_id: this.sessionId,
      payload: { path }
    });
  }

  /**
   * Send ping
   */
  ping() {
    this.send({ type: 'ping' });
  }

  /**
   * Disconnect gracefully
   */
  disconnect() {
    console.log('🔌 Disconnecting...');

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close(1000, 'Agent shutdown');
    }

    this.connected = false;
  }

  /**
   * Event emitter
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
}

export default SyncClient;
