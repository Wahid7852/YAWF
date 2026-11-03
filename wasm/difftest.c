/*
 * Native differential test: yawf_sign_open (what the wasm runs) vs TweetNaCl's
 * original crypto_sign_open, on the same inputs. Any disagreement is a bug.
 *
 *   clang -O2 -o /tmp/difftest wasm/difftest.c && /tmp/difftest 200000
 *
 * Cases per round: valid signature, bit flips in sig/msg/pk, non-canonical
 * S + L, random garbage, and keys with a small-order (torsion) component,
 * signed by the real secret so some of them genuinely verify.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "ed25519_verify.c"

static FILE *urandom;
void randombytes(u8 *x, u64 n) { if (fread(x, 1, n, urandom) != n) abort(); }

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

/* sk = seed || pk, like crypto_sign_keypair; returns the point A too */
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

#define MAXN 200
static u8 m1[MAXN + 64], m2[MAXN + 64];
static long cases, mismatches, accepted;

static void check(const char *what, const u8 *sm, u64 n, const u8 *pk)
{
  u64 l1, l2;
  int a = crypto_sign_open(m1, &l1, sm, n, pk);
  int b = yawf_sign_open(m2, &l2, sm, n, pk);
  cases++;
  if (a == 0) accepted++;
  if (a != b) {
    if (mismatches++ < 10) fprintf(stderr, "MISMATCH %s: original %d, yawf %d\n", what, a, b);
  }
}

/* a point of small order: [L]P for a random curve point P */
static void torsion_point(gf T[4])
{
  u8 enc[32], Lb[32];
  gf P[4];
  int i;
  FOR(i, 32) Lb[i] = (u8) L[i];
  do randombytes(enc, 32); while (unpackneg(P, enc));
  scalarmult(T, P, Lb);
}

int main(int argc, char **argv)
{
  long rounds = argc > 1 ? atol(argv[1]) : 10000, r;
  static const u8 Lbytes[32] = {0xed,0xd3,0xf5,0x5c,0x1a,0x63,0x12,0x58,0xd6,0x9c,0xf7,0xa2,0xde,0xf9,0xde,0x14,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0x10};
  long torsion_valid = 0, noncanon_valid = 0;
  urandom = fopen("/dev/urandom", "rb");
  if (!urandom) return 2;

  for (r = 0; r < rounds; ++r) {
    u8 pk[32], sk[64], msg[MAXN], sm[MAXN + 64], x[MAXN + 64], pk2[32];
    u64 n = r % MAXN, smlen;
    gf A_[4], T[4];
    int i, c;
    unsigned w;

    keypair(pk, sk, A_);
    randombytes(msg, n);
    crypto_sign(sm, &smlen, msg, n, sk);
    check("valid", sm, smlen, pk);

    /* bit flips */
    FOR(i, 3) {
      memcpy(x, sm, smlen); memcpy(pk2, pk, 32);
      randombytes((u8 *) &w, sizeof w);
      if (i == 2) pk2[w % 32] ^= 1 << (w >> 8 & 7);
      else x[(i == 0 ? 0 : 64) + w % (i == 0 ? 64 : (n ? n : 1))] ^= 1 << (w >> 8 & 7);
      check("flip", x, smlen, pk2);
    }

    /* S + L, when it fits in 256 bits */
    memcpy(x, sm, smlen);
    c = 0;
    FOR(i, 32) { int v = x[32 + i] + Lbytes[i] + c; x[32 + i] = v & 255; c = v >> 8; }
    if (!c) {
      long before = accepted;
      check("S+L", x, smlen, pk);
      noncanon_valid += accepted - before;
    }

    /* garbage */
    randombytes(x, 64 + 23); randombytes(pk2, 32);
    check("garbage", x, 64 + 23, pk2);

    /* torsion: pk' = A + T, signed with the real secret */
    {
      long before = accepted;
      torsion_point(T);
      add(A_, T);
      pack(pk2, A_);
      FOR(i, 32) sk[32 + i] = pk2[i];
      crypto_sign(sm, &smlen, msg, n, sk);
      check("torsion", sm, smlen, pk2);
      torsion_valid += accepted - before;
    }
  }
  printf("cases %ld, accepted %ld (non-canonical S+L %ld, torsion keys %ld), mismatches %ld\n",
         cases, accepted, noncanon_valid, torsion_valid, mismatches);
  return mismatches ? 1 : 0;
}
