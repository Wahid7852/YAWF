'use strict';

const express = require('express');

/** GET /api/v1/health - no auth, just process liveness. */
function healthRouter() {
  const router = express.Router();
  router.get('/', (_req, res) => res.json({ status: 'ok', pid: process.pid }));
  return router;
}

module.exports = { healthRouter };
