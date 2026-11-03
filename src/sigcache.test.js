'use strict';

// installVerifySpeedups lives inside preload.js (sandboxed preloads can't
// require local files), so pull its source out between the markers and run it
// in a vm against a fake WhatsApp module loader.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const nacl = require('tweetnacl'); // 1.0.3, the exact build WhatsApp Web ships

const src = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
const body = src.slice(src.indexOf('// verify-hooks:begin'), src.indexOf('// verify-hooks:end'));
const WASM_B64 = src.match(/^const ED25519_WASM = '([^']*)';$/m)[1];
const WASM_FILE = path.join(__dirname, '..', 'wasm', 'ed25519_verify.wasm');

function boot(storage, { wasm = false } = {}) {
  const timers = [];
  const ctx = {
    location: { hostname: 'web.whatsapp.com' },
    localStorage: {
      getItem: (k) => (k in storage ? storage[k] : null),
      setItem: (k, v) => (storage[k] = String(v)),
    },
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    setTimeout: (fn) => timers.push(fn),
    // same realm as the test's arrays, like WhatsApp's own arrays in the page
    Uint8Array,
    WebAssembly,
  };
  ctx.window = ctx;
  ctx.window.require = (name) => {
    assert.equal(name, 'WACryptoPrimitives');
    return { hash: (buf) => new Uint8Array(crypto.createHash('sha512').update(buf).digest()) };
  };
  vm.createContext(ctx);
  vm.runInContext(`${body}; installVerifySpeedups(3, ${JSON.stringify(wasm ? WASM_B64 : '')});`, ctx);

  // WhatsApp's loader: stub assigned first, then the real define.
  const ns = {};
  ctx.window.__d = function stub() {};
  ctx.window.__d = function realDefine(name, deps, factory) {
    ns[name] = {};
    factory(null, null, null, null, null, null, ns[name]);
  };
  return { ctx, ns, flush: () => timers.splice(0).forEach((fn) => fn()) };
}

// ---- cache layer (WASignalSignatures.verifyMsgSignalVariant)

function bootSignatures(storage) {
  const app = boot(storage);
  const calls = [];
  const valid = new Set(['pk1|msg1|sig1', 'pk1|msg2|sig2', 'pk2|msg|sig', 'pk3|msg|sig', 'pk4|msg|sig']);
  app.ctx.window.__d('WASignalSignatures', [], (t, n, r, o, a, i, l) => {
    l.verifyMsgSignalVariant = (pk, msg, sig) => {
      const k = [pk, msg, sig].map((b) => Buffer.from(b).toString()).join('|');
      calls.push(k);
      return valid.has(k);
    };
  });
  const verify = (pk, msg, sig) =>
    app.ns.WASignalSignatures.verifyMsgSignalVariant(...[pk, msg, sig].map((s) => Buffer.from(s)));
  return { verify, calls, flush: app.flush };
}

test('valid signature is verified once, then served from cache', () => {
  const app = bootSignatures({});
  assert.equal(app.verify('pk1', 'msg1', 'sig1'), true);
  assert.equal(app.verify('pk1', 'msg1', 'sig1'), true);
  assert.equal(app.calls.length, 1);
});

test('any differing input misses the cache and is really verified', () => {
  const app = bootSignatures({});
  app.verify('pk1', 'msg1', 'sig1');
  assert.equal(app.verify('pk1', 'msgX', 'sig1'), false); // same key+sig, other message
  assert.equal(app.verify('pk1', 'msg1', 'sigX'), false);
  assert.equal(app.verify('pkX', 'msg1', 'sig1'), false);
  assert.equal(app.calls.length, 4);
});

test('length-prefixing: shifting bytes between fields is a different key', () => {
  const app = bootSignatures({});
  app.verify('pk1', 'msg1', 'sig1');
  app.verify('pk', '1msg1', 'sig1');
  assert.equal(app.calls.length, 2);
});

test('failures confirmed by WhatsApp code are cached as failures', () => {
  const app = bootSignatures({});
  assert.equal(app.verify('bad', 'msg', 'sig'), false);
  assert.equal(app.verify('bad', 'msg', 'sig'), false);
  assert.equal(app.calls.length, 1);
  // a negative entry answers only its own exact input
  assert.equal(app.verify('pk1', 'msg1', 'sig1'), true);
  assert.equal(app.calls.length, 2);
});

