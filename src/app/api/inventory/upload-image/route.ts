import { NextRequest, NextResponse } from 'next/server'
import { uploadFileToDrive, getAccessToken, shareWithAnyone, resolveDriveTarget } from '@/lib/drive-service'
import { readDriveSettings, findOrCreateYearMonthCategoryFolder } from '@/lib/drive-helpers'

// POST /api/inventory/upload-image — upload inventory photo to Drive
export async function POST(request: NextRequest) {
  const userRole = request.headers.get('X-User-Role')
  if (!['Admin', 'Administrator'].includes(userRole || '')) return NextResponse.json({ error: 'Hanya Super Admin' }, { status: 403 })

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'File wajib diisi' }, { status: 400 })
    if (!file.type.startsWith('image/')) return NextResponse.json({ error: 'Hanya file gambar' }, { status: 400 })
    if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: 'Maksimal 10MB' }, { status: 400 })

    const settings = await readDriveSettings()
    if (!settings?.driveServiceAccountKey) return NextResponse.json({ error: 'Drive belum dikonfigurasi' }, { status: 400 })
    const target = resolveDriveTarget(settings)
    if (!target) return NextResponse.json({ error: 'Drive target tidak dikonfigurasi' }, { status: 400 })

    const now = new Date()
    const folderId = await findOrCreateYearMonthCategoryFolder(settings, 'INVENTORY', now)

    const fileName = `INV-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const fileContent = new Uint8Array(await file.arrayBuffer())
    const driveIdForCreate = target.isSharedDrive ? target.rootId : undefined

    const driveResponse = await uploadFileToDrive({
      serviceAccountKey: settings.driveServiceAccountKey,
      fileName, mimeType: file.type, content: fileContent,
      parents: [folderId], sharedDriveId: driveIdForCreate,
    })

    try {
      const accessToken = await getAccessToken(settings.driveServiceAccountKey)
      await shareWithAnyone(accessToken, driveResponse.id, 'reader')
    } catch {}

    return NextResponse.json({
      success: true,
      imageFileId: driveResponse.id,
      imageUrl: driveResponse.webViewLink || `https://drive.google.com/file/d/${driveResponse.id}/view`,
    })
  } catch (error) {
    console.error('[INVENTORY IMAGE UPLOAD] Error:', error)
    return NextResponse.json({ error: 'Gagal mengunggah foto' }, { status: 500 })
  }
}
