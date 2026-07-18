'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Settings, DEFAULTS } = require('./settings');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yawf-settings-test-'));
}

test('a fresh Settings instance returns the documented defaults', () => {
  const settings = new Settings(tempDir());
  assert.deepEqual(settings.getAll(), DEFAULTS);
});

test('set() persists to disk and get() reflects it immediately', () => {
  const dir = tempDir();
  const settings = new Settings(dir);
  settings.set('ctrlEnterToSend', true);
  assert.equal(settings.get('ctrlEnterToSend'), true);
  assert.equal(fs.existsSync(path.join(dir, 'settings.json')), true);
});

test('a new Settings instance reads back what a previous instance wrote', () => {
  const dir = tempDir();
  new Settings(dir).set('idleReloadHours', 8);
  const reopened = new Settings(dir);
  assert.equal(reopened.get('idleReloadHours'), 8);
});

test('a partially-written settings.json still fills in missing keys from defaults', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ zoomFactor: 1.5 }));
  const settings = new Settings(dir);
  assert.equal(settings.get('zoomFactor'), 1.5);
  assert.equal(settings.get('closeToTray'), DEFAULTS.closeToTray);
});

test('a corrupt settings.json falls back to defaults instead of throwing', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'settings.json'), '{not valid json');
  const settings = new Settings(dir);
  assert.deepEqual(settings.getAll(), DEFAULTS);
});

test('getAll() returns a copy, not a live reference to internal state', () => {
  const settings = new Settings(tempDir());
  const snapshot = settings.getAll();
  snapshot.ctrlEnterToSend = true;
  assert.equal(settings.get('ctrlEnterToSend'), false);
});
