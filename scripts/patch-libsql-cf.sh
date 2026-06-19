#!/bin/bash
# Patch ALL @libsql/client + @libsql/isomorphic-ws installations for CF Workers.
#
# Finds every copy (including nested ones inside @prisma/adapter-libsql) and:
#   1. Overwrites node.js with web.js content (HTTP client, no native bindings)
#   2. Overwrites node.mjs with web.mjs content (standard WebSocket)
#   3. Stubs sqlite3.js (prevents native `import "libsql"`)
#   4. Updates package.json exports → all point to node.js/node.mjs

set -e

find_and_patch_libsql_client() {
  # Find all @libsql/client directories
  find node_modules -type d -path "*/@libsql/client" 2>/dev/null | while read -r CLIENT_PKG; do
    if [ ! -f "$CLIENT_PKG/package.json" ]; then continue; fi
    echo "[patch-libsql] Found @libsql/client at: $CLIENT_PKG"

    # 1. Overwrite node.js with web.js content (ESM)
    if [ -f "$CLIENT_PKG/lib-esm/web.js" ] && [ -f "$CLIENT_PKG/lib-esm/node.js" ]; then
      if ! grep -q "PATCHED FOR CLOUDFLARE" "$CLIENT_PKG/lib-esm/node.js" 2>/dev/null; then
        cp "$CLIENT_PKG/lib-esm/web.js" "$CLIENT_PKG/lib-esm/node.js"
        sed -i '1i // PATCHED FOR CLOUDFLARE — content replaced with web.js (HTTP client, no native bindings)\n' "$CLIENT_PKG/lib-esm/node.js"
        echo "[patch-libsql]   ✓ node.js → web.js content"
      fi
    fi

    # Same for CommonJS
    if [ -f "$CLIENT_PKG/lib-cjs/web.js" ] && [ -f "$CLIENT_PKG/lib-cjs/node.js" ]; then
      if ! grep -q "PATCHED FOR CLOUDFLARE" "$CLIENT_PKG/lib-cjs/node.js" 2>/dev/null; then
        cp "$CLIENT_PKG/lib-cjs/web.js" "$CLIENT_PKG/lib-cjs/node.js"
        sed -i '1i // PATCHED FOR CLOUDFLARE — content replaced with web.js (HTTP client, no native bindings)\n' "$CLIENT_PKG/lib-cjs/node.js"
        echo "[patch-libsql]   ✓ lib-cjs/node.js → web.js content"
      fi
    fi

    # 2. Update package.json exports → all point to node.js
    node -e "
      const fs = require('fs');
      const p = JSON.parse(fs.readFileSync('$CLIENT_PKG/package.json', 'utf-8'));
      const imp = p.exports['.'].import;
      const TARGET = './lib-esm/node.js';
      let changed = false;
      for (const cond of ['workerd','deno','edge-light','netlify','browser','default']) {
        if (imp[cond] && imp[cond] !== TARGET) { imp[cond] = TARGET; changed = true; }
      }
      if (changed) {
        fs.writeFileSync('$CLIENT_PKG/package.json', JSON.stringify(p, null, 2));
        console.log('[patch-libsql]   ✓ exports → all point to node.js');
      }
    " 2>/dev/null

    # 3. Stub sqlite3.js (ESM)
    if [ -f "$CLIENT_PKG/lib-esm/sqlite3.js" ]; then
      if ! grep -q "STUBBED FOR CLOUDFLARE" "$CLIENT_PKG/lib-esm/sqlite3.js" 2>/dev/null; then
        cat > "$CLIENT_PKG/lib-esm/sqlite3.js" << 'STUB_EOF'
// STUBBED FOR CLOUDFLARE WORKERS — native libsql binding not available.
import { LibsqlError } from "@libsql/core/api";
export * from "@libsql/core/api";
export function createClient(config) {
    throw new LibsqlError("Local SQLite (file: URL) not supported on Workers. Use libsql:// URL.", "URL_SCHEME_NOT_SUPPORTED");
}
export function _createClient(config) {
    throw new LibsqlError("Local SQLite (file: URL) not supported on Workers. Use libsql:// URL.", "URL_SCHEME_NOT_SUPPORTED");
}
STUB_EOF
        echo "[patch-libsql]   ✓ sqlite3.js stubbed"
      fi
    fi

    # Stub sqlite3.js (CJS)
    if [ -f "$CLIENT_PKG/lib-cjs/sqlite3.js" ]; then
      if ! grep -q "STUBBED FOR CLOUDFLARE" "$CLIENT_PKG/lib-cjs/sqlite3.js" 2>/dev/null; then
        cat > "$CLIENT_PKG/lib-cjs/sqlite3.js" << 'STUB_EOF'
// STUBBED FOR CLOUDFLARE WORKERS
"use strict";
const { LibsqlError } = require("@libsql/core/api");
module.exports = { ...require("@libsql/core/api"),
  createClient(c) { throw new LibsqlError("file: URL not supported on Workers.", "URL_SCHEME_NOT_SUPPORTED"); },
  _createClient(c) { throw new LibsqlError("file: URL not supported on Workers.", "URL_SCHEME_NOT_SUPPORTED"); }
};
STUB_EOF
        echo "[patch-libsql]   ✓ lib-cjs/sqlite3.js stubbed"
      fi
    fi
  done
}

