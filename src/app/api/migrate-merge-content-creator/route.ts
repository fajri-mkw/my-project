import { NextResponse } from 'next/server'
import { getLibsql } from '@/lib/libsql-client'

// One-shot migration: Merge ContentCreator role INTO PhotographerVideographerAudio.
// This is the production equivalent of db-sync Version 13 (which only runs
// on local dev SQLite — on D1, ensureSchemaSync is skipped because schema
// is applied manually via wrangler).
//
// Renames all rows with role = 'ContentCreator' to 'PhotographerVideographerAudio'
// in users, tasks, and surat_tugas tables. Idempotent — safe to run multiple
// times (no-op if no ContentCreator rows remain).
//
// Trigger manually via: curl https://app.pushakin-flows.workers.dev/api/migrate-merge-content-creator
export async function GET() {
  try {
    const client = getLibsql()
    const results: Record<string, number> = {}

    const tables = ['users', 'tasks', 'surat_tugas'] as const
    for (const table of tables) {
      try {
        const res = await client.execute({
          sql: `UPDATE "${table}" SET role = 'PhotographerVideographerAudio' WHERE role = 'ContentCreator'`,
          args: [],
        })
        results[table] = Number(res.meta?.changes ?? 0)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // If table doesn't exist or other error, log and continue
        console.error(`[migrate-merge-content-creator] ${table} failed:`, msg)
        results[table] = -1
      }
    }

    return NextResponse.json({
      success: true,
      message: 'ContentCreator → PhotographerVideographerAudio migration executed',
      renamedRows: results,
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}
