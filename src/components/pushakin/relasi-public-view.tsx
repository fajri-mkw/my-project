'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, CheckCircle2, Upload, AlertCircle, FileText } from 'lucide-react'

interface FormField {
  id: string
  type: 'text' | 'textarea' | 'email' | 'phone' | 'file' | 'select' | 'date' | 'number' | 'text+photo'
  label: string
  required: boolean
  placeholder?: string
  options?: string[]
  maxPhotos?: number
}

interface FormData {
  id: string
  title: string
  description: string
  fields: FormField[]
  exampleFile?: { name: string; url: string } | null
}

interface UploadedFile {
  name: string
  fileId: string
  url: string
}

// Key: fieldId, Value: array of uploaded files (untuk multiple upload)
type UploadedFilesMap = Record<string, UploadedFile[]>

export function RelasiPublicView({ token }: { token: string }) {
  const [formData, setFormData] = useState<FormData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFilesMap>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isUploading, setIsUploading] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    const fetchForm = async () => {
      try {
        const r = await fetch(`/api/relasi/public?token=${token}`)
        if (!r.ok) {
          const d = await r.json().catch(() => ({}))
          setError(d.error || 'Form tidak ditemukan')
          return
        }
        const data = await r.json()
        setFormData(data)
      } catch {
        setError('Gagal memuat form')
      } finally {
        setIsLoading(false)
      }
    }
    fetchForm()
  }, [token])

  const handleUpload = async (fieldId: string, file: File, maxPhotos: number) => {
    if (!file.type.startsWith('image/')) {
      alert('Hanya file gambar yang diperbolehkan')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      alert('Maksimal 10MB')
      return
    }
    // Cek limit
    const current = uploadedFiles[fieldId] || []
    if (current.length >= maxPhotos) {
      alert(`Maksimal ${maxPhotos} foto untuk pertanyaan ini`)
      return
    }
    setIsUploading(fieldId)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('formId', formData!.id)
      const r = await fetch('/api/relasi/upload', { method: 'POST', body: fd })
      const d = await r.json()
      if (r.ok && d.success) {
        setUploadedFiles(prev => ({
          ...prev,
          [fieldId]: [...(prev[fieldId] || []), { name: d.name, fileId: d.fileId, url: d.url }],
        }))
      } else {
        alert(d.error || 'Gagal upload')
      }
    } catch {
      alert('Gagal upload file')
    } finally {
      setIsUploading(null)
    }
  }

  const removeUpload = (fieldId: string, idx: number) => {
    setUploadedFiles(prev => ({
      ...prev,
      [fieldId]: (prev[fieldId] || []).filter((_, i) => i !== idx),
    }))
  }

  const handleSubmit = async () => {
    if (!formData) return
    // Validate required fields
    for (const field of formData.fields) {
      if (field.required) {
        if (field.type === 'file' || field.type === 'text+photo') {
          if (!uploadedFiles[field.id] || uploadedFiles[field.id].length === 0) {
            alert(`"${field.label}" wajib diisi`)
            return
          }
        } else if (field.type === 'text+photo' && !answers[field.id]?.trim()) {
          alert(`"${field.label}" wajib diisi`)
          return
        } else if (!answers[field.id]?.trim()) {
          alert(`"${field.label}" wajib diisi`)
          return
        }
      }
    }

    setIsSubmitting(true)
    try {
      // Flatten uploaded files: per fieldId → array of { name, fileId, url, fieldId }
      const files: Array<{ fieldId: string; name: string; fileId: string; url: string }> = []
      for (const [fieldId, fileArr] of Object.entries(uploadedFiles)) {
        for (const f of fileArr) {
          files.push({ fieldId, ...f })
        }
      }
      const r = await fetch('/api/relasi/public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formId: formData.id,
          data: answers,
          uploadedFiles: files,
        }),
      })
      const d = await r.json()
      if (r.ok) {
        setSubmitted(true)
      } else {
        alert(d.error || 'Gagal mengirim')
      }
    } catch {
      alert('Gagal mengirim isian')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 to-purple-50">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-50 to-orange-50 p-6">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center">
            <AlertCircle className="w-12 h-12 mx-auto mb-4 text-red-500" />
            <h2 className="text-lg font-bold text-stone-800 mb-2">Form Tidak Tersedia</h2>
            <p className="text-sm text-stone-600">{error}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-teal-50 p-6">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center">
            <CheckCircle2 className="w-16 h-16 mx-auto mb-4 text-green-500" />
            <h2 className="text-lg font-bold text-stone-800 mb-2">Terima Kasih!</h2>
            <p className="text-sm text-stone-600">Isian Anda berhasil dikirim. Pengelola akan meninjau materi yang Anda kirimkan.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!formData) return null

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-purple-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <Card className="mb-6 overflow-hidden">
          <CardContent className="p-6 bg-gradient-to-br from-indigo-600 to-purple-700 text-white">
            <h1 className="text-2xl font-bold mb-2">{formData.title}</h1>
            {formData.description && <p className="text-sm text-indigo-100">{formData.description}</p>}
            {formData.exampleFile && (
              <div className="mt-4 p-3 bg-white/10 rounded-lg flex items-center gap-3">
                <FileText className="w-5 h-5 text-white flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-indigo-100 font-medium">📄 File Contoh:</p>
                  <p className="text-sm text-white truncate">{formData.exampleFile.name}</p>
                </div>
                <a href={formData.exampleFile.url} target="_blank" rel="noopener noreferrer"
                   className="flex-shrink-0 px-3 py-1.5 bg-white text-indigo-700 rounded-lg text-xs font-medium hover:bg-indigo-50 transition-colors">
                  📥 Lihat / Unduh Contoh
                </a>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Form */}
        <Card>
          <CardContent className="p-6 space-y-6">
            {formData.fields.map((field, idx) => (
              <div key={field.id} className="space-y-2">
                <Label className="text-sm font-semibold text-stone-800">
                  {idx + 1}. {field.label}
                  {field.required && <span className="text-red-500 ml-1">*</span>}
                </Label>

                {field.type === 'text' && (
                  <Input
                    value={answers[field.id] || ''}
                    onChange={e => setAnswers(prev => ({ ...prev, [field.id]: e.target.value }))}
                    placeholder={field.placeholder || ''}
                  />
                )}

                {field.type === 'textarea' && (
                  <Textarea
                    value={answers[field.id] || ''}
                    onChange={e => setAnswers(prev => ({ ...prev, [field.id]: e.target.value }))}
                    placeholder={field.placeholder || ''}
                    rows={4}
                  />
                )}

                {field.type === 'email' && (
                  <Input
                    type="email"
                    value={answers[field.id] || ''}
                    onChange={e => setAnswers(prev => ({ ...prev, [field.id]: e.target.value }))}
                    placeholder={field.placeholder || 'email@contoh.com'}
                  />
                )}

                {field.type === 'phone' && (
                  <Input
                    type="tel"
                    value={answers[field.id] || ''}
                    onChange={e => setAnswers(prev => ({ ...prev, [field.id]: e.target.value }))}
                    placeholder={field.placeholder || '08xxxxxxxxxx'}
                  />
                )}

                {field.type === 'number' && (
                  <Input
                    type="number"
                    value={answers[field.id] || ''}
                    onChange={e => setAnswers(prev => ({ ...prev, [field.id]: e.target.value }))}
                    placeholder={field.placeholder || ''}
                  />
                )}

                {field.type === 'date' && (
                  <Input
                    type="date"
                    value={answers[field.id] || ''}
                    onChange={e => setAnswers(prev => ({ ...prev, [field.id]: e.target.value }))}
                  />
                )}

                {field.type === 'select' && (
                  <select
                    value={answers[field.id] || ''}
                    onChange={e => setAnswers(prev => ({ ...prev, [field.id]: e.target.value }))}
                    className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm"
                  >
                    <option value="">— Pilih —</option>
                    {(field.options || []).map((opt, i) => (
                      <option key={i} value={opt}>{opt}</option>
                    ))}
                  </select>
                )}

                {field.type === 'file' && (
                  <div className="space-y-2">
                    {/* Foto sudah upload — tampilkan thumbnail */}
                    {(uploadedFiles[field.id] || []).map((f, fi) => (
                      <div key={fi} className="flex items-center gap-2 p-2 bg-green-50 border border-green-200 rounded-lg">
                        <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                        <span className="text-xs text-stone-600 truncate flex-1">{f.name}</span>
                        <button type="button" onClick={() => removeUpload(field.id, fi)} className="text-red-500 text-xs hover:text-red-700">Hapus</button>
                      </div>
                    ))}
                    {/* Upload button — hanya tampil kalau belum capai maxPhotos */}
                    {(!uploadedFiles[field.id] || uploadedFiles[field.id].length < (field.maxPhotos || 1)) && (
                      <label className="flex flex-col items-center justify-center border-2 border-dashed border-stone-300 rounded-xl p-6 cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition-colors">
                        {isUploading === field.id ? (
                          <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-2" />
                        ) : (
                          <Upload className="w-8 h-8 text-stone-400 mb-2" />
                        )}
                        <span className="text-sm text-stone-600">
                          {isUploading === field.id ? 'Mengupload...' : `Upload Foto ${uploadedFiles[field.id]?.length || 0}/${field.maxPhotos || 1}`}
                        </span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={e => {
                            const file = e.target.files?.[0]
                            if (file) handleUpload(field.id, file, field.maxPhotos || 1)
                          }}
                        />
                      </label>
                    )}
                  </div>
                )}

                {field.type === 'text+photo' && (
                  <div className="space-y-3">
                    {/* Bagian teks */}
                    <Textarea
                      value={answers[field.id] || ''}
                      onChange={e => setAnswers(prev => ({ ...prev, [field.id]: e.target.value }))}
                      placeholder={field.placeholder || 'Tulis jawaban teks di sini...'}
                      rows={3}
                    />
                    {/* Bagian foto */}
                    <div className="space-y-2">
                      <p className="text-xs text-stone-500 font-medium">Upload Foto (maks. {field.maxPhotos || 1}):</p>
                      {(uploadedFiles[field.id] || []).map((f, fi) => (
                        <div key={fi} className="flex items-center gap-2 p-2 bg-green-50 border border-green-200 rounded-lg">
                          <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                          <span className="text-xs text-stone-600 truncate flex-1">{f.name}</span>
                          <button type="button" onClick={() => removeUpload(field.id, fi)} className="text-red-500 text-xs hover:text-red-700">Hapus</button>
                        </div>
                      ))}
                      {(!uploadedFiles[field.id] || uploadedFiles[field.id].length < (field.maxPhotos || 1)) && (
                        <label className="flex flex-col items-center justify-center border-2 border-dashed border-stone-300 rounded-xl p-4 cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition-colors">
                          {isUploading === field.id ? (
                            <Loader2 className="w-6 h-6 animate-spin text-indigo-500 mb-2" />
                          ) : (
                            <Upload className="w-6 h-6 text-stone-400 mb-2" />
                          )}
                          <span className="text-xs text-stone-600">
                            {isUploading === field.id ? 'Mengupload...' : `Foto ${uploadedFiles[field.id]?.length || 0}/${field.maxPhotos || 1}`}
                          </span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={e => {
                              const file = e.target.files?.[0]
                              if (file) handleUpload(field.id, file, field.maxPhotos || 1)
                            }}
                          />
                        </label>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}

            <Button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white"
              size="lg"
            >
              {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : null}
              Kirim Isian
            </Button>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-stone-400 mt-4">
          Pushakin Flows — Pusat Hubangan Masyarakat dan Keterbukaan Informasi UIN Antasari
        </p>
      </div>
    </div>
  )
}
