'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_BACKUPS = 3;

/**
 * Append-only JSONL audit log at <userData>/api-audit.jsonl, one line per API
 * request. Also an EventEmitter so the dashboard can live-tail via 'entry'.
 * Bodies are never included by the caller unless apiAuditLogBodies is on -
 * that policy lives in the caller (auth.js/server.js), not here.
 */
class AuditLog extends EventEmitter {
  constructor(userDataDir, { maxBytes = DEFAULT_MAX_BYTES, maxBackups = DEFAULT_BACKUPS } = {}) {
    super();
    this._file = path.join(userDataDir, 'api-audit.jsonl');
    this._maxBytes = maxBytes;
    this._maxBackups = maxBackups;
  }

  append(entry) {
    const record = { ts: new Date().toISOString(), ...entry };
    fs.mkdirSync(path.dirname(this._file), { recursive: true });
    this._rotateIfNeeded();
    fs.appendFileSync(this._file, JSON.stringify(record) + '\n');
    this.emit('entry', record);
    return record;
  }

  _rotateIfNeeded() {
    let size;
    try {
      size = fs.statSync(this._file).size;
    } catch {
      return; // file doesn't exist yet, nothing to rotate
    }
    if (size < this._maxBytes) return;
    for (let i = this._maxBackups - 1; i >= 1; i--) {
      const src = `${this._file}.${i}.jsonl`;
      const dest = `${this._file}.${i + 1}.jsonl`;
      if (fs.existsSync(src)) fs.renameSync(src, dest);
    }
    fs.renameSync(this._file, `${this._file}.1.jsonl`);
    // Drop anything past the retention window instead of growing unbounded.
    const overflow = `${this._file}.${this._maxBackups + 1}.jsonl`;
    if (fs.existsSync(overflow)) fs.rmSync(overflow);
  }

  /** Returns entries newest-first, optionally filtered to since a given ISO timestamp. */
  read({ since = null, limit = 100 } = {}) {
    let raw;
    try {
      raw = fs.readFileSync(this._file, 'utf8');
    } catch {
      return [];
    }
    const sinceMs = since ? new Date(since).getTime() : null;
    const entries = raw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .filter((e) => !sinceMs || new Date(e.ts).getTime() >= sinceMs)
      .reverse();
    return entries.slice(0, limit);
  }
}

module.exports = { AuditLog };
