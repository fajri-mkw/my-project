'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  ExternalLink,
  RefreshCw,
  Folder,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Upload,
  FileIcon,
  Film,
  Image as ImageIcon,
  FileText,
  Archive,
  UploadCloud,
  ChevronRight,
  X,
  ExternalLink as ExternalLinkIcon,
} from 'lucide-react'

interface DriveFolderEmbedProps {
  folderLink: string // Google Drive folder URL (e.g. https://drive.google.com/drive/folders/XXX)
  folderLabel?: string // Display name for the folder (e.g. "1. PRODUKSI")
  onFilesDetected?: (info: {
    fileCount: number
    folderLink: string
    files: Array<{ id: string; name: string; mimeType: string; size?: string; modifiedTime?: string }>
  }) => void
  /**
   * Completion props — when provided, the in-modal "Selesaikan & Serahkan"
   * button is rendered so the petugas can hand over the project WITHOUT
   * leaving the upload modal. This solves the "petugas lupa kembali ke
   * halaman unggah hasil" problem.
   */
  onComplete?: () => void
  canComplete?: boolean
  isSubmitting?: boolean
  showCompleteButton?: boolean
  className?: string
}

interface DriveFile {
  id: string
  name: string
  mimeType: string
  size?: string
  modifiedTime?: string
}

interface UploadTask {
  id: string
  file: File
  status: 'pending' | 'uploading' | 'done' | 'error'
  progress: number // 0-100
  error?: string
  result?: { id: string; name: string; webViewLink?: string }
  verified?: boolean // true if success was confirmed via folder re-scan (not a direct XHR 2xx)
}

// Extract real Google Drive folder ID from URL (reject constructed/mock IDs)
function extractFolderId(url: string): string | null {
  if (!url) return null
  const match = url.match(/\/folders\/([a-zA-Z0-9_-]+)/)
  if (!match) return null
  const extracted = match[1]
  const knownPrefixes = ['raw-', 'revised-', 'final-', 'desain-', 'lainnya-', 'mock-']
  if (knownPrefixes.some((p) => extracted.startsWith(p))) return null
  if (extracted.length < 20) return null
  return extracted
}

function getFileIcon(fileName: string, mimeType?: string) {
  if (mimeType === 'application/vnd.google-apps.folder') return Folder
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  const videoExts = ['mp4', 'mov', 'avi', 'mkv', 'wmv', 'flv', 'webm', 'm4v']
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'heic']
  const archiveExts = ['zip', 'rar', '7z', 'tar', 'gz']
  const docExts = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt']
  if (videoExts.includes(ext)) return Film
  if (imageExts.includes(ext)) return ImageIcon
  if (archiveExts.includes(ext)) return Archive
  if (docExts.includes(ext)) return FileText
  return FileIcon
}

