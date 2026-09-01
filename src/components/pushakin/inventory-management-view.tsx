'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import {
  Package, Plus, Search, Camera, Trash2, Pencil, Loader2,
  PackageCheck, PackageOpen, ClipboardList, History, Upload,
} from 'lucide-react'

// ============================================================================
// Manajemen Inventaris Humas — Super Admin only.
// Sistem manajemen barang humas (merchandise, brosur, hadiah, dll.) dengan
// peminjaman, pengembalian, pembagian, history, dan rekapitulasi.
// ============================================================================

interface InventoryItem {
  id: string
  kodeBarang: string
  namaBarang: string
  kategori: string
  jumlahTotal: number
  jumlahTersedia: number
  jumlahDipinjam: number
  jumlahDibagikan: number
  lokasi: string | null
  status: string
  kondisiCatatan: string | null
  imageFileId: string | null
  imageUrl: string | null
  catatan: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

const KATEGORI_OPTIONS = ['Merchandise', 'Brosur', 'Hadiah', 'ATK', 'Elektronik', 'Lainnya']
const STATUS_OPTIONS: Array<{ value: string; label: string; color: string }> = [
  { value: 'baik', label: 'Baik', color: 'bg-green-100 text-green-700 border-green-200' },
  { value: 'rusak', label: 'Rusak', color: 'bg-orange-100 text-orange-700 border-orange-200' },
  { value: 'hilang', label: 'Hilang', color: 'bg-red-100 text-red-700 border-red-200' },
]

function getStatusBadge(status: string) {
  const opt = STATUS_OPTIONS.find(s => s.value === status) || STATUS_OPTIONS[0]
  return <Badge className={cn('text-xs', opt.color)}>{opt.label}</Badge>
}

export function InventoryManagementView() {
  const { currentUser, showAlert } = useAppStore()
  const [items, setItems] = useState<InventoryItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterKategori, setFilterKategori] = useState<string>('all')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [activeTab, setActiveTab] = useState('barang')

