import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { dirname } from 'path';
import { config } from './config.js';

let db = null;

export function getStateDB() {
  if (db) return db;

  const dbPath = config.DB_PATH;

  // Create parent directory if needed
  const dbDir = dirname(dbPath);
  if (!existsSync(dbDir)) {
    const fs = require('fs');
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(dbPath);

  // Enable WAL mode
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Initialize schema (simplified vs server)
  initializeSchema(db);

  return db;
}

function initializeSchema(database) {
  // Files table - local manifest
  database.exec(`
    CREATE TABLE IF NOT EXISTS files (
      path          TEXT    PRIMARY KEY,
      hash          TEXT    NOT NULL,
      size          INTEGER NOT NULL DEFAULT 0,
      mime          TEXT,
      mtime         INTEGER NOT NULL,
      synced_at     INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_files_mtime ON files(mtime);
  `);
}

// File operations
export const fileOps = {
  upsert(db, file) {
    const stmt = db.prepare(`
      INSERT INTO files (path, hash, size, mime, mtime, synced_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        hash = excluded.hash,
        size = excluded.size,
        mime = excluded.mime,
        mtime = excluded.mtime,
        synced_at = excluded.synced_at
    `);

    return stmt.run(
      file.path,
      file.hash,
      file.size || 0,
      file.mime || null,
      file.mtime,
      file.synced_at || Date.now()
    );
  },

  get(db, path) {
    const stmt = db.prepare('SELECT * FROM files WHERE path = ?');
    return stmt.get(path);
  },

  getAll(db) {
    const stmt = db.prepare('SELECT * FROM files');
    return stmt.all();
  },

  delete(db, path) {
    const stmt = db.prepare('DELETE FROM files WHERE path = ?');
    return stmt.run(path);
  },

  rename(db, oldPath, newPath) {
    const stmt = db.prepare('UPDATE files SET path = ? WHERE path = ?');
    return stmt.run(newPath, oldPath);
  },

  getManifest(db) {
    const stmt = db.prepare('SELECT path, hash, mtime FROM files');
    return stmt.all();
  }
};
