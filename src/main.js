'use strict';

const { app, BrowserWindow, ipcMain, shell, clipboard, nativeImage, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');

const { parseProfileArg, applyProfileUserDataPath } = require('./profile');
const { Settings } = require('./settings');
const { createTray } = require('./tray');
const { createPreferencesWindow } = require('./windows/preferencesWindow');
const { createPhoneDialog } = require('./windows/phoneDialog');
const { createShortcutsWindow } = require('./windows/shortcutsWindow');
const { createResourceMonitor } = require('./windows/resourceMonitor');
const { createApiDashboard } = require('./windows/apiDashboardWindow');
const { captureScreenshot } = require('./screenshot');
const { createI18n } = require('./i18n');
const { createApiServer } = require('./api/server');
const { ApiKeyStore } = require('./api/apiKeyStore');
const { AuditLog } = require('./api/auditLog');
const { WebhookStore } = require('./api/webhooks/webhookStore');
const { WebhookDispatcher } = require('./api/webhooks/dispatcher');
const { BridgeClient } = require('./bridge/client');
const { IPC_CALL, IPC_RESULT, IPC_EVENT, ALLOWED_PUSH_EVENTS } = require('./bridge/protocol');

const WHATSAPP_URL = 'https://web.whatsapp.com';
const ICON_DIR = path.join(__dirname, '..', 'build', 'icons');
const USER_CSS_PATH = path.join(os.homedir(), '.config', 'yawf', 'user.css');
const REMOTE_FLAGS = ['--show', '--hide', '--refresh', '--quit'];

let PROFILE_NAME = 'default';
try {
  PROFILE_NAME = parseProfileArg(process.argv);
  applyProfileUserDataPath(app, PROFILE_NAME);
} catch (err) {
  console.error(err.message);
  app.quit();
  process.exit(1);
}

const gotLock = app.requestSingleInstanceLock({ profile: PROFILE_NAME });
if (!gotLock) {
  app.quit();
  process.exit(0);
}

// Mirrors the C++ app's RAM-relative WebKit memory-pressure tuning: cap the
// renderer's V8 old-space at 40% of physical RAM instead of leaving it
// unbounded, so a heavy group-chat session degrades into GC pressure rather
// than slowly eating the whole machine. Must be set before app is ready.
const maxOldSpaceMb = Math.max(512, Math.floor((os.totalmem() / (1024 * 1024)) * 0.4));
app.commandLine.appendSwitch('js-flags', `--max-old-space-size=${maxOldSpaceMb}`);

// Vulkan-via-Wayland GPU-process crash: on some Mesa/compositor combos Chromium
// repeatedly fails to launch the GPU process over Vulkan and eventually hard-aborts
// the whole browser process ("GPU process isn't usable. Goodbye."). GL acceleration
// stays on - only the Vulkan path is cut, which is what Chromium's own warning
// suggests when it logs the incompatibility.
app.commandLine.appendSwitch('disable-features', 'Vulkan,VulkanFromANGLE,DefaultANGLEVulkan');

// Trim background Chromium services this single-site wrapper never uses - fewer
// background threads/network requests at idle, smaller resident set.
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-sync');
app.commandLine.appendSwitch('disable-default-apps');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-domain-reliability');
app.commandLine.appendSwitch('disable-breakpad');

// Every ipcMain handler below is reachable only from windows we created and
// loaded from our own local files (see registerIpc/trustWindow) - the one
// window that loads remote content, mainWindow's WhatsApp Web page, has no
// contextBridge exposure and no nodeIntegration, so it has no way to call
// ipcRenderer at all. This set is belt-and-suspenders: it means a future
// mistake (e.g. someone adding a contextBridge to the main window, or a
// dialog window navigating somewhere unexpected) fails closed instead of
// silently granting IPC access to untrusted content.
const trustedWebContentsIds = new Set();
function trustWindow(win) {
  // Capture the id before it's used in the 'closed' handler - by the time that
  // event fires, win.webContents is already destroyed, so reading .id from it
  // then throws "Object has been destroyed" (this crashed every window close
  // with an uncaught-exception dialog until caught by an actual close test).
  const id = win.webContents.id;
  trustedWebContentsIds.add(id);
  win.on('closed', () => trustedWebContentsIds.delete(id));
  return win;
}
function handleTrusted(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!trustedWebContentsIds.has(event.sender.id)) {
      console.error(`[YAWF] rejected untrusted IPC: ${channel}`);
      throw new Error('untrusted sender');
    }
    return fn(event, ...args);
  });
}
function onTrusted(channel, fn) {
  ipcMain.on(channel, (event, ...args) => {
    if (!trustedWebContentsIds.has(event.sender.id)) {
      console.error(`[YAWF] rejected untrusted IPC: ${channel}`);
      return;
    }
    fn(event, ...args);
  });
}

