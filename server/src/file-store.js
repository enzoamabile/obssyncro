import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, renameSync, statSync } from 'fs';
import { join, dirname, basename } from 'path';
import { config } from './config.js';
import { validateExtension, getMimeType } from './middleware/file-validator.js';

/**
 * File Store - Manages file I/O operations on vault
 */
class FileStore {
  constructor() {
    // Ensure directories exist
    this.ensureDir(config.VAULT_ROOT);
    this.ensureDir(config.TRASH_PATH);

    console.log(`📁 File Store initialized`);
    console.log(`   Vault: ${config.VAULT_ROOT}`);
    console.log(`   Trash: ${config.TRASH_PATH}`);
  }

  ensureDir(path) {
    if (!existsSync(path)) {
      mkdirSync(path, { recursive: true });
    }
  }

  /**
   * Get full file path in vault
   * relativePath format: "vault-name/subfolder/file.md"
   */
  getVaultPath(relativePath) {
    // Security: prevent path traversal
    const normalized = relativePath.replace(/\.\./g, '').replace(/^\/+/, '');

    if (normalized.startsWith('/')) {
      throw new Error('Absolute paths not allowed');
    }

    if (normalized.includes('..')) {
      throw new Error('Path traversal not allowed');
    }

    // Extract vault name from path (first directory component)
    const parts = normalized.split('/');
    if (parts.length === 0 || parts[0] === '') {
      throw new Error('Invalid path: missing vault name');
    }

    const vaultName = parts[0];
    
    // Create vault directory if it doesn't exist
    const vaultDir = join(config.VAULT_ROOT, vaultName);
    this.ensureDir(vaultDir);

    // Return full path within vault directory
    const remainingPath = parts.slice(1).join('/');
    return remainingPath ? join(vaultDir, remainingPath) : vaultDir;
  }

  /**
   * Read file from vault
   */
  read(relativePath) {
    const fullPath = this.getVaultPath(relativePath);

    if (!existsSync(fullPath)) {
      return null;
    }

    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      throw new Error('Cannot read directory as file');
    }

    const content = readFileSync(fullPath);
    const mime = getMimeType(relativePath);

