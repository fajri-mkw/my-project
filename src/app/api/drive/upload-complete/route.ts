import { db, ensureDbConnection } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'
import { google } from 'googleapis'
import { parseServiceAccountKey, validateServiceAccountCredentials } from '@/lib/drive-service'

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

    const credentials = parseServiceAccountKey(settings.driveServiceAccountKey)
    validateServiceAccountCredentials(credentials)
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive']
    })

    const drive = google.drive({ version: 'v3', auth })

    // Get file metadata
    const file = await drive.files.get({
      fileId,
      fields: 'id, name, webViewLink, webContentLink',
      supportsAllDrives: true
    })

    // Share with anyone (writer access)
    try {
      await drive.permissions.create({
        fileId,
        requestBody: { type: 'anyone', role: 'writer', allowFileDiscovery: false },
        supportsAllDrives: true
      })
    } catch (shareError) {
      console.error('[UPLOAD-COMPLETE] Failed to share file:', shareError)
      // Don't fail the entire request just because sharing failed
    }

    return NextResponse.json({
      success: true,
      file: {
        id: file.data.id,
        name: file.data.name,
        webViewLink: file.data.webViewLink,
        webContentLink: file.data.webContentLink
      }
    })
  } catch (error) {
    console.error('[UPLOAD-COMPLETE] Error:', error)
    return NextResponse.json(
      { error: 'Gagal menyelesaikan upload' },
      { status: 500 }
    )
  }
}
