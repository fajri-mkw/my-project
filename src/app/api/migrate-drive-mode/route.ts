import { NextResponse } from 'next/server'
import { getLibsql, bind } from '@/lib/libsql-client'

/**
 * GET /api/migrate-drive-mode
 *
 * One-shot migration endpoint to add `driveMode` + `driveFolderId` columns to
 * the `settings` table on Cloudflare D1, bypassing Prisma's WASM client
 * (which silently fails on PRAGMA/ALTER TABLE on cold starts — root cause of
 * the schema sync migration not running for v11).
 *
 * Idempotent: checks PRAGMA table_info first; only adds columns if missing.
 * Safe to call multiple times. After successful run, the regular schema sync
 * will set the version to 11 and skip this migration on future cold starts.
 *
 * Once the columns exist on D1, the libsql-based /api/settings GET will work
 * (it SELECTs driveMode + driveFolderId).
 *
 * THIS ENDPOINT CAN BE DELETED AFTER THE FIRST SUCCESSFUL RUN ON PRODUCTION.
 */
export async function GET() {
  const results: Array<{ step: string; status: 'ok' | 'skipped' | 'error'; detail?: string }> = []

  try {
    const client = getLibsql()

    // 1. Check if columns already exist (via PRAGMA table_info)
    let existingColumns = new Set<string>()
    try {
      const pragma = await client.execute({
        sql: `PRAGMA table_info("settings")`,
        args: [],
      })
      for (const row of pragma.rows) {
        const colName = row && typeof row === 'object' && 'name' in row
          ? String((row as Record<string, unknown>).name)
          : ''
        if (colName) existingColumns.add(colName)
      }
      results.push({ step: 'PRAGMA table_info(settings)', status: 'ok', detail: `${existingColumns.size} columns found` })
    } catch (pragmaErr) {
      // D1 might not support PRAGMA the same way; fall back to attempting
      // the ALTER and catching the "duplicate column" error.
      results.push({
        step: 'PRAGMA table_info(settings)',
        status: 'error',
        detail: pragmaErr instanceof Error ? pragmaErr.message : String(pragmaErr),
      })
      // Fallback strategy below — try ALTER and catch duplicate-column error
    }

    // 2. Add driveMode column if missing
    if (existingColumns.has('driveMode')) {
      results.push({ step: 'ADD COLUMN driveMode', status: 'skipped', detail: 'already exists' })
    } else {
      try {
        await client.execute({
          sql: `ALTER TABLE "settings" ADD COLUMN "driveMode" TEXT`,
          args: [],
        })
        results.push({ step: 'ADD COLUMN driveMode', status: 'ok' })
        existingColumns.add('driveMode')
      } catch (alterErr) {
        const msg = alterErr instanceof Error ? alterErr.message : String(alterErr)
        if (msg.includes('duplicate column') || msg.includes('already exists')) {
          results.push({ step: 'ADD COLUMN driveMode', status: 'skipped', detail: 'already exists (caught via ALTER error)' })
        } else {
          results.push({ step: 'ADD COLUMN driveMode', status: 'error', detail: msg })
        }
      }
    }

    // 3. Add driveFolderId column if missing
    if (existingColumns.has('driveFolderId')) {
      results.push({ step: 'ADD COLUMN driveFolderId', status: 'skipped', detail: 'already exists' })
    } else {
      try {
        await client.execute({
          sql: `ALTER TABLE "settings" ADD COLUMN "driveFolderId" TEXT`,
          args: [],
        })
        results.push({ step: 'ADD COLUMN driveFolderId', status: 'ok' })
        existingColumns.add('driveFolderId')
      } catch (alterErr) {
        const msg = alterErr instanceof Error ? alterErr.message : String(alterErr)
        if (msg.includes('duplicate column') || msg.includes('already exists')) {
          results.push({ step: 'ADD COLUMN driveFolderId', status: 'skipped', detail: 'already exists (caught via ALTER error)' })
        } else {
          results.push({ step: 'ADD COLUMN driveFolderId', status: 'error', detail: msg })
        }
      }
    }

    // 4. Set driveMode='shared' on the main settings row if it's currently NULL
    //    (defensive — ensures the field has a valid value even if the route
    //    default 'shared' is rendered correctly on the client).
    try {
      await client.execute({
        sql: `UPDATE "settings" SET "driveMode" = 'shared' WHERE "id" = 'main' AND "driveMode" IS NULL`,
        args: [],
      })
      results.push({ step: 'UPDATE driveMode=shared WHERE NULL', status: 'ok' })
    } catch (updateErr) {
      results.push({
        step: 'UPDATE driveMode=shared WHERE NULL',
        status: 'error',
        detail: updateErr instanceof Error ? updateErr.message : String(updateErr),
      })
    }

    // 5. Update schema_version to 11 so the regular schema sync skips this migration
    //    on future cold starts.
    try {
      const ts = Date.now()
      await client.execute({
        sql: `INSERT INTO "settings" ("id", "maintenanceMessage", "updatedAt")
              VALUES (?, ?, ?)
              ON CONFLICT("id") DO UPDATE SET
                "maintenanceMessage" = excluded."maintenanceMessage",
                "updatedAt" = excluded."updatedAt"`,
        args: [bind('schema_version'), bind('11'), bind(ts)],
      })
      results.push({ step: 'SET schema_version=11', status: 'ok' })
    } catch (versionErr) {
      results.push({
        step: 'SET schema_version=11',
        status: 'error',
        detail: versionErr instanceof Error ? versionErr.message : String(versionErr),
      })
    }

    // 6. Verify by re-reading the settings row (the original failing query)
    let verifyOk = false
    let verifyError: string | undefined
    try {
      const verify = await client.execute({
        sql: `SELECT "driveMode", "driveFolderId" FROM "settings" WHERE "id" = 'main' LIMIT 1`,
        args: [],
      })
      verifyOk = verify.rows.length > 0
    } catch (verifyErr) {
      verifyError = verifyErr instanceof Error ? verifyErr.message : String(verifyErr)
    }
    results.push({
      step: 'VERIFY: SELECT driveMode, driveFolderId',
      status: verifyOk ? 'ok' : 'error',
      detail: verifyOk ? 'query succeeded' : verifyError,
    })

    const allOk = results.every(r => r.status !== 'error')
    return NextResponse.json({
      success: allOk,
      message: allOk
        ? 'Migration complete: driveMode + driveFolderId columns exist on settings table.'
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
