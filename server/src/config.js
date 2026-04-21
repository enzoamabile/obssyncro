import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from server directory
dotenv.config({ path: join(__dirname, '..', '.env') });

export const config = {
  // Server
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3000', 10),

  // Storage paths
  VAULT_ROOT: process.env.VAULT_ROOT || '/data/vault',
  TRASH_PATH: process.env.TRASH_PATH || '/data/trash',
  DB_PATH: process.env.DB_PATH || '/data/state.db',

  // Security
  API_KEY: process.env.API_KEY || '',
  JWT_SECRET: process.env.JWT_SECRET || '',
  JWT_ACCESS_EXPIRY: '15m',
  JWT_REFRESH_EXPIRY: '7d',

  // Admin user
  ADMIN_EMAIL: process.env.ADMIN_EMAIL || '',
  ADMIN_PASSWORD_HASH: process.env.ADMIN_PASSWORD_HASH || '',

  // File limits
  MAX_FILE_SIZE_MB: parseInt(process.env.MAX_FILE_SIZE_MB || '100', 10),
  MAX_FILE_SIZE_BYTES: parseInt(process.env.MAX_FILE_SIZE_MB || '100', 10) * 1024 * 1024,

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: 60 * 1000, // 1 minute
  RATE_LIMIT_MAX_REQUESTS: 100,
  RATE_LIMIT_AUTH_MAX: 5, // Stricter for auth endpoints

  // File whitelist
  ALLOWED_EXTENSIONS: new Set([
    '.md', '.txt', '.csv', '.json', '.yaml', '.yml', '.xml', '.html', '.css', '.js', '.ts',
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.tiff',
    '.pdf', '.docx', '.xlsx', '.pptx',
    '.mp3', '.wav', '.ogg', '.m4a', '.flac',
    '.mp4', '.mov', '.avi', '.mkv', '.webm',
    '.zip', '.tar', '.gz'
  ]),

  // Validate required config on startup
  validate() {
    const required = ['API_KEY', 'JWT_SECRET', 'ADMIN_EMAIL', 'ADMIN_PASSWORD_HASH'];
    const missing = required.filter(key => !this[key]);

    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }

    if (this.API_KEY.length < 32) {
      throw new Error('API_KEY must be at least 32 characters');
    }

    if (this.JWT_SECRET.length < 32) {
      throw new Error('JWT_SECRET must be at least 32 characters');
    }
  }
};
