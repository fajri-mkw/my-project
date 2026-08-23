import { db, ensureDbConnection } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'
import { resolveDriveTarget } from '@/lib/drive-service'

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
 */
export async function POST(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    await ensureDbConnection()
    const { projectId } = await request.json()

    if (!projectId) {
      return NextResponse.json({ error: 'Project ID wajib diisi' }, { status: 400 })
    }

    const project = await db.project.findUnique({ where: { id: projectId } })
    if (!project) {
      return NextResponse.json({ error: 'Proyek tidak ditemukan' }, { status: 404 })
    }

    const settings = await db.settings.findUnique({ where: { id: 'main' } })
    if (!settings?.driveServiceAccountKey) {
      return NextResponse.json(
        { error: 'Google Drive belum dikonfigurasi. Hubungi Admin.' },
        { status: 400 }
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
        { status: 400 }
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
      { status: 500 }
    )
  }
}
