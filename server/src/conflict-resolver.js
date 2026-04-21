import { config } from './config.js';
import { fileOps, logOps } from './state-db.js';
import FileStore from './file-store.js';

/**
 * Conflict Resolver - Last Write Wins + Conflict Copy
 */
class ConflictResolver {
  constructor(db, fileStore) {
    this.db = db;
    this.fileStore = fileStore;
  }

  /**
   * Check if upsert creates a conflict
   * Conflict = same file, different hash, incoming mtime > server mtime
   */
  async checkConflict(fileData) {
    const existing = fileOps.get(this.db, fileData.path);

    if (!existing) {
      return null; // No conflict, new file
    }

    // Same hash = no change
    if (existing.hash === fileData.hash) {
      return null;
    }

    // Different hash = conflict if incoming is newer
    if (fileData.mtime > existing.mtime) {
      return {
        type: 'conflict',
        existing,
        incoming: fileData,
        winner: 'incoming'
      };
    }

    // Server version is newer, no conflict
    return null;
  }

  /**
   * Resolve conflict by creating a copy
   */
  async resolveConflict(conflict, sessionId) {
    const { existing, incoming } = conflict;

    // Create conflict copy filename
    const conflictPath = this.createConflictPath(existing.path);

    try {
      // Read existing file content
      const existingFile = this.fileStore.read(existing.path);

      if (existingFile) {
        // Write conflict copy
        this.fileStore.write(
          conflictPath,
          existingFile.content,
          existingFile.mime
        );

        // Log conflict
        logOps.add(this.db, {
          path: existing.path,
          action: 'conflict',
          session_id: sessionId,
          conflict_path: conflictPath,
          timestamp: Date.now()
        });

        return {
          originalPath: existing.path,
          conflictPath,
          serverMtime: existing.mtime,
          clientMtime: incoming.mtime
        };
      }

    } catch (error) {
      console.error(`Failed to create conflict copy: ${error.message}`);

      // If we can't create conflict copy, still proceed with overwrite
      // Better to lose old data than to stop sync
    }

    return null;
  }

  /**
   * Generate conflict file path
   * Format: filename.conflict-YYYY-MM-DDTHH-mm-ss.ext
   */
  createConflictPath(originalPath) {
    const date = new Date();
    const timestamp = date.toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '-')
      .replace('Z', '')
      .substring(0, 19); // 2026-04-21-10-30-00

    const parts = originalPath.split('/');
    const filename = parts.pop();
    const dir = parts.join('/');

    const [name, ...extParts] = filename.split('.');
    const ext = extParts.length > 0 ? `.${extParts.join('.')}` : '';

    const conflictFilename = `${name}.conflict-${timestamp}${ext}`;

    return dir ? `${dir}/${conflictFilename}` : conflictFilename;
  }

  /**
   * Handle deleted vs modified scenario
   * If file was deleted on one side but modified on another, the modified version wins
   */
  async resolveDeletedModified(path, deletedFrom, sessionId) {
    const existing = fileOps.get(this.db, path);

    if (!existing) {
      return null; // File doesn't exist, nothing to resolve
    }

    // File was modified after deletion attempt
    // Log this and let the modified version win
    logOps.add(this.db, {
      path,
      action: 'conflict',
      session_id: sessionId,
      old_path: deletedFrom,
      timestamp: Date.now()
    });

    return {
      type: 'deleted_modified_resolved',
      path,
      winner: 'modified',
      message: 'File was modified, keeping modified version'
    };
  }

  /**
   * Check if file is a conflict file
   */
  isConflictFile(path) {
    const filename = path.split('/').pop();
    return filename.includes('.conflict-');
  }

  /**
   * Get all conflict files in manifest
   */
  getConflictFiles() {
    const allFiles = fileOps.getAll(this.db);
    return allFiles.filter(file => this.isConflictFile(file.path));
  }
}

export default ConflictResolver;
