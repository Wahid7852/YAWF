'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yawf', {
  openChat: (phone) => ipcRenderer.invoke('phone-dialog:submit', phone),
});
