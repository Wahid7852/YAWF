'use strict';

// This file is never require()'d. main.js's buildBridgeSource() concatenates
// protocol.js, then normalize.js, then this file, and wraps the whole thing in
// `(function (YAWF_BRIDGE_TOKEN) { ... })(<per-launch token>)` before running it
// via webContents.executeJavaScript in the WhatsApp Web page's own main world
// (not preload's isolated world - see main.js's injectBridge()). That wrapping
// is what puts EVT_CALL/EVT_RESULT/EVT_PUSH, deriveSessionStatus/
// isIncomingByPosition/extractMessageIdFromTestId/parseMessageTime/
// normalizeIncomingMessage, and YAWF_BRIDGE_TOKEN in scope here despite there
// being no import/require.
//
// Scope note (phase 4a/4b): session status/QR and message.received are all
// derived from cheap DOM signals, not WhatsApp Web's internal webpack Store -
// see normalize.js's comments for why. The selectors below are best-effort,
// verified against a live account once (2026-07), and WILL need retuning if
// WhatsApp Web's markup changes - this is the same class of best-effort DOM
// scan already used elsewhere in YAWF (main.js's title-based unread count,
// preload.js's crash-screen text scan), just applied to new signals.
// message.received only watches the CURRENTLY OPEN chat - messages arriving
// in other chats are not detected in this version (known gap, see
// docs/automation-api.md). Group-chat sender name, isGroup, mentions, and
// specific media-type detection are not implemented yet either - see
// normalize.js's normalizeIncomingMessage for exactly what's populated today.
//
// Trust note: YAWF_BRIDGE_TOKEN is a per-launch random value, echoed on every
// EVT_RESULT/EVT_PUSH so preload.js can drop anything that doesn't carry it.
// That raises the bar against accidental cross-talk but does NOT stop a fully
// compromised page from reading it, since both live in the same JS world -
// see main.js's trust-boundary comment for what this does and doesn't protect.

function yawfHasQrCanvas() {
  return !!document.querySelector('canvas');
}

function yawfHasChatListRoot() {
  return document.querySelectorAll('[role="grid"], [role="application"], #pane-side').length > 0;
}

function yawfGetQrDataUrl() {
  const canvas = document.querySelector('canvas');
  if (!canvas) return null;
  try {
    return canvas.toDataURL('image/png');
  } catch {
    return null; // e.g. a tainted canvas - fail closed rather than throw across the bridge
  }
}

function yawfHandleBridgeCall(method) {
  switch (method) {
    case 'session.getStatus':
      return { state: deriveSessionStatus({ hasQrCanvas: yawfHasQrCanvas(), hasChatListRoot: yawfHasChatListRoot() }) };
    case 'session.getQr': {
      const dataUrl = yawfGetQrDataUrl();
      if (!dataUrl) throw new Error('no QR code currently displayed');
      return { dataUrl };
    }
    default:
      throw new Error(`unknown bridge method: ${method}`);
  }
}

document.addEventListener(EVT_CALL, (e) => {
  const { id, method, token } = (e && e.detail) || {};
  if (token !== YAWF_BRIDGE_TOKEN) return; // not from our own preload relay - ignore

  let payload;
  try {
    const result = yawfHandleBridgeCall(method);
    payload = { id, ok: true, result, token: YAWF_BRIDGE_TOKEN };
  } catch (err) {
    payload = { id, ok: false, error: err.message, token: YAWF_BRIDGE_TOKEN };
  }
  document.dispatchEvent(new CustomEvent(EVT_RESULT, { detail: payload }));
});

// Coarse session-status push: only dispatch when the derived status actually
// changes, so this doesn't flood the bridge on every WhatsApp Web re-render.
let yawfLastPushedStatus = null;
function yawfMaybePushStatus() {
  const state = deriveSessionStatus({ hasQrCanvas: yawfHasQrCanvas(), hasChatListRoot: yawfHasChatListRoot() });
  if (state === yawfLastPushedStatus) return;
  yawfLastPushedStatus = state;
  document.dispatchEvent(
    new CustomEvent(EVT_PUSH, { detail: { type: 'session.status', data: { state }, token: YAWF_BRIDGE_TOKEN } })
  );
}

// --- message.received (currently-open chat only) ---

const YAWF_MESSAGES_PANEL_SELECTOR = '[data-testid="conversation-panel-messages"]';
const YAWF_MESSAGE_ROW_SELECTOR = '[data-testid^="conv-msg-"]';
// Confirmed against a live account: document/audio attachments render one of
// these. Other media types (image/video/sticker) haven't been verified yet -
// the no-text-content fallback below catches those best-effort instead.
const YAWF_MEDIA_TESTIDS = ['document-thumb', 'audio-download'];

