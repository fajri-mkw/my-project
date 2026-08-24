'use client'

/**
 * Shared chunked upload utility for Google Drive.
 *
 * This module provides a single, reusable function to upload files of ANY size
 * (up to Google Drive's 5 TB limit) using the chunked resumable upload path:
 *
 *   0. POST /api/drive/warmup        → pre-cache settings + access token
 *   1. POST /api/drive/upload-url    → get resumable session URL
 *   2. POST /api/drive/upload-chunk  → upload 8 MB chunks (loop)
 *   3. POST /api/drive/upload-complete → share file + fetch metadata
 *
 * Step 0 (warmup) is CRITICAL: it pre-caches the Google Drive access token
 * on the Cloudflare Workers isolate. Without it, the upload-url endpoint
 * may hit a cold isolate and exceed the 10ms CPU limit (DB query + JWT
 * signing + OAuth + Drive init all in one request), resulting in an empty
 * HTTP 500 that shows as "Gagal menyiapkan upload (HTTP 500)".
 *
 * Used by:
 *   - Surat document uploads (surat-management-view.tsx)
 *   - Program Kegiatan document uploads (program-kegiatan-view.tsx)
 *   - Project supporting document uploads (project-detail-view.tsx)
 *   - Petugas task file uploads (file-upload.tsx — uses its own inline implementation)
 */

import { warmupDrive } from '@/lib/drive-warmup'

const CHUNK_SIZE = 8 * 1024 * 1024 // 8 MB — must match backend upload-chunk/route.ts
// Increased from 2 → 5 to match file-upload.tsx — gives large files (100MB+)
// more chances to ride through Cloudflare Workers CPU spikes and Drive API
// transient errors. With exponential backoff (1s, 2s, 3s, 4s, 5s), worst-case
// adds ~15s — acceptable for a long-running upload.
const MAX_CHUNK_RETRIES = 5
// Maximum number of times to recreate the resumable upload session for a
// single file. Drive can invalidate the session mid-upload (HTTP 404/410);
// recreating it lets us finish the upload. 3 attempts is enough to ride out
// transient Drive outages without hanging the browser.
const MAX_SESSION_RECREATIONS = 3

export interface UploadedFile {
  id: string
  name: string
  webViewLink: string
  webContentLink?: string
  size: number
  /**
   * The actual Drive folder ID where the file was uploaded.
   * When subfolderName is provided, this is the subfolder ID (not the
   * original folderId passed in). The frontend can cache this to avoid
   * redundant subfolder lookups for subsequent files with the same name.
   */
  folderId?: string
}

export interface AutoNameMeta {
  projectTitle?: string
  executionTime?: string
  uploaderName?: string
  seriesNumber?: number
}

export interface ChunkedUploadOptions {
  file: File
  folderId: string
  /** Optional callback for progress updates (0-100) */
  onProgress?: (percent: number, status?: string) => void
  /** Optional auto-naming metadata */
  autoNameMeta?: AutoNameMeta
  /** Optional AbortController for cancellation */
  signal?: AbortSignal
  /**
   * Optional subfolder name. If provided, the server will find or create a
   * subfolder with this name INSIDE folderId, and upload the file into it.
   * Used to organize documents into named subfolders inside the main
   * kegiatan/surat folder (e.g. "Notulensi", "Dokumentasi").
   */
  subfolderName?: string
}

/**
 * Upload a file to Google Drive using the chunked resumable upload path.
 *
 * This function supports files of ANY size (up to Google Drive's 5 TB limit).
 * The file is split into 8 MB chunks and uploaded sequentially.
 *
 * @returns The uploaded file metadata (id, name, webViewLink, etc.)
 * @throws Error if the upload fails after all retries
 */
