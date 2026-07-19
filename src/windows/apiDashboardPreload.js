'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yawf', {
  getI18n: () => ipcRenderer.invoke('i18n:get-dict'),
  getSettings: () => ipcRenderer.invoke('settings:get-all'),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  getStatus: () => ipcRenderer.invoke('api:get-status'),
  listKeys: () => ipcRenderer.invoke('api:list-keys'),
  createKey: (fields) => ipcRenderer.invoke('api:create-key', fields),
  revokeKey: (id) => ipcRenderer.invoke('api:revoke-key', id),
  removeKey: (id) => ipcRenderer.invoke('api:remove-key', id),
  listWebhooks: () => ipcRenderer.invoke('api:list-webhooks'),
  createWebhook: (fields) => ipcRenderer.invoke('api:create-webhook', fields),
  removeWebhook: (id) => ipcRenderer.invoke('api:remove-webhook', id),
  testWebhook: (id) => ipcRenderer.invoke('api:test-webhook', id),
  getAudit: (opts) => ipcRenderer.invoke('api:get-audit', opts),
});