function formatFileSize(bytes?: string | number) {
  if (!bytes) return ''
  const n = typeof bytes === 'string' ? parseInt(bytes, 10) : bytes
  if (!n || isNaN(n)) return ''
  if (n === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(n) / Math.log(k))
  return parseFloat((n / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function formatTime(iso?: string) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

// ============================================================================
// Direct browser → Google Drive resumable upload.
//
// WHY: The old chunked FileUpload proxied every chunk through Cloudflare
// Workers, which hit the 50-subrequest limit + 10ms CPU limit and errored
// out on many files. This implementation:
//   1. Asks our API for a resumable upload session URI (1 cheap server call,
//      uses cached access token — no JWT signing on the hot path).
//   2. PUTs the file body DIRECTLY to Google from the browser (XMLHttpRequest).
//      This bypasses CF Workers entirely → no subrequest/CPU limits, supports
//      any file size, and gives real progress bars via XHR upload events.
//
// The session URI is single-use and scoped to this specific file upload, so
// exposing it to the browser is NOT a security risk (unlike exposing the
// service-account access token would be).
//
// ============================================================================
// CRITICAL FIX — Post-error verification (solves the "upload succeeded but
// XHR reported error" problem):
//
// When the browser PUTs a file directly to www.googleapis.com (cross-origin),
// Google's resumable upload endpoint sometimes:
//   - Receives all the file bytes and saves the file successfully, BUT
//   - Returns a response that the browser can't read (missing/wrong CORS
//     headers on the response, or the TCP connection drops right after
//     the last byte is received but before the response arrives).
//
// Result: xhr.onerror fires (or xhr.onload with status 0) even though the
// file IS in Google Drive. The user sees a confusing red "Koneksi error"
// message while the file list below shows the file as present.
//
// FIX: After ANY XHR error, we wait a moment then query /api/drive/folder-files
// to check if a file with the same name now exists in the target folder.
//   - If found → the upload actually succeeded → resolve as success
//     (marked as "verified" so the UI can show a reassuring message).
//   - If not found → the upload genuinely failed → reject with the error.
//
// This is more robust than retrying, because retrying a file that's already
// in Drive would create a duplicate. Verification is idempotent and safe.
// ============================================================================

interface UploadResult {
  id: string
  name: string
  webViewLink?: string
  verified?: boolean // true if success was confirmed via folder re-scan
}

// Check if a file with the given name exists in the Drive folder.
// Used for post-error verification.
async function checkFileExistsInFolder(
  folderId: string,
  fileName: string,
): Promise<{ id: string; name: string } | null> {
  try {
    const res = await fetch(
      `/api/drive/folder-files?folderId=${encodeURIComponent(folderId)}`,
      { cache: 'no-store' },
    )
    if (!res.ok) return null
    const data = await res.json()
    if (data.mock || !data.files) return null
    const match = data.files.find(
      (f: { name: string; id: string }) => f.name === fileName,
    )
    return match ? { id: match.id, name: match.name } : null
  } catch {
    return null
  }
}

// Create a resumable upload session via our API (returns the session URI).
async function createUploadSession(
  file: File,
  folderId: string,
): Promise<string> {
  const initRes = await fetch('/api/drive/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      folderId,
    }),
  })
  if (!initRes.ok) {
    const d = await initRes.json().catch(() => ({}))
    throw new Error(d?.error || `Gagal memulai upload (HTTP ${initRes.status})`)
  }
  const { uploadUrl } = await initRes.json()
  if (!uploadUrl) throw new Error('Server tidak mengembalikan URL upload')
  return uploadUrl
}

// PUT a file to a resumable upload session URI via XHR.
// Returns the parsed response on 2xx, throws on non-2xx/network error.
function putFileToSession(
  uploadUrl: string,
  file: File,
  onProgress: (loaded: number, total: number) => void,
): Promise<{ id: string; name: string; webViewLink?: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', uploadUrl, true)
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    if (file.size > 0) {
      xhr.setRequestHeader(
        'Content-Range',
        `bytes 0-${file.size - 1}/${file.size}`,
      )
    }
    // No timeout — large video files can take a long time on slow connections.
    xhr.timeout = 0

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(e.loaded, e.total)
      }
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText || '{}')
          resolve({
            id: data.id || '',
            name: data.name || file.name,
            webViewLink: data.webViewLink,
          })
        } catch {
          // Upload succeeded but response wasn't JSON — still a success.
          resolve({ id: '', name: file.name })
        }
      } else {
        let detail = `HTTP ${xhr.status}`
        try {
          const errData = JSON.parse(xhr.responseText || '{}')
          if (errData.error?.message) detail = errData.error.message
        } catch {
          // ignore parse error
        }
        reject(new Error(`Upload gagal: ${detail}`))
      }
    }

    xhr.onerror = () => {
      // This fires on network errors AND CORS response issues. The file may
      // still have been received by Google — the caller must verify.
      reject(new Error('__XHR_NETWORK_ERROR__'))
    }

    xhr.ontimeout = () => reject(new Error('Upload timeout — coba lagi'))

    xhr.send(file)
  })
}