// A DELIBERATELY separate, narrower trust check from trustedWebContentsIds above -
// mainWindow's WhatsApp Web page must never be added to that set (see the bridge
// injection comment near injectBridge()), but the bridge relay channels below are
// the one place main.js does expect traffic from that specific webContents. This
// name is intentionally different from handleTrusted/onTrusted so a reviewer never
// mistakes this for the same, stronger trust tier those grant to YAWF's own windows.
function onFromMainWindow(channel, fn) {
  ipcMain.on(channel, (event, ...args) => {
    if (!mainWindow || event.sender.id !== mainWindow.webContents.id) return;
    fn(event, ...args);
  });
}

let mainWindow = null;
let tray = null;
let settings = null;
let i18n = null;
let quitting = false;
let reloadTimer = null;
let reloadBackoffMs = 2000;
let idleCheckInterval = null;
let lastActivity = Date.now();
let pendingDeepLinkPhone = null;

let apiKeyStore = null;
let auditLog = null;
let webhookStore = null;
let webhookDispatcher = null;
let apiServer = null;

let bridgeToken = null;
let bridgeClient = null;
let bridgeSessionState = null;

function chromeUserAgent() {
  return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
}

function extractPhoneFromDeepLink(raw) {
  // whatsapp://send?phone=1234567890  or  whatsapp:1234567890
  try {
    const url = new URL(raw);
    const fromQuery = url.searchParams.get('phone');
    if (fromQuery) return fromQuery.replace(/[^\d+]/g, '');
    const fromPath = (url.hostname + url.pathname).replace(/[^\d+]/g, '');
    return fromPath || null;
  } catch {
    return null;
  }
}

function openPhoneChat(win, phone) {
  win.loadURL(`${WHATSAPP_URL}/send?phone=${encodeURIComponent(phone)}`);
}

// CLI remote control against an already-running instance: `yawf --show|--hide|--refresh|--quit`
// (elecwhat does this via D-Bus; argv-over-single-instance-lock covers the same scripting use
// case - a shell alias or status-bar button - without adding a D-Bus surface to audit).
function handleRemoteCommand(argv) {
  const flag = argv.find((a) => REMOTE_FLAGS.includes(a));
  if (!flag || !mainWindow) return false;
  switch (flag) {
    case '--show':
      mainWindow.show();
      mainWindow.focus();
      break;
    case '--hide':
      mainWindow.hide();
      break;
    case '--refresh':
      mainWindow.loadURL(WHATSAPP_URL);
      break;
    case '--quit':
      quitting = true;
      app.quit();
      break;
  }
  return true;
}

function injectUserCss(win) {
  fs.readFile(USER_CSS_PATH, 'utf8', (err, css) => {
    if (err || !css.trim()) return;
    win.webContents.insertCSS(css).catch(() => {});
  });
}

// Builds the source string run in the WhatsApp Web page's own main world via
// executeJavaScript (NOT preload's isolated world - see the trust-boundary
// comment on onFromMainWindow above). protocol.js and normalize.js are plain
// CommonJS modules main.js/preload.js also require() normally; here their
// source text is concatenated ahead of injected.js and the whole thing wrapped
// in an IIFE that takes the per-launch token as its only parameter, since
// injected.js is never require()'d and has no other way to receive it.
function buildBridgeSource(token) {
  const dir = path.join(__dirname, 'bridge');
  const parts = [
    fs.readFileSync(path.join(dir, 'protocol.js'), 'utf8'),
    fs.readFileSync(path.join(dir, 'normalize.js'), 'utf8'),
    fs.readFileSync(path.join(dir, 'injected.js'), 'utf8'),
  ];
  return `(function (YAWF_BRIDGE_TOKEN) {\n${parts.join('\n;\n')}\n})(${JSON.stringify(token)});`;
}

// Injects the Store bridge into the WhatsApp Web page. Gated behind
// apiBridgeEnabled (default off) - see docs/automation-api.md for the current,
// deliberately narrow scope (session status/QR via DOM signals, not WhatsApp's
// internal webpack Store) and its unverified-against-a-live-account caveat.
function injectBridge(win) {
  if (!settings.get('apiBridgeEnabled')) return;
  bridgeClient?.rejectAll('page reloaded, bridge re-injecting');
  bridgeToken = crypto.randomBytes(16).toString('hex');
  bridgeClient = new BridgeClient({
    send: (payload) => win.webContents.send(IPC_CALL, { ...payload, token: bridgeToken }),
  });
  win.webContents.executeJavaScript(buildBridgeSource(bridgeToken)).catch((err) => {
    console.error('[YAWF] bridge injection failed:', err.message);
  });
}

