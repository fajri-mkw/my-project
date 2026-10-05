import { NextRequest, NextResponse } from 'next/server'
import { getCachedAccessToken, resolveDriveTarget } from '@/lib/drive-service'
import { readDriveSettings } from '@/lib/drive-helpers'
import { getLibsql, bind, nowMs } from '@/lib/libsql-client'

// POST /api/relasi/upload — upload foto dari publik ke Drive (tanpa login)
// Body: FormData { file, formId }
// Returns: { success, fileId, url }
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const formId = formData.get('formId') as string | null

    if (!file) return NextResponse.json({ error: 'File wajib diisi' }, { status: 400 })
    if (!file.type.startsWith('image/')) return NextResponse.json({ error: 'Hanya file gambar' }, { status: 400 })
    if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: 'Maksimal 10MB' }, { status: 400 })
    if (!formId) return NextResponse.json({ error: 'formId wajib diisi' }, { status: 400 })

    // Cek form exists dan active
    const client = getLibsql()
    const formRes = await client.execute({
      sql: `SELECT id, title, driveFolderId, status FROM relasi_forms WHERE id = ? LIMIT 1`,
      args: [bind(formId)],
    })
    if (formRes.rows.length === 0) return NextResponse.json({ error: 'Form tidak ditemukan' }, { status: 404 })
    const form = formRes.rows[0] as Record<string, unknown>
    if (String(form.status) !== 'active') return NextResponse.json({ error: 'Form sudah ditutup' }, { status: 410 })

    // Rate limit upload per IP
    const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown'
    const oneHourAgo = nowMs() - 3600000
    const countRes = await client.execute({
      sql: `SELECT COUNT(*) as cnt FROM relasi_submissions WHERE ipAddress = ? AND createdAt > ?`,
      args: [bind(ip), bind(oneHourAgo)],
    })
    const count = Number((countRes.rows[0] as Record<string, unknown>).cnt || 0)
    if (count >= 10) return NextResponse.json({ error: 'Batas upload tercapai' }, { status: 429 })

    // Upload ke Google Drive
    const settings = await readDriveSettings()
    if (!settings?.driveServiceAccountKey) {
      return NextResponse.json({ error: 'Drive belum dikonfigurasi' }, { status: 400 })
    }

    const accessToken = await getCachedAccessToken(settings.driveServiceAccountKey)
    const target = resolveDriveTarget(settings)
    if (!target) return NextResponse.json({ error: 'Drive target tidak dikonfigurasi' }, { status: 400 })

    // Buat folder untuk form kalau belum ada
    let folderId = form.driveFolderId != null ? String(form.driveFolderId) : null
    if (!folderId) {
      // Buat folder "RELASI" di root Drive, lalu folder dengan nama form
      const now = new Date()
      const monthFolder = await findOrCreateFolder(accessToken, target, 'RELASI')
      const formFolderName = String(form.title || formId).substring(0, 50).replace(/[^a-zA-Z0-9 _-]/g, '_')
      folderId = await findOrCreateFolder(accessToken, { ...target, rootId: monthFolder, isSharedDrive: false }, formFolderName)
      // Simpan folderId
      await client.execute({
        sql: `UPDATE relasi_forms SET driveFolderId = ?, updatedAt = ? WHERE id = ?`,
        args: [bind(folderId), bind(nowMs()), bind(formId)],
      })
    }

    // Upload file
    const fileName = `RELASI-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const fileContent = new Uint8Array(await file.arrayBuffer())
    const metadata: Record<string, unknown> = {
      name: fileName,
      mimeType: file.type,
      parents: [folderId],
    }
    if (target.isSharedDrive) metadata.driveId = target.rootId

    const uploadResp = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink&supportsAllDrives=true', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(metadata),
    })

    if (!uploadResp.ok) {
      const errText = await uploadResp.text().catch(() => '')
      console.error('[RELASI UPLOAD] Drive create error:', uploadResp.status, errText)
      return NextResponse.json({ error: 'Gagal upload ke Drive' }, { status: 502 })
    }

    const driveFile = await uploadResp.json() as { id: string; name: string; webViewLink: string }

    // Upload content via media endpoint
    const mediaResp = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${driveFile.id}?uploadType=media&supportsAllDrives=true`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': file.type,
      },
      body: fileContent,
    })

    if (!mediaResp.ok) {
      console.error('[RELASI UPLOAD] Media upload error:', mediaResp.status)
    }

    // Share with anyone
    try {
      await fetch(`https://www.googleapis.com/drive/v3/files/${driveFile.id}/permissions?supportsAllDrives=true`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role: 'reader', type: 'anyone' }),
      })
    } catch {}

    return NextResponse.json({
      success: true,
      fileId: driveFile.id,
      url: driveFile.webViewLink || `https://drive.google.com/file/d/${driveFile.id}/view`,
      name: fileName,
    })
  } catch (error) {
    console.error('[RELASI UPLOAD] Error:', error)
    return NextResponse.json({ error: 'Gagal upload file' }, { status: 500 })
  }
}

// Helper: find or create folder
async function findOrCreateFolder(accessToken: string, target: { rootId: string; isSharedDrive: boolean }, folderName: string): Promise<string> {
  // Search existing
  const q = `mimeType='application/vnd.google-apps.folder' and name='${folderName.replace(/'/g, "\\'")}' and trashed=false`
  const searchResp = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (searchResp.ok) {
    const searchData = await searchResp.json() as { files: Array<{ id: string }> }
    if (searchData.files && searchData.files.length > 0) return searchData.files[0].id
  }

  // Create new
  const metadata: Record<string, unknown> = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [target.rootId],
  }
  if (target.isSharedDrive) metadata.driveId = target.rootId

  const createResp = await fetch('https://www.googleapis.com/drive/v3/files?fields=id&supportsAllDrives=true', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(metadata),
  })
  if (!createResp.ok) throw new Error('Gagal buat folder')
  const createData = await createResp.json() as { id: string }
  return createData.id
}