function yawfGetMessageBody(row) {
  const textEls = row.querySelectorAll('[data-testid="selectable-text"]');
  if (textEls.length === 0) return '';
  return Array.from(textEls)
    .map((el) => el.textContent)
    .join('');
}

function yawfHasMediaIndicator(row) {
  if (YAWF_MEDIA_TESTIDS.some((id) => row.querySelector(`[data-testid="${id}"]`))) return true;
  // No text at all is the best-effort fallback for media types without a
  // confirmed testid (image/video/sticker) - a pure-media message has none.
  return yawfGetMessageBody(row).length === 0;
}

function yawfExtractMessage(row, panel) {
  const bubble = row.querySelector('[data-testid="msg-container"]');
  if (!bubble) return null;
  const bubbleRect = bubble.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const incoming = isIncomingByPosition({
    bubbleX: bubbleRect.x,
    containerX: panelRect.x,
    containerWidth: panelRect.width,
  });
  const metaEl = row.querySelector('[data-testid="msg-meta"]');
  return normalizeIncomingMessage({
    messageId: extractMessageIdFromTestId(row.getAttribute('data-testid')),
    fromMe: !incoming,
    bodyText: yawfGetMessageBody(row),
    hasMedia: yawfHasMediaIndicator(row),
    time: parseMessageTime(metaEl ? metaEl.textContent : null),
  });
}

let yawfMessagesObserver = null;
let yawfWatchedPanel = null;
let yawfSeenMessageIds = new Set();

function yawfAttachMessageWatcher(panel) {
  if (yawfMessagesObserver) yawfMessagesObserver.disconnect();
  yawfWatchedPanel = panel;
  yawfSeenMessageIds = new Set(
    Array.from(panel.querySelectorAll(YAWF_MESSAGE_ROW_SELECTOR))
      .map((row) => extractMessageIdFromTestId(row.getAttribute('data-testid')))
      .filter(Boolean)
  );
  yawfMessagesObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue;
        const rows = node.matches && node.matches(YAWF_MESSAGE_ROW_SELECTOR)
          ? [node]
          : Array.from(node.querySelectorAll ? node.querySelectorAll(YAWF_MESSAGE_ROW_SELECTOR) : []);
        for (const row of rows) {
          const id = extractMessageIdFromTestId(row.getAttribute('data-testid'));
          if (!id || yawfSeenMessageIds.has(id)) continue;
          yawfSeenMessageIds.add(id);
          const message = yawfExtractMessage(row, panel);
          if (message && !message.fromMe) {
            document.dispatchEvent(
              new CustomEvent(EVT_PUSH, { detail: { type: 'message.received', data: message, token: YAWF_BRIDGE_TOKEN } })
            );
          }
        }
      }
    }
  });
  yawfMessagesObserver.observe(panel, { childList: true, subtree: true });
}

function yawfGetChatTitleText() {
  const el = document.querySelector('[data-testid="conversation-info-header-chat-title"]');
  return el ? el.textContent : null;
}

let yawfCurrentChatTitle = null;

// Re-checked on every debounced body mutation (below), not just once: the
// panel container and/or chat title changing is treated as "switched chats" -
// re-scan current rows as already-seen before resuming the watch, so opening
// a chat never replays its entire history as if it just arrived.
function yawfMaybeReattachMessageWatcher() {
  const panel = document.querySelector(YAWF_MESSAGES_PANEL_SELECTOR);
  const title = yawfGetChatTitleText();
  if (panel && (panel !== yawfWatchedPanel || title !== yawfCurrentChatTitle)) {
    yawfCurrentChatTitle = title;
    yawfAttachMessageWatcher(panel);
  } else if (!panel && yawfWatchedPanel) {
    if (yawfMessagesObserver) yawfMessagesObserver.disconnect();
    yawfMessagesObserver = null;
    yawfWatchedPanel = null;
    yawfCurrentChatTitle = null;
  }
}

if (!window.__yawfBridgeObserving) {
  // Guards against double-injection if did-finish-load fires more than once
  // (e.g. an in-page reload) without a full page/context teardown in between.
  window.__yawfBridgeObserving = true;

  let yawfReattachTimer = null;
  function yawfOnBodyMutation() {
    yawfMaybePushStatus();
    clearTimeout(yawfReattachTimer);
    yawfReattachTimer = setTimeout(yawfMaybeReattachMessageWatcher, 200);
  }

  new MutationObserver(yawfOnBodyMutation).observe(document.body, { childList: true, subtree: true });
  yawfMaybePushStatus();
  yawfMaybeReattachMessageWatcher();
}
