import { db, ensureDbConnection } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'

/**
 * POST /api/projects/prepare-upload
 *
 * Returns the Google Drive folder ID for uploading project supporting documents.
 * Projects use a shared folder (driveParentFolderId or shared drive root),
 * NOT a per-project folder. So this endpoint simply returns the configured folder ID.
 *
 * Body: { projectId: string }
 * Returns: { folderId: string }
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
    if (!settings?.driveServiceAccountKey || !settings?.driveSharedDriveId) {
      return NextResponse.json(
        { error: 'Google Drive belum dikonfigurasi. Hubungi Admin.' },
        { status: 400 }
      )
    }

    // Projects use the shared parent folder (not a per-project folder)
    const targetFolderId = settings.driveParentFolderId || settings.driveSharedDriveId

    return NextResponse.json({ folderId: targetFolderId })
  } catch (error) {
    console.error('[PROJECTS PREPARE] Error:', error)
    return NextResponse.json(
      { error: 'Gagal menyiapkan folder upload: ' + (error instanceof Error ? error.message : 'Unknown error') },
      { status: 500 }
    )
  }
}
