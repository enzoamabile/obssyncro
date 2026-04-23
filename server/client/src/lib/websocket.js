import { addFile, removeFile, updateFileContent } from '../stores/files.js';

export class WebSocketClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
    this.sessionId = crypto.randomUUID();

    this.onConnected = null;
    this.onDisconnected = null;
    this.onError = null;
    this.onFileChanged = null;
  }

  connect() {
    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('✅ WebSocket connected');
        this.reconnectAttempts = 0;
        this.onConnected?.();

        // Send auth
        const token = localStorage.getItem('token');
        if (token) {
          this.send({ type: 'auth', token });
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };

      this.ws.onclose = () => {
        console.log('🔌 WebSocket disconnected');
        this.onDisconnected?.();
        this.reconnect();
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.onError?.(error);
      };

    } catch (err) {
      console.error('Failed to connect WebSocket:', err);
      this.onError?.(err);
      this.reconnect();
    }
  }

  handleMessage(data) {
    switch (data.type) {
      case 'connected':
        console.log('✅ Server connected, session:', data.session_id);
        this.sessionId = data.session_id;
        break;

      case 'auth':
      case 'auth_success':
      case 'authenticated':
        console.log('✅ Authenticated');
        break;

      case 'error':
        console.error('WebSocket error:', data.message || data.error);
        break;

      case 'sync_request':
        // Ignore our own sync requests
        if (data.session_id === this.sessionId) {
          return;
        }
        break;

      case 'file_created':
      case 'file_updated':
        if (data.session_id !== this.sessionId) {
          this.onFileChanged?.(data);
          // Trigger file list refresh
          window.dispatchEvent(new CustomEvent('file:changed', { detail: data }));
        }
        break;

      case 'file_deleted':
        if (data.session_id !== this.sessionId) {
          removeFile(data.path);
          this.onFileChanged?.(data);
          window.dispatchEvent(new CustomEvent('file:changed', { detail: data }));
        }
        break;

      default:
        console.log('Unknown message type:', data.type);
    }
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  syncFile(path, content, hash) {
    this.send({
      type: 'sync',
      path,
      content,
      hash,
      session_id: this.sessionId
    });
  }

  reconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

      console.log(`Reconnecting in ${delay}ms...`);
      setTimeout(() => this.connect(), delay);
    } else {
      console.error('Max reconnect attempts reached');
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export function createWebSocketClient() {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}/ws`;

  return new WebSocketClient(wsUrl);
}
