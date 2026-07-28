import { NextRequest, NextResponse } from 'next/server'
import { getLibsql } from '@/lib/libsql-client'
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

// 15 second timeout for Google Drive API calls (init + subfolder creation).
// On cold isolates, the TLS handshake + API call can take 5-10s. We use a
// shorter timeout (15s) + internal retry (2 attempts) instead of one long
// timeout. This way, if the first attempt times out on a cold TLS connection,
// the retry benefits from the now-warm connection and completes quickly.
// Note: getCachedAccessToken has its own 15s timeout for the OAuth fetch.
const DRIVE_API_TIMEOUT_MS = 15_000

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DRIVE_API_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { fileName, mimeType, folderId, autoNameMeta, subfolderName } = body as {
      fileName: string
      mimeType?: string
      folderId: string
      autoNameMeta?: {
        projectTitle?: string
        executionTime?: string
        uploaderName?: string
        seriesNumber?: number
      }
      subfolderName?: string
    }

    if (!fileName || !folderId) {
      return NextResponse.json({ error: 'fileName dan folderId wajib diisi' }, { status: 400 })
    }

    // Reject constructed/mock folder IDs
    const knownPrefixes = ['raw-', 'revised-', 'final-', 'desain-', 'lainnya-', 'mock-']
    if (knownPrefixes.some(p => folderId.startsWith(p)) || folderId.length < 20) {
      return NextResponse.json(
        { error: 'Folder ID tidak valid. Pastikan Google Drive sudah terhubung.' },
        { status: 400 },
      )
    }

    // === Use lightweight libsql client instead of Prisma ===
    // Prisma's client initialization + query building adds ~3-5ms CPU per call.
    // On Cloudflare Workers free plan (10ms CPU limit), every millisecond counts.
    let settings: { driveServiceAccountKey: string | null; driveSharedDriveId: string | null } | null = null
    try {
      const client = getLibsql()
      const result = await client.execute({
        sql: `SELECT driveServiceAccountKey, driveSharedDriveId FROM settings WHERE id = 'main' LIMIT 1`,
        args: [],
      })
      if (result.rows.length > 0) {
        const row = result.rows[0]
        settings = {
          driveServiceAccountKey: (row.driveServiceAccountKey as string) || null,
          driveSharedDriveId: (row.driveSharedDriveId as string) || null,
        }
      }
    } catch (dbErr) {
      console.error('[UPLOAD-URL] settings fetch error:', dbErr)
      return NextResponse.json(
        { error: 'Gagal membaca konfigurasi Google Drive. Coba lagi.' },
        { status: 500 },
      )
    }

    if (!settings?.driveServiceAccountKey) {
      return NextResponse.json({ error: 'Google Drive belum dikonfigurasi' }, { status: 400 })
    }

    // Use CACHED access token — this endpoint is called once per file upload,
    // but caching ensures the token is shared with the subsequent chunk uploads.
    let accessToken: string
    try {
      accessToken = await getCachedAccessToken(settings.driveServiceAccountKey)
    } catch (tokenErr) {
      console.error('[UPLOAD-URL] access token error:', tokenErr)
      return NextResponse.json(
        { error: 'Gagal autentikasi ke Google Drive. Periksa Service Account Key.' },
        { status: 502 },
      )
    }

    // Determine the target folder for the file upload.
    // If subfolderName is provided, find or create a subfolder inside folderId.
    let targetFolderId = folderId
    if (
      subfolderName &&
      typeof subfolderName === 'string' &&
      subfolderName.trim() &&
      settings.driveSharedDriveId
    ) {
      try {
        targetFolderId = await findOrCreateSubfolder(
          accessToken,
          settings.driveSharedDriveId,
          folderId,
          subfolderName,
        )
      } catch (subErr) {
        console.error('[UPLOAD-URL] subfolder creation failed, using parent:', subErr)
        // Fall back to parent folder — non-fatal
      }
    }

    // Generate auto-formatted filename if metadata provided
    const finalFileName = autoNameMeta
      ? buildAutoFileName(fileName, autoNameMeta)
      : fileName

    // Initiate resumable upload session.
    // Retry up to 2 times on transient failures (timeout, 5xx). On a cold
    // isolate, the first attempt may timeout during TLS handshake to Google
    // Drive. The retry benefits from the now-warm TLS connection.
    const initUrl = new URL('https://www.googleapis.com/upload/drive/v3/files')
    initUrl.searchParams.set('uploadType', 'resumable')
    initUrl.searchParams.set('fields', 'id,name,webViewLink,webContentLink')
    initUrl.searchParams.set('supportsAllDrives', 'true')

    const initBody = JSON.stringify({
      name: finalFileName,
      mimeType: mimeType || 'application/octet-stream',
      parents: [targetFolderId],
    })
    const initHeaders = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    }

    let response: Response | null = null
    let lastInitError: Error | null = null
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await fetchWithTimeout(initUrl.toString(), {
          method: 'POST',
          headers: initHeaders,
          body: initBody,
        })
        // Success or 4xx (client error — don't retry)
        break
      } catch (fetchErr) {
        lastInitError = fetchErr instanceof Error ? fetchErr : new Error(String(fetchErr))
        const isAbort = lastInitError.name === 'AbortError'
        console.error(`[UPLOAD-URL] Drive init attempt ${attempt + 1} failed:`, isAbort ? 'TIMEOUT' : lastInitError.message)
        // Retry only on timeout/abort (cold TLS). Other errors will be caught below.
        if (!isAbort) break
      }
    }

    if (!response) {
      const aborted = lastInitError?.name === 'AbortError'
      return NextResponse.json(
        {
          error: aborted
            ? 'Permintaan ke Google Drive timeout. Coba lagi.'
            : 'Gagal menghubungi Google Drive. Coba lagi.',
        },
        { status: aborted ? 504 : 502 },
      )
    }

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[UPLOAD-URL] Google API error:', response.status, errorText.substring(0, 300))
      return NextResponse.json(
        { error: `Gagal membuat sesi upload: HTTP ${response.status}` },
        { status: 502 },
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
    const aborted = error instanceof Error && error.name === 'AbortError'
    return NextResponse.json(
      {
        error: aborted
          ? 'Permintaan ke Google Drive timeout. Coba lagi.'
          : 'Terjadi kesalahan saat menyiapkan upload',
      },
      { status: aborted ? 504 : 500 },
    )
  }
}
