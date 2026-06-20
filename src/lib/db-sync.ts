// Auto-migration utility for Pushakin Flows
// Ensures database schema matches Prisma schema by adding missing columns
// Supports both PostgreSQL (Vercel/Neon) and SQLite (local dev)
//
// PERFORMANCE: Uses a version-based check — after all migrations succeed,
// a version number is stored in the settings table. On subsequent cold starts,
// only 1 query is needed (version check) instead of 26+ migration queries.

import { db } from './db'

// Increment this when adding new migrations
const SCHEMA_VERSION = 6

let syncPerformed = false
let syncPromise: Promise<boolean> | null = null

/**
 * Ensures all columns added in recent schema changes exist in the database.
 * Uses version-based skip: if the stored version matches SCHEMA_VERSION,
 * all migrations are skipped (1 query instead of 26+).
 */
export async function ensureSchemaSync(): Promise<boolean> {
  if (syncPerformed) return true
  if (syncPromise) return syncPromise

  syncPromise = performSchemaSync()
  return syncPromise
}

async function performSchemaSync(): Promise<boolean> {
  try {
    // Version-based skip: check if we've already applied this version
    if (await isSchemaVersionCurrent()) {
      syncPerformed = true
      console.log(`[DB Sync] Schema version ${SCHEMA_VERSION} already applied — skipping migrations`)
      return true
    }

    const isPostgres = !!process.env.DIRECT_DATABASE_URL || 
      (process.env.DATABASE_URL?.startsWith('postgresql') || 
       process.env.DATABASE_URL?.startsWith('postgres'))

    if (isPostgres) {
      await syncPostgres()
    } else {
      await syncSqlite()
    }

    // Mark schema version as current
    await setSchemaVersion(SCHEMA_VERSION)

    syncPerformed = true
    console.log(`[DB Sync] Schema sync completed successfully (version ${SCHEMA_VERSION})`)
    return true
  } catch (error) {
    console.error('[DB Sync] Schema sync failed (non-fatal):', error)
    syncPerformed = true
    return false
  }
}

/**
 * Check if the stored schema version matches our expected version.
 * This replaces 26+ individual migration checks with a single query.
 */
async function isSchemaVersionCurrent(): Promise<boolean> {
  try {
    const settings = await db.settings.findUnique({
      where: { id: 'schema_version' },
      select: { maintenanceMessage: true } // reuse existing column to store version
    })
    return settings?.maintenanceMessage === String(SCHEMA_VERSION)
  } catch {
    // If settings table doesn't exist yet, we need to run migrations
    return false
  }
}

/**
 * Store the current schema version after successful migration.
 */
async function setSchemaVersion(version: number): Promise<void> {
  try {
    await db.settings.upsert({
      where: { id: 'schema_version' },
      update: { maintenanceMessage: String(version) },
      create: { id: 'schema_version', maintenanceMessage: String(version) }
    })
  } catch (error) {
    console.error('[DB Sync] Failed to store schema version:', error)
  }
}

