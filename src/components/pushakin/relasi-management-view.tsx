'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Users, Plus, Trash2, Pencil, ExternalLink, Copy, Eye, Loader2, FileText, Check, X, ChevronDown, ChevronUp, Settings2 } from 'lucide-react'

interface FormField {
  id: string
  type: 'text' | 'textarea' | 'email' | 'phone' | 'file' | 'select' | 'date' | 'number'
  label: string
  required: boolean
  placeholder?: string
  options?: string[]
}

interface RelasiForm {
  id: string
  title: string
  description: string
  fields: FormField[]
  publicToken: string | null
  publicUrl: string | null
  status: string
  createdAt: number
  updatedAt: number
}

interface Submission {
  id: string
  formId: string
  data: Record<string, unknown>
  uploadedFiles: Array<{ name: string; fileId: string; url: string }>
  submitterName: string | null
  submitterEmail: string | null
  status: string
  createdAt: number
}

const FIELD_TYPES: Array<{ type: FormField['type']; label: string; icon: string }> = [
  { type: 'text', label: 'Teks Singkat', icon: '📝' },
  { type: 'textarea', label: 'Teks Panjang', icon: '📄' },
  { type: 'email', label: 'Email', icon: '📧' },
  { type: 'phone', label: 'Nomor HP', icon: '📱' },
  { type: 'number', label: 'Angka', icon: '🔢' },
  { type: 'date', label: 'Tanggal', icon: '📅' },
  { type: 'file', label: 'Upload Foto', icon: '📸' },
  { type: 'select', label: 'Pilihan Ganda', icon: '☑️' },
]

