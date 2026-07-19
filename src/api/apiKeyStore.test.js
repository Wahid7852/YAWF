'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ApiKeyStore } = require('./apiKeyStore');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yawf-apikeystore-test-'));
}

test('create() returns a raw key once and never persists it', () => {
  const dir = tempDir();
  const store = new ApiKeyStore(dir);
  const { record, rawKey } = store.create({ name: 'ci', role: 'operator' });
  assert.match(rawKey, /^yawf_k1_/);
  assert.equal(record.name, 'ci');
  assert.equal('keyHash' in record, false);
  assert.equal('rawKey' in record, false);

  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'api-keys.json'), 'utf8'));
  assert.equal(onDisk[0].keyHash.length, 64); // sha256 hex
  assert.equal(JSON.stringify(onDisk).includes(rawKey), false);
});

test('verify() accepts the correct raw key and rejects a wrong one', () => {
  const store = new ApiKeyStore(tempDir());
  const { rawKey } = store.create({ name: 'ci', role: 'viewer' });
  assert.ok(store.verify(rawKey));
  assert.equal(store.verify('yawf_k1_wrongwrongwrongwrongwrongwrongwrong'), null);
  assert.equal(store.verify(''), null);
  assert.equal(store.verify(null), null);
});

test('verify() rejects a revoked key', () => {
  const store = new ApiKeyStore(tempDir());
  const { record, rawKey } = store.create({ name: 'ci', role: 'admin' });
  assert.ok(store.verify(rawKey));
  store.revoke(record.id);
  assert.equal(store.verify(rawKey), null);
});

test('verify() rejects an expired key', () => {
  const store = new ApiKeyStore(tempDir());
  const { rawKey } = store.create({ name: 'ci', role: 'admin', expiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal(store.verify(rawKey), null);
});

test('verify() updates lastUsedAt and usageCount on success', () => {
  const store = new ApiKeyStore(tempDir());
  const { record, rawKey } = store.create({ name: 'ci', role: 'viewer' });
  assert.equal(store.get(record.id).usageCount, 0);
  store.verify(rawKey);
  store.verify(rawKey);
  const after = store.get(record.id);
  assert.equal(after.usageCount, 2);
  assert.ok(after.lastUsedAt);
});

test('create() rejects an unknown role', () => {
  const store = new ApiKeyStore(tempDir());
  assert.throws(() => store.create({ name: 'ci', role: 'superadmin' }));
});

test('list() and get() never expose keyHash', () => {
  const store = new ApiKeyStore(tempDir());
  const { record } = store.create({ name: 'ci', role: 'viewer' });
  assert.equal('keyHash' in store.list()[0], false);
  assert.equal('keyHash' in store.get(record.id), false);
});

test('revoke()/remove() return false for an unknown id', () => {
  const store = new ApiKeyStore(tempDir());
  assert.equal(store.revoke('nope'), false);
  assert.equal(store.remove('nope'), false);
});

test('remove() deletes the key permanently', () => {
  const store = new ApiKeyStore(tempDir());
  const { record } = store.create({ name: 'ci', role: 'viewer' });
  assert.ok(store.remove(record.id));
  assert.equal(store.get(record.id), null);
});

test('update() changes name/allowedIps/expiresAt but never role', () => {
  const store = tempDir();
  const s = new ApiKeyStore(store);
  const { record } = s.create({ name: 'ci', role: 'viewer' });
  const updated = s.update(record.id, { name: 'renamed', allowedIps: ['10.0.0.0/24'] });
  assert.equal(updated.name, 'renamed');
  assert.deepEqual(updated.allowedIps, ['10.0.0.0/24']);
  assert.equal(updated.role, 'viewer');
});

test('update() returns null for an unknown id', () => {
  const s = new ApiKeyStore(tempDir());
  assert.equal(s.update('nope', { name: 'x' }), null);
});

test('a new store instance reads back keys a previous instance created', () => {
  const dir = tempDir();
  const { rawKey } = new ApiKeyStore(dir).create({ name: 'ci', role: 'viewer' });
  const reopened = new ApiKeyStore(dir);
  assert.ok(reopened.verify(rawKey));
});

test('a corrupt api-keys.json falls back to an empty store instead of throwing', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'api-keys.json'), '{not valid json');
  const store = new ApiKeyStore(dir);
  assert.deepEqual(store.list(), []);
});
