/*
 * Native differential test for wasm/ed25519_verify.c: every fast path against
 * TweetNaCl's original code on the same inputs. Any disagreement is a bug.
 *
 *   clang -O2 -o /tmp/difftest wasm/difftest.c && /tmp/difftest 20000
 *
 * 1. field: fe_* (10 limbs) vs tweetnacl's gf ops, random + edge values
 * 2. yawf_sign_open vs crypto_sign_open: valid, bit flips, non-canonical
 *    S + L, garbage, keys with a small-order (torsion) component
 * 3. yawf_xeddsa_open vs the same conversion WhatsApp Web does in JS
 *    (tweetnacl ops + crypto_sign_open): valid Signal-variant signatures,
 *    flips, sign/reserved bits, edge Montgomery keys (incl. u = -1)
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "ed25519_verify.c"

static FILE *urandom;
void randombytes(u8 *x, u64 n) { if (fread(x, 1, n, urandom) != n) abort(); }
static unsigned rnd(void) { unsigned w; randombytes((u8 *) &w, sizeof w); return w; }

/* crypto_sign, verbatim from TweetNaCl 20140427 (test-only) */
static int crypto_sign(u8 *sm,u64 *smlen,const u8 *m,u64 n,const u8 *sk)
{
  u8 d[64],h[64],r[64];
  i64 i,j,x[64];
  gf p[4];

  crypto_hash(d, sk, 32);
  d[0] &= 248;
  d[31] &= 127;
  d[31] |= 64;

  *smlen = n+64;
  FOR(i,n) sm[64 + i] = m[i];
  FOR(i,32) sm[32 + i] = d[32 + i];

  crypto_hash(r, sm+32, n+32);
  reduce(r);
  scalarbase(p,r);
  pack(sm,p);

  FOR(i,32) sm[i+32] = sk[i+32];
  crypto_hash(h,sm,n + 64);
  reduce(h);

  FOR(i,64) x[i] = 0;
  FOR(i,32) x[i] = (u64) r[i];
  FOR(i,32) FOR(j,32) x[i+j] += h[i] * (u64) d[j];
  modL(sm + 32,x);

  return 0;
}

static void keypair(u8 *pk, u8 *sk, gf A_[4])
{
  u8 d[64];
  int i;
  randombytes(sk, 32);
  crypto_hash(d, sk, 32);
  d[0] &= 248; d[31] &= 127; d[31] |= 64;
  scalarbase(A_, d);
  pack(pk, A_);
  FOR(i, 32) sk[32 + i] = pk[i];
}

static long cases, mismatches, accepted;
static void report(const char *what, int a, int b)
{
  cases++;
  if (a == 0) accepted++;
  if (a != b && mismatches++ < 10) fprintf(stderr, "MISMATCH %s: original %d, yawf %d\n", what, a, b);
}

/* ---- 1. field */
static const char *edge_hex[] = {
  "0000000000000000000000000000000000000000000000000000000000000000",
  "0100000000000000000000000000000000000000000000000000000000000000",
  "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f", /* p - 1 */
  "edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f", /* p */
  "eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f", /* p + 1 */
  "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f", /* 2^255 - 1 */
  "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", /* 2^256 - 1 */
  "0000000000000000000000000000000000000000000000000000000000000080", /* 2^255 */
  "ffffff03000000000000000000000000000000000000000000000000000000f0", /* limb-boundary bits */
};
static void hexbytes(u8 *o, const char *h) { int i; FOR(i, 32) { unsigned v; sscanf(h + 2 * i, "%2x", &v); o[i] = v; } }

static void field_value(u8 *s, long r)
{
  int n = sizeof edge_hex / sizeof *edge_hex;
  if (r % 4 == 0) hexbytes(s, edge_hex[(r / 4) % n]);
  else randombytes(s, 32);
}

