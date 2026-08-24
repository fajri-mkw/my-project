'use client'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import {
  UploadCloud,
  X,
  FileIcon,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Film,
  Image,
  FileText,
  Archive
} from 'lucide-react'
import { useState, useRef, useCallback, useEffect } from 'react'
import { warmupDrive } from '@/lib/drive-warmup'

interface FileUploadProps {
  folderLink: string // Google Drive folder link
  projectId: string
  onUploadComplete?: (file: { name: string; webViewLink: string }) => void
  className?: string
  // Auto-naming metadata
  projectTitle?: string
  executionTime?: string
  uploaderName?: string
}

interface UploadingFile {
  id: string
  name: string // original file name
  autoName?: string // auto-generated file name
  size: number
  progress: number
  status: 'uploading' | 'success' | 'error'
  error?: string
  webViewLink?: string
  abortController?: AbortController
}

// Chunk size for resumable uploads. Must match the backend constant in
// src/app/api/drive/upload-chunk/route.ts (CHUNK_SIZE).
// 8 MB is well under Cloudflare Workers' 100 MB request body limit and reduces
// a 143 MB video upload from 144 requests to 18 — dramatically cutting OAuth
// token generation overhead and wall-clock time.
const CHUNK_SIZE = 8 * 1024 * 1024 // 8 MB per chunk

// Maximum retry attempts for a failed chunk upload.
// Increased from 4 → 5 — gives one more chance for very large files (e.g. 100MB+)
// where Cloudflare Workers CPU spikes are more likely to hit at least one chunk.
// With exponential backoff (1s, 2s, 3s, 4s, 5s) the worst-case adds ~15s,
// well worth the reliability for a long-running upload.
const MAX_CHUNK_RETRIES = 5

// Maximum retry attempts for the upload-url session creation.
// On cold Cloudflare Workers isolates, the first request may timeout (504)
// because the OAuth token fetch + Drive API init takes >20s on a cold
// connection. The retry usually lands on a warmer isolate (or the same
// isolate now has cached connections). 5 retries gives enough chances to
// hit a warm isolate.
const MAX_URL_RETRIES = 5

// Uploads are sequential (one file at a time). Parallel uploads caused
// Cloudflare Workers subrequest contention and Google Drive API 429
// rate-limit errors. See uploadFile() for the queue implementation.

// Extract real Google Drive folder ID from URL (reject constructed/mock IDs)
function extractFolderId(url: string): string | null {
  if (!url) return null
  const match = url.match(/\/folders\/([a-zA-Z0-9_-]+)/)
  if (!match) return null
  const extracted = match[1]
  const knownPrefixes = ['raw-', 'revised-', 'final-', 'desain-', 'lainnya-', 'mock-']
  if (knownPrefixes.some(p => extracted.startsWith(p))) return null
  if (extracted.length < 20) return null
  return extracted
}

function getFileIcon(fileName: string) {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  const videoExts = ['mp4', 'mov', 'avi', 'mkv', 'wmv', 'flv', 'webm', 'm4v']
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'heic']
  const archiveExts = ['zip', 'rar', '7z', 'tar', 'gz']
  const docExts = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt']
  if (videoExts.includes(ext)) return Film
  if (imageExts.includes(ext)) return Image
  if (archiveExts.includes(ext)) return Archive
  if (docExts.includes(ext)) return FileText
  return FileIcon
}

