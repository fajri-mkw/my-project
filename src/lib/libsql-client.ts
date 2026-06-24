/**
 * Direct libSQL client for Pushakin Flows — bypasses Prisma.
 *
 * WHY: On Cloudflare Workers free plan, CPU time is limited (10ms/request on
 * free tier). Prisma's query-building, type-mapping, and client initialization
 * consume measurable CPU. Network I/O (waiting for the DB response over HTTP)
 * is NOT counted toward CPU time. By using @libsql/client directly, we:
 *   1. Skip Prisma's client-side overhead (CPU)
 *   2. Skip ensureDbConnection() + ensureSchemaSync() (1+ extra query + CPU)
 *   3. Only pay for network I/O (free) + minimal JSON parsing (CPU)
 *
 * COMPATIBILITY:
 *   - Production (Cloudflare Workers + Turso `libsql://` URL):
 *       Uses the patched `@libsql/client` (HTTP/WebSocket transport, no native
 *       bindings — required by Workers). The package's `node.js` entry was
 *       patched to be identical to `web.js` so it bundles cleanly on Workers.
 *   - Local dev (Node + `file:` URL):
 *       The patched `@libsql/client` does NOT support `file:` URLs (the local
 *       SQLite driver was stripped to keep the Workers bundle small). We
 *       therefore detect `file:` URLs and fall back to `better-sqlite3`
 *       (already a dependency), wrapped in a thin Client-compatible adapter.
 *       This branch is never reached on Workers (production uses libsql://).
 *
 * STORAGE FORMAT (Prisma + SQLite):
 *   - DateTime → INTEGER (epoch milliseconds)
 *   - Boolean  → INTEGER (0 or 1)
 *   - JSON     → TEXT (JSON.stringify'd string)
 *   - String?  → TEXT | NULL
 *
 * These helpers convert libsql row values back to the shapes the frontend
 * expects (matching the old Prisma responses exactly).
 */

import { createClient, type Client, type InValue, type InStatement, type InArgs } from '@libsql/client'

// Re-export the libsql statement types so callers can type their batch arrays
// without importing directly from @libsql/client.
export type { InStatement, InArgs, InValue }

// Singleton client — reused across requests in the same isolate/process.
let _client: Client | null = null

/**
 * Get the shared libsql client. Reads DATABASE_URL (required) and
 * DATABASE_AUTH_TOKEN (optional, only for libsql:// Turso remote).
 *
 * Routing:
 *   - `file:` URL  → better-sqlite3 adapter (local dev only)
 *   - other scheme → patched @libsql/client (production / remote)
 */
export function getLibsql(): Client {
  if (_client) return _client

  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL is not set')
  }

  if (url.startsWith('file:')) {
    // Local dev branch — never reached on Cloudflare Workers (prod uses
    // libsql:// URLs). Lazy-require better-sqlite3 so the native module is
    // never bundled into the Workers build.
    _client = createLocalSqliteClient(url)
    return _client
  }

  const authToken = process.env.DATABASE_AUTH_TOKEN || undefined
  _client = createClient({ url, authToken })
  return _client
}

// ---------------------------------------------------------------------------
// Local-dev adapter: wraps `better-sqlite3` in a `@libsql/client`-compatible
// Client. Only the methods our codebase actually uses are implemented
// (`execute`, `batch`, `transaction`, `close`). The shape of ResultSet mirrors
// what @libsql/client returns so all callers (helpers like toBool/toDateISO,
// .rows.map, .rowsAffected, etc.) work unchanged.
// ---------------------------------------------------------------------------

interface BetterSqlite3Database {
  prepare(sql: string): {
    all(...args: unknown[]): Record<string, unknown>[]
    run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint }
    columns(): { name: string }[]
  }
  exec(sql: string): void
  pragma(cmd: string): unknown
  transaction<T>(fn: () => T): T
  close(): void
}

// Webpack escape hatch. When webpack bundles this file, it leaves
// `__non_webpack_require__` as-is — at runtime it becomes the original Node
// CommonJS require (not webpack's bundled module resolver). This lets us load
// `better-sqlite3` (which has native C++ bindings) at runtime in local dev
// WITHOUT webpack trying to bundle it into the Cloudflare Workers build.
// In pure-Node (non-webpack) environments, `__non_webpack_require__` is not
// defined, so we fall back to the regular `require` which Node provides.
declare const __non_webpack_require__: NodeRequire | undefined

