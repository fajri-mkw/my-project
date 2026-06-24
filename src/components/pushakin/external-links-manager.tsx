'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { useAppStore } from '@/lib/store'
import {
  ExternalLink,
  Loader2,
  Plus,
  Pencil,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Link2,
  X
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

// ============================================================================
// Types
// ============================================================================
interface ExternalLinkItem {
  id: string
  label: string
  url: string
  icon: string | null
  description: string | null
  isActive: boolean
  order: number
}

interface NewLinkForm {
  label: string
  url: string
  description: string
}

// ============================================================================
// Component
// ============================================================================
export function ExternalLinksManager() {
  const { currentUser, showAlert, showConfirm } = useAppStore()
  const [links, setLinks] = useState<ExternalLinkItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form state for creating a new link
  const [form, setForm] = useState<NewLinkForm>({
    label: '',
    url: '',
    description: ''
  })

  // Edit modal state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<NewLinkForm>({
    label: '',
    url: '',
    description: ''
  })

  // ===========================================================================
  // Fetch all links (active + inactive) — admin-only endpoint
  // ===========================================================================
  const loadLinks = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/external-links?all=true&adminUserId=${encodeURIComponent(currentUser?.id || '')}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Gagal memuat daftar link')
      }
      const data = await res.json()
      setLinks(Array.isArray(data.links) ? data.links : [])
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Gagal memuat daftar link'
      setError(msg)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (currentUser?.role === 'Admin') {
      loadLinks()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser])

  // ===========================================================================
  // URL validation (must be http/https)
  // ===========================================================================
  function isValidUrl(value: string): boolean {
    if (!value) return false
    try {
      const u = new URL(value)
      return u.protocol === 'http:' || u.protocol === 'https:'
    } catch {
      return false
    }
  }

  // ===========================================================================
  // Create new link
  // ===========================================================================
  const handleCreate = async () => {
    setError(null)
    if (!form.label.trim()) {
      setError('Nama link wajib diisi')
      return
    }
    if (!isValidUrl(form.url.trim())) {
      setError('URL tidak valid. Gunakan format http:// atau https://')
      return
    }
    setIsSaving(true)
    try {
      const res = await fetch('/api/external-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminUserId: currentUser?.id,
          label: form.label.trim(),
          url: form.url.trim(),
          description: form.description.trim() || undefined
        })
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Gagal menambahkan link')
      }
      setForm({ label: '', url: '', description: '' })
      showAlert('Link eksternal berhasil ditambahkan!')
      await loadLinks()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menambahkan link')
    } finally {
      setIsSaving(false)
    }
  }

  // ===========================================================================
  // Toggle active state (immediate save)
  // ===========================================================================
  const handleToggleActive = async (link: ExternalLinkItem, nextActive: boolean) => {
    // Optimistic update for snappy UI
    setLinks(prev => prev.map(l => l.id === link.id ? { ...l, isActive: nextActive } : l))
    try {
      const res = await fetch('/api/external-links', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminUserId: currentUser?.id,
          id: link.id,
          isActive: nextActive
        })
      })
      if (!res.ok) {
        // Revert on failure
        setLinks(prev => prev.map(l => l.id === link.id ? { ...l, isActive: link.isActive } : l))
        const err = await res.json().catch(() => ({}))
        showAlert(err.error || 'Gagal mengubah status link')
      } else {
        showAlert(nextActive
          ? `Link "${link.label}" diaktifkan — sekarang terlihat oleh semua user.`
          : `Link "${link.label}" dinonaktifkan — tidak terlihat di halaman user.`
        )
      }
    } catch {
      setLinks(prev => prev.map(l => l.id === link.id ? { ...l, isActive: link.isActive } : l))
      showAlert('Terjadi kesalahan saat mengubah status link')
    }
  }

  // ===========================================================================
  // Open edit modal
  // ===========================================================================
  const openEdit = (link: ExternalLinkItem) => {
    setEditingId(link.id)
    setEditForm({
      label: link.label,
      url: link.url,
      description: link.description || ''
    })
  }

  const closeEdit = () => {
    setEditingId(null)
    setEditForm({ label: '', url: '', description: '' })
  }

  // ===========================================================================
  // Save edit
  // ===========================================================================
  const handleSaveEdit = async () => {
    if (!editingId) return
    setError(null)
    if (!editForm.label.trim()) {
      setError('Nama link wajib diisi')
      return
    }
    if (!isValidUrl(editForm.url.trim())) {
      setError('URL tidak valid. Gunakan format http:// atau https://')
      return
    }
    setIsSaving(true)
    try {
      const res = await fetch('/api/external-links', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminUserId: currentUser?.id,
          id: editingId,
          label: editForm.label.trim(),
          url: editForm.url.trim(),
          description: editForm.description.trim() || null
        })
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Gagal menyimpan perubahan')
      }
      showAlert('Perubahan berhasil disimpan!')
      closeEdit()
      await loadLinks()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan perubahan')
    } finally {
      setIsSaving(false)
    }
  }

  // ===========================================================================
  // Delete link (with confirm via store dialog)
  // ===========================================================================
  const handleDelete = (link: ExternalLinkItem) => {
    showConfirm(
      `Yakin ingin menghapus link "${link.label}"?\nTindakan ini tidak dapat dibatalkan.`,
      () => deleteLink(link)
    )
  }

  const deleteLink = async (link: ExternalLinkItem) => {
    // Optimistic removal
    const prevLinks = links
    setLinks(prev => prev.filter(l => l.id !== link.id))
    try {
      const res = await fetch(
        `/api/external-links?id=${encodeURIComponent(link.id)}&adminUserId=${encodeURIComponent(currentUser?.id || '')}`,
        { method: 'DELETE' }
      )
      if (!res.ok) {
        // Revert
        setLinks(prevLinks)
        const err = await res.json().catch(() => ({}))
        showAlert(err.error || 'Gagal menghapus link')
      } else {
        showAlert(`Link "${link.label}" berhasil dihapus.`)
      }
    } catch {
      setLinks(prevLinks)
      showAlert('Terjadi kesalahan saat menghapus link')
    }
  }

  // ===========================================================================
  // Render
  // ===========================================================================
  return (
    <Card>
      <CardHeader className="border-b border-stone-100">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-violet-100 to-purple-100 rounded-lg">
            <Link2 className="w-5 h-5 text-violet-600" />
          </div>
          <div className="flex-1">
            <CardTitle className="text-lg">Link Aplikasi Eksternal</CardTitle>
            <CardDescription>
              Tambahkan link aplikasi pendukung (galeri online, editor foto, dll.) yang akan
              tampil di sidebar semua user. Klik link akan terbuka di tab baru.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-6 space-y-6">
        {/* Info box */}
        <div className="p-4 bg-violet-50 border border-violet-200 rounded-xl text-sm text-violet-800">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Cara kerja</p>
              <ul className="mt-1 space-y-1 list-disc list-inside">
                <li>Link yang <strong>aktif</strong> akan tampil di sidebar <strong>semua user</strong>.</li>
                <li>Link yang <strong>nonaktif</strong> disembunyikan dari user (tidak dihapus).</li>
                <li>Link dibuka di <strong>tab baru</strong> sehingga user tetap berada di Pushakin Flows.</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Add new link form */}
        <div className="p-4 rounded-xl border-2 border-dashed border-stone-200 bg-stone-50/50 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-stone-700">
            <Plus className="w-4 h-4" />
            Tambah Link Baru
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-label" className="text-xs">Nama Link</Label>
              <Input
                id="new-label"
                value={form.label}
                onChange={(e) => setForm(prev => ({ ...prev, label: e.target.value }))}
                placeholder="Contoh: Galeri Online"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-url" className="text-xs">URL (https://...)</Label>
              <Input
                id="new-url"
                value={form.url}
                onChange={(e) => setForm(prev => ({ ...prev, url: e.target.value }))}
                placeholder="https://gallery.example.com"
                type="url"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-desc" className="text-xs">Deskripsi (Opsional — hanya untuk admin)</Label>
            <Textarea
              id="new-desc"
              value={form.description}
              onChange={(e) => setForm(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Catatan internal tentang link ini (tidak ditampilkan ke user)"
              rows={2}
            />
          </div>
          <div className="flex justify-end">
            <Button
              onClick={handleCreate}
              disabled={isSaving || !form.label.trim() || !form.url.trim()}
              className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 gap-2"
            >
              {isSaving ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Menyimpan...</>
              ) : (
                <><Plus className="w-4 h-4" /> Tambah Link</>
              )}
            </Button>
          </div>
        </div>

        {/* Existing links list */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-stone-700">
              Daftar Link ({links.length})
            </h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={loadLinks}
              disabled={isLoading}
              className="text-xs"
            >
              {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Muat ulang'}
            </Button>
          </div>

          {isLoading ? (
            <div className="p-8 text-center text-stone-500">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-stone-400" />
              <p className="text-sm">Memuat daftar link...</p>
            </div>
          ) : links.length === 0 ? (
            <div className="p-8 text-center text-stone-500 border border-dashed border-stone-200 rounded-xl">
              <Link2 className="w-8 h-8 mx-auto mb-2 text-stone-300" />
              <p className="text-sm">Belum ada link eksternal. Tambahkan link pertama di atas.</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {links.map((link) => {
                const isEditing = editingId === link.id
                return (
                  <div
                    key={link.id}
                    className={cn(
                      "p-3 sm:p-4 rounded-xl border transition-all",
                      link.isActive
                        ? "bg-white border-stone-200"
                        : "bg-stone-50 border-stone-200 opacity-70"
                    )}
                  >
                    {isEditing ? (
                      // ============================================================
                      // Inline edit form
                      // ============================================================
                      <div className="space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <Label className="text-xs">Nama Link</Label>
                            <Input
                              value={editForm.label}
                              onChange={(e) => setEditForm(prev => ({ ...prev, label: e.target.value }))}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">URL</Label>
                            <Input
                              value={editForm.url}
                              onChange={(e) => setEditForm(prev => ({ ...prev, url: e.target.value }))}
                              type="url"
                            />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Deskripsi (Opsional)</Label>
                          <Textarea
                            value={editForm.description}
                            onChange={(e) => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                            rows={2}
                          />
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={closeEdit} disabled={isSaving}>
                            <X className="w-3.5 h-3.5 mr-1" /> Batal
                          </Button>
                          <Button
                            size="sm"
                            onClick={handleSaveEdit}
                            disabled={isSaving}
                            className="bg-violet-600 hover:bg-violet-700 gap-1.5"
                          >
                            {isSaving ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            )}
                            Simpan
                          </Button>
                        </div>
                      </div>
                    ) : (
                      // ============================================================
                      // Read-only row
                      // ============================================================
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "p-2 rounded-lg flex-shrink-0",
                          link.isActive ? "bg-violet-100" : "bg-stone-100"
                        )}>
                          <ExternalLink className={cn(
                            "w-4 h-4",
                            link.isActive ? "text-violet-600" : "text-stone-400"
                          )} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-stone-800 truncate">{link.label}</span>
                            {link.isActive ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                                <CheckCircle2 className="w-2.5 h-2.5" /> AKTIF
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-stone-200 text-stone-600">
                                <XCircle className="w-2.5 h-2.5" /> NONAKTIF
                              </span>
                            )}
                          </div>
                          <a
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-stone-500 hover:text-violet-600 hover:underline truncate block max-w-full"
                            title={link.url}
                          >
                            {link.url}
                          </a>
                          {link.description && (
                            <p className="text-xs text-stone-400 mt-0.5 line-clamp-1">{link.description}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {/* Active toggle */}
                          <div className="flex items-center gap-1.5">
                            <Switch
                              checked={link.isActive}
                              onCheckedChange={(checked) => handleToggleActive(link, checked)}
                              aria-label={`Aktifkan link ${link.label}`}
                            />
                          </div>
                          {/* Edit button */}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-stone-500 hover:text-violet-600 hover:bg-violet-50"
                            onClick={() => openEdit(link)}
                            aria-label={`Edit link ${link.label}`}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          {/* Delete button */}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-stone-500 hover:text-red-600 hover:bg-red-50"
                            onClick={() => handleDelete(link)}
                            aria-label={`Hapus link ${link.label}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
