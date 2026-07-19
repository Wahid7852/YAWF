# Automation API

YAWF can optionally expose a local REST API for scripting/automation, in the same
spirit as WhatsApp API gateways like [open-wa](https://github.com/rmyndharis/OpenWA),
adapted to YAWF's one-process-per-account model. Off by default.

> **Status: work in progress.** The scaffolding (auth, keys, rate limiting, audit
> log, webhooks) lands before the live WhatsApp bridge does. Endpoints below are
> marked accordingly as they're implemented.

## Enabling

Preferences → Automation API → enable, set a port (default `7862`, loopback-only
by default), create an API key from the tray's API Dashboard.

## The WhatsApp bridge (`apiBridgeEnabled`)

Session status/QR require a second, separate toggle: `apiBridgeEnabled` (off by
default even when the API itself is on). When enabled, YAWF injects a small
script into the WhatsApp Web page to answer "are we logged in / is there a QR
to scan" - deliberately via cheap DOM signals (is there a `<canvas>` on screen,
is the authenticated app shell present), the same class of best-effort scan
YAWF already uses for crash-screen detection and the unread-count badge, **not**
by reaching into WhatsApp Web's internal JS Store the way whatsapp-web.js does.
The selectors this relies on are best-effort and may need retuning if WhatsApp
Web's markup changes - if `session.getStatus`/`session.getQr` stop reflecting
reality, that's the first place to look (`src/bridge/injected.js`).

## Authentication

Send `X-API-Key: <key>` or `Authorization: Bearer <key>` on every request except
`GET /api/v1/health`. Keys have a role: `viewer` (read-only), `operator` (read +
send/write), `admin` (+ key/webhook/audit management). Keys are shown once at
creation time and stored hashed - if you lose one, revoke and create a new one.

## Endpoints

| Method | Path | Role | Status |
|---|---|---|---|
| GET | `/api/v1/health` | none | implemented |
| GET | `/api/v1/session` | viewer | implemented (needs `apiBridgeEnabled`) |
| GET | `/api/v1/session/qr` | viewer | implemented (needs `apiBridgeEnabled`) |
| POST | `/api/v1/session/logout` | admin | not planned - would need UI automation, see below |
| POST | `/api/v1/messages` | operator | planned |
| GET | `/api/v1/messages` | viewer | planned |
| POST | `/api/v1/messages/:id/react` | operator | planned |
| GET | `/api/v1/chats` | viewer | planned |
| GET | `/api/v1/chats/:id` | viewer | planned |
| POST | `/api/v1/chats/:id/read` | operator | planned |
| POST | `/api/v1/chats/:id/typing` | operator | planned |
| GET | `/api/v1/contacts` | viewer | planned |
| GET | `/api/v1/contacts/:id` | viewer | planned |
| GET | `/api/v1/contacts/check/:number` | viewer | planned |
| GET | `/api/v1/groups` | viewer | planned |
| POST | `/api/v1/groups` | operator | planned |
| GET | `/api/v1/groups/:id` | viewer | planned |
| POST | `/api/v1/groups/:id/participants` | operator | planned |
| GET/POST | `/api/v1/webhooks` | admin | implemented |
| GET/PUT/DELETE | `/api/v1/webhooks/:id` | admin | implemented |
| POST | `/api/v1/webhooks/:id/test` | admin | implemented |
| GET/POST | `/api/v1/keys` | admin | implemented |
| GET/PUT/DELETE | `/api/v1/keys/:id` | admin | implemented |
| POST | `/api/v1/keys/:id/revoke` | admin | implemented |
| GET | `/api/v1/audit` | admin | implemented |

## Webhooks

Register a URL, an event list, and a secret. Deliveries are signed:

```
POST <your url>
X-YAWF-Event: message.received
X-YAWF-Signature: sha256=<hmac-sha256 of the exact request body, hex>

{ "event": "message.received", "timestamp": "...", "data": { ... } }
```

Verify by computing the HMAC over the **raw bytes you received**, not a
re-serialization of parsed JSON - re-serializing can change key order/whitespace
and produce a signature mismatch even when the payload is legitimate.

Events: `session.status`, `message.received`, `message.ack`, `message.revoked`,
`message.edited`. Optional filters: `sender`, `recipient`, `body`, `type`,
`mentions`, `fromMe`, `hasMedia`, `isGroup` (all ANDed).

Delivery retries 0/5s/30s (configurable per webhook), best-effort - an in-flight
delivery is not persisted across an app restart.

## Rate limiting

Two tiers: a general per-key limit (default 60/min) and a stricter limit
specifically on `POST /api/v1/messages` (default 20/min), on by default and not
configurable to "unlimited". This exists because unofficial WhatsApp automation
carries real account-ban risk - the message-send limiter is a deliberate default,
not just a generic API guard. There is no bulk-send endpoint, by design.

## What this is not

No multi-session-per-process (YAWF's `--profile <name>` is already how you run
multiple accounts - each gets its own API port/keys/webhooks), no message
templates (that's Meta's Business Cloud API, a different product from the
consumer web client this app wraps), no bulk-send, no programmatic logout
(would require automating WhatsApp Web's own Settings UI rather than a direct
API call - not attempted).
