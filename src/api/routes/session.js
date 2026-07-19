'use strict';

const express = require('express');
const { requireAuth } = require('../auth');

/**
 * Session status/QR, backed by the live WhatsApp Store bridge (src/bridge/*).
 * `getBridgeClient` is a `() => BridgeClient | null` accessor, not a snapshot -
 * main.js only creates its BridgeClient later, from did-finish-load, which
 * happens well after the API server (and this router) is constructed at
 * startup, so a plain value captured at createApiServer() time would always
 * see the pre-bridge null forever. Reading it fresh on every request is what
 * lets the bridge attach after the fact. Reports 503 whenever the accessor
 * currently returns null (bridge disabled, or not yet injected). There is no
 * POST /session/logout here: logging out programmatically would need UI
 * automation this phase deliberately doesn't attempt - see docs/automation-api.md.
 */
function sessionRouter(apiKeyStore, getBridgeClient) {
  const router = express.Router();

  router.get('/', requireAuth(apiKeyStore, 'viewer'), async (_req, res) => {
    const bridgeClient = getBridgeClient();
    if (!bridgeClient) return res.status(503).json({ error: 'WhatsApp bridge is not enabled' });
    try {
      const status = await bridgeClient.call('session.getStatus');
      res.json(status);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  router.get('/qr', requireAuth(apiKeyStore, 'viewer'), async (_req, res) => {
    const bridgeClient = getBridgeClient();
    if (!bridgeClient) return res.status(503).json({ error: 'WhatsApp bridge is not enabled' });
    try {
      const qr = await bridgeClient.call('session.getQr');
      res.json(qr);
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { sessionRouter };
