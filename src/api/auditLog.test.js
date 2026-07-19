'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { AuditLog } = require('./auditLog');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yawf-auditlog-test-'));
}

test('append() writes a JSONL line with a timestamp and read() returns it newest-first', () => {
  const log = new AuditLog(tempDir());
  log.append({ method: 'GET', path: '/api/v1/health', status: 200 });
  log.append({ method: 'GET', path: '/api/v1/session', status: 200 });
  const entries = log.read();
  assert.equal(entries.length, 2);
  assert.equal(entries[0].path, '/api/v1/session'); // newest first
  assert.ok(entries[0].ts);
});

test('append() emits an "entry" event for live-tail consumers', () => {
  const log = new AuditLog(tempDir());
  let seen = null;
  log.on('entry', (e) => (seen = e));
  log.append({ method: 'GET', path: '/api/v1/health', status: 200 });
  assert.equal(seen.path, '/api/v1/health');
});

test('read() respects limit', () => {
  const log = new AuditLog(tempDir());
  for (let i = 0; i < 5; i++) log.append({ i });
  assert.equal(log.read({ limit: 2 }).length, 2);
});

test('read() filters by since', () => {
  const log = new AuditLog(tempDir());
  log.append({ tag: 'old' });
  const cutoff = new Date(Date.now() + 10).toISOString();
  log.append({ tag: 'new-but-actually-before-cutoff' });
  const entries = log.read({ since: cutoff });
  assert.equal(entries.length, 0);
});

test('read() on a missing file returns an empty array', () => {
  const log = new AuditLog(tempDir());
  assert.deepEqual(log.read(), []);
});

test('rotates to a .1.jsonl backup once the size threshold is crossed', () => {
  const dir = tempDir();
  const log = new AuditLog(dir, { maxBytes: 200, maxBackups: 2 });
  for (let i = 0; i < 20; i++) log.append({ i, filler: 'x'.repeat(20) });
  assert.ok(fs.existsSync(path.join(dir, 'api-audit.jsonl.1.jsonl')));
});

test('keeps only maxBackups rotated files', () => {
  const dir = tempDir();
  const log = new AuditLog(dir, { maxBytes: 100, maxBackups: 2 });
  for (let i = 0; i < 60; i++) log.append({ i, filler: 'x'.repeat(20) });
  assert.ok(fs.existsSync(path.join(dir, 'api-audit.jsonl.1.jsonl')));
  assert.ok(fs.existsSync(path.join(dir, 'api-audit.jsonl.2.jsonl')));
  assert.equal(fs.existsSync(path.join(dir, 'api-audit.jsonl.3.jsonl')), false);
});

test('a malformed line in the log file is skipped rather than throwing', () => {
  const dir = tempDir();
  const log = new AuditLog(dir);
  log.append({ ok: true });
  fs.appendFileSync(path.join(dir, 'api-audit.jsonl'), 'not json\n');
  const entries = log.read();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].ok, true);
});
