import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'
import { uploadFileToDrive, getAccessToken, shareWithAnyone, resolveDriveTarget } from '@/lib/drive-service'
import {
  readDriveSettings,
  readKegiatanForUpload,
  updateKegiatanFields,
  findOrCreateYearMonthCategoryFolder,
  createEntityFolder,
} from '@/lib/drive-helpers'

interface DocumentMeta {
  id: string
  name: string
  originalName?: string
  mimeType: string
  size: number
  driveFileId: string
  webViewLink: string
  downloadUrl: string
  uploadedAt: string
}

/**
 * POST /api/program-kegiatan/upload-document
 *
 * Upload a document to a kegiatan's Google Drive folder and save metadata.
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
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const kegiatanId = formData.get('kegiatanId') as string | null
    const fileName = formData.get('fileName') as string | null

    if (!file || !kegiatanId) {
      return NextResponse.json({ error: 'File dan Kegiatan ID diperlukan' }, { status: 400 })
    }

    // Read kegiatan + settings via libsql (1 subrequest each — NO Prisma, NO schema sync)
    const [kegiatan, settings] = await Promise.all([
      readKegiatanForUpload(kegiatanId),
      readDriveSettings(),
    ])

    if (!kegiatan) {
      return NextResponse.json({ error: 'Kegiatan tidak ditemukan' }, { status: 404 })
    }
    // Mode-aware validation: resolve the Drive target — works in both
    // shared-drive mode (driveSharedDriveId) and folder mode (driveFolderId).
    if (!settings?.driveServiceAccountKey) {
      return NextResponse.json(
        { error: 'Google Drive belum dikonfigurasi. Hubungi Super Admin.' },
        { status: 400 }
      )
    }
    const target = resolveDriveTarget(settings)
    if (!target) {
      const isFolderMode = settings.driveMode === 'folder'
      return NextResponse.json(
        {
          error: isFolderMode
            ? 'Drive Folder ID belum dikonfigurasi. Hubungi Super Admin.'
            : 'Shared Drive ID belum dikonfigurasi. Hubungi Super Admin.',
        },
        { status: 400 }
      )
    }
    // driveIdForCreate: empty in folder mode (no driveId metadata in upload);
    // the Shared Drive ID in shared mode (upload gets driveId metadata).
    const driveIdForCreate = target.isSharedDrive ? target.rootId : undefined

    // Determine target folder: use kegiatan's driveFolderId, or create a new one
    let targetFolderId = kegiatan.driveFolderId
    let driveFolderLink = kegiatan.driveFolderLink

    if (!targetFolderId) {
      // Auto-create folder: Year > Month > KEGIATAN > "{perihal} - {date}"
      const kegiatanDate = kegiatan.tanggalKegiatan ? new Date(kegiatan.tanggalKegiatan) : new Date()
      const dateStr = kegiatanDate.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' })
      const folderName = `${kegiatan.perihal} - ${dateStr}`

      const kegiatanParentFolderId = await findOrCreateYearMonthCategoryFolder(
        settings,
        'KEGIATAN',
        kegiatanDate,
      )
      const folderInfo = await createEntityFolder(settings, folderName, kegiatanParentFolderId)

      targetFolderId = folderInfo.id
      driveFolderLink = folderInfo.webViewLink

      // Persist folder info to the kegiatan row (1 subrequest)
      await updateKegiatanFields(kegiatanId, {
        driveFolderId: targetFolderId,
        driveFolderLink: driveFolderLink,
      })
      console.log(`[KEGIATAN DOC] Created folder "${folderName}" (${targetFolderId})`)
    }

    // Upload file via direct fetch + multipart/related (1 Drive API subrequest)
    const uploadFileName = fileName || file.name
    const fileContent = new Uint8Array(await file.arrayBuffer())
    const fileMime = file.type || 'application/octet-stream'

    console.log(`[KEGIATAN DOC] Uploading "${uploadFileName}" (${(file.size / 1024).toFixed(1)}KB) to folder ${targetFolderId}...`)

    const driveResponse = await uploadFileToDrive({
      serviceAccountKey: settings.driveServiceAccountKey,
      fileName: uploadFileName,
      mimeType: fileMime,
      content: fileContent,
      parents: [targetFolderId],
      // Pass sharedDriveId ONLY in shared-drive mode. In folder mode, leave
      // undefined so uploadFileToDrive omits the driveId metadata field —
      // the new file inherits the parent's location (My Drive shared folder).
      sharedDriveId: driveIdForCreate,
    })

    const driveFileId = driveResponse.id
    console.log(`[KEGIATAN DOC] Upload success: ${driveFileId} — ${driveResponse.name}`)

    // Share file with anyone who has the link (1 Drive API subrequest)
    try {
      const accessToken = await getAccessToken(settings.driveServiceAccountKey)
      await shareWithAnyone(accessToken, driveFileId, 'reader')
    } catch (shareErr) {
      console.error('[KEGIATAN DOC] Failed to share file:', shareErr)
    }

    // Build proper access URLs
    const webViewLink = driveResponse.webViewLink || `https://drive.google.com/file/d/${driveFileId}/view`
    const downloadUrl = `https://drive.google.com/uc?export=download&id=${driveFileId}`

    // Build document metadata
    const docMeta: DocumentMeta = {
      id: `DOC-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: uploadFileName,
      originalName: file.name !== uploadFileName ? file.name : undefined,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      driveFileId: driveFileId,
      webViewLink,
      downloadUrl,
      uploadedAt: new Date().toISOString(),
    }

    // Save metadata to kegiatan's documents field (1 DB subrequest)
    const existingDocs: DocumentMeta[] = JSON.parse(kegiatan.documents || '[]')
    existingDocs.push(docMeta)
    await updateKegiatanFields(kegiatanId, {
      documents: JSON.stringify(existingDocs),
    })

    console.log(`[KEGIATAN DOC] Uploaded "${uploadFileName}" for kegiatan ${kegiatan.nomorKegiatan}`)

    return NextResponse.json({
      success: true,
      document: docMeta,
      kegiatan: {
        ...kegiatan,
        documents: existingDocs,
        driveFolderId: targetFolderId,
        driveFolderLink,
      },
    })
  } catch (error) {
    console.error('[KEGIATAN DOC] Upload error:', error)
    return NextResponse.json(
      { error: 'Gagal mengunggah dokumen: ' + (error instanceof Error ? error.message : 'Unknown error') },
      { status: 500 }
    )
  }
}

// DELETE - Remove a document from kegiatan
export async function DELETE(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const { searchParams } = new URL(request.url)
    const kegiatanId = searchParams.get('kegiatanId')
    const documentId = searchParams.get('documentId')

    if (!kegiatanId || !documentId) {
      return NextResponse.json({ error: 'Kegiatan ID dan Document ID diperlukan' }, { status: 400 })
    }

    const kegiatan = await readKegiatanForUpload(kegiatanId)
    if (!kegiatan) {
      return NextResponse.json({ error: 'Kegiatan tidak ditemukan' }, { status: 404 })
    }

    const existingDocs: DocumentMeta[] = JSON.parse(kegiatan.documents || '[]')
    const docToRemove = existingDocs.find(d => d.id === documentId)

    // Remove from array
    const updatedDocs = existingDocs.filter(d => d.id !== documentId)
    await updateKegiatanFields(kegiatanId, {
      documents: JSON.stringify(updatedDocs),
    })

    // Delete from Google Drive via native fetch (best-effort)
    if (docToRemove?.driveFileId) {
      try {
        const settings = await readDriveSettings()
        if (settings?.driveServiceAccountKey) {
          const accessToken = await getAccessToken(settings.driveServiceAccountKey)
          await fetch(
            `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(docToRemove.driveFileId)}?supportsAllDrives=true`,
            {
              method: 'DELETE',
              headers: { 'Authorization': `Bearer ${accessToken}` },
            },
          )
          console.log(`[KEGIATAN DOC] Deleted "${docToRemove.name}" from Drive`)
        }
      } catch (driveErr) {
        console.error('[KEGIATAN DOC] Failed to delete from Drive:', driveErr)
      }
    }

    return NextResponse.json({
      success: true,
      documents: updatedDocs,
    })
  } catch (error) {
    console.error('[KEGIATAN DOC] Delete error:', error)
    return NextResponse.json({ error: 'Gagal menghapus dokumen' }, { status: 500 })
  }
}