    return {
      path: relativePath,
      content: content.toString('base64'),
      size: stats.size,
      mime,
      mtime: stats.mtimeMs
    };
  }

  /**
   * Write file to vault
   */
  write(relativePath, base64Content, mime = null) {
    const fullPath = this.getVaultPath(relativePath);

    // Validate extension
    if (!validateExtension(relativePath)) {
      throw new Error(`File extension not allowed: ${relativePath}`);
    }

    // Ensure parent directory exists
    this.ensureDir(dirname(fullPath));

    // Decode base64 content
    const content = Buffer.from(base64Content, 'base64');

    // Check file size
    if (content.length > config.MAX_FILE_SIZE_BYTES) {
      throw new Error(`File too large: ${content.length} bytes`);
    }

    // Write file
    writeFileSync(fullPath, content);

    const stats = statSync(fullPath);

    return {
      path: relativePath,
      size: stats.size,
      mime: mime || getMimeType(relativePath),
      mtime: stats.mtimeMs
    };
  }

  /**
   * Create folder
   */
  createFolder(relativePath) {
    const fullPath = this.getVaultPath(relativePath);

    if (existsSync(fullPath)) {
      throw new Error(`Path already exists: ${relativePath}`);
    }

    mkdirSync(fullPath, { recursive: true });

    return {
      path: relativePath,
      type: 'folder',
      mtime: Date.now()
    };
  }

  /**
   * Soft delete file (alias for delete)
   */
  softDelete(relativePath) {
    return this.delete(relativePath);
  }

  /**
   * Delete file (move to trash)
   */
  delete(relativePath) {
    const fullPath = this.getVaultPath(relativePath);

    if (!existsSync(fullPath)) {
      return false;
    }

    // Move to trash instead of permanent delete
    const timestamp = Date.now();
    const trashPath = join(config.TRASH_PATH, timestamp.toString(), relativePath);

    // Ensure trash directory structure exists
    this.ensureDir(dirname(trashPath));

    // Move to trash
    renameSync(fullPath, trashPath);

    return {
      originalPath: relativePath,
      trashPath,
      timestamp
    };
  }

  /**
   * Rename/move file
   */
  rename(oldPath, newPath) {
    const fullOldPath = this.getVaultPath(oldPath);
    const fullNewPath = this.getVaultPath(newPath);

    if (!existsSync(fullOldPath)) {
      throw new Error(`File not found: ${oldPath}`);
    }

    // Validate new path extension
    if (!validateExtension(newPath)) {
      throw new Error(`File extension not allowed: ${newPath}`);
    }

    // Ensure target directory exists
    this.ensureDir(dirname(fullNewPath));

    // Rename/move
    renameSync(fullOldPath, fullNewPath);

    const stats = statSync(fullNewPath);

    return {
      oldPath,
      newPath,
      size: stats.size,
      mtime: stats.mtimeMs
    };
  }

  /**
   * Check if file exists
   */
  exists(relativePath) {
    try {
      const fullPath = this.getVaultPath(relativePath);
      return existsSync(fullPath) && !statSync(fullPath).isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Get file stats without reading content
   */
  stats(relativePath) {
    const fullPath = this.getVaultPath(relativePath);

    if (!existsSync(fullPath)) {
      return null;
    }

    const stats = statSync(fullPath);

    return {
      path: relativePath,
      size: stats.size,
      mtime: stats.mtimeMs,
      isDirectory: stats.isDirectory()
    };
  }

  /**
   * List directory contents
   */
  list(relativePath = '') {
    const fullPath = this.getVaultPath(relativePath);

    if (!existsSync(fullPath)) {
      return [];
    }

    const fs = require('fs');
    const items = fs.readdirSync(fullPath, { withFileTypes: true });

    return items.map(item => ({
      name: item.name,
      path: join(relativePath, item.name).replace(/\\/g, '/'),
      isDirectory: item.isDirectory()
    }));
  }

  /**
   * Restore file from trash
   */
  restoreFromTrash(trashPath) {
    const fullTrashPath = join(config.TRASH_PATH, trashPath);

    if (!existsSync(fullTrashPath)) {
      throw new Error('Trash file not found');
    }

    // Extract original path from trash path
    // trashPath format: {timestamp}/{originalPath}
    const parts = trashPath.split('/');
    const originalPath = parts.slice(1).join('/');

    const fullOriginalPath = this.getVaultPath(originalPath);

    // Ensure target directory exists
    this.ensureDir(dirname(fullOriginalPath));

    // Restore
    renameSync(fullTrashPath, fullOriginalPath);

    return { path: originalPath };
  }

  /**
   * Permanently delete from trash (old files cleanup)
   */
  permanentDelete(trashPath) {
    const fullTrashPath = join(config.TRASH_PATH, trashPath);

    if (existsSync(fullTrashPath)) {
      const fs = require('fs');
      fs.rmSync(fullTrashPath, { recursive: true, force: true });
      return true;
    }

    return false;
  }

  /**
   * Clean old trash files (older than specified days)
   */
  cleanTrash(maxAgeDays = 30) {
    const fs = require('fs');
    const now = Date.now();
    const maxAge = maxAgeDays * 24 * 60 * 60 * 1000;
    let deleted = 0;

    const timestamps = fs.readdirSync(config.TRASH_PATH);

    for (const timestamp of timestamps) {
      const timestampPath = join(config.TRASH_PATH, timestamp);
      const stats = statSync(timestampPath);

      if (now - stats.mtimeMs > maxAge) {
        fs.rmSync(timestampPath, { recursive: true, force: true });
        deleted++;
      }
    }

    return deleted;
  }
}

export default FileStore;
