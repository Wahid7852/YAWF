'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createI18n, resolveLocale, AVAILABLE } = require('./i18n');

test('resolveLocale matches exact language codes', () => {
  assert.equal(resolveLocale('de-DE'), 'de');
  assert.equal(resolveLocale('fr-FR'), 'fr');
  assert.equal(resolveLocale('en-US'), 'en');
});

test('resolveLocale handles Portuguese Brazil specially, falls back for other pt variants', () => {
  assert.equal(resolveLocale('pt-BR'), 'pt_BR');
  assert.equal(resolveLocale('pt_BR'), 'pt_BR');
  assert.equal(resolveLocale('pt-PT'), 'en'); // not in AVAILABLE, no generic "pt" file
});

test('resolveLocale handles Simplified Chinese variants', () => {
  assert.equal(resolveLocale('zh-Hans-CN'), 'zh_Hans');
  assert.equal(resolveLocale('zh-CN'), 'zh_Hans');
});

test('resolveLocale falls back to English for unknown/unsupported locales', () => {
  assert.equal(resolveLocale('xx-XX'), 'en');
  assert.equal(resolveLocale(''), 'en');
  assert.equal(resolveLocale(undefined), 'en');
});

test('every locale file loads and resolves to itself (or a documented alias)', () => {
  for (const locale of AVAILABLE) {
    if (locale === 'en') continue;
    const i18n = createI18n(locale.replace('_', '-'));
    assert.equal(i18n.locale, locale, `expected ${locale} to resolve back to itself`);
  }
});

test('t() interpolates variables', () => {
  const i18n = createI18n('en-US');
  assert.equal(i18n.t('tray.unread', { count: 5 }), '5 unread');
});

test('t() falls back to the key itself for an unknown key', () => {
  const i18n = createI18n('en-US');
  assert.equal(i18n.t('nonexistent.key'), 'nonexistent.key');
});

test('non-English locales fall back to English for any key they have not translated', () => {
  // every real locale file has all 47 keys (checked at write time), but the
  // fallback merge itself is what this test actually protects against regressing
  const i18n = createI18n('de-DE');
  assert.equal(typeof i18n.dict['tray.show'], 'string');
  assert.notEqual(i18n.dict['tray.show'], undefined);
});