export function RelasiManagementView() {
  const { currentUser, showAlert } = useAppStore()
  const [forms, setForms] = useState<RelasiForm[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingForm, setEditingForm] = useState<RelasiForm | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [viewingSubmissions, setViewingSubmissions] = useState<string | null>(null)
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [isLoadingSubmissions, setIsLoadingSubmissions] = useState(false)

  // Form builder state
  const [formTitle, setFormTitle] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formFields, setFormFields] = useState<FormField[]>([])

  const fetchForms = useCallback(async () => {
    setIsLoading(true)
    try {
      const r = await fetch('/api/relasi')
      if (r.ok) setForms(await r.json())
    } catch { } finally { setIsLoading(false) }
  }, [])

  useEffect(() => { fetchForms() }, [fetchForms])

  const openCreateDialog = () => {
    setEditingForm(null)
    setFormTitle('')
    setFormDescription('')
    setFormFields([])
    setIsDialogOpen(true)
  }

  const openEditDialog = (form: RelasiForm) => {
    setEditingForm(form)
    setFormTitle(form.title)
    setFormDescription(form.description)
    setFormFields(form.fields)
    setIsDialogOpen(true)
  }

  const addField = (type: FormField['type']) => {
    const newField: FormField = {
      id: `f-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      label: '',
      required: false,
      ...(type === 'select' ? { options: [''] } : {}),
    }
    setFormFields([...formFields, newField])
  }

  const updateField = (idx: number, updates: Partial<FormField>) => {
    setFormFields(prev => prev.map((f, i) => i === idx ? { ...f, ...updates } : f))
  }

  const removeField = (idx: number) => {
    setFormFields(prev => prev.filter((_, i) => i !== idx))
  }

  const handleSaveForm = async () => {
    if (!formTitle.trim()) { showAlert('Judul form wajib diisi'); return }
    if (formFields.length === 0) { showAlert('Tambahkan minimal 1 pertanyaan'); return }
    // Validate all fields have labels
    const emptyLabels = formFields.filter(f => !f.label.trim())
    if (emptyLabels.length > 0) { showAlert('Semua pertanyaan wajib punya label'); return }

    setIsSaving(true)
    try {
      const payload = { title: formTitle, description: formDescription, fields: formFields }
      const url = editingForm ? `/api/relasi?id=${editingForm.id}` : '/api/relasi'
      const method = editingForm ? 'PUT' : 'POST'
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const d = await r.json()
      if (r.ok) {
        showAlert(editingForm ? 'Form berhasil diupdate' : `Form berhasil dibuat! Link publik: ${d.publicUrl}`)
        setIsDialogOpen(false)
        fetchForms()
      } else {
        showAlert(d.error || 'Gagal menyimpan form')
      }
    } catch { showAlert('Gagal menyimpan') } finally { setIsSaving(false) }
  }

  const handleDeleteForm = async (id: string) => {
    if (!confirm('Hapus form ini beserta semua isian? Tindakan tidak dapat dibatalkan.')) return
    try {
      await fetch(`/api/relasi?id=${id}`, { method: 'DELETE' })
      showAlert('Form berhasil dihapus')
      fetchForms()
    } catch { showAlert('Gagal hapus') }
  }

  const handleToggleStatus = async (form: RelasiForm) => {
    const newStatus = form.status === 'active' ? 'closed' : 'active'
    try {
      await fetch(`/api/relasi?id=${form.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: newStatus }) })
      showAlert(newStatus === 'active' ? 'Form diaktifkan kembali' : 'Form ditutup')
      fetchForms()
    } catch { showAlert('Gagal update status') }
  }

  const copyLink = (url: string | null) => {
    if (!url) return
    const fullUrl = `${window.location.origin}${url}`
    navigator.clipboard.writeText(fullUrl).then(() => showAlert('Link publik disalin: ' + fullUrl))
  }

  const fetchSubmissions = async (formId: string) => {
    setIsLoadingSubmissions(true)
    setViewingSubmissions(formId)
    try {
      const r = await fetch(`/api/relasi/submissions?formId=${formId}`)
      if (r.ok) setSubmissions(await r.json())
    } catch { } finally { setIsLoadingSubmissions(false) }
  }

  const handleSubmissionStatus = async (subId: string, status: string) => {
    try {
      await fetch(`/api/relasi/submissions?id=${subId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
      if (viewingSubmissions) fetchSubmissions(viewingSubmissions)
    } catch { showAlert('Gagal update status') }
  }

  const formatDate = (ts: number) => {
    if (!ts) return '—'
    return new Date(ts).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  // === Submissions view ===
  if (viewingSubmissions) {
    const form = forms.find(f => f.id === viewingSubmissions)
    return (
      <div className="max-w-5xl mx-auto space-y-4">
        <Button variant="ghost" onClick={() => setViewingSubmissions(null)} className="gap-2 text-stone-500">
          ← Kembali ke Daftar Form
        </Button>
        <h2 className="text-xl font-bold text-stone-800">Isian untuk: {form?.title || '...'}</h2>
        {isLoadingSubmissions ? (
          <div className="flex items-center justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-stone-300" /></div>
        ) : submissions.length === 0 ? (
          <Card><CardContent className="p-12 text-center text-stone-400">
            <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>Belum ada isian yang masuk</p>
          </CardContent></Card>
        ) : (
          <div className="space-y-3">
            {submissions.map((sub) => (
              <Card key={sub.id} className={cn('border-l-4', sub.status === 'new' ? 'border-l-blue-500' : sub.status === 'reviewed' ? 'border-l-orange-500' : sub.status === 'published' ? 'border-l-green-500' : 'border-l-red-500')}>
                <CardContent className="p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <span className="text-xs text-stone-500">{formatDate(sub.createdAt)}</span>
                      {sub.submitterName && <span className="text-xs text-stone-600 ml-2">oleh: {sub.submitterName}</span>}
                    </div>
                    <Badge variant="outline" className="text-xs">{sub.status}</Badge>
                  </div>
                  <div className="space-y-2">
                    {form?.fields.map((field, idx) => (
                      <div key={idx} className="text-sm">
                        <span className="font-semibold text-stone-700">{field.label}:</span>{' '}
                        <span className="text-stone-600">{String(sub.data[field.id] || '—')}</span>
                      </div>
                    ))}
                  </div>
                  {sub.uploadedFiles && sub.uploadedFiles.length > 0 && (
                    <div className="mt-3 flex gap-2 flex-wrap">
                      {sub.uploadedFiles.map((f, i) => (
                        <a key={i} href={f.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                          <ExternalLink className="w-3 h-3" /> {f.name}
                        </a>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2 mt-3">
                    <Button size="sm" variant="outline" className="text-green-600 h-7 text-xs" onClick={() => handleSubmissionStatus(sub.id, 'published')}>
                      <Check className="w-3 h-3 mr-1" /> Terbitkan
                    </Button>
                    <Button size="sm" variant="outline" className="text-orange-600 h-7 text-xs" onClick={() => handleSubmissionStatus(sub.id, 'reviewed')}>
                      <Eye className="w-3 h-3 mr-1" /> Review
                    </Button>
                    <Button size="sm" variant="outline" className="text-red-600 h-7 text-xs" onClick={() => handleSubmissionStatus(sub.id, 'rejected')}>
                      <X className="w-3 h-3 mr-1" /> Tolak
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    )
  }

  // === Main view ===
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-stone-800 flex items-center gap-2">
            <Users className="w-6 h-6 text-indigo-600" /> Manajemen Relasi
          </h1>
          <p className="text-sm text-stone-500 mt-1">Buat form publik untuk pengumpulan materi dari pengunjung tanpa perlu login</p>
        </div>
        <Button onClick={openCreateDialog} className="gap-2 bg-indigo-600 hover:bg-indigo-700">
          <Plus className="w-4 h-4" /> Buat Form Baru
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-stone-300" /></div>
      ) : forms.length === 0 ? (
        <Card><CardContent className="p-12 text-center text-stone-400">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Belum ada form</p>
          <p className="text-sm mt-1">Klik "Buat Form Baru" untuk membuat halaman publik pertama Anda</p>
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {forms.map(form => (
            <Card key={form.id} className={cn('border-l-4', form.status === 'active' ? 'border-l-green-500' : 'border-l-stone-300')}>
              <CardContent className="p-4">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-stone-800 truncate">{form.title}</h3>
                    <p className="text-xs text-stone-500 mt-0.5">{form.fields.length} pertanyaan</p>
                  </div>
                  <Badge className={cn('text-xs', form.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-stone-100 text-stone-500')}>
                    {form.status === 'active' ? 'Aktif' : 'Ditutup'}
                  </Badge>
                </div>
                {form.description && <p className="text-sm text-stone-600 mt-1 line-clamp-2">{form.description}</p>}
                <div className="flex items-center gap-2 mt-3 text-xs text-stone-400">
                  <span>{formatDate(form.createdAt)}</span>
                </div>
                <div className="flex gap-2 mt-3 flex-wrap">
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => openEditDialog(form)}>
                    <Pencil className="w-3 h-3" /> Edit
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => fetchSubmissions(form.id)}>
                    <FileText className="w-3 h-3" /> Isian
                  </Button>
                  {form.publicUrl && (
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-blue-600" onClick={() => copyLink(form.publicUrl)}>
                      <Copy className="w-3 h-3" /> Copy Link
                    </Button>
                  )}
                  {form.publicUrl && (
                    <a href={form.publicUrl} target="_blank" rel="noopener noreferrer">
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-green-600">
                        <ExternalLink className="w-3 h-3" /> Buka
                      </Button>
                    </a>
                  )}
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleToggleStatus(form)}>
                    {form.status === 'active' ? 'Tutup' : 'Buka'}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-red-600" onClick={() => handleDeleteForm(form.id)}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* === FORM BUILDER DIALOG === */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingForm ? 'Edit Form' : 'Buat Form Baru'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Form metadata */}
            <div className="space-y-3 p-4 rounded-xl bg-stone-50 border border-stone-200">
              <div>
                <Label className="text-sm font-semibold">Judul Form *</Label>
                <Input value={formTitle} onChange={e => setFormTitle(e.target.value)} placeholder="Contoh: Pengumpulan Berita Kegiatan" className="mt-1" />
              </div>
              <div>
                <Label className="text-sm font-semibold">Deskripsi (opsional)</Label>
                <Textarea value={formDescription} onChange={e => setFormDescription(e.target.value)} placeholder="Penjelasan untuk pengunjung yang akan mengisi form ini" rows={2} className="mt-1" />
              </div>
            </div>

            {/* Form fields */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">Pertanyaan ({formFields.length})</Label>
              </div>

              {formFields.length === 0 ? (
                <div className="text-center p-8 rounded-xl border-2 border-dashed border-stone-300 text-stone-400">
                  <p className="text-sm">Belum ada pertanyaan. Pilih jenis pertanyaan di bawah untuk mulai.</p>
                </div>
              ) : (
                formFields.map((field, idx) => (
                  <div key={field.id} className="p-4 rounded-xl bg-white border border-stone-200 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">{FIELD_TYPES.find(t => t.type === field.type)?.icon} {FIELD_TYPES.find(t => t.type === field.type)?.label}</Badge>
                      </div>
                      <Button type="button" variant="ghost" size="sm" className="text-red-600 h-7 w-7 p-0" onClick={() => removeField(idx)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                    <div>
                      <Input
                        value={field.label}
                        onChange={e => updateField(idx, { label: e.target.value })}
                        placeholder="Tulis pertanyaan di sini..."
                        className="font-medium"
                      />
                    </div>
                    <div className="flex items-center gap-3">
                      <Input
                        value={field.placeholder || ''}
                        onChange={e => updateField(idx, { placeholder: e.target.value })}
                        placeholder="Placeholder/contoh (opsional)"
                        className="text-sm flex-1"
                      />
                      <label className="flex items-center gap-1.5 text-xs cursor-pointer whitespace-nowrap">
                        <input type="checkbox" checked={field.required} onChange={e => updateField(idx, { required: e.target.checked })} className="w-4 h-4" />
                        Wajib diisi
                      </label>
                    </div>
                    {field.type === 'select' && (
                      <div className="space-y-2">
                        <Label className="text-xs text-stone-500">Pilihan:</Label>
                        {(field.options || []).map((opt, oidx) => (
                          <div key={oidx} className="flex gap-2">
                            <Input
                              value={opt}
                              onChange={e => {
                                const newOpts = [...(field.options || [])]
                                newOpts[oidx] = e.target.value
                                updateField(idx, { options: newOpts })
                              }}
                              placeholder={`Pilihan ${oidx + 1}`}
                              className="text-sm flex-1"
                            />
                            <Button type="button" variant="ghost" size="sm" className="text-red-600 h-8 w-8 p-0" onClick={() => {
                              const newOpts = (field.options || []).filter((_, i) => i !== oidx)
                              updateField(idx, { options: newOpts })
                            }}>
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        ))}
                        <Button type="button" variant="outline" size="sm" className="text-xs" onClick={() => updateField(idx, { options: [...(field.options || []), ''] })}>
                          <Plus className="w-3 h-3 mr-1" /> Tambah Pilihan
                        </Button>
                      </div>
                    )}
                  </div>
                ))
              )}

              {/* Add field buttons */}
              <div className="p-3 rounded-xl bg-indigo-50 border border-indigo-100">
                <p className="text-xs font-semibold text-indigo-700 mb-2">Tambah Pertanyaan:</p>
                <div className="flex flex-wrap gap-2">
                  {FIELD_TYPES.map(ft => (
                    <Button key={ft.type} type="button" variant="outline" size="sm" className="text-xs gap-1 bg-white" onClick={() => addField(ft.type)}>
                      {ft.icon} {ft.label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Batal</Button>
            <Button onClick={handleSaveForm} disabled={isSaving} className="bg-indigo-600 hover:bg-indigo-700">
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {editingForm ? 'Simpan Perubahan' : 'Buat Form'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
