import { NextRequest, NextResponse } from 'next/server'
import { getCachedSettings } from '@/lib/drive-settings-cache'
import {
  getCachedAccessToken,
  resolveDriveTarget,
  createDriveFolder,
  listFoldersByParent,
} from '@/lib/drive-service'

// ============================================================================
// POST /api/relasi/upload-example
//
// Inisiasi upload "file contoh" (template/panduan) ke Google Drive.
// File contoh disimpan di subfolder "Relasi - Contoh" di root Drive (dibuat
// sekali, dipakai ulang untuk semua form). Endpoint ini HANYA mengembalikan
// URL sesi upload + folderId target — upload bytes dilakukan browser via
// chunkedUploadFile (sama seperti surat/project).
//
// Response: { uploadUrl, folderId, driveMode }
//
// Admin-only (X-User-Role: Admin/Manager/PublisherWeb/PublisherSocialMedia).
// ============================================================================

const SHARED_CONTOH_FOLDER_NAME = 'Relasi - Contoh'

export async function POST(request: NextRequest) {
  const userRole = request.headers.get('X-User-Role')
  if (!['Admin', 'Manager', 'PublisherWeb', 'PublisherSocialMedia'].includes(userRole || '')) {
    return NextResponse.json({ error: 'Hanya Super Admin' }, { status: 403 })
  }

  try {
    const body = await request.json()
    const { fileName, mimeType } = body as { fileName?: string; mimeType?: string }

    if (!fileName) {
      return NextResponse.json({ error: 'fileName wajib diisi' }, { status: 400 })
    }

    // Ambil settings Drive
    const settings = await getCachedSettings()
    if (!settings?.driveServiceAccountKey) {
      return NextResponse.json(
        { error: 'Google Drive belum dikonfigurasi. Aktifkan di Pengaturan.' },
        { status: 400 },
      )
    }
    const target = resolveDriveTarget(settings)
    if (!target) {
      return NextResponse.json(
        { error: 'Root folder Google Drive belum dikonfigurasi.' },
        { status: 400 },
      )
    }

    // Dapatkan access token
    const accessToken = await getCachedAccessToken(settings.driveServiceAccountKey)
    const driveIdForCreate = target.isSharedDrive ? target.rootId : ''

    // Cari atau buat folder "Relasi - Contoh" di root Drive
    let contohFolderId = target.rootId // default: root
    try {
      const existing = await listFoldersByParent(accessToken, target.rootId, SHARED_CONTOH_FOLDER_NAME)
      if (existing.length > 0 && existing[0].id) {
        contohFolderId = existing[0].id
      } else {
        const created = await createDriveFolder(accessToken, {
          name: SHARED_CONTOH_FOLDER_NAME,
          parentId: target.rootId,
          sharedDriveId: driveIdForCreate,
        })
        if (created?.id) {
          contohFolderId = created.id
        }
      }
    } catch (folderErr) {
      console.error('[RELASI UPLOAD-EXAMPLE] Folder setup failed:', folderErr)
      // Fallback: upload ke root folder
      contohFolderId = target.rootId
    }

    // Inisiasi sesi upload resumable ke Google Drive
    const initUrl = new URL('https://www.googleapis.com/upload/drive/v3/files')
    initUrl.searchParams.set('uploadType', 'resumable')
    initUrl.searchParams.set('fields', 'id,name,webViewLink,webContentLink')
    initUrl.searchParams.set('supportsAllDrives', 'true')

    const initBody = JSON.stringify({
      name: fileName,
      mimeType: mimeType || 'application/octet-stream',
      parents: [contohFolderId],
    })

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    let response: Response
    try {
      response = await fetch(initUrl.toString(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body: initBody,
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      console.error('[RELASI UPLOAD-EXAMPLE] Drive init error:', response.status, errText.substring(0, 200))
      return NextResponse.json(
        { error: `Gagal membuat sesi upload: HTTP ${response.status}` },
        { status: 502 },
      )
    }

    const uploadUrl = response.headers.get('Location')
    if (!uploadUrl) {
      return NextResponse.json({ error: 'Gagal mendapatkan URL upload' }, { status: 502 })
    }

    return NextResponse.json({
      uploadUrl,
      folderId: contohFolderId,
      driveMode: target.mode,
    })
  } catch (error) {
    console.error('[RELASI UPLOAD-EXAMPLE] Error:', error)
    const msg = error instanceof Error ? error.message : 'Gagal menyiapkan upload'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
