import './polyfill-cf'

// ============================================================================
// LAZY PRISMA IMPORTS — defer PrismaClient WASM load until actually needed.
//
// Previously, `import { PrismaClient } from '@prisma/client'` was a STATIC
// import at module level. This caused the Prisma WASM module (~1.5MB) to be
// loaded on EVERY Worker cold start — even for routes that never use Prisma
// (most routes now use libsql directly). On Cloudflare Workers free plan
// (10ms CPU limit), this caused Error 1102 "Worker exceeded resource limits".
//
// With dynamic imports, the WASM module ONLY loads when a route actually
// calls `db.someModel.findMany(...)` or `ensureDbConnection()`. Routes that
// only use libsql (the majority) never trigger the Prisma WASM load.
// ============================================================================

// Minimal D1Database type — the actual binding at runtime is a real
// D1Database from the Workers runtime. We only need a structural type
// so PrismaD1 accepts it.
interface D1DatabaseLike {
  prepare(sql: string): unknown
  batch?<T = unknown>(statements: unknown[]): Promise<T[]>
}

// Type for PrismaClient — we import the type separately (types are erased
// at compile time, so this doesn't load the WASM module).
type PrismaClient = import('@prisma/client').PrismaClient

let _prisma: PrismaClient | null = null
let _prismaPromise: Promise<PrismaClient> | null = null

async function createPrismaClient(): Promise<PrismaClient> {
  // Dynamic import — Prisma WASM only loads HERE, not at module level
  const { PrismaClient } = await import('@prisma/client')
  const databaseUrl = process.env.DATABASE_URL || 'file:db/custom.db'
  const isFile = databaseUrl.startsWith('file:')

  if (isFile) {
    // Local dev (file: SQLite) — use the standard library engine directly.
    // The libsql WEB adapter (@prisma/adapter-libsql/web) can only speak
    // HTTP/WS — it cannot open file: URLs, so it always failed locally.
    // The library engine reads SQLite natively: fastest, zero-config.
    //
    // NOTE: this requires the PRISTINE @prisma/client package (library
    // engine). `scripts/setup-db.js` restores it from scripts/vendor/ on
    // every `bun run dev` start, undoing the Cloudflare deploy patch
    // (scripts/patch-libsql-cf.sh rewrites default.js → wasm.js).
    return new PrismaClient({
      datasourceUrl: databaseUrl,
      log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    })
  }

  // Production on Cloudflare Workers — try D1 binding first
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare')
    const ctx = getCloudflareContext()
    const env = ctx?.env as { DB?: D1DatabaseLike } | undefined
    if (env?.DB) {
      const { PrismaD1 } = await import('@prisma/adapter-d1')
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
  const { PrismaLibSQL } = await import('@prisma/adapter-libsql/web')
  const adapter = new PrismaLibSQL({
    url: databaseUrl,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  })
  return new PrismaClient({
    adapter,
    log: ['error'],
  })
}

async function getDbAsync(): Promise<PrismaClient> {
  if (_prisma) return _prisma
  if (_prismaPromise) return _prismaPromise
  _prismaPromise = createPrismaClient().then(client => {
    _prisma = client
    _prismaPromise = null
    return client
  })
  return _prismaPromise
}

/**
 * Lazy Prisma client proxy — defers the PrismaClient import (WASM on Workers /
 * library engine locally) until the first actual call.
 *
 * Supported access patterns:
 *   1. `await db.user.findMany({...})`   — chained MODEL method call
 *   2. `await db.$queryRaw\`...\``        — top-level client method call
 *   3. `await db.user`                    — property value access
 *
 * HISTORY BUG (fixed): the previous proxy only handled pattern 2 — a plain
 * `get` trap returning an async function. Accessing `db.user` returned that
 * async FUNCTION (not the model delegate), so `db.user.count` was `undefined`
 * and every `db.<model>.<method>()` call in every route threw
 * "db.user.count is not a function". This broke 15+ production routes
 * (reset-password, change-password, reviewer-settings, register-document,
 * restore, …) from the moment the lazy proxy shipped.
 *
 * The fix: the trap now returns a CALLABLE proxy that also forwards
 * sub-property access, so both `db.$transaction(...)` (call) and
 * `db.user.findMany(...)` (property → call) work.
 */
function makeLazyPropProxy(prop: string | symbol): unknown {
  // Resolve/call the top-level property against the real client.
  const lazyCall = async (...args: unknown[]) => {
    const client = await getDbAsync()
    const value = Reflect.get(client as object, prop)
    if (typeof value === 'function') {
      return (value as (...a: unknown[]) => unknown).apply(client, args)
    }
    return value
  }

  // Callable proxy over lazyCall — adds sub-property forwarding
  // (db.user.findMany) while keeping direct calls (db.$transaction) working.
  return new Proxy(lazyCall, {
    get(fn, subProp: string | symbol, receiver) {
      // Own props of the async fn: `then` (so `await db.user` resolves to the
      // delegate object), name, length, … — return them as-is.
      const direct = Reflect.get(fn, subProp, receiver)
      if (direct !== undefined) {
        return direct
      }
      // Lazy member: `db.<prop>.<subProp>(...)` — e.g. db.user.findMany()
      return async (...args: unknown[]) => {
        const client = await getDbAsync()
        const parent = Reflect.get(client as object, prop)
        const member = Reflect.get(parent as object, subProp)
        if (typeof member === 'function') {
          return (member as (...a: unknown[]) => unknown).apply(parent, args)
        }
        return member
      }
    },
    apply(fn, _thisArg, args) {
      return (fn as (...a: unknown[]) => unknown)(...args)
    },
  })
}

export const db = new Proxy({} as PrismaClient, {
  get(_target, prop: string | symbol) {
    return makeLazyPropProxy(prop)
  },
}) as PrismaClient

// Store last connection error for debugging
let lastConnectionError: string | null = null

export function getLastDbError(): string | null {
  return lastConnectionError
}

/**
 * Ensure database connection + schema sync.
 */
export async function ensureDbConnection(): Promise<boolean> {
  try {
    lastConnectionError = null

    // Detect D1: if the D1 binding is available, skip schema sync entirely
    try {
      const { getCloudflareContext } = await import('@opennextjs/cloudflare')
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
    console.error('Database connection failed:', errorMsg)
    lastConnectionError = errorMsg
    return false
  }
}

// Pushakin Flows v1.0 - Production
