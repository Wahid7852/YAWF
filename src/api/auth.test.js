'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { requireAuth, matchesCidr, normalizeIp, bearerToken } = require('./auth');
const { ApiKeyStore } = require('./apiKeyStore');

function tempStore() {
  return new ApiKeyStore(fs.mkdtempSync(path.join(os.tmpdir(), 'yawf-auth-test-')));
}

function mockRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  return res;
}

test('bearerToken parses "Bearer <token>" case-insensitively', () => {
  assert.equal(bearerToken('Bearer abc123'), 'abc123');
  assert.equal(bearerToken('bearer abc123'), 'abc123');
  assert.equal(bearerToken('Basic abc123'), null);
  assert.equal(bearerToken(null), null);
});

test('normalizeIp strips the IPv4-mapped-IPv6 prefix', () => {
  assert.equal(normalizeIp('::ffff:127.0.0.1'), '127.0.0.1');
  assert.equal(normalizeIp('127.0.0.1'), '127.0.0.1');
  assert.equal(normalizeIp(null), null);
});

test('matchesCidr matches an exact IP and a /24 range, and rejects outside it', () => {
  assert.equal(matchesCidr('10.0.0.5', '10.0.0.5'), true);
  assert.equal(matchesCidr('10.0.0.5', '10.0.0.5/32'), true);
  assert.equal(matchesCidr('10.0.0.5', '10.0.0.0/24'), true);
  assert.equal(matchesCidr('10.0.1.5', '10.0.0.0/24'), false);
  assert.equal(matchesCidr('0.0.0.0', '0.0.0.0/0'), true);
  assert.equal(matchesCidr('not-an-ip', '10.0.0.0/24'), false);
});

test('requireAuth rejects a missing key with 401', () => {
  const mw = requireAuth(tempStore(), 'viewer');
  const res = mockRes();
  mw({ get: () => null }, res, () => assert.fail('next() should not be called'));
  assert.equal(res.statusCode, 401);
});

test('requireAuth rejects an invalid key with 401', () => {
  const mw = requireAuth(tempStore(), 'viewer');
  const res = mockRes();
  mw({ get: (h) => (h === 'x-api-key' ? 'yawf_k1_bogus' : null) }, res, () => assert.fail('next() should not be called'));
  assert.equal(res.statusCode, 401);
});

test('requireAuth accepts a valid key via X-API-Key and sets req.apiKey', () => {
  const store = tempStore();
  const { rawKey } = store.create({ name: 'ci', role: 'viewer' });
  const mw = requireAuth(store, 'viewer');
  const req = { get: (h) => (h === 'x-api-key' ? rawKey : null) };
  let nextCalled = false;
  mw(req, mockRes(), () => (nextCalled = true));
  assert.equal(nextCalled, true);
  assert.equal(req.apiKey.role, 'viewer');
});

test('requireAuth accepts a valid key via Authorization: Bearer', () => {
  const store = tempStore();
  const { rawKey } = store.create({ name: 'ci', role: 'viewer' });
  const mw = requireAuth(store, 'viewer');
  const req = { get: (h) => (h === 'authorization' ? `Bearer ${rawKey}` : null) };
  let nextCalled = false;
  mw(req, mockRes(), () => (nextCalled = true));
  assert.equal(nextCalled, true);
});

test('requireAuth rejects a viewer key on an operator-only route with 403', () => {
  const store = tempStore();
  const { rawKey } = store.create({ name: 'ci', role: 'viewer' });
  const mw = requireAuth(store, 'operator');
  const req = { get: (h) => (h === 'x-api-key' ? rawKey : null) };
  const res = mockRes();
  mw(req, res, () => assert.fail('next() should not be called'));
  assert.equal(res.statusCode, 403);
});

test('requireAuth enforces allowedIps when set', () => {
  const store = tempStore();
  const { rawKey } = store.create({ name: 'ci', role: 'admin', allowedIps: ['10.0.0.0/24'] });
  const mw = requireAuth(store, 'admin');

  const allowedReq = { get: (h) => (h === 'x-api-key' ? rawKey : null), ip: '10.0.0.5' };
  let nextCalled = false;
  mw(allowedReq, mockRes(), () => (nextCalled = true));
  assert.equal(nextCalled, true);

  const blockedReq = { get: (h) => (h === 'x-api-key' ? rawKey : null), ip: '192.168.1.1' };
  const res = mockRes();
  mw(blockedReq, res, () => assert.fail('next() should not be called for a blocked IP'));
  assert.equal(res.statusCode, 403);
});

test('requireAuth allows any IP when allowedIps is empty', () => {
  const store = tempStore();
  const { rawKey } = store.create({ name: 'ci', role: 'viewer', allowedIps: [] });
  const mw = requireAuth(store, 'viewer');
  const req = { get: (h) => (h === 'x-api-key' ? rawKey : null), ip: '203.0.113.7' };
  let nextCalled = false;
  mw(req, mockRes(), () => (nextCalled = true));
  assert.equal(nextCalled, true);
});
