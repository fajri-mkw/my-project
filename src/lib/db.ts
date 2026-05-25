import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// In production, create a new PrismaClient for each request
// In development, reuse the same client
export const db = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
})

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
 * Schema sync uses version-based skip: on Vercel cold starts,
 * only 1 query (version check) is needed instead of 26+ migration queries
 * when the schema is already up-to-date.
 */
export async function ensureDbConnection(): Promise<boolean> {
  try {
    lastConnectionError = null

    // Skip $connect() if already connected (saves ~50ms per request on warm server)
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
