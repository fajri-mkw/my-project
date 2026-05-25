import { db, ensureDbConnection } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'
import { google } from 'googleapis'
import { Readable } from 'stream'

// Convert Buffer to Readable stream for Google Drive upload
function bufferToStream(buffer: Buffer) {
  const readable = new Readable()
  readable.push(buffer)
  readable.push(null)
  return readable
}

// Create Google Drive client from service account
function getDriveClient(serviceAccountKey: string) {
  const credentials = JSON.parse(serviceAccountKey)
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive']
  })
  return google.drive({ version: 'v3', auth })
}

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

    const drive = getDriveClient(settings.driveServiceAccountKey)

    // Create "DOKUMEN PENDUKUNG" folder inside project folder (if Drive auto-create is on)
    // For now, upload directly to shared drive root or a designated parent
    const buffer = Buffer.from(await file.arrayBuffer())

    const fileMetadata: any = {
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
    }

    // If driveParentFolderId is set, use it; otherwise use shared drive root
    if (settings.driveParentFolderId) {
      fileMetadata.parents = [settings.driveParentFolderId]
    } else {
      fileMetadata.driveId = settings.driveSharedDriveId
      fileMetadata.parents = [settings.driveSharedDriveId]
    }

    const driveResponse = await drive.files.create({
      requestBody: fileMetadata,
      media: {
        mimeType: file.type || 'application/octet-stream',
        body: bufferToStream(buffer),
      },
      fields: 'id, name, webViewLink, size',
      supportsAllDrives: true,
    })

    // Share with anyone who has the link (reader)
    try {
      await drive.permissions.create({
        fileId: driveResponse.data.id!,
        requestBody: {
          type: 'anyone',
          role: 'reader',
          allowFileDiscovery: false,
        },
        supportsAllDrives: true,
      })
    } catch (shareErr) {
      console.error('[DOC UPLOAD] Failed to share file:', shareErr)
    }

    // Build document metadata
    const docMeta: DocumentMeta = {
      id: `DOC-${Date.now()}`,
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      driveFileId: driveResponse.data.id!,
      webViewLink: driveResponse.data.webViewLink || '',
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