test('cache persists across boots via localStorage', () => {
  const storage = {};
  const first = bootSignatures(storage);
  first.verify('pk1', 'msg1', 'sig1');
  first.flush();
  const second = bootSignatures(storage);
  assert.equal(second.verify('pk1', 'msg1', 'sig1'), true);
  assert.equal(second.calls.length, 0);
});

test('cache is capped, oldest entry evicted first', () => {
  const app = bootSignatures({});
  for (const pk of ['pk1', 'pk2', 'pk3', 'pk4']) app.verify(pk, pk === 'pk1' ? 'msg1' : 'msg', pk === 'pk1' ? 'sig1' : 'sig');
  app.calls.length = 0;
  app.verify('pk4', 'msg', 'sig');
  app.verify('pk1', 'msg1', 'sig1');
  assert.deepEqual(app.calls, ['pk1|msg1|sig1']);
});

test('corrupt stored cache is ignored, not fatal', () => {
  const app = bootSignatures({ 'yawf:sigcache:v1': '{nope' });
  assert.equal(app.verify('pk1', 'msg1', 'sig1'), true);
  assert.equal(app.calls.length, 1);
});

// ---- wasm layer (WACryptoPrimitives.signDetachedVerify)

const L = 2n ** 252n + 27742317777372353535851937790883648493n;

function signed(msgLen = 23) {
  const kp = nacl.sign.keyPair();
  const msg = new Uint8Array(crypto.randomBytes(msgLen));
  return { msg, sig: nacl.sign.detached(msg, kp.secretKey), pk: kp.publicKey };
}

async function bootPrimitives() {
  const app = boot({}, { wasm: true });
  const jsCalls = [];
  app.ctx.window.__d('WACryptoPrimitives', [], (t, n, r, o, a, i, l) => {
    l.signDetachedVerify = (msg, sig, pk) => {
      jsCalls.push(1);
      return nacl.sign.detached.verify(msg, sig, pk);
    };
  });
  const verify = (msg, sig, pk) => app.ns.WACryptoPrimitives.signDetachedVerify(msg, sig, pk);
  // instantiation is async; wait until a valid signature stops reaching JS
  const probe = signed();
  for (let i = 0; i < 500; i++) {
    jsCalls.length = 0;
    verify(probe.msg, probe.sig, probe.pk);
    if (jsCalls.length === 0) return { verify, jsCalls };
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('wasm never became ready');
}

test('embedded wasm matches wasm/ed25519_verify.wasm (run wasm/build.sh)', () => {
  assert.equal(WASM_B64, fs.readFileSync(WASM_FILE).toString('base64'));
});

test('wasm answers valid signatures without touching JS; invalid ones are re-checked in JS', async () => {
  const { verify, jsCalls } = await bootPrimitives();
  const s = signed();
  jsCalls.length = 0;
  assert.equal(verify(s.msg, s.sig, s.pk), true);
  assert.equal(jsCalls.length, 0);
  const bad = new Uint8Array(s.sig);
  bad[5] ^= 1;
  assert.equal(verify(s.msg, bad, s.pk), false);
  assert.equal(jsCalls.length, 1);
});

test('non-fast-path inputs go to JS and keep its errors', async () => {
  const { verify, jsCalls } = await bootPrimitives();
  const s = signed();
  jsCalls.length = 0;
  assert.throws(() => verify(s.msg, s.sig.subarray(0, 63), s.pk), /bad signature size/);
  assert.throws(() => verify([1, 2], s.sig, s.pk), /unexpected type/);
  assert.equal(verify(new Uint8Array(5000), s.sig, s.pk), false); // over yawf_max_msg
  assert.equal(jsCalls.length, 3);
});

// Differential: raw wasm vs tweetnacl-js on valid, mutated, non-canonical and
// edge-case inputs. They must agree on every single one.
test('wasm verify is identical to tweetnacl-js 1.0.3', () => {
  const e = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(WASM_FILE))).exports;
  const wasm = (msg, sig, pk) => {
    const mem = new Uint8Array(e.memory.buffer);
    mem.set(pk, e.yawf_pk());
    mem.set(sig, e.yawf_sm());
    mem.set(msg, e.yawf_sm() + 64);
    return e.yawf_open(64 + msg.length) === 0;
  };
  let mismatches = 0;
  const same = (msg, sig, pk) => {
    const a = nacl.sign.detached.verify(msg, sig, pk);
    if (a !== wasm(msg, sig, pk)) mismatches++;
    return a;
  };
  // RFC 8032 7.1 test 2
  assert.equal(
    same(
      Buffer.from('72', 'hex'),
      Buffer.from('92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00', 'hex'),
      Buffer.from('3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c', 'hex'),
    ),
    true,
  );
  let nonCanonicalAccepted = 0;
  for (let i = 0; i < 60; i++) {
    const s = signed(i % 120);
    assert.equal(same(s.msg, s.sig, s.pk), true);
    for (const t of [s.sig, s.msg, s.pk]) {
      if (!t.length) continue;
      const c = new Uint8Array(t);
      c[crypto.randomInt(c.length)] ^= 1 << crypto.randomInt(8);
      same(t === s.msg ? c : s.msg, t === s.sig ? c : s.sig, t === s.pk ? c : s.pk);
    }
    // tweetnacl accepts S + L (no S < L check); the wasm must too
    let S = 0n;
    for (let j = 63; j >= 32; j--) S = (S << 8n) | BigInt(s.sig[j]);
    if (S + L < 2n ** 256n) {
      const s2 = new Uint8Array(s.sig);
      let v = S + L;
      for (let j = 32; j < 64; j++) (s2[j] = Number(v & 255n)), (v >>= 8n);
      if (same(s.msg, s2, s.pk)) nonCanonicalAccepted++;
    }
    same(crypto.randomBytes(23), crypto.randomBytes(64), crypto.randomBytes(32));
  }
  const p = 2n ** 255n - 19n;
  const enc = (y) => Uint8Array.from({ length: 32 }, (_, j) => Number((y >> BigInt(8 * j)) & 255n));
  for (const pk of [enc(0n), enc(1n), enc(p - 1n), enc(p), enc(p + 1n), new Uint8Array(32).fill(255)]) {
    const s = signed();
    same(s.msg, s.sig, pk);
  }
  assert.equal(mismatches, 0);
  assert.ok(nonCanonicalAccepted > 0);
});

