import { NextRequest, NextResponse } from 'next/server'
import { getCachedSettings } from '@/lib/drive-settings-cache'
import {
  getCachedAccessToken,
  listFoldersByParent,
  createDriveFolder,
  resolveDriveTarget,
} from '@/lib/drive-service'

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
 * DUAL-MODE: uses listFoldersByParent + createDriveFolder from drive-service,
 * which work in BOTH shared-drive mode and folder mode. The mode is resolved
 * from settings via resolveDriveTarget; in shared mode the new subfolder gets
 * driveId metadata (places it in the shared drive), in folder mode it inherits
 * the parent's location (My Drive shared folder).
 *
 * Returns the subfolder ID, or the parent folder ID if subfolderName is empty/invalid.
 */
async function findOrCreateSubfolder(
  accessToken: string,
  driveIdForCreate: string,
  parentFolderId: string,
  subfolderName: string
): Promise<string> {
  // Sanitize the name (Google Drive forbids certain chars in file names)
  const safeName = subfolderName.trim().replace(/[/\\?%*:|"<>]/g, '-').substring(0, 100)
  if (!safeName) return parentFolderId

  // Search for an existing subfolder with this name inside parentFolderId.
  // listFoldersByParent uses the query 'parentId in parents' which works in
  // both shared-drive mode and folder mode (1 subrequest, no parent-traversal).
  try {
    const matches = await listFoldersByParent(accessToken, parentFolderId, safeName)
    if (matches.length > 0 && matches[0].id) {
      return matches[0].id
    }
  } catch (searchErr) {
    // Non-fatal — fall through to create a new subfolder
    console.error('[UPLOAD-URL] subfolder search failed, attempting create:', searchErr)
  }

  // Not found — create the subfolder inside parentFolderId.
  // createDriveFolder accepts sharedDriveId: '' (folder mode) or the drive ID
  // (shared mode), and conditionally sets the driveId metadata field.
  try {
    const created = await createDriveFolder(accessToken, {
      name: safeName,
      parentId: parentFolderId,
      sharedDriveId: driveIdForCreate,
    })
    if (created?.id) {
      console.log(`[UPLOAD-URL] Created subfolder "${safeName}" inside ${parentFolderId} [driveIdForCreate=${driveIdForCreate ? 'set' : 'empty'}]`)
      return created.id
    }
  } catch (createErr) {
    console.error('[UPLOAD-URL] subfolder create failed, falling back to parent:', createErr)
  }

  // Fallback: upload to parent folder if subfolder creation failed
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

    // === Use CACHED settings (module-level, 5-min TTL) ===
    // The /api/drive/warmup endpoint pre-caches settings + access token.
    // If the frontend called warmup first (which it should), this is a
    // cache hit — zero DB query, zero CPU cost. Even without warmup,
    // the cache avoids redundant DB queries across multiple uploads.
    let settings
    try {
      settings = await getCachedSettings()
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
    // Mode-aware: in shared mode, the subfolder gets driveId metadata; in
    // folder mode, it inherits the parent's location (My Drive shared folder).
    const target = resolveDriveTarget(settings)
    const driveIdForCreate = target?.isSharedDrive ? target.rootId : ''
    let targetFolderId = folderId
    if (
      subfolderName &&
      typeof subfolderName === 'string' &&
      subfolderName.trim() &&
      target
    ) {
      try {
        targetFolderId = await findOrCreateSubfolder(
          accessToken,
          driveIdForCreate,
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