find_and_patch_isomorphic_ws() {
  find node_modules -type d -path "*/@libsql/isomorphic-ws" 2>/dev/null | while read -r WS_PKG; do
    if [ ! -f "$WS_PKG/package.json" ]; then continue; fi
    echo "[patch-libsql] Found @libsql/isomorphic-ws at: $WS_PKG"

    # Overwrite node.mjs with web.mjs content
    if [ -f "$WS_PKG/web.mjs" ] && [ -f "$WS_PKG/node.mjs" ]; then
      if ! grep -q "PATCHED FOR CLOUDFLARE" "$WS_PKG/node.mjs" 2>/dev/null; then
        cp "$WS_PKG/web.mjs" "$WS_PKG/node.mjs"
        sed -i '1i // PATCHED FOR CLOUDFLARE — content replaced with web.mjs (standard WebSocket)\n' "$WS_PKG/node.mjs"
        echo "[patch-libsql]   ✓ node.mjs → web.mjs content"
      fi
    fi

    # Overwrite node.cjs with web.cjs content
    if [ -f "$WS_PKG/web.cjs" ] && [ -f "$WS_PKG/node.cjs" ]; then
      if ! grep -q "PATCHED FOR CLOUDFLARE" "$WS_PKG/node.cjs" 2>/dev/null; then
        cp "$WS_PKG/web.cjs" "$WS_PKG/node.cjs"
        sed -i '1i // PATCHED FOR CLOUDFLARE — content replaced with web.cjs (standard WebSocket)\n' "$WS_PKG/node.cjs"
        echo "[patch-libsql]   ✓ node.cjs → web.cjs content"
      fi
    fi

    # Update exports → all point to node.mjs/node.cjs
    node -e "
      const fs = require('fs');
      const p = JSON.parse(fs.readFileSync('$WS_PKG/package.json', 'utf-8'));
      let changed = false;
      const imp = p.exports['.'].import;
      for (const cond of ['workerd','deno','edge-light','netlify','browser','default']) {
        if (imp[cond] && imp[cond] !== './node.mjs') { imp[cond] = './node.mjs'; changed = true; }
      }
      const req = p.exports['.'].require;
      for (const cond of ['workerd','deno','edge-light','netlify','browser','default']) {
        if (req[cond] && req[cond] !== './node.cjs') { req[cond] = './node.cjs'; changed = true; }
      }
      if (changed) {
        fs.writeFileSync('$WS_PKG/package.json', JSON.stringify(p, null, 2));
        console.log('[patch-libsql]   ✓ exports → all point to node.mjs');
      }
    " 2>/dev/null
  done
}

echo "[patch-libsql] Starting patches..."
find_and_patch_libsql_client
find_and_patch_isomorphic_ws
echo "[patch-libsql] Done."

# === Patch .prisma/client to use WASM engine (not library engine) ===
# The generated client's package.json has subpath imports:
#   #main-entry-point → node: ./index.js (library engine), workerd: ./wasm.js (WASM)
# esbuild may use the "node" condition, loading the library engine (fails on Workers).
# Fix: make ALL conditions point to ./wasm.js (WASM engine, no native bindings).
PRISMA_CLIENT_GEN="node_modules/.prisma/client"
if [ -f "$PRISMA_CLIENT_GEN/package.json" ]; then
  node -e "
    const fs = require('fs');
    const p = JSON.parse(fs.readFileSync('$PRISMA_CLIENT_GEN/package.json', 'utf-8'));
    const imp = p.imports && p.imports['#main-entry-point'];
    if (!imp) { console.log('[patch-libsql] No #main-entry-point in .prisma/client'); process.exit(0); }
    let changed = false;
    const TARGET = './wasm.js';
    for (const cond of ['node', 'edge-light', 'workerd', 'worker', 'browser', 'default']) {
      if (imp.require && imp.require[cond] && imp.require[cond] !== TARGET) { imp.require[cond] = TARGET; changed = true; }
      if (imp.import && imp.import[cond] && imp.import[cond] !== TARGET) { imp.import[cond] = TARGET; changed = true; }
    }
    if (imp.require) imp.require.default = TARGET;
    if (imp.import) imp.import.default = TARGET;
    if (imp.default !== TARGET) { imp.default = TARGET; changed = true; }
    if (changed) {
      fs.writeFileSync('$PRISMA_CLIENT_GEN/package.json', JSON.stringify(p, null, 2));
      console.log('[patch-libsql] .prisma/client #main-entry-point → all → wasm.js');
    } else {
      console.log('[patch-libsql] .prisma/client already patched');
    }
  "
