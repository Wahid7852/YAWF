'use strict';

const { BrowserWindow } = require('electron');
const path = require('node:path');

let win = null;

function createPreferencesWindow(parent, i18n) {
  if (win && !win.isDestroyed()) {
    win.focus();
    return win;
  }

  win = new BrowserWindow({
    width: 480,
    height: 420,
    resizable: false,
    parent,
    title: i18n.t('prefs.title'),
    webPreferences: {
      preload: path.join(__dirname, 'preferencesPreload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'preferences.html'));
  win.on('closed', () => {
    win = null;
  });

  return win;
}

module.exports = { createPreferencesWindow };
