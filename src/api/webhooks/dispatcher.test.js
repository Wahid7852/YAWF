'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { WebhookDispatcher, sign } = require('./dispatcher');
const { WebhookStore } = require('./webhookStore');

function tempStore() {
  return new WebhookStore(fs.mkdtempSync(path.join(os.tmpdir(), 'yawf-dispatcher-test-')));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('sign() computes an HMAC-SHA256 over the exact bytes given', () => {
  const sig = sign('s3cr3t', '{"a":1}');
  const expected = 'sha256=' + crypto.createHmac('sha256', 's3cr3t').update('{"a":1}').digest('hex');
  assert.equal(sig, expected);
});

test('dispatch() delivers to a matching, subscribed, active webhook with a correct signature header', async () => {
  const store = tempStore();
  const hook = store.create({ url: 'https://example.com/hook', secret: 's3cr3t', events: ['message.received'] });
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, status: 200 };
  };
  const dispatcher = new WebhookDispatcher({ webhookStore: store, fetchImpl });

  dispatcher.dispatch('message.received', { sender: 'x', body: 'hi' });
  await sleep(10);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, hook.url);
  const expectedSig = 'sha256=' + crypto.createHmac('sha256', 's3cr3t').update(calls[0].opts.body).digest('hex');
  assert.equal(calls[0].opts.headers['X-YAWF-Signature'], expectedSig);
  assert.equal(calls[0].opts.headers['X-YAWF-Event'], 'message.received');
  assert.equal(store.get(hook.id).lastStatus, 'delivered');
});

test('dispatch() skips webhooks not subscribed to the event type', async () => {
  const store = tempStore();
  store.create({ url: 'https://example.com/hook', secret: 's', events: ['message.edited'] });
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return { ok: true, status: 200 };
  };
  const dispatcher = new WebhookDispatcher({ webhookStore: store, fetchImpl });
  dispatcher.dispatch('message.received', { sender: 'x' });
  await sleep(10);
  assert.equal(called, false);
});

test('dispatch() skips webhooks whose filters do not match', async () => {
  const store = tempStore();
  store.create({
    url: 'https://example.com/hook',
    secret: 's',
    events: ['message.received'],
    filters: { conditions: [{ field: 'isGroup', operator: 'is', value: true }] },
  });
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return { ok: true, status: 200 };
  };
  const dispatcher = new WebhookDispatcher({ webhookStore: store, fetchImpl });
  dispatcher.dispatch('message.received', { isGroup: false });
  await sleep(10);
  assert.equal(called, false);
});

test('retries on a non-ok HTTP response, then gives up after retryCount and records failure', async () => {
  const store = tempStore();
  const hook = store.create({ url: 'https://e.com', secret: 's', events: ['message.received'], retryCount: 2 });
  let attempts = 0;
  const fetchImpl = async () => {
    attempts += 1;
    return { ok: false, status: 500 };
  };
  const dispatcher = new WebhookDispatcher({ webhookStore: store, fetchImpl, backoffMs: [0, 2, 4] });
  dispatcher.dispatch('message.received', {});
  await sleep(50);
  assert.equal(attempts, 3); // initial attempt + 2 retries
  assert.match(store.get(hook.id).lastStatus, /^failed:/);
});

test('retries on a thrown/rejected fetch, then eventually succeeds', async () => {
  const store = tempStore();
  const hook = store.create({ url: 'https://e.com', secret: 's', events: ['message.received'], retryCount: 3 });
  let attempts = 0;
  const fetchImpl = async () => {
    attempts += 1;
    if (attempts < 2) throw new Error('network down');
    return { ok: true, status: 200 };
  };
  const dispatcher = new WebhookDispatcher({ webhookStore: store, fetchImpl, backoffMs: [0, 2] });
  dispatcher.dispatch('message.received', {});
  await sleep(30);
  assert.equal(attempts, 2);
  assert.equal(store.get(hook.id).lastStatus, 'delivered');
});

test('deliverTest() reports webhook not found', () => {
  const store = tempStore();
  const dispatcher = new WebhookDispatcher({ webhookStore: store, fetchImpl: async () => ({ ok: true, status: 200 }) });
  const result = dispatcher.deliverTest('nope', 'message.received', {});
  assert.equal(result.matched, false);
  assert.match(result.reason, /not found/);
});

test('deliverTest() reports a filter mismatch without delivering', async () => {
  const store = tempStore();
  const hook = store.create({
    url: 'https://e.com',
    secret: 's',
    filters: { conditions: [{ field: 'isGroup', operator: 'is', value: true }] },
  });
  let called = false;
  const dispatcher = new WebhookDispatcher({
    webhookStore: store,
    fetchImpl: async () => {
      called = true;
      return { ok: true, status: 200 };
    },
  });
  const result = dispatcher.deliverTest(hook.id, 'message.received', { isGroup: false });
  assert.equal(result.matched, false);
  await sleep(10);
  assert.equal(called, false);
});

test('deliverTest() delivers a synthetic event through the real HMAC pipeline when filters match', async () => {
  const store = tempStore();
  const hook = store.create({ url: 'https://e.com', secret: 's' });
  const calls = [];
  const dispatcher = new WebhookDispatcher({
    webhookStore: store,
    fetchImpl: async (url, opts) => {
      calls.push(opts);
      return { ok: true, status: 200 };
    },
  });
  const result = dispatcher.deliverTest(hook.id, 'message.received', { sender: 'test' });
  assert.equal(result.matched, true);
  await sleep(10);
  assert.equal(calls.length, 1);
  assert.equal(store.get(hook.id).lastStatus, 'delivered');
});
