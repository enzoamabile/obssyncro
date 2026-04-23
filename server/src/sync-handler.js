import { createHash } from 'crypto';
import { config } from './config.js';
import { fileOps, logOps } from './state-db.js';
import FileStore from './file-store.js';
import ConflictResolver from './conflict-resolver.js';

/**
 * Calculate SHA-256 hash of content
 */
function calculateHash(base64Content) {
  return createHash('sha256')
    .update(Buffer.from(base64Content, 'base64'))
    .digest('hex');
}

/**
 * Sync Message Handler
 */
class SyncHandler {
  constructor(db, wsHub) {
    this.db = db;
    this.wsHub = wsHub;
    this.fileStore = new FileStore();
    this.conflictResolver = new ConflictResolver(db, this.fileStore);

    // Register message handler
    wsHub.on('message', (sessionId, message) => this.handleMessage(sessionId, message));

    console.log('🔄 Sync Handler initialized');
  }

  async handleMessage(sessionId, message) {
    try {
      switch (message.type) {
        case 'sync_manifest':
          await this.handleSyncManifest(sessionId, message);
          break;

        case 'file_upsert':
          await this.handleFileUpsert(sessionId, message);
          break;

        case 'file_delete':
          await this.handleFileDelete(sessionId, message);
          break;

        case 'file_rename':
          await this.handleFileRename(sessionId, message);
          break;

        case 'ping':
          this.handlePing(sessionId);
          break;

        default:
          console.warn(`Unknown message type: ${message.type}`);
          this.wsHub.sendTo(sessionId, {
            type: 'error',
            message: `Unknown message type: ${message.type}`
          });
      }

    } catch (error) {
      console.error(`Error handling message from ${sessionId}:`, error);
      this.wsHub.sendTo(sessionId, {
        type: 'error',
        message: error.message
      });
    }
  }

  /**
   * Handle sync_manifest - initial handshake
   */
  async handleSyncManifest(sessionId, message) {
    const { files: clientFiles } = message;
    const conn = this.wsHub.getConnection(sessionId);

    if (!conn) {
      return;
    }

    console.log(`📋 Sync manifest from ${sessionId}: ${clientFiles.length} files`);

    // Get server manifest
    const serverFiles = fileOps.getManifest(this.db);
    const serverManifest = new Map(
      serverFiles.map(f => [f.path, f])
    );

    // Calculate delta
    const pushToServer = [];
    const pullFromServer = [];

    // Check what client needs to push
    for (const clientFile of clientFiles) {
      const serverFile = serverManifest.get(clientFile.path);

      if (!serverFile) {
        // New file on client - ALWAYS push
        console.log(`📤 New file on client: ${clientFile.path}`);
        pushToServer.push(clientFile.path);
      } else if (serverFile.hash !== clientFile.hash) {
        // Hash mismatch - compare mtimes
        if (clientFile.mtime > serverFile.mtime) {
          // Client version is newer
          console.log(`📤 Newer version on client: ${clientFile.path}`);
          pushToServer.push(clientFile.path);
        } else {
          // Server version is newer
          console.log(`📥 Newer version on server: ${clientFile.path}`);
          const serverFileData = this.fileStore.read(serverFile.path);
          if (serverFileData) {
            pullFromServer.push({
              path: serverFile.path,
              content: serverFileData.content,
              hash: serverFile.hash,
              mtime: serverFile.mtime
            });
          }
        }
      } else {
        // Same hash - no action needed
        console.log(`✅ File already in sync: ${clientFile.path}`);
      }
    }

    // Check what client needs to pull (new files on server)
    for (const [path, serverFile] of serverManifest.entries()) {
      const clientFile = clientFiles.find(f => f.path === path);

      if (!clientFile) {
        // New file on server
        console.log(`📥 New file on server: ${path}`);
        const serverFileData = this.fileStore.read(path);
        if (serverFileData) {
          pullFromServer.push({
            path,
            content: serverFileData.content,
            hash: serverFile.hash,
            mtime: serverFile.mtime
          });
        }
      }
    }

    // Send sync_delta
    this.wsHub.sendTo(sessionId, {
      type: 'sync_delta',
      push_to_server: pushToServer,
      pull_from_server: pullFromServer
    });

    console.log(`📊 Sync delta: ${pushToServer.length} push, ${pullFromServer.length} pull`);
  }

