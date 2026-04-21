import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from agent directory
dotenv.config({ path: join(__dirname, '..', '.env') });

export const config = {
  // Vault paths
  VAULT_ROOT: process.env.VAULT_ROOT || '/Users/enzo/OBS_Lavoro',

  // Server connection
  SERVER_URL: process.env.SERVER_URL || 'ws://localhost:3000/ws',
  API_KEY: process.env.API_KEY || '',

  // Local state database
  DB_PATH: process.env.DB_PATH || join(process.env.HOME || '.', '.obsidian-sync-state.db'),

  // Watcher configuration
  WATCH_DEBOUNCE: parseInt(process.env.WATCH_DEBOUNCE || '500', 10), // ms
  IGNORE_PATTERNS: [
    '**/.obsidian/**',           // Obsidian app config
    '**/.trash/**',              // Obsidian trash
    '**/.DS_Store',              // macOS
    '**/.*',                     // Hidden files
    '**~*',                      // Temporary files
    '**/*.swp',                  // Vim swap files
    '**/*.tmp',                  // Temporary files
    '**/.git/**'                 // Git directories
  ],

  // Allowed extensions (must match server whitelist)
  ALLOWED_EXTENSIONS: new Set([
    '.md', '.txt', '.csv', '.json', '.yaml', '.yml', '.xml', '.html', '.css', '.js', '.ts',
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.tiff',
    '.pdf', '.docx', '.xlsx', '.pptx',
    '.mp3', '.wav', '.ogg', '.m4a', '.flac',
    '.mp4', '.mov', '.avi', '.mkv', '.webm',
    '.zip', '.tar', '.gz'
  ]),

  // WebSocket reconnection
  RECONNECT_INITIAL_DELAY: 1000,    // 1 second
  RECONNECT_MAX_DELAY: 60000,       // 60 seconds
  RECONNECT_BACKOFF_MULTIPLIER: 2,

  // Sync configuration
  SYNC_BATCH_SIZE: 10,              // Files per batch
  SYNC_MAX_CONCURRENT: 5,           // Max concurrent uploads

  // Validate config on startup
  validate() {
    if (!existsSync(this.VAULT_ROOT)) {
      throw new Error(`Vault root does not exist: ${this.VAULT_ROOT}`);
    }

    if (!this.API_KEY) {
      throw new Error('API_KEY is required');
    }

    if (this.API_KEY.length < 32) {
      throw new Error('API_KEY must be at least 32 characters');
    }

    if (!this.SERVER_URL) {
      throw new Error('SERVER_URL is required');
    }

    // Parse SERVER_URL to ensure it's valid
    try {
      const url = new URL(this.SERVER_URL);
      if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
        throw new Error('SERVER_URL must use ws:// or wss:// protocol');
      }
    } catch (error) {
      throw new Error(`Invalid SERVER_URL: ${error.message}`);
    }
  }
};
