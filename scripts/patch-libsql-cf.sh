#!/bin/bash
# Patch @libsql packages for Cloudflare Workers compatibility.
# The workerd export conditions point to files that esbuild can't resolve
# during OpenNext bundling. Redirect them to the node versions which work
# with the nodejs_compat flag.

set -e

patch_libsql_client() {
  local pkg="node_modules/@libsql/client/package.json"
  if [ -f "$pkg" ]; then
    node -e "
      const fs = require('fs');
      const p = JSON.parse(fs.readFileSync('$pkg', 'utf-8'));
      const imp = p.exports['.'].import;
      if (imp.workerd && imp.workerd.includes('web.js') && !fs.existsSync('node_modules/@libsql/client/' + imp.workerd)) {
        imp.workerd = imp.node || './lib-esm/node.js';
        imp['edge-light'] = imp.node || './lib-esm/node.js';
        imp['netlify'] = imp.node || './lib-esm/node.js';
        imp['browser'] = imp.node || './lib-esm/node.js';
        fs.writeFileSync('$pkg', JSON.stringify(p, null, 2));
        console.log('[patch-libsql] Patched @libsql/client');
      }
    "
  fi
}

patch_libsql_ws() {
  local pkg="node_modules/@libsql/isomorphic-ws/package.json"
  if [ -f "$pkg" ]; then
    node -e "
      const fs = require('fs');
      const p = JSON.parse(fs.readFileSync('$pkg', 'utf-8'));
      const imp = p.exports['.'].import;
      if (imp.workerd && imp.workerd !== imp.node) {
        imp.workerd = imp.node || './node.mjs';
        fs.writeFileSync('$pkg', JSON.stringify(p, null, 2));
        console.log('[patch-libsql] Patched @libsql/isomorphic-ws');
      }
    "
  fi
}

patch_libsql_client
patch_libsql_ws
