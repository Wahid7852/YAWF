'use strict';

const { app, BrowserWindow, ipcMain, shell, clipboard, nativeImage, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { parseProfileArg, applyProfileUserDataPath } = require('./profile');
const { Settings } = require('./settings');
const { createTray } = require('./tray');
const { createPreferencesWindow } = require('./windows/preferencesWindow');
const { createPhoneDialog } = require('./windows/phoneDialog');
const { createShortcutsWindow } = require('./windows/shortcutsWindow');
const { createResourceMonitor } = require('./windows/resourceMonitor');
const { captureScreenshot } = require('./screenshot');
const { createI18n } = require('./i18n');

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

function registerIpc() {
  handleTrusted('i18n:get-dict', () => i18n.dict);
  handleTrusted('settings:get-all', () => settings.getAll());
  handleTrusted('settings:set', (_e, key, value) => {
    settings.set(key, value);
    if (key === 'autostart') app.setLoginItemSettings({ openAtLogin: !!value });
    broadcastSettings();
    return settings.getAll();
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
  registerIpc();

  mainWindow = trustWindow(createMainWindow());
  lastActivity = Date.now();
  startIdleWatch();

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
