'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yawf', {
  getI18n: () => ipcRenderer.invoke('i18n:get-dict'),
});
