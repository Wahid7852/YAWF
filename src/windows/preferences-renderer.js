'use strict';

const BOOL_FIELDS = ['ctrlEnterToSend', 'closeToTray', 'startMinimized', 'autostart', 'apiEnabled', 'apiBridgeEnabled'];
const NUMBER_FIELDS = ['idleReloadHours', 'apiPort'];

async function init() {
  window.__yawfApplyI18n();
  const settings = await window.yawf.getSettings();

  for (const key of BOOL_FIELDS) {
    const el = document.getElementById(key);
    el.checked = !!settings[key];
    el.addEventListener('change', () => window.yawf.setSetting(key, el.checked));
  }

  for (const key of NUMBER_FIELDS) {
    const el = document.getElementById(key);
    el.value = settings[key];
    el.addEventListener('change', () => window.yawf.setSetting(key, Number(el.value)));
  }
}

init();
