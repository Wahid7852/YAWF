'use strict';

const express = require('express');
const { requireAuth } = require('../auth');

/** Admin-only read access to the audit log. `auditLog` is an AuditLog instance. */
function auditRouter(apiKeyStore, auditLog) {
  const router = express.Router();
  router.use(requireAuth(apiKeyStore, 'admin'));

  router.get('/', (req, res) => {
    const since = req.query.since || null;
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    res.json({ entries: auditLog.read({ since, limit }) });
  });

  return router;
}

module.exports = { auditRouter };
