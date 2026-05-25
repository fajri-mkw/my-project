// Auto-migration utility for Pushakin Flows
// Ensures database schema matches Prisma schema by adding missing columns
// Supports both PostgreSQL (Vercel/Neon) and SQLite (local dev)

import { db } from './db'

let syncPerformed = false
let syncPromise: Promise<boolean> | null = null

/**
 * Ensures all columns added in recent schema changes exist in the database.
 * Safe to call multiple times — uses IF NOT EXISTS / PRAGMA checks.
 */
export async function ensureSchemaSync(): Promise<boolean> {
  if (syncPerformed) return true
  if (syncPromise) return syncPromise

  syncPromise = performSchemaSync()
  return syncPromise
}

async function performSchemaSync(): Promise<boolean> {
  try {
    const isPostgres = !!process.env.DIRECT_DATABASE_URL || 
      (process.env.DATABASE_URL?.startsWith('postgresql') || 
       process.env.DATABASE_URL?.startsWith('postgres'))

    if (isPostgres) {
      await syncPostgres()
    } else {
      await syncSqlite()
    }

    syncPerformed = true
    console.log('[DB Sync] Schema sync completed successfully')
    return true
  } catch (error) {
    console.error('[DB Sync] Schema sync failed (non-fatal):', error)
    syncPerformed = true
    return false
  }
}

// === SQLite sync ===
async function syncSqlite(): Promise<void> {
  await addSqliteColumnIfNotExists('projects', 'isFastTrack', 'BOOLEAN DEFAULT 0')
  await addSqliteColumnIfNotExists('projects', 'isFastProduction', 'BOOLEAN DEFAULT 0')
  await addSqliteColumnIfNotExists('projects', 'publicToken', 'TEXT')
  await addSqliteColumnIfNotExists('projects', 'documents', 'TEXT DEFAULT \'[]\'')
  await addSqliteColumnIfNotExists('users', 'notifWaEnabled', 'BOOLEAN DEFAULT 1')
  await addSqliteColumnIfNotExists('users', 'notifEmailEnabled', 'BOOLEAN DEFAULT 1')
  await addSqliteColumnIfNotExists('tasks', 'revisionCount', 'INTEGER DEFAULT 0')

  // === Role rename migration: PhotographerAudio + VideographerAudio → PhotographerVideographerAudio ===
  await renameSqliteRole('users', 'role', 'PhotographerAudio', 'PhotographerVideographerAudio')
  await renameSqliteRole('users', 'role', 'VideographerAudio', 'PhotographerVideographerAudio')
  await renameSqliteRole('tasks', 'role', 'PhotographerAudio', 'PhotographerVideographerAudio')
  await renameSqliteRole('tasks', 'role', 'VideographerAudio', 'PhotographerVideographerAudio')
  await renameSqliteRole('surat_tugas', 'role', 'PhotographerAudio', 'PhotographerVideographerAudio')
  await renameSqliteRole('surat_tugas', 'role', 'VideographerAudio', 'PhotographerVideographerAudio')

  // === Role rename migration: EditorMedia → EditorVideo, EditorWebSocialMedia → EditorWebArticle ===
  await renameSqliteRole('users', 'role', 'EditorMedia', 'EditorVideo')
  await renameSqliteRole('users', 'role', 'EditorWebSocialMedia', 'EditorWebArticle')
  await renameSqliteRole('tasks', 'role', 'EditorMedia', 'EditorVideo')
  await renameSqliteRole('tasks', 'role', 'EditorWebSocialMedia', 'EditorWebArticle')
  await renameSqliteRole('surat_tugas', 'role', 'EditorMedia', 'EditorVideo')
  await renameSqliteRole('surat_tugas', 'role', 'EditorWebSocialMedia', 'EditorWebArticle')
}

async function addSqliteColumnIfNotExists(
  table: string,
  column: string,
  columnDef: string
): Promise<void> {
  try {
    // Get existing columns for this table using PRAGMA
    const result = await db.$queryRawUnsafe(
      `PRAGMA table_info("${table}")`
    ) as Array<{ name: string }>

    const columnExists = result.some(col => col.name === column)
    
    if (!columnExists) {
      console.log(`[DB Sync SQLite] Adding column ${table}.${column}`)
      await db.$executeRawUnsafe(
        `ALTER TABLE "${table}" ADD COLUMN "${column}" ${columnDef}`
      )
      console.log(`[DB Sync SQLite] Added column ${table}.${column}`)
    }
  } catch (error) {
    console.error(`[DB Sync SQLite] Failed to add column ${table}.${column}:`, error)
    // Non-fatal — continue with other columns
  }
}

