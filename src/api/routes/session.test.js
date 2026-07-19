'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const http = require('node:http');

const { sessionRouter } = require('./session');
const { ApiKeyStore } = require('../apiKeyStore');

function tempKeyStore() {
  return new ApiKeyStore(fs.mkdtempSync(path.join(os.tmpdir(), 'yawf-session-route-test-')));
}

async function withApp(bridgeClient, fn) {
  const apiKeyStore = tempKeyStore();
  const { rawKey } = apiKeyStore.create({ name: 'ci', role: 'viewer' });
  const app = express();
  app.use('/api/v1/session', sessionRouter(apiKeyStore, () => bridgeClient));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  try {
    await fn(`http://127.0.0.1:${port}/api/v1/session`, rawKey);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('GET /session returns 503 when the bridge is not enabled', async () => {
  await withApp(null, async (baseUrl, rawKey) => {
    const res = await fetch(baseUrl, { headers: { 'X-API-Key': rawKey } });
    assert.equal(res.status, 503);
  });
});

test('GET /session returns the bridge status when enabled', async () => {
  const stubBridge = { call: async (method) => (method === 'session.getStatus' ? { state: 'CONNECTED' } : null) };
  await withApp(stubBridge, async (baseUrl, rawKey) => {
    const res = await fetch(baseUrl, { headers: { 'X-API-Key': rawKey } });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { state: 'CONNECTED' });
  });
});

test('GET /session returns 502 when the bridge call rejects', async () => {
  const stubBridge = { call: async () => { throw new Error('page not responding'); } };
  await withApp(stubBridge, async (baseUrl, rawKey) => {
    const res = await fetch(baseUrl, { headers: { 'X-API-Key': rawKey } });
    assert.equal(res.status, 502);
  });
});

test('GET /session/qr returns the QR payload when available', async () => {
  const stubBridge = { call: async () => ({ dataUrl: 'data:image/png;base64,xyz' }) };
  await withApp(stubBridge, async (baseUrl, rawKey) => {
    const res = await fetch(`${baseUrl}/qr`, { headers: { 'X-API-Key': rawKey } });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { dataUrl: 'data:image/png;base64,xyz' });
  });
});

test('GET /session/qr returns 404 when no QR is currently displayed', async () => {
  const stubBridge = { call: async () => { throw new Error('no QR code currently displayed'); } };
  await withApp(stubBridge, async (baseUrl, rawKey) => {
    const res = await fetch(`${baseUrl}/qr`, { headers: { 'X-API-Key': rawKey } });
    assert.equal(res.status, 404);
  });
});

test('requires auth like every other route', async () => {
  await withApp(null, async (baseUrl) => {
    const res = await fetch(baseUrl);
    assert.equal(res.status, 401);
  });
});

test('reads the bridge client fresh on every request rather than a stale snapshot - ' +
  'the bridge attaches later than server startup in main.js, and a snapshot would never see it', async () => {
  const apiKeyStore = tempKeyStore();
  const { rawKey } = apiKeyStore.create({ name: 'ci', role: 'viewer' });
  let bridgeClient = null; // not yet attached, as at server construction time in main.js
  const app = express();
  app.use('/api/v1/session', sessionRouter(apiKeyStore, () => bridgeClient));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api/v1/session`;
  try {
    const before = await fetch(baseUrl, { headers: { 'X-API-Key': rawKey } });
    assert.equal(before.status, 503);

    bridgeClient = { call: async () => ({ state: 'CONNECTED' }) }; // attaches later, e.g. did-finish-load
    const after = await fetch(baseUrl, { headers: { 'X-API-Key': rawKey } });
    assert.equal(after.status, 200);
    assert.deepEqual(await after.json(), { state: 'CONNECTED' });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
