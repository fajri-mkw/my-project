'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Zap, UserPlus, ArrowRight, Loader2, AlertTriangle } from 'lucide-react'
import type { UserRole, PermohonanUser } from '@/types/pushakin'

interface PermohonanFormProps {
  onSubmit: (data: Record<string, unknown>) => Promise<void>
  onCancel: () => void
}

export function PermohonanForm({ onSubmit, onCancel }: PermohonanFormProps) {
  const [fastTrack, setFastTrack] = useState(false)
  const [judul, setJudul] = useState('')
  const [deskripsi, setDeskripsi] = useState('')
  const [managerId, setManagerId] = useState('')
  const [reporterId, setReporterId] = useState('')
  const [fotograferId, setFotograferId] = useState('')
  const [editorId, setEditorId] = useState('')
  const [publisherWebId, setPublisherWebId] = useState('')
  const [publisherSocialId, setPublisherSocialId] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [users, setUsers] = useState<PermohonanUser[]>([])

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/users')
      if (res.ok) {
        const data = await res.json()
        setUsers(data)
      }
    } catch (err) {
      console.error('Failed to fetch users:', err)
    }
  }, [])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const getUsersByRole = (role: UserRole) => users.filter((u) => u.role === role)

  const managers = getUsersByRole('MANAGER')
  const reporters = getUsersByRole('REPORTER')
  const fotografers = getUsersByRole('FOTOGRAFER')
  const editors = getUsersByRole('EDITOR')
  const publishersWeb = getUsersByRole('PUBLISHER_WEB')
  const publishersSocial = getUsersByRole('PUBLISHER_SOCIAL_MEDIA')

  // Auto-select first manager for demo
  useEffect(() => {
    if (managers.length > 0 && !managerId) {
      setManagerId(managers[0].id)
    }
  }, [managers, managerId])

  const handleSubmit = async () => {
    if (!judul.trim()) return
    setSubmitting(true)
    try {
      await onSubmit({
        judul: judul.trim(),
        deskripsi: deskripsi.trim() || undefined,
        fastTrack,
        managerId,
        reporterId: fastTrack ? undefined : reporterId || undefined,
        fotograferId: fastTrack ? undefined : fotograferId || undefined,
        editorId: fastTrack ? undefined : editorId || undefined,
        publisherWebId: publisherWebId || undefined,
        publisherSocialId: publisherSocialId || undefined,
      })
    } finally {
      setSubmitting(false)
    }
  }

  const isValid = judul.trim() && managerId && (
    fastTrack ? (publisherWebId || publisherSocialId) : true
  )

  return (
    <Card className="border-0 shadow-lg">
      <CardHeader className="pb-4">
        <CardTitle className="text-xl flex items-center gap-2">
          <UserPlus className="h-5 w-5" />
          Buat Permohonan Pemberitaan
        </CardTitle>
        <CardDescription>
          Inisiasi permohonan pemberitaan baru. Aktifkan Fast Track untuk melewati alur produksi.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* ── Fast Track Toggle ── */}
        <div className={`rounded-xl border-2 p-4 transition-all duration-300 ${
          fastTrack
            ? 'border-amber-400 bg-amber-50/70 shadow-inner'
            : 'border-dashed border-gray-200 bg-gray-50/50'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`rounded-lg p-2 transition-colors ${
                fastTrack ? 'bg-amber-400 text-white' : 'bg-gray-200 text-gray-500'
              }`}>
                <Zap className="h-5 w-5" />
              </div>
              <div>
                <div className="font-semibold text-sm">
                  Fast Track
                  {fastTrack && (
                    <Badge className="ml-2 bg-amber-500 text-white text-[10px] px-1.5 py-0">
                      AKTIF
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {fastTrack
                    ? 'Lewati Reporter, Fotografer & Editor — langsung ke Publisher'
                    : 'Aktifkan untuk melewati alur produksi dan langsung ke Publisher'
                  }
                </p>
              </div>
            </div>
            <Switch
              checked={fastTrack}
              onCheckedChange={setFastTrack}
              aria-label="Toggle Fast Track"
            />
          </div>

          {fastTrack && (
            <div className="mt-3 flex items-center gap-2 text-xs text-amber-700">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>
                Reporter, Fotografer, dan Editor akan otomatis di-skip. Pilih Publisher untuk memproses langsung.
              </span>
            </div>
          )}
        </div>

        {/* ── Judul & Deskripsi ── */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="judul">Judul Permohonan *</Label>
            <Input
              id="judul"
              placeholder="Contoh: Kunjungan Kerja Gubernur ke Kabupaten Bone"
              value={judul}
              onChange={(e) => setJudul(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="deskripsi">Deskripsi</Label>
            <Textarea
              id="deskripsi"
              placeholder="Deskripsi detail permohonan pemberitaan..."
              value={deskripsi}
              onChange={(e) => setDeskripsi(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        {/* ── Manager ── */}
        <div className="space-y-2">
          <Label>Manager (Pemohon) *</Label>
          <Select value={managerId} onValueChange={setManagerId}>
            <SelectTrigger>
              <SelectValue placeholder="Pilih Manager" />
            </SelectTrigger>
            <SelectContent>
              {managers.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Separator />

        {/* ── Normal Flow Assignments (hidden in fast track) ── */}
        {!fastTrack && (
          <div className="space-y-4">
            <div className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <ArrowRight className="h-4 w-4" />
              Alur Produksi Normal
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Reporter</Label>
                <Select value={reporterId} onValueChange={setReporterId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih Reporter" />
                  </SelectTrigger>
                  <SelectContent>
                    {reporters.map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Fotografer</Label>
                <Select value={fotograferId} onValueChange={setFotograferId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih Fotografer" />
                  </SelectTrigger>
                  <SelectContent>
                    {fotografers.map((f) => (
                      <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Editor</Label>
                <Select value={editorId} onValueChange={setEditorId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih Editor" />
                  </SelectTrigger>
                  <SelectContent>
                    {editors.map((e) => (
                      <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator />

            <div className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <ArrowRight className="h-4 w-4" />
              Publisher
            </div>
          </div>
        )}

        {/* ── Skipped Steps Indicator (Fast Track only) ── */}
        {fastTrack && (
          <div className="rounded-lg bg-gray-50 border border-gray-200 p-4 space-y-2">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Langkah yang Dilewati
            </div>
            <div className="flex flex-wrap gap-2">
              {['Reporter', 'Fotografer', 'Editor'].map((step) => (
                <Badge
                  key={step}
                  variant="outline"
                  className="bg-purple-50 text-purple-600 border-purple-200 line-through decoration-purple-400"
                >
                  {step}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* ── Publisher Selection (always shown) ── */}
        <div className={`space-y-4 ${fastTrack ? '' : ''}`}>
          {!fastTrack && (
            <div className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <ArrowRight className="h-4 w-4" />
              Publisher
            </div>
          )}

          {fastTrack && (
            <div className="text-sm font-medium text-amber-700 flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Pilih Publisher (Fast Track)
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>
                Publisher Web
                {fastTrack && <span className="text-amber-500 ml-1">*</span>}
              </Label>
              <Select value={publisherWebId} onValueChange={setPublisherWebId}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih Publisher Web" />
                </SelectTrigger>
                <SelectContent>
                  {publishersWeb.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>
                Publisher Social Media
                {fastTrack && <span className="text-amber-500 ml-1">*</span>}
              </Label>
              <Select value={publisherSocialId} onValueChange={setPublisherSocialId}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih Publisher Social Media" />
                </SelectTrigger>
                <SelectContent>
                  {publishersSocial.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {fastTrack && !publisherWebId && !publisherSocialId && (
            <Alert variant="destructive" className="py-2">
              <AlertDescription className="text-xs">
                Fast Track: Pilih minimal satu Publisher (Web atau Social Media)
              </AlertDescription>
            </Alert>
          )}
        </div>

        {/* ── Actions ── */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onCancel} disabled={submitting}>
            Batal
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!isValid || submitting}
            className={fastTrack ? 'bg-amber-600 hover:bg-amber-700 text-white' : ''}
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Menyimpan...
              </>
            ) : fastTrack ? (
              <>
                <Zap className="mr-2 h-4 w-4" />
                Buat Fast Track
              </>
            ) : (
              'Buat Permohonan'
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
