#!/usr/bin/env bash
# Rebuilds wasm/ed25519_verify.wasm and re-embeds it (base64) into src/preload.js.
# The sandboxed preload can't read files, hence the embedding. Needs clang with
# the wasm32 target and wasm-ld (llvm/lld packages); no emscripten, no libc.
set -euo pipefail
cd "$(dirname "$0")/.."

clang --target=wasm32 -O3 -nostdlib -fno-builtin -mbulk-memory \
  -Wl,--no-entry -Wl,--strip-all -Wl,-z,stack-size=65536 \
  -o wasm/ed25519_verify.wasm wasm/ed25519_verify.c

b64=$(base64 -w0 wasm/ed25519_verify.wasm)
sed -i "s|^const ED25519_WASM = '.*';$|const ED25519_WASM = '${b64}';|" src/preload.js
grep -q "^const ED25519_WASM = '${b64}';$" src/preload.js || { echo "ED25519_WASM line not found in src/preload.js" >&2; exit 1; }
echo "wasm/ed25519_verify.wasm: $(stat -c %s wasm/ed25519_verify.wasm) bytes, embedded in src/preload.js"
