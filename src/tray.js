'use strict';

const { Tray, Menu, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

function iconPath(iconDir, attention) {
  return path.join(iconDir, attention ? 'tray-attention-32.png' : 'tray-32.png');
}

function loadIcon(iconDir, attention) {
  const file = iconPath(iconDir, attention);
  if (!fs.existsSync(file)) {
    throw new Error(`tray icon missing on disk: ${file}`);
  }
  const img = nativeImage.createFromPath(file);
  if (img.isEmpty()) {
    throw new Error(`tray icon failed to decode: ${file}`);
  }
  return img;
}

function createTray({
  iconDir,
  t,
  onToggleWindow,
  onRefresh,
  onPreferences,
  onOpenPhoneDialog,
  onShortcuts,
  onResourceMonitor,
  onQuit,
  isWindowVisible,
}) {
  const tray = new Tray(loadIcon(iconDir, false));
  tray.setToolTip('YAWF');

  let unread = 0;
  let resourceSummary = '';

  function rebuildMenu() {
    const menu = Menu.buildFromTemplate([
      { label: isWindowVisible() ? t('tray.hide') : t('tray.show'), click: onToggleWindow },
      { label: t('tray.refresh'), click: onRefresh },
      { label: t('tray.openPhoneDialog'), click: onOpenPhoneDialog },
      { label: t('tray.preferences'), click: onPreferences },
      { label: t('tray.shortcuts'), click: onShortcuts },
      { label: t('tray.resourceMonitor'), click: onResourceMonitor },
      { type: 'separator' },
      { label: t('tray.quit'), click: onQuit },
    ]);
    tray.setContextMenu(menu);
  }

  function updateTooltip() {
    const parts = ['YAWF'];
    if (unread > 0) parts.push(t('tray.unread', { count: unread }));
    if (resourceSummary) parts.push(resourceSummary);
    tray.setToolTip(parts.join(' - '));
  }

  function setUnreadCount(count) {
    unread = count;
    try {
      tray.setImage(loadIcon(iconDir, count > 0));
    } catch (err) {
      console.error('[YAWF]', err.message);
    }
    updateTooltip();
  }

  function setResourceSummary(text) {
    resourceSummary = text;
    updateTooltip();
  }

  tray.on('click', onToggleWindow);
  rebuildMenu();
  updateTooltip();

  return {
    setUnreadCount,
    setResourceSummary,
    rebuildMenu,
    destroy: () => tray.destroy(),
  };
}

module.exports = { createTray };
