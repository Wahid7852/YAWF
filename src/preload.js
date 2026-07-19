'use strict';

// Runs in the isolated world of the WhatsApp Web page. No contextBridge exposure
// on purpose: everything here operates on the real DOM directly, and WhatsApp's
// own scripts never need to see or call into it.

const { ipcRenderer } = require('electron');

// Duplicated from src/bridge/protocol.js rather than require()'d: this preload
// runs with sandbox:true, and Electron's sandboxed-preload loader only permits
// require('electron') and Node builtins - requiring an arbitrary local file
// here throws "module not found" and silently breaks preload loading entirely
// (discovered by actually launching the app - see docs/automation-api.md).
// Keep these six strings in sync with protocol.js if either ever changes.
const EVT_CALL = 'yawf:bridge-call';
const EVT_RESULT = 'yawf:bridge-result';
const EVT_PUSH = 'yawf:bridge-event';
const IPC_CALL = 'bridge:call';
const IPC_RESULT = 'bridge:call-result';
const IPC_EVENT = 'bridge:event';

let cachedSettings = {};
let cachedZoom = 1.0;

function getComposer() {
  const candidates = [
    'footer div[contenteditable="true"]',
    'div[contenteditable="true"][data-tab]',
    'div[role="textbox"][contenteditable="true"]',
  ];
  for (const sel of candidates) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return document.activeElement && document.activeElement.isContentEditable
    ? document.activeElement
    : null;
}

function wrapSelection(before, after) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const text = sel.toString();
  if (!text) return;
  document.execCommand('insertText', false, `${before}${text}${after}`);
}