// === PostgreSQL sync ===
async function syncPostgres(): Promise<void> {
  // === User table ===
  await addPostgresColumnIfNotExists('users', 'notifWaEnabled', 'BOOLEAN DEFAULT true')
  await addPostgresColumnIfNotExists('users', 'notifEmailEnabled', 'BOOLEAN DEFAULT true')

  // === Settings table ===
  await addPostgresColumnIfNotExists('settings', 'notifWaEnabled', 'BOOLEAN DEFAULT false')
  await addPostgresColumnIfNotExists('settings', 'notifWaToken', 'TEXT')
  await addPostgresColumnIfNotExists('settings', 'notifWaDeviceId', 'TEXT')
  await addPostgresColumnIfNotExists('settings', 'notifWaSenderNumber', 'TEXT')
  await addPostgresColumnIfNotExists('settings', 'notifEmailEnabled', 'BOOLEAN DEFAULT false')
  await addPostgresColumnIfNotExists('settings', 'notifEmailHost', 'TEXT')
  await addPostgresColumnIfNotExists('settings', 'notifEmailPort', 'INTEGER')
  await addPostgresColumnIfNotExists('settings', 'notifEmailUser', 'TEXT')
  await addPostgresColumnIfNotExists('settings', 'notifEmailPass', 'TEXT')
  await addPostgresColumnIfNotExists('settings', 'notifEmailFromName', 'TEXT')

  // === Projects table ===
  await addPostgresColumnIfNotExists('projects', 'isFastTrack', 'BOOLEAN DEFAULT false')
  await addPostgresColumnIfNotExists('projects', 'isFastProduction', 'BOOLEAN DEFAULT false')
  await addPostgresColumnIfNotExists('projects', 'publicToken', 'TEXT UNIQUE')
  await addPostgresColumnIfNotExists('projects', 'documents', 'TEXT DEFAULT \'[]\'')

  // === Tasks table ===
  await addPostgresColumnIfNotExists('tasks', 'revisionCount', 'INTEGER DEFAULT 0')

  // === Role rename migration: PhotographerAudio + VideographerAudio → PhotographerVideographerAudio ===
  await renamePostgresRole('users', 'role', 'PhotographerAudio', 'PhotographerVideographerAudio')
  await renamePostgresRole('users', 'role', 'VideographerAudio', 'PhotographerVideographerAudio')
  await renamePostgresRole('tasks', 'role', 'PhotographerAudio', 'PhotographerVideographerAudio')
  await renamePostgresRole('tasks', 'role', 'VideographerAudio', 'PhotographerVideographerAudio')
  await renamePostgresRole('surat_tugas', 'role', 'PhotographerAudio', 'PhotographerVideographerAudio')
  await renamePostgresRole('surat_tugas', 'role', 'VideographerAudio', 'PhotographerVideographerAudio')

  // === Role rename migration: EditorMedia → EditorVideo, EditorWebSocialMedia → EditorWebArticle ===
  await renamePostgresRole('users', 'role', 'EditorMedia', 'EditorVideo')
  await renamePostgresRole('users', 'role', 'EditorWebSocialMedia', 'EditorWebArticle')
  await renamePostgresRole('tasks', 'role', 'EditorMedia', 'EditorVideo')
  await renamePostgresRole('tasks', 'role', 'EditorWebSocialMedia', 'EditorWebArticle')
  await renamePostgresRole('surat_tugas', 'role', 'EditorMedia', 'EditorVideo')
  await renamePostgresRole('surat_tugas', 'role', 'EditorWebSocialMedia', 'EditorWebArticle')
}

async function addPostgresColumnIfNotExists(
  table: string, 
  column: string, 
  columnDef: string
): Promise<void> {
  try {
    const result = await db.$queryRawUnsafe(
      `SELECT column_name FROM information_schema.columns 
       WHERE table_name = '${table}' AND column_name = '${column}' 
       LIMIT 1`
    ) as Array<{ column_name: string }>

    if (!result || result.length === 0) {
      console.log(`[DB Sync Postgres] Adding column ${table}.${column}`)
      await db.$executeRawUnsafe(
        `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${column}" ${columnDef}`
      )
      console.log(`[DB Sync Postgres] Added column ${table}.${column}`)
    }
  } catch (error) {
    console.error(`[DB Sync Postgres] Failed to add column ${table}.${column}:`, error)
  }
}

// === Role rename helpers ===

/**
 * Renames a role value in a SQLite table column.
 * Safe to call multiple times — only updates rows that still have the old value.
 */
async function renameSqliteRole(
  table: string,
  column: string,
  oldRole: string,
  newRole: string
): Promise<void> {
  try {
    const result = await db.$executeRawUnsafe(
      `UPDATE "${table}" SET "${column}" = '${newRole}' WHERE "${column}" = '${oldRole}'`
    )
    if (result > 0) {
      console.log(`[DB Sync SQLite] Renamed role '${oldRole}' → '${newRole}' in ${table}.${column} (${result} rows)`)
    }
  } catch (error) {
    console.error(`[DB Sync SQLite] Failed to rename role ${oldRole} → ${newRole} in ${table}.${column}:`, error)
  }
}

/**
 * Renames a role value in a PostgreSQL table column.
 * Safe to call multiple times — only updates rows that still have the old value.
 */
async function renamePostgresRole(
  table: string,
  column: string,
  oldRole: string,
  newRole: string
): Promise<void> {
  try {
    const result = await db.$executeRawUnsafe(
      `UPDATE "${table}" SET "${column}" = '${newRole}' WHERE "${column}" = '${oldRole}'`
    )
    if (result > 0) {
      console.log(`[DB Sync Postgres] Renamed role '${oldRole}' → '${newRole}' in ${table}.${column} (${result} rows)`)
    }
  } catch (error) {
    console.error(`[DB Sync Postgres] Failed to rename role ${oldRole} → ${newRole} in ${table}.${column}:`, error)
  }
}
