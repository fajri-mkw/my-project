import { NextResponse } from 'next/server'
import { getLibsql } from '@/lib/libsql-client'

// One-shot migration: Add waProvider column to settings table on production D1.
// This is the production equivalent of db-sync Version 14 (which only runs on
// local dev SQLite — on D1, ensureSchemaSync is skipped because schema is
// applied manually via wrangler).
//
// The waProvider column stores 'fonnte' (default, paid) or 'callmebot' (free).
// Idempotent — safe to run multiple times (no-op if column already exists).
//
// Trigger manually via: curl https://app.pushakin-flows.workers.dev/api/migrate-wa-provider
export async function GET() {
  try {
    const client = getLibsql()
    try {
      await client.execute({
        sql: `ALTER TABLE "settings" ADD COLUMN "waProvider" TEXT`,
        args: [],
      })
      return NextResponse.json({
        success: true,
        message: 'Column waProvider added to settings table',
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('already exists') || msg.includes('duplicate')) {
        return NextResponse.json({
          success: true,
          message: 'Column waProvider already exists (skipped)',
        })
      }
      throw err
    }
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
