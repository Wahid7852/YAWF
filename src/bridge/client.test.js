'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { BridgeClient } = require('./client');

test('call() sends a payload with a fresh id and method/args', async () => {
  const sent = [];
  const client = new BridgeClient({ send: (payload) => sent.push(payload) });
  const promise = client.call('session.getStatus', { foo: 'bar' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].method, 'session.getStatus');
  assert.deepEqual(sent[0].args, { foo: 'bar' });
  assert.ok(sent[0].id);
  // Resolve it so the real 15s timeout timer doesn't fire after this test ends.
  client.handleResult({ id: sent[0].id, ok: true, result: {} });
  await promise;
});

test('handleResult() resolves the matching pending call on ok:true', async () => {
  const sent = [];
  const client = new BridgeClient({ send: (payload) => sent.push(payload) });
  const promise = client.call('session.getStatus');
  client.handleResult({ id: sent[0].id, ok: true, result: { state: 'CONNECTED' } });
  const result = await promise;
  assert.deepEqual(result, { state: 'CONNECTED' });
});

test('handleResult() rejects the matching pending call on ok:false', async () => {
  const sent = [];
  const client = new BridgeClient({ send: (payload) => sent.push(payload) });
  const promise = client.call('session.getQr');
  client.handleResult({ id: sent[0].id, ok: false, error: 'no QR currently displayed' });
  await assert.rejects(promise, /no QR currently displayed/);
});

test('handleResult() silently ignores an id that was never sent', () => {
  const client = new BridgeClient({ send: () => {} });
  // Must not throw - this simulates a forged/stale/duplicate result arriving
  // from the page, which the trust boundary treats as untrusted input.
  assert.doesNotThrow(() => client.handleResult({ id: 'not-a-real-id', ok: true, result: {} }));
});

test('a call that never gets a result times out and rejects', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const client = new BridgeClient({ send: () => {}, timeoutMs: 1000 });
  const promise = client.call('session.getStatus');
  t.mock.timers.tick(1001);
  await assert.rejects(promise, /timed out/);
});

test('rejectAll() rejects every in-flight call with the given reason', async () => {
  const client = new BridgeClient({ send: () => {} });
  const p1 = client.call('session.getStatus');
  const p2 = client.call('session.getQr');
  client.rejectAll('page navigated away');
  await assert.rejects(p1, /page navigated away/);
  await assert.rejects(p2, /page navigated away/);
  assert.equal(client.pendingCount, 0);
});

test('pendingCount reflects in-flight calls and drops to 0 once resolved', () => {
  const sent = [];
  const client = new BridgeClient({ send: (payload) => sent.push(payload) });
  client.call('session.getStatus');
  assert.equal(client.pendingCount, 1);
  client.handleResult({ id: sent[0].id, ok: true, result: {} });
  assert.equal(client.pendingCount, 0);
});
