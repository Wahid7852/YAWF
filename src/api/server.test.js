'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApiServer } = require('./server');
const { ApiKeyStore } = require('./apiKeyStore');
const { AuditLog } = require('./auditLog');
const { WebhookStore } = require('./webhooks/webhookStore');
const { WebhookDispatcher } = require('./webhooks/dispatcher');

function fakeSettings(overrides = {}) {
  const values = {
    apiPort: 0, // OS-assigned, avoids port collisions between test runs
    apiBindAddress: '127.0.0.1',
    apiRateLimitPerMin: 60,
    apiMessageRateLimitPerMin: 20,
    apiAuditLogBodies: false,
    ...overrides,
  };
  return { get: (key) => values[key] };
}

async function startTestServer(overrides) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yawf-server-test-'));
  const apiKeyStore = new ApiKeyStore(dir);
  const auditLog = new AuditLog(dir);
  const webhookStore = new WebhookStore(dir);
  const settings = fakeSettings(overrides);
  // No real network calls in these tests: stub fetch so a stray webhook test-delivery
  // during a test run never actually hits the network.
  const dispatcher = new WebhookDispatcher({ webhookStore, fetchImpl: async () => ({ ok: true, status: 200 }) });
  const server = createApiServer({ settings, apiKeyStore, auditLog, webhookStore, dispatcher });
  const httpServer = await server.start();
  const port = httpServer.address().port;
  return { server, apiKeyStore, auditLog, webhookStore, baseUrl: `http://127.0.0.1:${port}` };
}

test('GET /api/v1/health requires no auth and returns 200', async () => {
  const { server, baseUrl } = await startTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/v1/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
  } finally {
    await server.stop();
  }
});

test('GET /api/v1/keys without a key returns 401', async () => {
  const { server, baseUrl } = await startTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/v1/keys`);
    assert.equal(res.status, 401);
  } finally {
    await server.stop();
  }
});

test('a viewer key is rejected on the admin-only /keys route with 403', async () => {
  const { server, apiKeyStore, baseUrl } = await startTestServer();
  try {
    const { rawKey } = apiKeyStore.create({ name: 'viewer', role: 'viewer' });
    const res = await fetch(`${baseUrl}/api/v1/keys`, { headers: { 'X-API-Key': rawKey } });
    assert.equal(res.status, 403);
  } finally {
    await server.stop();
  }
});

test('an admin key can create and list keys through the real HTTP surface', async () => {
  const { server, apiKeyStore, baseUrl } = await startTestServer();
  try {
    const { rawKey: adminKey } = apiKeyStore.create({ name: 'admin', role: 'admin' });
    const createRes = await fetch(`${baseUrl}/api/v1/keys`, {
      method: 'POST',
      headers: { 'X-API-Key': adminKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'new-key', role: 'operator' }),
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.match(created.apiKey, /^yawf_k1_/);

    const listRes = await fetch(`${baseUrl}/api/v1/keys`, { headers: { 'X-API-Key': adminKey } });
    const listed = await listRes.json();
    assert.equal(listed.keys.length, 2); // admin's own key + the one just created
  } finally {
    await server.stop();
  }
});

test('exceeding the general rate limit returns 429 with Retry-After', async () => {
  const { server, baseUrl } = await startTestServer({ apiRateLimitPerMin: 2 });
  try {
    await fetch(`${baseUrl}/api/v1/keys`);
    await fetch(`${baseUrl}/api/v1/keys`);
    const res = await fetch(`${baseUrl}/api/v1/keys`);
    assert.equal(res.status, 429);
    assert.ok(res.headers.get('retry-after'));
  } finally {
    await server.stop();
  }
});

test('requests are recorded in the audit log, including status and keyId once authenticated', async () => {
  const { server, apiKeyStore, auditLog, baseUrl } = await startTestServer();
  try {
    const { record, rawKey } = apiKeyStore.create({ name: 'admin', role: 'admin' });
    await fetch(`${baseUrl}/api/v1/keys`, { headers: { 'X-API-Key': rawKey } });
    // res.on('finish') is async relative to fetch() resolving - give it a tick.
    await new Promise((resolve) => setImmediate(resolve));
    const entries = auditLog.read();
    const entry = entries.find((e) => e.path === '/api/v1/keys');
    assert.ok(entry);
    assert.equal(entry.status, 200);
    assert.equal(entry.keyId, record.id);
  } finally {
    await server.stop();
  }
});

test('an admin key can CRUD a webhook and trigger a test delivery through the real HTTP surface', async () => {
  const { server, apiKeyStore, baseUrl } = await startTestServer();
  try {
    const { rawKey: adminKey } = apiKeyStore.create({ name: 'admin', role: 'admin' });
    const headers = { 'X-API-Key': adminKey, 'Content-Type': 'application/json' };

    const createRes = await fetch(`${baseUrl}/api/v1/webhooks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url: 'https://example.com/hook', secret: 's3cr3t', events: ['message.received'] }),
    });
    assert.equal(createRes.status, 201);
    const { webhook } = await createRes.json();

    const testRes = await fetch(`${baseUrl}/api/v1/webhooks/${webhook.id}/test`, { method: 'POST', headers });
    assert.equal(testRes.status, 200);
    const testBody = await testRes.json();
    assert.equal(testBody.matched, true);

    const deleteRes = await fetch(`${baseUrl}/api/v1/webhooks/${webhook.id}`, { method: 'DELETE', headers });
    assert.equal(deleteRes.status, 204);
  } finally {
    await server.stop();
  }
});

test('stop() is idempotent and safe to call without a prior start()', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yawf-server-test-'));
  const webhookStore = new WebhookStore(dir);
  const server = createApiServer({
    settings: fakeSettings(),
    apiKeyStore: new ApiKeyStore(dir),
    auditLog: new AuditLog(dir),
    webhookStore,
    dispatcher: new WebhookDispatcher({ webhookStore, fetchImpl: async () => ({ ok: true, status: 200 }) }),
  });
  await server.stop(); // never started
});