  // Form state
  const [formData, setFormData] = useState({
    kodeBarang: '',
    namaBarang: '',
    kategori: 'Merchandise',
    jumlahTotal: 0,
    lokasi: '',
    status: 'baik',
    kondisiCatatan: '',
    catatan: '',
    imageUrl: '',
    imageFileId: '',
  })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isUploadingImage, setIsUploadingImage] = useState(false)

  // Fetch inventory items
  const fetchItems = useCallback(async () => {
    try {
      setIsLoading(true)
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (filterKategori !== 'all') params.set('kategori', filterKategori)
      if (filterStatus !== 'all') params.set('status', filterStatus)
      const response = await fetch(`/api/inventory?${params.toString()}`)
      if (response.ok) {
        const data = await response.json()
        setItems(Array.isArray(data) ? data : [])
      } else {
        setItems([])
      }
    } catch (error) {
      console.error('Failed to fetch inventory:', error)
      setItems([])
    } finally {
      setIsLoading(false)
    }
  }, [search, filterKategori, filterStatus])

  useEffect(() => {
    fetchItems()
  }, [fetchItems])

  // Open add dialog
  const openAddDialog = () => {
    setEditingItem(null)
    setFormData({
      kodeBarang: '',
      namaBarang: '',
      kategori: 'Merchandise',
      jumlahTotal: 1,
      lokasi: '',
      status: 'baik',
      kondisiCatatan: '',
      catatan: '',
      imageUrl: '',
      imageFileId: '',
    })
    setIsDialogOpen(true)
  }

  // Open edit dialog
  const openEditDialog = (item: InventoryItem) => {
    setEditingItem(item)
    setFormData({
      kodeBarang: item.kodeBarang,
      namaBarang: item.namaBarang,
      kategori: item.kategori,
      jumlahTotal: item.jumlahTotal,
      lokasi: item.lokasi || '',
      status: item.status,
      kondisiCatatan: item.kondisiCatatan || '',
      catatan: item.catatan || '',
      imageUrl: item.imageUrl || '',
      imageFileId: item.imageFileId || '',
    })
    setIsDialogOpen(true)
  }

  // Handle form submit
  const handleSubmit = async () => {
    if (!formData.kodeBarang || !formData.namaBarang || !formData.kategori) {
      showAlert('Kode, Nama, dan Kategori wajib diisi')
      return
    }
    setIsSaving(true)
    try {
      const payload = {
        ...formData,
        createdBy: currentUser?.id,
      }
      const url = editingItem
        ? `/api/inventory?id=${editingItem.id}`
        : '/api/inventory'
      const method = editingItem ? 'PUT' : 'POST'
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (response.ok) {
        const data = await response.json()
        showAlert(data.message || 'Barang berhasil disimpan')
        setIsDialogOpen(false)
        fetchItems()
      } else {
        const err = await response.json().catch(() => ({}))
        showAlert(err?.error || 'Gagal menyimpan barang')
      }
    } catch (error) {
      showAlert('Gagal menyimpan: ' + (error instanceof Error ? error.message : 'Unknown'))
    } finally {
      setIsSaving(false)
    }
  }

  // Handle delete
  const handleDelete = async (item: InventoryItem) => {
    if (!confirm(`Hapus barang "${item.namaBarang}"? Tindakan ini tidak dapat dibatalkan.`)) return
    try {
      const response = await fetch(`/api/inventory?id=${item.id}`, { method: 'DELETE' })
      if (response.ok) {
        showAlert('Barang berhasil dihapus')
        fetchItems()
      } else {
        showAlert('Gagal menghapus barang')
      }
    } catch (error) {
      showAlert('Gagal menghapus: ' + (error instanceof Error ? error.message : 'Unknown'))
    }
  }

  // Handle image upload (placeholder — full camera capture in next phase)
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setIsUploadingImage(true)
    try {
      // TODO: Phase 2 — implement camera capture + Drive upload via /api/inventory/upload-image
      // For now, just read as data URL for preview (will be replaced with Drive upload)
      const reader = new FileReader()
      reader.onload = () => {
        setFormData(prev => ({ ...prev, imageUrl: reader.result as string }))
      }
      reader.readAsDataURL(file)
      showAlert('Foto berhasil diunggah (preview). Upload ke Drive akan diaktifkan di tahap berikutnya.')
    } catch (error) {
      showAlert('Gagal mengunggah foto')
    } finally {
      setIsUploadingImage(false)
    }
  }

  // Stats
  const totalItems = items.length
  const totalTersedia = items.reduce((sum, i) => sum + i.jumlahTersedia, 0)
  const totalDipinjam = items.reduce((sum, i) => sum + i.jumlahDipinjam, 0)
  const totalDibagikan = items.reduce((sum, i) => sum + i.jumlahDibagikan, 0)
  const stokMenipis = items.filter(i => i.jumlahTersedia <= 2 && i.jumlahTersedia > 0)
  const stokHabis = items.filter(i => i.jumlahTersedia === 0)

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-stone-900 flex items-center gap-2">
            <Package className="w-6 h-6 text-violet-600" />
            Manajemen Inventaris
          </h1>
          <p className="text-sm text-stone-500 mt-1">
            Sistem manajemen barang humas — input, peminjaman, pengembalian, pembagian, dan rekapitulasi
          </p>
        </div>
        <Button onClick={openAddDialog} className="gap-2">
          <Plus className="w-4 h-4" />
          Tambah Barang
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Package className="w-5 h-5 text-violet-500" />
              <div>
                <p className="text-xs text-stone-500">Total Barang</p>
                <p className="text-2xl font-bold text-stone-900">{totalItems}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <PackageCheck className="w-5 h-5 text-green-500" />
              <div>
                <p className="text-xs text-stone-500">Tersedia</p>
                <p className="text-2xl font-bold text-green-700">{totalTersedia}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <PackageOpen className="w-5 h-5 text-orange-500" />
              <div>
                <p className="text-xs text-stone-500">Dipinjam</p>
                <p className="text-2xl font-bold text-orange-700">{totalDipinjam}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-blue-500" />
              <div>
                <p className="text-xs text-stone-500">Dibagikan</p>
                <p className="text-2xl font-bold text-blue-700">{totalDibagikan}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Stok warnings */}
      {(stokMenipis.length > 0 || stokHabis.length > 0) && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-sm">
          <div className="flex items-start gap-3">
            <Package className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">⚠️ Notifikasi Stok</p>
              {stokHabis.length > 0 && (
                <p className="mt-1">Stok habis ({stokHabis.length} barang): {stokHabis.map(i => i.namaBarang).join(', ')}</p>
              )}
              {stokMenipis.length > 0 && (
                <p className="mt-1">Stok menipis ({stokMenipis.length} barang): {stokMenipis.map(i => `${i.namaBarang} (${i.jumlahTersedia})`).join(', ')}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-3 md:grid-cols-5 w-full">
          <TabsTrigger value="barang" className="gap-1.5">
            <Package className="w-4 h-4" />
            <span className="hidden sm:inline">Barang</span>
          </TabsTrigger>
          <TabsTrigger value="peminjaman" className="gap-1.5">
            <PackageOpen className="w-4 h-4" />
            <span className="hidden sm:inline">Peminjaman</span>
          </TabsTrigger>
          <TabsTrigger value="pembagian" className="gap-1.5">
            <ClipboardList className="w-4 h-4" />
            <span className="hidden sm:inline">Pembagian</span>
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <History className="w-4 h-4" />
            <span className="hidden sm:inline">History</span>
          </TabsTrigger>
          <TabsTrigger value="rekapitulasi" className="gap-1.5">
            <PackageCheck className="w-4 h-4" />
            <span className="hidden sm:inline">Rekapitulasi</span>
          </TabsTrigger>
        </TabsList>

        {/* ===== Tab: Barang ===== */}
        <TabsContent value="barang" className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
              <Input
                placeholder="Cari nama atau kode barang..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={filterKategori} onValueChange={setFilterKategori}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Kategori" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Kategori</SelectItem>
                {KATEGORI_OPTIONS.map(k => (
                  <SelectItem key={k} value={k}>{k}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                {STATUS_OPTIONS.map(s => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Table */}
          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="flex items-center justify-center p-12">
                  <Loader2 className="w-6 h-6 animate-spin text-stone-400" />
                </div>
              ) : items.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-12 text-stone-400">
                  <Package className="w-12 h-12 mb-2" />
                  <p className="text-sm">Belum ada barang inventaris</p>
                  <Button variant="outline" size="sm" className="mt-3 gap-1" onClick={openAddDialog}>
                    <Plus className="w-4 h-4" /> Tambah Barang Pertama
                  </Button>
                </div>
              ) : (
                <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-stone-50 sticky top-0 z-10">
                      <tr className="border-b border-stone-200">
                        <th className="text-left p-3 font-semibold text-stone-700">Foto</th>
                        <th className="text-left p-3 font-semibold text-stone-700">Kode</th>
                        <th className="text-left p-3 font-semibold text-stone-700">Nama Barang</th>
                        <th className="text-left p-3 font-semibold text-stone-700 hidden md:table-cell">Kategori</th>
                        <th className="text-center p-3 font-semibold text-stone-700">Total</th>
                        <th className="text-center p-3 font-semibold text-stone-700">Tersedia</th>
                        <th className="text-center p-3 font-semibold text-stone-700 hidden sm:table-cell">Dipinjam</th>
                        <th className="text-center p-3 font-semibold text-stone-700 hidden sm:table-cell">Dibagikan</th>
                        <th className="text-center p-3 font-semibold text-stone-700">Status</th>
                        <th className="text-left p-3 font-semibold text-stone-700 hidden md:table-cell">Lokasi</th>
                        <th className="text-center p-3 font-semibold text-stone-700">Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(item => (
                        <tr key={item.id} className="border-b border-stone-100 hover:bg-stone-50">
                          <td className="p-3">
                            {item.imageUrl ? (
                              <img
                                src={item.imageUrl}
                                alt={item.namaBarang}
                                className="w-10 h-10 rounded-lg object-cover border border-stone-200"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-lg bg-stone-100 flex items-center justify-center">
                                <Package className="w-5 h-5 text-stone-300" />
                              </div>
                            )}
                          </td>
                          <td className="p-3 font-mono text-xs text-stone-600">{item.kodeBarang}</td>
                          <td className="p-3 font-medium text-stone-800">{item.namaBarang}</td>
                          <td className="p-3 hidden md:table-cell">
                            <Badge variant="outline" className="text-xs">{item.kategori}</Badge>
                          </td>
                          <td className="p-3 text-center font-semibold">{item.jumlahTotal}</td>
                          <td className="p-3 text-center">
                            <span className={cn(
                              "font-bold",
                              item.jumlahTersedia === 0 ? "text-red-600" :
                              item.jumlahTersedia <= 2 ? "text-orange-600" : "text-green-600"
                            )}>
                              {item.jumlahTersedia}
                            </span>
                          </td>
                          <td className="p-3 text-center hidden sm:table-cell text-orange-600">{item.jumlahDipinjam}</td>
                          <td className="p-3 text-center hidden sm:table-cell text-blue-600">{item.jumlahDibagikan}</td>
                          <td className="p-3 text-center">{getStatusBadge(item.status)}</td>
                          <td className="p-3 hidden md:table-cell text-stone-500 text-xs">{item.lokasi || '—'}</td>
                          <td className="p-3">
                            <div className="flex items-center justify-center gap-1">
                              <Button
                                variant="ghost" size="sm"
                                className="h-7 w-7 p-0"
                                onClick={() => openEditDialog(item)}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                variant="ghost" size="sm"
                                className="h-7 w-7 p-0 text-red-600 hover:text-red-700"
                                onClick={() => handleDelete(item)}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== Tab: Peminjaman (placeholder — next phase) ===== */}
        <TabsContent value="peminjaman">
          <Card>
            <CardContent className="p-8 text-center text-stone-400">
              <PackageOpen className="w-12 h-12 mx-auto mb-3" />
              <p className="text-sm font-medium">Sistem Peminjaman</p>
              <p className="text-xs mt-1">Fitur ini akan diaktifkan di tahap berikutnya</p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== Tab: Pembagian (placeholder — next phase) ===== */}
        <TabsContent value="pembagian">
          <Card>
            <CardContent className="p-8 text-center text-stone-400">
              <ClipboardList className="w-12 h-12 mx-auto mb-3" />
              <p className="text-sm font-medium">Sistem Pembagian</p>
              <p className="text-xs mt-1">Fitur ini akan diaktifkan di tahap berikutnya</p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== Tab: History (placeholder — next phase) ===== */}
        <TabsContent value="history">
          <Card>
            <CardContent className="p-8 text-center text-stone-400">
              <History className="w-12 h-12 mx-auto mb-3" />
              <p className="text-sm font-medium">History & Transaksi</p>
              <p className="text-xs mt-1">Fitur ini akan diaktifkan di tahap berikutnya</p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== Tab: Rekapitulasi (placeholder — next phase) ===== */}
        <TabsContent value="rekapitulasi">
          <Card>
            <CardContent className="p-8 text-center text-stone-400">
              <PackageCheck className="w-12 h-12 mx-auto mb-3" />
              <p className="text-sm font-medium">Rekapitulasi & Laporan</p>
              <p className="text-xs mt-1">Fitur ini akan diaktifkan di tahap berikutnya</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ===== Dialog: Add/Edit Barang ===== */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingItem ? 'Edit Barang' : 'Tambah Barang Baru'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Photo upload */}
            <div className="flex items-center gap-4">
              <div className="w-24 h-24 rounded-xl border-2 border-dashed border-stone-300 flex items-center justify-center overflow-hidden bg-stone-50">
                {formData.imageUrl ? (
                  <img src={formData.imageUrl} alt="Preview" className="w-full h-full object-cover" />
                ) : (
                  <Package className="w-10 h-10 text-stone-300" />
                )}
              </div>
              <div className="flex-1">
                <Label className="text-sm font-medium">Foto Barang</Label>
                <p className="text-xs text-stone-500 mb-2">
                  Ambil foto dengan kamera atau upload file
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button" variant="outline" size="sm"
                    className="gap-1.5"
                    disabled={isUploadingImage}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {isUploadingImage ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Camera className="w-4 h-4" />
                    )}
                    <span>Ambil / Upload Foto</span>
                  </Button>
                  {formData.imageUrl && (
                    <Button
                      type="button" variant="ghost" size="sm"
                      className="text-red-600"
                      onClick={() => setFormData(prev => ({ ...prev, imageUrl: '', imageFileId: '' }))}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={handleImageUpload}
                />
              </div>
            </div>

            {/* Form fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="kodeBarang">Kode Barang *</Label>
                <Input
                  id="kodeBarang"
                  required
                  value={formData.kodeBarang}
                  onChange={(e) => setFormData(prev => ({ ...prev, kodeBarang: e.target.value }))}
                  placeholder="Mis. MCH-001"
                />
              </div>
              <div>
                <Label htmlFor="namaBarang">Nama Barang *</Label>
                <Input
                  id="namaBarang"
                  required
                  value={formData.namaBarang}
                  onChange={(e) => setFormData(prev => ({ ...prev, namaBarang: e.target.value }))}
                  placeholder="Mis. Tumbler Pushakin Flows"
                />
              </div>
              <div>
                <Label htmlFor="kategori">Kategori *</Label>
                <Select
                  value={formData.kategori}
                  onValueChange={(v) => setFormData(prev => ({ ...prev, kategori: v }))}
                >
                  <SelectTrigger id="kategori">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KATEGORI_OPTIONS.map(k => (
                      <SelectItem key={k} value={k}>{k}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="jumlahTotal">Jumlah Total</Label>
                <Input
                  id="jumlahTotal"
                  type="number"
                  min={0}
                  value={formData.jumlahTotal}
                  onChange={(e) => setFormData(prev => ({ ...prev, jumlahTotal: Number(e.target.value) }))}
                />
              </div>
              <div>
                <Label htmlFor="lokasi">Lokasi</Label>
                <Input
                  id="lokasi"
                  value={formData.lokasi}
                  onChange={(e) => setFormData(prev => ({ ...prev, lokasi: e.target.value }))}
                  placeholder="Mis. Gudang Humas Lantai 2"
                />
              </div>
              <div>
                <Label htmlFor="status">Status</Label>
                <Select
                  value={formData.status}
                  onValueChange={(v) => setFormData(prev => ({ ...prev, status: v }))}
                >
                  <SelectTrigger id="status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map(s => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="kondisiCatatan">Catatan Kondisi</Label>
              <Input
                id="kondisiCatatan"
                value={formData.kondisiCatatan}
                onChange={(e) => setFormData(prev => ({ ...prev, kondisiCatatan: e.target.value }))}
                placeholder="Mis. Handle ada retak kecil"
              />
            </div>

            <div>
              <Label htmlFor="catatan">Catatan Tambahan</Label>
              <Textarea
                id="catatan"
                rows={2}
                value={formData.catatan}
                onChange={(e) => setFormData(prev => ({ ...prev, catatan: e.target.value }))}
                placeholder="Catatan lain..."
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isSaving}>
              Batal
            </Button>
            <Button onClick={handleSubmit} disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Menyimpan...
                </>
              ) : editingItem ? 'Update Barang' : 'Tambah Barang'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