function createLocalSqliteClient(fileUrl: string): Client {
  // Resolve a "native" require that bypasses webpack's module bundling.
  // - In webpack bundles (next dev / next build): __non_webpack_require__
  //   is the original Node require, and webpack won't try to follow it.
  // - In pure Node: __non_webpack_require__ is undefined, fall back to require.
  // - In Workers (production): this whole branch is never reached (prod uses
  //   libsql:// URLs), so the require call never executes.
  const nativeRequire: NodeRequire =
    typeof __non_webpack_require__ !== 'undefined'
      ? __non_webpack_require__
      : typeof require !== 'undefined'
        ? require
        : (undefined as unknown as NodeRequire)

  if (!nativeRequire) {
    throw new Error(
      'Local dev (file: URL) requires a CommonJS require() to load better-sqlite3, but none is available in this runtime.',
    )
  }

  let Database: new (path: string, opts?: Record<string, unknown>) => BetterSqlite3Database
  try {
    Database = nativeRequire('better-sqlite3')
  } catch {
    throw new Error(
      'Local dev (file: URL) requires better-sqlite3. Install it with: bun add better-sqlite3',
    )
  }

  // Strip 'file:' prefix. Handle 'file:/abs/path', 'file:rel/path',
  // and 'file:./rel/path'. better-sqlite3 expects a normal filesystem path.
  const raw = fileUrl.slice('file:'.length)
  const dbPath = raw.startsWith('/') ? raw : raw.replace(/^\.\//, '')

  const db = new Database(dbPath)
  // Recommended pragmas for concurrency + perf in local dev.
  try { db.pragma('journal_mode = WAL') } catch {}
  try { db.pragma('foreign_keys = ON') } catch {}

  const executeOne = (stmt: InStatement): ReturnType<Client['execute']> => {
    const sql = typeof stmt === 'string' ? stmt : stmt.sql
    const args = typeof stmt === 'string' ? [] : (stmt.args ?? [])

    const prepared = db.prepare(sql)
    const trimmed = sql.trimStart().toUpperCase()
    const isReadOnly =
      trimmed.startsWith('SELECT') ||
      trimmed.startsWith('WITH') ||
      trimmed.startsWith('VALUES') ||
      trimmed.startsWith('PRAGMA')

    if (isReadOnly) {
      const rows = prepared.all(...args)
      const columns = prepared.columns().map((c) => c.name)
      return Promise.resolve({
        columns,
        rows: rows as unknown as Record<string, unknown>[],
        rowsAffected: 0,
        lastInsertRowid: undefined,
      }) as ReturnType<Client['execute']>
    }

    const info = prepared.run(...args)
    return Promise.resolve({
      columns: [],
      rows: [],
      rowsAffected: info.changes,
      lastInsertRowid: info.lastInsertRowid,
    }) as ReturnType<Client['execute']>
  }

  // Minimal Client-compatible object. The `any` casts are intentional — we
  // only need to satisfy the methods our codebase calls.
  const client = {
    execute: (
      stmt: InStatement | string,
      args?: InArgs,
    ): ReturnType<Client['execute']> => {
      const statement: InStatement =
        typeof stmt === 'string' ? { sql: stmt, args: args ?? [] } : stmt
      return executeOne(statement)
    },
    batch: (
      statements: InStatement[],
      _mode?: 'deferred' | 'write' | 'async',
    ): Promise<unknown[]> => {
      // Run all statements atomically. better-sqlite3's db.transaction(fn)
      // RETURNS a transactional wrapper function (it does NOT call fn).
      // We must invoke the returned function to actually execute the batch.
      // This wraps in BEGIN/COMMIT and rolls back on error — exactly what we want.
      try {
        const txn = db.transaction(() => statements.map(executeOne))
        const out = txn()
        return Promise.resolve(out)
      } catch (e) {
        return Promise.reject(e)
      }
    },
    transaction: (_mode?: 'deferred' | 'write' | 'async') => {
      // Minimal Transaction stub. Our codebase doesn't use Transaction
      // objects directly (only `execute` + `batch`), so this is here purely
      // for interface completeness.
      throw new Error('transaction() is not supported by the local SQLite adapter')
    },
    close: () => {
      try { db.close() } catch {}
    },
  } as unknown as Client

  return client
}

// ============================================================================
// Row-mapping helpers — convert raw SQLite values to JS/JSON-friendly types
// ============================================================================

/** SQLite 0/1 (or null) → boolean. */
export function toBool(v: unknown): boolean {
  if (v === null || v === undefined) return false
  // number 0/1, or string '0'/'1', or actual boolean
  return Boolean(Number(v))
}

/** SQLite epoch-ms (or ISO string) → ISO string. Matches Prisma's toISOString(). */
export function toDateISO(v: unknown): string {
  if (v === null || v === undefined) return new Date(0).toISOString()
  if (typeof v === 'number') return new Date(v).toISOString()
  if (typeof v === 'string') {
    // Prisma SQLite stores DateTime as epoch-ms INTEGER, but if it comes back
    // as a numeric string, parse it. If it's an ISO string, Date can parse it.
    if (/^\d+$/.test(v)) return new Date(Number(v)).toISOString()
    const d = new Date(v)
    return isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString()
  }
  if (typeof v === 'bigint') return new Date(Number(v)).toISOString()
  return new Date(0).toISOString()
}

/** Current time as epoch-ms (for INSERT/UPDATE of DateTime columns). */
export function nowMs(): number {
  return Date.now()
}

/** Parse a TEXT column holding JSON, with a fallback if null/invalid. */
export function parseJSON<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback
  if (typeof v !== 'string') return fallback
  try {
    return JSON.parse(v) as T
  } catch {
    return fallback
  }
}

/**
 * Normalize a value for use as a SQL bind parameter.
 * libsql client rejects `undefined`; convert to `null`.
 * Returns InValue (the libsql bind-parameter type) so the result can be used
 * directly in args arrays without further casting.
 */
export function bind(v: unknown): InValue {
  if (v === undefined) return null
  // All values we ever pass (string | number | boolean | null) are valid InValue.
  return v as InValue
}

/**
 * Generate a unique ID for new rows.
 * Uses Web Crypto's randomUUID() (available in Node 19+ and Cloudflare Workers).
 * Returns a 32-char hex string (no hyphens) — fits the existing TEXT id columns.
 */
export function genId(): string {
  // crypto.randomUUID is available in Node 19+ and Cloudflare Workers.
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return uuid.replace(/-/g, '')
  // Fallback (extremely unlikely to be needed)
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}${Math.random().toString(36).slice(2, 10)}`
}