function handleArgvForDeepLink(argv) {
  const link = argv.find((a) => a.startsWith('whatsapp:'));
  if (!link) return;
  const phone = extractPhoneFromDeepLink(link);
  if (!phone) return;
  if (mainWindow) {
    openPhoneChat(mainWindow, phone);
    mainWindow.show();
    mainWindow.focus();
  } else {
    pendingDeepLinkPhone = phone;
  }
}

function scheduleReload(reason) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  clearTimeout(reloadTimer);
  console.warn(`[YAWF] recovering (${reason}); retry in ${reloadBackoffMs}ms`);
  reloadTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.loadURL(WHATSAPP_URL);
  }, reloadBackoffMs);
  reloadBackoffMs = Math.min(reloadBackoffMs * 2, 60000);
}

function updateBadgeFromTitle(title) {
  const match = title.match(/^\((\d+)\)/);
  const count = match ? parseInt(match[1], 10) : 0;
  if (tray) tray.setUnreadCount(count);
  if (process.platform === 'linux') app.setBadgeCount(count);
}

function startIdleWatch() {
  clearInterval(idleCheckInterval);
  idleCheckInterval = setInterval(() => {
    const hours = settings.get('idleReloadHours');
    if (!hours || hours <= 0) return;
    const idleMs = Date.now() - lastActivity;
    if (idleMs >= hours * 3600 * 1000) {
      lastActivity = Date.now();
      scheduleReload(`idle for ${hours}h, resetting JS heap`);
    }
  }, 60 * 1000);
}

let resourceTooltipInterval = null;
function startResourceTooltip() {
  clearInterval(resourceTooltipInterval);
  resourceTooltipInterval = setInterval(() => {
    if (!tray) return;
    const metrics = app.getAppMetrics();
    const totalMb = Math.round(metrics.reduce((sum, m) => sum + m.memory.workingSetSize, 0) / 1024);
    const totalCpu = metrics.reduce((sum, m) => sum + m.cpu.percentCPUUsage, 0);
    tray.setResourceSummary(`${totalMb}MB, ${totalCpu.toFixed(0)}% CPU`);
  }, 5000);
}

// Chromium's spellchecker only ships dictionaries for a fixed set of BCP-47
// codes, and passing one it doesn't recognize to setSpellCheckerLanguages
// throws rather than degrading gracefully - a real bug seen in a competing
// Electron WhatsApp client, which crash-loops on region variants like en-IN
// that aren't in that list. Check availableSpellCheckerLanguages first and
// only ask for what's actually there, falling back to the bare language
// (en-IN -> en) and then en-US, instead of trusting the OS locale blindly.
function applySpellCheckerLanguage(win) {
  const session = win.webContents.session;
  const available = session.availableSpellCheckerLanguages || [];
  const osLocale = app.getLocale();
  if (available.includes(osLocale)) {
    session.setSpellCheckerLanguages([osLocale]);
    return;
  }
  const bareLang = osLocale.split('-')[0];
  const match = available.find((l) => l === bareLang || l.startsWith(`${bareLang}-`));
  session.setSpellCheckerLanguages([match || 'en-US']);
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: !settings.get('startMinimized'),
    icon: path.join(ICON_DIR, '256x256.png'),
    title: 'YAWF',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
      // Let Chromium throttle timers/rAF when hidden in the tray - real-time
      // message delivery still comes over the WebSocket, unaffected by this.
      backgroundThrottling: true,
    },
  });

  win.webContents.setUserAgent(chromeUserAgent());
  win.webContents.setZoomFactor(settings.get('zoomFactor'));
  applySpellCheckerLanguage(win);
  win.loadURL(WHATSAPP_URL);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(['notifications', 'media', 'clipboard-sanitized-write'].includes(permission));
  });

  win.on('close', (e) => {
    if (!quitting && settings.get('closeToTray')) {
      e.preventDefault();
      win.hide();
    }
  });

  win.webContents.on('did-finish-load', () => {
    reloadBackoffMs = 2000;
    injectUserCss(win);
    injectBridge(win);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    scheduleReload(`renderer gone: ${details.reason}`);
  });
  win.webContents.on('did-fail-load', (_e, code) => {
    if (code !== -3) scheduleReload(`load failed (${code})`);
  });
  win.webContents.on('page-title-updated', (_e, title) => updateBadgeFromTitle(title));

  return win;
}

function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
  tray?.rebuildMenu();
}

