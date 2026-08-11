// Auto-migration utility for Pushakin Flows
// Ensures database schema matches Prisma schema by adding missing columns
// Supports both PostgreSQL (Vercel/Neon) and SQLite (local dev)
//
// PERFORMANCE: Uses a version-based check — after all migrations succeed,
// a version number is stored in the settings table. On subsequent cold starts,
// only 1 query is needed (version check) instead of 26+ migration queries.
//
// CRITICAL FIX (Turso quota exhaustion root cause):
//   The previous version used Prisma's db.settings.findUnique() for the
//   version check. On Cloudflare Workers, Prisma's WASM engine can fail
//   on cold starts (transient initialization errors). When the findUnique
//   threw, the catch block returned false → performSchemaSync() ran ALL
//   migrations including renameSqliteRole() which does table-scanning
//   UPDATEs. Each migration run wrote thousands of rows (rows scanned by
//   UPDATE). With frequent cold starts × 22 Prisma-importing routes, this
//   exhausted the Turso free plan's 10M rows-written/month quota.
//
//   Fix: rewrite isSchemaVersionCurrent() & setSchemaVersion() to use
//   @libsql/client directly (same pattern as maintenance-check.ts and
//   libsql-client.ts). libsql is lightweight (no WASM, no Prisma overhead)
//   and doesn't fail on cold starts. Additionally, if the version check
//   query DOES fail, we now assume the schema is current (skip migrations)
//   rather than re-running them — the version is almost certainly already
//   set from a previous successful sync.

import { db } from './db'
import { getLibsql, bind } from './libsql-client'

// Increment this when adding new migrations
const SCHEMA_VERSION = 10

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
    const status = await isSchemaVersionCurrent()
    if (status === 'current' || status === 'unknown') {
      // 'current' → version matches, skip migrations.
      // 'unknown' → version check failed (transient error). Skip migrations
      //   to avoid burning write quota on no-op table-scanning UPDATEs.
      //   The schema is almost certainly already current.
      syncPerformed = true
      if (status === 'current') {
        console.log(`[DB Sync] Schema version ${SCHEMA_VERSION} already applied — skipping migrations`)
      } else {
        console.warn(`[DB Sync] Version check inconclusive — skipping migrations to conserve write quota`)
      }
      return true
    }

    // status === 'outdated' → run migrations
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
 *
 * IMPORTANT: Uses @libsql/client directly (NOT Prisma) to avoid WASM
 * cold-start failures that triggered spurious migration runs and
 * exhausted the Turso write quota.
 *
 * Returns 'current' if version matches, 'outdated' if version differs
 * (needs migration), or 'unknown' if the query failed (transient error).
 * On 'unknown', we SKIP migrations to avoid burning write quota on
 * table-scanning UPDATEs that don't actually change anything.
 */
async function isSchemaVersionCurrent(): Promise<'current' | 'outdated' | 'unknown'> {
  try {
    const client = getLibsql()
    const result = await client.execute({
      sql: `SELECT maintenanceMessage FROM settings WHERE id = ? LIMIT 1`,
      args: [bind('schema_version')],
    })
    if (result.rows.length === 0) {
      // No schema_version row yet — this is the FIRST run, need migrations
      return 'outdated'
    }
    const stored = String(result.rows[0]?.maintenanceMessage ?? '')
    return stored === String(SCHEMA_VERSION) ? 'current' : 'outdated'
  } catch (error) {
    // Transient error (DB timeout, connection issue, etc.).
    // DO NOT trigger migrations — the schema is almost certainly already
    // current from a previous successful sync. Re-running migrations
    // would waste write quota on no-op table-scanning UPDATEs.
    console.warn('[DB Sync] Version check failed (assuming current):', error instanceof Error ? error.message : String(error))
    return 'unknown'
  }
}

/**
 * Store the current schema version after successful migration.
 * Uses @libsql/client directly (NOT Prisma) for the same cold-start
 * reliability reason as isSchemaVersionCurrent().
 */
