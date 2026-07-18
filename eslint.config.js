'use strict';

const js = require('@eslint/js');

const nodeGlobals = {
  require: 'readonly',
  module: 'readonly',
  process: 'readonly',
  __dirname: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  clearTimeout: 'readonly',
  URL: 'readonly',
};

const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  fetch: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  clearTimeout: 'readonly',
  KeyboardEvent: 'readonly',
  ClipboardEvent: 'readonly',
  DataTransfer: 'readonly',
  File: 'readonly',
  Notification: 'readonly',
  WebSocket: 'readonly',
};

module.exports = [
  js.configs.recommended,
  {
    // This file itself
    files: ['eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: nodeGlobals,
    },
  },
  {
    // Main process + anything using require('electron') for Node-side APIs
    files: ['src/**/*.js'],
    ignores: ['src/windows/*-renderer.js', 'src/windows/i18n-apply.js', '**/*.test.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: nodeGlobals,
    },
  },
  {
    // Renderer-world scripts loaded via <script src>: no require, only DOM globals
    files: ['src/windows/*-renderer.js', 'src/windows/i18n-apply.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: browserGlobals,
    },
  },
  {
    // preload.js and *Preload.js run in the isolated world: both require() and DOM
    files: ['src/preload.js', 'src/windows/*Preload.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...nodeGlobals, ...browserGlobals },
    },
  },
  {
    files: ['**/*.test.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...nodeGlobals, describe: 'readonly', it: 'readonly' },
    },
  },
  {
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
];
