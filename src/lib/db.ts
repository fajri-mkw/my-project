import { PrismaClient } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'

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

  // PrismaLibSql accepts a config object and creates the libSQL client internally.
  const adapter = new PrismaLibSql(
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

    // Skip $connect() if already connected (saves overhead on warm requests)
    if (!isConnected) {
      // Deduplicate concurrent connection attempts
      if (!connectionPromise) {
        connectionPromise = db.$connect().then(() => {
          isConnected = true
          connectionPromise = null
        }).catch((err) => {
          connectionPromise = null
          throw err
        })
      }

      // Race with timeout
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Database connection timeout after 10s')), 10000)
      )
      await Promise.race([connectionPromise, timeoutPromise])
    }

    // Auto-sync schema — uses version-based skip for fast cold starts
    // When schema is already current: 1 query (version check) → skip
    // When schema needs migration: runs all migrations + stores version
    const { ensureSchemaSync } = await import('./db-sync')
    await ensureSchemaSync()

    return true
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    console.error('Database connection failed:', errorMsg)
    lastConnectionError = errorMsg

    // Reset connection state
    isConnected = false
    connectionPromise = null

    // Try to reset the Prisma client connection for next attempt
    try {
      await db.$disconnect()
    } catch {
      // Ignore disconnect errors
    }
    return false
  }
}

// Pushakin Flows v1.0 - Production
