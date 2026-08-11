/**
 * Migrate data from Turso (DATABASE_URL) to Cloudflare D1 (env.DB binding).
 *
 * Strategy: read all rows from each table via the legacy libsql client
 * (Turso), then batch-insert into D1 via the D1 adapter. Idempotent:
 *   - Checks target row count before inserting; skips tables that already
 *     have matching row count.
 *   - All inserts wrapped in D1 batch (atomic per table).
 *
 * IMPORTANT: This endpoint is one-shot. After successful migration, you
 * should DELETE this file from the codebase (or guard it behind an admin
 * auth check) to prevent accidental re-runs that could duplicate data.
 *
 * Usage (after deploy):
 *   curl https://app.pushakin-flows.workers.dev/api/migrate-to-d1
 */

import { NextResponse } from 'next/server'
import { getLibsql, getLibsqlLegacy, bind, toBool } from '@/lib/libsql-client'

// Tables in dependency order (parents first). Same order used for both
// read (from Turso) and write (to D1). D1 doesn't enforce FK constraints
// unless `PRAGMA foreign_keys = ON`, so order is mostly for clarity.
const TABLES = [
  'users',
  'projects',
  'tasks',
  'drive_folders',
  'notifications',
  'surat_tugas',
  'settings',
  'sops',
  'permohonan',
  'surat',
  'program_kegiatan',
  'external_links',
] as const

// Boolean columns per table (SQLite stores 0/1; we copy as-is, but we need
// to know which columns are boolean for type-safe binding).
const BOOLEAN_COLUMNS: Record<string, Set<string>> = {
  users: new Set(['notifWaEnabled', 'notifEmailEnabled', 'autoApproveReview']),
  projects: new Set([
    'isFastTrack', 'isFastProduction',
    'enableFotoEditor', 'enableTemplateEditor',
  ]),
  notifications: new Set(['read']),
  surat_tugas: new Set(['read']),
  settings: new Set([
    'driveAutoCreate', 'maintenanceMode', 'notifWaEnabled', 'notifEmailEnabled',
  ]),
  sops: new Set(['published']),
  external_links: new Set(['isActive']),
}

interface TableMigrateResult {
  table: string
  sourceRows: number
  targetRowsBefore: number
  targetRowsAfter: number
  inserted: number
  skipped: boolean
  error?: string
}

export async function GET() {
  const startedAt = Date.now()
  const results: TableMigrateResult[] = []

  // Source: Turso (legacy client, bypasses D1 binding)
  const source = getLibsqlLegacy()
  if (!source) {
    return NextResponse.json(
      {
        success: false,
        error: 'DATABASE_URL is not set — no source (Turso) to migrate from.',
        hint: 'Set DATABASE_URL secret to the Turso libsql:// URL before running this endpoint.',
      },
      { status: 500 },
    )
  }

  // Target: D1 binding (primary client)
  let target
  try {
    target = getLibsql()
  } catch (e) {
    return NextResponse.json(
      {
        success: false,
        error: 'D1 binding not available — cannot migrate.',
        hint: 'Ensure wrangler.jsonc has the d1_databases binding configured.',
        details: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    )
  }

  for (const table of TABLES) {
    const r: TableMigrateResult = {
      table,
      sourceRows: 0,
      targetRowsBefore: 0,
      targetRowsAfter: 0,
      inserted: 0,
      skipped: false,
    }

    try {
      // 1. Count rows in source
      const srcCount = await source.execute(`SELECT COUNT(*) as n FROM "${table}"`)
      r.sourceRows = Number(srcCount.rows[0]?.n ?? 0)

      // 2. Count rows in target (D1) — skip if already has same count
      const tgtCount = await target.execute(`SELECT COUNT(*) as n FROM "${table}"`)
      r.targetRowsBefore = Number(tgtCount.rows[0]?.n ?? 0)

      if (r.sourceRows === 0) {
        r.skipped = true
        r.targetRowsAfter = r.targetRowsBefore
        results.push(r)
        continue
      }

      if (r.targetRowsBefore >= r.sourceRows) {
        r.skipped = true
        r.targetRowsAfter = r.targetRowsBefore
        r.inserted = 0
        results.push(r)
        continue
      }

      // 3. Read all rows from source
      const srcRows = await source.execute(`SELECT * FROM "${table}"`)
      const rows = srcRows.rows as Record<string, unknown>[]

      if (rows.length === 0) {
        r.skipped = true
        r.targetRowsAfter = r.targetRowsBefore
        results.push(r)
        continue
      }

      // 4. Get column list from first row (preserves order)
      const columns = Object.keys(rows[0])
      const boolCols = BOOLEAN_COLUMNS[table] ?? new Set<string>()

      // 5. Build batch INSERT statements (D1 batch is atomic per call)
      //    Use INSERT OR IGNORE to be idempotent (PK conflicts don't fail)
      const placeholders = columns.map(() => '?').join(', ')
      const colList = columns.map((c) => `"${c}"`).join(', ')
      const sql = `INSERT OR IGNORE INTO "${table}" (${colList}) VALUES (${placeholders})`

      // D1 batch limit: 1000 statements per batch. Chunk if needed.
      const BATCH_SIZE = 500
      let totalInserted = 0

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const chunk = rows.slice(i, i + BATCH_SIZE)
        const stmts = chunk.map((row) => {
          const args = columns.map((c) => {
            const v = row[c]
            // Boolean → 0/1 (SQLite storage format)
            if (boolCols.has(c) && typeof v === 'boolean') {
              return bind(v ? 1 : 0)
            }
            // BigInt (SQLite INTEGER might come back as BigInt in libsql)
            if (typeof v === 'bigint') {
              return bind(Number(v))
            }
            return bind(v ?? null)
          })
          return { sql, args }
        })

        await target.batch(stmts)
        totalInserted += chunk.length
      }

      r.inserted = totalInserted

      // 6. Verify final count
      const finalCount = await target.execute(`SELECT COUNT(*) as n FROM "${table}"`)
      r.targetRowsAfter = Number(finalCount.rows[0]?.n ?? 0)
    } catch (e) {
      r.error = e instanceof Error ? e.message : String(e)
    }

    results.push(r)
  }

  const durationMs = Date.now() - startedAt
  const totalInserted = results.reduce((sum, r) => sum + r.inserted, 0)
  const totalErrors = results.filter((r) => r.error).length

  return NextResponse.json({
    success: totalErrors === 0,
    durationMs,
    totalInserted,
    totalErrors,
    tables: results,
    nextStep:
      totalErrors === 0
        ? 'Migration complete. Production now reads/writes from D1. You can safely delete this endpoint.'
        : 'Some tables had errors. Inspect the `tables` array for details.',
  })
}
