'use client'

/**
 * Shared chunked upload utility for Google Drive.
 *
 * This module provides a single, reusable function to upload files of ANY size
 * (up to Google Drive's 5 TB limit) using the chunked resumable upload path:
 *
 *   1. POST /api/drive/upload-url  → get resumable session URL
 *   2. POST /api/drive/upload-chunk (loop) → upload 8 MB chunks
 *
 * This bypasses the memory bottleneck that existed in the old multipart/related
 * upload path (which loaded the ENTIRE file into memory as a Uint8Array, causing
 * OOM crashes on Cloudflare Workers for files > ~40 MB).
 *
 * Used by:
 *   - Surat document uploads (surat-management-view.tsx)
 *   - Program Kegiatan document uploads (program-kegiatan-view.tsx)
 *   - Project supporting document uploads (project-detail-view.tsx)
 *   - Petugas task file uploads (file-upload.tsx — uses its own inline implementation)
 */

const CHUNK_SIZE = 8 * 1024 * 1024 // 8 MB — must match backend upload-chunk/route.ts
const MAX_CHUNK_RETRIES = 2

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

  onProgress?.(2, 'Menyiapkan upload...')

  // ===== STEP 1: Get resumable upload URL from server =====
  // Retry on 5xx + network errors — Cloudflare Workers free-plan 10ms CPU
  // limit can cause transient 5xx responses on cold isolates (Prisma WASM
  // init + JWT signing + subfolder creation can exceed the limit).
  const MAX_URL_RETRIES = 2
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

  while (chunkIndex < totalChunks) {
    if (signal?.aborted) {
      throw new Error('Upload dibatalkan')
    }

    const start = chunkIndex * CHUNK_SIZE
    const end = Math.min(start + CHUNK_SIZE, totalSize)
    const chunkBlob = file.slice(start, end)

    const chunkFormData = new FormData()
    chunkFormData.append('uploadUrl', uploadUrl)
    chunkFormData.append('chunkIndex', chunkIndex.toString())
    chunkFormData.append('totalSize', totalSize.toString())
    chunkFormData.append('chunk', chunkBlob, file.name)

    // Retry loop for transient failures
    let chunkResult: { complete: boolean; nextChunk: number; file?: { id?: string; name?: string; webViewLink?: string; webContentLink?: string } } | null = null
    let chunkError: Error | null = null

    for (let attempt = 0; attempt <= MAX_CHUNK_RETRIES; attempt++) {
      if (signal?.aborted) {
        throw new Error('Upload dibatalkan')
      }

      try {
        const chunkResponse = await fetch('/api/drive/upload-chunk', {
          method: 'POST',
          body: chunkFormData,
          signal,
        })

        if (chunkResponse.ok) {
          chunkResult = await chunkResponse.json()
          chunkError = null
          break
        }

        // Non-OK response
        let errorMsg = `Gagal upload chunk ${chunkIndex + 1}/${totalChunks}`
        let isTransient = false
        try {
          const errData = await chunkResponse.json()
          errorMsg = errData.error || errorMsg
          isTransient = chunkResponse.status >= 500
        } catch {
          errorMsg = `Server error (${chunkResponse.status})`
          isTransient = chunkResponse.status >= 500 || chunkResponse.status === 0
        }

        if (!isTransient || attempt === MAX_CHUNK_RETRIES) {
          chunkError = new Error(errorMsg)
          break
        }

        // Show retry status
        const retryStatus = `Percobaan ulang #${attempt + 1} untuk chunk ${chunkIndex + 1}/${totalChunks}...`
        onProgress?.(Math.round(5 + (chunkIndex / totalChunks) * 90), retryStatus)
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
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

  // ===== STEP 3: Final fallback — get metadata if webViewLink is missing =====
  if (!uploadedFile.webViewLink) {
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
      }
    } catch (e) {
      console.error('[CHUNKED-UPLOAD] Share fallback failed:', e)
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
