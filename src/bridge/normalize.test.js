'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  deriveSessionStatus,
  isIncomingByPosition,
  extractMessageIdFromTestId,
  parseMessageTime,
  normalizeIncomingMessage,
} = require('./normalize');

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

test('isIncomingByPosition: left of container midpoint is incoming', () => {
  assert.equal(isIncomingByPosition({ bubbleX: 605, containerX: 543, containerWidth: 1054 }), true);
});

test('isIncomingByPosition: right of container midpoint is outgoing', () => {
  assert.equal(isIncomingByPosition({ bubbleX: 1367, containerX: 543, containerWidth: 1054 }), false);
});

test('isIncomingByPosition: resolution-independent (same ratio, different container size)', () => {
  const params = { bubbleX: 100, containerX: 0, containerWidth: 400 }; // left quarter
  assert.equal(isIncomingByPosition(params), true);
  const scaled = { bubbleX: 200, containerX: 0, containerWidth: 800 }; // same ratio, 2x container
  assert.equal(isIncomingByPosition(scaled), true);
});

test('extractMessageIdFromTestId pulls the id out of "conv-msg-<id>"', () => {
  assert.equal(extractMessageIdFromTestId('conv-msg-3EB0F88A064A285ACA1645'), '3EB0F88A064A285ACA1645');
  assert.equal(extractMessageIdFromTestId('conv-msg-AC8FDB51F34170298FFED0A3B98A3830'), 'AC8FDB51F34170298FFED0A3B98A3830');
});

test('extractMessageIdFromTestId returns null for anything that does not match', () => {
  assert.equal(extractMessageIdFromTestId('cell-frame-title'), null);
  assert.equal(extractMessageIdFromTestId(null), null);
  assert.equal(extractMessageIdFromTestId(undefined), null);
});

test('parseMessageTime pulls the leading time out of meta text mixed with a status icon title', () => {
  assert.equal(parseMessageTime('12:38 pmwds-ic-read'), '12:38 pm');
  assert.equal(parseMessageTime('9:05'), '9:05');
});

test('parseMessageTime returns null for unparseable input', () => {
  assert.equal(parseMessageTime('wds-ic-read'), null);
  assert.equal(parseMessageTime(null), null);
});

test('normalizeIncomingMessage shapes extracted fields and defaults unimplemented ones honestly', () => {
  const event = normalizeIncomingMessage({ messageId: 'abc123', fromMe: false, bodyText: 'hi', hasMedia: false, time: '9:05' });
  assert.equal(event.id, 'abc123');
  assert.equal(event.fromMe, false);
  assert.equal(event.body, 'hi');
  assert.equal(event.hasMedia, false);
  assert.equal(event.time, '9:05');
  // Not yet implemented - explicitly null/empty rather than a fabricated guess.
  assert.equal(event.sender, null);
  assert.equal(event.recipient, null);
  assert.equal(event.isGroup, null);
  assert.deepEqual(event.mentions, []);
});

test('normalizeIncomingMessage tolerates missing bodyText/id (media-only message)', () => {
  const event = normalizeIncomingMessage({ messageId: null, fromMe: true, bodyText: null, hasMedia: true, time: null });
  assert.equal(event.body, '');
  assert.equal(event.id, null);
  assert.equal(event.hasMedia, true);
});
