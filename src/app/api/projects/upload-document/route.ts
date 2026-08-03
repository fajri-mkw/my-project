import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'
import { uploadFileToDrive, getAccessToken, shareWithAnyone } from '@/lib/drive-service'
import {
  readDriveSettings,
  readProjectForUpload,
  updateProjectFields,
} from '@/lib/drive-helpers'

interface DocumentMeta {
  id: string
  name: string
  mimeType: string
  size: number
  driveFileId: string
  webViewLink: string
  uploadedAt: string
}

/**
 * POST /api/projects/upload-document
 *
 * Upload a supporting document to a project's Google Drive folder (uses the
 * driveParentFolderId or shared drive root — no Year/Month subfolder for
 * project supporting documents).
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
    const projectId = formData.get('projectId') as string | null
    const _documentLabel = formData.get('label') as string | null

    if (!file || !projectId) {
      return NextResponse.json({ error: 'File dan Project ID diperlukan' }, { status: 400 })
    }

    // Read project + settings via libsql (1 subrequest each — NO Prisma, NO schema sync)
    const [project, settings] = await Promise.all([
      readProjectForUpload(projectId),
      readDriveSettings(),
    ])

    if (!project) {
      return NextResponse.json({ error: 'Proyek tidak ditemukan' }, { status: 404 })
    }
    if (!settings?.driveServiceAccountKey || !settings?.driveSharedDriveId) {
      return NextResponse.json(
        { error: 'Google Drive belum dikonfigurasi. Hubungi Admin.' },
        { status: 400 }
      )
    }

    // Determine upload target — either driveParentFolderId or shared drive root
    const targetFolderId = settings.driveParentFolderId || settings.driveSharedDriveId

    // Upload file via direct fetch + multipart/related (1 Drive API subrequest)
    const fileContent = new Uint8Array(await file.arrayBuffer())
    const fileMime = file.type || 'application/octet-stream'

    const driveResponse = await uploadFileToDrive({
      serviceAccountKey: settings.driveServiceAccountKey,
      fileName: file.name,
      mimeType: fileMime,
      content: fileContent,
      parents: [targetFolderId],
      sharedDriveId: settings.driveSharedDriveId,
    })

    // Share with anyone who has the link (reader) — 1 Drive API subrequest
    try {
      const accessToken = await getAccessToken(settings.driveServiceAccountKey)
      await shareWithAnyone(accessToken, driveResponse.id, 'reader')
    } catch (shareErr) {
      console.error('[DOC UPLOAD] Failed to share file:', shareErr)
    }

    // Build document metadata
    const docMeta: DocumentMeta = {
      id: `DOC-${Date.now()}`,
      name: file.name,
      mimeType: fileMime,
      size: file.size,
      driveFileId: driveResponse.id,
      webViewLink: driveResponse.webViewLink || '',
      uploadedAt: new Date().toISOString(),
    }

    // Save metadata to project's documents field (1 DB subrequest)
    const existingDocs: DocumentMeta[] = JSON.parse(project.documents || '[]')
    existingDocs.push(docMeta)
    await updateProjectFields(projectId, {
      documents: JSON.stringify(existingDocs),
    })

    console.log(`[DOC UPLOAD] Uploaded "${file.name}" for project ${projectId}`)

    return NextResponse.json({
      success: true,
      document: docMeta,
    })
  } catch (error) {
    console.error('[DOC UPLOAD] Error:', error)
    return NextResponse.json(
      { error: 'Gagal mengunggah dokumen: ' + (error instanceof Error ? error.message : 'Unknown error') },
      { status: 500 }
    )
  }
}

// DELETE - Remove a document from project
export async function DELETE(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get('projectId')
    const documentId = searchParams.get('documentId')

    if (!projectId || !documentId) {
      return NextResponse.json({ error: 'Project ID dan Document ID diperlukan' }, { status: 400 })
    }

    const project = await readProjectForUpload(projectId)
    if (!project) {
      return NextResponse.json({ error: 'Proyek tidak ditemukan' }, { status: 404 })
    }

    const existingDocs: DocumentMeta[] = JSON.parse(project.documents || '[]')
    const docToRemove = existingDocs.find(d => d.id === documentId)

    // Remove from array
    const updatedDocs = existingDocs.filter(d => d.id !== documentId)
    await updateProjectFields(projectId, {
      documents: JSON.stringify(updatedDocs),
    })

    // Optionally delete from Google Drive via native fetch (best-effort)
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
          console.log(`[DOC UPLOAD] Deleted "${docToRemove.name}" from Drive`)
        }
      } catch (driveErr) {
        console.error('[DOC UPLOAD] Failed to delete from Drive:', driveErr)
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[DOC UPLOAD] Delete error:', error)
    return NextResponse.json({ error: 'Gagal menghapus dokumen' }, { status: 500 })
  }
}
