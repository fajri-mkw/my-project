import { NextResponse } from 'next/server'
import { getLibsql } from '@/lib/libsql-client'

/**
 * GET /api/migrate-d1-indexes
 *
 * One-shot migration endpoint to add performance indexes to the D1 database
 * to keep row-reads/writes under the free-tier daily limits (5M reads,
 * 100K writes) being enforced from September 1, 2026.
 *
 * Idempotent: uses `CREATE INDEX IF NOT EXISTS` so it's safe to call multiple
 * times. After successful run, the indexes exist and queries that use them
 * will be dramatically faster (log(n) index seek vs full table scan).
 *
 * Indexes added:
 *   - tasks(projectId, status) — used by /api/projects/repair Pass 1 subquery
 *     "WHERE projectId = ? AND status != 'completed'". Single-column index
 *     on projectId requires scanning all tasks for that project then
 *     filtering by status; composite lets D1 seek directly. Critical because
 *     this query runs on every Admin/Manager dashboard load.
 *   - tasks(projectId, stage) — used by /api/projects/repair Pass 2
 *     "WHERE projectId = ? AND stage = ?". Same optimization as above.
 *
 * THIS ENDPOINT CAN BE DELETED AFTER THE FIRST SUCCESSFUL RUN ON PRODUCTION.
 */
export async function GET() {
  const results: Array<{ step: string; status: 'ok' | 'skipped' | 'error'; detail?: string }> = []

  const indexesToCreate: Array<{ name: string; sql: string; purpose: string }> = [
    {
      name: 'idx_tasks_projectId_status',
      sql: `CREATE INDEX IF NOT EXISTS "idx_tasks_projectId_status" ON "tasks" ("projectId", "status")`,
      purpose: 'Speeds up /api/projects/repair Pass 1 subquery (projectId + status filter)',
    },
    {
      name: 'idx_tasks_projectId_stage',
      sql: `CREATE INDEX IF NOT EXISTS "idx_tasks_projectId_stage" ON "tasks" ("projectId", "stage")`,
      purpose: 'Speeds up /api/projects/repair Pass 2 (projectId + stage filter)',
    },
  ]

  try {
    const client = getLibsql()

    for (const { name, sql, purpose } of indexesToCreate) {
      try {
        await client.execute({ sql, args: [] })
        results.push({ step: `CREATE INDEX ${name}`, status: 'ok', detail: purpose })
      } catch (idxErr) {
        const msg = idxErr instanceof Error ? idxErr.message : String(idxErr)
        if (msg.includes('already exists') || msg.includes('duplicate')) {
          results.push({ step: `CREATE INDEX ${name}`, status: 'skipped', detail: 'already exists' })
        } else {
          results.push({ step: `CREATE INDEX ${name}`, status: 'error', detail: msg })
        }
      }
    }

    // Verify indexes exist
    try {
      const verify = await client.execute({
        sql: `SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_tasks_%'`,
        args: [],
      })
      const indexNames = verify.rows.map((r) => String((r as Record<string, unknown>).name ?? ''))
      results.push({
        step: 'VERIFY indexes',
        status: 'ok',
        detail: `Found indexes: ${indexNames.join(', ') || '(none)'}`,
      })
    } catch (verifyErr) {
      results.push({
        step: 'VERIFY indexes',
        status: 'error',
        detail: verifyErr instanceof Error ? verifyErr.message : String(verifyErr),
      })
    }

    const allOk = results.every(r => r.status !== 'error')
    return NextResponse.json({
      success: allOk,
      message: allOk
        ? 'Indexes created successfully. Repair queries will now use index seeks instead of full table scans.'
        : 'Migration completed with errors — see results for details.',
      results,
    }, { status: allOk ? 200 : 500 })
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: 'Migration failed unexpectedly',
      results,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 })
  }
}