function broadcastSettings() {
  mainWindow?.webContents.send('settings:changed', settings.getAll());
}

function openPreferencesWindow() {
  return trustWindow(createPreferencesWindow(mainWindow, i18n));
}
function openPhoneDialog() {
  return trustWindow(createPhoneDialog(mainWindow, i18n));
}
function openShortcutsWindow() {
  return trustWindow(createShortcutsWindow(mainWindow, i18n));
}
function openResourceMonitor() {
  return trustWindow(createResourceMonitor(mainWindow, i18n));
}
function openApiDashboard() {
  return trustWindow(createApiDashboard(mainWindow, i18n));
}

// Stops any running API server instance. Safe to call whether or not one is running.
async function stopApiServer() {
  if (!apiServer) return;
  await apiServer.stop();
  apiServer = null;
}

// (Re)starts the API server to match current settings - called on startup and
// whenever apiEnabled/apiPort/apiBindAddress change. A failed listen() (e.g.
// EADDRINUSE from a second --profile sharing the default port) must not take
// the rest of the app down with it, same spirit as the tray-creation try/catch.
async function startApiServerIfEnabled() {
  await stopApiServer();
  if (!settings.get('apiEnabled')) return;
  const server = createApiServer({
    settings,
    apiKeyStore,
    auditLog,
    webhookStore,
    dispatcher: webhookDispatcher,
    // Accessor, not a snapshot: bridgeClient is only set later, from
    // did-finish-load, well after this server is constructed - see
    // routes/session.js's comment for why capturing the value here directly
    // would permanently see today's (pre-bridge) null.
    getBridgeClient: () => bridgeClient,
  });
  try {
    await server.start();
    apiServer = server;
  } catch (err) {
    console.error('[YAWF] API server failed to start:', err.message);
  }
}

function registerIpc() {
  handleTrusted('i18n:get-dict', () => i18n.dict);
  handleTrusted('settings:get-all', () => settings.getAll());
  handleTrusted('settings:set', (_e, key, value) => {
    settings.set(key, value);
    if (key === 'autostart') app.setLoginItemSettings({ openAtLogin: !!value });
    if (['apiEnabled', 'apiPort', 'apiBindAddress'].includes(key)) startApiServerIfEnabled();
    if (key === 'apiBridgeEnabled') {
      // injectBridge() only runs from did-finish-load, so flip it on/off immediately
      // by reloading rather than leaving the change to take effect on the next
      // otherwise-triggered reload (crash recovery, idle reset, manual refresh).
      bridgeClient?.rejectAll('bridge disabled');
      if (!value) bridgeClient = null;
      mainWindow?.loadURL(WHATSAPP_URL);
    }
    broadcastSettings();
    return settings.getAll();
  });

  handleTrusted('api:get-status', () => ({
    enabled: settings.get('apiEnabled'),
    bridgeEnabled: settings.get('apiBridgeEnabled'),
    port: settings.get('apiPort'),
    bindAddress: settings.get('apiBindAddress'),
    running: !!apiServer,
    sessionState: bridgeSessionState,
  }));
  handleTrusted('api:list-keys', () => apiKeyStore.list());
  handleTrusted('api:create-key', (_e, fields) => apiKeyStore.create(fields || {}));
  handleTrusted('api:revoke-key', (_e, id) => apiKeyStore.revoke(id));
  handleTrusted('api:remove-key', (_e, id) => apiKeyStore.remove(id));
  handleTrusted('api:list-webhooks', () => webhookStore.list());
  handleTrusted('api:create-webhook', (_e, fields) => webhookStore.create(fields || {}));
  handleTrusted('api:update-webhook', (_e, id, patch) => webhookStore.update(id, patch || {}));
  handleTrusted('api:remove-webhook', (_e, id) => webhookStore.remove(id));
  handleTrusted('api:test-webhook', (_e, id) =>
    webhookDispatcher.deliverTest(id, 'message.received', {
      sender: 'test',
      body: 'this is a test delivery from YAWF',
      isGroup: false,
      fromMe: false,
    })
  );
  handleTrusted('api:get-audit', (_e, opts) => ({ entries: auditLog.read(opts || {}) }));

  // Bridge relay - see onFromMainWindow's comment above for why this is a
  // separate, narrower trust tier than handleTrusted/onTrusted. Everything
  // arriving here is treated as data, never as a command: the token gate
  // rejects anything not echoed from OUR OWN injected script instance, and a
  // JSON round-trip on push-event data defeats prototype-pollution-shaped
  // payloads by discarding any live object graph in favor of plain data.
  onFromMainWindow(IPC_RESULT, (_e, msg) => {
    if (!msg || msg.token !== bridgeToken) return;
    bridgeClient?.handleResult(msg);
  });
  onFromMainWindow(IPC_EVENT, (_e, msg) => {
    if (!msg || msg.token !== bridgeToken) return;
    if (!ALLOWED_PUSH_EVENTS.includes(msg.type)) return;
    let data;
    try {
      data = JSON.parse(JSON.stringify(msg.data));
    } catch {
      return;
    }
    if (msg.type === 'session.status') {
      bridgeSessionState = data.state;
    } else {
      webhookDispatcher.dispatch(msg.type, data);
    }
  });
  handleTrusted('clipboard:read-image', () => {
    const img = clipboard.readImage();
    return img.isEmpty() ? null : img.toDataURL();
  });
  handleTrusted('screenshot:capture', async () => {
    const buf = await captureScreenshot().catch(() => null);
    if (!buf) return null;
    return nativeImage.createFromBuffer(buf).toDataURL();
  });
  onTrusted('activity', () => {
    lastActivity = Date.now();
  });
  onTrusted('whatsapp-error-detected', () => scheduleReload('in-page error screen detected'));

  handleTrusted('zoom:set', (_e, factor) => {
    const clamped = Math.min(3, Math.max(0.5, factor));
    settings.set('zoomFactor', clamped);
    mainWindow?.webContents.setZoomFactor(clamped);
    return clamped;
  });
  onTrusted('window:toggle-fullscreen', () => {
    if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen());
  });
  onTrusted('open-phone-dialog', openPhoneDialog);
  onTrusted('open-shortcuts', openShortcutsWindow);
  onTrusted('open-resource-monitor', openResourceMonitor);
  onTrusted('open-api-dashboard', openApiDashboard);
  onTrusted('open-preferences', openPreferencesWindow);
  handleTrusted('metrics:get', () => app.getAppMetrics());
  handleTrusted('phone-dialog:submit', (_e, phone) => {
    if (!mainWindow) return;
    openPhoneChat(mainWindow, phone);
    mainWindow.show();
    mainWindow.focus();
  });
}

