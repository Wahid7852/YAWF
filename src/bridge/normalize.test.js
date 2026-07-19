'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { deriveSessionStatus } = require('./normalize');

test('CONNECTED when a chat list root is present, regardless of QR canvas presence', () => {
  assert.equal(deriveSessionStatus({ hasQrCanvas: false, hasChatListRoot: true }), 'CONNECTED');
  assert.equal(deriveSessionStatus({ hasQrCanvas: true, hasChatListRoot: true }), 'CONNECTED');
});

test('PAIRING when a QR canvas is present and there is no chat list root', () => {
  assert.equal(deriveSessionStatus({ hasQrCanvas: true, hasChatListRoot: false }), 'PAIRING');
});

test('LOADING when neither signal is present yet', () => {
  assert.equal(deriveSessionStatus({ hasQrCanvas: false, hasChatListRoot: false }), 'LOADING');
});
