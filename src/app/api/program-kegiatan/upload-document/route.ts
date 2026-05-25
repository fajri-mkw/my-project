import { db, ensureDbConnection } from '@/lib/db'
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

// Find or create Year > Month > KEGIATAN folder hierarchy
async function findOrCreateKegiatanMonthFolder(
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
    console.log(`[KEGIATAN DOC] Created Year folder: ${year}`)
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
    console.log(`[KEGIATAN DOC] Created Month folder: ${monthName}`)
  }

  // Search for KEGIATAN folder inside Month
  const kegiatanQuery = `name='KEGIATAN' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const kegiatanResult = await drive.files.list({
    q: kegiatanQuery,
    corpora: 'drive',
    driveId: sharedDriveId,
    fields: 'files(id, name)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    pageSize: 10
  })

  let kegiatanFolderId: string | null = null
  if (kegiatanResult.data.files) {
    for (const f of kegiatanResult.data.files) {
      if (!f.id) continue
      const parents = await drive.files.get({ fileId: f.id, fields: 'parents', supportsAllDrives: true })
      const parentList = (parents.data as any).parents || []
      if (parentList.includes(monthFolderId)) {
        kegiatanFolderId = f.id
        break
      }
    }
  }

  if (!kegiatanFolderId) {
    const kegiatanMetadata: any = {
      name: 'KEGIATAN', mimeType: 'application/vnd.google-apps.folder',
      driveId: sharedDriveId, parents: [monthFolderId]
    }
    const kegiatanResp = await drive.files.create({ requestBody: kegiatanMetadata, fields: 'id', supportsAllDrives: true })
    kegiatanFolderId = kegiatanResp.data.id!
    console.log(`[KEGIATAN DOC] Created KEGIATAN folder in ${monthName} ${year}`)
  }

  return kegiatanFolderId
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

// POST - Upload document to kegiatan's Google Drive folder
export async function POST(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    await ensureDbConnection()
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const kegiatanId = formData.get('kegiatanId') as string | null
    const fileName = formData.get('fileName') as string | null

    if (!file || !kegiatanId) {
      return NextResponse.json({ error: 'File dan Kegiatan ID diperlukan' }, { status: 400 })
    }

    // Verify kegiatan exists
    const kegiatan = await db.programKegiatan.findUnique({ where: { id: kegiatanId } })
    if (!kegiatan) {
      return NextResponse.json({ error: 'Kegiatan tidak ditemukan' }, { status: 404 })
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

    // Determine target folder: use kegiatan's driveFolderId, or create a new one
    let targetFolderId = kegiatan.driveFolderId

    if (!targetFolderId) {
      // Auto-create folder for this kegiatan inside Year > Month > KEGIATAN structure
      const kegiatanDate = kegiatan.tanggalKegiatan ? new Date(kegiatan.tanggalKegiatan) : new Date()
      const dateStr = kegiatanDate.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' })
      const folderName = `${kegiatan.perihal} - ${dateStr}`

      const kegiatanParentFolderId = await findOrCreateKegiatanMonthFolder(
        drive,
        settings.driveSharedDriveId,
        settings.driveParentFolderId || settings.driveSharedDriveId,
        kegiatanDate
      )

      const folderMetadata: any = {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        driveId: settings.driveSharedDriveId,
        parents: [kegiatanParentFolderId]
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
        console.error('[KEGIATAN DOC] Failed to share folder:', shareErr)
      }

      // Update kegiatan with folder info
      await db.programKegiatan.update({
        where: { id: kegiatanId },
        data: {
          driveFolderId: targetFolderId,
          driveFolderLink: folderResponse.data.webViewLink,
        }
      })

      console.log(`[KEGIATAN DOC] Created folder "${folderName}" (${targetFolderId})`)
    }

    // Upload file to the folder using the RENAMED filename
    const uploadFileName = fileName || file.name
    const buffer = Buffer.from(await file.arrayBuffer())

    const fileMetadata: any = {
      name: uploadFileName,
      mimeType: file.type || 'application/octet-stream',
      driveId: settings.driveSharedDriveId,
      parents: [targetFolderId],
    }

    console.log(`[KEGIATAN DOC] Uploading "${uploadFileName}" (${(file.size / 1024).toFixed(1)}KB) to folder ${targetFolderId}...`)

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
    console.log(`[KEGIATAN DOC] Upload success: ${driveFileId} — ${driveResponse.data.name}`)

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
      console.error('[KEGIATAN DOC] Failed to share file:', shareErr)
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

    // Save metadata to kegiatan's documents field
    const existingDocs: DocumentMeta[] = JSON.parse(kegiatan.documents || '[]')
    existingDocs.push(docMeta)

    await db.programKegiatan.update({
      where: { id: kegiatanId },
      data: { documents: JSON.stringify(existingDocs) },
    })

    console.log(`[KEGIATAN DOC] Uploaded "${uploadFileName}" for kegiatan ${kegiatan.nomorKegiatan}`)

    // Return updated kegiatan
    const updatedKegiatan = await db.programKegiatan.findUnique({ where: { id: kegiatanId } })

    return NextResponse.json({
      success: true,
      document: docMeta,
      kegiatan: updatedKegiatan ? {
        ...updatedKegiatan,
        documents: JSON.parse(updatedKegiatan.documents || '[]'),
      } : null,
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
    await ensureDbConnection()
    const { searchParams } = new URL(request.url)
    const kegiatanId = searchParams.get('kegiatanId')
    const documentId = searchParams.get('documentId')

    if (!kegiatanId || !documentId) {
      return NextResponse.json({ error: 'Kegiatan ID dan Document ID diperlukan' }, { status: 400 })
    }

    const kegiatan = await db.programKegiatan.findUnique({ where: { id: kegiatanId } })
    if (!kegiatan) {
      return NextResponse.json({ error: 'Kegiatan tidak ditemukan' }, { status: 404 })
    }

    const existingDocs: DocumentMeta[] = JSON.parse(kegiatan.documents || '[]')
    const docToRemove = existingDocs.find(d => d.id === documentId)

    // Remove from array
    const updatedDocs = existingDocs.filter(d => d.id !== documentId)

    await db.programKegiatan.update({
      where: { id: kegiatanId },
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
