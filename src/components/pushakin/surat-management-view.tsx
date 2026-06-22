'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useAppStore, type Surat, SURAT_KATEGORI_OPTIONS, SURAT_STATUS_CONFIG } from '@/lib/store'
import {
  Plus,
  Mail,
  MailPlus,
  Send,
  Edit,
  Trash2,
  Eye,
  Clock,
  FileText,
  Loader2,
  AlertCircle,
  ExternalLink,
  Archive,
  UploadCloud,
  X,
  Inbox,
  Filter,
  Search,
  MailOpen,
  RotateCcw,
  MapPin,
  User,
  Phone,
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
import { SuratRekapitulasi } from './surat-rekapitulasi'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const initialFormData = {
  jenisSurat: 'Surat Masuk' as 'Surat Masuk' | 'Surat Keluar',
  nomorSurat: '',
  kategori: 'Permohonan',
  tanggalSurat: '',
  pengirim: '',
  penerima: '',
  perihal: '',
  deskripsi: '',
  catatan: '',
  documents: [] as any[],
  isPermohonanProduksi: false,
  location: '',
  executionTime: '',
  picName: '',
  picWhatsApp: '',
}

export function SuratManagementView() {
  const {
    currentUser, users, suratList, setSuratList, addSurat, updateSurat, deleteSurat,
    showAlert, showConfirm, setActiveView, setSelectedProjectId,
    setPreFillFromPermohonan, permohonanList, addPermohonan
  } = useAppStore()

  const [isLoading, setIsLoading] = useState(true)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [isDetailOpen, setIsDetailOpen] = useState(false)
  const [isForwardDialogOpen, setIsForwardDialogOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [selectedSurat, setSelectedSurat] = useState<Surat | null>(null)
  const [selectedManagerId, setSelectedManagerId] = useState('')
  const [activeTab, setActiveTab] = useState('masuk')
  const [searchTerm, setSearchTerm] = useState('')
  const [filterKategori, setFilterKategori] = useState<string>('all')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [viewMode, setViewMode] = useState<'list' | 'table'>('list')
  const [formData, setFormData] = useState(initialFormData)
  const [isFormMaximized, setIsFormMaximized] = useState(false)
  const [isDetailMaximized, setIsDetailMaximized] = useState(false)

  const isAdministrator = currentUser?.role === 'Administrator'
  const isAdmin = currentUser?.role === 'Admin'
  const canManageSurat = isAdministrator || isAdmin
  const managers = users.filter(u => u.role === 'Manager')

  // Administrator sees "Nama Kegiatan" instead of "Perihal"
  const perihalLabel = isAdministrator ? 'Nama Kegiatan' : 'Perihal'
  const perihalPlaceholder = isAdministrator ? 'Nama kegiatan...' : 'Perihal surat...'
  const perihalValidation = isAdministrator ? 'Nama kegiatan wajib diisi' : 'Perihal surat wajib diisi'

  // Fetch surat
  const fetchSurat = useCallback(async () => {
    if (!currentUser) return
    try {
      const role = currentUser.role === 'Admin' ? 'Admin' : currentUser.role
      const jenisSurat = activeTab === 'masuk' ? 'Surat Masuk' : activeTab === 'keluar' ? 'Surat Keluar' : undefined
      const params = new URLSearchParams({
        userId: currentUser.id,
        userRole: role,
      })
      if (jenisSurat) params.set('jenisSurat', jenisSurat)
      const response = await fetch(`/api/surat?${params}`)
      if (response.ok) {
        const data = await response.json()
        setSuratList(data)
      }
    } catch (error) {
      console.error('Failed to fetch surat:', error)
    } finally {
      setIsLoading(false)
    }
  }, [currentUser, activeTab, setSuratList])

  useEffect(() => {
    setIsLoading(true)
    fetchSurat()
  }, [fetchSurat])

  // Filter surat based on tab, search, and filters
  const getFilteredSurat = useCallback(() => {
    let list = suratList

    // For Permohonan Produksi tab, filter from masuk surat
    if (activeTab === 'permohonan') {
      list = suratList.filter(s => s.jenisSurat === 'Surat Masuk' && s.kategori === 'Permohonan')
    }

    // Apply kategori filter
    if (filterKategori !== 'all') {
      list = list.filter(s => s.kategori === filterKategori)
    }

    // Apply status filter
    if (filterStatus !== 'all') {
      list = list.filter(s => s.status === filterStatus)
    }

    // Apply search
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      list = list.filter(s =>
        s.perihal.toLowerCase().includes(term) ||
        s.nomorSurat.toLowerCase().includes(term) ||
        (s.pengirim && s.pengirim.toLowerCase().includes(term)) ||
        (s.penerima && s.penerima.toLowerCase().includes(term)) ||
        (s.kategori && s.kategori.toLowerCase().includes(term))
      )
    }

    return list
  }, [suratList, activeTab, filterKategori, filterStatus, searchTerm])

  const filteredSurat = getFilteredSurat()

  // Form handling
  const [uploadingDocs, setUploadingDocs] = useState<{id: string; name: string; progress: number; status: 'uploading' | 'success' | 'error'; error?: string; webViewLink?: string}[]>([])

  // Save progress overlay
  const [saveProgress, setSaveProgress] = useState<{
    active: boolean
    steps: { key: string; label: string; icon: React.ReactNode; status: 'pending' | 'loading' | 'success' | 'error'; detail?: string }[]
    folderLink?: string
    docLinks?: string[]
  } | null>(null)

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    Array.from(files).forEach(file => {
      const fileId = `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`
      // Rename format: Surat_Pengirim_Perihal/NamaKegiatan.ext
      const pengirim = formData.pengirim?.trim().replace(/[/\\?%*:|"<>]/g, '-') || 'Pengirim'
      const perihal = formData.perihal?.trim().replace(/[/\\?%*:|"<>]/g, '-') || 'Perihal'
      const ext = file.name.split('.').pop() || ''
      const renamed = `Surat_${pengirim}_${perihal}${ext ? '.' + ext : ''}`
      setUploadingDocs(prev => [...prev, { id: fileId, name: renamed, progress: 0, status: 'uploading' }])
      setFormData(prev => ({
        ...prev,
        documents: [...prev.documents, {
          id: fileId,
          name: renamed,
          originalName: file.name,
          mimeType: file.type,
          size: file.size,
          data: null,
          webViewLink: null,
          uploadedAt: new Date().toISOString(),
          _pendingFile: file,
        } as any]
      }))
    })
    e.target.value = ''
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

  // Upload pending documents to Google Drive after surat is created/edited
  const uploadDocumentsToDrive = async (suratId: string, docs: any[]) => {
    const pendingDocs = docs.filter((d: any) => d._pendingFile)
    if (pendingDocs.length === 0) return { finalDocs: docs, docLinks: [] as string[] }

    const uploadedDocs: any[] = []
    const docLinks: string[] = []
    for (const doc of pendingDocs) {
      const file = doc._pendingFile as File
      try {
        setUploadingDocs(prev => prev.map(d => d.id === doc.id ? { ...d, progress: 50 } : d))
        updateStep('upload-docs', 'loading', `Mengupload "${doc.name}"...`)
        const uploadForm = new FormData()
        uploadForm.append('file', file)
        uploadForm.append('suratId', suratId)
        uploadForm.append('fileName', doc.name) // Send renamed filename to server
        const res = await fetch('/api/surat/upload-document', { method: 'POST', body: uploadForm })
        if (res.ok) {
          const result = await safeJsonParse(res)
          if (result?.document) {
            uploadedDocs.push(result.document)
            if (result.document.webViewLink) docLinks.push(result.document.webViewLink)
            setUploadingDocs(prev => prev.map(d => d.id === doc.id ? { ...d, progress: 100, status: 'success', webViewLink: result.document.webViewLink } : d))
          }
        } else {
          let errorMsg = 'Upload gagal'
          const err = await safeJsonParse(res)
          if (err?.error) errorMsg = err.error
          console.error(`[SURAT UPLOAD] Failed "${doc.name}":`, errorMsg)
          setUploadingDocs(prev => prev.map(d => d.id === doc.id ? { ...d, status: 'error', error: errorMsg } : d))
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload gagal'
        console.error(`[SURAT UPLOAD] Error "${doc.name}":`, msg)
        setUploadingDocs(prev => prev.map(d => d.id === doc.id ? { ...d, status: 'error', error: msg } : d))
      }
    }
    return { finalDocs: [...docs.filter((d: any) => !d._pendingFile), ...uploadedDocs], docLinks }
  }

  const openCreateForm = (jenisSurat: 'Surat Masuk' | 'Surat Keluar') => {
    setFormData({
      ...initialFormData,
      jenisSurat,
      kategori: jenisSurat === 'Surat Masuk' ? 'Permohonan' : 'Lainnya',
    })
    setEditingId(null)
    setIsFormOpen(true)
  }

  const openEditForm = (s: Surat) => {
    setFormData({
      jenisSurat: s.jenisSurat,
      nomorSurat: s.nomorSurat || '',
      kategori: s.kategori,
      tanggalSurat: s.tanggalSurat ? new Date(s.tanggalSurat).toISOString().slice(0, 16) : '',
      pengirim: s.pengirim || '',
      penerima: s.penerima || '',
      perihal: s.perihal,
      deskripsi: s.deskripsi || '',
      catatan: s.catatan || '',
      documents: s.documents || [],
      isPermohonanProduksi: s.kategori === 'Permohonan' && s.jenisSurat === 'Surat Masuk',
      location: s.location || '',
      executionTime: s.executionTime || '',
      picName: s.picName || '',
      picWhatsApp: s.picWhatsApp || '',
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

  // Safe JSON parse — returns null if body is not valid JSON (e.g. Cloudflare HTML error page)
  const safeJsonParse = async (response: Response): Promise<any | null> => {
    try {
      return await response.json()
    } catch {
      return null
    }
  }

  // Fetch with retry for surat save operations.
  // Retries on: network errors, HTTP 5xx, and non-JSON responses (CF error pages).
  // POST /api/surat is safe to retry because nomorSurat is NOT @unique.
  const fetchSuratWithRetry = async (
    url: string,
    method: 'POST' | 'PUT',
    body: any,
    onRetry?: (attempt: number, reason: string) => void
  ): Promise<{ ok: boolean; data?: any; error?: string; status?: number }> => {
    const MAX_RETRIES = 2
    const RETRY_DELAY_MS = 800

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })

        // If response is OK, parse and return
        if (response.ok) {
          const data = await safeJsonParse(response)
          if (data) return { ok: true, data }
          // OK but non-JSON — shouldn't happen, treat as error
          if (attempt < MAX_RETRIES) {
            onRetry?.(attempt + 1, 'Respons tidak valid')
            await new Promise(r => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)))
            continue
          }
          return { ok: false, error: 'Respons server tidak valid' }
        }

        // Non-OK response: try to parse error JSON safely
        const errData = await safeJsonParse(response)

        // 5xx errors: retry (likely CF CPU limit or temporary server issue)
        if (response.status >= 500 && response.status < 600) {
          if (attempt < MAX_RETRIES) {
            const reason = errData?.error || `Server error (${response.status})`
            onRetry?.(attempt + 1, reason)
            await new Promise(r => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)))
            continue
          }
          // Final attempt failed — return the error
          return { ok: false, error: errData?.error || `Server error (${response.status})`, status: response.status }
        }

        // 4xx errors: don't retry (client error — e.g. validation failure)
        return { ok: false, error: errData?.error || `Gagal menyimpan surat (${response.status})`, status: response.status }

      } catch (error) {
        // Network error (fetch threw) — retry
        if (attempt < MAX_RETRIES) {
          onRetry?.(attempt + 1, 'Koneksi terputus')
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)))
          continue
        }
        return { ok: false, error: 'Koneksi terputus. Periksa jaringan Anda.' }
      }
    }
    return { ok: false, error: 'Gagal menyimpan surat setelah beberapa percobaan' }
  }

  // Store last payload for retry functionality
  const [lastSavePayload, setLastSavePayload] = useState<{ method: 'POST' | 'PUT'; body: any; editingId: string | null } | null>(null)

  const performSave = async (payload: any, editingId: string | null, hasPending: boolean) => {
    let suratData: any = null

    const result = await fetchSuratWithRetry(
      '/api/surat',
      editingId ? 'PUT' : 'POST',
      editingId ? { id: editingId, ...payload } : payload,
      (attempt, reason) => {
        updateStep('save-surat', 'loading', `Percobaan ulang #${attempt}: ${reason}...`)
      }
    )

    if (!result.ok) {
      updateStep('save-surat', 'error', result.error || 'Gagal menyimpan surat')
      setIsSaving(false)
      return null
    }

    suratData = result.data
    if (editingId) {
      updateSurat(suratData)
      updateStep('save-surat', 'success', `Surat ${suratData.nomorSurat} berhasil diperbarui`)
    } else {
      addSurat(suratData)
      updateStep('save-surat', 'success', `Surat ${suratData.nomorSurat} berhasil dibuat`)
    }
    return suratData
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.perihal.trim()) {
      showAlert(perihalValidation)
      return
    }

    // Check if there are pending uploads
    const hasPending = formData.documents.some((d: any) => d._pendingFile)

    // Initialize progress steps
    type StepStatus = 'pending' | 'loading' | 'success' | 'error'
    const steps: { key: string; label: string; icon: React.ReactNode; status: StepStatus; detail?: string }[] = [
      { key: 'save-surat', label: 'Menyimpan data surat...', icon: <Save className="w-4 h-4" />, status: 'pending' },
      { key: 'upload-docs', label: hasPending ? `Mengupload ${formData.documents.filter((d: any) => d._pendingFile).length} dokumen ke Google Drive...` : 'Tidak ada dokumen untuk diupload', icon: <CloudUpload className="w-4 h-4" />, status: 'pending' },
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
      // --- STEP 1: Save surat data ---
      updateStep('save-surat', 'loading')

      // Clean documents for API — only include already-uploaded docs, exclude pending uploads
      // Pending docs will be added via upload-document endpoint after surat is created
      const cleanDocs = formData.documents
        .filter((d: any) => !d._pendingFile)
        .map((d: any) => {
          const { _pendingFile, data, ...rest } = d
          return { ...rest, webViewLink: d.webViewLink || null }
        })

      const payload: any = {
        jenisSurat: formData.jenisSurat,
        nomorSurat: formData.nomorSurat || null,
        kategori: formData.isPermohonanProduksi ? 'Permohonan' : formData.kategori,
        tanggalSurat: formData.tanggalSurat || null,
        pengirim: formData.pengirim || null,
        penerima: formData.penerima || null,
        perihal: formData.perihal,
        deskripsi: formData.deskripsi || null,
        catatan: formData.catatan || null,
        documents: cleanDocs,
        administratorId: currentUser?.id,
      }
      if (formData.isPermohonanProduksi) {
        payload.location = formData.location || null
        payload.executionTime = formData.executionTime || null
        payload.picName = formData.picName || null
        payload.picWhatsApp = formData.picWhatsApp || null
      }

      // Store payload for retry button
      setLastSavePayload({ method: editingId ? 'PUT' : 'POST', body: payload, editingId })

      const suratData = await performSave(payload, editingId, hasPending)
      if (!suratData) return

      // --- STEP 2: Upload documents (folder created automatically if needed) ---
      if (hasPending) {
        const suratId = editingId || suratData.id
        const { finalDocs, docLinks } = await uploadDocumentsToDrive(suratId, formData.documents)
        // Update form documents to reflect upload results
        setFormData(prev => ({ ...prev, documents: finalDocs }))
        const successCount = docLinks.length
        const failCount = formData.documents.filter((d: any) => d._pendingFile).length - successCount
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
            steps: prev.steps.map(s => s.key === loadingStep.key ? { ...s, status: 'error' as const, detail: 'Terjadi kesalahan tak terduga. Silakan coba lagi.' } : s),
          }
        }
        return prev
      })
      setIsSaving(false)
    }
  }

  // Retry handler — re-attempts the save from the last payload
  const handleRetrySave = async () => {
    if (!lastSavePayload) return
    const hasPending = formData.documents.some((d: any) => d._pendingFile)

    // Reset steps
    type StepStatus = 'pending' | 'loading' | 'success' | 'error'
    const steps: { key: string; label: string; icon: React.ReactNode; status: StepStatus; detail?: string }[] = [
      { key: 'save-surat', label: 'Menyimpan data surat...', icon: <Save className="w-4 h-4" />, status: 'pending' },
      { key: 'upload-docs', label: hasPending ? `Mengupload ${formData.documents.filter((d: any) => d._pendingFile).length} dokumen ke Google Drive...` : 'Tidak ada dokumen untuk diupload', icon: <CloudUpload className="w-4 h-4" />, status: 'pending' },
      { key: 'done', label: 'Selesai!', icon: <CheckCircle2 className="w-4 h-4" />, status: 'pending' },
    ]
    if (!hasPending) {
      steps[1].status = 'success'
      steps[1].detail = 'Dilewati (tidak ada dokumen)'
    }

    setSaveProgress({ active: true, steps })
    setIsSaving(true)
    updateStep('save-surat', 'loading', 'Mencoba ulang...')

    try {
      const suratData = await performSave(lastSavePayload.body, lastSavePayload.editingId, hasPending)
      if (!suratData) return

      // --- STEP 2: Upload documents ---
      if (hasPending) {
        const suratId = lastSavePayload.editingId || suratData.id
        const { finalDocs, docLinks } = await uploadDocumentsToDrive(suratId, formData.documents)
        setFormData(prev => ({ ...prev, documents: finalDocs }))
        const successCount = docLinks.length
        const failCount = formData.documents.filter((d: any) => d._pendingFile).length - successCount
        if (successCount > 0) {
          updateStep('upload-docs', 'success', `${successCount} dokumen berhasil diupload ke Google Drive`)
          setSaveProgress(prev => prev ? { ...prev, docLinks } : null)
        }
        if (failCount > 0) {
          updateStep('upload-docs', successCount > 0 ? 'success' : 'error',
            successCount > 0 ? `${successCount} berhasil, ${failCount} gagal diupload` : `${failCount} dokumen gagal diupload`
          )
        }
      } else {
        updateStep('upload-docs', 'success')
      }

      updateStep('done', 'success')
      setIsSaving(false)
    } catch (error) {
      setSaveProgress(prev => {
        if (!prev) return prev
        const loadingStep = prev.steps.find(s => s.status === 'loading')
        if (loadingStep) {
          return {
            ...prev,
            steps: prev.steps.map(s => s.key === loadingStep.key ? { ...s, status: 'error' as const, detail: 'Terjadi kesalahan tak terduga. Silakan coba lagi.' } : s),
          }
        }
        return prev
      })
      setIsSaving(false)
    }
  }

  const handleDelete = (id: string) => {
    showConfirm('Yakin ingin menghapus surat ini?', async () => {
      try {
        const response = await fetch(`/api/surat?id=${id}`, { method: 'DELETE' })
        if (response.ok) {
          deleteSurat(id)
          showAlert('Surat berhasil dihapus!')
        } else {
          const err = await response.json()
          showAlert(err.error || 'Gagal menghapus surat')
        }
      } catch {
        showAlert('Terjadi kesalahan')
      }
    })
  }

  const handleForward = async () => {
    if (!selectedSurat || !selectedManagerId) return
    setIsSaving(true)
    try {
      const response = await fetch('/api/surat', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedSurat.id,
          status: 'diteruskan',
          managerId: selectedManagerId,
        })
      })
      if (response.ok) {
        const data = await response.json()
        updateSurat(data)
        showAlert(`Surat ${data.nomorSurat} berhasil diteruskan ke Manager!`)
        setIsForwardDialogOpen(false)
        fetchSurat()
      } else {
        const err = await response.json()
        showAlert(err.error || 'Gagal meneruskan surat')
      }
    } catch {
      showAlert('Terjadi kesalahan')
    } finally {
      setIsSaving(false)
    }
  }

  const handleArchive = async (s: Surat) => {
    setIsSaving(true)
    try {
      const response = await fetch('/api/surat', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: s.id, status: 'arsip' })
      })
      if (response.ok) {
        const data = await response.json()
        updateSurat(data)
        showAlert('Surat berhasil diarsipkan')
        fetchSurat()
      } else {
        const err = await response.json()
        showAlert(err.error || 'Gagal mengarsipkan surat')
      }
    } catch {
      showAlert('Terjadi kesalahan')
    } finally {
      setIsSaving(false)
    }
  }

  const handleAccept = (s: Surat) => {
    // Use existing permohonan pre-fill if the surat is a permohonan
    if (s.kategori === 'Permohonan') {
      // Check if there's an existing permohonan for this surat
      const existingPermohonan = permohonanList.find(p =>
        p.status === 'forwarded' && p.managerId === currentUser?.id
      )
      if (existingPermohonan) {
        setPreFillFromPermohonan(existingPermohonan)
        setActiveView('create')
        return
      }
    }
    // Navigate to create project directly
    setActiveView('create')
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

  const getKategoriBadgeColor = (kategori: string) => {
    switch (kategori) {
      case 'Permohonan': return 'bg-emerald-50 text-emerald-700 border-emerald-200'
      case 'Undangan': return 'bg-violet-50 text-violet-700 border-violet-200'
      case 'Pemberitahuan': return 'bg-sky-50 text-sky-700 border-sky-200'
      case 'Laporan': return 'bg-amber-50 text-amber-700 border-amber-200'
      case 'Surat Keputusan': return 'bg-orange-50 text-orange-700 border-orange-200'
      default: return 'bg-stone-50 text-stone-600 border-stone-200'
    }
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
            <Mail className="w-6 h-6 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-stone-800">Manajemen Surat</h1>
            <p className="text-stone-500 text-sm">
              Kelola surat masuk dan keluar
            </p>
          </div>
        </div>
        {canManageSurat && (
          <div className="flex gap-2">
            <Button onClick={() => openCreateForm('Surat Masuk')} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
              <MailPlus className="w-4 h-4" />
              <span className="hidden sm:inline">Surat Masuk</span>
            </Button>
            <Button onClick={() => openCreateForm('Surat Keluar')} className="gap-2 bg-stone-600 hover:bg-stone-700">
              <MailPlus className="w-4 h-4" />
              <span className="hidden sm:inline">Surat Keluar</span>
            </Button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <TabsList className="bg-stone-100 p-1">
            <TabsTrigger value="masuk" className="gap-2 data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
              <Inbox className="w-4 h-4" />
              Surat Masuk
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 data-[state=active]:bg-white/20">
                {suratList.filter(s => s.jenisSurat === 'Surat Masuk').length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="keluar" className="gap-2 data-[state=active]:bg-stone-700 data-[state=active]:text-white">
              <MailOpen className="w-4 h-4" />
              Surat Keluar
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 data-[state=active]:bg-white/20">
                {suratList.filter(s => s.jenisSurat === 'Surat Keluar').length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="permohonan" className="gap-2 data-[state=active]:bg-emerald-700 data-[state=active]:text-white">
              <FileText className="w-4 h-4" />
              <span className="hidden sm:inline">Permohonan</span> Produksi
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 data-[state=active]:bg-white/20">
                {suratList.filter(s => s.jenisSurat === 'Surat Masuk' && s.kategori === 'Permohonan').length}
              </Badge>
            </TabsTrigger>
            {(isAdministrator || isAdmin) && (
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
                    placeholder={`Cari surat (nomor, ${perihalLabel.toLowerCase()}, pengirim/penerima)...`}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <Select value={filterKategori} onValueChange={setFilterKategori}>
                  <SelectTrigger className="w-full md:w-44">
                    <Filter className="w-4 h-4 mr-1 text-stone-400" />
                    <SelectValue placeholder="Kategori" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Kategori</SelectItem>
                    {SURAT_KATEGORI_OPTIONS.map(k => (
                      <SelectItem key={k} value={k}>{k}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="w-full md:w-40">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Status</SelectItem>
                    {Object.entries(SURAT_STATUS_CONFIG).map(([key, val]) => (
                      <SelectItem key={key} value={key}>{val.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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

          {/* Surat List */}
          {filteredSurat.length === 0 ? (
            <Card className="mt-4 border-dashed">
              <CardContent className="p-12 text-center">
                <div className="w-16 h-16 rounded-full bg-stone-100 mx-auto mb-4 flex items-center justify-center">
                  <Inbox className="w-8 h-8 text-stone-400" />
                </div>
                <h3 className="text-lg font-semibold text-stone-800">Tidak ada surat</h3>
                <p className="text-stone-500 mt-1">
                  {canManageSurat
                    ? 'Klik tombol di atas untuk menambah surat baru.'
                    : 'Belum ada surat yang ditampilkan.'}
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
                      <TableHead className="min-w-[100px] text-xs font-semibold">No. Surat</TableHead>
                      <TableHead className="min-w-[200px] text-xs font-semibold">{perihalLabel}</TableHead>
                      <TableHead className="min-w-[110px] text-xs font-semibold">Kategori</TableHead>
                      <TableHead className="min-w-[100px] text-xs font-semibold">Status</TableHead>
                      <TableHead className="min-w-[120px] text-xs font-semibold">{activeTab === 'keluar' ? 'Penerima' : 'Pengirim'}</TableHead>
                      <TableHead className="min-w-[100px] text-xs font-semibold">Tanggal</TableHead>
                      {canManageSurat && <TableHead className="min-w-[180px] text-center text-xs font-semibold">Aksi</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredSurat.map((s, idx) => {
                      const status = SURAT_STATUS_CONFIG[s.status] || SURAT_STATUS_CONFIG.diterima
                      const canEdit = canManageSurat && s.status === 'diterima'
                      const canDelete = canManageSurat
                      const canForward = canManageSurat && s.status === 'diterima' && s.kategori === 'Permohonan' && s.jenisSurat === 'Surat Masuk'
                      const canRetryForward = canManageSurat && s.status === 'ditolak' && s.kategori === 'Permohonan'
                      const canArchive = canManageSurat && (s.status === 'diterima' || s.status === 'diproses') && s.kategori !== 'Permohonan'
                      return (
                        <TableRow key={s.id} className="group">
                          <TableCell className="text-center text-xs text-stone-400 font-mono">{idx + 1}</TableCell>
                          <TableCell className="text-xs font-mono font-bold text-stone-600">{s.nomorSurat}</TableCell>
                          <TableCell>
                            <button onClick={() => { setSelectedSurat(s); setIsDetailOpen(true) }} className="text-left">
                              <p className="text-sm font-semibold text-stone-800 hover:text-emerald-600 transition-colors line-clamp-1">{s.perihal}</p>
                              {s.deskripsi && <p className="text-[11px] text-stone-400 line-clamp-1 mt-0.5">{s.deskripsi}</p>}
                            </button>
                            {s.documents && Array.isArray(s.documents) && s.documents.filter((d: any) => d.webViewLink).length > 0 && (
                              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 mt-0.5">
                                <FileText className="w-3 h-3" />{s.documents.filter((d: any) => d.webViewLink).length} berkas
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge className={cn("text-[10px] font-medium border", getKategoriBadgeColor(s.kategori))}>{s.kategori}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge className={cn("text-[10px] font-medium border whitespace-nowrap", status.bg, status.color, status.border)}>{status.label}</Badge>
                          </TableCell>
                          <TableCell className="text-xs text-stone-600">
                            {activeTab === 'keluar' ? s.penerima : s.pengirim}
                            {s.managerId && (() => {
                              const mgr = users.find(u => u.id === s.managerId)
                              return mgr ? <span className="text-[10px] text-blue-500 block">→ {mgr.name}</span> : null
                            })()}
                          </TableCell>
                          <TableCell className="text-xs text-stone-500 whitespace-nowrap">{s.tanggalSurat ? formatDate(s.tanggalSurat) : '-'}</TableCell>
                          {canManageSurat && (
                            <TableCell>
                              <div className="flex items-center justify-center gap-1">
                                <Button variant="ghost" size="sm" onClick={() => { setSelectedSurat(s); setIsDetailOpen(true) }} className="h-7 px-2 text-stone-500 hover:text-stone-700" title="Detail">
                                  <Eye className="w-3.5 h-3.5" />
                                </Button>
                                {canEdit && (
                                  <Button variant="ghost" size="sm" onClick={() => openEditForm(s)} className="h-7 px-2 text-stone-500 hover:text-stone-700" title="Edit">
                                    <Edit className="w-3.5 h-3.5" />
                                  </Button>
                                )}
                                {canForward && (
                                  <Button variant="ghost" size="sm" onClick={() => { setSelectedSurat(s); setSelectedManagerId(''); setIsForwardDialogOpen(true) }} className="h-7 px-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50" title="Teruskan">
                                    <Send className="w-3.5 h-3.5" />
                                  </Button>
                                )}
                                {canRetryForward && (
                                  <Button variant="ghost" size="sm" onClick={() => { setSelectedSurat(s); setSelectedManagerId(''); setIsForwardDialogOpen(true) }} className="h-7 px-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50" title="Teruskan Ulang">
                                    <RotateCcw className="w-3.5 h-3.5" />
                                  </Button>
                                )}
                                {canArchive && (
                                  <Button variant="ghost" size="sm" onClick={() => handleArchive(s)} className="h-7 px-2 text-stone-500 hover:text-stone-700" title="Arsipkan">
                                    <Archive className="w-3.5 h-3.5" />
                                  </Button>
                                )}
                                {canDelete && (
                                  <Button variant="ghost" size="sm" onClick={() => handleDelete(s.id)} className="h-7 px-2 text-red-500 hover:text-red-600 hover:bg-red-50" title="Hapus">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                )}
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
                {filteredSurat.map(s => {
                  const status = SURAT_STATUS_CONFIG[s.status] || SURAT_STATUS_CONFIG.diterima
                  const manager = users.find(u => u.id === s.managerId)
                  return (
                    <Card key={s.id} className={cn("transition-all hover:shadow-md border-l-4", status.border)}>
                      <CardContent className="p-5">
                        <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                          {/* Main Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap mb-1">
                                  <span className="text-xs font-mono font-bold text-stone-500 bg-stone-100 px-2 py-0.5 rounded">
                                    {s.nomorSurat}
                                  </span>
                                  <Badge className={cn("text-xs font-medium border", getKategoriBadgeColor(s.kategori))}>
                                    {s.kategori}
                                  </Badge>
                                  <Badge className={cn("text-xs font-medium border", status.bg, status.color, status.border)}>
                                    {status.label}
                                  </Badge>
                                </div>
                                <h3 className="text-lg font-bold text-stone-800 mt-1">{s.perihal}</h3>
                                <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs text-stone-500">
                                  {s.jenisSurat === 'Surat Masuk' && s.pengirim && (
                                    <span className="flex items-center gap-1">
                                      <Mail className="w-3 h-3" />
                                      {s.pengirim}
                                    </span>
                                  )}
                                  {s.jenisSurat === 'Surat Keluar' && s.penerima && (
                                    <span className="flex items-center gap-1">
                                      <Send className="w-3 h-3" />
                                      {s.penerima}
                                    </span>
                                  )}
                                  {s.tanggalSurat && (
                                    <span className="flex items-center gap-1">
                                      <Clock className="w-3 h-3" />
                                      {formatDate(s.tanggalSurat)}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>

                            {s.deskripsi && (
                              <p className="text-sm text-stone-600 mt-2 line-clamp-2">{s.deskripsi}</p>
                            )}

                            {/* Permohonan Produksi extra info */}
                            {s.kategori === 'Permohonan' && s.jenisSurat === 'Surat Masuk' && (
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-stone-500">
                                {s.location && (
                                  <span className="flex items-center gap-1">
                                    <MapPin className="w-3 h-3" />
                                    {s.location}
                                  </span>
                                )}
                                {s.executionTime && (
                                  <span className="flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    {new Date(s.executionTime).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}
                                  </span>
                                )}
                                {s.picName && (
                                  <span className="flex items-center gap-1">
                                    <User className="w-3 h-3" />
                                    PIC: {s.picName}
                                  </span>
                                )}
                                {s.picWhatsApp && (
                                  <span className="flex items-center gap-1">
                                    <Phone className="w-3 h-3" />
                                    <a href={`https://wa.me/${s.picWhatsApp.replace(/^0/, '62')}`} target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:text-emerald-700 hover:underline font-medium">
                                      {s.picWhatsApp}
                                    </a>
                                  </span>
                                )}
                              </div>
                            )}

                            {/* Manager info */}
                            {s.managerId && manager && (
                              <div className="flex items-center gap-2 mt-2 text-xs text-stone-500 bg-stone-50 px-3 py-1.5 rounded-lg w-fit">
                                <Send className="w-3 h-3 text-blue-500" />
                                <span>Diteruskan ke <strong>{manager.name}</strong></span>
                              </div>
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
                            <Button variant="ghost" size="sm" onClick={() => { setSelectedSurat(s); setIsDetailOpen(true) }} className="text-stone-500 hover:text-stone-700 gap-1 text-xs">
                              <Eye className="w-3.5 h-3.5" />
                              Detail
                            </Button>
                            {canManageSurat && s.status === 'diterima' && (
                              <>
                                <Button variant="ghost" size="sm" onClick={() => openEditForm(s)} className="text-stone-500 hover:text-stone-700 gap-1 text-xs">
                                  <Edit className="w-3.5 h-3.5" />
                                  Edit
                                </Button>
                                {s.kategori === 'Permohonan' && s.jenisSurat === 'Surat Masuk' && (
                                  <Button variant="ghost" size="sm" onClick={() => { setSelectedSurat(s); setSelectedManagerId(''); setIsForwardDialogOpen(true) }} className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 gap-1 text-xs">
                                    <Send className="w-3.5 h-3.5" />
                                    Teruskan
                                  </Button>
                                )}
                                {s.kategori !== 'Permohonan' && (
                                  <Button variant="ghost" size="sm" onClick={() => handleArchive(s)} className="text-stone-500 hover:text-stone-700 gap-1 text-xs">
                                    <Archive className="w-3.5 h-3.5" />
                                    Arsipkan
                                  </Button>
                                )}
                                <Button variant="ghost" size="sm" onClick={() => handleDelete(s.id)} className="text-red-500 hover:text-red-600 hover:bg-red-50 gap-1 text-xs">
                                  <Trash2 className="w-3.5 h-3.5" />
                                  Hapus
                                </Button>
                              </>
                            )}
                            {canManageSurat && s.status === 'ditolak' && s.kategori === 'Permohonan' && (
                              <Button variant="ghost" size="sm" onClick={() => { setSelectedSurat(s); setSelectedManagerId(''); setIsForwardDialogOpen(true) }} className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 gap-1 text-xs">
                                <RotateCcw className="w-3.5 h-3.5" />
                                Teruskan Ulang
                              </Button>
                            )}
                            {canManageSurat && (s.status === 'diterima' || s.status === 'diproses') && s.kategori !== 'Permohonan' && (
                              <Button variant="ghost" size="sm" onClick={() => handleArchive(s)} className="text-stone-500 hover:text-stone-700 gap-1 text-xs">
                                <Archive className="w-3.5 h-3.5" />
                                Arsipkan
                              </Button>
                            )}
                            {canManageSurat && s.status !== 'diterima' && (
                              <Button variant="ghost" size="sm" onClick={() => handleDelete(s.id)} className="text-red-500 hover:text-red-600 hover:bg-red-50 gap-1 text-xs">
                                <Trash2 className="w-3.5 h-3.5" />
                                Hapus
                              </Button>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            </ScrollArea>
          )}
        </div>

        {(isAdministrator || isAdmin) && (
          <TabsContent value="rekapitulasi" className="mt-4">
            <SuratRekapitulasi suratList={suratList} users={users} />
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
              <DialogTitle className="truncate">{editingId ? `Edit Surat - ${formData.jenisSurat}` : `Buat ${formData.jenisSurat} Baru`}</DialogTitle>
              <DialogDescription className="text-xs">
                Isi form di bawah untuk {editingId ? 'memperbarui' : 'membuat'} surat
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
            {/* Jenis Surat Badge */}
            <div className="flex items-center gap-2">
              <Badge className={cn(
                "text-sm px-3 py-1",
                formData.jenisSurat === 'Surat Masuk' ? "bg-emerald-100 text-emerald-700" : "bg-stone-100 text-stone-700"
              )}>
                {formData.jenisSurat === 'Surat Masuk' ? <Inbox className="w-4 h-4 mr-1" /> : <MailOpen className="w-4 h-4 mr-1" />}
                {formData.jenisSurat}
              </Badge>
              {!editingId && (
                <span className="text-xs text-stone-400">Nomor surat akan dibuat otomatis</span>
              )}
            </div>

            {/* No. Surat & Nama Kegiatan/Perihal */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="nomorSurat" className="font-semibold">No. Surat</Label>
                <Input id="nomorSurat" value={formData.nomorSurat} onChange={e => setFormData(prev => ({ ...prev, nomorSurat: e.target.value }))} placeholder="Contoh: 001/SP/2025" />
                <p className="text-xs text-stone-400">Kosongkan untuk nomor surat otomatis</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="perihal" className="font-semibold">{perihalLabel} *</Label>
                <Input id="perihal" required value={formData.perihal} onChange={e => setFormData(prev => ({ ...prev, perihal: e.target.value }))} placeholder={perihalPlaceholder} />
              </div>
            </div>

            {/* Tanggal & Kategori */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="tanggalSurat">Tanggal Surat</Label>
                <Input id="tanggalSurat" type="date" value={formData.tanggalSurat} onChange={e => setFormData(prev => ({ ...prev, tanggalSurat: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Kategori</Label>
                <Select value={formData.kategori} onValueChange={(val) => setFormData(prev => ({ ...prev, kategori: val }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SURAT_KATEGORI_OPTIONS.map(k => (
                      <SelectItem key={k} value={k}>{k}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Pengirim / Penerima */}
            {formData.jenisSurat === 'Surat Masuk' ? (
              <div className="space-y-2">
                <Label htmlFor="pengirim">Pengirim</Label>
                <Input id="pengirim" value={formData.pengirim} onChange={e => setFormData(prev => ({ ...prev, pengirim: e.target.value }))} placeholder="Nama pengirim surat" />
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="penerima">Penerima</Label>
                <Input id="penerima" value={formData.penerima} onChange={e => setFormData(prev => ({ ...prev, penerima: e.target.value }))} placeholder="Nama penerima surat" />
              </div>
            )}

            {/* Permohonan Produksi Checkbox - only for Surat Masuk */}
            {formData.jenisSurat === 'Surat Masuk' && (
              <label className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-xl border-2 cursor-pointer transition-all",
                formData.isPermohonanProduksi ? "bg-emerald-50 border-emerald-200" : "bg-white border-stone-200 hover:bg-stone-50"
              )}>
                <Checkbox
                  checked={formData.isPermohonanProduksi}
                  onCheckedChange={(checked) => setFormData(prev => ({
                    ...prev,
                    isPermohonanProduksi: checked === true,
                    kategori: checked === true ? 'Permohonan' : 'Lainnya'
                  }))}
                />
                <div>
                  <span className="text-sm font-semibold text-stone-800">Ini adalah Permohonan Produksi</span>
                  <p className="text-xs text-stone-500">Surat akan masuk ke daftar Permohonan Produksi dan dapat diteruskan ke Manager</p>
                </div>
              </label>
            )}

            {/* Extra fields for Permohonan Produksi - only show when checked */}
            {formData.isPermohonanProduksi && (
              <div className="space-y-4 p-4 bg-emerald-50/50 rounded-xl border border-emerald-200">
                <div className="flex items-center gap-2 text-sm font-bold text-emerald-800">
                  <ClipboardList className="w-4 h-4" />
                  <span>Detail Permohonan Produksi</span>
                </div>

                {/* Lokasi & Waktu */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="location" className="font-semibold flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-emerald-600" />
                      Tempat / Lokasi
                    </Label>
                    <Input id="location" value={formData.location} onChange={e => setFormData(prev => ({ ...prev, location: e.target.value }))} placeholder="Contoh: Gedung Utama Lantai 5" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="executionTime" className="font-semibold flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-emerald-600" />
                      Waktu Pelaksanaan
                    </Label>
                    <Input id="executionTime" type="datetime-local" value={formData.executionTime} onChange={e => setFormData(prev => ({ ...prev, executionTime: e.target.value }))} />
                  </div>
                </div>

                {/* Nama PIC & WhatsApp */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="picName" className="font-semibold flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-emerald-600" />
                      Nama PIC
                    </Label>
                    <Input id="picName" value={formData.picName} onChange={e => setFormData(prev => ({ ...prev, picName: e.target.value }))} placeholder="Nama penanggung jawab" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="picWhatsApp" className="font-semibold flex items-center gap-1.5">
                      <Phone className="w-3.5 h-3.5 text-emerald-600" />
                      No. WhatsApp PIC
                    </Label>
                    <Input id="picWhatsApp" value={formData.picWhatsApp} onChange={e => setFormData(prev => ({ ...prev, picWhatsApp: e.target.value }))} placeholder="08xxxxxxxxxx" />
                  </div>
                </div>
              </div>
            )}

            {/* Deskripsi */}
            <div className="space-y-2">
              <Label htmlFor="deskripsi">Deskripsi</Label>
              <Textarea
                id="deskripsi"
                rows={3}
                value={formData.deskripsi}
                onChange={e => setFormData(prev => ({ ...prev, deskripsi: e.target.value }))}
                placeholder="Deskripsi isi surat..."
              />
            </div>

            {/* Catatan */}
            <div className="space-y-2">
              <Label htmlFor="catatan">Catatan</Label>
              <Textarea
                id="catatan"
                rows={2}
                value={formData.catatan}
                onChange={e => setFormData(prev => ({ ...prev, catatan: e.target.value }))}
                placeholder="Catatan tambahan..."
              />
            </div>

            {/* Upload Dokumen */}
            <div className="space-y-2">
              <Label>Upload Dokumen ke Google Drive</Label>
              <div className="border-2 border-dashed rounded-xl p-4 text-center hover:border-emerald-300 transition-colors">
                <input
                  type="file"
                  className="hidden"
                  id="surat-doc-upload"
                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                  multiple
                  onChange={handleFileUpload}
                  disabled={isSaving}
                />
                <label htmlFor="surat-doc-upload" className={cn("cursor-pointer flex flex-col items-center gap-2", isSaving && "opacity-50 pointer-events-none")}>
                  <UploadCloud className="w-8 h-8 text-stone-400" />
                  <span className="text-sm text-stone-600">Klik untuk upload dokumen</span>
                  <span className="text-xs text-stone-400">PDF, Word, Gambar (maks. 10MB)</span>
                  <span className="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">Format: Surat_Pengirim_{perihalLabel.replace(' ', '_')}</span>
                </label>
              </div>
              {formData.documents.length > 0 && (
                <div className="space-y-1.5 mt-2">
                  {formData.documents.map(doc => {
                    const uploadStatus = uploadingDocs.find(u => u.id === doc.id)
                    const isPending = !!doc._pendingFile
                    const isUploaded = !!doc.webViewLink && !isPending
                    const isFailed = uploadStatus?.status === 'error'
                    return (
                      <div key={doc.id} className={cn(
                        "flex items-center gap-2 px-3 py-2 rounded-lg border",
                        isUploaded ? "bg-emerald-50 border-emerald-200" : isFailed ? "bg-red-50 border-red-200" : isPending && !!saveProgress ? "bg-emerald-50 border-emerald-200" : isPending ? "bg-amber-50 border-amber-200" : "bg-stone-50 border-stone-200"
                      )}>
                        {isUploaded ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                        ) : isFailed ? (
                          <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                        ) : isPending && !!saveProgress ? (
                          <Loader2 className="w-4 h-4 text-emerald-500 shrink-0 animate-spin" />
                        ) : isPending ? (
                          <FileText className="w-4 h-4 text-amber-500 shrink-0" />
                        ) : (
                          <FileText className="w-4 h-4 text-emerald-500 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <span className="text-sm text-stone-700 truncate block">{doc.name}</span>
                          {doc.originalName && doc.originalName !== doc.name && (
                            <span className="text-[10px] text-stone-400 truncate block">file asli: {doc.originalName}</span>
                          )}
                          {isUploaded && doc.webViewLink && (
                            <div className="flex items-center gap-2">
                              <a href={doc.downloadUrl || doc.webViewLink} target="_blank" rel="noopener noreferrer" className="text-[11px] text-emerald-600 hover:text-emerald-700 hover:underline block truncate">
                                ✅ Berhasil diupload — Download Berkas →
                              </a>
                            </div>
                          )}
                          {isFailed && uploadStatus.error && (
                            <span className="text-[10px] text-red-600 block">❌ Gagal: {uploadStatus.error}</span>
                          )}
                          {isPending && !saveProgress && (
                            <span className="text-[10px] text-amber-600 block">Menunggu untuk diupload ke Google Drive...</span>
                          )}
                          {isPending && !!saveProgress && (
                            <span className="text-[10px] text-emerald-600 block animate-pulse">Sedang mengupload ke Google Drive...</span>
                          )}
                        </div>
                        <button type="button" onClick={() => removeDocument(doc.id)} className="text-stone-400 hover:text-red-500">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    )
                  })}
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
                        ? 'Surat Berhasil Disimpan!'
                        : 'Memproses Surat...'
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

                  {/* Action buttons: Retry (on error) + Close (when done or error) */}
                  {(saveProgress.steps[saveProgress.steps.length - 1]?.status === 'success' || saveProgress.steps.some(s => s.status === 'error')) && (
                    <div className="mt-5 pt-4 border-t border-stone-100 space-y-2">
                      {/* Retry button — only shown when save-surat step failed */}
                      {saveProgress.steps.some(s => s.key === 'save-surat' && s.status === 'error') && (
                        <Button
                          className="w-full bg-amber-600 hover:bg-amber-700"
                          onClick={handleRetrySave}
                        >
                          <RotateCcw className="w-4 h-4 mr-2" />
                          Coba Lagi
                        </Button>
                      )}
                      <Button
                        className="w-full bg-emerald-600 hover:bg-emerald-700"
                        onClick={() => {
                          setSaveProgress(null)
                          setIsSaving(false)
                          setLastSavePayload(null)
                          closeForm()
                          fetchSurat()
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
              <Button type="submit" disabled={isSaving} className={cn(
                formData.jenisSurat === 'Surat Masuk' ? "bg-emerald-600 hover:bg-emerald-700" : "bg-stone-600 hover:bg-stone-700"
              )}>
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Memproses...
                  </>
                ) : (
                  editingId ? 'Perbarui' : 'Buat Surat'
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
              <DialogTitle className="truncate">Detail Surat</DialogTitle>
            </div>
            <button
              type="button"
              onClick={() => setIsDetailMaximized(!isDetailMaximized)}
              className="shrink-0 p-1.5 rounded-md border bg-white hover:bg-stone-100 transition-colors"
              title={isDetailMaximized ? 'Kecilkan' : 'Maksimalkan'}
            >
              {isDetailMaximized ? <Minimize2 className="w-4 h-4 text-stone-500" /> : <Maximize2 className="w-4 h-4 text-stone-500" />}
            </button>
          </div>

          {selectedSurat && (
            <div className={cn(
              "space-y-4 py-2 overflow-y-auto",
              isDetailMaximized ? "h-[calc(100vh-6rem)] overscroll-contain" : ""
            )}>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono font-bold text-stone-500 bg-stone-100 px-2 py-0.5 rounded">
                    {selectedSurat.nomorSurat}
                  </span>
                  <Badge className={cn("text-xs font-medium border", getKategoriBadgeColor(selectedSurat.kategori))}>
                    {selectedSurat.kategori}
                  </Badge>
                  <Badge className={cn("text-xs font-medium border", SURAT_STATUS_CONFIG[selectedSurat.status].bg, SURAT_STATUS_CONFIG[selectedSurat.status].color, SURAT_STATUS_CONFIG[selectedSurat.status].border)}>
                    {SURAT_STATUS_CONFIG[selectedSurat.status].label}
                  </Badge>
                </div>
                <Badge variant="outline" className="text-xs">
                  {selectedSurat.jenisSurat}
                </Badge>
              </div>

              <h3 className="text-xl font-bold text-stone-800">{selectedSurat.perihal}</h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                {selectedSurat.tanggalSurat && (
                  <div className="flex items-center gap-2 text-stone-600">
                    <Clock className="w-4 h-4 text-stone-400 shrink-0" />
                    <span className="text-stone-500">Tanggal:</span>
                    <strong>{formatDate(selectedSurat.tanggalSurat)}</strong>
                  </div>
                )}
                {selectedSurat.pengirim && (
                  <div className="flex items-center gap-2 text-stone-600">
                    <Mail className="w-4 h-4 text-stone-400 shrink-0" />
                    <span className="text-stone-500">Pengirim:</span>
                    <strong className="truncate">{selectedSurat.pengirim}</strong>
                  </div>
                )}
                {selectedSurat.penerima && (
                  <div className="flex items-center gap-2 text-stone-600">
                    <Send className="w-4 h-4 text-stone-400 shrink-0" />
                    <span className="text-stone-500">Penerima:</span>
                    <strong className="truncate">{selectedSurat.penerima}</strong>
                  </div>
                )}
                {selectedSurat.managerId && (() => {
                  const mgr = users.find(u => u.id === selectedSurat.managerId)
                  return mgr ? (
                    <div className="flex items-center gap-2 text-stone-600">
                      <Send className="w-4 h-4 text-stone-400" />
                      <span className="text-stone-500">Manager:</span>
                      <strong>{mgr.name}</strong>
                    </div>
                  ) : null
                })()}
              </div>

              {/* Permohonan Produksi Detail */}
              {selectedSurat.kategori === 'Permohonan' && selectedSurat.jenisSurat === 'Surat Masuk' && (
                <div className="bg-emerald-50/60 rounded-xl p-4 border border-emerald-200 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-bold text-emerald-800">
                    <ClipboardList className="w-4 h-4" />
                    <span>Detail Permohonan Produksi</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    {selectedSurat.location && (
                      <div className="flex items-center gap-2 text-stone-600">
                        <MapPin className="w-4 h-4 text-emerald-500 shrink-0" />
                        <span className="text-stone-500">Lokasi:</span>
                        <strong className="truncate">{selectedSurat.location}</strong>
                      </div>
                    )}
                    {selectedSurat.executionTime && (
                      <div className="flex items-center gap-2 text-stone-600">
                        <Clock className="w-4 h-4 text-emerald-500 shrink-0" />
                        <span className="text-stone-500">Waktu:</span>
                        <strong>{formatDateTime(selectedSurat.executionTime)}</strong>
                      </div>
                    )}
                    {selectedSurat.picName && (
                      <div className="flex items-center gap-2 text-stone-600">
                        <User className="w-4 h-4 text-emerald-500 shrink-0" />
                        <span className="text-stone-500">PIC:</span>
                        <strong className="truncate">{selectedSurat.picName}</strong>
                      </div>
                    )}
                    {selectedSurat.picWhatsApp && (
                      <div className="flex items-center gap-2 text-stone-600">
                        <Phone className="w-4 h-4 text-emerald-500" />
                        <span className="text-stone-500">WhatsApp:</span>
                        <a href={`https://wa.me/${selectedSurat.picWhatsApp.replace(/^0/, '62')}`} target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:text-emerald-700 hover:underline font-bold">
                          {selectedSurat.picWhatsApp}
                        </a>
                      </div>
                    )}
                  </div>
                  {!selectedSurat.location && !selectedSurat.executionTime && !selectedSurat.picName && !selectedSurat.picWhatsApp && (
                    <p className="text-xs text-stone-400 italic">Detail permohonan belum diisi oleh Administrator.</p>
                  )}
                </div>
              )}

              {selectedSurat.deskripsi && (
                <div>
                  <span className="text-xs font-bold text-stone-400 uppercase tracking-wider">Deskripsi</span>
                  <p className="text-sm text-stone-700 bg-stone-50 p-3 rounded-lg mt-1.5 whitespace-pre-line">{selectedSurat.deskripsi}</p>
                </div>
              )}

              {selectedSurat.catatan && (
                <div>
                  <span className="text-xs font-bold text-stone-400 uppercase tracking-wider">Catatan</span>
                  <p className="text-sm text-stone-700 bg-amber-50 p-3 rounded-lg mt-1.5">{selectedSurat.catatan}</p>
                </div>
              )}

              {selectedSurat.documents && selectedSurat.documents.length > 0 && (() => {
                // Only show documents that were actually uploaded to Google Drive
                const uploadedDocs = selectedSurat.documents.filter((doc: any) => doc.webViewLink || doc.driveFileId)
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
                Dibuat: {formatDateTime(selectedSurat.createdAt)} | Diperbarui: {formatDateTime(selectedSurat.updatedAt)}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Forward Dialog */}
      <Dialog open={isForwardDialogOpen} onOpenChange={setIsForwardDialogOpen}>
        <DialogContent className="max-w-md mx-4 sm:mx-0">
          <DialogHeader>
            <DialogTitle>Teruskan ke Manager</DialogTitle>
            <DialogDescription>Pilih Manager yang akan menangani permohonan ini</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {selectedSurat && (
              <div className="p-3 bg-stone-50 rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono text-stone-500">{selectedSurat.nomorSurat}</span>
                  <Badge variant="outline" className="text-xs">{selectedSurat.kategori}</Badge>
                </div>
                <p className="font-semibold text-sm text-stone-800">{selectedSurat.perihal}</p>
                {selectedSurat.pengirim && (
                  <p className="text-xs text-stone-500 mt-1">dari {selectedSurat.pengirim}</p>
                )}
              </div>
            )}
            <div className="space-y-2">
              <Label>Pilih Manager</Label>
              <Select value={selectedManagerId} onValueChange={setSelectedManagerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih Manager..." />
                </SelectTrigger>
                <SelectContent>
                  {managers.map(m => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {managers.length === 0 && (
              <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
                <div className="flex items-center gap-2 text-amber-700">
                  <AlertCircle className="w-4 h-4" />
                  <span className="text-sm">Tidak ada Manager yang tersedia. Buat user dengan role Manager terlebih dahulu.</span>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsForwardDialogOpen(false)}>Batal</Button>
            <Button onClick={handleForward} disabled={!selectedManagerId || isSaving} className="bg-blue-600 hover:bg-blue-700">
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
              Teruskan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
