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
  setImmediate: 'readonly',
  URL: 'readonly',
  Buffer: 'readonly',
  fetch: 'readonly',
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
  CustomEvent: 'readonly',
  DataTransfer: 'readonly',
  File: 'readonly',
  MutationObserver: 'readonly',
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
    // injected.js is never require()'d - it's read as a source string and run via
    // webContents.executeJavaScript in the WhatsApp Web page's own main world, so it
    // gets DOM globals plus WA Web's own webpack `require`, but no Node globals at all.
    // deriveSessionStatus/EVT_*/YAWF_BRIDGE_TOKEN come from protocol.js/normalize.js's
    // source being concatenated ahead of this file, and from main.js's wrapping IIFE
    // parameter respectively (see main.js's buildBridgeSource) - eslint only sees this
    // file in isolation, so they're declared here as globals rather than imports.
    files: ['src/bridge/injected.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: {
        ...browserGlobals,
        require: 'readonly',
        EVT_CALL: 'readonly',
        EVT_RESULT: 'readonly',
        EVT_PUSH: 'readonly',
        deriveSessionStatus: 'readonly',
        isIncomingByPosition: 'readonly',
        extractMessageIdFromTestId: 'readonly',
        parseMessageTime: 'readonly',
        normalizeIncomingMessage: 'readonly',
        YAWF_BRIDGE_TOKEN: 'readonly',
      },
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
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
];