// ---- WhatsApp's Signal-variant check (verifyMsgSignalVariant) via yawf_xopen

const p25519 = 2n ** 255n - 19n;
const leToBig = (b) => b.reduceRight((acc, x) => (acc << 8n) | BigInt(x), 0n);
const bigToLe = (v) => Uint8Array.from({ length: 32 }, (_, i) => Number((v >> BigInt(8 * i)) & 255n));
const modPow = (b, e) => {
  let r = 1n;
  b %= p25519;
  for (; e > 0n; e >>= 1n, b = (b * b) % p25519) if (e & 1n) r = (r * b) % p25519;
  return r;
};
const modInv = (x) => modPow(((x % p25519) + p25519) % p25519, p25519 - 2n); // 0 -> 0, like inv25519

// WhatsApp's JS (WASignalSignatures f/m/_), written out with BigInt instead of tweetnacl field ops
function referenceSignalVerify(pk33, msg, sig) {
  const nb = sig[63];
  if (nb & 96) return false;
  const s2 = new Uint8Array(sig);
  s2[63] = nb & 127;
  const u = leToBig(pk33.subarray(1, 33)) & (2n ** 255n - 1n); // unpack25519 drops bit 255
  const y = ((((u - 1n) % p25519) + p25519) % p25519) * modInv(u + 1n) % p25519;
  const ed = bigToLe(y);
  ed[31] = (ed[31] & 127) | (nb & 128);
  return nacl.sign.detached.verify(msg, s2, ed);
}

// a valid signature in WhatsApp's format: Montgomery key, Edwards sign bit in sig[63]
function signalSigned(msgLen = 23) {
  const kp = nacl.sign.keyPair();
  const msg = new Uint8Array(crypto.randomBytes(msgLen));
  const sig = nacl.sign.detached(msg, kp.secretKey);
  sig[63] |= kp.publicKey[31] & 128;
  const y = leToBig(kp.publicKey) & (2n ** 255n - 1n);
  const u = ((1n + y) * modInv(1n - y + p25519)) % p25519;
  const pk = new Uint8Array(33);
  pk[0] = 5;
  pk.set(bigToLe(u), 1);
  return { pk, msg, sig };
}