function formatFileSize(bytes: number) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export function FileUpload({ folderLink, projectId, onUploadComplete, className, projectTitle, executionTime, uploaderName }: FileUploadProps) {
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const seriesCounterRef = useRef(0) // tracks upload count for series numbering
  // Upload queue — ensures only MAX_PARALLEL_UPLOADS files upload at once.
  // Previously every dropped file fired `uploadFile` in parallel via forEach,
  // causing Cloudflare Workers subrequest contention + Drive API 429s.
  // Sequential uploads are slightly slower for many small files but
  // dramatically more reliable.
  const uploadQueueRef = useRef<Promise<void>>(Promise.resolve())

  const updateFile = useCallback((fileId: string, updater: (f: UploadingFile) => UploadingFile) => {
    setUploadingFiles(prev => prev.map(f => f.id === fileId ? updater(f) : f))
  }, [])

  // === Proactive warmup ===
  // Fire-and-forget: pre-warm the Cloudflare Workers isolate when the upload
  // component mounts. This caches the Google Drive access token at the module
  // level so that when the user actually starts uploading, the upload-url
  // endpoint only needs to do the Drive API init (not JWT signing + OAuth).
  // This eliminates the "Gagal menyiapkan upload (HTTP 500)" error that
  // occurs when a cold isolate exceeds the 10ms CPU limit.
  useEffect(() => {
    // Only warmup if there's a valid folder link
    if (!folderLink || !extractFolderId(folderLink)) return
    // Fire and forget — don't block the UI
    // Reduced from 3 → 1: under Cloudflare Workers free-plan rate-limit
    // stress (Error 1027), warmup retries pile up and worsen the situation.
    // 1 retry is enough — warmup either succeeds on the first try (warm
    // isolate) or the second (after a 1s backoff for the isolate to warm).
    warmupDrive(1).catch(() => {
      // Silent failure — the blocking warmup in uploadFile will retry
    })
  }, [folderLink])

  const uploadFile = useCallback(async (file: File): Promise<void> => {
    const fileId = `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const folderId = extractFolderId(folderLink)
    const abortController = new AbortController()

    if (!folderId) {
      setUploadingFiles(prev => [...prev, {
        id: fileId, name: file.name, size: file.size, progress: 0, status: 'error',
        error: 'Folder tidak valid. Pastikan Google Drive sudah terhubung (bukan mock mode).'
      }])
      return
    }

    // Add to list IMMEDIATELY (before queueing) so the user sees all dropped
    // files right away, even while they wait in the sequential upload queue.
    setUploadingFiles(prev => [...prev, {
      id: fileId, name: file.name, size: file.size,
      progress: 0, status: 'uploading', abortController
    }])

    const setError = (msg: string) => updateFile(fileId, f => ({ ...f, status: 'error', error: msg }))

    // === Helper: create resumable upload session (with retry) ===
    // Returns { uploadUrl, autoFileName } or throws on persistent failure.
    // Previously this had ZERO retry — a single transient Drive 5xx killed the
    // entire file upload. Now we retry up to MAX_URL_RETRIES times.
    const createUploadSession = async (): Promise<{ uploadUrl: string; autoFileName?: string }> => {
      // Build auto-naming metadata if available
      const autoNameMeta = projectTitle ? {
        projectTitle,
        executionTime: executionTime || '',
        uploaderName: uploaderName || '',
        seriesNumber: seriesCounterRef.current
      } : undefined

      let lastErr: Error | null = null
      for (let attempt = 0; attempt < MAX_URL_RETRIES; attempt++) {
        if (abortController.signal.aborted) {
          throw new Error('Upload dibatalkan')
        }
        try {
          const urlResponse = await fetch('/api/drive/upload-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName: file.name, mimeType: file.type, folderId, autoNameMeta }),
            signal: abortController.signal
          })

          if (urlResponse.ok) {
            const data = await urlResponse.json()
            if (data.uploadUrl) {
              if (data.autoFileName) {
                updateFile(fileId, f => ({ ...f, autoName: data.autoFileName }))
              }
              return { uploadUrl: data.uploadUrl, autoFileName: data.autoFileName }
            }
            lastErr = new Error('URL upload tidak ditemukan dalam respons')
          } else {
            // Parse error from response (handle non-JSON gracefully)
            let msg = `Gagal menyiapkan upload (HTTP ${urlResponse.status})`
            try {
              const d = await urlResponse.json()
              if (d?.error) msg = d.error
            } catch {
              // Non-JSON body — try text
              try {
                const t = await urlResponse.text()
                if (t) msg = `Server error ${urlResponse.status}: ${t.substring(0, 100)}`
              } catch {}
            }
            lastErr = new Error(msg)
            // 4xx — don't retry (client error)
            if (urlResponse.status >= 400 && urlResponse.status < 500) {
              throw lastErr
            }
          }
        } catch (err) {
          // Network error or abort
          if (abortController.signal.aborted) throw new Error('Upload dibatalkan')
          lastErr = err instanceof Error ? err : new Error('Gagal menyiapkan upload')
        }
        // Exponential backoff between URL session attempts: 1s, 2s
        if (attempt < MAX_URL_RETRIES - 1) {
          updateFile(fileId, f => ({
            ...f,
            error: `Menyiapkan ulang sesi upload (percobaan ${attempt + 2}/${MAX_URL_RETRIES})...`
          }))
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
        }
      }
      throw lastErr || new Error('Gagal menyiapkan upload setelah beberapa percobaan')
    }

    // === Wait in the sequential upload queue ===
    // Each file is registered in the UI immediately (above), but the actual
    // upload work waits its turn. This prevents parallel upload storms that
    // were causing Drive 429s and Cloudflare subrequest contention.
    // `releaseQueue` is called when this file's upload completes (success or
    // failure) so the next file can start.
    let releaseQueue!: () => void
    const queuePromise = new Promise<void>(resolve => { releaseQueue = resolve })
    const prevQueue = uploadQueueRef.current
    uploadQueueRef.current = prevQueue.then(() => queuePromise)
    await prevQueue.catch(() => {}) // swallow previous file's errors

    // Check abort after waiting in queue (user may have cancelled while queued)
    if (abortController.signal.aborted) {
      releaseQueue()
      setError('Upload dibatalkan')
      return
    }

    try {
      // ===== STEP 0: Warm up the Cloudflare Workers isolate =====
      // This pre-caches the Google Drive access token at the module level.
      // Without this, the upload-url endpoint may hit a cold isolate and
      // exceed the 10ms CPU limit (DB query + JWT signing + OAuth + Drive
      // init all in one request), resulting in an empty HTTP 500 response
      // that shows as "Gagal menyiapkan upload (HTTP 500)".
      updateFile(fileId, f => ({ ...f, progress: 1, error: 'Menyiapkan koneksi Google Drive...' }))
      // Reduced from 5 → 2 retries: warmup rarely fails on a warm isolate,
      // and excessive retries pile up Worker requests under rate-limit stress.
      const warmupResult = await warmupDrive(2, abortController.signal)
      if (!warmupResult.ok) {
        // If warmup fails with a 4xx (Drive not configured), show that error.
        // If it fails with 5xx (cold isolate), proceed anyway — upload-url
        // has its own retry and might land on a warmer isolate.
        if (warmupResult.error && warmupResult.error.includes('belum dikonfigurasi')) {
          throw new Error(warmupResult.error)
        }
        // Otherwise, continue to upload-url (it has its own retry logic)
      }

      // ===== STEP 1: Get resumable upload URL from server (with retry) =====
      updateFile(fileId, f => ({ ...f, progress: 2, error: undefined }))
      seriesCounterRef.current += 1

      let { uploadUrl, autoFileName } = await createUploadSession()
      if (autoFileName) {
        updateFile(fileId, f => ({ ...f, autoName: autoFileName }))
      }

      updateFile(fileId, f => ({ ...f, progress: 5, error: undefined }))

      // ===== STEP 2: Upload file in chunks through server =====
      const totalSize = file.size
      const totalChunks = Math.ceil(totalSize / CHUNK_SIZE)
      let chunkIndex = 0
      let uploadComplete = false
      let uploadedFile: { id?: string; name?: string; webViewLink?: string; webContentLink?: string } | null = null

      // Track consecutive 5xx failures that may indicate Drive invalidated
      // the resumable session URL. After 2 such failures, re-create the
      // session from chunk 0 with a new resumable upload URL.
      let consecutiveSessionErrors = 0

      // Limit how many times we recreate the upload session for a single file.
      // Without this, a permanently broken Drive session would loop forever
      // (recreate → fail → recreate → fail). 3 attempts is enough to ride out
      // transient Drive outages without hanging the browser.
      const MAX_SESSION_RECREATIONS = 3
      let sessionRecreations = 0

      // =========================================================================
      // DIRECT BROWSER-TO-GOOGLE-DRIVE UPLOAD (saves Worker requests)
      // -------------------------------------------------------------------------
      // The resumable upload URL returned by /api/drive/upload-url is
      // pre-authenticated (Google embeds the upload_id in the URL itself — no
      // Authorization header needed). The browser can PUT chunk bytes DIRECTLY
      // to that URL, bypassing /api/drive/upload-chunk entirely.
      //
      // This eliminates 1 Worker request per chunk — for a 100 MB file with
      // 8 MB chunks, that's 13 Worker requests saved per upload. For a team
      // uploading many video files daily, this saves hundreds to thousands of
      // Worker requests per day, helping stay under the free-plan 100K/day cap.
      //
      // FALLBACK STRATEGY: Google Drive's resumable upload URL DOES support
      // CORS for direct browser PUTs (Access-Control-Allow-Origin: *). But
      // if a direct PUT ever fails with a network/CORS error (TypeError
      // "Failed to fetch" with no HTTP status), we fall back to the Worker
      // proxy (/api/drive/upload-chunk) for the rest of the file. This makes
      // the optimization safe — worst case is the same as before.
      // =========================================================================
      let useDirectUpload = true

      while (chunkIndex < totalChunks && !uploadComplete) {
        // Check abort
        if (abortController.signal.aborted) {
          throw new Error('Upload dibatalkan')
        }

        const start = chunkIndex * CHUNK_SIZE
        const end = Math.min(start + CHUNK_SIZE, totalSize)
        const chunkBlob = file.slice(start, end)
        // Drive's Content-Range uses inclusive end (bytes start-end/total).
        // Our `end` is exclusive (Math.min returns next chunk's start), so
        // subtract 1 for the byte range.
        const rangeEnd = end - 1

        // Retry loop for transient failures (CF Workers CPU spikes, network blips).
        // 4xx errors fail fast (client/validation error — won't fix on retry).
        // 5xx + network errors retry up to MAX_CHUNK_RETRIES times.
        // 429 (Too Many Requests) gets a longer backoff (Drive rate-limit).
        let chunkResult: { complete: boolean; nextChunk: number; file?: { id?: string; name?: string; webViewLink?: string; webContentLink?: string } } | null = null
        let chunkError: Error | null = null

        for (let attempt = 0; attempt <= MAX_CHUNK_RETRIES; attempt++) {
          if (abortController.signal.aborted) {
            throw new Error('Upload dibatalkan')
          }

          try {
            // === DIRECT UPLOAD PATH (browser → Google Drive, no Worker) ===
            // Used when useDirectUpload=true. Falls back to Worker proxy if
            // the direct PUT fails with a network/CORS error.
            let chunkResponse: Response
            if (useDirectUpload) {
              try {
                chunkResponse = await fetch(uploadUrl, {
                  method: 'PUT',
                  headers: {
                    'Content-Type': 'application/octet-stream',
                    'Content-Range': `bytes ${start}-${rangeEnd}/${totalSize}`,
                    'Content-Length': chunkBlob.size.toString(),
                  },
                  body: chunkBlob,
                  signal: abortController.signal,
                  // mode: 'cors' is the default for cross-origin requests;
                  // Google's API returns appropriate CORS headers.
                })
              } catch (directErr) {
                // Network error on direct PUT — most likely a CORS preflight
                // rejection or Google's CORS policy changed. Switch to
                // Worker-proxy mode for the rest of this file (and retry
                // this chunk via the proxy path below).
                if (abortController.signal.aborted) {
                  throw new Error('Upload dibatalkan')
                }
                console.warn('[UPLOAD] Direct chunk upload failed, falling back to Worker proxy:', directErr)
                useDirectUpload = false
                // Fall through to the proxy path below (do NOT `continue` —
                // the proxy code is in the same try block, controlled by the
                // useDirectUpload flag now set to false).
                chunkResponse = await fetch('/api/drive/upload-chunk', {
                  method: 'POST',
                  body: (() => {
                    const fd = new FormData()
                    fd.append('uploadUrl', uploadUrl)
                    fd.append('chunkIndex', chunkIndex.toString())
                    fd.append('totalSize', totalSize.toString())
                    fd.append('chunk', chunkBlob, file.name)
                    return fd
                  })(),
                  signal: abortController.signal,
                })
              }
            } else {
              // === PROXY PATH (browser → Worker → Google Drive) ===
              // Fallback when direct upload is unavailable. Same shape as
              // before — Worker forwards chunk to Google Drive.
              const chunkFormData = new FormData()
              chunkFormData.append('uploadUrl', uploadUrl)
              chunkFormData.append('chunkIndex', chunkIndex.toString())
              chunkFormData.append('totalSize', totalSize.toString())
              chunkFormData.append('chunk', chunkBlob, file.name)

              chunkResponse = await fetch('/api/drive/upload-chunk', {
                method: 'POST',
                body: chunkFormData,
                signal: abortController.signal,
              })
            }

            // === Handle the chunk response (same logic for both paths) ===
            // Direct upload: Google Drive returns 308/200/201/4xx/5xx.
            // Proxy upload: /api/drive/upload-chunk returns 200 with JSON
            //   { complete: bool, nextChunk: number, file?: {...} } on success,
            //   or 5xx with { error: string, sessionInvalidated?: bool }.
            //
            // We normalize both response shapes into the same chunkResult.
            if (useDirectUpload) {
              // Direct upload response from Google Drive
              if (chunkResponse.status === 308) {
                // 308 Resume Incomplete — more chunks needed
                chunkResult = { complete: false, nextChunk: chunkIndex + 1 }
                chunkError = null
                consecutiveSessionErrors = 0
                break
              }
              if (chunkResponse.status === 200 || chunkResponse.status === 201) {
                // Upload complete (final chunk)
                let fileData: Record<string, string | undefined> = {}
                try {
                  fileData = await chunkResponse.json()
                } catch {
                  // Response body might be empty — frontend will call
                  // upload-complete to fetch metadata.
                }
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
                consecutiveSessionErrors = 99 // force session recreation below
                break
              }
              // 429 = Too Many Requests (Drive rate-limit)
              const isRateLimit = chunkResponse.status === 429
              // 5xx = server error (transient)
              const isTransient = chunkResponse.status >= 500
              let errorMsg = `Gagal upload chunk ${chunkIndex + 1}/${totalChunks} (HTTP ${chunkResponse.status})`
              try {
                const errText = await chunkResponse.text()
                if (errText) errorMsg = `${errorMsg}: ${errText.substring(0, 200)}`
              } catch {}
              // 4xx (except 429) won't fix on retry
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
              // Show retry status in the UI
              updateFile(fileId, f => ({
                ...f,
                error: `Percobaan ulang #${attempt + 1} untuk chunk ${chunkIndex + 1}/${totalChunks}...`
              }))
              const backoffMs = isRateLimit
                ? 5000 * (attempt + 1)
                : 1000 * (attempt + 1)
              await new Promise(r => setTimeout(r, backoffMs))
              continue // retry the chunk
            } else {
              // Proxy upload response (same as original code)
              if (chunkResponse.ok) {
                chunkResult = await chunkResponse.json()
                chunkError = null
                consecutiveSessionErrors = 0
                break
              }
              let errorMsg = `Gagal upload chunk ${chunkIndex + 1}/${totalChunks}`
              let isTransient = false
              let isRateLimit = false
              let sessionInvalidated = false
              try {
                const errData = await chunkResponse.json()
                errorMsg = errData.error || errorMsg
                isTransient = chunkResponse.status >= 500
                isRateLimit = chunkResponse.status === 429
                sessionInvalidated = errData.sessionInvalidated === true
              } catch {
                errorMsg = `Server error (${chunkResponse.status})`
                isTransient = chunkResponse.status >= 500 || chunkResponse.status === 0
                isRateLimit = false
              }
              if (sessionInvalidated) {
                chunkError = new Error(errorMsg)
                consecutiveSessionErrors = 99
                break
              }
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
              updateFile(fileId, f => ({
                ...f,
                error: `Percobaan ulang #${attempt + 1} untuk chunk ${chunkIndex + 1}/${totalChunks}...`
              }))
              const backoffMs = isRateLimit
                ? 5000 * (attempt + 1)
                : 1000 * (attempt + 1)
              await new Promise(r => setTimeout(r, backoffMs))
              continue // retry the chunk
            }
          } catch (fetchErr) {
            // Network error (fetch threw)
            if (abortController.signal.aborted) {
              throw new Error('Upload dibatalkan')
            }
            // If we were trying direct upload, the catch above should have
            // already switched to proxy. If we're here in proxy mode, it's
            // a true network error.
            if (attempt === MAX_CHUNK_RETRIES) {
              chunkError = fetchErr instanceof Error ? fetchErr : new Error('Gagal mengupload chunk')
              break
            }
            // Retry on network errors
            updateFile(fileId, f => ({
              ...f,
              error: `Percobaan ulang #${attempt + 1} untuk chunk ${chunkIndex + 1}/${totalChunks}...`
            }))
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
          }
        }

        // If we've hit consecutive 5xx errors OR the server explicitly told
        // us the session is invalidated (404/410 from Google Drive), recreate
        // the upload session. This now works for ANY chunk index, not just
        // chunk 0 — Drive's resumable upload sessions can expire mid-upload,
        // and the frontend needs to recreate them to continue.
        //
        // When recreating mid-upload, Drive will start a NEW empty file from
        // chunk 0. We restart from the beginning to ensure the file is
        // complete (Drive's resumable upload protocol doesn't support
        // resuming from a byte offset with a different session ID).
        if (chunkError && consecutiveSessionErrors >= 2) {
          // Safety valve: don't recreate the session more than MAX times.
          // If Drive is permanently broken, fail with a clear error instead
          // of looping forever.
          if (sessionRecreations >= MAX_SESSION_RECREATIONS) {
            throw new Error(
              `Gagal upload setelah ${MAX_SESSION_RECREATIONS}x pembuatan ulang sesi. ` +
              `Server Google Drive mungkin sedang bermasalah. Coba lagi nanti.`
            )
          }
          sessionRecreations++
          updateFile(fileId, f => ({
            ...f,
            error: `Membuat ulang sesi upload (percobaan ${sessionRecreations}/${MAX_SESSION_RECREATIONS})...`
          }))
          try {
            const newSession = await createUploadSession()
            uploadUrl = newSession.uploadUrl
            consecutiveSessionErrors = 0
            // Restart from chunk 0 with the new session — Drive's resumable
            // upload doesn't support cross-session byte offset resume.
            chunkIndex = 0
            continue
          } catch (recreateErr) {
            chunkError = recreateErr instanceof Error ? recreateErr : new Error('Gagal membuat ulang sesi upload')
          }
        }

        if (chunkError) throw chunkError
        if (!chunkResult) throw new Error('Gagal mengupload chunk — tidak ada respons')

        // Clear any retry status message
        updateFile(fileId, f => ({ ...f, error: undefined }))

        // Update progress: map chunk progress to 5%–95% range
        const pct = Math.round(5 + (chunkResult.nextChunk / totalChunks) * 90)
        updateFile(fileId, f => ({ ...f, progress: Math.min(pct, 95) }))

        if (chunkResult.complete) {
          uploadComplete = true
          uploadedFile = chunkResult.file ?? null
        } else {
          chunkIndex = chunkResult.nextChunk
        }
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
      if (uploadedFile?.id) {
        updateFile(fileId, f => ({ ...f, progress: 97, error: 'Menyelesaikan & membagikan file...' }))
        // Retry up to 3 times — upload-complete may hit a cold Cloudflare
        // Workers isolate (JWT signing for access token can exceed the 10ms
        // CPU limit). A retry usually lands on a warm isolate.
        for (let attempt = 0; attempt < 3; attempt++) {
          if (abortController.signal.aborted) break
          try {
            const shareResponse = await fetch('/api/drive/upload-complete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fileId: uploadedFile.id }),
              signal: abortController.signal
            })
            if (shareResponse.ok) {
              const shareData = await shareResponse.json()
              if (shareData.file) uploadedFile = shareData.file
              break // success
            }
            // 5xx — retry. 4xx — don't retry (client error).
            if (shareResponse.status < 500) break
          } catch (e) {
            // Network error — retry
          }
          if (attempt < 2) {
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
          }
        }
      }

      // ===== SUCCESS =====
      updateFile(fileId, f => ({
        ...f,
        progress: 100,
        status: 'success',
        webViewLink: uploadedFile?.webViewLink
      }))

      if (onUploadComplete && uploadedFile) {
        onUploadComplete({ name: uploadedFile.name || autoFileName || file.name, webViewLink: uploadedFile.webViewLink || '' })
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        setError('Upload dibatalkan')
      } else {
        setError(error instanceof Error ? error.message : 'Upload gagal')
      }
    } finally {
      // Always release the queue so the next file can start, even if this
      // upload failed or was aborted.
      releaseQueue()
    }
  }, [folderLink, projectId, onUploadComplete, updateFile, projectTitle, executionTime, uploaderName])

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files) return
    // Each call to uploadFile() immediately registers the file in the UI list
    // (so the user sees all dropped files right away), then waits in the
    // internal sequential queue before doing actual network work.
    // See uploadFile() for the queue implementation.
    Array.from(files).forEach(file => uploadFile(file))
  }, [uploadFile])

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true) }
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false) }
  const handleDrop = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); handleFiles(e.dataTransfer.files) }
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFiles(e.target.files)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const cancelUpload = (uid: string) => {
    setUploadingFiles(prev => {
      const f = prev.find(x => x.id === uid)
      if (f?.abortController) f.abortController.abort()
      return prev.map(x => x.id === uid ? { ...x, status: 'error' as const, error: 'Dibatalkan' } : x)
    })
  }

  const removeFile = (uid: string) => {
    setUploadingFiles(prev => {
      const f = prev.find(x => x.id === uid)
      if (f?.abortController) f.abortController.abort()
      return prev.filter(x => x.id !== uid)
    })
  }

  const clearCompleted = () => {
    setUploadingFiles(prev => prev.filter(f => f.status === 'uploading'))
  }

  const isUploading = uploadingFiles.some(f => f.status === 'uploading')

  return (
    <div className={cn("space-y-3", className)}>
      {/* Drop Zone */}
      <div
        className={cn(
          "border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer",
          isDragging ? "border-indigo-500 bg-indigo-50 scale-[1.01]"
          : isUploading ? "border-indigo-300 bg-indigo-50/30 cursor-wait"
          : "border-stone-300 hover:border-indigo-400 hover:bg-stone-50"
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !isUploading && fileInputRef.current?.click()}
      >
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
        <UploadCloud className={cn(
          "w-10 h-10 mx-auto mb-3 transition-colors",
          isDragging ? "text-indigo-600" : isUploading ? "text-indigo-400 animate-pulse" : "text-stone-400"
        )} />
        <p className="text-sm font-medium text-stone-700 mb-1">
          {isDragging ? 'Lepaskan file di sini...' : isUploading ? 'Sedang mengupload...' : 'Klik atau seret file ke sini'}
        </p>
        <p className="text-xs text-stone-400">
          Upload langsung ke Google Drive — gambar, video, dokumen, dll.
        </p>
      </div>

      {/* Upload Progress List */}
      {uploadingFiles.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-stone-500 uppercase tracking-wider">
              File ({uploadingFiles.length})
            </span>
            {uploadingFiles.some(f => f.status !== 'uploading') && (
              <Button variant="ghost" size="sm" onClick={clearCompleted} className="h-6 text-xs text-stone-500">
                Hapus Selesai
              </Button>
            )}
          </div>

          {uploadingFiles.map(file => {
            const Icon = getFileIcon(file.name)
            return (
              <div key={file.id} className={cn(
                "flex items-center gap-3 p-3 rounded-lg border transition-all",
                file.status === 'success' && "bg-green-50 border-green-200",
                file.status === 'error' && "bg-red-50 border-red-200",
                file.status === 'uploading' && "bg-white border-stone-200 shadow-sm"
              )}>
                <Icon className={cn("w-5 h-5 flex-shrink-0",
                  file.status === 'success' && "text-green-600",
                  file.status === 'error' && "text-red-500",
                  file.status === 'uploading' && "text-indigo-600"
                )} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-stone-700 truncate" title={file.autoName || file.name}>{file.autoName || file.name}</span>
                    <span className="text-xs text-stone-400 ml-2 flex-shrink-0 tabular-nums">{formatFileSize(file.size)}</span>
                  </div>

                  {file.status === 'uploading' && (
                    <div className="space-y-0.5">
                      <Progress value={file.progress} className="h-1.5" />
                      <span className="text-[10px] text-stone-400 tabular-nums">{file.progress}%</span>
                    </div>
                  )}

                  {file.status === 'error' && file.error && (
                    <p className="text-xs text-red-600 mt-1">{file.error}</p>
                  )}

                  {file.status === 'success' && file.webViewLink && (
                    <a href={file.webViewLink} target="_blank" rel="noopener noreferrer"
                       className="text-xs text-green-600 hover:text-green-700 hover:underline mt-1 block">
                      Lihat di Google Drive →
                    </a>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {file.status === 'uploading' && (
                    <>
                      <Loader2 className="w-4 h-4 text-indigo-600 animate-spin" />
                      <Button variant="ghost" size="sm" onClick={() => cancelUpload(file.id)}
                        className="h-6 w-6 p-0 text-red-400 hover:text-red-600" title="Batalkan">
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </>
                  )}
                  {file.status === 'success' && <CheckCircle2 className="w-5 h-5 text-green-600" />}
                  {file.status === 'error' && <AlertCircle className="w-5 h-5 text-red-500" />}
                  {file.status !== 'uploading' && (
                    <Button variant="ghost" size="sm" onClick={() => removeFile(file.id)}
                      className="h-6 w-6 p-0 text-stone-400 hover:text-stone-600">
                      <X className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
