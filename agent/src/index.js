import { config } from './config.js';
import { getStateDB, fileOps } from './state-store.js';
import Watcher from './watcher.js';
import SyncClient from './sync-client.js';
import { readFileForSync, getRelativePath } from './file-handler.js';
import { promises as fsPromises } from 'fs';
import { join } from 'path';
import fs from 'fs';
import { createHash } from 'crypto';

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
      console.log(`📁 Vault(s): ${config.VAULT_ROOTS.length} found`);
      config.VAULT_ROOTS.forEach((vault, i) => console.log(`   ${i + 1}. ${vault}`));
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

    // Watch all vault roots
    const watchPaths = config.VAULT_ROOTS;

    this.watcher = new Watcher(async (path, type) => {
      if (this.shutdownInProgress) return;

      // Process file change
      await this.handleFileChange(path, type);
    }, watchPaths);

    this.watcher.start();
  }

  async handleFileChange(path, type) {
    try {
      // Find which vault this file belongs to
      let vaultName = null;
      let vaultRoot = null;
      let relativePath = null;

      for (const root of config.VAULT_ROOTS) {
        if (path.startsWith(root)) {
          vaultRoot = root;
          vaultName = root.split('/').filter(Boolean).pop();
          // Get relative path by removing the vault root
          relativePath = path.substring(root.length + 1);
          break;
        }
      }

      if (!vaultRoot) {
        console.log(`⏭️  Skipping file change: ${path} (vault not found)`);
        return;
      }

      // Create vault-prefixed path
      const vaultPrefixedPath = `${vaultName}/${relativePath}`;

      if (type === 'delete') {
        console.log(`🗑️  Deleting file: ${vaultPrefixedPath}`);
        this.syncClient.sendFileDelete(vaultPrefixedPath);
        fileOps.delete(this.db, vaultPrefixedPath);
        return;
      }

      // Upload new/modified file
      await this.uploadFile(vaultPrefixedPath);

    } catch (error) {
      console.error(`Error handling file change: ${error.message}`);
    }
  }

  async uploadFile(path) {
    try {
      // Path should be in vault-prefixed format: "vaultName/relative/path"
      const pathParts = path.split('/');
      const vaultName = pathParts[0];
      const relativePath = pathParts.slice(1).join('/');

      // Find the vault root
      const vaultRoot = config.VAULT_ROOTS.find(root => {
        const rootName = root.split('/').filter(Boolean).pop();
        return rootName === vaultName;
      });

      if (!vaultRoot) {
        console.log(`⏭️  Skipping file: ${path} (vault "${vaultName}" not found)`);
        return;
      }

      const fullPath = join(vaultRoot, relativePath);
      const fileData = await readFileForSync(fullPath);

      if (!fileData) {
        console.log(`⏭️  Skipping file: ${path} (ignored or error)`);
        return;
      }

      // Override the path in fileData with the vault-prefixed version
      fileData.path = path;

      // Check if changed
      const existing = fileOps.get(this.db, path);
      if (existing && existing.hash === fileData.hash) {
        console.log(`⏭️  Skipping unchanged file: ${path}`);
        return;
      }

      console.log(`📤 Uploading: ${path} (vault: ${vaultName})`);

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
      // Extract vault name and relative path
      const pathParts = fileData.path.split('/');
      const vaultName = pathParts[0];
      const relativePath = pathParts.slice(1).join('/');

      // Find the vault root
      const vaultRoot = config.VAULT_ROOTS.find(root => {
        const rootName = root.split('/').filter(Boolean).pop();
        return rootName === vaultName;
      });

      if (!vaultRoot) {
        console.log(`⏭️  Skipping download: ${fileData.path} (vault not found)`);
        return;
      }

      const fullPath = join(vaultRoot, relativePath);

      console.log(`📥 Downloading: ${fileData.path} (vault: ${vaultName})`);

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
      // Extract vault name and relative path
      const pathParts = fileData.path.split('/');
      const vaultName = pathParts[0];
      const relativePath = pathParts.slice(1).join('/');

      // Find the vault root
      const vaultRoot = config.VAULT_ROOTS.find(root => {
        const rootName = root.split('/').filter(Boolean).pop();
        return rootName === vaultName;
      });

      if (!vaultRoot) {
        console.log(`⏭️  Skipping write: ${fileData.path} (vault not found)`);
        return;
      }

      const fullPath = join(vaultRoot, relativePath);

      console.log(`📥 Writing file from server: ${fileData.path} (vault: ${vaultName})`);

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
      // Extract vault name and relative path
      const pathParts = path.split('/');
      const vaultName = pathParts[0];
      const relativePath = pathParts.slice(1).join('/');

      // Find the vault root
      const vaultRoot = config.VAULT_ROOTS.find(root => {
        const rootName = root.split('/').filter(Boolean).pop();
        return rootName === vaultName;
      });

      if (!vaultRoot) {
        console.log(`⏭️  Skipping delete: ${path} (vault not found)`);
        return;
      }

      const fullPath = join(vaultRoot, relativePath);

      console.log(`🗑️  Deleting local file: ${path} (vault: ${vaultName})`);

      await fsPromises.unlink(fullPath);
      fileOps.delete(this.db, path);

    } catch (error) {
      console.error(`Error deleting file ${path}:`, error.message);
    }
  }

  async renameLocalFile(oldPath, newPath) {
    try {
      const fs = require('fs');

      // Extract vault names and relative paths
      const oldPathParts = oldPath.split('/');
      const newPathParts = newPath.split('/');
      const oldVaultName = oldPathParts[0];
      const newVaultName = newPathParts[0];
      const oldRelativePath = oldPathParts.slice(1).join('/');
      const newRelativePath = newPathParts.slice(1).join('/');

      // Find the vault roots
      const oldVaultRoot = config.VAULT_ROOTS.find(root => root.endsWith(oldVaultName));
      const newVaultRoot = config.VAULT_ROOTS.find(root => root.endsWith(newVaultName));

      if (!oldVaultRoot || !newVaultRoot) {
        console.log(`⏭️  Skipping rename: vault(s) not found`);
        return;
      }

      const fullOldPath = join(oldVaultRoot, oldRelativePath);
      const fullNewPath = join(newVaultRoot, newRelativePath);

      console.log(`📝 Renaming: ${oldPath} -> ${newPath}`);

      await fs.promises.rename(fullOldPath, fullNewPath);
      fileOps.rename(this.db, oldPath, newPath);

    } catch (error) {
      console.error(`Error renaming file:`, error.message);
    }
  }

  async scanVault() {
    const files = [];

    // Scan all vault roots
    for (const vaultRoot of config.VAULT_ROOTS) {
      const vaultName = vaultRoot.split('/').filter(Boolean).pop();
      console.log(`📂 Scanning vault: ${vaultName} (${vaultRoot})`);

      const scanDir = (dir) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = join(dir, entry.name);

          // Create vault-prefixed path for tracking
          let relativePath = fullPath.substring(vaultRoot.length);
          if (relativePath.startsWith('/')) {
            relativePath = relativePath.substring(1);
          }
          const vaultPrefixedPath = `${vaultName}/${relativePath}`;

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
              const content = fs.readFileSync(fullPath);
              const hash = 'sha256:' + createHash('sha256').update(content).digest('hex');

              files.push({
                path: vaultPrefixedPath,
                hash: hash,
                mtime: stats.mtimeMs,
                vault: vaultName
              });
            } catch (error) {
              // Skip files that can't be read
            }
          }
        }
      };

      scanDir(vaultRoot);
    }

    console.log(`📊 Total files found: ${files.length}`);
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
