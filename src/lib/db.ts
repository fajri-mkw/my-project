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

// Helper to ensure database connection + schema is up to date
export async function ensureDbConnection(): Promise<boolean> {
  try {
    // Try to connect with a timeout
    const connectPromise = db.$connect()
    const timeoutPromise = new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error('Database connection timeout after 10s')), 10000)
    )
    await Promise.race([connectPromise, timeoutPromise])

    // Auto-sync schema for new columns (handles Vercel migrations)
    const { ensureSchemaSync } = await import('./db-sync')
    await ensureSchemaSync()

    return true
  } catch (error) {
    console.error('Database connection failed:', error)
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