app.on('second-instance', (_e, argv) => {
  if (handleRemoteCommand(argv)) return;
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
  handleArgvForDeepLink(argv);
});

app.on('open-url', (e, url) => {
  e.preventDefault();
  handleArgvForDeepLink([url]);
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  settings = new Settings(app.getPath('userData'));
  i18n = createI18n(app.getLocale());
  app.setAsDefaultProtocolClient('whatsapp');

  const userDataDir = app.getPath('userData');
  apiKeyStore = new ApiKeyStore(userDataDir);
  auditLog = new AuditLog(userDataDir);
  webhookStore = new WebhookStore(userDataDir);
  webhookDispatcher = new WebhookDispatcher({ webhookStore });

  registerIpc();

  mainWindow = trustWindow(createMainWindow());
  lastActivity = Date.now();
  startIdleWatch();
  startApiServerIfEnabled();

  // Tray creation touches icon files and a DBus-backed StatusNotifierItem, both of
  // which can fail for reasons outside our control (missing bundled asset, no SNI
  // host on the session bus). That must never take the rest of startup down with it.
  try {
    tray = createTray({
      iconDir: ICON_DIR,
      t: i18n.t,
      onToggleWindow: toggleWindow,
      onRefresh: () => mainWindow?.loadURL(WHATSAPP_URL),
      onPreferences: openPreferencesWindow,
      onOpenPhoneDialog: openPhoneDialog,
      onShortcuts: openShortcutsWindow,
      onResourceMonitor: openResourceMonitor,
      onApiDashboard: openApiDashboard,
      isApiEnabled: () => !!settings.get('apiEnabled'),
      onToggleApi: () => {
        settings.set('apiEnabled', !settings.get('apiEnabled'));
        startApiServerIfEnabled();
        tray?.rebuildMenu();
      },
      onQuit: () => {
        quitting = true;
        app.quit();
      },
      isWindowVisible: () => !!mainWindow?.isVisible(),
    });
    startResourceTooltip();
  } catch (err) {
    console.error('[YAWF] tray unavailable:', err.message);
  }

  if (pendingDeepLinkPhone) {
    openPhoneChat(mainWindow, pendingDeepLinkPhone);
    pendingDeepLinkPhone = null;
  } else {
    handleArgvForDeepLink(process.argv);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow();
    else toggleWindow();
  });
});

app.on('before-quit', () => {
  quitting = true;
});

app.on('window-all-closed', () => {
  // Tray keeps the app alive by design (closeToTray); only fully quit via tray/menu Quit.
  if (process.platform !== 'darwin' && quitting) app.quit();
});
