import { config } from './config.js';
import { getStateDB, fileOps } from './state-store.js';
import Watcher from './watcher.js';
import SyncClient from './sync-client.js';
import { readFileForSync, getRelativePath } from './file-handler.js';
import { promises as fsPromises } from 'fs';
import { join } from 'path';
import fs from 'fs';

class ObsidianSyncAgent {
  constructor() {
    this.db = getStateDB();
    this.watcher = null;
    this.syncClient = null;
    this.shutdownInProgress = false;
  }

  async start() {
    try {
      console.log('🚀 Obsidian Sync Agent starting...');
      console.log(`📁 Vault: ${config.VAULT_ROOT}`);
      console.log(`🌐 Server: ${config.SERVER_URL}`);

      // Validate configuration
      config.validate();

      // Initialize sync client
      this.syncClient = new SyncClient();
      this.setupSyncClientHandlers();

      // Connect to server
      this.syncClient.connect();

      // Wait for connection and then start watcher
      console.log('⏳ Waiting for connection...');

    } catch (error) {
      console.error('❌ Failed to start agent:', error);
      process.exit(1);
    }
  }

  setupSyncClientHandlers() {
    // When connected, send initial manifest and start watcher
    this.syncClient.on('connected', async () => {
      console.log('📋 Preparing initial sync...');

      // Scan vault
      const files = await this.scanVault();

      // Send manifest
      this.syncClient.sendManifest(files);
    });

    // Handle sync delta
    this.syncClient.on('sync_delta', async (message) => {
      const { push_to_server, pull_from_server } = message;

      console.log(`📊 Sync delta: ${push_to_server.length} files to push, ${pull_from_server.length} to pull`);

      // Process files to push (modified/new locally)
      for (const path of push_to_server) {
        await this.uploadFile(path);
      }

      // Process files to pull (modified/new on server)
      for (const file of pull_from_server) {
        await this.downloadFile(file);
      }

      // Start watching for changes
      if (!this.watcher) {
        this.startWatcher();
      }
    });

    // Handle file upsert from server
    this.syncClient.on('file_upsert', async (fileData) => {
      await this.writeReceivedFile(fileData);
    });

    // Handle file delete from server
    this.syncClient.on('file_delete', async (path) => {
      await this.deleteLocalFile(path);
    });

    // Handle file rename from server
    this.syncClient.on('file_rename', async (payload) => {
      await this.renameLocalFile(payload.old_path, payload.new_path);
    });

    // Handle conflicts
    this.syncClient.on('conflict', (message) => {
      console.log(`⚠️  Conflict detected: ${message.original_path}`);
      console.log(`   Conflict copy: ${message.conflict_path}`);
      // Conflict copy already created by server, just log it
    });

    // Handle errors
    this.syncClient.on('error', (message) => {
      console.error('❌ Sync error:', message.message);
    });
  }

  startWatcher() {
    console.log('👀 Starting file watcher...');

    this.watcher = new Watcher(async (path, type) => {
      if (this.shutdownInProgress) return;

      // Process file change
      await this.handleFileChange(path, type);
    });

    this.watcher.start();
  }

  async handleFileChange(path, type) {
    try {
      const relativePath = getRelativePath(path);

      if (type === 'delete') {
        console.log(`🗑️  Deleting file: ${relativePath}`);
        this.syncClient.sendFileDelete(relativePath);
        fileOps.delete(this.db, relativePath);
        return;
      }

      // Upload new/modified file
      await this.uploadFile(relativePath);

    } catch (error) {
      console.error(`Error handling file change: ${error.message}`);
    }
  }

  async uploadFile(path) {
    try {
      const fullPath = join(config.VAULT_ROOT, path);
      const fileData = await readFileForSync(fullPath);

      if (!fileData) {
        console.log(`⏭️  Skipping file: ${path} (ignored or error)`);
        return;
      }

      // Check if changed
      const existing = fileOps.get(this.db, path);
      if (existing && existing.hash === fileData.hash) {
        console.log(`⏭️  Skipping unchanged file: ${path}`);
        return;
      }

      console.log(`📤 Uploading: ${path}`);

      // Send to server
      this.syncClient.sendFileUpsert(fileData);

      // Update local database
      fileOps.upsert(this.db, fileData);

    } catch (error) {
      console.error(`Error uploading file ${path}:`, error.message);
    }
  }

