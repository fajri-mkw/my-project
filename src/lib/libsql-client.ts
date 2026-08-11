/**
 * Database client for Pushakin Flows — wraps Cloudflare D1 (production)
 * or better-sqlite3 (local dev) in a `@libsql/client`-compatible interface.
 *
 * WHY: On Cloudflare Workers free plan, CPU time is limited (10ms/request on
 * free tier). Prisma's query-building, type-mapping, and client initialization
 * consume measurable CPU. Network I/O (waiting for the DB response) is NOT
 * counted toward CPU time. By using D1 (or libsql) directly, we:
 *   1. Skip Prisma's client-side overhead (CPU)
 *   2. Skip ensureDbConnection() + ensureSchemaSync() (1+ extra query + CPU)
 *   3. Only pay for network I/O (free) + minimal JSON parsing (CPU)
 *
 * COMPATIBILITY:
 *   - Production (Cloudflare Workers + D1 binding `env.DB`):
 *       Uses the D1 binding directly. Wrapped in a thin Client-compatible
 *       adapter so callers (routes, helpers) see the same `execute`/`batch`
 *       API as before — zero route code changes needed.
 *   - Local dev (Node + `file:` URL):
 *       Falls back to `better-sqlite3` (already a dependency), wrapped in a
 *       thin Client-compatible adapter. D1 binding is not available in
 *       `next dev` unless `initOpenNextCloudflareForDev()` is called.
 *   - Legacy fallback (libsql:// Turso URL):
 *       If neither D1 nor `file:` URL is available, falls back to the patched
 *       `@libsql/client` HTTP client. Kept for backward compat during the
 *       Turso → D1 migration window.
 *
 * STORAGE FORMAT (SQLite — same in D1, Turso, and local file):
 *   - DateTime → INTEGER (epoch milliseconds)
 *   - Boolean  → INTEGER (0 or 1)
 *   - JSON     → TEXT (JSON.stringify'd string)
 *   - String?  → TEXT | NULL
 *
 * These helpers convert libsql/D1 row values back to the shapes the frontend
 * expects (matching the old Prisma responses exactly).
 */

import { createClient, type Client, type InValue, type InStatement, type InArgs } from '@libsql/client'
import { getCloudflareContext } from '@opennextjs/cloudflare'

// Re-export the libsql statement types so callers can type their batch arrays
// without importing directly from @libsql/client.
export type { InStatement, InArgs, InValue }

// Singleton client — reused across requests in the same isolate/process.
let _client: Client | null = null
// Separate singleton for the legacy/libsql client (used by /api/migrate-to-d1
// to read from Turso even when D1 binding is the primary). Never used by
// normal route code.
let _legacyClient: Client | null = null

// Minimal D1Database type (avoids importing workers types which don't exist
// in next dev). At runtime, env.DB on Cloudflare Workers is a real D1Database.
interface D1Statement {
  bind(...values: unknown[]): D1Statement
  all(): Promise<{ results: Record<string, unknown>[]; meta: { changes?: number; last_row_id?: number | null } }>
  run(): Promise<{ meta: { changes?: number; last_row_id?: number | null } }>
}
interface D1Database {
  prepare(sql: string): D1Statement
  batch<T = unknown>(statements: D1Statement[]): Promise<Array<{ results: T[]; meta: { changes?: number; last_row_id?: number | null } }>>
}

/**
 * Try to obtain the D1 binding from the Cloudflare Workers context.
 * Returns null when:
 *   - not running on Cloudflare Workers (e.g. `next dev` in Node), OR
 *   - the `DB` binding is not configured in wrangler.jsonc.
 * Never throws — callers use the result to decide which branch to take.
 */
function tryGetD1Binding(): D1Database | null {
  try {
    // getCloudflareContext() throws when called outside a Workers request
    // (or when initOpenNextCloudflareForDev was not called in next dev).
    // We catch and return null so the caller can fall back to file:/libsql.
    const ctx = getCloudflareContext()
    const env = ctx?.env as { DB?: D1Database } | undefined
    return env?.DB ?? null
  } catch {
    return null
  }
}

/**
 * Get the shared database client. Routing (in priority order):
 *
 *   1. D1 binding available (Cloudflare Workers production)
 *      → D1-backed Client-compatible adapter (no network hop, native binding)
 *
 *   2. `DATABASE_URL` starts with `file:`
 *      → better-sqlite3 adapter (local dev only)
 *
 *   3. `DATABASE_URL` is a remote libsql:// URL
 *      → patched @libsql/client HTTP client (legacy Turso fallback)
 *
 * Throws if none of the above are available.
 */
export function getLibsql(): Client {
  if (_client) return _client

  // 1. Try Cloudflare D1 binding first (production on Workers)
  const d1 = tryGetD1Binding()
  if (d1) {
    _client = createD1Client(d1)
    return _client
  }

  // 2. Fall back to DATABASE_URL
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      'No database available: D1 binding not found and DATABASE_URL is not set. ' +
      'Configure a `DB` D1 binding in wrangler.jsonc, or set DATABASE_URL for local dev.'
    )
  }

  if (url.startsWith('file:')) {
    // Local dev branch — never reached on Cloudflare Workers (prod uses D1).
    // Lazy-require better-sqlite3 so the native module is never bundled into
    // the Workers build.
    _client = createLocalSqliteClient(url)
    return _client
  }

  // 3. Legacy fallback: remote libsql:// URL (Turso)
  const authToken = process.env.DATABASE_AUTH_TOKEN || undefined
  _client = createClient({ url, authToken })
  return _client
}

