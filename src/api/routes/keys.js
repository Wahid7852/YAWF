'use strict';

const express = require('express');
const { requireAuth } = require('../auth');
const { ROLES } = require('../apiKeyStore');

/** Admin-only CRUD over API keys. `apiKeyStore` is an ApiKeyStore instance. */
function keysRouter(apiKeyStore) {
  const router = express.Router();
  router.use(requireAuth(apiKeyStore, 'admin'));

  router.get('/', (_req, res) => res.json({ keys: apiKeyStore.list() }));

  router.post('/', (req, res) => {
    const { name, role = 'operator', allowedIps = [], expiresAt = null } = req.body || {};
    if (role && !ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of ${ROLES.join(', ')}` });
    }
    const { record, rawKey } = apiKeyStore.create({ name, role, allowedIps, expiresAt });
    // rawKey is shown exactly once - it is never retrievable again after this response.
    res.status(201).json({ key: record, apiKey: rawKey });
  });

  router.get('/:id', (req, res) => {
    const record = apiKeyStore.get(req.params.id);
    if (!record) return res.status(404).json({ error: 'key not found' });
    res.json({ key: record });
  });

  router.put('/:id', (req, res) => {
    const { name, allowedIps, expiresAt } = req.body || {};
    const record = apiKeyStore.update(req.params.id, { name, allowedIps, expiresAt });
    if (!record) return res.status(404).json({ error: 'key not found' });
    res.json({ key: record });
  });

  router.delete('/:id', (req, res) => {
    const ok = apiKeyStore.remove(req.params.id);
    if (!ok) return res.status(404).json({ error: 'key not found' });
    res.status(204).end();
  });

  router.post('/:id/revoke', (req, res) => {
    const ok = apiKeyStore.revoke(req.params.id);
    if (!ok) return res.status(404).json({ error: 'key not found' });
    res.json({ revoked: true });
  });

  return router;
}

module.exports = { keysRouter };
