'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { matchesFilters, evaluateCondition } = require('./filters');

test('no filters/conditions matches everything', () => {
  assert.equal(matchesFilters(undefined, { sender: 'a' }), true);
  assert.equal(matchesFilters({}, { sender: 'a' }), true);
  assert.equal(matchesFilters({ conditions: [] }, { sender: 'a' }), true);
});

test('"is" operator matches on exact equality', () => {
  assert.equal(evaluateCondition({ field: 'sender', operator: 'is', value: 'a' }, { sender: 'a' }), true);
  assert.equal(evaluateCondition({ field: 'sender', operator: 'is', value: 'a' }, { sender: 'b' }), false);
});

test('operator defaults to "is" when omitted', () => {
  assert.equal(evaluateCondition({ field: 'fromMe', value: true }, { fromMe: true }), true);
});

test('"not" operator matches on inequality', () => {
  assert.equal(evaluateCondition({ field: 'sender', operator: 'not', value: 'a' }, { sender: 'b' }), true);
  assert.equal(evaluateCondition({ field: 'sender', operator: 'not', value: 'a' }, { sender: 'a' }), false);
});

test('"contains" operator matches substrings for string fields', () => {
  assert.equal(evaluateCondition({ field: 'body', operator: 'contains', value: 'urgent' }, { body: 'this is urgent!' }), true);
  assert.equal(evaluateCondition({ field: 'body', operator: 'contains', value: 'urgent' }, { body: 'all good' }), false);
});

test('"contains" operator matches array membership for array fields', () => {
  assert.equal(evaluateCondition({ field: 'mentions', operator: 'contains', value: '1234' }, { mentions: ['1234', '5678'] }), true);
  assert.equal(evaluateCondition({ field: 'mentions', operator: 'contains', value: '9999' }, { mentions: ['1234'] }), false);
});

test('"contains" returns false for non-string/non-array fields', () => {
  assert.equal(evaluateCondition({ field: 'fromMe', operator: 'contains', value: true }, { fromMe: true }), false);
});

test('an unknown operator fails closed (never matches)', () => {
  assert.equal(evaluateCondition({ field: 'sender', operator: 'regex', value: 'a.*' }, { sender: 'abc' }), false);
});

test('matchesFilters ANDs multiple conditions', () => {
  const filters = {
    conditions: [
      { field: 'isGroup', operator: 'is', value: false },
      { field: 'fromMe', operator: 'is', value: false },
    ],
  };
  assert.equal(matchesFilters(filters, { isGroup: false, fromMe: false }), true);
  assert.equal(matchesFilters(filters, { isGroup: true, fromMe: false }), false);
  assert.equal(matchesFilters(filters, { isGroup: false, fromMe: true }), false);
});

test('a field absent from the event simply fails to match "is"/"contains" rather than throwing', () => {
  assert.equal(evaluateCondition({ field: 'body', operator: 'contains', value: 'x' }, {}), false);
  assert.equal(evaluateCondition({ field: 'sender', operator: 'is', value: 'x' }, {}), false);
});
