'use strict';

const crypto = require('node:crypto');

const { matchesFilters } = require('./filters');

const DEFAULT_BACKOFF_MS = [0, 5000, 30000];

function sign(secret, body) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * Delivers webhook events: HMAC-signs the exact serialized body, POSTs it,
 * and retries on failure with backoff. `fetchImpl` is injected (defaults to
 * the global fetch) so tests can stub it instead of hitting the network.
 * Delivery state (lastTriggeredAt/lastStatus) is best-effort and in-memory
 * for retries in flight - an attempt still queued at app-quit is simply lost,
 * which is an accepted limitation for a single-user desktop app.
 */
class WebhookDispatcher {
  constructor({ webhookStore, fetchImpl = globalThis.fetch, backoffMs = DEFAULT_BACKOFF_MS }) {
    this._webhookStore = webhookStore;
    this._fetch = fetchImpl;
    this._backoffMs = backoffMs;
    this._pendingTimers = new Set();
  }

  /** Routes a real event to every active, subscribed, filter-matching webhook. */
  dispatch(eventType, data) {
    const event = { event: eventType, timestamp: new Date().toISOString(), data };
    const webhooks = this._webhookStore.findForEvent(eventType);
    for (const webhook of webhooks) {
      if (!matchesFilters(webhook.filters, data)) continue;
      this._deliver(webhook, event, 0);
    }
  }

  /** For POST /webhooks/:id/test - runs a synthetic event through the same
   * filter+HMAC+delivery pipeline as a real one, against one specific webhook
   * regardless of its subscribed event list. Returns whether the filter matched;
   * delivery itself still happens asynchronously. */
  deliverTest(webhookId, eventType, data) {
    const webhook = this._webhookStore.get(webhookId);
    if (!webhook) return { matched: false, reason: 'webhook not found' };
    const event = { event: eventType, timestamp: new Date().toISOString(), data };
    if (!matchesFilters(webhook.filters, data)) return { matched: false, reason: 'filters did not match' };
    this._deliver(webhook, event, 0);
    return { matched: true };
  }

  _deliver(webhook, event, attempt) {
    const body = JSON.stringify(event);
    const headers = {
      'Content-Type': 'application/json',
      'X-YAWF-Signature': sign(webhook.secret, body),
      'X-YAWF-Event': event.event,
      ...webhook.headers,
    };

    Promise.resolve()
      .then(() => this._fetch(webhook.url, { method: 'POST', headers, body }))
      .then((res) => {
        if (res.ok) {
          this._webhookStore.recordDelivery(webhook.id, { status: 'delivered' });
        } else {
          this._retryOrFail(webhook, event, attempt, `http ${res.status}`);
        }
      })
      .catch((err) => this._retryOrFail(webhook, event, attempt, err.message));
  }

  _retryOrFail(webhook, event, attempt, reason) {
    const nextAttempt = attempt + 1;
    if (nextAttempt > webhook.retryCount) {
      this._webhookStore.recordDelivery(webhook.id, { status: `failed: ${reason}` });
      return;
    }
    const delay = this._backoffMs[Math.min(nextAttempt, this._backoffMs.length - 1)];
    const timer = setTimeout(() => {
      this._pendingTimers.delete(timer);
      this._deliver(webhook, event, nextAttempt);
    }, delay);
    this._pendingTimers.add(timer);
  }
}

module.exports = { WebhookDispatcher, sign };