async function bootSignal() {
  const app = boot({}, { wasm: true });
  const calls = [];
  app.ctx.window.__d('WASignalSignatures', [], (t, n, r, o, a, i, l) => {
    l.verifyMsgSignalVariant = (pk, msg, sig) => {
      calls.push(1);
      return referenceSignalVerify(pk, msg, sig);
    };
  });
  const verify = (pk, msg, sig) => app.ns.WASignalSignatures.verifyMsgSignalVariant(pk, msg, sig);
  for (let i = 0; i < 500; i++) {
    const s = signalSigned();
    calls.length = 0;
    verify(s.pk, s.msg, s.sig);
    if (calls.length === 0) return { verify, calls };
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('wasm never became ready');
}

test('Signal-variant: wasm answers valid ones; failures go through WhatsApp code once, then cache', async () => {
  const { verify, calls } = await bootSignal();
  const s = signalSigned();
  calls.length = 0;
  assert.equal(verify(s.pk, s.msg, s.sig), true);
  assert.equal(calls.length, 0);
  const bad = new Uint8Array(s.sig);
  bad[10] ^= 4;
  assert.equal(verify(s.pk, s.msg, bad), false);
  assert.equal(verify(s.pk, s.msg, bad), false);
  assert.equal(calls.length, 1);
});

test('Signal-variant wasm (yawf_xopen) is identical to WhatsApp\'s conversion + tweetnacl-js', () => {
  const e = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(WASM_FILE))).exports;
  const xopen = (pk33, msg, sig) => {
    const mem = new Uint8Array(e.memory.buffer);
    mem.set(pk33.subarray(1, 33), e.yawf_pk());
    mem.set(sig, e.yawf_sm());
    mem.set(msg, e.yawf_sm() + 64);
    return e.yawf_xopen(64 + msg.length) === 0;
  };
  let mismatches = 0;
  let valid = 0;
  const same = (pk, msg, sig) => {
    const a = referenceSignalVerify(pk, msg, sig);
    if (a !== xopen(pk, msg, sig)) mismatches++;
    if (a) valid++;
  };
  const edgeU = [0n, 1n, p25519 - 1n, p25519, p25519 + 1n, 2n ** 255n - 1n, 2n ** 256n - 1n];
  for (let i = 0; i < 40; i++) {
    const s = signalSigned(i % 60);
    same(s.pk, s.msg, s.sig);
    for (const bit of [5, 6, 7]) {
      const t = new Uint8Array(s.sig);
      t[63] ^= 1 << bit; // reserved bits must fail, flipped sign bit must fail
      same(s.pk, s.msg, t);
    }
    const k = new Uint8Array(s.pk);
    k[1 + crypto.randomInt(32)] ^= 1 << crypto.randomInt(8);
    same(k, s.msg, s.sig);
    const edge = new Uint8Array(33);
    edge.set(bigToLe(edgeU[i % edgeU.length] & (2n ** 256n - 1n)), 1);
    same(edge, s.msg, s.sig);
  }
  assert.equal(mismatches, 0);
  // The 40 untouched signatures must verify. Flipping the top bit of the Montgomery
  // u-coordinate is ignored by the conversion, so a random key flip can legitimately
  // verify too (~14% of runs); mismatches === 0 is what pins wasm to the reference.
  assert.ok(valid >= 40);
});

test('wasm SHA-512 (cache keys) matches node crypto', () => {
  const e = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(WASM_FILE))).exports;
  for (const len of [0, 1, 111, 112, 127, 128, 129, 133, 255, 256, 1000, 4160]) {
    const buf = crypto.randomBytes(len);
    new Uint8Array(e.memory.buffer).set(buf, e.yawf_sm());
    assert.equal(e.yawf_sha512(len), 0);
    const got = Buffer.from(new Uint8Array(e.memory.buffer, e.yawf_hash_out(), 64));
    assert.equal(got.toString('hex'), crypto.createHash('sha512').update(buf).digest('hex'), `len ${len}`);
  }
  assert.equal(e.yawf_sha512(4161), -1);
});
