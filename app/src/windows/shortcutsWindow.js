'use strict';

const { BrowserWindow } = require('electron');
const path = require('node:path');

let win = null;

function createShortcutsWindow(parent) {
  if (win && !win.isDestroyed()) {
    win.focus();
    return win;
  }

  win = new BrowserWindow({
    width: 420,
    height: 520,
    resizable: false,
    parent,
    title: 'YAWF Shortcuts',
    webPreferences: { sandbox: true },
  });

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'shortcuts.html'));
  win.on('closed', () => {
    win = null;
  });

  return win;
}

module.exports = { createShortcutsWindow };
