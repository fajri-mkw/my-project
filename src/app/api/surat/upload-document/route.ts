import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'
import { google } from 'googleapis'
import { Readable } from 'stream'

// Indonesian month names
const BULAN_INDONESIA = [
  '01 Januari', '02 Februari', '03 Maret', '04 April',
  '05 Mei', '06 Juni', '07 Juli', '08 Agustus',
  '09 September', '10 Oktober', '11 November', '12 Desember'
]

// Find or create Year > Month > SURAT folder hierarchy
async function findOrCreateSuratMonthFolder(
  drive: ReturnType<typeof google.drive>,
  sharedDriveId: string,
  rootParentId: string,
  date: Date
): Promise<string> {
  const year = date.getFullYear().toString()
  const monthName = BULAN_INDONESIA[date.getMonth()]

  // Search for Year folder
  const yearQuery = `name='${year}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const yearResult = await drive.files.list({
    q: yearQuery,
    corpora: 'drive',
    driveId: sharedDriveId,
    fields: 'files(id, name)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    pageSize: 10
  })

  let yearFolderId: string | null = null
  if (yearResult.data.files) {
    for (const f of yearResult.data.files) {
      if (!f.id) continue
      const parents = await drive.files.get({ fileId: f.id, fields: 'parents', supportsAllDrives: true })
      const parentList = (parents.data as any).parents || []
      if (parentList.includes(rootParentId) || parentList.includes(sharedDriveId)) {
        yearFolderId = f.id
        break
      }
    }
  }

  if (!yearFolderId) {
    const yearMetadata: any = {
      name: year, mimeType: 'application/vnd.google-apps.folder',
      driveId: sharedDriveId, parents: [rootParentId]
    }
    const yearResp = await drive.files.create({ requestBody: yearMetadata, fields: 'id', supportsAllDrives: true })
    yearFolderId = yearResp.data.id!
    console.log(`[SURAT DOC] Created Year folder: ${year}`)
  }

  // Search for Month folder inside Year
  const monthQuery = `name='${monthName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const monthResult = await drive.files.list({
    q: monthQuery,
    corpora: 'drive',
    driveId: sharedDriveId,
    fields: 'files(id, name)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    pageSize: 10
  })

  let monthFolderId: string | null = null
  if (monthResult.data.files) {
    for (const f of monthResult.data.files) {
      if (!f.id) continue
      const parents = await drive.files.get({ fileId: f.id, fields: 'parents', supportsAllDrives: true })
      const parentList = (parents.data as any).parents || []
      if (parentList.includes(yearFolderId)) {
        monthFolderId = f.id
        break
      }
    }
  }

  if (!monthFolderId) {
    const monthMetadata: any = {
      name: monthName, mimeType: 'application/vnd.google-apps.folder',
      driveId: sharedDriveId, parents: [yearFolderId]
    }
    const monthResp = await drive.files.create({ requestBody: monthMetadata, fields: 'id', supportsAllDrives: true })
    monthFolderId = monthResp.data.id!
    console.log(`[SURAT DOC] Created Month folder: ${monthName}`)
  }

  // Search for SURAT folder inside Month
  const suratQuery = `name='SURAT' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const suratResult = await drive.files.list({
    q: suratQuery,
    corpora: 'drive',
    driveId: sharedDriveId,
    fields: 'files(id, name)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    pageSize: 10
  })

  let suratFolderId: string | null = null
  if (suratResult.data.files) {
    for (const f of suratResult.data.files) {
      if (!f.id) continue
      const parents = await drive.files.get({ fileId: f.id, fields: 'parents', supportsAllDrives: true })
      const parentList = (parents.data as any).parents || []
      if (parentList.includes(monthFolderId)) {
        suratFolderId = f.id
        break
      }
    }
  }

  if (!suratFolderId) {
    const suratMetadata: any = {
      name: 'SURAT', mimeType: 'application/vnd.google-apps.folder',
      driveId: sharedDriveId, parents: [monthFolderId]
    }
    const suratResp = await drive.files.create({ requestBody: suratMetadata, fields: 'id', supportsAllDrives: true })
    suratFolderId = suratResp.data.id!
    console.log(`[SURAT DOC] Created SURAT folder in ${monthName} ${year}`)
  }

  return suratFolderId
}

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
  originalName?: string
  mimeType: string
  size: number
  driveFileId: string
  webViewLink: string
  downloadUrl: string
  uploadedAt: string
}

// POST - Upload document to surat's Google Drive folder
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

    // Verify surat exists
    const surat = await db.surat.findUnique({ where: { id: suratId } })
    if (!surat) {
      return NextResponse.json({ error: 'Surat tidak ditemukan' }, { status: 404 })
    }

    // Get settings for Google Drive
    const settings = await db.settings.findUnique({ where: { id: 'main' } })

    if (!settings?.driveServiceAccountKey || !settings?.driveSharedDriveId) {
      return NextResponse.json(
        { error: 'Google Drive belum dikonfigurasi. Hubungi Super Admin.' },
        { status: 400 }
      )
    }

    const drive = getDriveClient(settings.driveServiceAccountKey)

    // Determine target folder: use surat's driveFolderId, or create a new one
    let targetFolderId = surat.driveFolderId

    if (!targetFolderId) {
      // Auto-create folder for this surat inside Year > Month > SURAT structure
      const suratDate = surat.tanggalSurat ? new Date(surat.tanggalSurat) : new Date()
      
      const suratParentFolderId = await findOrCreateSuratMonthFolder(
        drive,
        settings.driveSharedDriveId,
        settings.driveParentFolderId || settings.driveSharedDriveId,
        suratDate
      )

      const folderName = `Surat - ${surat.nomorSurat} - ${surat.perihal.substring(0, 50)}`

      const folderMetadata: any = {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        driveId: settings.driveSharedDriveId,
        parents: [suratParentFolderId]
      }

      const folderResponse = await drive.files.create({
        requestBody: folderMetadata,
        fields: 'id, webViewLink',
        supportsAllDrives: true
      })

      targetFolderId = folderResponse.data.id!

      // Share folder with anyone who has the link (reader = can view files inside)
      try {
        await drive.permissions.create({
          fileId: targetFolderId,
          requestBody: {
            type: 'anyone',
            role: 'reader',
            allowFileDiscovery: false
          },
          supportsAllDrives: true
        })
      } catch (shareErr) {
        console.error('[SURAT DOC] Failed to share folder:', shareErr)
      }

      // Update surat with folder info
      await db.surat.update({
        where: { id: suratId },
        data: {
          driveFolderId: targetFolderId,
          driveFolderLink: folderResponse.data.webViewLink,
        }
      })

      console.log(`[SURAT DOC] Created folder "${folderName}" (${targetFolderId})`)
    }

    // Upload file to the folder using the RENAMED filename
    const uploadFileName = fileName || file.name // Use renamed name if provided
    const buffer = Buffer.from(await file.arrayBuffer())

    const fileMetadata: any = {
      name: uploadFileName,
      mimeType: file.type || 'application/octet-stream',
      driveId: settings.driveSharedDriveId,
      parents: [targetFolderId],
    }

    console.log(`[SURAT DOC] Uploading "${uploadFileName}" (${(file.size / 1024).toFixed(1)}KB) to folder ${targetFolderId}...`)

    const driveResponse = await drive.files.create({
      requestBody: fileMetadata,
      media: {
        mimeType: file.type || 'application/octet-stream',
        body: bufferToStream(buffer),
      },
      fields: 'id, name, webViewLink, size, exportLinks',
      supportsAllDrives: true,
    })

    const driveFileId = driveResponse.data.id!
    console.log(`[SURAT DOC] Upload success: ${driveFileId} — ${driveResponse.data.name}`)

    // Share file with anyone who has the link (reader)
    try {
      await drive.permissions.create({
        fileId: driveFileId,
        requestBody: {
          type: 'anyone',
          role: 'reader',
          allowFileDiscovery: false,
        },
        supportsAllDrives: true,
      })
    } catch (shareErr) {
      console.error('[SURAT DOC] Failed to share file:', shareErr)
    }

    // Build proper access URLs
    const webViewLink = driveResponse.data.webViewLink || `https://drive.google.com/file/d/${driveFileId}/view`
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

    // Save metadata to surat's documents field
    const existingDocs: DocumentMeta[] = JSON.parse(surat.documents || '[]')
    existingDocs.push(docMeta)

    await db.surat.update({
      where: { id: suratId },
      data: { documents: JSON.stringify(existingDocs) },
    })

    console.log(`[SURAT DOC] Uploaded "${uploadFileName}" for surat ${surat.nomorSurat}`)

    // Return updated surat
    const updatedSurat = await db.surat.findUnique({ where: { id: suratId } })

    return NextResponse.json({
      success: true,
      document: docMeta,
      surat: updatedSurat ? {
        ...updatedSurat,
        documents: JSON.parse(updatedSurat.documents || '[]'),
      } : null,
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

    const surat = await db.surat.findUnique({ where: { id: suratId } })
    if (!surat) {
      return NextResponse.json({ error: 'Surat tidak ditemukan' }, { status: 404 })
    }

    const existingDocs: DocumentMeta[] = JSON.parse(surat.documents || '[]')
    const docToRemove = existingDocs.find(d => d.id === documentId)

    // Remove from array
    const updatedDocs = existingDocs.filter(d => d.id !== documentId)

    await db.surat.update({
      where: { id: suratId },
      data: { documents: JSON.stringify(updatedDocs) },
    })

    // Delete from Google Drive
    if (docToRemove?.driveFileId) {
      try {
        const settings = await db.settings.findUnique({ where: { id: 'main' } })
        if (settings?.driveServiceAccountKey) {
          const drive = getDriveClient(settings.driveServiceAccountKey)
          await drive.files.delete({
            fileId: docToRemove.driveFileId,
            supportsAllDrives: true,
          })
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