  /**
   * Handle file_upsert
   */
  async handleFileUpsert(sessionId, message) {
    const { payload } = message;
    const conn = this.wsHub.getConnection(sessionId);

    if (!payload) {
      throw new Error('Missing payload');
    }

    const { path, content, hash, size, mime, mtime } = payload;

    // Verify hash
    const calculatedHash = calculateHash(content);
    if (hash && hash !== `sha256:${calculatedHash}`) {
      throw new Error('Hash mismatch');
    }

    console.log(`📝 File upsert: ${path} (${conn?.type})`);

    // Check for conflict
    const fileData = { path, hash: `sha256:${calculatedHash}`, size, mime, mtime };
    const conflict = await this.conflictResolver.checkConflict(fileData);

    if (conflict) {
      console.log(`⚠️  Conflict detected: ${path}`);

      // Resolve conflict
      const conflictResult = await this.conflictResolver.resolveConflict(conflict, sessionId);

      if (conflictResult) {
        // Notify all clients about conflict
        this.wsHub.broadcast({
          type: 'conflict_created',
          original_path: conflictResult.originalPath,
          conflict_path: conflictResult.conflictPath,
          winning_mtime: conflictResult.clientMtime,
          losing_mtime: conflictResult.serverMtime
        });
      }
    }

    // Write file
    const result = this.fileStore.write(path, content, mime);

    // Update database
    fileOps.upsert(this.db, {
      path: result.path,
      hash: `sha256:${calculatedHash}`,
      size: result.size,
      mime: result.mime,
      mtime: result.mtime,
      modified_by: sessionId,
      synced_at: Date.now()
    });

    // Log operation
    logOps.add(this.db, {
      path,
      action: 'upsert',
      session_id: sessionId,
      timestamp: Date.now()
    });

    // Broadcast to all other clients
    this.wsHub.broadcast({
      type: 'file_upsert',
      origin_session_id: sessionId,
      payload: {
        path: result.path,
        content,
        hash: `sha256:${calculatedHash}`,
        size: result.size,
        mime: result.mime,
        mtime: result.mtime
      }
    }, sessionId);

    // Acknowledge to sender
    this.wsHub.sendTo(sessionId, {
      type: 'ack',
      action: 'file_upsert',
      path,
      hash: `sha256:${calculatedHash}`
    });
  }

  /**
   * Handle file_delete
   */
  async handleFileDelete(sessionId, message) {
    const { payload } = message;

    if (!payload || !payload.path) {
      throw new Error('Missing path in payload');
    }

    const { path } = payload;

    console.log(`🗑️  File delete: ${path}`);

    // Check if file exists
    const existing = fileOps.get(this.db, path);

    if (!existing) {
      throw new Error(`File not found: ${path}`);
    }

    // Move to trash
    const result = this.fileStore.delete(path);

    // Remove from database
    fileOps.delete(this.db, path);

    // Log operation
    logOps.add(this.db, {
      path,
      action: 'trash',
      session_id: sessionId,
      old_path: result.trashPath,
      timestamp: Date.now()
    });

    // Broadcast to all other clients
    this.wsHub.broadcast({
      type: 'file_delete',
      origin_session_id: sessionId,
      payload: { path }
    }, sessionId);

    // Acknowledge
    this.wsHub.sendTo(sessionId, {
      type: 'ack',
      action: 'file_delete',
      path
    });
  }

  /**
   * Handle file_rename
   */
  async handleFileRename(sessionId, message) {
    const { payload } = message;

    if (!payload || !payload.old_path || !payload.new_path) {
      throw new Error('Missing old_path or new_path in payload');
    }

    const { old_path, new_path } = payload;

    console.log(`📝 File rename: ${old_path} -> ${new_path}`);

    // Check if old file exists
    const existing = fileOps.get(this.db, old_path);

    if (!existing) {
      throw new Error(`File not found: ${old_path}`);
    }

    // Rename file
    const result = this.fileStore.rename(old_path, new_path);

    // Update database
    fileOps.rename(this.db, old_path, new_path);

    // Log operation
    logOps.add(this.db, {
      path: new_path,
      action: 'rename',
      session_id: sessionId,
      old_path,
      timestamp: Date.now()
    });

    // Broadcast to all other clients
    this.wsHub.broadcast({
      type: 'file_rename',
      origin_session_id: sessionId,
      payload: {
        old_path,
        new_path
      }
    }, sessionId);

    // Acknowledge
    this.wsHub.sendTo(sessionId, {
      type: 'ack',
      action: 'file_rename',
      old_path,
      new_path
    });
  }

  /**
   * Handle ping
   */
  handlePing(sessionId) {
    this.wsHub.sendTo(sessionId, {
      type: 'pong',
      timestamp: Date.now()
    });
  }
}

export default SyncHandler;
