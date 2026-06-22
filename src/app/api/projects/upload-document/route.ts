import { db, ensureDbConnection } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'
import { google } from 'googleapis'
import { getDriveClient, uploadFileToDrive, getAccessToken, shareWithAnyone } from '@/lib/drive-service'

// Convert Buffer to Readable stream — REMOVED.
// File uploads now use uploadFileToDrive (direct fetch + multipart/related).
// googleapis's stream-based upload fails in Cloudflare Workers with
// "Missing end boundary in multipart body".

interface DocumentMeta {
  id: string
  name: string
  mimeType: string
  size: number
  driveFileId: string
  webViewLink: string
  uploadedAt: string
}

// POST - Upload supporting document to Google Drive & save metadata to project
export async function POST(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    await ensureDbConnection()
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const projectId = formData.get('projectId') as string | null
    const documentLabel = formData.get('label') as string | null

    if (!file || !projectId) {
      return NextResponse.json({ error: 'File dan Project ID diperlukan' }, { status: 400 })
    }

    // Verify project exists
    const project = await db.project.findUnique({ where: { id: projectId } })
    if (!project) {
      return NextResponse.json({ error: 'Proyek tidak ditemukan' }, { status: 404 })
    }

    // Get settings for Google Drive
    const settings = await db.settings.findUnique({ where: { id: 'main' } })

    if (!settings?.driveServiceAccountKey || !settings?.driveSharedDriveId) {
      return NextResponse.json(
        { error: 'Google Drive belum dikonfigurasi. Hubungi Admin.' },
        { status: 400 }
      )
    }

    // Determine upload target — either driveParentFolderId or shared drive root
    const targetFolderId = settings.driveParentFolderId || settings.driveSharedDriveId

    // Upload file via direct fetch + multipart/related (bypasses googleapis
    // stream-based upload that fails in Cloudflare Workers).
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

    // Share with anyone who has the link (reader) — uses fetch directly
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

    // Save metadata to project's documents field
    const existingDocs: DocumentMeta[] = JSON.parse(project.documents || '[]')
    existingDocs.push(docMeta)

    await db.project.update({
      where: { id: projectId },
      data: { documents: JSON.stringify(existingDocs) },
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
    await ensureDbConnection()
    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get('projectId')
    const documentId = searchParams.get('documentId')

    if (!projectId || !documentId) {
      return NextResponse.json({ error: 'Project ID dan Document ID diperlukan' }, { status: 400 })
    }

    const project = await db.project.findUnique({ where: { id: projectId } })
    if (!project) {
      return NextResponse.json({ error: 'Proyek tidak ditemukan' }, { status: 404 })
    }

    const existingDocs: DocumentMeta[] = JSON.parse(project.documents || '[]')
    const docToRemove = existingDocs.find(d => d.id === documentId)

    // Remove from array
    const updatedDocs = existingDocs.filter(d => d.id !== documentId)

    await db.project.update({
      where: { id: projectId },
      data: { documents: JSON.stringify(updatedDocs) },
    })

    // Optionally delete from Google Drive
    if (docToRemove?.driveFileId) {
      try {
        const settings = await db.settings.findUnique({ where: { id: 'main' } })
        if (settings?.driveServiceAccountKey) {
          const drive = getDriveClient(settings.driveServiceAccountKey)
          await drive.files.delete({
            fileId: docToRemove.driveFileId,
            supportsAllDrives: true,
          })
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