// === SQLite sync — optimized with parallel execution ===
async function syncSqlite(): Promise<void> {
  // Run column additions in parallel — they're independent operations
  await Promise.all([
    addSqliteColumnIfNotExists('projects', 'isFastTrack', 'BOOLEAN DEFAULT 0'),
    addSqliteColumnIfNotExists('projects', 'isFastProduction', 'BOOLEAN DEFAULT 0'),
    addSqliteColumnIfNotExists('projects', 'publicToken', 'TEXT'),
    addSqliteColumnIfNotExists('projects', 'documents', 'TEXT DEFAULT \'[]\''),
    addSqliteColumnIfNotExists('users', 'notifWaEnabled', 'BOOLEAN DEFAULT 1'),
    addSqliteColumnIfNotExists('users', 'notifEmailEnabled', 'BOOLEAN DEFAULT 1'),
    addSqliteColumnIfNotExists('tasks', 'revisionCount', 'INTEGER DEFAULT 0'),
    addSqliteColumnIfNotExists('users', 'autoApproveReview', 'BOOLEAN DEFAULT 0'),
  ])

  // Run role rename migrations in parallel per table
  // All renames for the same table/column are independent of each other
  await Promise.all([
    // users table role renames
    renameSqliteRole('users', 'role', 'PhotographerAudio', 'PhotographerVideographerAudio'),
    renameSqliteRole('users', 'role', 'VideographerAudio', 'PhotographerVideographerAudio'),
    renameSqliteRole('users', 'role', 'EditorMedia', 'EditorVideo'),
    renameSqliteRole('users', 'role', 'EditorWebSocialMedia', 'EditorWebArticle'),
    // tasks table role renames
    renameSqliteRole('tasks', 'role', 'PhotographerAudio', 'PhotographerVideographerAudio'),
    renameSqliteRole('tasks', 'role', 'VideographerAudio', 'PhotographerVideographerAudio'),
    renameSqliteRole('tasks', 'role', 'EditorMedia', 'EditorVideo'),
    renameSqliteRole('tasks', 'role', 'EditorWebSocialMedia', 'EditorWebArticle'),
    // surat_tugas table role renames
    renameSqliteRole('surat_tugas', 'role', 'PhotographerAudio', 'PhotographerVideographerAudio'),
    renameSqliteRole('surat_tugas', 'role', 'VideographerAudio', 'PhotographerVideographerAudio'),
    renameSqliteRole('surat_tugas', 'role', 'EditorMedia', 'EditorVideo'),
    renameSqliteRole('surat_tugas', 'role', 'EditorWebSocialMedia', 'EditorWebArticle'),
  ])

  // Stage shift migrations — MUST be sequential (highest stage first to avoid conflicts)
  // But we can parallelize across different tables
  // Projects: sequential within table (3→4→5→6 must be in order)
  await shiftSqliteStage('projects', 'currentStage', 5, 6)
  await shiftSqliteStage('projects', 'currentStage', 4, 5)
  await shiftSqliteStage('projects', 'currentStage', 3, 4)

  // Tasks and surat_tugas: can run in parallel with each other
  await Promise.all([
    shiftSqliteStageWithCondition('tasks', 'stage', 3, 4, "role = 'Reviewer'"),
    shiftSqliteStageWithCondition('tasks', 'stage', 4, 5, "role IN ('PublisherWeb', 'PublisherSocialMedia')"),
    shiftSqliteStage('surat_tugas', 'stage', 4, 5),
    shiftSqliteStage('surat_tugas', 'stage', 3, 4),
  ])

  // === Version 5: Swap Review (stage 4→3) and Finalization/EditorTemplateSosialMedia (stage 3→4) ===
  // Role-conditional shifts are safe (no collision — different roles)
  await Promise.all([
    shiftSqliteStageWithCondition('tasks', 'stage', 4, 3, "role = 'Reviewer'"),
    shiftSqliteStageWithCondition('tasks', 'stage', 3, 4, "role = 'EditorTemplateSosialMedia'"),
    shiftSqliteStageWithCondition('surat_tugas', 'stage', 4, 3, "role = 'Reviewer'"),
    shiftSqliteStageWithCondition('surat_tugas', 'stage', 3, 4, "role = 'EditorTemplateSosialMedia'"),
  ])
  // Swap projects.currentStage 3↔4 using temp value 99 (sequential to avoid collision)
  await shiftSqliteStage('projects', 'currentStage', 3, 99) // 3 → 99 (temp)
  await shiftSqliteStage('projects', 'currentStage', 4, 3)  // 4 → 3
  await shiftSqliteStage('projects', 'currentStage', 99, 4) // 99 → 4

  // === Version 6: Pindahkan Editor (Template Sosial Media) dari Finalization
  // (Tahap 4) ke Pasca Produksi (Tahap 2), dengan dependency intra-stage:
  // Editor (Template Sosial Media) bekerja SETELAH Editor (Foto) selesai di
  // Tahap 2. Tahap 4 (Finalization) kini kosong dan auto-skip.
  //
  // HANYA migrasi project yang belum mencapai Tahap 3 (currentStage <= 2) agar
  // tidak mengganggu project yang sedang in-flight di Review (3) / Finalization (4).
  // Project di stage 5/6 sudah selesai EditorTemplateSosialMedia-nya (completed),
  // jadi tidak perlu dipindah. Project di stage 3/4 tetap mengikuti alur lama.
  await Promise.all([
    shiftSqliteStageWithCondition('tasks', 'stage', 4, 2,
      "role = 'EditorTemplateSosialMedia' AND projectId IN (SELECT id FROM projects WHERE currentStage IN (1, 2))"),
    shiftSqliteStageWithCondition('surat_tugas', 'stage', 4, 2,
      "role = 'EditorTemplateSosialMedia' AND projectId IN (SELECT id FROM projects WHERE currentStage IN (1, 2))"),
  ])
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

// === PostgreSQL sync — optimized with parallel execution ===
async function syncPostgres(): Promise<void> {
  // Run all column additions in parallel
  await Promise.all([
    // User table
    addPostgresColumnIfNotExists('users', 'notifWaEnabled', 'BOOLEAN DEFAULT true'),
    addPostgresColumnIfNotExists('users', 'notifEmailEnabled', 'BOOLEAN DEFAULT true'),
    // Settings table
    addPostgresColumnIfNotExists('settings', 'notifWaEnabled', 'BOOLEAN DEFAULT false'),
    addPostgresColumnIfNotExists('settings', 'notifWaToken', 'TEXT'),
    addPostgresColumnIfNotExists('settings', 'notifWaDeviceId', 'TEXT'),
    addPostgresColumnIfNotExists('settings', 'notifWaSenderNumber', 'TEXT'),
    addPostgresColumnIfNotExists('settings', 'notifEmailEnabled', 'BOOLEAN DEFAULT false'),
    addPostgresColumnIfNotExists('settings', 'notifEmailHost', 'TEXT'),
    addPostgresColumnIfNotExists('settings', 'notifEmailPort', 'INTEGER'),
    addPostgresColumnIfNotExists('settings', 'notifEmailUser', 'TEXT'),
    addPostgresColumnIfNotExists('settings', 'notifEmailPass', 'TEXT'),
    addPostgresColumnIfNotExists('settings', 'notifEmailFromName', 'TEXT'),
    // Projects table
    addPostgresColumnIfNotExists('projects', 'isFastTrack', 'BOOLEAN DEFAULT false'),
    addPostgresColumnIfNotExists('projects', 'isFastProduction', 'BOOLEAN DEFAULT false'),
    addPostgresColumnIfNotExists('projects', 'publicToken', 'TEXT UNIQUE'),
    addPostgresColumnIfNotExists('projects', 'documents', 'TEXT DEFAULT \'[]\''),
    // Tasks table
    addPostgresColumnIfNotExists('tasks', 'revisionCount', 'INTEGER DEFAULT 0'),
    addPostgresColumnIfNotExists('users', 'autoApproveReview', 'BOOLEAN DEFAULT false'),
  ])

  // Run role rename migrations in parallel
  await Promise.all([
    // users table
    renamePostgresRole('users', 'role', 'PhotographerAudio', 'PhotographerVideographerAudio'),
    renamePostgresRole('users', 'role', 'VideographerAudio', 'PhotographerVideographerAudio'),
    renamePostgresRole('users', 'role', 'EditorMedia', 'EditorVideo'),
    renamePostgresRole('users', 'role', 'EditorWebSocialMedia', 'EditorWebArticle'),
    // tasks table
    renamePostgresRole('tasks', 'role', 'PhotographerAudio', 'PhotographerVideographerAudio'),
    renamePostgresRole('tasks', 'role', 'VideographerAudio', 'PhotographerVideographerAudio'),
    renamePostgresRole('tasks', 'role', 'EditorMedia', 'EditorVideo'),
    renamePostgresRole('tasks', 'role', 'EditorWebSocialMedia', 'EditorWebArticle'),
    // surat_tugas table
    renamePostgresRole('surat_tugas', 'role', 'PhotographerAudio', 'PhotographerVideographerAudio'),
    renamePostgresRole('surat_tugas', 'role', 'VideographerAudio', 'PhotographerVideographerAudio'),
    renamePostgresRole('surat_tugas', 'role', 'EditorMedia', 'EditorVideo'),
    renamePostgresRole('surat_tugas', 'role', 'EditorWebSocialMedia', 'EditorWebArticle'),
  ])

  // Stage shift migrations — sequential within table, parallel across tables
  await shiftPostgresStage('projects', 'currentStage', 5, 6)
  await shiftPostgresStage('projects', 'currentStage', 4, 5)
  await shiftPostgresStage('projects', 'currentStage', 3, 4)

  await Promise.all([
    shiftPostgresStageWithCondition('tasks', 'stage', 3, 4, "role = 'Reviewer'"),
    shiftPostgresStageWithCondition('tasks', 'stage', 4, 5, "role IN ('PublisherWeb', 'PublisherSocialMedia')"),
    shiftPostgresStage('surat_tugas', 'stage', 4, 5),
    shiftPostgresStage('surat_tugas', 'stage', 3, 4),
  ])

  // === Version 5: Swap Review (stage 4→3) and Finalization/EditorTemplateSosialMedia (stage 3→4) ===
  // Role-conditional shifts are safe (no collision — different roles)
  await Promise.all([
    shiftPostgresStageWithCondition('tasks', 'stage', 4, 3, "role = 'Reviewer'"),
    shiftPostgresStageWithCondition('tasks', 'stage', 3, 4, "role = 'EditorTemplateSosialMedia'"),
    shiftPostgresStageWithCondition('surat_tugas', 'stage', 4, 3, "role = 'Reviewer'"),
    shiftPostgresStageWithCondition('surat_tugas', 'stage', 3, 4, "role = 'EditorTemplateSosialMedia'"),
  ])
  // Swap projects.currentStage 3↔4 using temp value 99 (sequential to avoid collision)
  await shiftPostgresStage('projects', 'currentStage', 3, 99) // 3 → 99 (temp)
  await shiftPostgresStage('projects', 'currentStage', 4, 3)  // 4 → 3
  await shiftPostgresStage('projects', 'currentStage', 99, 4) // 99 → 4

  // === Version 6: Pindahkan Editor (Template Sosial Media) dari Finalization
  // (Tahap 4) ke Pasca Produksi (Tahap 2). HANYA untuk project currentStage <= 2
  // (lihat penjelasan lengkap di syncSqlite Version 6).
  await Promise.all([
    shiftPostgresStageWithCondition('tasks', 'stage', 4, 2,
      "role = 'EditorTemplateSosialMedia' AND projectId IN (SELECT id FROM projects WHERE currentStage IN (1, 2))"),
    shiftPostgresStageWithCondition('surat_tugas', 'stage', 4, 2,
      "role = 'EditorTemplateSosialMedia' AND projectId IN (SELECT id FROM projects WHERE currentStage IN (1, 2))"),
  ])
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

// === Stage shift helpers ===

async function shiftSqliteStage(
  table: string,
  column: string,
  oldStage: number,
  newStage: number
): Promise<void> {
  try {
    const result = await db.$executeRawUnsafe(
      `UPDATE "${table}" SET "${column}" = ${newStage} WHERE "${column}" = ${oldStage}`
    )
    if (result > 0) {
      console.log(`[DB Sync SQLite] Shifted stage ${oldStage} → ${newStage} in ${table}.${column} (${result} rows)`)
    }
  } catch (error) {
    console.error(`[DB Sync SQLite] Failed to shift stage ${oldStage} → ${newStage} in ${table}.${column}:`, error)
  }
}

async function shiftSqliteStageWithCondition(
  table: string,
  column: string,
  oldStage: number,
  newStage: number,
  condition: string
): Promise<void> {
  try {
    const result = await db.$executeRawUnsafe(
      `UPDATE "${table}" SET "${column}" = ${newStage} WHERE "${column}" = ${oldStage} AND ${condition}`
    )
    if (result > 0) {
      console.log(`[DB Sync SQLite] Shifted stage ${oldStage} → ${newStage} in ${table}.${column} WHERE ${condition} (${result} rows)`)
    }
  } catch (error) {
    console.error(`[DB Sync SQLite] Failed to shift stage ${oldStage} → ${newStage} in ${table}.${column} WHERE ${condition}:`, error)
  }
}

async function shiftPostgresStage(
  table: string,
  column: string,
  oldStage: number,
  newStage: number
): Promise<void> {
  try {
    const result = await db.$executeRawUnsafe(
      `UPDATE "${table}" SET "${column}" = ${newStage} WHERE "${column}" = ${oldStage}`
    )
    if (result > 0) {
      console.log(`[DB Sync Postgres] Shifted stage ${oldStage} → ${newStage} in ${table}.${column} (${result} rows)`)
    }
  } catch (error) {
    console.error(`[DB Sync Postgres] Failed to shift stage ${oldStage} → ${newStage} in ${table}.${column}:`, error)
  }
}

async function shiftPostgresStageWithCondition(
  table: string,
  column: string,
  oldStage: number,
  newStage: number,
  condition: string
): Promise<void> {
  try {
    const result = await db.$executeRawUnsafe(
      `UPDATE "${table}" SET "${column}" = ${newStage} WHERE "${column}" = ${oldStage} AND ${condition}`
    )
    if (result > 0) {
      console.log(`[DB Sync Postgres] Shifted stage ${oldStage} → ${newStage} in ${table}.${column} WHERE ${condition} (${result} rows)`)
    }
  } catch (error) {
    console.error(`[DB Sync Postgres] Failed to shift stage ${oldStage} → ${newStage} in ${table}.${column} WHERE ${condition}:`, error)
  }
}
