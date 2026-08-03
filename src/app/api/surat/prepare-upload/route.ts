import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'
import {
  readDriveSettings,
  readSuratForUpload,
  updateSuratFields,
  findOrCreateYearMonthCategoryFolder,
  createEntityFolder,
} from '@/lib/drive-helpers'

/**
 * POST /api/surat/prepare-upload
 *
 * Returns the Google Drive folder ID for a surat (creates it if it doesn't exist).
 * The frontend then uses this folder ID with the chunked resumable upload path
 * (/api/drive/upload-url + /api/drive/upload-chunk) to upload files of ANY size.
 *
 * Body: { suratId: string }
 * Returns: { folderId: string, driveFolderLink?: string }
 *
 * ----
 * IMPLEMENTATION NOTE (Task ID 13):
 * This route used to crash on Cloudflare Workers because it called
 * `ensureDbConnection()` (40+ migration subrequests on cold starts) AND
 * imported `googleapis` (40+ internal subrequests) AND used
 * `drive.files.list/get/create` (10+ subrequests). Total: 90+ subrequests,
 * far exceeding the 50-subrequest Workers free-plan limit → HTTP 500.
 *
 * It now uses the shared drive-helpers (libsql + native fetch). Total
 * subrequests per request: ~3-8, well under the limit.
 */
export async function POST(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const { suratId } = await request.json()

    if (!suratId) {
      return NextResponse.json({ error: 'Surat ID wajib diisi' }, { status: 400 })
    }

    // Read surat + settings via libsql (1 subrequest each — NO Prisma, NO schema sync)
    const [surat, settings] = await Promise.all([
      readSuratForUpload(suratId),
      readDriveSettings(),
    ])

    if (!surat) {
      return NextResponse.json({ error: 'Surat tidak ditemukan' }, { status: 404 })
    }
    if (!settings?.driveServiceAccountKey || !settings?.driveSharedDriveId) {
      return NextResponse.json(
        { error: 'Google Drive belum dikonfigurasi. Hubungi Super Admin.' },
        { status: 400 }
      )
    }

    // If surat already has a folder, return it immediately
    if (surat.driveFolderId) {
      return NextResponse.json({
        folderId: surat.driveFolderId,
        driveFolderLink: surat.driveFolderLink || undefined,
      })
    }

    // Create folder hierarchy: Year > Month > SURAT > "Surat - {nomorSurat} - {perihal}"
    const suratDate = surat.tanggalSurat ? new Date(surat.tanggalSurat) : new Date()
    const suratParentFolderId = await findOrCreateYearMonthCategoryFolder(
      settings,
      'SURAT',
      suratDate,
    )

    const folderName = `Surat - ${surat.nomorSurat} - ${surat.perihal.substring(0, 50)}`
    const folderInfo = await createEntityFolder(settings, folderName, suratParentFolderId)

    // Persist folder info to the surat row via libsql (1 subrequest)
    await updateSuratFields(suratId, {
      driveFolderId: folderInfo.id,
      driveFolderLink: folderInfo.webViewLink,
    })

    console.log(`[SURAT PREPARE] Created folder "${folderName}" (${folderInfo.id})`)

    return NextResponse.json({
      folderId: folderInfo.id,
      driveFolderLink: folderInfo.webViewLink,
    })
  } catch (error) {
    console.error('[SURAT PREPARE] Error:', error)
    return NextResponse.json(
      { error: 'Gagal menyiapkan folder upload: ' + (error instanceof Error ? error.message : 'Unknown error') },
      { status: 500 }
    )
  }
}
