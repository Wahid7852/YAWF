'use strict';

// installSigCache lives inside preload.js (sandboxed preloads can't require
// local files), so pull its source out between the markers and run it in a vm
// against a fake WhatsApp module loader.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const src = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
const body = src.slice(src.indexOf('// sigcache:begin'), src.indexOf('// sigcache:end'));

function boot(storage) {
  const timers = [];
  const ctx = {
    location: { hostname: 'web.whatsapp.com' },
    localStorage: {
      getItem: (k) => (k in storage ? storage[k] : null),
      setItem: (k, v) => (storage[k] = String(v)),
    },
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    setTimeout: (fn) => timers.push(fn),
    Uint8Array,
    DataView,
  };
  ctx.window = ctx;
  ctx.window.require = (name) => {
    assert.equal(name, 'WACryptoPrimitives');
    return { hash: (buf) => new Uint8Array(crypto.createHash('sha512').update(buf).digest()) };
  };
  vm.createContext(ctx);
  vm.runInContext(`${body}; installSigCache(3);`, ctx);

  // WhatsApp's loader: stub assigned first, then the real define.
  const calls = [];
  const valid = new Set(['pk1|msg1|sig1', 'pk1|msg2|sig2', 'pk2|msg|sig', 'pk3|msg|sig', 'pk4|msg|sig']);
  ctx.window.__d = function stub() {};
  ctx.window.__d = function realDefine(name, deps, factory) {
    const ns = {};
    factory(null, null, null, null, null, null, ns);
    ctx.ns = ns;
  };
  ctx.window.__d('WASignalSignatures', [], (t, n, r, o, a, i, l) => {
    l.verifyMsgSignalVariant = (pk, msg, sig) => {
      const k = [pk, msg, sig].map((b) => Buffer.from(b).toString()).join('|');
      calls.push(k);
      return valid.has(k);
    };
  });
  const verify = (pk, msg, sig) => ctx.ns.verifyMsgSignalVariant(...[pk, msg, sig].map((s) => Buffer.from(s)));
  const flush = () => timers.splice(0).forEach((fn) => fn());
  return { verify, calls, flush };
}

test('valid signature is verified once, then served from cache', () => {
  const app = boot({});
  assert.equal(app.verify('pk1', 'msg1', 'sig1'), true);
  assert.equal(app.verify('pk1', 'msg1', 'sig1'), true);
  assert.equal(app.calls.length, 1);
});

test('any differing input misses the cache and is really verified', () => {
  const app = boot({});
  app.verify('pk1', 'msg1', 'sig1');
  assert.equal(app.verify('pk1', 'msgX', 'sig1'), false); // same key+sig, other message
  assert.equal(app.verify('pk1', 'msg1', 'sigX'), false);
  assert.equal(app.verify('pkX', 'msg1', 'sig1'), false);
  assert.equal(app.calls.length, 4);
});

test('length-prefixing: shifting bytes between fields is a different key', () => {
  const app = boot({});
  app.verify('pk1', 'msg1', 'sig1');
  app.verify('pk', '1msg1', 'sig1');
  assert.equal(app.calls.length, 2);
});

test('failed verifications are never cached', () => {
  const app = boot({});
  assert.equal(app.verify('bad', 'msg', 'sig'), false);
  assert.equal(app.verify('bad', 'msg', 'sig'), false);
  assert.equal(app.calls.length, 2);
});

test('cache persists across boots via localStorage', () => {
  const storage = {};
  const first = boot(storage);
  first.verify('pk1', 'msg1', 'sig1');
  first.flush();
  const second = boot(storage);
  assert.equal(second.verify('pk1', 'msg1', 'sig1'), true);
  assert.equal(second.calls.length, 0);
});

test('cache is capped, oldest entry evicted first', () => {
  const app = boot({});
  for (const pk of ['pk1', 'pk2', 'pk3', 'pk4']) app.verify(pk, pk === 'pk1' ? 'msg1' : 'msg', pk === 'pk1' ? 'sig1' : 'sig');
  app.calls.length = 0;
  app.verify('pk4', 'msg', 'sig');
  app.verify('pk1', 'msg1', 'sig1');
  assert.deepEqual(app.calls, ['pk1|msg1|sig1']);
});

test('corrupt stored cache is ignored, not fatal', () => {
  const app = boot({ 'yawf:sigcache:v1': '{nope' });
  assert.equal(app.verify('pk1', 'msg1', 'sig1'), true);
  assert.equal(app.calls.length, 1);
});