static void field_round(long r)
{
  u8 a[32], b[32], c[32], x1[32], x2[32];
  gf ga, gb, gc, g1, g2;
  fe fa, fb, fc, f1, f2;
  field_value(a, r); field_value(b, r + 1); field_value(c, r + 2);
  unpack25519(ga, a); unpack25519(gb, b); unpack25519(gc, c);
  fe_frombytes(fa, a); fe_frombytes(fb, b); fe_frombytes(fc, c);

  pack25519(x1, ga); fe_tobytes(x2, fa); report("field load/store", vn(x1, x2, 32), 0);

  /* (a*b - c)^2 + (a + b) * c, through unreduced intermediates */
  M(g1, ga, gb); Z(g1, g1, gc); S(g1, g1); A(g2, ga, gb); M(g2, g2, gc); A(g1, g1, g2);
  fe_mul(f1, fa, fb); fe_sub(f1, f1, fc); fe_sq(f1, f1); fe_add(f2, fa, fb); fe_mul(f2, f2, fc); fe_add(f1, f1, f2);
  pack25519(x1, g1); fe_tobytes(x2, f1); report("field expr", vn(x1, x2, 32), 0);

  inv25519(g1, ga); fe_invert(f1, fa);
  pack25519(x1, g1); fe_tobytes(x2, f1); report("field invert", vn(x1, x2, 32), 0);

  pow2523(g1, gb); fe_pow2523(f1, fb);
  pack25519(x1, g1); fe_tobytes(x2, f1); report("field pow2523", vn(x1, x2, 32), 0);

  report("field par", par25519(ga) == fe_par(fa) ? 0 : 1, 0);
  report("field neq", neq25519(ga, gb) == fe_neq(fa, fb) ? 0 : 1, 0);
}

/* ---- 2. Ed25519 */
#define MAXN 200
static u8 m1[MAXN + 64], m2[MAXN + 64];

static void check_ed(const char *what, const u8 *sm, u64 n, const u8 *pk)
{
  u64 l1, l2;
  report(what, crypto_sign_open(m1, &l1, sm, n, pk), yawf_sign_open(m2, &l2, sm, n, pk));
}

static void torsion_point(gf T[4])
{
  u8 enc[32], Lb[32];
  gf P_[4];
  int i;
  FOR(i, 32) Lb[i] = (u8) L[i];
  do randombytes(enc, 32); while (unpackneg(P_, enc));
  scalarmult(T, P_, Lb);
}

/* ---- 3. WhatsApp's Signal-variant check, reference = WhatsApp's JS logic */
static int ref_xeddsa_open(u8 *m, u64 *mlen, const u8 *sm_in, u64 n, const u8 *mont)
{
  u8 sm[MAXN + 64], edpk[32], nb;
  gf u, c, d, inv, y;
  memcpy(sm, sm_in, n);
  if (n < 64) return -1;
  nb = sm[63];
  if (nb & 96) return -1;
  sm[63] = nb & 127;
  unpack25519(u, mont);
  Z(c, u, gf1);
  A(d, u, gf1);
  inv25519(inv, d);
  M(y, c, inv);
  pack25519(edpk, y);
  edpk[31] = (edpk[31] & 127) | (nb & 128);
  return crypto_sign_open(m, mlen, sm, n, edpk);
}

static void check_x(const char *what, const u8 *sm, u64 n, const u8 *mont)
{
  u8 copy[MAXN + 64];
  u64 l1, l2;
  memcpy(copy, sm, n);
  report(what, ref_xeddsa_open(m1, &l1, sm, n, mont), yawf_xeddsa_open(m2, &l2, copy, n, mont));
}

/* Ed25519 public key -> Montgomery u = (1 + y) / (1 - y) */
static void ed_to_mont(u8 *mont, const u8 *edpk)
{
  gf y, num, den;
  unpack25519(y, edpk);
  A(num, gf1, y);
  Z(den, gf1, y);
  inv25519(den, den);
  M(num, num, den);
  pack25519(mont, num);
}

