import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'
import { resolveDriveTarget } from '@/lib/drive-service'
import { getLibsql, bind } from '@/lib/libsql-client'
import {
  readDriveSettings,
} from '@/lib/drive-helpers'

/**
 * POST /api/projects/prepare-upload
 *
 * Returns the Google Drive folder ID for uploading project supporting documents.
 * Projects use a shared folder (driveParentFolderId or shared drive root),
 * NOT a per-project folder. So this endpoint simply returns the configured folder ID.
 *
 * Body: { projectId: string }
 * Returns: { folderId: string }
 *
 * DUAL-MODE: in 'shared' mode, returns driveParentFolderId || sharedDriveId.
 * In 'folder' mode, returns driveFolderId (the My Drive shared folder).
 *
 * ----
 * CRITICAL FIX (Task ID 15):
 * This route previously used Prisma (`import { db, ensureDbConnection } from '@/lib/db'`)
 * and called `db.project.findUnique` + `db.settings.findUnique`. On Cloudflare
 * Workers free plan, the FIRST call on a cold isolate triggers the lazy Prisma
 * proxy to `await import('@prisma/client')` (~1.5MB WASM) AND `ensureDbConnection`
 * runs ensureSchemaSync (40+ migration subrequests). Combined CPU routinely
 * exceeded the 10ms limit → Error 1102 → HTTP 500 — which surfaced as
 * "Gagal menyiapkan folder upload" on the project supporting documents flow.
 *
 * FIX: Switched to libsql via shared drive-helpers (readDriveSettings) and a
 * direct SELECT for project existence check. Total: 2 subrequests + ~0.1ms CPU.
 */
export async function POST(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const { projectId } = await request.json()

    if (!projectId) {
      return NextResponse.json({ error: 'Project ID wajib diisi' }, { status: 400 })
    }

    // 1 subrequest — verify project exists via libsql (NO Prisma)
    const client = getLibsql()
    const projRes = await client.execute({
      sql: `SELECT id FROM projects WHERE id = ? LIMIT 1`,
      args: [bind(projectId)],
    })
    if (projRes.rows.length === 0) {
      return NextResponse.json({ error: 'Proyek tidak ditemukan' }, { status: 404 })
    }

    // 1 subrequest — read Drive settings via shared libsql helper (NO Prisma)
    const settings = await readDriveSettings()
    if (!settings?.driveServiceAccountKey) {
      return NextResponse.json(
        { error: 'Google Drive belum dikonfigurasi. Hubungi Admin.' },
        { status: 400 },
      )
    }

    // Mode-aware target resolution.
    const target = resolveDriveTarget(settings)
    if (!target) {
      const isFolderMode = settings.driveMode === 'folder'
      return NextResponse.json(
        {
          error: isFolderMode
            ? 'Drive Folder ID belum dikonfigurasi. Hubungi Admin.'
            : 'Shared Drive ID belum dikonfigurasi. Hubungi Admin.',
        },
        { status: 400 },
      )
    }

    // Projects use the shared parent folder (not a per-project folder).
    //   - shared mode: driveParentFolderId (if set) || shared drive root
    //   - folder mode: driveFolderId (the shared My Drive folder)
    const targetFolderId = target.mode === 'folder'
      ? target.rootId
      : (target.parentFolderId || target.rootId)

    return NextResponse.json({ folderId: targetFolderId, driveMode: target.mode })
  } catch (error) {
    console.error('[PROJECTS PREPARE] Error:', error)
    return NextResponse.json(
      { error: 'Gagal menyiapkan folder upload: ' + (error instanceof Error ? error.message : 'Unknown error') },
      { status: 500 },
    )
  }
}
