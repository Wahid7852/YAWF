'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const RETRY_COUNT_MIN = 0;
const RETRY_COUNT_MAX = 5;

/** Flat JSON store of registered webhooks, mirrors settings.js's load/save idiom. */
class WebhookStore {
  constructor(userDataDir) {
    this._file = path.join(userDataDir, 'webhooks.json');
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
    return this._data.map((w) => ({ ...w }));
  }

  get(id) {
    const record = this._data.find((w) => w.id === id);
    return record ? { ...record } : null;
  }

  create({ url, events = [], secret, headers = {}, filters = { conditions: [] }, retryCount = 3, active = true }) {
    if (!url) throw new Error('webhook url is required');
    if (!secret) throw new Error('webhook secret is required');
    const clampedRetryCount = Math.min(RETRY_COUNT_MAX, Math.max(RETRY_COUNT_MIN, retryCount));
    const now = new Date().toISOString();
    const record = {
      id: crypto.randomUUID(),
      url,
      events,
      secret,
      headers,
      filters,
      retryCount: clampedRetryCount,
      active,
      createdAt: now,
      updatedAt: now,
      lastTriggeredAt: null,
      lastStatus: null,
    };
    this._data.push(record);
    this._save();
    return { ...record };
  }

  update(id, patch) {
    const record = this._data.find((w) => w.id === id);
    if (!record) return null;
    for (const key of ['url', 'events', 'secret', 'headers', 'filters', 'retryCount', 'active']) {
      if (patch[key] !== undefined) record[key] = patch[key];
    }
    if (record.retryCount !== undefined) {
      record.retryCount = Math.min(RETRY_COUNT_MAX, Math.max(RETRY_COUNT_MIN, record.retryCount));
    }
    record.updatedAt = new Date().toISOString();
    this._save();
    return { ...record };
  }

  remove(id) {
    const before = this._data.length;
    this._data = this._data.filter((w) => w.id !== id);
    if (this._data.length === before) return false;
    this._save();
    return true;
  }

  recordDelivery(id, { status }) {
    const record = this._data.find((w) => w.id === id);
    if (!record) return;
    record.lastTriggeredAt = new Date().toISOString();
    record.lastStatus = status;
    this._save();
  }

  /** Active webhooks subscribed to a given event type (or '*'). */
  findForEvent(eventType) {
    return this._data.filter((w) => w.active && (w.events.includes(eventType) || w.events.includes('*'))).map((w) => ({ ...w }));
  }
}

module.exports = { WebhookStore };
