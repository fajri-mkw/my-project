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
 * COMPATIBILITY: Works with both `file:` URLs (local dev / Node) and
 * `libsql://` URLs (Turso / Cloudflare Workers production). The transport is
 * auto-selected by @libsql/client based on the URL scheme.
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
 */
export function getLibsql(): Client {
  if (_client) return _client

  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL is not set')
  }

  const authToken = process.env.DATABASE_AUTH_TOKEN || undefined

  _client = createClient({ url, authToken })
  return _client
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