int main(int argc, char **argv)
{
  long rounds = argc > 1 ? atol(argv[1]) : 2000, r;
  static const u8 Lbytes[32] = {0xed,0xd3,0xf5,0x5c,0x1a,0x63,0x12,0x58,0xd6,0x9c,0xf7,0xa2,0xde,0xf9,0xde,0x14,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0x10};
  long torsion_valid = 0, noncanon_valid = 0, x_valid = 0;
  int nedge = sizeof edge_hex / sizeof *edge_hex;
  urandom = fopen("/dev/urandom", "rb");
  if (!urandom) return 2;

  for (r = 0; r < rounds * 20; ++r) field_round(r);
  printf("field: %ld cases, mismatches %ld\n", cases, mismatches);

  for (r = 0; r < rounds; ++r) {
    u8 pk[32], sk[64], msg[MAXN], sm[MAXN + 64], x[MAXN + 64], pk2[32], mont[32];
    u64 n = r % MAXN, smlen;
    gf A_[4], T[4];
    int i, c;
    unsigned w;
    long before;

    keypair(pk, sk, A_);
    randombytes(msg, n);
    crypto_sign(sm, &smlen, msg, n, sk);
    check_ed("valid", sm, smlen, pk);

    FOR(i, 3) {
      memcpy(x, sm, smlen); memcpy(pk2, pk, 32);
      w = rnd();
      if (i == 2) pk2[w % 32] ^= 1 << (w >> 8 & 7);
      else x[(i == 0 ? 0 : 64) + w % (i == 0 ? 64 : (n ? n : 1))] ^= 1 << (w >> 8 & 7);
      check_ed("flip", x, smlen, pk2);
    }

    memcpy(x, sm, smlen);
    c = 0;
    FOR(i, 32) { int v = x[32 + i] + Lbytes[i] + c; x[32 + i] = v & 255; c = v >> 8; }
    if (!c) { before = accepted; check_ed("S+L", x, smlen, pk); noncanon_valid += accepted - before; }

    randombytes(x, 64 + 23); randombytes(pk2, 32);
    check_ed("garbage", x, 64 + 23, pk2);
    hexbytes(pk2, edge_hex[r % nedge]);
    check_ed("edge pk", sm, smlen, pk2);

    /* Signal variant: Montgomery key + sign bit in sig[63] */
    ed_to_mont(mont, pk);
    memcpy(x, sm, smlen);
    x[63] |= pk[31] & 128;
    before = accepted; check_x("x valid", x, smlen, mont); x_valid += accepted - before;
    FOR(i, 3) {
      u8 y[MAXN + 64], m2k[32];
      memcpy(y, x, smlen); memcpy(m2k, mont, 32);
      w = rnd();
      if (i == 0) y[w % 64] ^= 1 << (w >> 8 & 7);
      else if (i == 1) m2k[w % 32] ^= 1 << (w >> 8 & 7);
      else y[63] ^= 1 << (5 + w % 3); /* reserved bits / sign bit */
      check_x("x flip", y, smlen, m2k);
    }
    hexbytes(pk2, edge_hex[r % nedge]);
    check_x("x edge key", x, smlen, pk2);
    randombytes(pk2, 32);
    check_x("x garbage", x, smlen, pk2);

    before = accepted;
    torsion_point(T);
    add(A_, T);
    pack(pk2, A_);
    FOR(i, 32) sk[32 + i] = pk2[i];
    crypto_sign(sm, &smlen, msg, n, sk);
    check_ed("torsion", sm, smlen, pk2);
    torsion_valid += accepted - before;
  }
  printf("total: %ld cases, accepted %ld (non-canonical S+L %ld, torsion keys %ld, signal-variant %ld/%ld), mismatches %ld\n",
         cases, accepted, noncanon_valid, torsion_valid, x_valid, rounds, mismatches);
  return mismatches ? 1 : 0;
}
