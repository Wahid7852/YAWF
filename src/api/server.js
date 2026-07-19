'use strict';

const express = require('express');
const crypto = require('node:crypto');

const { bearerToken, normalizeIp } = require('./auth');
const { RateLimiter } = require('./rateLimit');
const { healthRouter } = require('./routes/health');
const { keysRouter } = require('./routes/keys');
const { auditRouter } = require('./routes/audit');
const { webhooksRouter } = require('./routes/webhooks');
const { sessionRouter } = require('./routes/session');

/** Hashes the presented raw key for use as a rate-limit/audit bucket key, so raw
 * key material never sits around in the limiter's in-memory Map. */
function bucketKeyFor(req) {
  const rawKey = req.get('x-api-key') || bearerToken(req.get('authorization'));
  if (rawKey) return crypto.createHash('sha256').update(rawKey).digest('hex');
  return normalizeIp(req.ip) || 'unknown';
}

/** General rate limit + audit logging for everything under /api/v1 except /health.
 * Runs before each route's own requireAuth, so req.apiKey isn't set yet here -
 * the audit entry is written on the response 'finish' event, by which point
 * downstream middleware has populated it (if auth succeeded). */
function auditAndRateLimit(auditLog, limiter, { logBodies }) {
  return (req, res, next) => {
    const start = Date.now();
    const { allowed, retryAfterMs } = limiter.check(bucketKeyFor(req));

    res.on('finish', () => {
      auditLog.append({
        keyId: req.apiKey?.id || null,
        keyPrefix: req.apiKey?.keyPrefix || null,
        role: req.apiKey?.role || null,
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        ip: normalizeIp(req.ip),
        durationMs: Date.now() - start,
        ...(logBodies && req.body && Object.keys(req.body).length ? { body: req.body } : {}),
      });
    });

    if (!allowed) {
      res.set('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
      return res.status(429).json({ error: 'rate limit exceeded' });
    }
    next();
  };
}

/**
 * Creates the Express app + start/stop lifecycle for the automation API.
 * `settings` is a Settings instance; `apiKeyStore`/`auditLog`/`webhookStore`
 * are their respective store instances; `dispatcher` is a WebhookDispatcher -
 * constructed by the caller (main.js) rather than here, since webhook delivery
 * (and later, dispatch() on real WhatsApp events) is independent of whether
 * the HTTP API happens to be running right now: a "test webhook" delivery or
 * an incoming message should still work while the API server is toggled off.
 * `getBridgeClient` is a `() => BridgeClient | null` accessor (not a snapshot -
 * see routes/session.js for why that distinction matters: the bridge attaches
 * later than server startup). Defaults to a function that always returns null,
 * i.e. bridge routes report 503 unless a real accessor is supplied. Further
 * bridge-dependent routers (messages/chats/contacts/groups) are added by
 * later phases.
 */
function createApiServer({ settings, apiKeyStore, auditLog, webhookStore, dispatcher, getBridgeClient = () => null }) {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  const generalLimiter = new RateLimiter({ limit: settings.get('apiRateLimitPerMin'), windowMs: 60_000 });
  const messageLimiter = new RateLimiter({ limit: settings.get('apiMessageRateLimitPerMin'), windowMs: 60_000 });

  app.use('/api/v1/health', healthRouter());
  app.use('/api/v1', auditAndRateLimit(auditLog, generalLimiter, { logBodies: settings.get('apiAuditLogBodies') }));
  app.use('/api/v1/keys', keysRouter(apiKeyStore));
  app.use('/api/v1/audit', auditRouter(apiKeyStore, auditLog));
  app.use('/api/v1/webhooks', webhooksRouter(apiKeyStore, webhookStore, dispatcher));
  app.use('/api/v1/session', sessionRouter(apiKeyStore, getBridgeClient));

  app.use((err, _req, res, _next) => {
    console.error('[YAWF] API server error:', err.message);
    res.status(500).json({ error: 'internal error' });
  });

  let httpServer = null;

  function start() {
    return new Promise((resolve, reject) => {
      const port = settings.get('apiPort');
      const bindAddress = settings.get('apiBindAddress');
      httpServer = app.listen(port, bindAddress);
      httpServer.once('listening', () => resolve(httpServer));
      httpServer.once('error', (err) => {
        httpServer = null;
        reject(err);
      });
    });
  }

  function stop() {
    return new Promise((resolve) => {
      if (!httpServer) return resolve();
      httpServer.close(() => {
        httpServer = null;
        resolve();
      });
    });
  }

  return { app, start, stop, messageLimiter, dispatcher };
}

module.exports = { createApiServer };
