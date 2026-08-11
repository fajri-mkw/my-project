import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'
import { getLibsql, bind } from '@/lib/libsql-client'

// ============================================================================
// PUT update drive folder links and role assignments.
//
// Rewritten to use @libsql/client directly (bypasses Prisma CPU overhead) —
// same pattern as src/app/api/maintenance/route.ts and src/app/api/users/route.ts.
// The Prisma import (`db` + `ensureDbConnection`) caused Cloudflare Workers
// Error 1102 (Worker exceeded resource limits) on cold starts because loading
// Prisma's WASM module + running ensureSchemaSync() burned too much CPU on the
// Workers free plan (10ms CPU limit).
// ============================================================================

export async function PUT(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const body = await request.json()
    const { projectId, folders } = body as {
      projectId: string
      folders: {
        id: string
        link: string
        assignedRoles?: string[]
        assignedUsers?: { userId: string; userName: string; download: boolean; upload: boolean }[]
      }[]
    }

    if (!Array.isArray(folders) || folders.length === 0) {
      return NextResponse.json({ success: true, count: 0 })
    }

    const client = getLibsql()

    // Use batch() so all updates go to the DB in a single round-trip —
    // important on Cloudflare Workers where every subrequest adds latency
    // (and CPU for the libsql HTTP protocol overhead).
    const statements = folders.map((f) => ({
      sql: `UPDATE drive_folders SET
              link = ?,
              assignedRoles = ?,
              assignedUsers = ?
            WHERE id = ?`,
      args: [
        bind(f.link),
        bind(f.assignedRoles ? JSON.stringify(f.assignedRoles) : null),
        bind(f.assignedUsers ? JSON.stringify(f.assignedUsers) : null),
        bind(f.id),
      ],
    }))

    const results = await client.batch(statements)
    const updatedCount = Array.isArray(results) ? results.length : folders.length

    return NextResponse.json({ success: true, count: updatedCount })
  } catch (error) {
    console.error('Update drive folders error:', error)
    return NextResponse.json({ error: 'Failed to update drive folders' }, { status: 500 })
  }
}
