'use strict';

/**
 * In-memory sliding-window rate limiter, keyed by an arbitrary string (an API
 * key id). Process-memory only, resets on restart - acceptable for a
 * single-user desktop app, no persistence needed.
 */
class RateLimiter {
  constructor({ limit, windowMs = 60_000 }) {
    this._limit = limit;
    this._windowMs = windowMs;
    this._hits = new Map(); // key -> array of timestamps within the window
  }

  /** Returns { allowed, remaining, retryAfterMs }. Records the hit only if allowed. */
  check(key) {
    const now = Date.now();
    const cutoff = now - this._windowMs;
    const hits = (this._hits.get(key) || []).filter((t) => t > cutoff);

    if (hits.length >= this._limit) {
      const retryAfterMs = hits[0] + this._windowMs - now;
      this._hits.set(key, hits);
      return { allowed: false, remaining: 0, retryAfterMs: Math.max(retryAfterMs, 0) };
    }

    hits.push(now);
    this._hits.set(key, hits);
    return { allowed: true, remaining: this._limit - hits.length, retryAfterMs: 0 };
  }

  reset(key) {
    this._hits.delete(key);
  }
}

/** Express middleware factory. `limiter` is a RateLimiter; `keyOf(req)` derives the bucket key. */
function rateLimitMiddleware(limiter, keyOf) {
  return (req, res, next) => {
    const key = keyOf(req);
    const { allowed, retryAfterMs } = limiter.check(key);
    if (!allowed) {
      res.set('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
      return res.status(429).json({ error: 'rate limit exceeded' });
    }
    next();
  };
}

module.exports = { RateLimiter, rateLimitMiddleware };
