import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { config } from './config.js';

let db = null;

export function getStateDB() {
  if (db) return db;

  // Ensure directory exists
  const dbDir = dirname(config.DB_PATH);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(config.DB_PATH);

  // Enable WAL mode for better concurrency
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Initialize schema
  initializeSchema(db);

  return db;
}

function initializeSchema(database) {
  // Files table - manifest of all synced files
  database.exec(`
    CREATE TABLE IF NOT EXISTS files (
      path          TEXT    PRIMARY KEY,
      hash          TEXT    NOT NULL,
      size          INTEGER NOT NULL DEFAULT 0,
      mime          TEXT,
      mtime         INTEGER NOT NULL,
      modified_by   TEXT,
      synced_at     INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_files_mtime ON files(mtime);
  `);

  // Sessions table - active connections (server-side only)
  database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id    TEXT    PRIMARY KEY,
      type          TEXT    NOT NULL,
      last_seen     INTEGER NOT NULL,
      ip            TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_last_seen ON sessions(last_seen);
  `);

  // Sync log table - audit trail
  database.exec(`
    CREATE TABLE IF NOT EXISTS sync_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      path          TEXT    NOT NULL,
      action        TEXT    NOT NULL,
      session_id    TEXT,
      old_path      TEXT,
      conflict_path TEXT,
      timestamp     INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_log_path ON sync_log(path);
    CREATE INDEX IF NOT EXISTS idx_log_timestamp ON sync_log(timestamp);
  `);
}

// File operations
export const fileOps = {
  upsert(db, file) {
    const stmt = db.prepare(`
      INSERT INTO files (path, hash, size, mime, mtime, modified_by, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        hash = excluded.hash,
        size = excluded.size,
        mime = excluded.mime,
        mtime = excluded.mtime,
        modified_by = excluded.modified_by,
        synced_at = excluded.synced_at
    `);

    return stmt.run(
      file.path,
      file.hash,
      file.size || 0,
      file.mime || null,
      file.mtime,
      file.modified_by || null,
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

// Session operations
export const sessionOps = {
  upsert(db, session) {
    const stmt = db.prepare(`
      INSERT INTO sessions (session_id, type, last_seen, ip)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        last_seen = excluded.last_seen,
        ip = excluded.ip
    `);

    return stmt.run(session.session_id, session.type, session.last_seen || Date.now(), session.ip || null);
  },

  get(db, sessionId) {
    const stmt = db.prepare('SELECT * FROM sessions WHERE session_id = ?');
    return stmt.get(sessionId);
  },

  delete(db, sessionId) {
    const stmt = db.prepare('DELETE FROM sessions WHERE session_id = ?');
    return stmt.run(sessionId);
  },

  cleanupStale(db, olderThanMs = 5 * 60 * 1000) { // 5 minutes
    const threshold = Date.now() - olderThanMs;
    const stmt = db.prepare('DELETE FROM sessions WHERE last_seen < ?');
    return stmt.run(threshold);
  }
};

// Sync log operations
export const logOps = {
  add(db, entry) {
    const stmt = db.prepare(`
      INSERT INTO sync_log (path, action, session_id, old_path, conflict_path, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    return stmt.run(
      entry.path,
      entry.action,
      entry.session_id || null,
      entry.old_path || null,
      entry.conflict_path || null,
      entry.timestamp || Date.now()
    );
  },

  getRecent(db, limit = 100) {
    const stmt = db.prepare('SELECT * FROM sync_log ORDER BY timestamp DESC LIMIT ?');
    return stmt.all(limit);
  }
};
