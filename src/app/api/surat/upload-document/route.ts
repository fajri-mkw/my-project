import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'
import { uploadFileToDrive, getAccessToken, shareWithAnyone } from '@/lib/drive-service'
import {
  readDriveSettings,
  readSuratForUpload,
  updateSuratFields,
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
 * POST /api/surat/upload-document
 *
 * Upload a single document to a surat's Google Drive folder and save the
 * metadata to the surat row's `documents` JSON column.
 *
 * ----
 * IMPLEMENTATION NOTE (Task ID 13):
 * Previously crashed on Cloudflare Workers because of:
 *   1. `ensureDbConnection()` running 40+ migration subrequests on cold starts
 *   2. `googleapis` (`getDriveClient`) adding 40+ internal subrequests
 *   3. `drive.files.list/get/create` for folder creation adding 10+ subrequests
 * Total: 90+ subrequests → exceeded the 50-subrequest free-plan limit → 500.
 *
 * Now uses libsql (1 subrequest per DB op) + native fetch helpers (1
 * subrequest per Drive API call). Total: ~6-10 subrequests per request.
 */
export async function POST(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const suratId = formData.get('suratId') as string | null
    const fileName = formData.get('fileName') as string | null // Renamed filename from client

    if (!file || !suratId) {
      return NextResponse.json({ error: 'File dan Surat ID diperlukan' }, { status: 400 })
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

    // Determine target folder: use surat's driveFolderId, or create a new one
    let targetFolderId = surat.driveFolderId
    let driveFolderLink = surat.driveFolderLink

    if (!targetFolderId) {
      // Auto-create folder: Year > Month > SURAT > "Surat - {nomor} - {perihal}"
      const suratDate = surat.tanggalSurat ? new Date(surat.tanggalSurat) : new Date()
      const suratParentFolderId = await findOrCreateYearMonthCategoryFolder(
        settings,
        'SURAT',
        suratDate,
      )
      const folderName = `Surat - ${surat.nomorSurat} - ${surat.perihal.substring(0, 50)}`
      const folderInfo = await createEntityFolder(settings, folderName, suratParentFolderId)

      targetFolderId = folderInfo.id
      driveFolderLink = folderInfo.webViewLink

      // Persist folder info to the surat row (1 subrequest)
      await updateSuratFields(suratId, {
        driveFolderId: targetFolderId,
        driveFolderLink: driveFolderLink,
      })
      console.log(`[SURAT DOC] Created folder "${folderName}" (${targetFolderId})`)
    }

    // Upload file via direct fetch + multipart/related (1 Drive API subrequest)
    const uploadFileName = fileName || file.name
    const fileContent = new Uint8Array(await file.arrayBuffer())
    const fileMime = file.type || 'application/octet-stream'

    console.log(`[SURAT DOC] Uploading "${uploadFileName}" (${(file.size / 1024).toFixed(1)}KB) to folder ${targetFolderId}...`)

    const driveResponse = await uploadFileToDrive({
      serviceAccountKey: settings.driveServiceAccountKey,
      fileName: uploadFileName,
      mimeType: fileMime,
      content: fileContent,
      parents: [targetFolderId],
      sharedDriveId: settings.driveSharedDriveId,
    })

    const driveFileId = driveResponse.id
    console.log(`[SURAT DOC] Upload success: ${driveFileId} — ${driveResponse.name}`)

    // Share file with anyone who has the link (1 Drive API subrequest)
    try {
      const accessToken = await getAccessToken(settings.driveServiceAccountKey)
      await shareWithAnyone(accessToken, driveFileId, 'reader')
    } catch (shareErr) {
      console.error('[SURAT DOC] Failed to share file:', shareErr)
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

    // Save metadata to surat's documents field (1 DB subrequest)
    const existingDocs: DocumentMeta[] = JSON.parse(surat.documents || '[]')
    existingDocs.push(docMeta)
    await updateSuratFields(suratId, {
      documents: JSON.stringify(existingDocs),
    })

    console.log(`[SURAT DOC] Uploaded "${uploadFileName}" for surat ${surat.nomorSurat}`)

    return NextResponse.json({
      success: true,
      document: docMeta,
      surat: {
        ...surat,
        documents: existingDocs,
        driveFolderId: targetFolderId,
        driveFolderLink,
      },
    })
  } catch (error) {
    console.error('[SURAT DOC] Upload error:', error)
    return NextResponse.json(
      { error: 'Gagal mengunggah dokumen: ' + (error instanceof Error ? error.message : 'Unknown error') },
      { status: 500 }
    )
  }
}

// DELETE - Remove a document from surat
export async function DELETE(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const { searchParams } = new URL(request.url)
    const suratId = searchParams.get('suratId')
    const documentId = searchParams.get('documentId')

    if (!suratId || !documentId) {
      return NextResponse.json({ error: 'Surat ID dan Document ID diperlukan' }, { status: 400 })
    }

    const surat = await readSuratForUpload(suratId)
    if (!surat) {
      return NextResponse.json({ error: 'Surat tidak ditemukan' }, { status: 404 })
    }

    const existingDocs: DocumentMeta[] = JSON.parse(surat.documents || '[]')
    const docToRemove = existingDocs.find(d => d.id === documentId)

    // Remove from array
    const updatedDocs = existingDocs.filter(d => d.id !== documentId)
    await updateSuratFields(suratId, {
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
          console.log(`[SURAT DOC] Deleted "${docToRemove.name}" from Drive`)
        }
      } catch (driveErr) {
        console.error('[SURAT DOC] Failed to delete from Drive:', driveErr)
      }
    }

    return NextResponse.json({
      success: true,
      documents: updatedDocs,
    })
  } catch (error) {
    console.error('[SURAT DOC] Delete error:', error)
    return NextResponse.json({ error: 'Gagal menghapus dokumen' }, { status: 500 })
  }
}
