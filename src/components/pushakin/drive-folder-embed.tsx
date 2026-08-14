'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
} from 'lucide-react'

interface DriveFolderEmbedProps {
  folderLink: string // Google Drive folder URL (e.g. https://drive.google.com/drive/folders/XXX)
  folderLabel?: string // Display name for the folder (e.g. "1. PRODUKSI")
  onFilesDetected?: (info: {
    fileCount: number
    folderLink: string
    files: Array<{ id: string; name: string; mimeType: string; size?: string; modifiedTime?: string }>
  }) => void
  className?: string
}

interface DriveFile {
  id: string
  name: string
  mimeType: string
  size?: string
  modifiedTime?: string
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

export function DriveFolderEmbed({
  folderLink,
  folderLabel,
  onFilesDetected,
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
          // Mock mode — show zero but don't error
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

  // Initial check + auto-poll every 20 seconds
  useEffect(() => {
    mountedRef.current = true
    if (!folderId) {
      setFileCount(0)
      setFiles([])
      return
    }

    // Initial check
    checkFiles()

    // Polling loop — every 20 seconds, silent (no spinner)
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

  // Build the embed URL — Google Drive's embeddedfolderview shows a read-only
  // file list that updates live as the user uploads files in another tab.
  // Two view modes available: #list (table) or #grid (thumbnails). We use #list
  // because it shows file sizes + modified time, which is more useful for
  // verifying that uploads completed.
  const embedUrl = `https://drive.google.com/embeddedfolderview?folderId=${folderId}#list`

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
          <a href={folderLink} target="_blank" rel="noreferrer">
            <Button
              type="button"
              size="sm"
              className="h-7 px-3 text-xs bg-green-600 hover:bg-green-700 text-white gap-1.5"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Buka di Drive
            </Button>
          </a>
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
              Klik <strong>&quot;Buka di Drive&quot;</strong> di kanan atas, lalu upload
              semua file Anda langsung di Google Drive. Lebih cepat, minim error, dan
              mendukung file besar. File yang sudah terupload akan otomatis terdeteksi
              di bawah ini — Anda tidak perlu kembali ke halaman ini untuk mencentang
              penyelesaian.
            </p>
            <div className="mt-2 flex items-center gap-2 text-[10px] text-green-700">
              {lastChecked ? (
                <>
                  <span className="inline-block w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                  <span>
                    Diperbarui otomatis setiap 20 detik · Terakhir: {lastChecked.toLocaleTimeString('id-ID')}
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
                +{files.length - 5} file lainnya — lihat semua di Google Drive
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
    </div>
  )
}