// Wait for a number of milliseconds.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function uploadFileToDrive(
  file: File,
  folderId: string,
  onProgress: (loaded: number, total: number) => void,
): Promise<UploadResult> {
  // === Attempt 1: create session + PUT file ===
  const uploadUrl = await createUploadSession(file, folderId)

  try {
    const result = await putFileToSession(uploadUrl, file, onProgress)
    return result
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)

    // === Post-error verification ===
    // If the XHR errored (network/CORS), the file may still have landed in
    // Google Drive. Wait 2 seconds for Google to index it, then check.
    if (errMsg === '__XHR_NETWORK_ERROR__') {
      onProgress(file.size, file.size) // show 100% while we verify
      await sleep(2000)
      const existing = await checkFileExistsInFolder(folderId, file.name)
      if (existing) {
        // The file IS in Drive — the XHR error was a false alarm (response
        // lost, not the upload itself). Mark as verified success.
        return {
          id: existing.id,
          name: existing.name,
          verified: true,
        }
      }

      // === Attempt 2: retry with a fresh session URI ===
      // The first session may have been consumed (Google received the bytes
      // but the browser couldn't read the response). A fresh session gives
      // us a clean retry. If the file was partially uploaded, Google's
      // resumable protocol will resume from where it left off.
      try {
        const retryUrl = await createUploadSession(file, folderId)
        const retryResult = await putFileToSession(retryUrl, file, onProgress)
        return retryResult
      } catch (retryErr) {
        // Retry also failed — do one more verification in case the retry
        // uploaded the bytes but (again) lost the response.
        await sleep(2000)
        const verified = await checkFileExistsInFolder(folderId, file.name)
        if (verified) {
          return { id: verified.id, name: verified.name, verified: true }
        }
        // Genuine failure.
        throw new Error(
          'Koneksi error saat upload. File tidak terdeteksi di folder. Jika error berulang, gunakan tombol "Buka di Tab Baru" untuk upload via Google Drive langsung.',
        )
      }
    }

    // Non-network error (e.g. HTTP 4xx from Google) — don't retry, just rethrow.
    throw err
  }
}

