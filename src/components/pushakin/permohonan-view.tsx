'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
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
import { ScrollArea } from '@/components/ui/scroll-area'
import { useAppStore, type Permohonan } from '@/lib/store'
import {
  Plus,
  Inbox,
  Send,
  Edit,
  Trash2,
  Eye,
  CheckCircle2,
  XCircle,
  Clock,
  FileText,
  MapPin,
  User,
  Phone,
  Calendar,
  Loader2,
  AlertCircle,
  ExternalLink,
  RotateCcw,
  ChevronDown,
  UploadCloud,
  X,
  ClipboardList,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const ACTIVITY_OPTIONS = [
  'Peliputan', 'Pemberitaan', 'Live Streaming', 'Podcast', 'Desain', 'Lainnya'
]

const OUTPUT_OPTIONS = [
  'Teks', 'Foto', 'Video', 'Audio', 'Streaming', 'Desain', 'Podcast', 'Lainnya'
]

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  pending: { label: 'Menunggu', color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200' },
  forwarded: { label: 'Diteruskan', color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200' },
  rejected: { label: 'Ditolak', color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200' },
  completed: { label: 'Selesai', color: 'text-green-700', bg: 'bg-green-50', border: 'border-green-200' },
}

const initialFormData = {
  title: '',
  description: '',
  requesterUnit: '',
  location: '',
  executionTime: '',
  picName: '',
  picWhatsApp: '',
  activityTypes: [] as string[],
  customActivity: '',
  outputNeeds: [] as string[],
  customOutput: '',
  adminNote: '',
  documents: [] as any[],
}

export function PermohonanView() {
  const { currentUser, users, permohonanList, setPermohonanList, addPermohonan, updatePermohonan, deletePermohonan, showAlert, showConfirm, setActiveView, setPreFillFromPermohonan } = useAppStore()

  const [isLoading, setIsLoading] = useState(true)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [isDetailOpen, setIsDetailOpen] = useState(false)
  const [isForwardDialogOpen, setIsForwardDialogOpen] = useState(false)
  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [selectedPermohonan, setSelectedPermohonan] = useState<Permohonan | null>(null)
  const [selectedManagerId, setSelectedManagerId] = useState('')
  const [rejectReason, setRejectReason] = useState('')
  const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'forwarded' | 'rejected' | 'completed'>('all')
  const [searchTerm, setSearchTerm] = useState('')

  const [formData, setFormData] = useState(initialFormData)

  const isAdministrator = currentUser?.role === 'Administrator'
  const isManager = currentUser?.role === 'Manager'
  const isAdmin = currentUser?.role === 'Admin'
  const canManagePermohonan = isAdministrator || isAdmin

  const managers = users.filter(u => u.role === 'Manager')

  // Fetch permohonan
  const fetchPermohonan = useCallback(async () => {
    if (!currentUser) return
    try {
      const params = new URLSearchParams({
        userId: currentUser.id,
        userRole: currentUser.role,
      })
      const response = await fetch(`/api/permohonan?${params}`)
      if (response.ok) {
        const data = await response.json()
        setPermohonanList(data)
      }
    } catch (error) {
      console.error('Failed to fetch permohonan:', error)
    } finally {
      setIsLoading(false)
    }
  }, [currentUser, setPermohonanList])

  useEffect(() => {
    fetchPermohonan()
  }, [fetchPermohonan])

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.title.trim() || !formData.description.trim() || !formData.requesterUnit.trim()) {
      showAlert('Judul, deskripsi, dan unit pemohon wajib diisi')
      return
    }

    setIsSaving(true)
    try {
      if (editingId) {
        // Update
        const response = await fetch('/api/permohonan', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editingId, ...formData })
        })
        if (response.ok) {
          const data = await response.json()
          updatePermohonan(data)
          showAlert('Permohonan berhasil diperbarui!')
        } else {
          const err = await response.json()
          showAlert(err.error || 'Gagal memperbarui permohonan')
        }
      } else {
        // Create
        const response = await fetch('/api/permohonan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...formData, administratorId: currentUser?.id })
        })
        if (response.ok) {
          const data = await response.json()
          addPermohonan(data)
          showAlert('Permohonan berhasil dibuat!')
        } else {
          const err = await response.json()
          showAlert(err.error || 'Gagal membuat permohonan')
        }
      }
      closeForm()
      fetchPermohonan()
    } catch (error) {
      showAlert('Terjadi kesalahan')
    } finally {
      setIsSaving(false)
    }
  }

  // Handle file upload (local storage only)
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    Array.from(files).forEach(file => {
      const reader = new FileReader()
      reader.onload = (event) => {
        const base64 = event.target?.result as string
        const doc = {
          id: `doc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: file.name,
          mimeType: file.type,
          size: file.size,
          data: base64,
          uploadedAt: new Date().toISOString()
        }
        setFormData(prev => ({ ...prev, documents: [...prev.documents, doc] }))
      }
      reader.readAsDataURL(file)
    })
    e.target.value = ''
  }

  const removeDocument = (docId: string) => {
    setFormData(prev => ({ ...prev, documents: prev.documents.filter(d => d.id !== docId) }))
  }

  const openCreateForm = () => {
    setFormData(initialFormData)
    setEditingId(null)
    setIsFormOpen(true)
  }

  const openEditForm = (p: Permohonan) => {
    setFormData({
      title: p.title,
      description: p.description,
      requesterUnit: p.requesterUnit,
      location: p.location,
      executionTime: p.executionTime,
      picName: p.picName,
      picWhatsApp: p.picWhatsApp,
      activityTypes: p.activityTypes,
      customActivity: p.customActivity,
      outputNeeds: p.outputNeeds,
      customOutput: p.customOutput,
      adminNote: p.adminNote,
      documents: p.documents,
    })
    setEditingId(p.id)
    setIsFormOpen(true)
  }

  const closeForm = () => {
    setIsFormOpen(false)
    setEditingId(null)
    setFormData(initialFormData)
  }

  const handleDelete = (id: string) => {
    showConfirm('Yakin ingin menghapus permohonan ini?', async () => {
      try {
        const response = await fetch(`/api/permohonan?id=${id}`, { method: 'DELETE' })
        if (response.ok) {
          deletePermohonan(id)
          showAlert('Permohonan berhasil dihapus!')
        } else {
          const err = await response.json()
          showAlert(err.error || 'Gagal menghapus permohonan')
        }
      } catch {
        showAlert('Terjadi kesalahan')
      }
    })
  }

  const handleForward = async () => {
    if (!selectedPermohonan || !selectedManagerId) return
    setIsSaving(true)
    try {
      const response = await fetch('/api/permohonan', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedPermohonan.id,
          status: 'forwarded',
          managerId: selectedManagerId,
        })
      })
      if (response.ok) {
        const data = await response.json()
        updatePermohonan(data)
        showAlert('Permohonan berhasil diteruskan ke Manager!')
        setIsForwardDialogOpen(false)
        fetchPermohonan()
      } else {
        const err = await response.json()
        showAlert(err.error || 'Gagal meneruskan permohonan')
      }
    } catch {
      showAlert('Terjadi kesalahan')
    } finally {
      setIsSaving(false)
    }
  }

  const handleReject = async () => {
    if (!selectedPermohonan) return
    setIsSaving(true)
    try {
      const response = await fetch('/api/permohonan', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedPermohonan.id,
          status: 'rejected',
          adminNote: rejectReason,
          managerId: currentUser?.id,
        })
      })
      if (response.ok) {
        const data = await response.json()
        updatePermohonan(data)
        showAlert('Permohonan telah ditolak')
        setIsRejectDialogOpen(false)
        setRejectReason('')
        fetchPermohonan()
      } else {
        const err = await response.json()
        showAlert(err.error || 'Gagal menolak permohonan')
      }
    } catch {
      showAlert('Terjadi kesalahan')
    } finally {
      setIsSaving(false)
    }
  }

  const handleAccept = (p: Permohonan) => {
    // Set pre-fill data and navigate to create project
    setPreFillFromPermohonan(p)
    setActiveView('create')
  }

  const handleReForward = (p: Permohonan) => {
    setSelectedPermohonan(p)
    setSelectedManagerId('')
    setIsForwardDialogOpen(true)
  }

  // Filter and search
  const filteredPermohonan = permohonanList.filter(p => {
    if (activeTab !== 'all' && p.status !== activeTab) return false
    if (searchTerm) {
      return p.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.requesterUnit.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.description.toLowerCase().includes(searchTerm.toLowerCase())
    }
    return true
  })

  const tabCounts = {
    all: permohonanList.length,
    pending: permohonanList.filter(p => p.status === 'pending').length,
    forwarded: permohonanList.filter(p => p.status === 'forwarded').length,
    rejected: permohonanList.filter(p => p.status === 'rejected').length,
    completed: permohonanList.filter(p => p.status === 'completed').length,
  }

  const toggleActivityType = (type: string) => {
    setFormData(prev => ({
      ...prev,
      activityTypes: prev.activityTypes.includes(type)
        ? prev.activityTypes.filter(t => t !== type)
        : [...prev.activityTypes, type]
    }))
  }

  const toggleOutputNeed = (need: string) => {
    setFormData(prev => ({
      ...prev,
      outputNeeds: prev.outputNeeds.includes(need)
        ? prev.outputNeeds.filter(n => n !== need)
        : [...prev.outputNeeds, need]
    }))
  }

  const formatDateTime = (dateString: string) => {
    if (!dateString) return '-'
    const d = new Date(dateString)
    return d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
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
            <h1 className="text-2xl font-bold text-stone-800">
              {isManager ? 'Permohonan Masuk' : 'Permohonan'}
            </h1>
            <p className="text-stone-500 text-sm">
              {isManager ? 'Permohonan yang diteruskan kepada Anda' : 'Kelola permohonan dari unit pemohon'}
            </p>
          </div>
        </div>
        {canManagePermohonan && (
          <Button onClick={openCreateForm} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
            <Plus className="w-4 h-4" />
            <span>Buat Permohonan</span>
          </Button>
        )}
      </div>

      {/* Search and Filter */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <FileText className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
              <Input
                placeholder="Cari permohonan..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {(['all', 'pending', 'forwarded', 'rejected', 'completed'] as const).map(tab => (
                <Button
                  key={tab}
                  variant={activeTab === tab ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    "text-xs gap-1",
                    activeTab === tab && "bg-emerald-600 hover:bg-emerald-700"
                  )}
                >
                  {tab === 'all' ? 'Semua' : STATUS_CONFIG[tab].label}
                  <span className={cn(
                    "px-1.5 py-0.5 rounded-full text-[10px] font-bold",
                    activeTab === tab ? "bg-white/20" : "bg-stone-100 text-stone-500"
                  )}>
                    {tabCounts[tab]}
                  </span>
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Permohonan List */}
      {filteredPermohonan.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-12 text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-50 mx-auto mb-4 flex items-center justify-center">
              <Inbox className="w-8 h-8 text-emerald-400" />
            </div>
            <h3 className="text-lg font-semibold text-stone-800">Tidak ada permohonan</h3>
            <p className="text-stone-500 mt-1">
              {canManagePermohonan
                ? 'Klik tombol "Buat Permohonan" untuk menambah permohonan baru.'
                : 'Belum ada permohonan yang diteruskan kepada Anda.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredPermohonan.map(p => {
            const status = STATUS_CONFIG[p.status]
            const manager = users.find(u => u.id === p.managerId)
            return (
              <Card key={p.id} className={cn("transition-all hover:shadow-md border-l-4", status.border)}>
                <CardContent className="p-5">
                  <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                    {/* Main Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-lg font-bold text-stone-800">{p.title}</h3>
                          <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs text-stone-500">
                            <span className="flex items-center gap-1">
                              <User className="w-3 h-3" />
                              {p.requesterUnit}
                            </span>
                            {p.location && (
                              <span className="flex items-center gap-1">
                                <MapPin className="w-3 h-3" />
                                {p.location}
                              </span>
                            )}
                            {p.executionTime && (
                              <span className="flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                {p.executionTime}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge className={cn("text-xs font-medium border", status.bg, status.color, status.border)}>
                            {status.label}
                          </Badge>
                        </div>
                      </div>

                      <p className="text-sm text-stone-600 mt-3 line-clamp-2">{p.description}</p>

                      {/* Tags */}
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {p.activityTypes.map(a => (
                          <Badge key={a} variant="outline" className="text-[10px]">
                            {a === 'Lainnya' && p.customActivity ? `Lainnya (${p.customActivity})` : a}
                          </Badge>
                        ))}
                      </div>

                      {/* Manager info */}
                      {p.managerId && manager && (
                        <div className="flex items-center gap-2 mt-3 text-xs text-stone-500 bg-stone-50 px-3 py-1.5 rounded-lg w-fit">
                          <Send className="w-3 h-3 text-blue-500" />
                          <span>Diteruskan ke <strong>{manager.name}</strong></span>
                        </div>
                      )}

                      {/* Admin note for rejected */}
                      {p.status === 'rejected' && p.adminNote && (
                        <div className="flex items-start gap-2 mt-3 text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                          <span>Alasan penolakan: {p.adminNote}</span>
                        </div>
                      )}

                      {/* Timestamp */}
                      <div className="flex items-center gap-2 mt-3 text-[10px] text-stone-400">
                        <Clock className="w-3 h-3" />
                        {formatDateTime(p.createdAt)}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex lg:flex-col gap-1.5 shrink-0">
                      <Button variant="ghost" size="sm" onClick={() => { setSelectedPermohonan(p); setIsDetailOpen(true) }} className="text-stone-500 hover:text-stone-700 gap-1 text-xs">
                        <Eye className="w-3.5 h-3.5" />
                        Detail
                      </Button>
                      {canManagePermohonan && p.status === 'pending' && (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => { setSelectedPermohonan(p); setSelectedManagerId(''); setIsForwardDialogOpen(true) }} className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 gap-1 text-xs">
                            <Send className="w-3.5 h-3.5" />
                            Teruskan
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => openEditForm(p)} className="text-stone-500 hover:text-stone-700 gap-1 text-xs">
                            <Edit className="w-3.5 h-3.5" />
                            Edit
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(p.id)} className="text-red-500 hover:text-red-600 hover:bg-red-50 gap-1 text-xs">
                            <Trash2 className="w-3.5 h-3.5" />
                            Hapus
                          </Button>
                        </>
                      )}
                      {isManager && p.status === 'forwarded' && (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => handleAccept(p)} className="text-green-600 hover:text-green-700 hover:bg-green-50 gap-1 text-xs">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Terima
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => { setSelectedPermohonan(p); setIsRejectDialogOpen(true); setRejectReason('') }} className="text-red-500 hover:text-red-600 hover:bg-red-50 gap-1 text-xs">
                            <XCircle className="w-3.5 h-3.5" />
                            Tolak
                          </Button>
                        </>
                      )}
                      {canManagePermohonan && p.status === 'rejected' && (
                        <Button variant="ghost" size="sm" onClick={() => handleReForward(p)} className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 gap-1 text-xs">
                          <RotateCcw className="w-3.5 h-3.5" />
                          Teruskan Ulang
                        </Button>
                      )}
                      {p.status === 'completed' && p.projectId && (
                        <Button variant="ghost" size="sm" onClick={() => { setActiveView('project_detail') }} className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 gap-1 text-xs">
                          <ExternalLink className="w-3.5 h-3.5" />
                          Lihat Proyek
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Create/Edit Form Dialog */}
      <Dialog open={isFormOpen} onOpenChange={(open) => { if (!open) closeForm() }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Permohonan' : 'Buat Permohonan Baru'}</DialogTitle>
            <DialogDescription>
              Isi form di bawah untuk {editingId ? 'memperbarui' : 'membuat'} permohonan
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-5 py-4">
            {/* Judul */}
            <div className="space-y-2">
              <Label htmlFor="title" className="font-semibold">Judul Proyek / Liputan *</Label>
              <Input id="title" required value={formData.title} onChange={e => setFormData(prev => ({ ...prev, title: e.target.value }))} placeholder="Contoh: Peliputan Upacara HUT RI" />
            </div>

            {/* Unit Pemohon & Lokasi */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="requesterUnit" className="font-semibold">Unit Pemohon *</Label>
                <Input id="requesterUnit" required value={formData.requesterUnit} onChange={e => setFormData(prev => ({ ...prev, requesterUnit: e.target.value }))} placeholder="Contoh: Biro Humas" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="location">Tempat / Lokasi</Label>
                <Input id="location" value={formData.location} onChange={e => setFormData(prev => ({ ...prev, location: e.target.value }))} placeholder="Contoh: Gedung Utama Lantai 5" />
              </div>
            </div>

            {/* Waktu & PIC */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="executionTime">Waktu Pelaksanaan</Label>
                <Input id="executionTime" type="datetime-local" value={formData.executionTime} onChange={e => setFormData(prev => ({ ...prev, executionTime: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="picName">Nama PIC</Label>
                <Input id="picName" value={formData.picName} onChange={e => setFormData(prev => ({ ...prev, picName: e.target.value }))} placeholder="Nama penanggung jawab" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="picWhatsApp">No. WhatsApp PIC</Label>
                <Input id="picWhatsApp" value={formData.picWhatsApp} onChange={e => setFormData(prev => ({ ...prev, picWhatsApp: e.target.value }))} placeholder="08xxxxxxxxxx" />
              </div>
            </div>

            {/* Jenis Kegiatan */}
            <div className="space-y-2">
              <Label className="font-semibold">Jenis Kegiatan</Label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {ACTIVITY_OPTIONS.map(type => (
                  <label key={type} className={cn(
                    "flex items-center gap-2 px-3 py-2.5 rounded-lg border cursor-pointer transition-all text-sm",
                    formData.activityTypes.includes(type)
                      ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                      : "bg-white border-stone-200 hover:bg-stone-50"
                  )}>
                    <Checkbox
                      checked={formData.activityTypes.includes(type)}
                      onCheckedChange={() => toggleActivityType(type)}
                    />
                    {type}
                  </label>
                ))}
              </div>
              {formData.activityTypes.includes('Lainnya') && (
                <Input
                  placeholder="Sebutkan jenis kegiatan lainnya..."
                  value={formData.customActivity}
                  onChange={e => setFormData(prev => ({ ...prev, customActivity: e.target.value }))}
                  className="mt-2"
                />
              )}
            </div>

            {/* Kebutuhan Output */}
            <div className="space-y-2">
              <Label className="font-semibold">Kebutuhan Output</Label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {OUTPUT_OPTIONS.map(need => (
                  <label key={need} className={cn(
                    "flex items-center gap-2 px-3 py-2.5 rounded-lg border cursor-pointer transition-all text-sm",
                    formData.outputNeeds.includes(need)
                      ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                      : "bg-white border-stone-200 hover:bg-stone-50"
                  )}>
                    <Checkbox
                      checked={formData.outputNeeds.includes(need)}
                      onCheckedChange={() => toggleOutputNeed(need)}
                    />
                    {need}
                  </label>
                ))}
              </div>
              {formData.outputNeeds.includes('Lainnya') && (
                <Input
                  placeholder="Sebutkan kebutuhan output lainnya..."
                  value={formData.customOutput}
                  onChange={e => setFormData(prev => ({ ...prev, customOutput: e.target.value }))}
                  className="mt-2"
                />
              )}
            </div>

            {/* Detail & Instruksi */}
            <div className="space-y-2">
              <Label htmlFor="description" className="font-semibold">Detail & Instruksi Permohonan *</Label>
              <Textarea
                id="description"
                required
                rows={4}
                value={formData.description}
                onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Jelaskan detail kegiatan, instruksi khusus, dan informasi penting lainnya..."
              />
            </div>

            {/* Catatan Administrator */}
            <div className="space-y-2">
              <Label htmlFor="adminNote">Catatan Administrator (Opsional)</Label>
              <Textarea
                id="adminNote"
                rows={2}
                value={formData.adminNote}
                onChange={e => setFormData(prev => ({ ...prev, adminNote: e.target.value }))}
                placeholder="Catatan tambahan dari administrator..."
              />
            </div>

            {/* Upload Dokumen */}
            <div className="space-y-2">
              <Label>Upload Surat Permohonan (Opsional)</Label>
              <div className="border-2 border-dashed rounded-xl p-4 text-center hover:border-emerald-300 transition-colors">
                <input
                  type="file"
                  className="hidden"
                  id="doc-upload"
                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                  multiple
                  onChange={handleFileUpload}
                />
                <label htmlFor="doc-upload" className="cursor-pointer flex flex-col items-center gap-2">
                  <UploadCloud className="w-8 h-8 text-stone-400" />
                  <span className="text-sm text-stone-600">Klik untuk upload dokumen</span>
                  <span className="text-xs text-stone-400">PDF, Word, Gambar</span>
                </label>
              </div>
              {formData.documents.length > 0 && (
                <div className="space-y-1.5 mt-2">
                  {formData.documents.map(doc => (
                    <div key={doc.id} className="flex items-center gap-2 px-3 py-2 bg-stone-50 rounded-lg border border-stone-200">
                      <FileText className="w-4 h-4 text-emerald-500 shrink-0" />
                      <span className="text-sm text-stone-700 flex-1 truncate">{doc.name}</span>
                      <button type="button" onClick={() => removeDocument(doc.id)} className="text-stone-400 hover:text-red-500">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <DialogFooter className="pt-4 border-t">
              <Button type="button" variant="ghost" onClick={closeForm}>Batal</Button>
              <Button type="submit" disabled={isSaving} className="bg-emerald-600 hover:bg-emerald-700">
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Menyimpan...
                  </>
                ) : (
                  editingId ? 'Perbarui' : 'Buat Permohonan'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detail Permohonan</DialogTitle>
          </DialogHeader>
          {selectedPermohonan && (
            <div className="space-y-4 py-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold text-stone-800">{selectedPermohonan.title}</h3>
                <Badge className={cn("text-xs font-medium border", STATUS_CONFIG[selectedPermohonan.status].bg, STATUS_CONFIG[selectedPermohonan.status].color, STATUS_CONFIG[selectedPermohonan.status].border)}>
                  {STATUS_CONFIG[selectedPermohonan.status].label}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="flex items-center gap-2 text-stone-600">
                  <User className="w-4 h-4 text-stone-400" />
                  <span className="text-stone-500">Unit:</span>
                  <strong>{selectedPermohonan.requesterUnit}</strong>
                </div>
                {selectedPermohonan.location && (
                  <div className="flex items-center gap-2 text-stone-600">
                    <MapPin className="w-4 h-4 text-stone-400" />
                    <span className="text-stone-500">Lokasi:</span>
                    <strong>{selectedPermohonan.location}</strong>
                  </div>
                )}
                {selectedPermohonan.executionTime && (
                  <div className="flex items-center gap-2 text-stone-600">
                    <Calendar className="w-4 h-4 text-stone-400" />
                    <span className="text-stone-500">Waktu:</span>
                    <strong>{selectedPermohonan.executionTime}</strong>
                  </div>
                )}
                {selectedPermohonan.picName && (
                  <div className="flex items-center gap-2 text-stone-600">
                    <User className="w-4 h-4 text-stone-400" />
                    <span className="text-stone-500">PIC:</span>
                    <strong>{selectedPermohonan.picName}</strong>
                  </div>
                )}
                {selectedPermohonan.picWhatsApp && (
                  <div className="flex items-center gap-2 text-stone-600">
                    <Phone className="w-4 h-4 text-stone-400" />
                    <span className="text-stone-500">WhatsApp:</span>
                    <strong>{selectedPermohonan.picWhatsApp}</strong>
                  </div>
                )}
              </div>

              {selectedPermohonan.activityTypes.length > 0 && (
                <div>
                  <span className="text-xs font-bold text-stone-400 uppercase tracking-wider">Jenis Kegiatan</span>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {selectedPermohonan.activityTypes.map(a => (
                      <Badge key={a} variant="outline" className="text-xs">
                        {a === 'Lainnya' && selectedPermohonan.customActivity ? `Lainnya (${selectedPermohonan.customActivity})` : a}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {selectedPermohonan.outputNeeds.length > 0 && (
                <div>
                  <span className="text-xs font-bold text-stone-400 uppercase tracking-wider">Kebutuhan Output</span>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {selectedPermohonan.outputNeeds.map(o => (
                      <Badge key={o} variant="outline" className="text-xs">
                        {o === 'Lainnya' && selectedPermohonan.customOutput ? `Lainnya (${selectedPermohonan.customOutput})` : o}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <span className="text-xs font-bold text-stone-400 uppercase tracking-wider">Detail & Instruksi</span>
                <p className="text-sm text-stone-700 bg-stone-50 p-3 rounded-lg mt-1.5 whitespace-pre-line">{selectedPermohonan.description}</p>
              </div>

              {selectedPermohonan.adminNote && (
                <div>
                  <span className="text-xs font-bold text-stone-400 uppercase tracking-wider">Catatan</span>
                  <p className="text-sm text-stone-700 bg-amber-50 p-3 rounded-lg mt-1.5">{selectedPermohonan.adminNote}</p>
                </div>
              )}

              {selectedPermohonan.documents && selectedPermohonan.documents.length > 0 && (
                <div>
                  <span className="text-xs font-bold text-stone-400 uppercase tracking-wider">Dokumen</span>
                  <div className="space-y-1.5 mt-1.5">
                    {selectedPermohonan.documents.map((doc: any) => (
                      <div key={doc.id} className="flex items-center gap-2 px-3 py-2 bg-stone-50 rounded-lg border border-stone-200">
                        <FileText className="w-4 h-4 text-emerald-500" />
                        <span className="text-sm text-stone-700 flex-1 truncate">{doc.name}</span>
                        {doc.data && (
                          <a href={doc.data} download={doc.name} className="text-xs text-emerald-600 hover:text-emerald-700 font-medium">
                            Download
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="text-xs text-stone-400 pt-2 border-t">
                Dibuat: {formatDateTime(selectedPermohonan.createdAt)} | Diperbarui: {formatDateTime(selectedPermohonan.updatedAt)}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Forward Dialog */}
      <Dialog open={isForwardDialogOpen} onOpenChange={setIsForwardDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Teruskan ke Manager</DialogTitle>
            <DialogDescription>Pilih Manager yang akan menangani permohonan ini</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {selectedPermohonan && (
              <div className="p-3 bg-stone-50 rounded-lg">
                <p className="font-semibold text-sm text-stone-800">{selectedPermohonan.title}</p>
                <p className="text-xs text-stone-500 mt-1">dari {selectedPermohonan.requesterUnit}</p>
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

      {/* Reject Dialog */}
      <Dialog open={isRejectDialogOpen} onOpenChange={setIsRejectDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Tolak Permohonan</DialogTitle>
            <DialogDescription>Berikan alasan penolakan</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {selectedPermohonan && (
              <div className="p-3 bg-red-50 rounded-lg border border-red-100">
                <p className="font-semibold text-sm text-red-800">{selectedPermohonan.title}</p>
              </div>
            )}
            <div className="space-y-2">
              <Label>Alasan Penolakan *</Label>
              <Textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Jelaskan alasan penolakan..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsRejectDialogOpen(false)}>Batal</Button>
            <Button onClick={handleReject} disabled={!rejectReason.trim() || isSaving} className="bg-red-600 hover:bg-red-700">
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <XCircle className="w-4 h-4 mr-2" />}
              Tolak
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
