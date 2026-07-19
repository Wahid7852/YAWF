'use strict';

// Pure logic shared between injected.js (the main-world script, which gathers
// the raw DOM signals) and Node tests. Same dual-context export guard as
// protocol.js - see that file's header comment.

/**
 * Derives a coarse session status from cheap DOM signals, rather than reaching
 * into WhatsApp Web's internal webpack Store - answering "are we logged in /
 * is there a QR to scan" doesn't need that, and this mirrors the same
 * best-effort DOM-signal approach already used elsewhere in YAWF (main.js's
 * page-title unread-count regex, preload.js's crash-screen text scan).
 */
function deriveSessionStatus({ hasQrCanvas, hasChatListRoot }) {
  if (hasChatListRoot) return 'CONNECTED';
  if (hasQrCanvas) return 'PAIRING';
  return 'LOADING';
}

const sessionNormalize = { deriveSessionStatus };

if (typeof module !== 'undefined') {
  module.exports = sessionNormalize;
}