function clearFormatting() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const text = sel.toString();
  const stripped = text.replace(/^[*_~`]+|[*_~`]+$/g, '').replace(/[*_~`]+$/g, '');
  document.execCommand('insertText', false, stripped);
}

async function dropImageIntoComposer(dataUrl) {
  const composer = getComposer();
  if (!composer || !dataUrl) return;
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const file = new File([blob], `yawf-${Date.now()}.png`, { type: blob.type || 'image/png' });
  const dt = new DataTransfer();
  dt.items.add(file);
  composer.focus();
  composer.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
}

// WhatsApp Web's own React click handlers ignore .click()/dispatchEvent(new
// MouseEvent(...)) - confirmed by hand while building this feature. Real click
// events (the same path physical hardware input takes) are required, so this
// asks main to inject one via webContents.sendInputEvent at the given point.
function simulateClickOn(el) {
  const rect = el.getBoundingClientRect();
  ipcRenderer.send('simulate-click', { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
}

function getChatRows() {
  return Array.from(document.querySelectorAll('#pane-side [role="row"]'));
}

function sortedChatRows() {
  return getChatRows()
    .map((row) => ({ row, top: row.getBoundingClientRect().y }))
    .sort((a, b) => a.top - b.top);
}

// Tracks position by INDEX into the currently-rendered, position-sorted row
// list, not by DOM element reference or title text - both turned out
// unreliable in practice (confirmed by hand): WhatsApp Web recycles chat-list
// row elements on re-render even when the same chat stays in the same visual
// position, which invalidates a stored element reference within a second or
// two; and matching by title text kept landing on the same/wrong chat since
// it's ambiguous which occurrence of a re-rendered row to trust. An index is
// stable as long as the list itself doesn't reorder between key presses -
// resynced from the actual click position whenever the user clicks a chat
// directly, so it doesn't drift out of sync with manual clicking.
let yawfCurrentChatIndex = -1;
document.addEventListener(
  'click',
  (e) => {
    const row = e.target.closest && e.target.closest('#pane-side [role="row"]');
    if (!row) return;
    yawfCurrentChatIndex = sortedChatRows().findIndex((r) => r.row === row);
  },
  true
);

// Alt+Up/Alt+Down: move to the previous/next chat and open it. Only
// navigates among chats WhatsApp Web currently has rendered (it virtualizes
// the list) - at the top/bottom of what's rendered this is a no-op rather
// than scrolling to reveal more, a deliberate scope limit rather than an
// oversight.
function navigateChat(direction) {
  const rows = sortedChatRows();
  if (rows.length === 0) return;
  const targetIndex = yawfCurrentChatIndex + direction;
  if (targetIndex < 0 || targetIndex >= rows.length) return;
  yawfCurrentChatIndex = targetIndex;
  simulateClickOn(rows[targetIndex].row);
}

// Ctrl+F: focus the main chat-list search box.
function openMainSearch() {
  document.querySelector('[aria-label="Search or start a new chat"]')?.focus();
}

// Ctrl+Shift+F: focus the in-chat message search, opening it first if it
// isn't already open (its trigger is a plain button with no other selector,
// found by its accessible label - matches the "Search" label WhatsApp Web
// itself uses, in English locales).
function openInChatSearch() {
  const existing = document.querySelector('input[aria-label="Search"]');
  if (existing) {
    existing.focus();
    return;
  }
  const button = document.querySelector('button[aria-label="Search"]');
  if (!button) return;
  simulateClickOn(button);
  setTimeout(() => {
    document.querySelector('input[aria-label="Search"]')?.focus();
  }, 200);
}

function sendCtrlEnterAsEnter(composer) {
  const evt = new KeyboardEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  composer.dispatchEvent(evt);
}

document.addEventListener(
  'keydown',
  (e) => {
    const ctrlOrCmd = e.ctrlKey || e.metaKey;

    // Alt+Up / Alt+Down: previous/next chat (not Ctrl-gated, so this must be
    // checked before the ctrlOrCmd early-return below)
    if (e.altKey && !ctrlOrCmd && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      navigateChat(e.key === 'ArrowUp' ? -1 : 1);
      return;
    }

    // Ctrl+Enter send mode (opt-in, see Preferences)
    if (cachedSettings.ctrlEnterToSend && e.key === 'Enter') {
      const composer = getComposer();
      if (composer && document.activeElement === composer) {
        if (ctrlOrCmd) {
          e.preventDefault();
          e.stopPropagation();
          sendCtrlEnterAsEnter(composer);
        } else if (!e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          document.execCommand('insertLineBreak');
        }
        return;
      }
    }

    if (!ctrlOrCmd) return;

    // Markdown formatting shortcuts (Telegram-style)
    if (!e.shiftKey && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      wrapSelection('*', '*');
    } else if (!e.shiftKey && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      wrapSelection('_', '_');
    } else if (e.shiftKey && e.key.toLowerCase() === 'x') {
      e.preventDefault();
      wrapSelection('~', '~');
    } else if (e.shiftKey && e.key.toLowerCase() === 'm') {
      e.preventDefault();
      wrapSelection('```', '```');
    } else if (e.shiftKey && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      clearFormatting();
    } else if (e.shiftKey && e.key.toLowerCase() === 'v') {
      // Force an image-only paste from the clipboard (Ctrl+Shift+V)
      e.preventDefault();
      ipcRenderer.invoke('clipboard:read-image').then(dropImageIntoComposer);
    } else if (e.shiftKey && e.key.toLowerCase() === 's') {
      // Screenshot region -> straight into the composer (Ctrl+Shift+S)
      e.preventDefault();
      ipcRenderer.invoke('screenshot:capture').then((dataUrl) => {
        if (dataUrl) dropImageIntoComposer(dataUrl);
      });
    } else if (e.shiftKey && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      ipcRenderer.send('open-phone-dialog');
    } else if (e.shiftKey && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      ipcRenderer.send('open-resource-monitor');
    } else if (!e.shiftKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      openMainSearch();
    } else if (e.shiftKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      openInChatSearch();
    } else if (e.key === '/') {
      // Ctrl+/ (Ctrl+Shift+/ on US layout produces '?', either is fine here)
      e.preventDefault();
      ipcRenderer.send('open-shortcuts');
    } else if (e.key === '=' || e.key === '+') {
      e.preventDefault();
      cachedZoom = Math.min(3, cachedZoom + 0.1);
      ipcRenderer.invoke('zoom:set', cachedZoom);
    } else if (e.key === '-') {
      e.preventDefault();
      cachedZoom = Math.max(0.5, cachedZoom - 0.1);
      ipcRenderer.invoke('zoom:set', cachedZoom);
    } else if (e.key === '0') {
      e.preventDefault();
      cachedZoom = 1.0;
      ipcRenderer.invoke('zoom:set', cachedZoom);
    }
  },
  true,
);

document.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'F11') {
      e.preventDefault();
      ipcRenderer.send('window:toggle-fullscreen');
    }
  },
  true,
);

ipcRenderer.invoke('settings:get-all').then((s) => {
  cachedSettings = s;
  cachedZoom = s.zoomFactor ?? 1.0;
});
ipcRenderer.on('settings:changed', (_e, settings) => {
  cachedSettings = settings;
});

// Idle-reload timer reset: any keyboard/mouse/scroll activity counts, throttled to 1/10s.
let lastActivityPing = 0;
function pingActivity() {
  const now = Date.now();
  if (now - lastActivityPing < 10000) return;
  lastActivityPing = now;
  ipcRenderer.send('activity');
}
['keydown', 'mousedown', 'mousemove', 'wheel'].forEach((type) =>
  document.addEventListener(type, pingActivity, { passive: true, capture: true }),
);

// Automation API bridge relay (see src/bridge/*). Purely a relay - preload never
// interprets these payloads, just forwards them between the page's main world
// (reached via CustomEvents on document, since isolated and main world share the
// DOM but not JS object references) and the main process (via ipcRenderer/ipcMain).
ipcRenderer.on(IPC_CALL, (_e, msg) => {
  document.dispatchEvent(new CustomEvent(EVT_CALL, { detail: msg }));
});
document.addEventListener(EVT_RESULT, (e) => {
  ipcRenderer.send(IPC_RESULT, e.detail);
});
document.addEventListener(EVT_PUSH, (e) => {
  ipcRenderer.send(IPC_EVENT, e.detail);
});

// In-page crash detection: WhatsApp Web sometimes shows its own "something went
// wrong" screen without the renderer process actually crashing, so
// render-process-gone never fires. Poll for that text and ask main to reload
// after two consecutive hits (10s) to avoid false positives on transient renders.
let errorStrikes = 0;
setInterval(() => {
  const text = document.body ? document.body.innerText : '';
  const looksErrored = text.length < 4000 && /something went wrong|trouble loading|click to reload/i.test(text);
  if (looksErrored) {
    errorStrikes += 1;
    if (errorStrikes >= 2) {
      ipcRenderer.send('whatsapp-error-detected');
      errorStrikes = 0;
    }
  } else {
    errorStrikes = 0;
  }
}, 5000);
