'use strict';

// Shared by main.js, preload.js (both real CommonJS modules, require() this
// normally) and injected.js (never require()'d - this file's source is
// concatenated ahead of it into the string passed to executeJavaScript, see
// main.js's buildBridgeSource). The `if (typeof module !== 'undefined')` guard
// below is what makes that dual use safe: in the page's main world there is no
// `module`, so the export line is skipped and these just become plain consts
// in scope for the rest of the concatenated script.

// main-world (page) <-> isolated-world (preload.js) transport: DOM CustomEvents,
// since the two worlds share the DOM but not JS object references.
const EVT_CALL = 'yawf:bridge-call';
const EVT_RESULT = 'yawf:bridge-result';
const EVT_PUSH = 'yawf:bridge-event';

// isolated-world (preload.js) <-> main process transport: plain Electron IPC.
const IPC_CALL = 'bridge:call';
const IPC_RESULT = 'bridge:call-result';
const IPC_EVENT = 'bridge:event';

// Methods main.js is allowed to invoke on the page - chosen by main.js itself,
// never accepted from the page. See main.js's trust-boundary comment for why
// this matters: the page can only ever be asked to run one of these.
const ALLOWED_METHODS = ['session.getStatus', 'session.getQr'];

// Event types the page is allowed to push unsolicited. Anything else arriving
// on IPC_EVENT is dropped rather than forwarded anywhere.
const ALLOWED_PUSH_EVENTS = ['session.status'];

const protocol = {
  EVT_CALL,
  EVT_RESULT,
  EVT_PUSH,
  IPC_CALL,
  IPC_RESULT,
  IPC_EVENT,
  ALLOWED_METHODS,
  ALLOWED_PUSH_EVENTS,
};

if (typeof module !== 'undefined') {
  module.exports = protocol;
}