export async function chunkedUploadFile(
  options: ChunkedUploadOptions,
): Promise<UploadedFile> {
  const { file, folderId, onProgress, autoNameMeta, signal, subfolderName } = options

  onProgress?.(1, 'Menyiapkan koneksi Google Drive...')

  // ===== STEP 0: Warm up the Cloudflare Workers isolate =====
  // Pre-caches settings + access token at the module level. Without this,
  // the upload-url endpoint may hit a cold isolate and exceed the 10ms CPU
  // limit, resulting in an empty HTTP 500 ("Gagal menyiapkan upload").
  // Reduced from 5 → 2 retries: warmup rarely fails on a warm isolate, and
  // excessive retries pile up Worker requests under Cloudflare rate-limit
  // stress (Error 1027). 2 attempts is enough — the first warmup may hit a
  // cold isolate (10ms CPU limit on free plan), the second lands on a warm
  // one. If both fail, the upload-url call has its own retry logic.
  const warmupResult = await warmupDrive(2, signal)
  if (!warmupResult.ok) {
    // If warmup fails with a 4xx (Drive not configured), throw immediately.
    if (warmupResult.error && warmupResult.error.includes('belum dikonfigurasi')) {
      throw new Error(warmupResult.error)
    }
    // For 5xx errors (cold isolate), proceed to upload-url anyway — it has
    // its own retry logic and might land on a warmer isolate.
  }

  onProgress?.(2, 'Menyiapkan upload...')

  // ===== STEP 1: Get resumable upload URL from server =====
  // Retry on 5xx + network errors — Cloudflare Workers free-plan 10ms CPU
  // limit can cause transient 5xx responses on cold isolates (JWT signing
  // + subfolder creation can exceed the limit). Also, cold isolates may
  // timeout (504) on the first OAuth token fetch. 5 retries gives enough
  // chances to hit a warm isolate.
  const MAX_URL_RETRIES = 5
  let uploadUrl: string | null = null
  let autoFileName: string | undefined
  let targetFolderId: string | undefined

  for (let attempt = 0; attempt <= MAX_URL_RETRIES; attempt++) {
    if (signal?.aborted) throw new Error('Upload dibatalkan')

    try {
      const urlResponse = await fetch('/api/drive/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          folderId,
          autoNameMeta,
          subfolderName,
        }),
        signal,
      })

      if (urlResponse.ok) {
        const data = await urlResponse.json()
        uploadUrl = data.uploadUrl
        autoFileName = data.autoFileName
        targetFolderId = data.folderId
        break
      }

      // Non-OK response — parse error message
      let errorMsg = 'Gagal menyiapkan upload'
      let isTransient = false
      try {
        const d = await urlResponse.json()
        errorMsg = d.error || errorMsg
        isTransient = urlResponse.status >= 500
      } catch {
        // Response body is not JSON (likely a Cloudflare HTML error page)
        errorMsg = `Server error (${urlResponse.status})`
        isTransient = urlResponse.status >= 500 || urlResponse.status === 0
      }

      // 4xx errors are not retried (client/validation errors)
      if (!isTransient || attempt === MAX_URL_RETRIES) {
        throw new Error(errorMsg)
      }

      // Show retry status and back off
      onProgress?.(3, `Percobaan ulang #${attempt + 1} untuk menyiapkan upload...`)
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)))
    } catch (fetchErr) {
      if (signal?.aborted) throw new Error('Upload dibatalkan')
      // Network error — retry unless this was the last attempt
      if (attempt === MAX_URL_RETRIES) {
        throw fetchErr instanceof Error ? fetchErr : new Error('Gagal menyiapkan upload')
      }
      onProgress?.(3, `Percobaan ulang #${attempt + 1} untuk menyiapkan upload...`)
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)))
    }
  }

  if (!uploadUrl) throw new Error('URL upload tidak ditemukan')

  onProgress?.(5, 'Mengupload...')

  // ===== STEP 2: Upload file in chunks through server =====
  const totalSize = file.size
  const totalChunks = Math.ceil(totalSize / CHUNK_SIZE)
  let chunkIndex = 0
  let uploadedFile: { id?: string; name?: string; webViewLink?: string; webContentLink?: string } | null = null

  // Track consecutive 5xx failures — if Drive invalidates the resumable
  // session URL mid-upload, we need to recreate it and restart from chunk 0.
  let consecutiveSessionErrors = 0
  let sessionRecreations = 0

  // =========================================================================
  // DIRECT BROWSER-TO-GOOGLE-DRIVE UPLOAD (saves Worker requests)
  // See file-upload.tsx for full rationale — the resumable upload URL is
  // pre-authenticated, so the browser can PUT chunk bytes DIRECTLY to it
  // without going through /api/drive/upload-chunk. This eliminates 1 Worker
  // request per chunk (e.g. 13 reqs saved for a 100 MB file).
  //
  // FALLBACK: if the direct PUT fails with a network/CORS error, switch to
  // Worker-proxy mode for the rest of the file.
  // =========================================================================
  let useDirectUpload = true

  while (chunkIndex < totalChunks) {
    if (signal?.aborted) {
      throw new Error('Upload dibatalkan')
    }

    const start = chunkIndex * CHUNK_SIZE
    const end = Math.min(start + CHUNK_SIZE, totalSize)
    const chunkBlob = file.slice(start, end)
    // Drive's Content-Range uses inclusive end (bytes start-end/total).
    const rangeEnd = end - 1

    // Retry loop for transient failures
    let chunkResult: { complete: boolean; nextChunk: number; file?: { id?: string; name?: string; webViewLink?: string; webContentLink?: string } } | null = null
    let chunkError: Error | null = null
    let sessionInvalidated = false

    for (let attempt = 0; attempt <= MAX_CHUNK_RETRIES; attempt++) {
      if (signal?.aborted) {
        throw new Error('Upload dibatalkan')
      }

      try {
        // === DIRECT UPLOAD PATH (browser → Google Drive, no Worker) ===
        let chunkResponse: Response
        if (useDirectUpload) {
          try {
            chunkResponse = await fetch(uploadUrl as string, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/octet-stream',
                'Content-Range': `bytes ${start}-${rangeEnd}/${totalSize}`,
                'Content-Length': chunkBlob.size.toString(),
              },
              body: chunkBlob,
              signal,
            })
          } catch (directErr) {
            // Network/CORS error on direct PUT — switch to Worker-proxy mode
            if (signal?.aborted) {
              throw new Error('Upload dibatalkan')
            }
            console.warn('[chunked-upload] Direct chunk upload failed, falling back to Worker proxy:', directErr)
            useDirectUpload = false
            const fd = new FormData()
            fd.append('uploadUrl', uploadUrl as string)
            fd.append('chunkIndex', chunkIndex.toString())
            fd.append('totalSize', totalSize.toString())
            fd.append('chunk', chunkBlob, file.name)
            chunkResponse = await fetch('/api/drive/upload-chunk', {
              method: 'POST',
              body: fd,
              signal,
            })
          }
        } else {
          // === PROXY PATH (browser → Worker → Google Drive) ===
          const chunkFormData = new FormData()
          chunkFormData.append('uploadUrl', uploadUrl as string)
          chunkFormData.append('chunkIndex', chunkIndex.toString())
          chunkFormData.append('totalSize', totalSize.toString())
          chunkFormData.append('chunk', chunkBlob, file.name)
          chunkResponse = await fetch('/api/drive/upload-chunk', {
            method: 'POST',
            body: chunkFormData,
            signal,
          })
        }

        // === Handle response (direct vs proxy have different shapes) ===
        if (useDirectUpload) {
          // Direct response from Google Drive
          if (chunkResponse.status === 308) {
            // 308 Resume Incomplete — more chunks needed
            chunkResult = { complete: false, nextChunk: chunkIndex + 1 }
            chunkError = null
            consecutiveSessionErrors = 0
            break
          }
          if (chunkResponse.status === 200 || chunkResponse.status === 201) {
            // Upload complete
            let fileData: Record<string, string | undefined> = {}
            try {
              fileData = await chunkResponse.json()
            } catch {}
            chunkResult = {
              complete: true,
              nextChunk: chunkIndex + 1,
              file: {
                id: fileData.id,
                name: fileData.name,
                webViewLink: fileData.webViewLink,
                webContentLink: fileData.webContentLink,
              },
            }
            chunkError = null
            consecutiveSessionErrors = 0
            break
          }
          // 404/410/401/403 = session invalidated
          if ([404, 410, 401, 403].includes(chunkResponse.status)) {
            chunkError = new Error(`Sesi upload kedaluwarsa (HTTP ${chunkResponse.status}). Sesi akan dibuat ulang.`)
            consecutiveSessionErrors = 99
            break
          }
          // 429 / 5xx — retry
          const isRateLimit = chunkResponse.status === 429
          const isTransient = chunkResponse.status >= 500
          let errorMsg = `Gagal upload chunk ${chunkIndex + 1}/${totalChunks} (HTTP ${chunkResponse.status})`
          try {
            const errText = await chunkResponse.text()
            if (errText) errorMsg = `${errorMsg}: ${errText.substring(0, 200)}`
          } catch {}
          if (!isTransient && !isRateLimit) {
            chunkError = new Error(errorMsg)
            break
          }
          if (chunkResponse.status >= 500) {
            consecutiveSessionErrors++
          }
          if (attempt === MAX_CHUNK_RETRIES) {
            chunkError = new Error(errorMsg)
            break
          }
          const retryStatus = `Percobaan ulang #${attempt + 1} untuk chunk ${chunkIndex + 1}/${totalChunks}...`
          onProgress?.(Math.round(5 + (chunkIndex / totalChunks) * 90), retryStatus)
          const backoffMs = isRateLimit ? 5000 * (attempt + 1) : 1000 * (attempt + 1)
          await new Promise((r) => setTimeout(r, backoffMs))
          continue
        } else {
          // Proxy response (JSON envelope with complete/file/sessionInvalidated)
          if (chunkResponse.ok) {
            chunkResult = await chunkResponse.json()
            chunkError = null
            consecutiveSessionErrors = 0
            break
          }
          let errorMsg = `Gagal upload chunk ${chunkIndex + 1}/${totalChunks}`
          let isTransient = false
          try {
            const errData = await chunkResponse.json()
            errorMsg = errData.error || errorMsg
            isTransient = chunkResponse.status >= 500
            sessionInvalidated = errData.sessionInvalidated === true
          } catch {
            errorMsg = `Server error (${chunkResponse.status})`
            isTransient = chunkResponse.status >= 500 || chunkResponse.status === 0
          }
          if (sessionInvalidated) {
            chunkError = new Error(errorMsg)
            consecutiveSessionErrors = 99
            break
          }
          if (!isTransient || attempt === MAX_CHUNK_RETRIES) {
            chunkError = new Error(errorMsg)
            break
          }
          if (chunkResponse.status >= 500) {
            consecutiveSessionErrors++
          }
          const retryStatus = `Percobaan ulang #${attempt + 1} untuk chunk ${chunkIndex + 1}/${totalChunks}...`
          onProgress?.(Math.round(5 + (chunkIndex / totalChunks) * 90), retryStatus)
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
          continue
        }
      } catch (fetchErr) {
        if (signal?.aborted) {
          throw new Error('Upload dibatalkan')
        }
        if (attempt === MAX_CHUNK_RETRIES) {
          chunkError = fetchErr instanceof Error ? fetchErr : new Error('Gagal mengupload chunk')
          break
        }
        const retryStatus = `Percobaan ulang #${attempt + 1} untuk chunk ${chunkIndex + 1}/${totalChunks}...`
        onProgress?.(Math.round(5 + (chunkIndex / totalChunks) * 90), retryStatus)
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
      }
    }

    // If we've hit consecutive 5xx errors OR the server explicitly told us
    // the session is invalidated, recreate the upload session and restart
    // from chunk 0. Drive's resumable upload protocol doesn't support
    // cross-session byte offset resume, so we have to restart.
    if (chunkError && consecutiveSessionErrors >= 2) {
      if (sessionRecreations >= MAX_SESSION_RECREATIONS) {
        throw new Error(
          `Gagal upload setelah ${MAX_SESSION_RECREATIONS}x pembuatan ulang sesi. ` +
          `Server Google Drive mungkin sedang bermasalah. Coba lagi nanti.`
        )
      }
      sessionRecreations++
      onProgress?.(
        Math.round(5 + (chunkIndex / totalChunks) * 90),
        `Membuat ulang sesi upload (percobaan ${sessionRecreations}/${MAX_SESSION_RECREATIONS})...`,
      )
      try {
        // Re-create the session by calling upload-url again
        const urlResponse = await fetch('/api/drive/upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: file.name,
            mimeType: file.type || 'application/octet-stream',
            folderId,
            autoNameMeta,
            subfolderName,
          }),
          signal,
        })
        if (!urlResponse.ok) {
          throw new Error('Gagal membuat ulang sesi upload')
        }
        const data = await urlResponse.json()
        uploadUrl = data.uploadUrl
        consecutiveSessionErrors = 0
        chunkIndex = 0 // restart from beginning with new session
        continue
      } catch (recreateErr) {
        throw recreateErr instanceof Error ? recreateErr : new Error('Gagal membuat ulang sesi upload')
      }
    }

    if (chunkError) throw chunkError
    if (!chunkResult) throw new Error('Gagal mengupload chunk — tidak ada respons')

    // Update progress: map chunk progress to 5%–95% range
    const pct = Math.round(5 + (chunkResult.nextChunk / totalChunks) * 90)
    onProgress?.(Math.min(pct, 95), 'Mengupload...')

    if (chunkResult.complete) {
      uploadedFile = chunkResult.file ?? null
      break
    } else {
      chunkIndex = chunkResult.nextChunk
    }
  }

  if (!uploadedFile?.id) {
    throw new Error('Upload selesai tetapi tidak ada file ID yang dikembalikan')
  }

  // ===== STEP 3: Finalize — share file & fetch metadata via upload-complete =====
  //
  // ALWAYS call /api/drive/upload-complete after a successful upload, even
  // if Google Drive's response already included webViewLink. This is because
  // the upload-chunk endpoint is now TRULY minimal — it does NOT do any
  // sharing or metadata fetching (to avoid exceeding the Cloudflare Workers
  // 10ms CPU limit on cold isolates via RSA-256 JWT signing). The sharing
  // (shareWithAnyone) MUST happen here, in a separate request, to ensure
  // the uploaded file is accessible to anyone with the link.
  if (uploadedFile.id) {
    onProgress?.(97, 'Menyelesaikan & membagikan file...')
    // Retry up to 3 times — upload-complete may hit a cold Cloudflare
    // Workers isolate (JWT signing for access token can exceed the 10ms
    // CPU limit). A retry usually lands on a warm isolate.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (signal?.aborted) break
      try {
        const shareResponse = await fetch('/api/drive/upload-complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileId: uploadedFile.id }),
          signal,
        })
        if (shareResponse.ok) {
          const shareData = await shareResponse.json()
          if (shareData.file) {
            uploadedFile = { ...uploadedFile, ...shareData.file }
          }
          break // success
        }
        // 5xx — retry. 4xx — don't retry (client error).
        if (shareResponse.status < 500) break
      } catch (e) {
        // Network error — retry
      }
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
      }
    }
  }

  onProgress?.(100, 'Selesai')

  // At this point uploadedFile is guaranteed to have an id (checked above),
  // but TypeScript can't narrow through the optional chaining + nullish coalescing.
  const uf = uploadedFile as { id: string; name?: string; webViewLink?: string; webContentLink?: string }

  return {
    id: uf.id,
    name: uf.name || autoFileName || file.name,
    webViewLink: uf.webViewLink || `https://drive.google.com/file/d/${uf.id}/view`,
    webContentLink: uf.webContentLink,
    size: file.size,
    folderId: targetFolderId,
  }
}
