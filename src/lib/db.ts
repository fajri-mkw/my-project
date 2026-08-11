import './polyfill-cf'
import { PrismaClient } from '@prisma/client'
import { PrismaLibSQL } from '@prisma/adapter-libsql/web'
import { PrismaD1 } from '@prisma/adapter-d1'
import { getCloudflareContext } from '@opennextjs/cloudflare'

// Minimal D1Database type — the actual binding at runtime is a real
// D1Database from the Workers runtime. We only need a structural type
// so PrismaD1 accepts it.
interface D1DatabaseLike {
  prepare(sql: string): unknown
  batch?<T = unknown>(statements: unknown[]): Promise<T[]>
}

// Lazily-initialized Prisma client. The Cloudflare D1 binding (`env.DB`) is
// only available inside a Workers request handler — NOT at module-load time.
// We therefore defer PrismaClient construction until the first property
// access, using a Proxy. By that point, `getCloudflareContext()` (sync mode)
// is available and we can read `env.DB`.
//
// Routing (matches libsql-client.ts):
//   1. D1 binding available (Cloudflare Workers production)
//      → PrismaD1 adapter
//   2. `DATABASE_URL` starts with `file:`
//      → PrismaLibSQL adapter with local file (local dev only)
//   3. `DATABASE_URL` is a remote libsql:// URL
//      → PrismaLibSQL adapter with HTTP transport (legacy Turso fallback)

let _prisma: PrismaClient | null = null

function createPrismaClient(): PrismaClient {
  const databaseUrl = process.env.DATABASE_URL || 'file:db/custom.db'
  const isFile = databaseUrl.startsWith('file:')

  // Local dev: file: URL via libsql local adapter (no patch, supports file:)
  if (isFile) {
    const adapter = new PrismaLibSQL({ url: databaseUrl })
    return new PrismaClient({
      adapter,
      log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    })
  }

  // Production on Cloudflare Workers — try D1 binding first
  try {
    const ctx = getCloudflareContext()
    const env = ctx?.env as { DB?: D1DatabaseLike } | undefined
    if (env?.DB) {
      const adapter = new PrismaD1(env.DB as never)
      return new PrismaClient({
        adapter,
        log: ['error'],
      })
    }
  } catch {
    // Not on Cloudflare Workers — fall through to libsql HTTP fallback
  }

  // Legacy fallback: remote libsql:// URL (Turso)
  const adapter = new PrismaLibSQL({
    url: databaseUrl,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  })
  return new PrismaClient({
    adapter,
    log: ['error'],
  })
}

function getDb(): PrismaClient {
  if (_prisma) return _prisma
  _prisma = createPrismaClient()
  return _prisma
}

/**
 * Lazy Prisma client proxy.
 *
 * `db.user.findFirst(...)` works exactly as before — the underlying
 * PrismaClient is constructed on first method access (when the Cloudflare
 * request context / D1 binding is available), then memoized for reuse.
 *
 * This pattern is required because:
 *   - The D1 binding (`env.DB`) is only available inside request handlers.
 *   - A module-level singleton (the old pattern) would try to read `env.DB`
 *     at import time, before any request has arrived.
 */
export const db = new Proxy({} as PrismaClient, {
  get(_target, prop: string | symbol) {
    const client = getDb()
    const value = Reflect.get(client as object, prop)
    if (typeof value === 'function') {
      // Bind methods so `this` is the PrismaClient instance
      return (value as (...args: unknown[]) => unknown).bind(client)
    }
    return value
  },
}) as PrismaClient

// Store last connection error for debugging
let lastConnectionError: string | null = null

export function getLastDbError(): string | null {
  return lastConnectionError
}

/**
 * Ensure database connection + schema sync.
 *
 * On Cloudflare Workers + D1: the schema is applied manually via
 * `wrangler2 d1 execute` (see scripts/d1-schema.sql). We therefore SKIP
 * ensureSchemaSync entirely — running 26+ migration queries on every cold
 * start would burn D1 write quota and CPU time unnecessarily.
 *
 * On local dev (file: SQLite): schema sync still runs to auto-create tables
 * if missing. The migrations are idempotent.
 *
 * Returns true if connected, false if failed.
 */
export async function ensureDbConnection(): Promise<boolean> {
  try {
    lastConnectionError = null

    // Detect D1: if the D1 binding is available, skip schema sync entirely
    // (schema is applied manually via wrangler2 d1 execute --remote).
    try {
      const ctx = getCloudflareContext()
      const env = ctx?.env as { DB?: unknown } | undefined
      if (env?.DB) {
        // On D1 — no schema sync needed (applied manually)
        return true
      }
    } catch {
      // Not on Workers — fall through to schema sync (local dev)
    }

    // Local dev (file: SQLite) — run schema sync to ensure tables exist
    const { ensureSchemaSync } = await import('./db-sync')
    await ensureSchemaSync()

    return true
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : ''
    console.error('Database connection failed:', errorMsg)
    if (errorStack) {
      console.error('Stack:', errorStack)
    }
    lastConnectionError = errorMsg

    return false
  }
}

// Pushakin Flows v1.0 - Production
