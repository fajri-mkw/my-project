import { NextRequest, NextResponse } from 'next/server'
import { getLibsql, bind } from '@/lib/libsql-client'
import { getCachedSettings } from '@/lib/drive-settings-cache'
import {
  getCachedAccessToken,
  resolveDriveTarget,
  createDriveFolder,
} from '@/lib/drive-service'

// ============================================================================
// POST /api/relasi/create-drive-folder?id=XXX
//
// Buat folder Google Drive untuk form Relasi yang sudah ada (backfill).
// Dipakai oleh admin untuk form yang dibuat SEBELUM auto-create folder
// diimplementasikan, atau jika pembuatan folder gagal saat form dibuat.
//
// Idempotent: jika form sudah punya driveFolderId, return existing ID tanpa
// membuat folder baru (kecuali ?force=true).
//
// Admin-only (X-User-Role: Admin/Manager/PublisherWeb/PublisherSocialMedia).
// ============================================================================

export async function POST(request: NextRequest) {
  const userRole = request.headers.get('X-User-Role')
  if (!['Admin', 'Manager', 'PublisherWeb', 'PublisherSocialMedia'].includes(userRole || '')) {
    return NextResponse.json({ error: 'Hanya Super Admin' }, { status: 403 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const force = searchParams.get('force') === 'true'

    if (!id) {
      return NextResponse.json({ error: 'id wajib diisi' }, { status: 400 })
    }

    // Ambil form
    const client = getLibsql()
    const res = await client.execute({
      sql: `SELECT id, title, driveFolderId FROM relasi_forms WHERE id = ? LIMIT 1`,
      args: [bind(id)],
    })
    if (res.rows.length === 0) {
      return NextResponse.json({ error: 'Form tidak ditemukan' }, { status: 404 })
    }
    const form = res.rows[0] as Record<string, unknown>
    const existingFolderId = form.driveFolderId != null ? String(form.driveFolderId) : null

    // Idempotent: jika sudah ada dan tidak force, return existing
    if (existingFolderId && !force) {
      return NextResponse.json({
        success: true,
        driveFolderId: existingFolderId,
        message: 'Form sudah punya driveFolderId (gunakan ?force=true untuk buat ulang)',
      })
    }

    // Buat folder baru
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
        { error: 'Root folder Google Drive belum dikonfigurasi. Set Shared Drive ID atau Folder ID di Pengaturan.' },
        { status: 400 },
      )
    }

    const accessToken = await getCachedAccessToken(settings.driveServiceAccountKey)
    const driveIdForCreate = target.isSharedDrive ? target.rootId : ''
    const safeTitle = (String(form.title || 'Form')).replace(/[/\\?%*:|"<>]/g, '-').substring(0, 80)
    const folderName = `Relasi - ${safeTitle}`
    const created = await createDriveFolder(accessToken, {
      name: folderName,
      parentId: target.rootId,
      sharedDriveId: driveIdForCreate,
    })

    // Simpan folder ID ke form
    await client.execute({
      sql: `UPDATE relasi_forms SET driveFolderId = ? WHERE id = ?`,
      args: [bind(created.id), bind(id)],
    })

    return NextResponse.json({
      success: true,
      driveFolderId: created.id,
      folderLink: created.webViewLink,
      message: 'Folder Google Drive berhasil dibuat untuk form ini',
    })
  } catch (error) {
    console.error('[RELASI CREATE-DRIVE-FOLDER] Error:', error)
    const msg = error instanceof Error ? error.message : 'Gagal membuat folder'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
