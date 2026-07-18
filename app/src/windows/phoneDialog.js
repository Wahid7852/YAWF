'use strict';

const { BrowserWindow } = require('electron');
const path = require('node:path');

let win = null;

function createPhoneDialog(parent) {
  if (win && !win.isDestroyed()) {
    win.focus();
    return win;
  }

  win = new BrowserWindow({
    width: 380,
    height: 170,
    resizable: false,
    parent,
    modal: true,
    title: 'Open chat by phone number',
    webPreferences: {
      preload: path.join(__dirname, 'phoneDialogPreload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'phoneDialog.html'));
  win.on('closed', () => {
    win = null;
  });

  return win;
}

module.exports = { createPhoneDialog };
