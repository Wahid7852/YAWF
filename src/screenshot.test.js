'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { commandExists, detectTool } = require('./screenshot');

test('commandExists finds a binary that is definitely on PATH', () => {
  // node itself is what's running this test, so it must be resolvable
  assert.equal(commandExists('node'), true);
});

test('commandExists returns false for a binary that cannot plausibly exist', () => {
  assert.equal(commandExists('yawf-definitely-not-a-real-binary-xyz'), false);
});

test('detectTool returns either a known tool name or null, never throws', () => {
  const tool = detectTool();
  assert.ok(tool === null || typeof tool === 'string');
});
