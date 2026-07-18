'use strict';

const fs = require('node:fs');
const path = require('node:path');

const LOCALES_DIR = path.join(__dirname, 'locales');
const AVAILABLE = fs
  .readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''));

const en = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, 'en.json'), 'utf8'));

function resolveLocale(osLocale) {
  const lower = (osLocale || 'en').toLowerCase();
  if (lower.startsWith('pt-br') || lower.startsWith('pt_br')) return 'pt_BR';
  if (lower.startsWith('zh-hans') || lower.startsWith('zh-cn') || lower.startsWith('zh_hans')) {
    return 'zh_Hans';
  }
  const lang = lower.split(/[-_]/)[0];
  return AVAILABLE.includes(lang) ? lang : 'en';
}

function loadDict(locale) {
  if (locale === 'en') return { ...en };
  try {
    const raw = fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), 'utf8');
    // English fills in any key a locale file hasn't translated yet.
    return { ...en, ...JSON.parse(raw) };
  } catch {
    return { ...en };
  }
}

function createI18n(osLocale) {
  const locale = resolveLocale(osLocale);
  const dict = loadDict(locale);

  function t(key, vars) {
    let str = dict[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        str = str.replace(`{${k}}`, v);
      }
    }
    return str;
  }

  return { locale, dict, t };
}

module.exports = { createI18n, resolveLocale, AVAILABLE };
