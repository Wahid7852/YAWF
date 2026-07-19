'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROLES = ['viewer', 'operator', 'admin'];
const KEY_PREFIX = 'yawf_k1_';

function hashKey(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

function generateRawKey() {
  return KEY_PREFIX + crypto.randomBytes(24).toString('base64url');
}

/** Flat JSON store of API keys, mirrors settings.js's load/save/defaults idiom. */
class ApiKeyStore {
  constructor(userDataDir) {
    this._file = path.join(userDataDir, 'api-keys.json');
    this._data = this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this._file, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  _save() {
    fs.mkdirSync(path.dirname(this._file), { recursive: true });
    fs.writeFileSync(this._file, JSON.stringify(this._data, null, 2));
  }

  list() {
    // Never return keyHash outside the store - callers only need displayable metadata.
    return this._data.map(({ keyHash: _keyHash, ...rest }) => ({ ...rest }));
  }

  get(id) {
    const record = this._data.find((k) => k.id === id);
    if (!record) return null;
    const { keyHash: _keyHash, ...rest } = record;
    return { ...rest };
  }

  /** Returns { record, rawKey } - rawKey is never persisted and only available here. */
  create({ name, role = 'operator', allowedIps = [], expiresAt = null }) {
    if (!ROLES.includes(role)) throw new Error(`Invalid role "${role}": must be one of ${ROLES.join(', ')}`);
    const rawKey = generateRawKey();
    const record = {
      id: crypto.randomUUID(),
      name: name || 'unnamed key',
      keyPrefix: rawKey.slice(0, KEY_PREFIX.length + 6),
      keyHash: hashKey(rawKey),
      role,
      allowedIps,
      expiresAt,
      isActive: true,
      lastUsedAt: null,
      usageCount: 0,
      createdAt: new Date().toISOString(),
    };
    this._data.push(record);
    this._save();
    const { keyHash: _keyHash, ...displayRecord } = record;
    return { record: displayRecord, rawKey };
  }

  /** Updates only the safe, non-secret metadata fields - never role or the key itself. */
  update(id, { name, allowedIps, expiresAt } = {}) {
    const record = this._data.find((k) => k.id === id);
    if (!record) return null;
    if (name !== undefined) record.name = name;
    if (allowedIps !== undefined) record.allowedIps = allowedIps;
    if (expiresAt !== undefined) record.expiresAt = expiresAt;
    this._save();
    const { keyHash: _keyHash, ...rest } = record;
    return { ...rest };
  }

  revoke(id) {
    const record = this._data.find((k) => k.id === id);
    if (!record) return false;
    record.isActive = false;
    this._save();
    return true;
  }

  remove(id) {
    const before = this._data.length;
    this._data = this._data.filter((k) => k.id !== id);
    if (this._data.length === before) return false;
    this._save();
    return true;
  }

  /** Looks up a presented raw key via constant-time hash comparison. Updates usage stats on success. */
  verify(rawKey) {
    if (!rawKey) return null;
    const presentedHash = Buffer.from(hashKey(rawKey), 'hex');
    let match = null;
    for (const record of this._data) {
      const storedHash = Buffer.from(record.keyHash, 'hex');
      if (storedHash.length === presentedHash.length && crypto.timingSafeEqual(storedHash, presentedHash)) {
        match = record;
        // Deliberately don't break early on a would-be match found via non-constant-time
        // means - iterate the whole list every call so lookup time doesn't leak position.
      }
    }
    if (!match) return null;
    if (!match.isActive) return null;
    if (match.expiresAt && new Date(match.expiresAt).getTime() < Date.now()) return null;
    match.lastUsedAt = new Date().toISOString();
    match.usageCount += 1;
    this._save();
    const { keyHash: _keyHash, ...rest } = match;
    return { ...rest };
  }
}

module.exports = { ApiKeyStore, ROLES, KEY_PREFIX };
