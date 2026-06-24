import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { getCachedAccessToken } from '@/lib/drive-service'

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

/**
 * Find or create a subfolder inside a parent folder in Google Drive.
 * Used to organize uploaded documents into named subfolders inside the
 * main kegiatan/surat folder (e.g. "Notulensi", "Dokumentasi").
 *
 * Returns the subfolder ID, or the parent folder ID if subfolderName is empty/invalid.
 */
async function findOrCreateSubfolder(
  accessToken: string,
  sharedDriveId: string,
  parentFolderId: string,
  subfolderName: string
): Promise<string> {
  // Sanitize the name (Google Drive forbids certain chars in file names)
  const safeName = subfolderName.trim().replace(/[/\\?%*:|"<>]/g, '-').substring(0, 100)
  if (!safeName) return parentFolderId

  // Search for an existing subfolder with this name inside parentFolderId
  const searchUrl = new URL('https://www.googleapis.com/drive/v3/files')
  // Escape single quotes for Drive query syntax
  const escapedName = safeName.replace(/'/g, "\\'")
  searchUrl.searchParams.set('q', `name='${escapedName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`)
  searchUrl.searchParams.set('corpora', 'drive')
  searchUrl.searchParams.set('driveId', sharedDriveId)
  searchUrl.searchParams.set('fields', 'files(id,name,parents)')
  searchUrl.searchParams.set('supportsAllDrives', 'true')
  searchUrl.searchParams.set('includeItemsFromAllDrives', 'true')
  searchUrl.searchParams.set('pageSize', '10')

  const searchResp = await fetch(searchUrl.toString(), {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  })

  if (searchResp.ok) {
    const searchData = await searchResp.json()
    if (Array.isArray(searchData.files)) {
      for (const f of searchData.files) {
        if (f.id && Array.isArray(f.parents) && f.parents.includes(parentFolderId)) {
          return f.id
        }
      }
    }
  }

  // Not found — create the subfolder inside parentFolderId
  const createUrl = new URL('https://www.googleapis.com/drive/v3/files')
  createUrl.searchParams.set('fields', 'id,name')
  createUrl.searchParams.set('supportsAllDrives', 'true')

  const createResp = await fetch(createUrl.toString(), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: safeName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId],
    }),
  })

  if (createResp.ok) {
    const createData = await createResp.json()
    if (createData.id) {
      console.log(`[UPLOAD-URL] Created subfolder "${safeName}" inside ${parentFolderId}`)
      return createData.id
    }
  }

  // Fallback: upload to parent folder if subfolder creation failed
  console.error('[UPLOAD-URL] Failed to create subfolder, falling back to parent folder')
  return parentFolderId
}

export async function POST(request: NextRequest) {
  try {
    const { fileName, mimeType, folderId, autoNameMeta, subfolderName } = await request.json()

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

    // Use CACHED access token — this endpoint is called once per file upload,
    // but caching ensures the token is shared with the subsequent chunk uploads.
    const accessToken = await getCachedAccessToken(settings.driveServiceAccountKey)

    // Determine the target folder for the file upload.
    // If subfolderName is provided, find or create a subfolder inside folderId.
    // This organizes documents into named subfolders inside the main kegiatan/surat folder.
    let targetFolderId = folderId
    if (subfolderName && typeof subfolderName === 'string' && subfolderName.trim() && settings.driveSharedDriveId) {
      targetFolderId = await findOrCreateSubfolder(
        accessToken,
        settings.driveSharedDriveId,
        folderId,
        subfolderName
      )
    }

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
        parents: [targetFolderId]
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

    // Return targetFolderId so the frontend can cache it for subsequent files
    // with the same subfolderName (avoids redundant subfolder lookups).
    return NextResponse.json({ uploadUrl, autoFileName: finalFileName, folderId: targetFolderId })
  } catch (error) {
    console.error('[UPLOAD-URL] Error:', error)
    return NextResponse.json(
      { error: 'Terjadi kesalahan saat menyiapkan upload' },
      { status: 500 }
    )
  }
}

