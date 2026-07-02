import { NextRequest, NextResponse } from 'next/server'
import { getLibsql } from '@/lib/libsql-client'
import { getCachedAccessToken, clearCachedAccessToken, shareWithAnyone } from '@/lib/drive-service'

/**
 * Chunked upload endpoint — forwards file chunks to Google Drive's resumable
 * upload session URL.
 *
 * CRITICAL PERFORMANCE NOTES (Cloudflare Workers free plan = 10ms CPU/request):
 * This endpoint is called once per chunk (e.g. 15 times for a 117 MB file with
 * 8 MB chunks). To stay within the 10ms CPU limit, this endpoint is INTENTIONALLY
 * MINIMAL:
 *
 *   1. NO checkMaintenanceMode()  — maintenance mode must not block in-progress uploads
 *   2. NO ensureDbConnection()    — schema sync is unnecessary; we only read the settings row
 *   3. NO Prisma                  — uses getLibsql() directly (skips Prisma's CPU overhead)
 *   4. CACHED access token        — only fetched ONCE per isolate (avoids RSA-256 JWT signing on every chunk)
 *   5. TOKEN FETCH DEFERRED       — the resumable upload URL is pre-authenticated, so the
 *      access token is NOT needed for the chunk upload itself. We only fetch it on the
 *      FINAL chunk (200/201 response) for the shareWithAnyone call.
 *   6. BLOB PASSED DIRECTLY       — no `arrayBuffer()` + `new Uint8Array()` copy (saves CPU)
 *   7. 25s TIMEOUT                — AbortController prevents hitting CF wall-clock limit
 *
 * The chunk size MUST match the frontend (file-upload.tsx). Both are set to 8 MB.
 */
const CHUNK_SIZE = 8 * 1024 * 1024 // 8 MB — must match frontend file-upload.tsx

// 25 second timeout — Cloudflare Workers free plan has ~30s wall-clock limit.
// We give ourselves a 5s safety margin for the response to flush back to the client.
const UPLOAD_TIMEOUT_MS = 25_000

