import { config } from '../config.js';

/**
 * MIME type mapping for common file extensions
 */
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

/**
 * Get MIME type from filename
 */
export function getMimeType(filename) {
  const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0];
  return MIME_TYPES[ext] || 'application/octet-stream';
}

/**
 * Validate file extension
 */
export function validateExtension(filename) {
  const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0];
  return ext && config.ALLOWED_EXTENSIONS.has(ext);
}

/**
 * Middleware to validate file uploads
 */
export function validateFile(req, res, next) {
  const { path, size, mime } = req.body;

  // Check extension
  if (!validateExtension(path)) {
    return res.status(400).json({
      error: `Invalid file extension. Allowed: ${Array.from(config.ALLOWED_EXTENSIONS).join(', ')}`
    });
  }

  // Check file size
  if (size > config.MAX_FILE_SIZE_BYTES) {
    return res.status(413).json({
      error: `File too large. Maximum size: ${config.MAX_FILE_SIZE_MB}MB`
    });
  }

  // Optional: verify MIME type matches extension
  const expectedMime = getMimeType(path);
  if (mime && mime !== expectedMime && mime !== 'application/octet-stream') {
    return res.status(400).json({
      error: `MIME type mismatch. Expected: ${expectedMime}, Got: ${mime}`
    });
  }

  next();
}

/**
 * Get safe filename (remove path components)
 */
export function getSafeFilename(path) {
  return path.split('/').pop().split('\\').pop();
}
