'use strict';

// Shared by every dialog/utility window's renderer: swaps textContent (and the
// document title) for anything tagged data-i18n, using the dict this window's
// preload fetched from main. Resolves with the dict so callers that need
// interpolated strings (e.g. resourceMonitor's live totals line) can reuse it
// without a second IPC round trip.
window.__yawfApplyI18n = async function applyI18n() {
  const dict = await window.yawf.getI18n();
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (dict[key]) el.textContent = dict[key];
  });
  return dict;
};
