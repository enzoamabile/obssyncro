import { normalize, join } from 'path';

/**
 * Middleware to prevent path traversal attacks
 * Blocks paths containing '..' or absolute paths
 */
export function pathGuard(req, res, next) {
  const path = req.params?.path || req.params?.[0] || req.body?.path || req.body?.old_path || req.body?.new_path;

  if (!path) {
    return next();
  }

  // Normalize the path
  const normalized = normalize(path);

  // Check for path traversal attempts
  if (normalized.includes('..')) {
    return res.status(400).json({ error: 'Invalid path: path traversal not allowed' });
  }

  // Check for absolute paths (not allowed in relative vault)
  if (normalized.startsWith('/')) {
    return res.status(400).json({ error: 'Invalid path: absolute paths not allowed' });
  }

  // Check for null bytes
  if (path.includes('\0')) {
    return res.status(400).json({ error: 'Invalid path: null bytes not allowed' });
  }

  next();
}