/**
 * Get a libsql client that always uses the DATABASE_URL (Turso/file:),
 * bypassing the D1 binding. Used by /api/migrate-to-d1 to read source data
 * from Turso even when D1 is the active primary database.
 *
 * Returns null if DATABASE_URL is not set (e.g. in pure D1-only deployments).
 */
export function getLibsqlLegacy(): Client | null {
  if (_legacyClient) return _legacyClient
  const url = process.env.DATABASE_URL
  if (!url) return null
  if (url.startsWith('file:')) {
    _legacyClient = createLocalSqliteClient(url)
    return _legacyClient
  }
  const authToken = process.env.DATABASE_AUTH_TOKEN || undefined
  _legacyClient = createClient({ url, authToken })
  return _legacyClient
}

// ---------------------------------------------------------------------------
// D1 adapter (production on Cloudflare Workers): wraps a D1Database binding
// in a `@libsql/client`-compatible Client. Only the methods our codebase
// actually uses are implemented (`execute`, `batch`, `transaction`, `close`).
// The shape of ResultSet mirrors what @libsql/client returns so all callers
// (helpers like toBool/toDateISO, .rows.map, .rowsAffected, etc.) work
// unchanged.
//
// D1 result shape (from D1Database.prepare().all() / .run()):
//   {
//     results: Record<string, unknown>[]  (rows for SELECT/WITH/VALUES/PRAGMA)
//     meta: { changes: number, last_row_id: number | null, ... }
//     success: boolean
//   }
//
// D1 batch returns an array of the same shape (one entry per statement).
// D1 batch is atomic (runs in a single transaction).
//
// Notes:
//   - D1 does not return column names separately. We derive `columns` from
//     `Object.keys(results[0])` when results are non-empty. Most of our
//     code only uses `.rows` (via toBool/toDateISO etc.) so an empty
//     `columns` array for empty results is fine.
//   - D1's `last_row_id` is `number | null`. We convert null → undefined to
//     match libsql's `lastInsertRowid: number | bigint | undefined`.
// ---------------------------------------------------------------------------

function createD1Client(d1: D1Database): Client {
  const executeOne = (stmt: InStatement): ReturnType<Client['execute']> => {
    const sql = typeof stmt === 'string' ? stmt : stmt.sql
    const args = typeof stmt === 'string' ? [] : (stmt.args ?? [])

    const trimmed = sql.trimStart().toUpperCase()
    const isReadOnly =
      trimmed.startsWith('SELECT') ||
      trimmed.startsWith('WITH') ||
      trimmed.startsWith('VALUES') ||
      trimmed.startsWith('PRAGMA')

    const prepared = d1.prepare(sql).bind(...(args as unknown[]))

    if (isReadOnly) {
      // Use .all() to get rows back for SELECT/WITH/VALUES/PRAGMA
      return prepared.all().then((result) => {
        const rows = result.results ?? []
        return {
          columns: rows.length > 0 ? Object.keys(rows[0]) : [],
          rows: rows as unknown as Record<string, unknown>[],
          rowsAffected: 0,
          lastInsertRowid: undefined,
        }
      }) as ReturnType<Client['execute']>
    }

    // Write statement (INSERT/UPDATE/DELETE/etc.) — use .run()
    return prepared.run().then((result) => {
      const meta = result.meta ?? {}
      const lastId = meta.last_row_id
      return {
        columns: [],
        rows: [],
        rowsAffected: meta.changes ?? 0,
        lastInsertRowid:
          lastId === null || lastId === undefined ? undefined : lastId,
      }
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
      // D1 batch is atomic — runs in a single transaction. Build the
      // D1Statement array, then call d1.batch().
      const d1Stmts = statements.map((s) => {
        const sql = typeof s === 'string' ? s : s.sql
        const args = typeof s === 'string' ? [] : (s.args ?? [])
        return d1.prepare(sql).bind(...(args as unknown[]))
      })
      return d1
        .batch(d1Stmts)
        .then((results) =>
          results.map((r) => {
            const rows = (r.results ?? []) as Record<string, unknown>[]
            const meta = r.meta ?? {}
            const lastId = meta.last_row_id
            return {
              columns: rows.length > 0 ? Object.keys(rows[0]) : [],
              rows: rows as unknown as Record<string, unknown>[],
              rowsAffected: meta.changes ?? 0,
              lastInsertRowid:
                lastId === null || lastId === undefined ? undefined : lastId,
            }
          }),
        )
    },
    transaction: (_mode?: 'deferred' | 'write' | 'async') => {
      // Minimal Transaction stub. Our codebase doesn't use Transaction
      // objects directly (only `execute` + `batch`), so this is here purely
      // for interface completeness. Use `batch()` for atomic multi-statement
      // operations — D1 batch IS transactional.
      throw new Error('transaction() is not supported by the D1 adapter; use batch() instead')
    },
    close: () => {
      // D1 doesn't have a close() — bindings are managed by the runtime.
    },
  } as unknown as Client

  return client
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