fi

# === Patch .prisma/client/default.js to directly require wasm.js ===
# Bypasses the #main-entry-point subpath import (which esbuild may not resolve
# correctly) and directly loads the WASM engine.
PRISMA_DEFAULT="node_modules/.prisma/client/default.js"
if [ -f "$PRISMA_DEFAULT" ]; then
  if ! grep -q "Patched for Cloudflare Workers" "$PRISMA_DEFAULT" 2>/dev/null; then
    cat > "$PRISMA_DEFAULT" << 'DEOF'
/* !!! Patched for Cloudflare Workers — bypass #main-entry-point resolution */
/* Directly require wasm.js (WASM engine) instead of index.js (library engine) */
module.exports = { ...require('./wasm.js') }
DEOF
    echo "[patch-libsql] .prisma/client/default.js → direct require wasm.js"
  else
    echo "[patch-libsql] .prisma/client/default.js already patched"
  fi
fi

# === Patch OUTER @prisma/client/default.js to directly load WASM engine ===
OUTER_DEFAULT="node_modules/@prisma/client/default.js"
if [ -f "$OUTER_DEFAULT" ]; then
  if ! grep -q "Patched for Cloudflare Workers" "$OUTER_DEFAULT" 2>/dev/null; then
    cat > "$OUTER_DEFAULT" << 'ODEOF'
/* Patched for Cloudflare Workers — directly load WASM engine */
module.exports = { ...require('.prisma/client/wasm.js') }
ODEOF
    echo "[patch-libsql] @prisma/client/default.js → direct wasm.js"
  fi
fi

# === Patch .prisma/client/index.js: use WASM runtime instead of library runtime ===
INDEX_JS="node_modules/.prisma/client/index.js"
if [ -f "$INDEX_JS" ]; then
  if grep -q "runtime/library.js" "$INDEX_JS" 2>/dev/null; then
    sed -i 's|@prisma/client/runtime/library.js|@prisma/client/runtime/wasm-engine-edge.js|g' "$INDEX_JS"
    echo "[patch-libsql] .prisma/client/index.js runtime → wasm-engine-edge.js"
  fi
fi

# === Patch engineType: "library" → "wasm" in all generated files ===
for f in node_modules/.prisma/client/index.js node_modules/.prisma/client/wasm.js; do
  if [ -f "$f" ] && grep -q '"engineType": "library"' "$f" 2>/dev/null; then
    sed -i 's/"engineType": "library"/"engineType": "wasm"/g' "$f"
    echo "[patch-libsql] $f engineType → wasm"
  fi
done

