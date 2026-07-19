'use strict';

const crypto = require('node:crypto');

/**
 * Promise-based wrapper around the main<->page bridge call/response protocol.
 * `send(payload)` is provided by the caller (main.js) and does the actual
 * `webContents.send(IPC_CALL, payload)` - this class only owns request/response
 * correlation and timeouts, so it's testable without any Electron/DOM context.
 */
class BridgeClient {
  constructor({ send, timeoutMs = 15000 }) {
    this._send = send;
    this._timeoutMs = timeoutMs;
    this._pending = new Map();
  }

  /** Resolves/rejects when handleResult() is called with a matching id, or times out. */
  call(method, args = {}) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`bridge call "${method}" timed out`));
      }, this._timeoutMs);
      this._pending.set(id, { resolve, reject, timer });
      this._send({ id, method, args });
    });
  }

  /** Wired from main.js's ipcMain listener for the page's result relay. Silently
   * drops anything that doesn't match an in-flight call - never throws on
   * attacker-controlled/stale input, see main.js's trust-boundary notes. */
  handleResult({ id, ok, result, error } = {}) {
    const pending = this._pending.get(id);
    if (!pending) return;
    this._pending.delete(id);
    clearTimeout(pending.timer);
    if (ok) pending.resolve(result);
    else pending.reject(new Error(error || 'bridge call failed'));
  }

  /** Rejects every in-flight call, e.g. when the page navigates/reloads mid-call. */
  rejectAll(reason) {
    for (const [id, pending] of this._pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
      this._pending.delete(id);
    }
  }

  get pendingCount() {
    return this._pending.size;
  }
}

module.exports = { BridgeClient };
