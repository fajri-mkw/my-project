import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'
import {
  readDriveSettings,
  readKegiatanForUpload,
  updateKegiatanFields,
  findOrCreateYearMonthCategoryFolder,
  createEntityFolder,
} from '@/lib/drive-helpers'

/**
 * POST /api/program-kegiatan/prepare-upload
 *
 * Returns the Google Drive folder ID for a program kegiatan (creates it if needed).
 * Body: { kegiatanId: string }
 * Returns: { folderId: string, driveFolderLink?: string }
 *
 * ----
 * IMPLEMENTATION NOTE (Task ID 13):
 * Rewritten to use libsql + native fetch (was previously using googleapis
 * + ensureDbConnection, which exceeded the Workers 50-subrequest limit).
 */
export async function POST(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const { kegiatanId } = await request.json()

    if (!kegiatanId) {
      return NextResponse.json({ error: 'Kegiatan ID wajib diisi' }, { status: 400 })
    }

    // Read kegiatan + settings via libsql (1 subrequest each — NO Prisma, NO schema sync)
    const [kegiatan, settings] = await Promise.all([
      readKegiatanForUpload(kegiatanId),
      readDriveSettings(),
    ])

    if (!kegiatan) {
      return NextResponse.json({ error: 'Kegiatan tidak ditemukan' }, { status: 404 })
    }
    if (!settings?.driveServiceAccountKey || !settings?.driveSharedDriveId) {
      return NextResponse.json(
        { error: 'Google Drive belum dikonfigurasi. Hubungi Super Admin.' },
        { status: 400 }
      )
    }

    // If kegiatan already has a folder, return it immediately
    if (kegiatan.driveFolderId) {
      return NextResponse.json({
        folderId: kegiatan.driveFolderId,
        driveFolderLink: kegiatan.driveFolderLink || undefined,
      })
    }

    // Create folder hierarchy: Year > Month > KEGIATAN > "{perihal} - {date}"
    const kegiatanDate = kegiatan.tanggalKegiatan ? new Date(kegiatan.tanggalKegiatan) : new Date()
    const dateStr = kegiatanDate.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' })
    const folderName = `${kegiatan.perihal} - ${dateStr}`

    const kegiatanParentFolderId = await findOrCreateYearMonthCategoryFolder(
      settings,
      'KEGIATAN',
      kegiatanDate,
    )

    const folderInfo = await createEntityFolder(settings, folderName, kegiatanParentFolderId)

    // Persist folder info to the kegiatan row (1 subrequest)
    await updateKegiatanFields(kegiatanId, {
      driveFolderId: folderInfo.id,
      driveFolderLink: folderInfo.webViewLink,
    })

    console.log(`[KEGIATAN PREPARE] Created folder "${folderName}" (${folderInfo.id})`)

    return NextResponse.json({
      folderId: folderInfo.id,
      driveFolderLink: folderInfo.webViewLink,
    })
  } catch (error) {
    console.error('[KEGIATAN PREPARE] Error:', error)
    return NextResponse.json(
      { error: 'Gagal menyiapkan folder upload: ' + (error instanceof Error ? error.message : 'Unknown error') },
      { status: 500 }
    )
  }
}
