import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { getCachedAccessToken, clearCachedAccessToken, shareWithAnyone } from '@/lib/drive-service'

/**
 * Chunked upload endpoint — forwards file chunks to Google Drive's resumable
 * upload session URL.
 *
 * CRITICAL PERFORMANCE NOTES:
 * This endpoint is called once per chunk (e.g. 18 times for a 143 MB file with
 * 8 MB chunks). To stay within Cloudflare Workers' CPU/wall-clock limits, this
 * endpoint is intentionally lightweight:
 *
 *   1. NO checkMaintenanceMode()  — maintenance mode must not block in-progress uploads
 *   2. NO ensureDbConnection()    — schema sync is unnecessary; we only read the settings row
 *   3. CACHED access token        — avoids re-signing a JWT (RSA-256) on every chunk
 *   4. Direct fetch for sharing   — avoids googleapis overhead on the final chunk
 *
 * The chunk size MUST match the frontend (file-upload.tsx). Both are set to 8 MB.
 */
const CHUNK_SIZE = 8 * 1024 * 1024 // 8 MB — must match frontend file-upload.tsx

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const uploadUrl = formData.get('uploadUrl') as string
    const chunkIndex = parseInt(formData.get('chunkIndex') as string, 10)
    const totalSize = parseInt(formData.get('totalSize') as string, 10)
    const chunk = formData.get('chunk') as File

    if (!uploadUrl || isNaN(chunkIndex) || isNaN(totalSize) || !chunk) {
      return NextResponse.json({ error: 'Parameter tidak lengkap' }, { status: 400 })
    }

    // Lightweight settings fetch — no schema sync, no maintenance check.
    // The settings row always exists (created during initial migration).
    const settings = await db.settings.findUnique({ where: { id: 'main' } })
    if (!settings?.driveServiceAccountKey) {
      return NextResponse.json({ error: 'Google Drive belum dikonfigurasi' }, { status: 400 })
    }

    // Use CACHED access token — eliminates JWT signing on all but the first chunk.
    // This is the single most important optimization for large file uploads.
    let accessToken: string
    try {
      accessToken = await getCachedAccessToken(settings.driveServiceAccountKey)
    } catch {
      // If token fetch fails, try once more with a fresh token (clear cache first)
      clearCachedAccessToken()
      accessToken = await getCachedAccessToken(settings.driveServiceAccountKey)
    }

    // Calculate byte range for this chunk
    const start = chunkIndex * CHUNK_SIZE
    const chunkData = new Uint8Array(await chunk.arrayBuffer())
    const end = start + chunkData.length - 1

    // Forward chunk to Google Drive resumable upload session
    const driveResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/octet-stream',
        'Content-Range': `bytes ${start}-${end}/${totalSize}`,
        'Content-Length': chunkData.length.toString(),
      },
      body: chunkData,
    })

    // 308 = Resume Incomplete (more chunks needed)
    if (driveResponse.status === 308) {
      return NextResponse.json({
        complete: false,
        nextChunk: chunkIndex + 1,
      })
    }

    // 200/201 = Upload Complete (this was the final chunk)
    if (driveResponse.status === 200 || driveResponse.status === 201) {
      let fileData: Record<string, string | undefined> = {}
      try {
        fileData = await driveResponse.json()
      } catch {
        // Response body might be empty — that's OK, we'll fetch metadata below
      }

      // Share the file with "anyone with the link" using direct fetch.
      // We use the cached token + shareWithAnyone helper (no googleapis overhead).
      if (fileData?.id) {
        await shareWithAnyone(accessToken, fileData.id, 'writer')

        // If webViewLink is missing, try to fetch file metadata
        if (!fileData.webViewLink) {
          try {
            const metaResp = await fetch(
              `https://www.googleapis.com/drive/v3/files/${fileData.id}?fields=id,name,webViewLink,webContentLink&supportsAllDrives=true`,
              { headers: { 'Authorization': `Bearer ${accessToken}` } },
            )
            if (metaResp.ok) {
              const metaData = await metaResp.json()
              fileData = { ...fileData, ...metaData }
            }
          } catch {
            // Non-critical — the file was uploaded successfully
          }
        }
      }

      return NextResponse.json({
        complete: true,
        file: {
          id: fileData.id,
          name: fileData.name,
          webViewLink: fileData.webViewLink,
          webContentLink: fileData.webContentLink,
        },
      })
    }

    // Unexpected status from Google
    const errorText = await driveResponse.text()
    console.error('[UPLOAD-CHUNK] Google API error:', driveResponse.status, errorText)

    // 401/403 = token expired or revoked — clear cache so next chunk gets a fresh token
    if (driveResponse.status === 401 || driveResponse.status === 403) {
      clearCachedAccessToken()
    }

    return NextResponse.json(
      { error: `Upload gagal: HTTP ${driveResponse.status}` },
      { status: 502 },
    )
  } catch (error) {
    console.error('[UPLOAD-CHUNK] Error:', error)
    const msg = error instanceof Error ? error.message : 'Gagal mengupload chunk'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
