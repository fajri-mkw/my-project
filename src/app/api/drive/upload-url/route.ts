import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'
import { google } from 'googleapis'

/**
 * Generate a sanitized, formatted filename for uploaded files.
 * Pattern: JudulProyek_Waktu_NamaPetugas_01.ext
 */
function buildAutoFileName(
  fileName: string,
  metadata?: {
    projectTitle?: string
    executionTime?: string
    uploaderName?: string
    seriesNumber?: number
  }
): string {
  if (!metadata?.projectTitle) return fileName

  const { projectTitle, executionTime, uploaderName, seriesNumber } = metadata

  // Extract original extension
  const lastDot = fileName.lastIndexOf('.')
  const ext = lastDot > 0 ? fileName.substring(lastDot) : ''

  // Sanitize each part: remove special chars, trim, replace spaces with nothing (compact)
  const clean = (str: string) =>
    str
      .trim()
      .replace(/[/\\:*?"<>|]/g, '') // remove forbidden filename chars
      .replace(/\s+/g, ' ')       // normalize spaces
      .trim()

  const title = clean(projectTitle)
  const time = executionTime
    ? executionTime.replace(/[T:]/g, '-').replace(/\.\d{3}Z?$/, '').replace(/--+/g, '-').substring(0, 16)
    : ''
  const name = uploaderName ? clean(uploaderName) : ''
  const series = seriesNumber ? String(seriesNumber).padStart(2, '0') : ''

  // Build: Title_Waktu_Nama_01.ext
  const parts = [title]
  if (time) parts.push(time)
  if (name) parts.push(name)
  if (series) parts.push(series)

  const newBase = parts.join('_')

  // Google Drive max filename = 255 chars (truncate if needed, keep extension)
  const maxBase = 245 - ext.length
  const truncated = newBase.length > maxBase ? newBase.substring(0, maxBase) : newBase

  return truncated + ext.toLowerCase()
}

export async function POST(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const { fileName, mimeType, folderId, autoNameMeta } = await request.json()

    if (!fileName || !folderId) {
      return NextResponse.json({ error: 'fileName dan folderId wajib diisi' }, { status: 400 })
    }

    // Reject constructed/mock folder IDs
    const knownPrefixes = ['raw-', 'revised-', 'final-', 'desain-', 'lainnya-', 'mock-']
    if (knownPrefixes.some(p => folderId.startsWith(p)) || folderId.length < 20) {
      return NextResponse.json({ error: 'Folder ID tidak valid. Pastikan Google Drive sudah terhubung.' }, { status: 400 })
    }

    const settings = await db.settings.findUnique({ where: { id: 'main' } })
    if (!settings?.driveServiceAccountKey) {
      return NextResponse.json({ error: 'Google Drive belum dikonfigurasi' }, { status: 400 })
    }

    // Authenticate with service account
    const credentials = JSON.parse(settings.driveServiceAccountKey)
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive']
    })

    const authClient = await auth.getClient()
    const accessToken = (await authClient.getAccessToken()).token as string

    // Generate auto-formatted filename if metadata provided
    const finalFileName = autoNameMeta
      ? buildAutoFileName(fileName, autoNameMeta)
      : fileName

    // Initiate resumable upload session
    const initUrl = new URL('https://www.googleapis.com/upload/drive/v3/files')
    initUrl.searchParams.set('uploadType', 'resumable')
    initUrl.searchParams.set('fields', 'id,name,webViewLink,webContentLink')
    initUrl.searchParams.set('supportsAllDrives', 'true')

    const response = await fetch(initUrl.toString(), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({
        name: finalFileName,
        mimeType: mimeType || 'application/octet-stream',
        parents: [folderId]
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[UPLOAD-URL] Google API error:', response.status, errorText)
      return NextResponse.json(
        { error: `Gagal membuat sesi upload: ${response.status}` },
        { status: 502 }
      )
    }

    const uploadUrl = response.headers.get('Location')
    if (!uploadUrl) {
      console.error('[UPLOAD-URL] No Location header in response')
      return NextResponse.json({ error: 'Gagal mendapatkan URL upload' }, { status: 502 })
    }

    return NextResponse.json({ uploadUrl, autoFileName: finalFileName })
  } catch (error) {
    console.error('[UPLOAD-URL] Error:', error)
    return NextResponse.json(
      { error: 'Terjadi kesalahan saat menyiapkan upload' },
      { status: 500 }
    )
  }
}