async function setSchemaVersion(version: number): Promise<void> {
  try {
    const client = getLibsql()
    const ts = Date.now()
    await client.execute({
      sql: `INSERT INTO settings (id, maintenanceMessage, updatedAt)
            VALUES (?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              maintenanceMessage = excluded.maintenanceMessage,
              updatedAt = excluded.updatedAt`,
      args: [bind('schema_version'), bind(String(version)), bind(ts)],
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
    addSqliteColumnIfNotExists('projects', 'enableFotoEditor', 'BOOLEAN DEFAULT 1'),
    addSqliteColumnIfNotExists('projects', 'enableTemplateEditor', 'BOOLEAN DEFAULT 1'),
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

  // === Version 7: Hilangkan Tahap 4 (Finalization) yang kosong, renumber
  // Tahap 5 (Publikasi) → 4, Tahap 6 (Selesai) → 5. Setelah Task 18 (v6),
  // EditorTemplateSosialMedia sudah bekerja di Tahap 2 dan Tahap 4 (Finalization)
  // kosong (auto-skip). Maka Tahap 4 dihapus dari penomoran dan Publikasi/Selesai
  // digeser ke bawah agar nomor tahap berurutan (1-5).
  //
  // Migrasi: geser stage 5→4 LALU 6→5 (urutan PENTING: stage terendah dulu
  // agar tidak kolisi). Jika 6→5 dilakukan dulu, row yang pindah dari 6 ke 5
  // akan ikut tergeser lagi ke 4 pada langkah 5→4. Dengan 5→4 dulu, stage 5
  // menjadi kosong, lalu 6→5 hanya memindahkan row asli stage 6.
  // Berlaku untuk projects.currentStage, tasks.stage, surat_tugas.stage.
  await shiftSqliteStage('projects', 'currentStage', 5, 4)
  await shiftSqliteStage('projects', 'currentStage', 6, 5)
  await Promise.all([
    shiftSqliteStage('tasks', 'stage', 5, 4),
    shiftSqliteStage('tasks', 'stage', 6, 5),
    shiftSqliteStage('surat_tugas', 'stage', 5, 4),
    shiftSqliteStage('surat_tugas', 'stage', 6, 5),
  ])

  // === Version 9: Create external_links table for External App Links feature ===
  // Super Admin can add external app links (online gallery, photo editor, etc.)
  // that appear in the left sidebar for all users and open in a new tab.
  await createSqliteTableIfNotExists('external_links', `(
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "icon" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT 1,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  )`)

  // === Version 10: Repair corrupted task.stage & surat_tugas.stage & project.currentStage ===
  // Bug historis: V4 asli (commit b364722, 25 Mei 2026 09:33) bersifat UNCONDITIONAL
  // dan berjalan beberapa kali saat cold start karena SCHEMA_VERSION tracking belum
  // ada (baru ditambahkan di commit cdf79c3, 25 Mei 2026 12:12). Setiap run V4
  // menggeser: shift 4→5 LALU shift 3→4 (unconditional). Akibatnya:
  //   - Run 1: Publisher 4→5, Reviewer 3→4
  //   - Run 2: Reviewer (yg ada di 4) → 5
  //   - Run 3+: tidak ada perubahan (reviewer & publisher sudah di 5)
  // Hasil akhir: Reviewer nyangkut di stage 5 (seharusnya 3), Publisher di stage 5
  // (seharusnya 4). V5 (Reviewer 4→3) tidak menangkap Reviewer di 5. V7 (5→4
  // unconditional) seharusnya mengembalikan ke 4 tetapi (a) tidak menangani Reviewer
  // yg seharusnya 3, dan (b) rupanya tidak tereksekusi konsisten di production karena
  // SCHEMA_VERSION tracking menganggap migration sudah beres.
  //
  // Gejala user: petugas "Fajrianor" (Reviewer) muncul di tahap "Publikasi" pada
  // beberapa project karena UI mengelompokkan task by t.stage — Reviewer (stage 5)
  // dan Publisher (stage 5) tampil di kolom yang sama.
  //
  // Fix: clamp setiap task/surat_tugas ke stage kanoniknya sesuai ROLE_CONFIG, dan
  // clamp project.currentStage 6 → 5 (Selesai) karena STAGES tidak mendefinisikan 6.
  // Role-conditional + idempoten: aman dijalankan berulang (tidak ada row yang match
  // setelah perbaikan pertama).
  await Promise.all([
    // Reviewer: kembalikan ke stage 3 (dari stage 4 atau 5)
    shiftSqliteStageWithCondition('tasks', 'stage', 5, 3, "role = 'Reviewer'"),
    shiftSqliteStageWithCondition('tasks', 'stage', 4, 3, "role = 'Reviewer'"),
    shiftSqliteStageWithCondition('surat_tugas', 'stage', 5, 3, "role = 'Reviewer'"),
    shiftSqliteStageWithCondition('surat_tugas', 'stage', 4, 3, "role = 'Reviewer'"),
    // Publisher: kembalikan ke stage 4 (dari stage 5)
    shiftSqliteStageWithCondition('tasks', 'stage', 5, 4, "role IN ('PublisherWeb', 'PublisherSocialMedia')"),
    shiftSqliteStageWithCondition('surat_tugas', 'stage', 5, 4, "role IN ('PublisherWeb', 'PublisherSocialMedia')"),
    // EditorTemplateSosialMedia: kembalikan ke stage 2 (dari stage 4). V6 hanya
    // memigrasi project dgn currentStage<=2, jadi project in-flight/completed
    // saat V6 jalan masih punya EditorTemplateSosialMedia di stage 4 (Finalization
    // lama). Sesuai ROLE_CONFIG, rolenya harus di stage 2 (Pasca Produksi).
    shiftSqliteStageWithCondition('tasks', 'stage', 4, 2, "role = 'EditorTemplateSosialMedia'"),
    shiftSqliteStageWithCondition('surat_tugas', 'stage', 4, 2, "role = 'EditorTemplateSosialMedia'"),
  ])
  // Clamp project.currentStage 6 → 5 (Selesai). Project complete = 5 (Selesai).
  await shiftSqliteStage('projects', 'currentStage', 6, 5)
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

async function createSqliteTableIfNotExists(
  table: string,
  tableDef: string
): Promise<void> {
  try {
    // PRAGMA table_list returns existing tables; checking with table_info also works
    const result = await db.$queryRawUnsafe(
      `PRAGMA table_info("${table}")`
    ) as Array<{ name: string }>

    if (!result || result.length === 0) {
      console.log(`[DB Sync SQLite] Creating table ${table}`)
      await db.$executeRawUnsafe(
        `CREATE TABLE IF NOT EXISTS "${table}" ${tableDef}`
      )
      console.log(`[DB Sync SQLite] Created table ${table}`)
    }
  } catch (error) {
    console.error(`[DB Sync SQLite] Failed to create table ${table}:`, error)
    // Non-fatal — Prisma queries will surface the real error if table is missing
  }
}

async function createPostgresTableIfNotExists(
  table: string,
  tableDef: string
): Promise<void> {
  try {
    const result = await db.$queryRawUnsafe(
      `SELECT table_name FROM information_schema.tables
       WHERE table_name = '${table}' LIMIT 1`
    ) as Array<{ table_name: string }>

    if (!result || result.length === 0) {
      console.log(`[DB Sync Postgres] Creating table ${table}`)
      await db.$executeRawUnsafe(
        `CREATE TABLE IF NOT EXISTS "${table}" ${tableDef}`
      )
      console.log(`[DB Sync Postgres] Created table ${table}`)
    }
  } catch (error) {
    console.error(`[DB Sync Postgres] Failed to create table ${table}:`, error)
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
    addPostgresColumnIfNotExists('projects', 'enableFotoEditor', 'BOOLEAN DEFAULT true'),
    addPostgresColumnIfNotExists('projects', 'enableTemplateEditor', 'BOOLEAN DEFAULT true'),
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

  // === Version 7: Hilangkan Tahap 4 (Finalization) yang kosong, renumber
  // Tahap 5 (Publikasi) → 4, Tahap 6 (Selesai) → 5. (Lihat syncSqlite v7.)
  // Urutan: 5→4 DULU, lalu 6→5, agar tidak kolisi.
  await shiftPostgresStage('projects', 'currentStage', 5, 4)
  await shiftPostgresStage('projects', 'currentStage', 6, 5)
  await Promise.all([
    shiftPostgresStage('tasks', 'stage', 5, 4),
    shiftPostgresStage('tasks', 'stage', 6, 5),
    shiftPostgresStage('surat_tugas', 'stage', 5, 4),
    shiftPostgresStage('surat_tugas', 'stage', 6, 5),
  ])

  // === Version 9: Create external_links table for External App Links feature ===
  // (See syncSqlite Version 9 for details.)
  await createPostgresTableIfNotExists('external_links', `(
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "icon" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
  )`)

  // === Version 10: Repair corrupted task.stage & surat_tugas.stage & project.currentStage ===
  // (See syncSqlite Version 10 for full explanation of the historical V4 bug.)
  // Gejala: Reviewer (mis. Fajrianor) tampil di tahap Publikasi karena stage-nya
  // terkorupsi ke 5 (seharusnya 3), sama dengan Publisher (seharusnya 4).
  await Promise.all([
    // Reviewer: kembalikan ke stage 3 (dari stage 4 atau 5)
    shiftPostgresStageWithCondition('tasks', 'stage', 5, 3, "role = 'Reviewer'"),
    shiftPostgresStageWithCondition('tasks', 'stage', 4, 3, "role = 'Reviewer'"),
    shiftPostgresStageWithCondition('surat_tugas', 'stage', 5, 3, "role = 'Reviewer'"),
    shiftPostgresStageWithCondition('surat_tugas', 'stage', 4, 3, "role = 'Reviewer'"),
    // Publisher: kembalikan ke stage 4 (dari stage 5)
    shiftPostgresStageWithCondition('tasks', 'stage', 5, 4, "role IN ('PublisherWeb', 'PublisherSocialMedia')"),
    shiftPostgresStageWithCondition('surat_tugas', 'stage', 5, 4, "role IN ('PublisherWeb', 'PublisherSocialMedia')"),
    // EditorTemplateSosialMedia: kembalikan ke stage 2 (dari stage 4). (See syncSqlite V10.)
    shiftPostgresStageWithCondition('tasks', 'stage', 4, 2, "role = 'EditorTemplateSosialMedia'"),
    shiftPostgresStageWithCondition('surat_tugas', 'stage', 4, 2, "role = 'EditorTemplateSosialMedia'"),
  ])
  // Clamp project.currentStage 6 → 5 (Selesai).
  await shiftPostgresStage('projects', 'currentStage', 6, 5)
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
