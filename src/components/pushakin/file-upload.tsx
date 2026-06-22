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
import { useState, useRef, useCallback } from 'react'

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
// Retries help with transient Cloudflare Workers CPU-limit / network errors.
const MAX_CHUNK_RETRIES = 2

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

  const updateFile = useCallback((fileId: string, updater: (f: UploadingFile) => UploadingFile) => {
    setUploadingFiles(prev => prev.map(f => f.id === fileId ? updater(f) : f))
  }, [])

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

    // Add to list
    setUploadingFiles(prev => [...prev, {
      id: fileId, name: file.name, size: file.size,
      progress: 0, status: 'uploading', abortController
    }])

    const setError = (msg: string) => updateFile(fileId, f => ({ ...f, status: 'error', error: msg }))

    try {
      // ===== STEP 1: Get resumable upload URL from server =====
      updateFile(fileId, f => ({ ...f, progress: 2 }))

      // Build auto-naming metadata if available
      seriesCounterRef.current += 1
      const autoNameMeta = projectTitle ? {
        projectTitle,
        executionTime: executionTime || '',
        uploaderName: uploaderName || '',
        seriesNumber: seriesCounterRef.current
      } : undefined

      const urlResponse = await fetch('/api/drive/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, mimeType: file.type, folderId, autoNameMeta }),
        signal: abortController.signal
      })

      if (!urlResponse.ok) {
        let errorMsg = 'Gagal menyiapkan upload'
        try { const d = await urlResponse.json(); errorMsg = d.error || errorMsg } catch {}
        throw new Error(errorMsg)
      }

      const { uploadUrl, autoFileName } = await urlResponse.json()
      if (autoFileName) {
        updateFile(fileId, f => ({ ...f, autoName: autoFileName }))
      }
      if (!uploadUrl) throw new Error('URL upload tidak ditemukan')

      updateFile(fileId, f => ({ ...f, progress: 5 }))

      // ===== STEP 2: Upload file in chunks through server =====
      const totalSize = file.size
      const totalChunks = Math.ceil(totalSize / CHUNK_SIZE)
      let chunkIndex = 0
      let uploadComplete = false
      let uploadedFile: { id?: string; name?: string; webViewLink?: string; webContentLink?: string } | null = null

      while (chunkIndex < totalChunks && !uploadComplete) {
        // Check abort
        if (abortController.signal.aborted) {
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

        // Retry loop for transient failures (CF Workers CPU spikes, network blips).
        // 4xx errors fail fast (client/validation error — won't fix on retry).
        // 5xx + network errors retry up to MAX_CHUNK_RETRIES times.
        let chunkResult: { complete: boolean; nextChunk: number; file?: { id?: string; name?: string; webViewLink?: string; webContentLink?: string } } | null = null
        let chunkError: Error | null = null

        for (let attempt = 0; attempt <= MAX_CHUNK_RETRIES; attempt++) {
          if (abortController.signal.aborted) {
            throw new Error('Upload dibatalkan')
          }

          try {
            const chunkResponse = await fetch('/api/drive/upload-chunk', {
              method: 'POST',
              body: chunkFormData,
              signal: abortController.signal
            })

            if (chunkResponse.ok) {
              chunkResult = await chunkResponse.json()
              chunkError = null
              break
            }

            // Non-OK response — try to parse error JSON
            let errorMsg = `Gagal upload chunk ${chunkIndex + 1}/${totalChunks}`
            let isTransient = false
            try {
              const errData = await chunkResponse.json()
              errorMsg = errData.error || errorMsg
              // 5xx errors are transient (server errors, CF CPU limits)
              isTransient = chunkResponse.status >= 500
            } catch {
              // Response body is not JSON (likely a CF error page)
              errorMsg = `Server error (${chunkResponse.status})`
              isTransient = chunkResponse.status >= 500 || chunkResponse.status === 0
            }

            if (!isTransient || attempt === MAX_CHUNK_RETRIES) {
              chunkError = new Error(errorMsg)
              break
            }

            // Show retry status in the UI
            updateFile(fileId, f => ({
              ...f,
              error: `Percobaan ulang #${attempt + 1} untuk chunk ${chunkIndex + 1}/${totalChunks}...`
            }))
            // Exponential backoff: 1s, 2s
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
          } catch (fetchErr) {
            // Network error (fetch threw)
            if (abortController.signal.aborted) {
              throw new Error('Upload dibatalkan')
            }
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

      // ===== STEP 3: Final fallback — share via upload-complete if needed =====
      if (uploadedFile?.id && !uploadedFile?.webViewLink) {
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
          }
        } catch (e) {
          console.error('[UPLOAD] Share fallback failed:', e)
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
    }
  }, [folderLink, projectId, onUploadComplete, updateFile, projectTitle, executionTime, uploaderName])

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files) return
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
