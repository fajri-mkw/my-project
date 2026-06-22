import { db, ensureDbConnection } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'
import { google } from 'googleapis'
import { getDriveClient, getCachedAccessToken, shareWithAnyone } from '@/lib/drive-service'

const BULAN_INDONESIA = [
  '01 Januari', '02 Februari', '03 Maret', '04 April',
  '05 Mei', '06 Juni', '07 Juli', '08 Agustus',
  '09 September', '10 Oktober', '11 November', '12 Desember'
]

async function findOrCreateKegiatanMonthFolder(
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

  const kegiatanQuery = `name='KEGIATAN' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const kegiatanResult = await drive.files.list({
    q: kegiatanQuery, corpora: 'drive', driveId: sharedDriveId,
    fields: 'files(id, name)', supportsAllDrives: true,
    includeItemsFromAllDrives: true, pageSize: 10
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
    const kegiatanResp = await drive.files.create({
      requestBody: { name: 'KEGIATAN', mimeType: 'application/vnd.google-apps.folder', driveId: sharedDriveId, parents: [monthFolderId] },
      fields: 'id', supportsAllDrives: true
    })
    kegiatanFolderId = kegiatanResp.data.id!
  }

  return kegiatanFolderId
}

/**
 * POST /api/program-kegiatan/prepare-upload
 *
 * Returns the Google Drive folder ID for a program kegiatan (creates it if needed).
 * Body: { kegiatanId: string }
 * Returns: { folderId: string, driveFolderLink?: string }
 */
export async function POST(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    await ensureDbConnection()
    const { kegiatanId } = await request.json()

    if (!kegiatanId) {
      return NextResponse.json({ error: 'Kegiatan ID wajib diisi' }, { status: 400 })
    }

    const kegiatan = await db.programKegiatan.findUnique({ where: { id: kegiatanId } })
    if (!kegiatan) {
      return NextResponse.json({ error: 'Kegiatan tidak ditemukan' }, { status: 404 })
    }

    const settings = await db.settings.findUnique({ where: { id: 'main' } })
    if (!settings?.driveServiceAccountKey || !settings?.driveSharedDriveId) {
      return NextResponse.json(
        { error: 'Google Drive belum dikonfigurasi. Hubungi Super Admin.' },
        { status: 400 }
      )
    }

    if (kegiatan.driveFolderId) {
      return NextResponse.json({
        folderId: kegiatan.driveFolderId,
        driveFolderLink: kegiatan.driveFolderLink || undefined,
      })
    }

    const drive = getDriveClient(settings.driveServiceAccountKey)
    const kegiatanDate = kegiatan.tanggalKegiatan ? new Date(kegiatan.tanggalKegiatan) : new Date()
    const dateStr = kegiatanDate.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' })
    const folderName = `${kegiatan.perihal} - ${dateStr}`

    const kegiatanParentFolderId = await findOrCreateKegiatanMonthFolder(
      drive,
      settings.driveSharedDriveId,
      settings.driveParentFolderId || settings.driveSharedDriveId,
      kegiatanDate
    )

    const folderResponse = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        driveId: settings.driveSharedDriveId,
        parents: [kegiatanParentFolderId]
      },
      fields: 'id, webViewLink',
      supportsAllDrives: true
    })

    const targetFolderId = folderResponse.data.id!

    try {
      const accessToken = await getCachedAccessToken(settings.driveServiceAccountKey)
      await shareWithAnyone(accessToken, targetFolderId, 'reader')
    } catch (shareErr) {
      console.error('[KEGIATAN PREPARE] Failed to share folder:', shareErr)
    }

    await db.programKegiatan.update({
      where: { id: kegiatanId },
      data: {
        driveFolderId: targetFolderId,
        driveFolderLink: folderResponse.data.webViewLink,
      }
    })

    console.log(`[KEGIATAN PREPARE] Created folder "${folderName}" (${targetFolderId})`)

    return NextResponse.json({
      folderId: targetFolderId,
      driveFolderLink: folderResponse.data.webViewLink,
    })
  } catch (error) {
    console.error('[KEGIATAN PREPARE] Error:', error)
    return NextResponse.json(
      { error: 'Gagal menyiapkan folder upload: ' + (error instanceof Error ? error.message : 'Unknown error') },
      { status: 500 }
    )
  }
}
