'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { WebhookStore } = require('./webhookStore');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yawf-webhookstore-test-'));
}

test('create() persists a webhook with defaults filled in', () => {
  const store = new WebhookStore(tempDir());
  const hook = store.create({ url: 'https://example.com/hook', secret: 's3cr3t', events: ['message.received'] });
  assert.match(hook.id, /^[0-9a-f-]{36}$/);
  assert.equal(hook.active, true);
  assert.equal(hook.retryCount, 3);
  assert.equal(hook.lastTriggeredAt, null);
});

test('create() requires url and secret', () => {
  const store = new WebhookStore(tempDir());
  assert.throws(() => store.create({ secret: 's' }));
  assert.throws(() => store.create({ url: 'https://example.com' }));
});

test('create() clamps retryCount into [0, 5]', () => {
  const store = new WebhookStore(tempDir());
  assert.equal(store.create({ url: 'https://e.com', secret: 's', retryCount: 99 }).retryCount, 5);
  assert.equal(store.create({ url: 'https://e.com', secret: 's', retryCount: -1 }).retryCount, 0);
});

test('update() changes fields and bumps updatedAt', async () => {
  const store = new WebhookStore(tempDir());
  const hook = store.create({ url: 'https://e.com', secret: 's', events: ['message.received'] });
  await new Promise((r) => setTimeout(r, 5));
  const updated = store.update(hook.id, { active: false, events: ['message.edited'] });
  assert.equal(updated.active, false);
  assert.deepEqual(updated.events, ['message.edited']);
  assert.notEqual(updated.updatedAt, hook.updatedAt);
});

test('update() returns null for an unknown id', () => {
  const store = new WebhookStore(tempDir());
  assert.equal(store.update('nope', { active: false }), null);
});

test('remove() deletes a webhook and returns false for an unknown id', () => {
  const store = new WebhookStore(tempDir());
  const hook = store.create({ url: 'https://e.com', secret: 's' });
  assert.ok(store.remove(hook.id));
  assert.equal(store.get(hook.id), null);
  assert.equal(store.remove(hook.id), false);
});

test('recordDelivery() sets lastTriggeredAt and lastStatus', () => {
  const store = new WebhookStore(tempDir());
  const hook = store.create({ url: 'https://e.com', secret: 's' });
  store.recordDelivery(hook.id, { status: 'delivered' });
  const after = store.get(hook.id);
  assert.equal(after.lastStatus, 'delivered');
  assert.ok(after.lastTriggeredAt);
});

test('findForEvent() returns only active webhooks subscribed to that event or "*"', () => {
  const store = new WebhookStore(tempDir());
  const a = store.create({ url: 'https://a.com', secret: 's', events: ['message.received'] });
  store.create({ url: 'https://b.com', secret: 's', events: ['message.edited'] });
  const c = store.create({ url: 'https://c.com', secret: 's', events: ['*'] });
  const inactive = store.create({ url: 'https://d.com', secret: 's', events: ['message.received'] });
  store.update(inactive.id, { active: false });

  const matches = store.findForEvent('message.received').map((w) => w.id);
  assert.ok(matches.includes(a.id));
  assert.ok(matches.includes(c.id));
  assert.equal(matches.includes(inactive.id), false);
});

test('a new store instance reads back webhooks a previous instance created', () => {
  const dir = tempDir();
  const created = new WebhookStore(dir).create({ url: 'https://e.com', secret: 's' });
  const reopened = new WebhookStore(dir);
  assert.deepEqual(reopened.get(created.id), created);
});

test('a corrupt webhooks.json falls back to an empty store instead of throwing', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'webhooks.json'), '{not valid json');
  const store = new WebhookStore(dir);
  assert.deepEqual(store.list(), []);
});
