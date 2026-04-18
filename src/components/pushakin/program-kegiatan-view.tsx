'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useAppStore, type ProgramKegiatan } from '@/lib/store'
import {
  Plus,
  Edit,
  Trash2,
  Eye,
  Clock,
  FileText,
  Loader2,
  AlertCircle,
  ExternalLink,
  UploadCloud,
  X,
  Inbox,
  Search,
  ClipboardList,
  BarChart3,
  CheckCircle2,
  CloudUpload,
  Save,
  LayoutList,
  LayoutGrid,
  Maximize2,
  Minimize2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ProgramKegiatanRekapitulasi } from './program-kegiatan-rekapitulasi'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const initialFormData = {
  tanggalKegiatan: '',
  perihal: '',
  deskripsi: '',
  documents: [] as any[],
}

export function ProgramKegiatanView() {
  const {
    currentUser, users, kegiatanList, setKegiatanList, addKegiatan, updateKegiatan, deleteKegiatan,
    showAlert, showConfirm
  } = useAppStore()

  const [isLoading, setIsLoading] = useState(true)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [isDetailOpen, setIsDetailOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [selectedKegiatan, setSelectedKegiatan] = useState<ProgramKegiatan | null>(null)
  const [activeTab, setActiveTab] = useState('semua')
  const [searchTerm, setSearchTerm] = useState('')
  const [viewMode, setViewMode] = useState<'list' | 'table'>('list')
  const [formData, setFormData] = useState(initialFormData)
  const [isFormMaximized, setIsFormMaximized] = useState(false)
  const [isDetailMaximized, setIsDetailMaximized] = useState(false)

  const isManager = currentUser?.role === 'Manager'
  const isAdmin = currentUser?.role === 'Admin'

  // Fetch kegiatan
  const fetchKegiatan = useCallback(async () => {
    if (!currentUser) return
    try {
      const params = new URLSearchParams({
        userId: currentUser.id,
        userRole: currentUser.role,
      })
      const response = await fetch(`/api/program-kegiatan?${params}`)
      if (response.ok) {
        const data = await response.json()
        setKegiatanList(data)
      }
    } catch (error) {
      console.error('Failed to fetch kegiatan:', error)
    } finally {
      setIsLoading(false)
    }
  }, [currentUser, setKegiatanList])

  useEffect(() => {
    // Auto-migrate: ensure program_kegiatan table exists before fetching
    const init = async () => {
      setIsLoading(true)
      try {
        await fetch('/api/program-kegiatan/migrate', { method: 'POST' })
      } catch {
        // Ignore migration errors, will be caught during fetch
      }
      await fetchKegiatan()
    }
    init()
  }, [fetchKegiatan])

  // Filter kegiatan based on tab, search, and filters
  const getFilteredKegiatan = useCallback(() => {
    let list = kegiatanList

    // Apply search
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      list = list.filter(s =>
        s.perihal.toLowerCase().includes(term)
      )
    }

    return list
  }, [kegiatanList, searchTerm])

  const filteredKegiatan = getFilteredKegiatan()

  // Form handling
  const [uploadingDocs, setUploadingDocs] = useState<{id: string; name: string; progress: number; status: 'uploading' | 'success' | 'error'; error?: string; webViewLink?: string}[]>([])

  // Save progress overlay
  const [saveProgress, setSaveProgress] = useState<{
    active: boolean
    steps: { key: string; label: string; icon: React.ReactNode; status: 'pending' | 'loading' | 'success' | 'error'; detail?: string }[]
    folderLink?: string
    docLinks?: string[]
  } | null>(null)

  const addDocumentRow = () => {
    setFormData(prev => ({
      ...prev,
      documents: [...prev.documents, {
        id: `row-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        berkasName: '',
        file: null as File | null,
        originalName: '',
      } as any]
    }))
  }

  const handleFileUploadForRow = (docId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFormData(prev => ({
      ...prev,
      documents: prev.documents.map(d =>
        d.id === docId
          ? { ...d, file, originalName: file.name, mimeType: file.type, size: file.size }
          : d
      )
    }))
    e.target.value = ''
  }

  const updateBerkasName = (docId: string, name: string) => {
    setFormData(prev => ({
      ...prev,
      documents: prev.documents.map(d =>
        d.id === docId ? { ...d, berkasName: name } : d
      )
    }))
  }

  const removeDocument = (docId: string) => {
    setFormData(prev => ({ ...prev, documents: prev.documents.filter(d => d.id !== docId) }))
    setUploadingDocs(prev => prev.filter(d => d.id !== docId))
  }

  // Helper: update a single step in saveProgress
  const updateStep = (key: string, status: 'pending' | 'loading' | 'success' | 'error', detail?: string) => {
    setSaveProgress(prev => {
      if (!prev) return prev
      return {
        ...prev,
        steps: prev.steps.map(s => s.key === key ? { ...s, status, detail: detail || s.detail } : s),
      }
    })
  }

  // Upload pending documents to Google Drive after kegiatan is created/edited
  const uploadDocumentsToDrive = async (kegiatanId: string, docs: any[]) => {
    const pendingDocs = docs.filter((d: any) => d.file && !d.webViewLink)
    if (pendingDocs.length === 0) return { finalDocs: docs, docLinks: [] as string[] }

    const uploadedDocs: any[] = []
    const docLinks: string[] = []
    for (const doc of pendingDocs) {
      const file = doc.file as File
      try {
        setUploadingDocs(prev => prev.map(d => d.id === doc.id ? { ...d, progress: 50 } : d))
        // Build auto-rename: use berkasName from manager, fallback to original name
        const safeBerkasName = (doc.berkasName || doc.originalName || 'Dokumen').trim().replace(/[/\\?%*:|"<>]/g, '-')
        const ext = doc.originalName?.split('.').pop() || ''
        const renamed = safeBerkasName + (ext ? '.' + ext : '')
        updateStep('upload-docs', 'loading', `Mengupload "${renamed}"...`)
        const uploadForm = new FormData()
        uploadForm.append('file', file)
        uploadForm.append('kegiatanId', kegiatanId)
        uploadForm.append('fileName', renamed)
        const res = await fetch('/api/program-kegiatan/upload-document', { method: 'POST', body: uploadForm })
        if (res.ok) {
          const result = await res.json()
          if (result.document) {
            uploadedDocs.push(result.document)
            if (result.document.webViewLink) docLinks.push(result.document.webViewLink)
            setUploadingDocs(prev => prev.map(d => d.id === doc.id ? { ...d, progress: 100, status: 'success', webViewLink: result.document.webViewLink } : d))
          }
        } else {
          let errorMsg = 'Upload gagal'
          try {
            const err = await res.json()
            errorMsg = err.error || errorMsg
          } catch { /* ignore parse error */ }
          console.error(`[KEGIATAN UPLOAD] Failed "${renamed}":`, errorMsg)
          setUploadingDocs(prev => prev.map(d => d.id === doc.id ? { ...d, status: 'error', error: errorMsg } : d))
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload gagal'
        console.error(`[KEGIATAN UPLOAD] Error:`, msg)
        setUploadingDocs(prev => prev.map(d => d.id === doc.id ? { ...d, status: 'error', error: msg } : d))
      }
    }
    return { finalDocs: [...docs.filter((d: any) => !d.file || !!d.webViewLink), ...uploadedDocs], docLinks }
  }

  const openCreateForm = () => {
    setFormData({ ...initialFormData })
    setEditingId(null)
    setIsFormOpen(true)
  }

  const openEditForm = (s: ProgramKegiatan) => {
    setFormData({
      tanggalKegiatan: s.tanggalKegiatan ? new Date(s.tanggalKegiatan).toISOString().slice(0, 16) : '',
      perihal: s.perihal,
      deskripsi: s.deskripsi || '',
      documents: (s.documents || []).map((d: any) => ({
        ...d,
        berkasName: d.name || '',
        file: null,
        originalName: d.originalName || '',
      })),
    })
    setEditingId(s.id)
    setIsFormOpen(true)
  }

  const closeForm = () => {
    setIsFormOpen(false)
    setEditingId(null)
    setFormData(initialFormData)
    setUploadingDocs([])
    setSaveProgress(null)
    setIsFormMaximized(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.perihal.trim()) {
      showAlert('Perihal kegiatan wajib diisi')
      return
    }

    // Check if there are pending uploads (new files not yet uploaded)
    const hasPending = formData.documents.some((d: any) => d.file && !d.webViewLink)

    // Initialize progress steps
    type StepStatus = 'pending' | 'loading' | 'success' | 'error'
    const steps: { key: string; label: string; icon: React.ReactNode; status: StepStatus; detail?: string }[] = [
      { key: 'save-kegiatan', label: 'Menyimpan data kegiatan...', icon: <Save className="w-4 h-4" />, status: 'pending' },
      { key: 'upload-docs', label: hasPending ? `Mengupload ${formData.documents.filter((d: any) => d.file && !d.webViewLink).length} dokumen ke Google Drive...` : 'Tidak ada dokumen untuk diupload', icon: <CloudUpload className="w-4 h-4" />, status: 'pending' },
      { key: 'done', label: 'Selesai!', icon: <CheckCircle2 className="w-4 h-4" />, status: 'pending' },
    ]

    // If no pending docs, mark upload as skipped
    if (!hasPending) {
      steps[1].status = 'success'
      steps[1].detail = 'Dilewati (tidak ada dokumen)'
    }

    setSaveProgress({ active: true, steps })
    setIsSaving(true)

    try {
      // --- STEP 1: Save kegiatan data ---
      updateStep('save-kegiatan', 'loading')

      // Clean documents for API — only include already-uploaded docs, exclude pending file objects
      const cleanDocs = formData.documents
        .filter((d: any) => !d.file || !!d.webViewLink)
        .map((d: any) => {
          const { file, berkasName, ...rest } = d
          return { ...rest, webViewLink: d.webViewLink || null }
        })

      const payload: any = {
        tanggalKegiatan: formData.tanggalKegiatan || null,
        perihal: formData.perihal,
        deskripsi: formData.deskripsi || null,
        documents: cleanDocs,
        managerId: currentUser?.id,
      }

      let kegiatanData: any = null

      if (editingId) {
        const response = await fetch('/api/program-kegiatan', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editingId, ...payload })
        })
        if (!response.ok) {
          const err = await response.json()
          updateStep('save-kegiatan', 'error', err.error || 'Gagal memperbarui kegiatan')
          setIsSaving(false)
          return
        }
        kegiatanData = await response.json()
        updateKegiatan(kegiatanData)
        updateStep('save-kegiatan', 'success', `Kegiatan ${kegiatanData.nomorKegiatan} berhasil diperbarui`)
      } else {
        const response = await fetch('/api/program-kegiatan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
        if (!response.ok) {
          const err = await response.json()
          updateStep('save-kegiatan', 'error', err.details || err.error || 'Gagal membuat kegiatan')
          setIsSaving(false)
          return
        }
        kegiatanData = await response.json()
        addKegiatan(kegiatanData)
        updateStep('save-kegiatan', 'success', `Kegiatan ${kegiatanData.nomorKegiatan} berhasil dibuat`)
      }

      // --- STEP 2: Upload documents (folder created automatically if needed) ---
      if (hasPending) {
        const kegiatanId = editingId || kegiatanData.id
        const { finalDocs, docLinks } = await uploadDocumentsToDrive(kegiatanId, formData.documents)
        // Update form documents to reflect upload results
        setFormData(prev => ({ ...prev, documents: finalDocs }))
        const successCount = docLinks.length
        const failCount = formData.documents.filter((d: any) => d.file && !d.webViewLink).length - successCount
        if (successCount > 0) {
          updateStep('upload-docs', 'success', `${successCount} dokumen berhasil diupload ke Google Drive`)
          setSaveProgress(prev => prev ? { ...prev, docLinks } : null)
        }
        if (failCount > 0) {
          updateStep('upload-docs', successCount > 0 ? 'success' : 'error',
            successCount > 0
              ? `${successCount} berhasil, ${failCount} gagal diupload`
              : `${failCount} dokumen gagal diupload`
          )
        }
      } else {
        // No docs to upload, mark upload step as success
        updateStep('upload-docs', 'success')
      }

      // --- STEP 3: Done ---
      updateStep('done', 'success')
      setIsSaving(false)

    } catch (error) {
      // Find the current loading step and mark it as error
      setSaveProgress(prev => {
        if (!prev) return prev
        const loadingStep = prev.steps.find(s => s.status === 'loading')
        if (loadingStep) {
          return {
            ...prev,
            steps: prev.steps.map(s => s.key === loadingStep.key ? { ...s, status: 'error' as const, detail: 'Terjadi kesalahan koneksi' } : s),
          }
        }
        return prev
      })
      setIsSaving(false)
    }
  }

  const handleDelete = (id: string) => {
    showConfirm('Yakin ingin menghapus kegiatan ini?', async () => {
      try {
        const response = await fetch(`/api/program-kegiatan?id=${id}`, { method: 'DELETE' })
        if (response.ok) {
          deleteKegiatan(id)
          showAlert('Kegiatan berhasil dihapus!')
        } else {
          const err = await response.json()
          showAlert(err.error || 'Gagal menghapus kegiatan')
        }
      } catch {
        showAlert('Terjadi kesalahan')
      }
    })
  }

  const formatDateTime = (dateString: string) => {
    if (!dateString) return '-'
    const d = new Date(dateString)
    return d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
  }

  const formatDate = (dateString: string) => {
    if (!dateString) return '-'
    const d = new Date(dateString)
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
  }



  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-50">
            <ClipboardList className="w-6 h-6 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-stone-800">Manajemen Kegiatan</h1>
            <p className="text-stone-500 text-sm">
              Kelola program kegiatan
            </p>
          </div>
        </div>
        {(isManager || isAdmin) && (
          <Button onClick={openCreateForm} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
            <Plus className="w-4 h-4" />
            <span>Tambah Kegiatan</span>
          </Button>
        )}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <TabsList className="bg-stone-100 p-1">
            <TabsTrigger value="semua" className="gap-2 data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
              <ClipboardList className="w-4 h-4" />
              Semua Kegiatan
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 data-[state=active]:bg-white/20">
                {kegiatanList.length}
              </Badge>
            </TabsTrigger>
            {(isManager || isAdmin) && (
              <TabsTrigger value="rekapitulasi" className="gap-2 data-[state=active]:bg-amber-600 data-[state=active]:text-white">
                <BarChart3 className="w-4 h-4" />
                <span className="hidden sm:inline">Rekapitulasi</span>
              </TabsTrigger>
            )}
          </TabsList>
        </div>

        <div className="mt-4">
          {/* Search and Filter Bar */}
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-col md:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                  <Input
                    placeholder="Cari kegiatan..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>

                {/* View Toggle */}
                <div className="flex items-center bg-stone-100 rounded-lg p-0.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setViewMode('list')}
                    className={cn(
                      "h-8 w-8 p-0 rounded-md",
                      viewMode === 'list' ? "bg-white shadow-sm text-emerald-600" : "text-stone-400 hover:text-stone-600"
                    )}
                    title="Tampilan List"
                  >
                    <LayoutList className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setViewMode('table')}
                    className={cn(
                      "h-8 w-8 p-0 rounded-md",
                      viewMode === 'table' ? "bg-white shadow-sm text-emerald-600" : "text-stone-400 hover:text-stone-600"
                    )}
                    title="Tampilan Tabel"
                  >
                    <LayoutGrid className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Kegiatan List */}
          {filteredKegiatan.length === 0 ? (
            <Card className="mt-4 border-dashed">
              <CardContent className="p-12 text-center">
                <div className="w-16 h-16 rounded-full bg-stone-100 mx-auto mb-4 flex items-center justify-center">
                  <Inbox className="w-8 h-8 text-stone-400" />
                </div>
                <h3 className="text-lg font-semibold text-stone-800">Tidak ada kegiatan</h3>
                <p className="text-stone-500 mt-1">
                  {(isManager || isAdmin)
                    ? 'Klik tombol di atas untuk menambah kegiatan baru.'
                    : 'Belum ada kegiatan yang ditampilkan.'}
                </p>
              </CardContent>
            </Card>
          ) : viewMode === 'table' ? (
            /* ===== TABLE VIEW ===== */
            <Card className="mt-4 overflow-hidden">
              <ScrollArea className="h-[calc(100vh-340px)]">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-stone-50 hover:bg-stone-50">
                      <TableHead className="w-[60px] text-center text-xs font-semibold">No</TableHead>
                      <TableHead className="min-w-[200px] text-xs font-semibold">Nama Kegiatan</TableHead>
                      <TableHead className="min-w-[100px] text-xs font-semibold">Tanggal</TableHead>
                      {(isManager || isAdmin) && <TableHead className="min-w-[180px] text-center text-xs font-semibold">Aksi</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredKegiatan.map((s, idx) => {
                      return (
                        <TableRow key={s.id} className="group">
                          <TableCell className="text-center text-xs text-stone-400 font-mono">{idx + 1}</TableCell>
                          <TableCell>
                            <button onClick={() => { setSelectedKegiatan(s); setIsDetailOpen(true) }} className="text-left">
                              <p className="text-sm font-semibold text-stone-800 hover:text-emerald-600 transition-colors line-clamp-1">{s.perihal}</p>
                              {s.deskripsi && <p className="text-[11px] text-stone-400 line-clamp-1 mt-0.5">{s.deskripsi}</p>}
                            </button>
                            {s.documents && Array.isArray(s.documents) && s.documents.filter((d: any) => d.webViewLink).length > 0 && (
                              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 mt-0.5">
                                <FileText className="w-3 h-3" />{s.documents.filter((d: any) => d.webViewLink).length} berkas
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-stone-500 whitespace-nowrap">{s.tanggalKegiatan ? formatDate(s.tanggalKegiatan) : '-'}</TableCell>
                          {(isManager || isAdmin) && (
                            <TableCell>
                              <div className="flex items-center justify-center gap-1">
                                <Button variant="ghost" size="sm" onClick={() => { setSelectedKegiatan(s); setIsDetailOpen(true) }} className="h-7 px-2 text-stone-500 hover:text-stone-700" title="Detail">
                                  <Eye className="w-3.5 h-3.5" />
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => openEditForm(s)} className="h-7 px-2 text-stone-500 hover:text-stone-700" title="Edit">
                                  <Edit className="w-3.5 h-3.5" />
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => handleDelete(s.id)} className="h-7 px-2 text-red-500 hover:text-red-600 hover:bg-red-50" title="Hapus">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </ScrollArea>
            </Card>
          ) : (
            /* ===== LIST VIEW ===== */
            <ScrollArea className="h-[calc(100vh-340px)] mt-4">
              <div className="space-y-3 pr-4">
                {filteredKegiatan.map(s => (
                    <Card key={s.id} className="transition-all hover:shadow-md border-l-4 border-emerald-400">
                      <CardContent className="p-5">
                        <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                          {/* Main Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <h3 className="text-lg font-bold text-stone-800">{s.perihal}</h3>
                                <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs text-stone-500">
                                  {s.tanggalKegiatan && (
                                    <span className="flex items-center gap-1">
                                      <Clock className="w-3 h-3" />
                                      {formatDate(s.tanggalKegiatan)}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>

                            {s.deskripsi && (
                              <p className="text-sm text-stone-600 mt-2 line-clamp-2">{s.deskripsi}</p>
                            )}

                            {/* Document count badge */}
                            {s.documents && Array.isArray(s.documents) && s.documents.filter((d: any) => d.webViewLink).length > 0 && (
                              <div className="flex items-center gap-2 mt-2 text-xs text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-lg w-fit">
                                <FileText className="w-3 h-3" />
                                <span>{s.documents.filter((d: any) => d.webViewLink).length} berkas terlampir</span>
                              </div>
                            )}

                            {/* Timestamp */}
                            <div className="flex items-center gap-2 mt-2 text-[10px] text-stone-400">
                              <Clock className="w-3 h-3" />
                              {formatDateTime(s.createdAt)}
                            </div>
                          </div>

                          {/* Actions */}
                          <div className="flex lg:flex-col gap-1.5 shrink-0">
                            <Button variant="ghost" size="sm" onClick={() => { setSelectedKegiatan(s); setIsDetailOpen(true) }} className="text-stone-500 hover:text-stone-700 gap-1 text-xs">
                              <Eye className="w-3.5 h-3.5" />
                              Detail
                            </Button>
                            {(isManager || isAdmin) && (
                              <>
                                <Button variant="ghost" size="sm" onClick={() => openEditForm(s)} className="text-stone-500 hover:text-stone-700 gap-1 text-xs">
                                  <Edit className="w-3.5 h-3.5" />
                                  Edit
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => handleDelete(s.id)} className="text-red-500 hover:text-red-600 hover:bg-red-50 gap-1 text-xs">
                                  <Trash2 className="w-3.5 h-3.5" />
                                  Hapus
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
              </div>
            </ScrollArea>
          )}
        </div>

        {(isManager || isAdmin) && (
          <TabsContent value="rekapitulasi" className="mt-4">
            <ProgramKegiatanRekapitulasi kegiatanList={kegiatanList} users={users} />
          </TabsContent>
        )}
      </Tabs>

      {/* Create/Edit Form Dialog */}
      <Dialog open={isFormOpen} onOpenChange={(open) => { if (!open) closeForm() }}>
        <DialogContent
          showCloseButton={!isFormMaximized}
          className={cn(
            "transition-all duration-300",
            isFormMaximized
              ? "!fixed !inset-0 !z-[100] !translate-x-0 !translate-y-0 !w-full !h-full !max-w-full !rounded-none !border-0 sm:!rounded-none"
              : "max-w-3xl max-h-[90vh] flex flex-col overflow-hidden"
          )}
        >
          {/* Sticky Header */}
          <div className={cn(
            "flex items-center gap-3 sticky top-0 z-10 bg-background/95 backdrop-blur-sm pb-3",
            !isFormMaximized && "border-b mb-1"
          )}>
            <div className="flex-1 min-w-0">
              <DialogTitle className="truncate">{editingId ? 'Edit Kegiatan' : 'Buat Kegiatan Baru'}</DialogTitle>
              <DialogDescription className="text-xs">
                Isi form di bawah untuk {editingId ? 'memperbarui' : 'membuat'} kegiatan
              </DialogDescription>
            </div>
            <button
              type="button"
              onClick={() => setIsFormMaximized(!isFormMaximized)}
              className="shrink-0 p-1.5 rounded-md border bg-white hover:bg-stone-100 transition-colors"
              title={isFormMaximized ? 'Kecilkan' : 'Maksimalkan'}
            >
              {isFormMaximized ? <Minimize2 className="w-4 h-4 text-stone-500" /> : <Maximize2 className="w-4 h-4 text-stone-500" />}
            </button>
          </div>

          <form onSubmit={handleSubmit} className={cn(
            "flex flex-col flex-1 min-h-0",
            isFormMaximized ? "h-[calc(100vh-8rem)]" : ""
          )}>
            <div className={cn(
              "space-y-5 py-4 overflow-y-auto flex-1 min-h-0 overscroll-contain"
            )}>
            {/* Nama Kegiatan */}
            <div className="space-y-2">
              <Label htmlFor="perihal" className="font-semibold">Nama Kegiatan *</Label>
              <Input id="perihal" required value={formData.perihal} onChange={e => setFormData(prev => ({ ...prev, perihal: e.target.value }))} placeholder="Nama kegiatan..." />
            </div>

            {/* Tanggal Kegiatan */}
            <div className="space-y-2">
              <Label htmlFor="tanggalKegiatan">Tanggal Kegiatan</Label>
              <Input id="tanggalKegiatan" type="date" value={formData.tanggalKegiatan} onChange={e => setFormData(prev => ({ ...prev, tanggalKegiatan: e.target.value }))} />
            </div>

            {/* Deskripsi Kegiatan */}
            <div className="space-y-2">
              <Label htmlFor="deskripsi">Deskripsi Kegiatan</Label>
              <Textarea
                id="deskripsi"
                rows={4}
                value={formData.deskripsi}
                onChange={e => setFormData(prev => ({ ...prev, deskripsi: e.target.value }))}
                placeholder="Deskripsi atau informasi tambahan tentang kegiatan..."
              />
            </div>

            {/* Upload Dokumen - Dynamic Rows */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="font-semibold">Upload Dokumen ke Google Drive</Label>
                <Button type="button" variant="outline" size="sm" onClick={addDocumentRow} disabled={isSaving} className="text-emerald-600 border-emerald-200 hover:bg-emerald-50">
                  <UploadCloud className="w-3.5 h-3.5 mr-1.5" />
                  Tambah Berkas
                </Button>
              </div>

              {formData.documents.length > 0 ? (
                <div className="space-y-2.5">
                  {formData.documents.map((doc: any, idx: number) => {
                    const uploadStatus = uploadingDocs.find(u => u.id === doc.id)
                    const hasFile = !!doc.file
                    const isUploaded = !!doc.webViewLink
                    const isUploading = uploadStatus?.status === 'uploading' || (hasFile && !isUploaded && !!saveProgress)
                    const isFailed = uploadStatus?.status === 'error'
                    const isExistingDoc = isUploaded && !hasFile

                    return (
                      <div key={doc.id} className={cn(
                        "p-3 rounded-xl border transition-all",
                        isExistingDoc ? "bg-emerald-50/60 border-emerald-200" : isFailed ? "bg-red-50 border-red-200" : isUploading ? "bg-emerald-50/40 border-emerald-200" : hasFile ? "bg-amber-50/40 border-amber-200" : "bg-stone-50 border-stone-200"
                      )}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-bold text-stone-400 bg-stone-100 px-2 py-0.5 rounded">{idx + 1}</span>
                          {isExistingDoc ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                          ) : isFailed ? (
                            <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                          ) : isUploading ? (
                            <Loader2 className="w-4 h-4 text-emerald-500 shrink-0 animate-spin" />
                          ) : hasFile ? (
                            <FileText className="w-4 h-4 text-amber-500 shrink-0" />
                          ) : (
                            <FileText className="w-4 h-4 text-stone-400 shrink-0" />
                          )}
                          {isExistingDoc && doc.webViewLink && (
                            <a href={doc.downloadUrl || doc.webViewLink} target="_blank" rel="noopener noreferrer" className="text-[11px] text-emerald-600 hover:text-emerald-700 hover:underline truncate flex-1">
                              {doc.name}
                            </a>
                          )}
                          <button type="button" onClick={() => removeDocument(doc.id)} disabled={isUploading} className="ml-auto text-stone-400 hover:text-red-500 disabled:opacity-40">
                            <X className="w-4 h-4" />
                          </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <Input
                              value={doc.berkasName || ''}
                              onChange={e => updateBerkasName(doc.id, e.target.value)}
                              placeholder="Nama penamaan berkas..."
                              disabled={isExistingDoc || isSaving}
                              className={cn("text-sm", !doc.berkasName && hasFile && "border-amber-300 focus:border-amber-400")}
                            />
                            {!isExistingDoc && (
                              <p className="text-[10px] text-stone-400 pl-1">
                                {doc.berkasName
                                  ? `Akan disimpan sebagai: ${doc.berkasName}${doc.originalName ? '.' + (doc.originalName.split('.').pop()) : ''}`
                                  : 'Isi nama berkas untuk auto-rename saat upload'}
                              </p>
                            )}
                          </div>
                          <div>
                            {!isExistingDoc ? (
                              <label className={cn(
                                "flex items-center justify-center gap-2 px-3 py-2 rounded-lg border-2 border-dashed cursor-pointer text-sm transition-colors",
                                hasFile ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-stone-300 hover:border-emerald-300 text-stone-500",
                                isSaving && "opacity-50 pointer-events-none"
                              )}>
                                <input
                                  type="file"
                                  className="hidden"
                                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                                  onChange={e => handleFileUploadForRow(doc.id, e)}
                                  disabled={isSaving}
                                />
                                {hasFile ? (
                                  <>
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    <span className="truncate">{doc.originalName}</span>
                                  </>
                                ) : (
                                  <>
                                    <UploadCloud className="w-3.5 h-3.5" />
                                    <span>Pilih File</span>
                                  </>
                                )}
                              </label>
                            ) : (
                              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 text-sm text-emerald-700">
                                <FileText className="w-3.5 h-3.5" />
                                <span className="truncate">{doc.originalName || doc.name}</span>
                              </div>
                            )}
                          </div>
                        </div>

                        {isFailed && uploadStatus.error && (
                          <p className="text-[10px] text-red-600 mt-1.5 px-1">Gagal: {uploadStatus.error}</p>
                        )}
                        {isUploading && (
                          <p className="text-[10px] text-emerald-600 mt-1.5 px-1 animate-pulse">Sedang mengupload ke Google Drive...</p>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="border-2 border-dashed rounded-xl p-6 text-center">
                  <UploadCloud className="w-8 h-8 text-stone-300 mx-auto mb-2" />
                  <p className="text-sm text-stone-400">Belum ada berkas. Klik <strong>Tambah Berkas</strong> untuk memulai.</p>
                  <p className="text-xs text-stone-300 mt-1">PDF, Word, Gambar (maks. 10MB)</p>
                </div>
              )}
            </div>

            {/* Save Progress Overlay */}
            {saveProgress && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full mx-4 animate-in fade-in zoom-in-95 duration-300">
                  <div className="text-center mb-5">
                    <div className="w-14 h-14 rounded-full bg-emerald-100 mx-auto mb-3 flex items-center justify-center">
                      {saveProgress.steps.every(s => s.status === 'success' || s.status === 'pending' && s.detail?.includes('Dilewati'))
                        ? <CheckCircle2 className="w-8 h-8 text-emerald-600" />
                        : <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
                      }
                    </div>
                    <h3 className="text-lg font-bold text-stone-800">
                      {saveProgress.steps[saveProgress.steps.length - 1]?.status === 'success'
                        ? 'Kegiatan Berhasil Disimpan!'
                        : 'Memproses Kegiatan...'
                      }
                    </h3>
                    <p className="text-sm text-stone-500 mt-1">
                      {saveProgress.steps[saveProgress.steps.length - 1]?.status === 'success'
                        ? 'Semua proses telah selesai'
                        : 'Mohon tunggu, jangan tutup halaman ini'
                      }
                    </p>
                  </div>

                  <div className="space-y-3">
                    {saveProgress.steps.map((step) => (
                      <div
                        key={step.key}
                        className={cn(
                          'flex items-start gap-3 px-4 py-3 rounded-xl border transition-all duration-500',
                          step.status === 'loading' && 'bg-emerald-50 border-emerald-200',
                          step.status === 'success' && 'bg-emerald-50/60 border-emerald-200',
                          step.status === 'error' && 'bg-red-50 border-red-200',
                          step.status === 'pending' && 'bg-stone-50 border-stone-100 opacity-40',
                        )}
                      >
                        <div className="mt-0.5 shrink-0">
                          {step.status === 'pending' && (
                            <div className="w-5 h-5 rounded-full border-2 border-stone-300" />
                          )}
                          {step.status === 'loading' && (
                            <div className="w-5 h-5 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
                          )}
                          {step.status === 'success' && (
                            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                          )}
                          {step.status === 'error' && (
                            <AlertCircle className="w-5 h-5 text-red-500" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={cn(
                              'text-sm font-semibold',
                              step.status === 'loading' && 'text-emerald-700',
                              step.status === 'success' && 'text-emerald-700',
                              step.status === 'error' && 'text-red-700',
                              step.status === 'pending' && 'text-stone-400',
                            )}>
                              {step.label}
                            </span>
                          </div>
                          {step.detail && (
                            <p className={cn(
                              'text-xs mt-0.5',
                              step.status === 'success' && 'text-emerald-600',
                              step.status === 'error' && 'text-red-600',
                              step.status === 'loading' && 'text-emerald-600 animate-pulse',
                              step.status === 'pending' && 'text-stone-400',
                            )}>
                              {step.detail}
                            </p>
                          )}
                          {/* Show document download links */}
                          {step.key === 'upload-docs' && step.status === 'success' && saveProgress.docLinks && saveProgress.docLinks.length > 0 && (
                            <div className="mt-1 space-y-0.5">
                              {saveProgress.docLinks.map((link, i) => (
                                <a
                                  key={i}
                                  href={link}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-700 hover:underline font-medium"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                  Download Berkas {i + 1}
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Close button only when fully done or error */}
                  {(saveProgress.steps[saveProgress.steps.length - 1]?.status === 'success' || saveProgress.steps.some(s => s.status === 'error')) && (
                    <div className="mt-5 pt-4 border-t border-stone-100">
                      <Button
                        className="w-full bg-emerald-600 hover:bg-emerald-700"
                        onClick={() => {
                          setSaveProgress(null)
                          setIsSaving(false)
                          closeForm()
                          fetchKegiatan()
                        }}
                      >
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                        Tutup
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}

            </div>
            <DialogFooter className={cn(
              "pt-4 border-t shrink-0"
            )}>
              <Button type="button" variant="ghost" onClick={closeForm} disabled={!!saveProgress}>Batal</Button>
              <Button type="submit" disabled={isSaving} className="bg-emerald-600 hover:bg-emerald-700">
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Memproses...
                  </>
                ) : (
                  editingId ? 'Perbarui' : 'Buat Kegiatan'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={isDetailOpen} onOpenChange={(open) => { setIsDetailOpen(open); if (!open) setIsDetailMaximized(false) }}>
        <DialogContent
          showCloseButton={!isDetailMaximized}
          className={cn(
            "transition-all duration-300",
            isDetailMaximized
              ? "!fixed !inset-0 !z-[100] !translate-x-0 !translate-y-0 !w-full !h-full !max-w-full !rounded-none !border-0 sm:!rounded-none"
              : "max-w-2xl max-h-[90vh] overflow-y-auto"
          )}
        >
          {/* Sticky Header */}
          <div className={cn(
            "flex items-center gap-3 sticky top-0 z-10 bg-background/95 backdrop-blur-sm pb-3",
            !isDetailMaximized && "border-b mb-1"
          )}>
            <div className="flex-1 min-w-0">
              <DialogTitle className="truncate">Detail Kegiatan</DialogTitle>
            </div>
            {(isManager || isAdmin) && selectedKegiatan && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const keg = selectedKegiatan
                    setIsDetailOpen(false)
                    openEditForm(keg)
                  }}
                  className="gap-1.5 text-xs h-8"
                >
                  <Edit className="w-3.5 h-3.5" />
                  Edit Kegiatan
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    showConfirm('Yakin ingin menghapus kegiatan ini?', async () => {
                      try {
                        const response = await fetch(`/api/program-kegiatan?id=${selectedKegiatan.id}`, { method: 'DELETE' })
                        if (response.ok) {
                          deleteKegiatan(selectedKegiatan.id)
                          setIsDetailOpen(false)
                          showAlert('Kegiatan berhasil dihapus!')
                        } else {
                          const err = await response.json()
                          showAlert(err.error || 'Gagal menghapus kegiatan')
                        }
                      } catch {
                        showAlert('Terjadi kesalahan')
                      }
                    })
                  }}
                  className="gap-1.5 text-xs h-8 text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Hapus
                </Button>
              </div>
            )}
            <button
              type="button"
              onClick={() => setIsDetailMaximized(!isDetailMaximized)}
              className="shrink-0 p-1.5 rounded-md border bg-white hover:bg-stone-100 transition-colors"
              title={isDetailMaximized ? 'Kecilkan' : 'Maksimalkan'}
            >
              {isDetailMaximized ? <Minimize2 className="w-4 h-4 text-stone-500" /> : <Maximize2 className="w-4 h-4 text-stone-500" />}
            </button>
          </div>

          {selectedKegiatan && (
            <div className={cn(
              "space-y-4 py-2 overflow-y-auto",
              isDetailMaximized ? "h-[calc(100vh-6rem)] overscroll-contain" : ""
            )}>
              <h3 className="text-xl font-bold text-stone-800">{selectedKegiatan.perihal}</h3>

              {selectedKegiatan.tanggalKegiatan && (
                <div className="flex items-center gap-2 text-sm text-stone-600">
                  <Clock className="w-4 h-4 text-stone-400 shrink-0" />
                  <span className="text-stone-500">Tanggal:</span>
                  <strong>{formatDate(selectedKegiatan.tanggalKegiatan)}</strong>
                </div>
              )}

              {selectedKegiatan.deskripsi && (
                <div>
                  <span className="text-xs font-bold text-stone-400 uppercase tracking-wider">Deskripsi Kegiatan</span>
                  <p className="text-sm text-stone-700 bg-stone-50 p-3 rounded-lg mt-1.5 whitespace-pre-line">{selectedKegiatan.deskripsi}</p>
                </div>
              )}
              {selectedKegiatan.documents && selectedKegiatan.documents.length > 0 && (() => {
                // Only show documents that were actually uploaded to Google Drive
                const uploadedDocs = selectedKegiatan.documents.filter((doc: any) => doc.webViewLink || doc.driveFileId)
                if (uploadedDocs.length === 0) return null
                return (
                <div>
                  <span className="text-xs font-bold text-stone-400 uppercase tracking-wider">Dokumen</span>
                  <div className="space-y-1.5 mt-1.5">
                    {uploadedDocs.map((doc: any) => (
                      <div key={doc.id} className="flex items-center gap-2 px-3 py-2 bg-stone-50 rounded-lg border border-stone-200">
                        <ExternalLink className="w-4 h-4 text-emerald-500 shrink-0" />
                        <span className="text-sm text-stone-700 flex-1 truncate">{doc.name}</span>
                        <a href={doc.downloadUrl || doc.webViewLink} target="_blank" rel="noopener noreferrer" className="text-xs text-emerald-600 hover:text-emerald-700 font-medium">
                          Download Berkas →
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
                )
              })()}

              <div className="text-xs text-stone-400 pt-2 border-t">
                Dibuat: {formatDateTime(selectedKegiatan.createdAt)} | Diperbarui: {formatDateTime(selectedKegiatan.updatedAt)}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
