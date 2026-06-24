import { db, ensureDbConnection } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'
import { google } from 'googleapis'
import { getDriveClient, getCachedAccessToken, shareWithAnyone } from '@/lib/drive-service'

// Indonesian month names (same as upload-document route)
const BULAN_INDONESIA = [
  '01 Januari', '02 Februari', '03 Maret', '04 April',
  '05 Mei', '06 Juni', '07 Juli', '08 Agustus',
  '09 September', '10 Oktober', '11 November', '12 Desember'
]

// Find or create Year > Month > SURAT folder hierarchy
// (extracted from surat/upload-document/route.ts for reuse)
async function findOrCreateSuratMonthFolder(
  drive: ReturnType<typeof google.drive>,
  sharedDriveId: string,
  rootParentId: string,
  date: Date
): Promise<string> {
  const year = date.getFullYear().toString()
  const monthName = BULAN_INDONESIA[date.getMonth()]

  const yearQuery = `name='${year}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const yearResult = await drive.files.list({
    q: yearQuery, corpora: 'drive', driveId: sharedDriveId,
    fields: 'files(id, name)', supportsAllDrives: true,
    includeItemsFromAllDrives: true, pageSize: 10
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
    const yearResp = await drive.files.create({
      requestBody: { name: year, mimeType: 'application/vnd.google-apps.folder', driveId: sharedDriveId, parents: [rootParentId] },
      fields: 'id', supportsAllDrives: true
    })
    yearFolderId = yearResp.data.id!
  }

  const monthQuery = `name='${monthName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const monthResult = await drive.files.list({
    q: monthQuery, corpora: 'drive', driveId: sharedDriveId,
    fields: 'files(id, name)', supportsAllDrives: true,
    includeItemsFromAllDrives: true, pageSize: 10
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
    const monthResp = await drive.files.create({
      requestBody: { name: monthName, mimeType: 'application/vnd.google-apps.folder', driveId: sharedDriveId, parents: [yearFolderId] },
      fields: 'id', supportsAllDrives: true
    })
    monthFolderId = monthResp.data.id!
  }

  const suratQuery = `name='SURAT' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const suratResult = await drive.files.list({
    q: suratQuery, corpora: 'drive', driveId: sharedDriveId,
    fields: 'files(id, name)', supportsAllDrives: true,
    includeItemsFromAllDrives: true, pageSize: 10
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
    const suratResp = await drive.files.create({
      requestBody: { name: 'SURAT', mimeType: 'application/vnd.google-apps.folder', driveId: sharedDriveId, parents: [monthFolderId] },
      fields: 'id', supportsAllDrives: true
    })
    suratFolderId = suratResp.data.id!
  }

  return suratFolderId
}

/**
 * POST /api/surat/prepare-upload
 *
 * Returns the Google Drive folder ID for a surat (creates it if it doesn't exist).
 * The frontend then uses this folder ID with the chunked resumable upload path
 * (/api/drive/upload-url + /api/drive/upload-chunk) to upload files of ANY size.
 *
 * This replaces the old flow where /api/surat/upload-document loaded the ENTIRE
 * file into memory (causing OOM crashes on Cloudflare Workers for files > ~40 MB).
 *
 * Body: { suratId: string }
 * Returns: { folderId: string, driveFolderLink?: string }
 */
export async function POST(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    await ensureDbConnection()
    const { suratId } = await request.json()

    if (!suratId) {
      return NextResponse.json({ error: 'Surat ID wajib diisi' }, { status: 400 })
    }

    const surat = await db.surat.findUnique({ where: { id: suratId } })
    if (!surat) {
      return NextResponse.json({ error: 'Surat tidak ditemukan' }, { status: 404 })
    }

    const settings = await db.settings.findUnique({ where: { id: 'main' } })
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
    const drive = getDriveClient(settings.driveServiceAccountKey)
    const suratDate = surat.tanggalSurat ? new Date(surat.tanggalSurat) : new Date()

    const suratParentFolderId = await findOrCreateSuratMonthFolder(
      drive,
      settings.driveSharedDriveId,
      settings.driveParentFolderId || settings.driveSharedDriveId,
      suratDate
    )

    const folderName = `Surat - ${surat.nomorSurat} - ${surat.perihal.substring(0, 50)}`
    const folderResponse = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        driveId: settings.driveSharedDriveId,
        parents: [suratParentFolderId]
      },
      fields: 'id, webViewLink',
      supportsAllDrives: true
    })

    const targetFolderId = folderResponse.data.id!

    // Share folder with anyone who has the link (reader)
    try {
      const accessToken = await getCachedAccessToken(settings.driveServiceAccountKey)
      await shareWithAnyone(accessToken, targetFolderId, 'reader')
    } catch (shareErr) {
      console.error('[SURAT PREPARE] Failed to share folder:', shareErr)
    }

    // Update surat with folder info
    await db.surat.update({
      where: { id: suratId },
      data: {
        driveFolderId: targetFolderId,
        driveFolderLink: folderResponse.data.webViewLink,
      }
    })

    console.log(`[SURAT PREPARE] Created folder "${folderName}" (${targetFolderId})`)

    return NextResponse.json({
      folderId: targetFolderId,
      driveFolderLink: folderResponse.data.webViewLink,
    })
  } catch (error) {
    console.error('[SURAT PREPARE] Error:', error)
    return NextResponse.json(
      { error: 'Gagal menyiapkan folder upload: ' + (error instanceof Error ? error.message : 'Unknown error') },
      { status: 500 }
    )
  }
}