export async function POST(request: NextRequest) {
  // === Phase 1: Parse the request (minimal CPU) ===
  let uploadUrl: string
  let chunkIndex: number
  let totalSize: number
  let chunk: File

  try {
    const formData = await request.formData()
    uploadUrl = formData.get('uploadUrl') as string
    chunkIndex = parseInt(formData.get('chunkIndex') as string, 10)
    totalSize = parseInt(formData.get('totalSize') as string, 10)
    chunk = formData.get('chunk') as File

    if (!uploadUrl || isNaN(chunkIndex) || isNaN(totalSize) || !chunk) {
      return NextResponse.json({ error: 'Parameter tidak lengkap' }, { status: 400 })
    }
  } catch (err) {
    console.error('[UPLOAD-CHUNK] formData parse error:', err)
    return NextResponse.json(
      { error: 'Gagal membaca data upload' },
      { status: 400 },
    )
  }

  // === Phase 2: Forward chunk to Google Drive (NO access token needed) ===
  // The resumable upload URL returned by the init request is pre-authenticated.
  // Including an Authorization header is OPTIONAL and adds no value here.
  // Skipping the token fetch on every chunk is the single most important
  // optimization — it eliminates RSA-256 JWT signing (heavy CPU op).
  const start = chunkIndex * CHUNK_SIZE
  const end = start + chunk.size - 1

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS)

  let driveResponse: Response
  try {
    driveResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        // No Authorization header — resumable upload URL is pre-authenticated
        'Content-Type': 'application/octet-stream',
        'Content-Range': `bytes ${start}-${end}/${totalSize}`,
        'Content-Length': chunk.size.toString(),
      },
      body: chunk, // Pass File/Blob directly — no copy
      signal: controller.signal,
    })
  } catch (fetchErr) {
    clearTimeout(timeout)
    const aborted = fetchErr instanceof Error && fetchErr.name === 'AbortError'
    console.error('[UPLOAD-CHUNK] fetch error:', aborted ? 'TIMEOUT' : fetchErr)
    return NextResponse.json(
      {
        error: aborted
          ? `Upload chunk ${chunkIndex + 1} timeout (>${UPLOAD_TIMEOUT_MS / 1000}s)`
          : 'Gagal terhubung ke Google Drive',
      },
      { status: 502 },
    )
  } finally {
    clearTimeout(timeout)
  }

  // === Phase 3a: 308 = Resume Incomplete (more chunks needed) ===
  if (driveResponse.status === 308) {
    return NextResponse.json({
      complete: false,
      nextChunk: chunkIndex + 1,
    })
  }

  // === Phase 3b: 200/201 = Upload Complete (this was the final chunk) ===
  if (driveResponse.status === 200 || driveResponse.status === 201) {
    let fileData: Record<string, string | undefined> = {}
    try {
      fileData = await driveResponse.json()
    } catch {
      // Response body might be empty — that's OK, we'll fetch metadata below
    }

    // The shareWithAnyone call requires an access token. Defer fetching it
    // until this point so non-final chunks (the vast majority) never trigger
    // RSA-256 JWT signing.
    if (fileData?.id) {
      try {
        const settings = await getSettingsRow()
        if (settings?.driveServiceAccountKey) {
          let accessToken: string
          try {
            accessToken = await getCachedAccessToken(settings.driveServiceAccountKey)
          } catch {
            clearCachedAccessToken()
            accessToken = await getCachedAccessToken(settings.driveServiceAccountKey)
          }

          // Share file with anyone (writer access) — best-effort, non-blocking on success
          await shareWithAnyone(accessToken, fileData.id, 'writer')

          // Fetch webViewLink if missing
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
      } catch (shareErr) {
        // Sharing failed — but the upload itself succeeded. Don't fail the
        // whole upload just because sharing failed. The frontend has a
        // fallback that calls /api/drive/upload-complete to retry sharing.
        console.error('[UPLOAD-CHUNK] shareWithAnyone failed (non-fatal):', shareErr)
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

  // === Phase 3c: Unexpected status from Google ===
  let errorText = ''
  try {
    errorText = await driveResponse.text()
  } catch {}
  console.error('[UPLOAD-CHUNK] Google API error:', driveResponse.status, errorText.substring(0, 300))

  // 404 = resumable session expired/invalidated — frontend should recreate the session
  // 410 = Gone — session was finalized or expired
  // These are recoverable by recreating the upload session.
  if (driveResponse.status === 404 || driveResponse.status === 410) {
    return NextResponse.json(
      {
        error: `Sesi upload kedaluwarsa (HTTP ${driveResponse.status}). Sesi akan dibuat ulang.`,
        sessionInvalidated: true,
      },
      { status: 502 },
    )
  }

  // 401/403 = token expired or revoked — clear cache so next chunk gets a fresh token
  // (Only relevant if we fetched the token, but harmless to clear.)
  if (driveResponse.status === 401 || driveResponse.status === 403) {
    clearCachedAccessToken()
  }

  return NextResponse.json(
    { error: `Upload gagal: HTTP ${driveResponse.status}` },
    { status: 502 },
  )
}

/**
 * Fetch the settings row using the lightweight libsql client.
 * Bypasses Prisma's CPU overhead entirely.
 * Returns null if settings don't exist (caller handles gracefully).
 */
async function getSettingsRow(): Promise<{ driveServiceAccountKey: string | null } | null> {
  try {
    const client = getLibsql()
    const result = await client.execute({
      sql: `SELECT driveServiceAccountKey FROM settings WHERE id = 'main' LIMIT 1`,
      args: [],
    })
    if (result.rows.length === 0) return null
    const row = result.rows[0]
    return {
      driveServiceAccountKey: (row.driveServiceAccountKey as string) || null,
    }
  } catch (err) {
    console.error('[UPLOAD-CHUNK] settings fetch error:', err)
    return null
  }
}
