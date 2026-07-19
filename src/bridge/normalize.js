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

/**
 * Determines message direction from bubble position rather than any single
 * class name or "tail" marker - WhatsApp Web only renders a tail on the first
 * bubble of a consecutive run from one sender, so most bubbles have neither
 * tail-in nor tail-out. Position is the one signal present on every bubble:
 * incoming bubbles left-anchor (fixed left edge), outgoing bubbles
 * right-anchor (fixed right edge, so their left edge varies with content
 * width) - comparing against the container's midpoint is resolution-
 * independent, unlike a hardcoded pixel threshold.
 */
function isIncomingByPosition({ bubbleX, containerX, containerWidth }) {
  return bubbleX < containerX + containerWidth / 2;
}

/** Message rows are tagged data-testid="conv-msg-<id>" - <id> is WhatsApp's
 * own message id, useful as a stable dedup/tracking key. */
function extractMessageIdFromTestId(testId) {
  if (typeof testId !== 'string') return null;
  const match = /^conv-msg-(.+)$/.exec(testId);
  return match ? match[1] : null;
}

/** msg-meta's textContent mixes the timestamp with a read-status icon's title
 * text (observed as e.g. "12:38 pmwds-ic-read") - this pulls out just the
 * leading time portion, best-effort. */
function parseMessageTime(metaText) {
  if (typeof metaText !== 'string') return null;
  const match = /^\s*(\d{1,2}:\d{2}(?:\s?[ap]m)?)/i.exec(metaText);
  return match ? match[1] : null;
}

/**
 * Shapes the fields injected.js can actually extract today into the
 * message.received webhook payload. Deliberately honest about gaps rather
 * than guessing: sender/recipient/isGroup/mentions/media-type detection
 * aren't implemented yet (group-chat sender-name and media-type-specific
 * selectors haven't been verified against a live account) - those fields are
 * explicitly null/false rather than a fabricated guess. See
 * docs/automation-api.md for the current scope.
 */
function normalizeIncomingMessage({ messageId, fromMe, bodyText, hasMedia, time }) {
  return {
    id: messageId || null,
    fromMe: !!fromMe,
    body: bodyText || '',
    hasMedia: !!hasMedia,
    time: time || null,
    sender: null,
    recipient: null,
    isGroup: null,
    mentions: [],
  };
}

const sessionNormalize = {
  deriveSessionStatus,
  isIncomingByPosition,
  extractMessageIdFromTestId,
  parseMessageTime,
  normalizeIncomingMessage,
};

if (typeof module !== 'undefined') {
  module.exports = sessionNormalize;
}
