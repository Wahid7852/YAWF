'use strict';

const express = require('express');
const { requireAuth } = require('../auth');

/** Admin-only CRUD over webhooks + a /:id/test endpoint that runs a synthetic
 * event through the real filter+HMAC+delivery pipeline. `webhookStore` is a
 * WebhookStore instance, `dispatcher` a WebhookDispatcher instance. */
function webhooksRouter(apiKeyStore, webhookStore, dispatcher) {
  const router = express.Router();
  router.use(requireAuth(apiKeyStore, 'admin'));

  router.get('/', (_req, res) => res.json({ webhooks: webhookStore.list() }));

  router.post('/', (req, res) => {
    const { url, events, secret, headers, filters, retryCount, active } = req.body || {};
    try {
      const hook = webhookStore.create({ url, events, secret, headers, filters, retryCount, active });
      res.status(201).json({ webhook: hook });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/:id', (req, res) => {
    const hook = webhookStore.get(req.params.id);
    if (!hook) return res.status(404).json({ error: 'webhook not found' });
    res.json({ webhook: hook });
  });

  router.put('/:id', (req, res) => {
    const hook = webhookStore.update(req.params.id, req.body || {});
    if (!hook) return res.status(404).json({ error: 'webhook not found' });
    res.json({ webhook: hook });
  });

  router.delete('/:id', (req, res) => {
    const ok = webhookStore.remove(req.params.id);
    if (!ok) return res.status(404).json({ error: 'webhook not found' });
    res.status(204).end();
  });

  router.post('/:id/test', (req, res) => {
    const eventType = req.body?.event || 'message.received';
    const data = req.body?.data || { sender: 'test', body: 'this is a test delivery from YAWF', isGroup: false, fromMe: false };
    const result = dispatcher.deliverTest(req.params.id, eventType, data);
    if (!result.matched && result.reason === 'webhook not found') {
      return res.status(404).json({ error: result.reason });
    }
    res.json(result);
  });

  return router;
}

module.exports = { webhooksRouter };