export function DriveFolderEmbed({
  folderLink,
  folderLabel,
  onFilesDetected,
  onComplete,
  canComplete = false,
  isSubmitting = false,
  showCompleteButton = false,
  className,
}: DriveFolderEmbedProps) {
  const folderId = extractFolderId(folderLink)
  const [fileCount, setFileCount] = useState<number>(0)
  const [files, setFiles] = useState<DriveFile[]>([])
  const [isChecking, setIsChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastChecked, setLastChecked] = useState<Date | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  // === Modal state ===
  const [modalOpen, setModalOpen] = useState(false)
  const [uploadTasks, setUploadTasks] = useState<UploadTask[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadCanceledRef = useRef(false)

  const checkFiles = useCallback(
    async (silent = false) => {
      if (!folderId) return
      if (!silent) setIsChecking(true)
      setError(null)
      try {
        const res = await fetch(
          `/api/drive/folder-files?folderId=${encodeURIComponent(folderId)}`,
          { cache: 'no-store' },
        )
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          throw new Error(d?.error || `HTTP ${res.status}`)
        }
        const data = await res.json()
        if (data.mock) {
          setFileCount(0)
          setFiles([])
          return
        }
        const newCount = data.fileCount || 0
        const newFiles = (data.files || []) as DriveFile[]
        setFileCount(newCount)
        setFiles(newFiles)
        setLastChecked(new Date())
        if (onFilesDetected) {
          onFilesDetected({
            fileCount: newCount,
            folderLink: data.folderLink || folderLink,
            files: newFiles,
          })
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Gagal mengecek file'
        setError(msg)
      } finally {
        if (!silent) setIsChecking(false)
      }
    },
    [folderId, folderLink, onFilesDetected],
  )

  // Initial check + auto-poll every 20 seconds (only while modal is closed —
  // when modal is open we poll faster + on-demand after each upload)
  useEffect(() => {
    mountedRef.current = true
    if (!folderId) {
      setFileCount(0)
      setFiles([])
      return
    }

    checkFiles()

    const startPoll = () => {
      pollTimerRef.current = setTimeout(async () => {
        if (!mountedRef.current) return
        await checkFiles(true)
        if (mountedRef.current) startPoll()
      }, 20_000)
    }
    startPoll()

    return () => {
      mountedRef.current = false
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    }
  }, [folderId, checkFiles])

  // Poll faster (every 5s) while the modal is open, so the file list updates
  // quickly after an upload completes.
  useEffect(() => {
    if (!modalOpen || !folderId) return
    const fastPoll = setInterval(() => {
      if (mountedRef.current) checkFiles(true)
    }, 5_000)
    return () => clearInterval(fastPoll)
  }, [modalOpen, folderId, checkFiles])

  // Reset upload state when modal closes
  useEffect(() => {
    if (!modalOpen) {
      uploadCanceledRef.current = true
      // Keep uploadTasks for a moment so the closing animation doesn't flash
      // an empty list; clear after the dialog unmounts.
      const t = setTimeout(() => setUploadTasks([]), 300)
      return () => clearTimeout(t)
    }
    uploadCanceledRef.current = false
  }, [modalOpen])

  // === Handle file selection (from input or drag-drop) ===
  const handleFilesSelected = useCallback(
    async (selectedFiles: FileList | File[]) => {
      if (!folderId) return
      const fileArr = Array.from(selectedFiles)
      if (fileArr.length === 0) return

      uploadCanceledRef.current = false

      const newTasks: UploadTask[] = fileArr.map((f) => ({
        id:
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `task-${Date.now()}-${Math.random()}`,
        file: f,
        status: 'pending',
        progress: 0,
      }))
      setUploadTasks((prev) => [...prev, ...newTasks])

      // Upload sequentially — parallel uploads to the same Shared Drive can
      // cause Google rate-limit (429) errors, especially on the free tier.
      for (const task of newTasks) {
        if (uploadCanceledRef.current) break

        setUploadTasks((prev) =>
          prev.map((t) => (t.id === task.id ? { ...t, status: 'uploading' } : t)),
        )

        try {
          const result = await uploadFileToDrive(
            task.file,
            folderId,
            (loaded, total) => {
              const pct = total > 0 ? Math.round((loaded / total) * 100) : 0
              setUploadTasks((prev) =>
                prev.map((t) =>
                  t.id === task.id ? { ...t, progress: pct } : t,
                ),
              )
            },
          )
          setUploadTasks((prev) =>
            prev.map((t) =>
              t.id === task.id
                ? { ...t, status: 'done', progress: 100, result, verified: result.verified }
                : t,
            ),
          )
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Upload gagal'
          setUploadTasks((prev) =>
            prev.map((t) =>
              t.id === task.id ? { ...t, status: 'error', error: msg } : t,
            ),
          )
        }
      }

      // After all uploads finish, immediately refresh the folder file list
      // so onFilesDetected fires and the completion gate opens.
      await checkFiles()
    },
    [folderId, checkFiles],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)
      if (e.dataTransfer.files.length > 0) {
        handleFilesSelected(e.dataTransfer.files)
      }
    },
    [handleFilesSelected],
  )

  const handleRetryTask = useCallback(
    async (taskId: string) => {
      const task = uploadTasks.find((t) => t.id === taskId)
      if (!task || !folderId) return
      setUploadTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? { ...t, status: 'uploading', progress: 0, error: undefined }
            : t,
        ),
      )
      try {
        const result = await uploadFileToDrive(
          task.file,
          folderId,
          (loaded, total) => {
            const pct = total > 0 ? Math.round((loaded / total) * 100) : 0
            setUploadTasks((prev) =>
              prev.map((t) =>
                t.id === taskId ? { ...t, progress: pct } : t,
              ),
            )
          },
        )
        setUploadTasks((prev) =>
          prev.map((t) =>
            t.id === taskId
              ? { ...t, status: 'done', progress: 100, result, verified: result.verified }
              : t,
          ),
        )
        await checkFiles()
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload gagal'
        setUploadTasks((prev) =>
          prev.map((t) =>
            t.id === taskId ? { ...t, status: 'error', error: msg } : t,
          ),
        )
      }
    },
    [uploadTasks, folderId, checkFiles],
  )

  const handleCompleteClick = useCallback(async () => {
    if (!onComplete) return
    await onComplete()
    // If onComplete resolved without throwing, the project likely advanced
    // and this card unmounts. Close the modal as a safety net.
    setModalOpen(false)
  }, [onComplete])

  // Invalid folder — show mock-mode warning
  if (!folderId) {
    return (
      <div className={cn('rounded-xl border border-amber-200 bg-amber-50 p-4', className)}>
        <div className="flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-amber-800">
            <strong>Folder belum siap.</strong>{' '}
            Folder Google Drive untuk tugas ini belum dibuat oleh Manajer.
            Silakan hubungi Manajer/Admin untuk membuat folder Drive pada proyek ini.
          </div>
        </div>
      </div>
    )
  }

  const embedUrl = `https://drive.google.com/embeddedfolderview?folderId=${folderId}#list`

  const completedCount = uploadTasks.filter((t) => t.status === 'done').length
  const errorCount = uploadTasks.filter((t) => t.status === 'error').length
  const uploadingCount = uploadTasks.filter((t) => t.status === 'uploading').length

  return (
    <div className={cn('space-y-3', className)}>
      {/* Header row: folder name + status + actions */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Folder className="w-4 h-4 text-amber-500 flex-shrink-0" />
          <span className="text-sm font-semibold text-stone-700 truncate">
            {folderLabel || 'Folder Drive'}
          </span>
          {fileCount > 0 ? (
            <Badge className="bg-green-100 text-green-700 border-green-200 text-[10px] font-bold flex-shrink-0">
              <CheckCircle2 className="w-3 h-3 mr-0.5" />
              {fileCount} file terdeteksi
            </Badge>
          ) : (
            <Badge className="bg-stone-100 text-stone-500 border-stone-200 text-[10px] font-bold flex-shrink-0">
              Belum ada file
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => checkFiles()}
            disabled={isChecking}
            className="h-7 px-2 text-xs text-stone-600 hover:bg-stone-100"
          >
            {isChecking ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            <span className="ml-1 hidden sm:inline">Refresh</span>
          </Button>
          {/* === "Buka di Drive" — now opens an in-page modal (NOT a new tab) ===
              The modal contains a drag-drop uploader + live folder preview +
              the "Selesaikan & Serahkan" button, so petugas never has to
              leave the page to mark the task done. */}
          <Button
            type="button"
            size="sm"
            onClick={() => setModalOpen(true)}
            className="h-7 px-3 text-xs bg-green-600 hover:bg-green-700 text-white gap-1.5"
          >
            <UploadCloud className="w-3.5 h-3.5" />
            Buka di Drive
          </Button>
        </div>
      </div>

      {/* Instruction banner */}
      <div className="rounded-xl border border-green-200 bg-gradient-to-br from-green-50 to-emerald-50 p-4">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-green-100 rounded-lg flex-shrink-0">
            <Upload className="w-4 h-4 text-green-700" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-green-900 mb-1">
              Upload langsung via Google Drive
            </p>
            <p className="text-xs text-green-800 leading-relaxed">
              Klik <strong>&quot;Buka di Drive&quot;</strong> di kanan atas. Jendela
              upload akan muncul di halaman ini — seret file Anda, tunggu upload
              selesai, lalu klik <strong>Selesaikan &amp; Serahkan</strong> langsung
              di jendela tersebut. Tidak perlu pindah tab atau kembali ke halaman ini.
            </p>
            <div className="mt-2 flex items-center gap-2 text-[10px] text-green-700">
              {lastChecked ? (
                <>
                  <span className="inline-block w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                  <span>
                    Diperbarui otomatis · Terakhir: {lastChecked.toLocaleTimeString('id-ID')}
                  </span>
                </>
              ) : (
                <span>Memeriksa file...</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-red-700">
            <strong>Gagal memeriksa file:</strong> {error}
            <button
              type="button"
              onClick={() => checkFiles()}
              className="ml-2 underline hover:text-red-900"
            >
              Coba lagi
            </button>
          </div>
        </div>
      )}

      {/* File list preview — shows up to 5 most recent files */}
      {files.length > 0 && (
        <div className="rounded-xl border border-stone-200 bg-white overflow-hidden">
          <div className="px-3 py-2 bg-stone-50 border-b border-stone-200">
            <p className="text-xs font-bold text-stone-600 uppercase tracking-wide">
              File Terbaru di Folder
            </p>
          </div>
          <ul className="divide-y divide-stone-100 max-h-64 overflow-y-auto">
            {files.slice(0, 5).map((f) => {
              const Icon = getFileIcon(f.name, f.mimeType)
              return (
                <li key={f.id} className="px-3 py-2 flex items-center gap-3">
                  <Icon className="w-4 h-4 text-stone-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-stone-700 truncate">
                      {f.name}
                    </p>
                    <p className="text-[10px] text-stone-400">
                      {formatFileSize(f.size)}
                      {f.modifiedTime ? ` · ${formatTime(f.modifiedTime)}` : ''}
                    </p>
                  </div>
                  <a
                    href={`https://drive.google.com/file/d/${f.id}/view`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-stone-400 hover:text-indigo-600 flex-shrink-0"
                    title="Buka file"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </li>
              )
            })}
            {files.length > 5 && (
              <li className="px-3 py-2 text-center text-[10px] text-stone-400">
                +{files.length - 5} file lainnya — klik &quot;Buka di Drive&quot; untuk melihat semua
              </li>
            )}
          </ul>
        </div>
      )}

      {/* Embedded Drive folder view — read-only live preview */}
      <div className="rounded-xl border border-stone-200 overflow-hidden bg-stone-50">
        <div className="px-3 py-2 bg-white border-b border-stone-200 flex items-center justify-between">
          <p className="text-xs font-bold text-stone-600 flex items-center gap-1.5">
            <Folder className="w-3.5 h-3.5 text-amber-500" />
            Pratinjau Folder Google Drive
          </p>
          <span className="text-[10px] text-stone-400">Live preview</span>
        </div>
        <iframe
          src={embedUrl}
          className="w-full"
          style={{ height: '380px', border: 'none' }}
          title={`Drive folder: ${folderLabel || 'folder'}`}
          loading="lazy"
        />
      </div>

      {/* === IN-PAGE UPLOAD MODAL ===
          Replaces the old "open new tab to Google Drive" behavior.
          Petugas can upload files AND click "Selesaikan & Serahkan" without
          ever leaving this page. */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-hidden flex flex-col gap-0 p-0">
          <DialogHeader className="px-5 pt-5 pb-3 border-b border-stone-200">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Folder className="w-4 h-4 text-amber-500" />
              Upload ke {folderLabel || 'Folder Drive'}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Seret file ke kotak di bawah atau klik untuk memilih. File langsung
              tersimpan ke Google Drive dan terdeteksi otomatis.
            </DialogDescription>
          </DialogHeader>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {/* Drag-drop / file picker zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setIsDragOver(true)
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors',
                isDragOver
                  ? 'border-green-500 bg-green-50'
                  : 'border-stone-300 hover:border-green-400 hover:bg-green-50/50',
              )}
            >
              <UploadCloud className="w-8 h-8 mx-auto mb-2 text-stone-400" />
              <p className="text-sm font-medium text-stone-700">
                Seret file ke sini, atau{' '}
                <span className="text-green-700 underline">klik untuk pilih file</span>
              </p>
              <p className="text-[10px] text-stone-400 mt-1">
                Mendukung semua jenis file (foto, video, dokumen) — tanpa batas ukuran
              </p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) handleFilesSelected(e.target.files)
                  e.target.value = ''
                }}
              />
            </div>

            {/* Upload progress list */}
            {uploadTasks.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-stone-600 uppercase tracking-wide">
                    Status Upload
                  </p>
                  {(completedCount > 0 || errorCount > 0) && (
                    <p className="text-[10px] text-stone-500">
                      {completedCount} selesai · {errorCount} gagal
                      {uploadingCount > 0 && ` · ${uploadingCount} sedang upload`}
                    </p>
                  )}
                </div>
                <ul className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                  {uploadTasks.map((t) => {
                    const Icon = getFileIcon(t.file.name, t.file.type)
                    return (
                      <li
                        key={t.id}
                        className="flex items-center gap-3 p-2 rounded-lg border border-stone-200 bg-white"
                      >
                        <Icon className="w-4 h-4 text-stone-400 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-medium text-stone-700 truncate">
                              {t.file.name}
                            </p>
                            <span className="text-[10px] text-stone-400 flex-shrink-0">
                              {formatFileSize(t.file.size)}
                            </span>
                          </div>
                          {t.status === 'uploading' && (
                            <div className="mt-1 flex items-center gap-2">
                              <div className="flex-1 h-1.5 bg-stone-200 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-green-500 transition-all duration-200"
                                  style={{ width: `${t.progress}%` }}
                                />
                              </div>
                              <span className="text-[10px] text-stone-500 w-9 text-right">
                                {t.progress}%
                              </span>
                              {t.progress >= 100 && (
                                <span className="text-[10px] text-stone-500 italic flex-shrink-0">
                                  memverifikasi...
                                </span>
                              )}
                            </div>
                          )}
                          {t.status === 'done' && (
                            <p className="text-[10px] text-green-600 flex items-center gap-1 mt-0.5">
                              <CheckCircle2 className="w-3 h-3" />
                              {t.verified
                                ? 'Berhasil terupload (terverifikasi)'
                                : 'Berhasil terupload'}
                            </p>
                          )}
                          {t.status === 'error' && (
                            <div className="mt-0.5 flex items-center justify-between gap-2">
                              <p className="text-[10px] text-red-600 flex items-center gap-1 truncate">
                                <AlertCircle className="w-3 h-3 flex-shrink-0" />
                                <span className="truncate">{t.error}</span>
                              </p>
                              <button
                                type="button"
                                onClick={() => handleRetryTask(t.id)}
                                className="text-[10px] text-red-700 underline flex-shrink-0 hover:text-red-900"
                              >
                                Ulangi
                              </button>
                            </div>
                          )}
                          {t.status === 'pending' && (
                            <p className="text-[10px] text-stone-400 mt-0.5">
                              Menunggu giliran...
                            </p>
                          )}
                        </div>
                        {t.status === 'done' && (
                          <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                        )}
                        {t.status === 'uploading' && (
                          <Loader2 className="w-4 h-4 text-green-500 animate-spin flex-shrink-0" />
                        )}
                        {t.status === 'error' && (
                          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}

            {/* Live folder file list */}
            <div className="rounded-xl border border-stone-200 overflow-hidden">
              <div className="px-3 py-2 bg-stone-50 border-b border-stone-200 flex items-center justify-between">
                <p className="text-xs font-bold text-stone-600 flex items-center gap-1.5">
                  <Folder className="w-3.5 h-3.5 text-amber-500" />
                  File di Folder
                  <Badge
                    className={cn(
                      'text-[10px] font-bold',
                      fileCount > 0
                        ? 'bg-green-100 text-green-700 border-green-200'
                        : 'bg-stone-100 text-stone-500 border-stone-200',
                    )}
                  >
                    {fileCount}
                  </Badge>
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => checkFiles()}
                  disabled={isChecking}
                  className="h-6 px-2 text-[11px] text-stone-600 hover:bg-stone-100"
                >
                  {isChecking ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3 h-3" />
                  )}
                  Refresh
                </Button>
              </div>
              <div className="max-h-40 overflow-y-auto bg-white">
                {files.length === 0 ? (
                  <p className="text-xs text-stone-400 text-center py-6">
                    Belum ada file di folder ini
                  </p>
                ) : (
                  <ul className="divide-y divide-stone-100">
                    {files.slice(0, 20).map((f) => {
                      const Icon = getFileIcon(f.name, f.mimeType)
                      return (
                        <li
                          key={f.id}
                          className="px-3 py-1.5 flex items-center gap-2"
                        >
                          <Icon className="w-3.5 h-3.5 text-stone-400 flex-shrink-0" />
                          <span className="text-xs text-stone-700 truncate flex-1">
                            {f.name}
                          </span>
                          <span className="text-[10px] text-stone-400 flex-shrink-0">
                            {formatFileSize(f.size)}
                          </span>
                        </li>
                      )
                    })}
                    {files.length > 20 && (
                      <li className="px-3 py-1.5 text-center text-[10px] text-stone-400">
                        +{files.length - 20} file lainnya
                      </li>
                    )}
                  </ul>
                )}
              </div>
            </div>

            {/* Fallback: open Drive in new tab (for very large files or if
                the in-modal uploader has issues) */}
            <div className="flex items-center justify-center gap-2 pt-1">
              <a
                href={folderLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-stone-500 hover:text-stone-700 underline"
              >
                <ExternalLinkIcon className="w-3 h-3" />
                Buka Google Drive di tab baru (alternatif)
              </a>
            </div>
          </div>

          {/* === Footer with "Selesaikan & Serahkan" ===
              Only rendered when showCompleteButton is true (upload-type tasks).
              The button activates as soon as ≥1 file is detected in the folder,
              so the petugas can hand over immediately after uploading — without
              closing the modal or navigating anywhere. */}
          {showCompleteButton && (
            <div className="border-t border-stone-200 bg-stone-50 px-5 py-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="text-xs">
                {fileCount > 0 ? (
                  <span className="text-green-700 font-medium flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    {fileCount} file terdeteksi — siap diserahkan
                  </span>
                ) : (
                  <span className="text-amber-600 flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4" />
                    Upload minimal 1 file untuk mengaktifkan serah-terima
                  </span>
                )}
              </div>
              <Button
                type="button"
                disabled={!canComplete || isSubmitting}
                onClick={handleCompleteClick}
                className={cn(
                  'gap-2 min-w-[180px] justify-center',
                  canComplete && !isSubmitting
                    ? 'bg-indigo-600 hover:bg-indigo-700 ring-2 ring-indigo-200 ring-offset-2'
                    : 'bg-stone-200 text-stone-400 cursor-not-allowed shadow-none',
                )}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Memproses Serah Terima…</span>
                  </>
                ) : (
                  <>
                    <span>Selesaikan &amp; Serahkan</span>
                    <ChevronRight className="w-4 h-4" />
                  </>
                )}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
