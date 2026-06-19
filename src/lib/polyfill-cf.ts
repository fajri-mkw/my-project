/**
 * Cloudflare Workers polyfills for Node.js modules.
 *
 * MUST be imported before @prisma/client and before googleapis.
 *
 * Patches:
 *  1. `fs.readdir` / `readdirSync` — Prisma's getCurrentBinaryTarget() scans
 *     for engine files. unenv stubs throw "not implemented". We return empty
 *     arrays so Prisma skips the library engine and uses the WASM engine.
 *  2. `http.validateHeaderName` / `validateHeaderValue` — google-auth-library
 *     calls these before sending HTTP requests. unenv stubs throw
 *     "[unenv] http.validateHeaderName is not implemented yet!". We stub them
 *     as no-ops since CF Workers uses fetch() (which validates headers itself).
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

function patchHttp(http: any) {
  try {
    // google-auth-library calls http.validateHeaderName() / validateHeaderValue()
    // before sending requests. On Workers these are unenv stubs that throw.
    // Stub them as no-ops — fetch() validates headers natively.
    if (typeof http.validateHeaderName === 'function') {
      const orig = http.validateHeaderName
      try {
        http.validateHeaderName = function (name: string) {
          // Accept any non-empty string (fetch() will reject truly invalid names)
          if (typeof name !== 'string' || name.length === 0) {
            throw new TypeError('Header name must be a non-empty string')
          }
        }
        // Preserve original in case we need it
        ;(http.validateHeaderName as any).__original = orig
      } catch {}
    }
    if (typeof http.validateHeaderValue === 'function') {
      const orig = http.validateHeaderValue
      try {
        http.validateHeaderValue = function (name: string, value: any) {
          // Minimal validation — fetch() will reject truly invalid values
          if (value === undefined || value === null) {
            throw new TypeError(`Invalid header value "${name}": ${value}`)
          }
        }
        ;(http.validateHeaderValue as any).__original = orig
      } catch {}
    }
  } catch {}
}

try { patchFs(require('node:fs')) } catch {}
try { patchFs(require('fs')) } catch {}
try { patchHttp(require('node:http')) } catch {}
try { patchHttp(require('http')) } catch {}
