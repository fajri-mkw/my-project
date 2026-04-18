// Auto-migration utility for Pushakin Flows
// Ensures database schema matches Prisma schema by adding missing columns
// Uses raw SQL to safely add columns that may not exist in production

import { db } from './db'

let syncPerformed = false
let syncPromise: Promise<boolean> | null = null

/**
 * Ensures all columns added in recent schema changes exist in the database.
 * Uses PostgreSQL-specific queries (Vercel uses Neon PostgreSQL).
 * Safe to call multiple times — uses IF NOT EXISTS / information_schema checks.
 */
export async function ensureSchemaSync(): Promise<boolean> {
  if (syncPerformed) return true
  if (syncPromise) return syncPromise

  syncPromise = performSchemaSync()
  return syncPromise
}

async function performSchemaSync(): Promise<boolean> {
  try {
    // Check if we're on PostgreSQL (Vercel) or SQLite (local dev)
    const isPostgres = !!process.env.DIRECT_DATABASE_URL || 
      (process.env.DATABASE_URL?.startsWith('postgresql') || 
       process.env.DATABASE_URL?.startsWith('postgres'))

    if (isPostgres) {
      await syncPostgres()
    }
    // For SQLite, Prisma handles schema automatically via db push

    syncPerformed = true
    console.log('[DB Sync] Schema sync completed successfully')
    return true
  } catch (error) {
    console.error('[DB Sync] Schema sync failed (non-fatal):', error)
    syncPerformed = true // Don't retry on every request
    return false
  }
}

async function syncPostgres(): Promise<void> {
  // === User table: add notifWaEnabled and notifEmailEnabled ===
  await addColumnIfNotExists('users', 'notifWaEnabled', 'Boolean DEFAULT true')
  await addColumnIfNotExists('users', 'notifEmailEnabled', 'Boolean DEFAULT true')

  // === Settings table: add notification config fields ===
  await addColumnIfNotExists('settings', 'notifWaEnabled', 'Boolean DEFAULT false')
  await addColumnIfNotExists('settings', 'notifWaToken', 'TEXT')
  await addColumnIfNotExists('settings', 'notifWaDeviceId', 'TEXT')
  await addColumnIfNotExists('settings', 'notifWaSenderNumber', 'TEXT')
  await addColumnIfNotExists('settings', 'notifEmailEnabled', 'Boolean DEFAULT false')
  await addColumnIfNotExists('settings', 'notifEmailHost', 'TEXT')
  await addColumnIfNotExists('settings', 'notifEmailPort', 'INTEGER')
  await addColumnIfNotExists('settings', 'notifEmailUser', 'TEXT')
  await addColumnIfNotExists('settings', 'notifEmailPass', 'TEXT')
  await addColumnIfNotExists('settings', 'notifEmailFromName', 'TEXT')
}

async function addColumnIfNotExists(
  table: string, 
  column: string, 
  columnDef: string
): Promise<void> {
  // Check if column exists using information_schema
  const result = await db.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns 
     WHERE table_name = '${table}' AND column_name = '${column}' 
     LIMIT 1`
  ) as Array<{ column_name: string }>

  if (!result || result.length === 0) {
    console.log(`[DB Sync] Adding column ${table}.${column}`)
    await db.$executeRawUnsafe(
      `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${column}" ${columnDef}`
    )
    console.log(`[DB Sync] Added column ${table}.${column}`)
  }
}
