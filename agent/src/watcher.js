import chokidar from 'chokidar';
import { join } from 'path';
import { config } from './config.js';
import { readFileForSync } from './file-handler.js';

/**
 * File Watcher - Monitors vault for changes using chokidar
 */
class Watcher {
  constructor(onChange, watchPaths = null) {
    this.onChange = onChange;
    this.watchPaths = watchPaths || config.VAULT_ROOTS;
    this.watcher = null;
    this.pendingChanges = new Map(); // Debounce pending changes
    this.debounceTimers = new Map();
  }

  /**
   * Start watching vault
   */
  start() {
    console.log(`👀 Starting file watcher...`);
    console.log(`   Watching ${this.watchPaths.length} vault(s):`);
    this.watchPaths.forEach((path, i) => console.log(`   ${i + 1}. ${path}`));

    // Initialize chokidar with multiple paths
    this.watcher = chokidar.watch(this.watchPaths, {
      ignored: config.IGNORE_PATTERNS,
      persistent: true,
      ignoreInitial: false, // Process existing files on startup
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100
      },
      usePolling: false // Use native FSEvents on macOS
    });

    // Set up event handlers
    this.watcher
      .on('add', (path) => this.handleAdd(path))
      .on('change', (path) => this.handleChange(path))
      .on('unlink', (path) => this.handleDelete(path))
      .on('ready', () => this.handleReady())
      .on('error', (error) => this.handleError(error));
  }

  /**
   * Handle new file added
   */
  handleAdd(path) {
    console.log(`📄 File added: ${path}`);
    this.scheduleChange(path, 'add');
  }

  /**
   * Handle file modified
   */
  handleChange(path) {
    console.log(`✏️  File changed: ${path}`);
    this.scheduleChange(path, 'change');
  }

  /**
   * Handle file deleted
   */
  handleDelete(path) {
    console.log(`🗑️  File deleted: ${path}`);
    this.scheduleChange(path, 'delete', true); // Don't debounce delete
  }

  /**
   * Handle watcher ready (initial scan complete)
   */
  handleReady() {
    console.log(`✅ Watcher ready - scanning complete`);
  }

  /**
   * Handle watcher error
   */
  handleError(error) {
    console.error(`❌ Watcher error:`, error);
  }

  /**
   * Schedule change processing with debounce
   */
  scheduleChange(path, type, immediate = false) {
    // Clear existing timer for this path
    if (this.debounceTimers.has(path)) {
      clearTimeout(this.debounceTimers.get(path));
    }

    const processNow = () => {
      this.pendingChanges.set(path, type);

      // Trigger callback
      if (this.onChange) {
        this.onChange(path, type);
      }

      this.debounceTimers.delete(path);
    };

    if (immediate) {
      processNow();
    } else {
      const timer = setTimeout(processNow, config.WATCH_DEBOUNCE);
      this.debounceTimers.set(path, timer);
    }
  }

  /**
   * Get initial file list (for manifest)
   */
  async getInitialFiles() {
    console.log('📋 Scanning vault for initial manifest...');

    const fs = require('fs');
    const { join } = require('path');
    const files = [];

    const scanDir = async (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        const relativePath = fullPath.replace(config.VAULT_ROOT + '/', '').replace(/\\/g, '/');

        // Skip ignored patterns
        if (config.IGNORE_PATTERNS.some(pattern => {
          const regexPattern = pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*');
          return new RegExp(`^${regexPattern}$`).test(relativePath);
        })) {
          continue;
        }

        if (entry.isDirectory()) {
          await scanDir(fullPath);
        } else if (entry.isFile()) {
          try {
            const fileData = await readFileForSync(fullPath);
            if (fileData) {
              files.push({
                path: fileData.path,
                hash: fileData.hash,
                mtime: fileData.mtime
              });
            }
          } catch (error) {
            console.error(`Error scanning file ${relativePath}:`, error.message);
          }
        }
      }
    };

    await scanDir(config.VAULT_ROOT);

    console.log(`✅ Initial scan complete: ${files.length} files`);
    return files;
  }

  /**
   * Stop watching
   */
  stop() {
    console.log('🛑 Stopping file watcher...');

    // Clear all pending timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.pendingChanges.clear();

    if (this.watcher) {
      return this.watcher.close();
    }

    return Promise.resolve();
  }
}

export default Watcher;
