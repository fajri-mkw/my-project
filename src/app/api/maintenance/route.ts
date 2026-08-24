import { NextResponse } from 'next/server'
import {
  getLibsql,
  toBool,
  bind,
} from '@/lib/libsql-client'
import { withEdgeCache } from '@/lib/edge-cache'
import { invalidateMaintenanceCache } from '@/lib/maintenance-check'

// ============================================================================
// CRITICAL: This route is hit on EVERY dashboard page load (sometimes twice —
// once in <AppShell> for the banner, once in useEffect on /).
//
// HISTORY (Error 1102 root cause):
//   The previous version called `ensureDbConnection()` which triggers
//   `ensureSchemaSync()`. On Cloudflare Workers free plan (10ms CPU limit),
//   Prisma's query-building + the schema-sync version check + URL_SCHEME_NOT_SUPPORTED
//   retry loops burned enough CPU to exceed the Worker resource limit and
//   surface as `Error 1102: Worker exceeded resource limits`. Production
//   `/api/maintenance` measured 5.7s wall time per cold request.
//
//   Same root cause class as the Google Drive upload 500 errors (Task ID 13):
//   any Cloudflare Workers route that imports `db` from '@/lib/db' pays Prisma
//   module-load CPU + ensureDbConnection() subrequests on every cold start.
//
// FIX: Rewrite to use `@libsql/client` directly (same pattern as
//   - src/lib/maintenance-check.ts
//   - src/app/api/projects/route.ts
//   - src/app/api/users/route.ts
//   - src/lib/drive-helpers.ts
//   - src/lib/libsql-client.ts
// ).
//
// Expected improvement: 5.7s → <500ms wall time, no schema-sync subrequests,
// no Prisma module-load CPU, well under Workers free plan limits.
// ============================================================================

// Edge-cached for 60s to reduce CPU usage on Workers free plan.
// `invalidateCache('/api/maintenance')` is called from PUT after a settings update.
export const GET = withEdgeCache(async (_request: Request) => {
  try {
    const client = getLibsql()

    // Single libsql round-trip — same SELECT the old Prisma findUnique did.
    // LIMIT 1 for defensive cheap-path even though id is the PK.
    const result = await client.execute({
      sql: `SELECT maintenanceMode, maintenanceMessage
            FROM settings
            WHERE id = 'main'
            LIMIT 1`,
      args: [],
    })

    if (result.rows.length === 0) {
      // No 'main' settings row yet — fail to "not in maintenance" default.
      return NextResponse.json(
        { maintenance: false, message: null },
        { headers: { 'Cache-Control': 'private, max-age=5, stale-while-revalidate=15' } },
      )
    }

    const row = result.rows[0] as Record<string, unknown>
    const maintenance = toBool(row.maintenanceMode)
    const message =
      row.maintenanceMessage === null || row.maintenanceMessage === undefined
        ? null
        : String(row.maintenanceMessage)

    return NextResponse.json(
      { maintenance, message },
      { headers: { 'Cache-Control': 'private, max-age=5, stale-while-revalidate=15' } },
    )
  } catch (error) {
    console.error('Error fetching maintenance status:', error)
    // Fail-open: never block the UI just because the DB is unreachable.
    // Frontend treats maintenance=false as "no banner, proceed normally".
    return NextResponse.json(
      { maintenance: false, message: null },
      { headers: { 'Cache-Control': 'private, max-age=5, stale-while-revalidate=15' } },
    )
  }
}, { ttl: 120 })

// ============================================================================
// PUT — admin updates maintenance mode / message.
// Replaces Prisma's findUnique + create/update pattern with libsql direct
// writes. Admin authorization is done via direct libsql SELECT (same pattern
// as maintenance-check.ts `fetchUserRole`).
// ============================================================================
export async function PUT(request: Request) {
  try {
    const body = await request.json()
    const { maintenanceMode, maintenanceMessage, userId } = body as {
      maintenanceMode?: boolean
      maintenanceMessage?: string | null
      userId?: string
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID diperlukan' },
        { status: 400 },
      )
    }

    // Verify user is admin via direct libsql read (NO Prisma).
    const client = getLibsql()
    const userRes = await client.execute({
      sql: `SELECT role FROM users WHERE id = ? LIMIT 1`,
      args: [bind(userId)],
    })
    if (userRes.rows.length === 0) {
      return NextResponse.json(
        { error: 'User tidak ditemukan' },
        { status: 403 },
      )
    }
    const userRole = String((userRes.rows[0] as Record<string, unknown>).role ?? '')
    if (userRole !== 'Admin') {
      return NextResponse.json(
        { error: 'Hanya Admin yang dapat mengubah status maintenance' },
        { status: 403 },
      )
    }

    // Coerce the input — maintenanceMode defaults to false, message to null.
    const nextMode = maintenanceMode ?? false
    const nextMessage =
      maintenanceMessage === undefined || maintenanceMessage === null
        ? null
        : String(maintenanceMessage) || null

    // Upsert manually — same shape the old Prisma findUnique + create/update did.
    // Using INSERT OR REPLACE keeps this to a single round-trip and is safe
    // because the settings table uses id='main' as its single fixed row.
    const now = Date.now()
    await client.execute({
      sql: `INSERT INTO settings (id, maintenanceMode, maintenanceMessage, updatedAt)
            VALUES ('main', ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              maintenanceMode = excluded.maintenanceMode,
              maintenanceMessage = excluded.maintenanceMessage,
              updatedAt = excluded.updatedAt`,
      args: [
        bind(nextMode ? 1 : 0), // SQLite stores Boolean as 0/1
        bind(nextMessage),
        bind(now),
      ],
    })

    // Bust the edge cache for GET (so the next dashboard load sees the new mode).
    const { invalidateCache } = await import('@/lib/edge-cache')
    await invalidateCache('/api/maintenance')
    // Also reset the in-memory cache used by checkMaintenanceMode() on every route.
    invalidateMaintenanceCache()

    return NextResponse.json({
      success: true,
      maintenance: nextMode,
      message: nextMessage,
    })
  } catch (error) {
    console.error('Error updating maintenance status:', error)
    return NextResponse.json(
      { error: 'Gagal mengubah status maintenance' },
      { status: 500 },
    )
  }
}
