'use strict';

const { BrowserWindow } = require('electron');
const path = require('node:path');

let win = null;

function createResourceMonitor(parent, i18n) {
  if (win && !win.isDestroyed()) {
    win.focus();
    return win;
  }

  win = new BrowserWindow({
    width: 460,
    height: 420,
    resizable: true,
    parent,
    title: i18n.t('resourceMonitor.title'),
    webPreferences: {
      preload: path.join(__dirname, 'resourceMonitorPreload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'resourceMonitor.html'));
  win.on('closed', () => {
    win = null;
  });

  return win;
}

module.exports = { createResourceMonitor };