  async downloadFile(fileData) {
    try {
      const fullPath = join(config.VAULT_ROOT, fileData.path);

      console.log(`📥 Downloading: ${fileData.path}`);

      // Write file to disk
      const content = Buffer.from(fileData.content, 'base64');
      await fsPromises.writeFile(fullPath, content);

      // Update local database (prevent echo)
      fileOps.upsert(this.db, {
        path: fileData.path,
        hash: fileData.hash,
        size: fileData.size,
        mime: fileData.mime,
        mtime: fileData.mtime,
        synced_at: Date.now()
      });

    } catch (error) {
      console.error(`Error downloading file ${fileData.path}:`, error.message);
    }
  }

  async writeReceivedFile(fileData) {
    try {
      const fullPath = join(config.VAULT_ROOT, fileData.path);

      console.log(`📥 Writing file from server: ${fileData.path}`);

      // Write file
      const content = Buffer.from(fileData.content, 'base64');
      await fsPromises.writeFile(fullPath, content);

      // Update local database immediately (anti-loop)
      fileOps.upsert(this.db, {
        path: fileData.path,
        hash: fileData.hash,
        size: fileData.size,
        mime: fileData.mime,
        mtime: fileData.mtime,
        synced_at: Date.now()
      });

    } catch (error) {
      console.error(`Error writing file ${fileData.path}:`, error.message);
    }
  }

  async deleteLocalFile(path) {
    try {
      const fullPath = join(config.VAULT_ROOT, path);

      console.log(`🗑️  Deleting local file: ${path}`);

      await fsPromises.unlink(fullPath);
      fileOps.delete(this.db, path);

    } catch (error) {
      console.error(`Error deleting file ${path}:`, error.message);
    }
  }

  async renameLocalFile(oldPath, newPath) {
    try {
      const fs = require('fs');
      const fullOldPath = join(config.VAULT_ROOT, oldPath);
      const fullNewPath = join(config.VAULT_ROOT, newPath);

      console.log(`📝 Renaming: ${oldPath} -> ${newPath}`);

      await fs.promises.rename(fullOldPath, fullNewPath);
      fileOps.rename(this.db, oldPath, newPath);

    } catch (error) {
      console.error(`Error renaming file: ${error.message}`);
    }
  }

  async scanVault() {
    const files = [];

    const scanDir = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        const relativePath = getRelativePath(fullPath);

        // Skip ignored
        if (config.IGNORE_PATTERNS.some(pattern => {
          const regexPattern = pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*');
          return new RegExp(`^${regexPattern}$`).test(relativePath);
        })) {
          continue;
        }

        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.isFile()) {
          try {
            const stats = fs.statSync(fullPath);
            const { createHash } = require('crypto');
            const content = fs.readFileSync(fullPath);
            const hash = 'sha256:' + createHash('sha256').update(content).digest('hex');

            files.push({
              path: relativePath,
              hash: hash,
              mtime: stats.mtimeMs
            });
          } catch (error) {
            // Skip files that can't be read
          }
        }
      }
    };

    scanDir(config.VAULT_ROOT);

    return files;
  }

  async shutdown() {
    if (this.shutdownInProgress) return;
    this.shutdownInProgress = true;

    console.log('🛑 Shutting down agent...');

    // Stop watcher
    if (this.watcher) {
      await this.watcher.stop();
    }

    // Disconnect from server
    if (this.syncClient) {
      this.syncClient.disconnect();
    }

    // Close database
    if (this.db) {
      this.db.close();
    }

    console.log('✅ Agent stopped');
  }
}

// Start agent
const agent = new ObsidianSyncAgent();
agent.start().catch(error => {
  console.error('Failed to start agent:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received');
  agent.shutdown().then(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('SIGINT received');
  agent.shutdown().then(() => process.exit(0));
});

export { ObsidianSyncAgent };
