'use strict';

const ROLE_RANK = { viewer: 0, operator: 1, admin: 2 };

function bearerToken(authorizationHeader) {
  if (!authorizationHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  return match ? match[1] : null;
}

/** Strips the IPv4-mapped-IPv6 prefix Node commonly reports for IPv4 connections
 * accepted on a dual-stack socket (e.g. "::ffff:127.0.0.1" -> "127.0.0.1"). */
function normalizeIp(ip) {
  if (!ip) return ip;
  if (ip.startsWith('::ffff:')) return ip.slice('::ffff:'.length);
  return ip;
}

function ipv4ToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = (value << 8) | n;
  }
  return value >>> 0;
}

/** IPv4-only CIDR match. IPv6 CIDR matching is out of scope for v1 (documented gap) -
 * an IPv6-only allowlist entry, or an IPv6 client IP, will simply never match. */
function matchesCidr(ip, cidr) {
  const [range, prefixStr] = cidr.includes('/') ? cidr.split('/') : [cidr, '32'];
  const prefix = Number(prefixStr);
  const ipInt = ipv4ToInt(ip);
  const rangeInt = ipv4ToInt(range);
  if (ipInt === null || rangeInt === null || prefix < 0 || prefix > 32) return false;
  if (prefix === 0) return true;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

/**
 * Express middleware factory: requires a valid, active API key of at least
 * `minRole`, and (if the key has an allowedIps list) a source IP within it.
 * Looks up the key via ApiKeyStore.verify(), which does the constant-time
 * hash comparison - this file doesn't touch raw key bytes directly.
 */
function requireAuth(apiKeyStore, minRole) {
  return (req, res, next) => {
    const rawKey = req.get('x-api-key') || bearerToken(req.get('authorization'));
    if (!rawKey) return res.status(401).json({ error: 'missing API key' });

    const record = apiKeyStore.verify(rawKey);
    if (!record) return res.status(401).json({ error: 'invalid or inactive API key' });

    if (ROLE_RANK[record.role] < ROLE_RANK[minRole]) {
      return res.status(403).json({ error: 'insufficient role for this endpoint' });
    }

    if (record.allowedIps && record.allowedIps.length > 0) {
      const ip = normalizeIp(req.ip || req.socket?.remoteAddress);
      const ok = record.allowedIps.some((cidr) => matchesCidr(ip, cidr));
      if (!ok) return res.status(403).json({ error: 'source IP not allowed for this key' });
    }

    req.apiKey = record;
    next();
  };
}

module.exports = { requireAuth, matchesCidr, normalizeIp, bearerToken, ROLE_RANK };