# === Patch node-fetch: use native fetch (CF Workers has fetch built-in) ===
# gaxios (used by googleapis) dynamically imports 'node-fetch' when `window` is
# undefined. node-fetch v2 uses Node's http/https modules, which are unenv
# stubs on CF Workers → "https.request is not implemented yet!".
# Fix: overwrite ALL node-fetch entry points with a shim that re-exports
# the native global fetch().
NODE_FETCH_SHIM='// PATCHED FOR CLOUDFLARE — uses native fetch (CF Workers built-in)
// Replaces node-fetch v2 Node.js implementation with native fetch shim
if (typeof fetch !== "undefined") {
  module.exports = fetch.bind(globalThis);
  module.exports.default = fetch.bind(globalThis);
  module.exports.Headers = (typeof Headers !== "undefined") ? Headers : undefined;
  module.exports.Request = (typeof Request !== "undefined") ? Request : undefined;
  module.exports.Response = (typeof Response !== "undefined") ? Response : undefined;
} else {
  throw new Error("[patch] native fetch not available");
}
'
NODE_FETCH_SHIM_ESM='// PATCHED FOR CLOUDFLARE — uses native fetch (CF Workers built-in)
const _fetch = fetch.bind(globalThis);
export default _fetch;
export { _fetch as fetch };
export const Headers = (typeof Headers !== "undefined") ? Headers : undefined;
export const Request = (typeof Request !== "undefined") ? Request : undefined;
export const Response = (typeof Response !== "undefined") ? Response : undefined;
'
# Find ALL node-fetch installations (including nested ones)
find node_modules -type d -name "node-fetch" 2>/dev/null | while read -r NF_PKG; do
  if [ ! -f "$NF_PKG/package.json" ]; then continue; fi
  NF_VER=$(node -e "console.log(require('$NF_PKG/package.json').version)" 2>/dev/null || echo "?")
  echo "[patch-libsql] Found node-fetch@$NF_VER at: $NF_PKG"

  # Overwrite lib/index.js (CommonJS entry)
  if [ -f "$NF_PKG/lib/index.js" ]; then
    echo "$NODE_FETCH_SHIM" > "$NF_PKG/lib/index.js"
    echo "[patch-libsql]   ✓ lib/index.js → native fetch shim"
  fi
  # Overwrite lib/index.mjs (ESM entry)
  if [ -f "$NF_PKG/lib/index.mjs" ]; then
    echo "$NODE_FETCH_SHIM_ESM" > "$NF_PKG/lib/index.mjs"
    echo "[patch-libsql]   ✓ lib/index.mjs → native fetch shim (ESM)"
  fi
  # Overwrite browser.js too (in case it's resolved)
  if [ -f "$NF_PKG/browser.js" ]; then
    echo "$NODE_FETCH_SHIM" > "$NF_PKG/browser.js"
    echo "[patch-libsql]   ✓ browser.js → native fetch shim"
  fi
done

# === Patch https-proxy-agent: stub it (CF Workers doesn't need proxy agents) ===
# gaxios dynamically imports 'https-proxy-agent' → uses Node's http/https.
# On CF Workers, proxies aren't needed. Stub it to a no-op class.
PROXY_SHIM='// PATCHED FOR CLOUDFLARE — https-proxy-agent stub (no proxy needed on Workers)
class HttpsProxyAgent {
  constructor() {}
}
module.exports = HttpsProxyAgent;
module.exports.HttpsProxyAgent = HttpsProxyAgent;
module.exports.default = HttpsProxyAgent;
'
PROXY_SHIM_ESM='// PATCHED FOR CLOUDFLARE — https-proxy-agent stub (no proxy needed on Workers)
class HttpsProxyAgent {
  constructor() {}
}
export default HttpsProxyAgent;
export { HttpsProxyAgent };
'
find node_modules -type d -name "https-proxy-agent" 2>/dev/null | while read -r PA_PKG; do
  if [ ! -f "$PA_PKG/package.json" ]; then continue; fi
  echo "[patch-libsql] Found https-proxy-agent at: $PA_PKG"
  # Overwrite dist/index.js (CommonJS)
  if [ -f "$PA_PKG/dist/index.js" ]; then
    echo "$PROXY_SHIM" > "$PA_PKG/dist/index.js"
    echo "[patch-libsql]   ✓ dist/index.js → stub"
  fi
  # Overwrite dist/index.mjs (ESM) if it exists
  if [ -f "$PA_PKG/dist/index.mjs" ]; then
    echo "$PROXY_SHIM_ESM" > "$PA_PKG/dist/index.mjs"
    echo "[patch-libsql]   ✓ dist/index.mjs → stub (ESM)"
  fi
done

# === Patch gaxios: force native fetch (bypass node-fetch dynamic import) ===
# gaxios's #getFetch() checks `typeof window !== 'undefined'` — on CF Workers
# this is false, so it falls back to `import('node-fetch')` which uses Node's
# https module (unenv stub → "https.request is not implemented yet!").
# Fix: set hasWindow=true and use fetch.bind(globalThis) instead of window.fetch.
for GAXIOS_FILE in node_modules/gaxios/build/esm/src/gaxios.js node_modules/gaxios/build/cjs/src/gaxios.js; do
  if [ -f "$GAXIOS_FILE" ]; then
    if grep -q "const hasWindow = typeof window" "$GAXIOS_FILE" 2>/dev/null; then
      sed -i 's|const hasWindow = typeof window !== .undefined. && \!\!window;|const hasWindow = true; // PATCHED FOR CLOUDFLARE|g' "$GAXIOS_FILE"
      sed -i 's|window\.fetch|fetch.bind(globalThis)|g' "$GAXIOS_FILE"
      echo "[patch-libsql] ✓ $GAXIOS_FILE → hasWindow=true, uses native fetch"
    fi
  fi
done
