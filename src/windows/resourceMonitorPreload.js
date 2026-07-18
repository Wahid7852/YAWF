'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yawf', {
  getMetrics: () => ipcRenderer.invoke('metrics:get'),
  getI18n: () => ipcRenderer.invoke('i18n:get-dict'),
});
