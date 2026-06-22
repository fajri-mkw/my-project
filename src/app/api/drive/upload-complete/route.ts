import { db, ensureDbConnection } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'
import { getCachedAccessToken, shareWithAnyone } from '@/lib/drive-service'

export async function POST(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    await ensureDbConnection()
    const { fileId } = await request.json()

    if (!fileId) {
      return NextResponse.json({ error: 'fileId wajib diisi' }, { status: 400 })
    }

    const settings = await db.settings.findUnique({ where: { id: 'main' } })
    if (!settings?.driveServiceAccountKey) {
      return NextResponse.json({ error: 'Google Drive belum dikonfigurasi' }, { status: 400 })
    }

    // Use cached access token
    const accessToken = await getCachedAccessToken(settings.driveServiceAccountKey)

    // Get file metadata via direct fetch
    const metaResp = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,webViewLink,webContentLink&supportsAllDrives=true`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } },
    )

    if (!metaResp.ok) {
      const errText = await metaResp.text()
      console.error('[UPLOAD-COMPLETE] Failed to get file metadata:', metaResp.status, errText)
      return NextResponse.json({ error: 'Gagal mendapatkan metadata file' }, { status: 502 })
    }

    const fileData = await metaResp.json()

    // Share with anyone (writer access) using direct fetch
    await shareWithAnyone(accessToken, fileId, 'writer')

    return NextResponse.json({
      success: true,
      file: {
        id: fileData.id,
        name: fileData.name,
        webViewLink: fileData.webViewLink,
        webContentLink: fileData.webContentLink,
      },
    })
  } catch (error) {
    console.error('[UPLOAD-COMPLETE] Error:', error)
    return NextResponse.json(
      { error: 'Gagal menyelesaikan upload' },
      { status: 500 },
    )
  }
}
