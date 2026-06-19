/**
 * Cloudflare Workers polyfill for Node.js `fs` module.
 *
 * MUST be imported before @prisma/client.
 *
 * Prisma's getCurrentBinaryTarget() calls fs.readdir to scan for engine files.
 * On Workers, unenv stubs fs.readdir to throw "not implemented".
 * We override it with Object.defineProperty to return empty arrays,
 * which makes Prisma skip the library engine and use the WASM engine instead.
 */

function patchFs(fs: any) {
  try {
    let needsPatch = false
    try {
      fs.readdirSync('/__cf_workers_test__')
    } catch (e: any) {
      if (e?.message?.includes('not implemented')) {
        needsPatch = true
      }
    }

    if (!needsPatch) return

    const stubReaddir = function () {
      const args = Array.from(arguments)
      const callback = args[args.length - 1]
      if (typeof callback === 'function') {
        callback(null, [])
        return
      }
      return []
    }

    try { Object.defineProperty(fs, 'readdir', { value: stubReaddir, writable: true, configurable: true }) } catch {}
    try { Object.defineProperty(fs, 'readdirSync', { value: () => [], writable: true, configurable: true }) } catch {}
    try { Object.defineProperty(fs, 'existsSync', { value: () => false, writable: true, configurable: true }) } catch {}
    try { Object.defineProperty(fs, 'statSync', { value: () => { const e: any = new Error('ENOENT'); e.code = 'ENOENT'; throw e }, writable: true, configurable: true }) } catch {}

    if (fs.promises) {
      try { Object.defineProperty(fs.promises, 'readdir', { value: async () => [], writable: true, configurable: true }) } catch {}
    }
  } catch {}
}

try { patchFs(require('node:fs')) } catch {}
try { patchFs(require('fs')) } catch {}
