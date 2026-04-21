import { promises as fsPromises, statSync } from 'fs';
import { join, relative } from 'path';
import { createHash } from 'crypto';
import { config } from './config.js';

/**
 * Get MIME type from filename
 */
function getMimeType(filename) {
  const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0];

  const MIME_TYPES = {
    '.md': 'text/markdown',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.json': 'application/json',
    '.yaml': 'text/yaml',
    '.yml': 'text/yaml',
    '.xml': 'application/xml',
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.ts': 'application/typescript',

    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
    '.tiff': 'image/tiff',

    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',

    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.flac': 'audio/flac',

    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska',
    '.webm': 'video/webm',

    '.zip': 'application/zip',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip'
  };

  return MIME_TYPES[ext] || 'application/octet-stream';
}

/**
 * Validate file extension
 */
function validateExtension(filename) {
  const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0];
  return ext && config.ALLOWED_EXTENSIONS.has(ext);
}

/**
 * Calculate SHA-256 hash of file content
 */
function calculateHash(content) {
  return 'sha256:' + createHash('sha256').update(content).digest('hex');
}

/**
 * Get relative path from vault root
 */
function getRelativePath(fullPath) {
  return relative(config.VAULT_ROOT, fullPath).replace(/\\/g, '/');
}

/**
 * Check if file should be ignored
 */
function shouldIgnore(path) {
  const relativePath = getRelativePath(path);

  // Check against ignore patterns
  for (const pattern of config.IGNORE_PATTERNS) {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]');
    const regex = new RegExp(`^${regexPattern}$`);

    if (regex.test(relativePath)) {
      return true;
    }
  }

  return false;
}

/**
 * Read file and prepare for sync
 */
export async function readFileForSync(fullPath) {
  // Check if should be ignored
  if (shouldIgnore(fullPath)) {
    return null;
  }

  // Validate extension
  const relativePath = getRelativePath(fullPath);
  if (!validateExtension(relativePath)) {
    return null;
  }

  try {
    // Read file stats
    const stats = statSync(fullPath);

    // Skip directories
    if (stats.isDirectory()) {
      return null;
    }

    // Read file content
    const content = await fsPromises.readFile(fullPath);

    // Calculate hash
    const hash = calculateHash(content);

    // Get MIME type
    const mime = getMimeType(relativePath);

    return {
      path: relativePath,
      content: content.toString('base64'),
      hash,
      size: stats.size,
      mime,
      mtime: stats.mtimeMs
    };

  } catch (error) {
    console.error(`Error reading file ${fullPath}:`, error.message);
    return null;
  }
}

/**
 * Check if file has changed compared to local state
 */
export function hasFileChanged(db, fileData) {
  const { fileOps } = require('./state-store.js');
  const existing = fileOps.get(db, fileData.path);

  if (!existing) {
    return true; // New file
  }

  return existing.hash !== fileData.hash;
}

export {
  getRelativePath,
  shouldIgnore,
  validateExtension,
  getMimeType
};
