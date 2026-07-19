'use strict';

let dict = {};

function t(key, fallback) {
  return dict[key] || fallback;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function refreshStatus() {
  const status = await window.yawf.getStatus();
  document.getElementById('apiEnabled').checked = status.enabled;
  const hint = document.getElementById('statusHint');
  if (!status.enabled) {
    hint.textContent = t('apiDashboard.status.disabled', 'Disabled');
  } else if (status.running) {
    hint.textContent = `${t('apiDashboard.status.listening', 'Listening on')} ${status.bindAddress}:${status.port}`;
  } else {
    hint.textContent = t('apiDashboard.status.failed', 'Enabled but not running - check the port is free');
  }
}

async function refreshKeys() {
  const keys = await window.yawf.listKeys();
  const rows = document.getElementById('keysRows');
  rows.innerHTML = '';
  if (keys.length === 0) {
    rows.innerHTML = `<tr><td colspan="5" class="empty">${t('apiDashboard.noKeys', 'No API keys yet')}</td></tr>`;
    return;
  }
  for (const key of keys) {
    const tr = document.createElement('tr');
    const statusBadge = key.isActive
      ? `<span class="badge on">${t('apiDashboard.active', 'active')}</span>`
      : `<span class="badge off">${t('apiDashboard.revoked', 'revoked')}</span>`;
    tr.innerHTML = `
      <td>${escapeHtml(key.name)}</td>
      <td class="mono">${escapeHtml(key.keyPrefix)}...</td>
      <td>${escapeHtml(key.role)}</td>
      <td>${statusBadge}</td>
      <td>
        ${key.isActive ? `<button data-revoke-key="${key.id}">${t('apiDashboard.revoke', 'Revoke')}</button>` : ''}
        <button class="danger" data-remove-key="${key.id}">${t('apiDashboard.remove', 'Remove')}</button>
      </td>`;
    rows.appendChild(tr);
  }
}

async function refreshWebhooks() {
  const webhooks = await window.yawf.listWebhooks();
  const rows = document.getElementById('webhooksRows');
  rows.innerHTML = '';
  if (webhooks.length === 0) {
    rows.innerHTML = `<tr><td colspan="5" class="empty">${t('apiDashboard.noWebhooks', 'No webhooks yet')}</td></tr>`;
    return;
  }
  for (const hook of webhooks) {
    const tr = document.createElement('tr');
    const statusBadge = hook.active
      ? `<span class="badge on">${t('apiDashboard.active', 'active')}</span>`
      : `<span class="badge off">${t('apiDashboard.disabled', 'disabled')}</span>`;
    tr.innerHTML = `
      <td class="mono">${escapeHtml(hook.url)}</td>
      <td>${escapeHtml(hook.events.join(', '))}</td>
      <td>${statusBadge}</td>
      <td>${escapeHtml(hook.lastStatus || t('apiDashboard.never', 'never'))}</td>
      <td>
        <button data-test-webhook="${hook.id}">${t('apiDashboard.test', 'Test')}</button>
        <button class="danger" data-remove-webhook="${hook.id}">${t('apiDashboard.remove', 'Remove')}</button>
      </td>`;
    rows.appendChild(tr);
  }
}

async function refreshAudit() {
  const { entries } = await window.yawf.getAudit({ limit: 25 });
  const rows = document.getElementById('auditRows');
  rows.innerHTML = '';
  if (entries.length === 0) {
    rows.innerHTML = `<tr><td colspan="5" class="empty">${t('apiDashboard.noActivity', 'No requests yet')}</td></tr>`;
    return;
  }
  for (const entry of entries) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${new Date(entry.ts).toLocaleTimeString()}</td>
      <td>${escapeHtml(entry.method || '-')}</td>
      <td class="mono">${escapeHtml(entry.path || '-')}</td>
      <td>${entry.status ?? '-'}</td>
      <td>${escapeHtml(entry.keyPrefix || '-')}</td>`;
    rows.appendChild(tr);
  }
}

async function refreshAll() {
  await Promise.all([refreshStatus(), refreshKeys(), refreshWebhooks(), refreshAudit()]);
}

function wireEvents() {
  document.getElementById('apiEnabled').addEventListener('change', async (e) => {
    await window.yawf.setSetting('apiEnabled', e.target.checked);
    refreshStatus();
  });

  document.getElementById('createKeyBtn').addEventListener('click', async () => {
    const name = document.getElementById('newKeyName').value.trim() || 'unnamed key';
    const role = document.getElementById('newKeyRole').value;
    const { record, rawKey } = await window.yawf.createKey({ name, role });
    const box = document.getElementById('newKeyBox');
    box.style.display = 'block';
    box.innerHTML = `<strong>${t('apiDashboard.newKeyWarning', 'Copy this now - it will not be shown again:')}</strong><br>${escapeHtml(rawKey)}`;
    document.getElementById('newKeyName').value = '';
    void record;
    refreshKeys();
  });

  document.getElementById('createWebhookBtn').addEventListener('click', async () => {
    const url = document.getElementById('newWebhookUrl').value.trim();
    const secret = document.getElementById('newWebhookSecret').value.trim();
    const events = document.getElementById('newWebhookEvents').value.split(',').map((s) => s.trim()).filter(Boolean);
    if (!url || !secret) return;
    await window.yawf.createWebhook({ url, secret, events });
    document.getElementById('newWebhookUrl').value = '';
    document.getElementById('newWebhookSecret').value = '';
    document.getElementById('newWebhookEvents').value = '';
    refreshWebhooks();
  });

  document.getElementById('keysRows').addEventListener('click', async (e) => {
    const revokeId = e.target.getAttribute('data-revoke-key');
    const removeId = e.target.getAttribute('data-remove-key');
    if (revokeId) await window.yawf.revokeKey(revokeId);
    if (removeId) await window.yawf.removeKey(removeId);
    if (revokeId || removeId) refreshKeys();
  });

  document.getElementById('webhooksRows').addEventListener('click', async (e) => {
    const testId = e.target.getAttribute('data-test-webhook');
    const removeId = e.target.getAttribute('data-remove-webhook');
    if (testId) {
      await window.yawf.testWebhook(testId);
      refreshWebhooks();
    }
    if (removeId) {
      await window.yawf.removeWebhook(removeId);
      refreshWebhooks();
    }
  });
}

async function init() {
  dict = await window.__yawfApplyI18n();
  wireEvents();
  await refreshAll();
  const interval = setInterval(refreshAll, 3000);
  window.addEventListener('beforeunload', () => clearInterval(interval));
}

init();
