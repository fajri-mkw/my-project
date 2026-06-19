import './polyfill-cf'
import { PrismaClient } from '@prisma/client'
import { PrismaLibSQL } from '@prisma/adapter-libsql/web'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

/**
 * Create a PrismaClient backed by the libSQL driver adapter.
 *
 * Supports two connection modes via DATABASE_URL:
 *   - Local dev:  file:db/custom.db           (no auth token needed)
 *   - Turso/edge: libsql://<host>?authToken=…  (token in URL or DATABASE_AUTH_TOKEN env)
 *
 * libSQL is a SQLite fork → schema provider stays "sqlite", all raw SQL
 * (PRAGMA, ALTER TABLE, etc.) remains compatible.
 */
function createPrismaClient(): PrismaClient {
  const databaseUrl = process.env.DATABASE_URL || 'file:db/custom.db'

  // For file: URLs, no authToken is needed.
  // For libsql: URLs (Turso/Cloudflare), authToken comes from the
  // DATABASE_AUTH_TOKEN env var.
  const isFile = databaseUrl.startsWith('file:')

  // PrismaLibSQL (from @prisma/adapter-libsql/web) uses the HTTP/WebSocket
  // based @libsql/client — no native bindings, works on Cloudflare Workers.
  const adapter = new PrismaLibSQL(
    isFile
      ? { url: databaseUrl }
      : { url: databaseUrl, authToken: process.env.DATABASE_AUTH_TOKEN }
  )

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })
}

// In production, create a new PrismaClient for each request
// In development, reuse the same client
export const db = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db
}

// Store last connection error for debugging
let lastConnectionError: string | null = null

// Track connection state to avoid redundant $connect() calls
let isConnected = false
let connectionPromise: Promise<void> | null = null

export function getLastDbError(): string | null {
  return lastConnectionError
}

/**
 * Ensure database connection + schema sync.
 * Returns true if connected, false if failed.
 *
 * NOTE: With the libSQL driver adapter, $connect() is effectively a no-op
 * (the adapter manages the connection pool internally). We still call it
 * for backward compatibility, but the real work happens in ensureSchemaSync().
 *
 * Schema sync uses version-based skip: on cold starts,
 * only 1 query (version check) is needed instead of 26+ migration queries
 * when the schema is already up-to-date.
 */
export async function ensureDbConnection(): Promise<boolean> {
  try {
    lastConnectionError = null

    // NOTE: With the libSQL driver adapter, $connect() is a no-op (the adapter
    // manages the connection pool internally). We intentionally do NOT call
    // $connect() because it triggers Prisma's library engine instantiation
    // (getCurrentBinaryTarget → fs.readdir), which fails on Cloudflare Workers
    // (no filesystem). The first query implicitly connects via the adapter.

    // Auto-sync schema — uses version-based skip for fast cold starts
    // When schema is already current: 1 query (version check) → skip
    // When schema needs migration: runs all migrations + stores version
    const { ensureSchemaSync } = await import('./db-sync')
    await ensureSchemaSync()

    isConnected = true
    return true
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : ''
    console.error('Database connection failed:', errorMsg)
    if (errorStack) {
      console.error('Stack:', errorStack)
    }
    lastConnectionError = errorMsg

    // Reset connection state
    isConnected = false
    connectionPromise = null

    // Do NOT call $disconnect() — it also triggers the library engine.
    // The adapter handles connection cleanup automatically.
    return false
  }
}

// Pushakin Flows v1.0 - Production
