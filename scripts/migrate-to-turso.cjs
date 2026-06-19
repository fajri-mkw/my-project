/**
 * Migrate local SQLite database to Turso (libSQL).
 *
 * Idempotent: safe to re-run (skips existing schema, replaces data).
 *
 * Usage:
 *   TURSO_DB_URL=libsql://... TURSO_DB_TOKEN=... node scripts/migrate-to-turso.cjs
 */

const path = require('path')
const Database = require('better-sqlite3')

const TURSO_URL = process.env.TURSO_DB_URL
const TURSO_TOKEN = process.env.TURSO_DB_TOKEN

if (!TURSO_URL || !TURSO_TOKEN) {
  console.error('ERROR: Set TURSO_DB_URL and TURSO_DB_TOKEN env vars')
  process.exit(1)
}

async function main() {
  const { createClient } = require('@libsql/client')

  const local = new Database(path.join(__dirname, '..', 'db', 'custom.db'), {
    readonly: true,
  })
  const turso = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN })

  // Disable FK checks during migration (we'll insert in alphabetical order,
  // which violates FK constraints). Re-enabled at the end.
  await turso.execute('PRAGMA foreign_keys = OFF')

  // 1. Get all user tables
  const tables = local
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type='table'
         AND name NOT LIKE 'sqlite_%'
         AND name NOT LIKE '_prisma%'
       ORDER BY name`
    )
    .all()
    .map((r) => r.name)

  console.log(`Tables: ${tables.join(', ')}`)

  // 2. Apply schema (idempotent — use IF NOT EXISTS)
  console.log('\n=== Schema (idempotent) ===')
  const schemaRows = local
    .prepare(
      `SELECT sql FROM sqlite_master
       WHERE type IN ('table', 'index')
         AND sql IS NOT NULL
         AND name NOT LIKE 'sqlite_%'
         AND name NOT LIKE '_prisma%'`
    )
    .all()

  let schemaApplied = 0
  let schemaSkipped = 0
  for (const { sql } of schemaRows) {
    // Inject IF NOT EXISTS for idempotency
    const idempotentSql = sql
      .replace(/^CREATE TABLE/i, 'CREATE TABLE IF NOT EXISTS')
      .replace(/^CREATE UNIQUE INDEX/i, 'CREATE UNIQUE INDEX IF NOT EXISTS')
      .replace(/^CREATE INDEX/i, 'CREATE INDEX IF NOT EXISTS')
    try {
      await turso.execute(idempotentSql)
      schemaApplied++
    } catch (e) {
      schemaSkipped++
      console.error(`  FAIL: ${e.message.slice(0, 100)}`)
    }
  }
  console.log(`  Applied: ${schemaApplied}, Skipped/Failed: ${schemaSkipped}`)

  // 3. Copy data — order tables to satisfy FK constraints where possible.
  // With foreign_keys=OFF, order doesn't matter, but we still prefer a sane order.
  const orderedTables = [
    'users',
    'settings',
    'permohonan',
    'program_kegiatan',
    'surat',
    'projects',
    'drive_folders',
    'notifications',
    'sops',
    'surat_tugas',
    'tasks',
  ].filter((t) => tables.includes(t))

  console.log('\n=== Copying data ===')
  let totalRows = 0
  for (const table of orderedTables) {
    const rows = local.prepare(`SELECT * FROM "${table}"`).all()
    if (rows.length === 0) {
      console.log(`  ${table}: 0 rows (skip)`)
      continue
    }

    // Clear existing data (idempotent re-run)
    await turso.execute(`DELETE FROM "${table}"`)

    const columns = Object.keys(rows[0])
    const placeholders = columns.map(() => '?').join(', ')
    const colList = columns.map((c) => `"${c}"`).join(', ')
    const insertSql = `INSERT INTO "${table}" (${colList}) VALUES (${placeholders})`

    const BATCH = 100
    let inserted = 0
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH)
      const stmts = chunk.map((row) => ({
        sql: insertSql,
        args: columns.map((c) => {
          const v = row[c]
          if (v instanceof Date) return v.toISOString()
          return v
        }),
      }))
      await turso.batch(stmts, 'write')
      inserted += chunk.length
    }
    totalRows += rows.length
    console.log(`  ${table}: ${inserted} rows inserted`)
  }

  // 4. Verify
  console.log('\n=== Verification ===')
  let allOk = true
  for (const table of orderedTables) {
    const localCount = local.prepare(`SELECT COUNT(*) as c FROM "${table}"`).get().c
    const tursoResult = await turso.execute(`SELECT COUNT(*) as c FROM "${table}"`)
    const tursoCount = Number(tursoResult.rows[0].c)
    const ok = localCount === tursoCount
    if (!ok) allOk = false
    console.log(`  ${table}: local=${localCount} turso=${tursoCount} [${ok ? 'OK' : 'MISMATCH'}]`)
  }

  // Re-enable FK
  await turso.execute('PRAGMA foreign_keys = ON')

  console.log(`\nTotal rows migrated: ${totalRows}`)
  console.log(allOk ? 'Migration SUCCESS.' : 'Migration COMPLETED WITH MISMATCHES.')
  local.close()
}

main().catch((e) => {
  console.error('Migration failed:', e)
  process.exit(1)
})
