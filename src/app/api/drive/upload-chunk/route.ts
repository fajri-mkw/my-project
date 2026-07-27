import { NextRequest, NextResponse } from 'next/server'

/**
 * Chunked upload endpoint — forwards file chunks to Google Drive's resumable
 * upload session URL.
 *
 * CRITICAL PERFORMANCE NOTES (Cloudflare Workers free plan = 10ms CPU/request):
 * This endpoint is called once per chunk (e.g. 15 times for a 117 MB file with
 * 8 MB chunks). To stay within the 10ms CPU limit, this endpoint is INTENTIONALLY
 * MINIMAL — it does ONLY two things:
 *
 *   1. Parse the FormData (uploadUrl, chunkIndex, totalSize, chunk blob)
 *   2. Forward the chunk to Google Drive's resumable upload URL via PUT
 *
 * NO access token is fetched here (the resumable upload URL is pre-authenticated).
 * NO DB queries. NO Prisma. NO shareWithAnyone. NO metadata fetch.
 * All sharing/metadata work is deferred to /api/drive/upload-complete, which the
 * frontend calls in a SEPARATE request after the upload succeeds. This isolates
 * the CPU-intensive RSA-256 JWT signing (needed for sharing) from the chunk
 * upload path, preventing Worker crashes on cold isolates.
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
  //
  // CRITICAL: Return IMMEDIATELY with whatever Google Drive gave us.
  //
  // Previously, this endpoint did additional work here (fetch settings, get
  // access token via RSA-256 JWT signing, shareWithAnyone, fetch metadata).
  // On a COLD Cloudflare Workers isolate (token not cached), the JWT signing
  // alone consumes 5-10ms of CPU — frequently exceeding the 10ms CPU limit
  // on the free plan. This caused the Worker to crash with a 5xx error on
  // the final chunk, which the frontend interpreted as a chunk failure.
  // After 2 consecutive 5xx errors, the session was recreated; after 3
  // recreations, the upload failed with:
  //   "Gagal upload setelah 3x pembuatan ulang sesi"
  //
  // The fix: the upload-chunk endpoint is now TRULY minimal — it only
  // forwards the chunk to Google Drive and returns the result. All
  // sharing/metadata work is deferred to /api/drive/upload-complete, which
  // the frontend calls in a SEPARATE request after the upload succeeds.
  // This isolates the CPU-intensive JWT signing from the chunk upload path.
  if (driveResponse.status === 200 || driveResponse.status === 201) {
    let fileData: Record<string, string | undefined> = {}
    try {
      fileData = await driveResponse.json()
    } catch {
      // Response body might be empty — frontend will call upload-complete
      // to fetch metadata via a separate (less CPU-constrained) request.
    }

    return NextResponse.json({
      complete: true,
      file: {
        id: fileData.id,
        name: fileData.name,
        // webViewLink may be missing — the frontend ALWAYS calls
        // /api/drive/upload-complete after a successful upload to
        // ensure the file is shared and metadata is fetched.
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

  // 401/403 from Google on a resumable upload URL means the session itself
  // is bad — treat it the same as 404/410 (session invalidated).
  if (driveResponse.status === 401 || driveResponse.status === 403) {
    return NextResponse.json(
      {
        error: `Sesi upload tidak valid (HTTP ${driveResponse.status}). Sesi akan dibuat ulang.`,
        sessionInvalidated: true,
      },
      { status: 502 },
    )
  }

  return NextResponse.json(
    { error: `Upload gagal: HTTP ${driveResponse.status}` },
    { status: 502 },
  )
}
