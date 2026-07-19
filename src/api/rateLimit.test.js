'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { RateLimiter, rateLimitMiddleware } = require('./rateLimit');

test('allows up to the limit, then blocks', () => {
  const limiter = new RateLimiter({ limit: 3, windowMs: 60_000 });
  assert.equal(limiter.check('k').allowed, true);
  assert.equal(limiter.check('k').allowed, true);
  assert.equal(limiter.check('k').allowed, true);
  const blocked = limiter.check('k');
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterMs > 0);
});

test('different keys have independent buckets', () => {
  const limiter = new RateLimiter({ limit: 1, windowMs: 60_000 });
  assert.equal(limiter.check('a').allowed, true);
  assert.equal(limiter.check('b').allowed, true);
  assert.equal(limiter.check('a').allowed, false);
});

test('recovers once the window has elapsed', (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const limiter = new RateLimiter({ limit: 1, windowMs: 1000 });
  assert.equal(limiter.check('k').allowed, true);
  assert.equal(limiter.check('k').allowed, false);
  t.mock.timers.tick(1001);
  assert.equal(limiter.check('k').allowed, true);
});

test('reset() clears a key\'s bucket', () => {
  const limiter = new RateLimiter({ limit: 1, windowMs: 60_000 });
  limiter.check('k');
  assert.equal(limiter.check('k').allowed, false);
  limiter.reset('k');
  assert.equal(limiter.check('k').allowed, true);
});

test('rateLimitMiddleware calls next() when allowed', () => {
  const limiter = new RateLimiter({ limit: 5, windowMs: 60_000 });
  const mw = rateLimitMiddleware(limiter, () => 'k');
  let called = false;
  mw({}, { set() {}, status() { return this; }, json() {} }, () => (called = true));
  assert.equal(called, true);
});

test('rateLimitMiddleware responds 429 with Retry-After when blocked', () => {
  const limiter = new RateLimiter({ limit: 0, windowMs: 60_000 });
  const mw = rateLimitMiddleware(limiter, () => 'k');
  let statusCode = null;
  let retryAfterHeader = null;
  let body = null;
  const res = {
    set(name, value) {
      if (name === 'Retry-After') retryAfterHeader = value;
    },
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      body = payload;
    },
  };
  mw({}, res, () => assert.fail('next() should not be called when rate limited'));
  assert.equal(statusCode, 429);
  assert.ok(retryAfterHeader);
  assert.match(body.error, /rate limit/);
});
