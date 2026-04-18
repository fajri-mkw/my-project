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
    await db.$connect()

    // Auto-sync schema for new columns (handles Vercel migrations)
    const { ensureSchemaSync } = await import('./db-sync')
    await ensureSchemaSync()

    return true
  } catch (error) {
    console.error('Database connection failed:', error)
    return false
  }
}

// Pushakin Flows v1.0 - Production
