'use strict';

// This file is never require()'d. main.js's buildBridgeSource() concatenates
// protocol.js, then normalize.js, then this file, and wraps the whole thing in
// `(function (YAWF_BRIDGE_TOKEN) { ... })(<per-launch token>)` before running it
// via webContents.executeJavaScript in the WhatsApp Web page's own main world
// (not preload's isolated world - see main.js's injectBridge()). That wrapping
// is what puts EVT_CALL/EVT_RESULT/EVT_PUSH, deriveSessionStatus, and
// YAWF_BRIDGE_TOKEN in scope here despite there being no import/require.
//
// Scope note (phase 4a): session status/QR are derived from cheap DOM signals,
// not WhatsApp Web's internal webpack Store - see normalize.js's comment for
// why. The selectors below are best-effort and WILL need retuning against
// whatever the current WA Web build's markup looks like - this is the same
// class of best-effort DOM scan already used elsewhere in YAWF (main.js's
// title-based unread count, preload.js's crash-screen text scan), just applied
// to a new signal. This has not been verified against a live, logged-in
// WhatsApp Web session - see docs/automation-api.md.
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

// Coarse session-status push: re-evaluate on DOM mutation and only dispatch
// when the derived status actually changes, so this doesn't flood the bridge
// on every WhatsApp Web re-render.
let yawfLastPushedStatus = null;
function yawfMaybePushStatus() {
  const state = deriveSessionStatus({ hasQrCanvas: yawfHasQrCanvas(), hasChatListRoot: yawfHasChatListRoot() });
  if (state === yawfLastPushedStatus) return;
  yawfLastPushedStatus = state;
  document.dispatchEvent(
    new CustomEvent(EVT_PUSH, { detail: { type: 'session.status', data: { state }, token: YAWF_BRIDGE_TOKEN } })
  );
}

if (!window.__yawfBridgeObserving) {
  // Guards against double-injection if did-finish-load fires more than once
  // (e.g. an in-page reload) without a full page/context teardown in between.
  window.__yawfBridgeObserving = true;
  new MutationObserver(() => yawfMaybePushStatus()).observe(document.body, { childList: true, subtree: true });
  yawfMaybePushStatus();
}
