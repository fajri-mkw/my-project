'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Package, Plus, Search, Camera, Trash2, Pencil, Loader2, PackageCheck, PackageOpen, ClipboardList, History, CheckCircle2, XCircle, ArrowLeftRight, FileText, Download, ArrowUpDown } from 'lucide-react'
import { loadJsPDF, loadXLSX } from '@/lib/export-utils'

interface InventoryItem { id: string; kodeBarang: string; namaBarang: string; kategori: string; jumlahTotal: number; jumlahTersedia: number; jumlahDipinjam: number; jumlahDibagikan: number; lokasi: string | null; pengguna: string | null; penanggungJawab: string | null; sumberPengadaan: string | null; tahunPengadaan: number | null; status: string; kondisiCatatan: string | null; imageFileId: string | null; imageUrl: string | null; catatan: string | null; createdAt: string; updatedAt: string }
interface Loan { id: string; inventoryId: string; peminjamName: string; peminjamId: string | null; peminjamUnit: string | null; peminjamPhone: string | null; loanGroupId: string | null; tanggalPinjam: string; tanggalKembaliRencana: string | null; tanggalKembaliAktual: string | null; jumlahDipinjam: number; status: string; keperluan: string | null; catatan: string | null; rejectedReason: string | null; kodeBarang: string; namaBarang: string; kategori: string }
interface Distribution { id: string; inventoryId: string; penerimaName: string; penerimaUnit: string | null; jumlahDibagikan: number; tanggalBagi: string; keperluan: string | null; catatan: string | null; kodeBarang: string; namaBarang: string; kategori: string }
interface HistoryEntry { id: string; inventoryId: string; jenisTransaksi: string; tanggalTransaksi: string; pelakuName: string | null; keterangan: string | null; jumlah: number | null; kodeBarang: string; namaBarang: string }

const KATEGORI_OPTIONS = ['Elektronik', 'Kalender', 'Plakat', 'Furniture', 'ATK', 'Merchandise', 'Lainnya']

// Mapping kategori → prefix kode barang (3 huruf).
// Saat user pilih kategori di form "Tambah Barang", kode auto-generate dengan
// format [PREFIX]-[NOMOR URUT 3 digit]. Nomor urut didapat dari API dengan
// menghitung berapa barang yang sudah ada di kategori tersebut + 1.
// Contoh: Elektronik → ELE-001, Kalender → KAL-001, Plakat → PLK-001
const KATEGORI_PREFIX: Record<string, string> = {
  'Elektronik': 'ELE',
  'Kalender': 'KAL',
  'Plakat': 'PLK',
  'Furniture': 'FUR',
  'ATK': 'ATK',
  'Merchandise': 'MCH',
  'Lainnya': 'LAI',
}
const STATUS_OPTIONS = [{ value: 'baik', label: 'Baik', color: 'bg-green-100 text-green-700 border-green-200' }, { value: 'rusak', label: 'Rusak', color: 'bg-orange-100 text-orange-700 border-orange-200' }, { value: 'hilang', label: 'Hilang', color: 'bg-red-100 text-red-700 border-red-200' }]
const LOAN_STATUS_OPTIONS: Record<string, { label: string; color: string }> = { pending: { label: 'Menunggu', color: 'bg-amber-100 text-amber-700 border-amber-200' }, approved: { label: 'Disetujui', color: 'bg-blue-100 text-blue-700 border-blue-200' }, active: { label: 'Aktif', color: 'bg-orange-100 text-orange-700 border-orange-200' }, returned: { label: 'Dikembalikan', color: 'bg-green-100 text-green-700 border-green-200' }, rejected: { label: 'Ditolak', color: 'bg-red-100 text-red-700 border-red-200' }, overdue: { label: 'Terlambat', color: 'bg-red-100 text-red-700 border-red-200' } }
const KONDISI_OPTIONS = [{ value: 'baik', label: 'Baik' }, { value: 'rusak_ringan', label: 'Rusak Ringan' }, { value: 'rusak_berat', label: 'Rusak Berat' }, { value: 'hilang', label: 'Hilang' }]
const HISTORY_TYPES: Record<string, { label: string; color: string }> = { masuk: { label: 'Masuk', color: 'bg-green-100 text-green-700' }, pinjam: { label: 'Pinjam', color: 'bg-amber-100 text-amber-700' }, approval: { label: 'Approval', color: 'bg-blue-100 text-blue-700' }, reject: { label: 'Reject', color: 'bg-red-100 text-red-700' }, kembali: { label: 'Kembali', color: 'bg-teal-100 text-teal-700' }, bagi: { label: 'Bagi', color: 'bg-violet-100 text-violet-700' }, edit: { label: 'Edit', color: 'bg-stone-100 text-stone-700' } }

function getStatusBadge(status: string) { const o = STATUS_OPTIONS.find(s => s.value === status) || STATUS_OPTIONS[0]; return <Badge className={cn('text-xs', o.color)}>{o.label}</Badge> }
function getLoanStatusBadge(status: string) { const o = LOAN_STATUS_OPTIONS[status] || { label: status, color: 'bg-stone-100 text-stone-700' }; return <Badge className={cn('text-xs', o.color)}>{o.label}</Badge> }
function getHistoryBadge(type: string) { const o = HISTORY_TYPES[type] || { label: type, color: 'bg-stone-100 text-stone-700' }; return <Badge className={cn('text-xs', o.color)}>{o.label}</Badge> }
function formatDate(s: string | null) { if (!s) return '—'; const n = Number(s); const d = !isNaN(n) && n > 100000000000 ? new Date(n) : new Date(s); if (isNaN(d.getTime())) return s; return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
function formatShortDate(s: string | null) { if (!s) return '—'; const n = Number(s); const d = !isNaN(n) && n > 100000000000 ? new Date(n) : new Date(s); if (isNaN(d.getTime())) return s; return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) }

// Convert Google Drive URLs ke format yang bisa display di <img>.
// Format input: https://drive.google.com/open?id=XXX
// Format output: https://drive.google.com/thumbnail?id=XXX&sz=w400
// (thumbnail endpoint merender gambar langsung, bukan halaman Drive)
function driveImageUrl(url: string | null): string | null {
  if (!url) return null
  // Already a thumbnail or direct image URL — return as-is
  if (url.includes('thumbnail') || url.includes('lh3.googleusercontent.com')) return url
  // Convert open?id= → thumbnail?id=
  const idMatch = url.match(/[?&]id=([^&]+)/)
  if (idMatch) return `https://drive.google.com/thumbnail?id=${idMatch[1]}&sz=w400`
  // Convert /file/d/XXX/view → thumbnail
  const fileMatch = url.match(/\/file\/d\/([^/]+)/)
  if (fileMatch) return `https://drive.google.com/thumbnail?id=${fileMatch[1]}&sz=w400`
  return url
}

export function InventoryManagementView() {
  const { currentUser, showAlert } = useAppStore()
  const [activeTab, setActiveTab] = useState('barang')
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loans, setLoans] = useState<Loan[]>([])
  const [distributions, setDistributions] = useState<Distribution[]>([])
  const [histories, setHistories] = useState<HistoryEntry[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [filterKategori, setFilterKategori] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')

  const [isItemDialogOpen, setIsItemDialogOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isUploadingImage, setIsUploadingImage] = useState(false)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const webcamRef = useRef<HTMLVideoElement>(null)
  const webcamStreamRef = useRef<MediaStream | null>(null)
  const [isWebcamOpen, setIsWebcamOpen] = useState(false)
  const [webcamMode, setWebcamMode] = useState<'item' | 'loan'>('item')

  // Deteksi mobile: kalau mobile, pakai input capture. Kalau desktop, pakai
  // getUserMedia webcam (karena input capture di desktop hanya buka file manager).
  const isMobile = typeof window !== 'undefined' && (
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && window.innerWidth < 768)
  )

  // Buka kamera: mobile → input capture, desktop → getUserMedia webcam
  const openCamera = (mode: 'item' | 'loan' = 'item') => {
    setWebcamMode(mode)
    if (isMobile) {
      if (mode === 'loan') loanCameraInputRef.current?.click()
      else cameraInputRef.current?.click()
    } else {
      openWebcam()
    }
  }

  // Desktop webcam: buka video stream via getUserMedia
  const openWebcam = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
      webcamStreamRef.current = stream
      setIsWebcamOpen(true)
      // Set video src setelah dialog render
      setTimeout(() => {
        if (webcamRef.current) {
          webcamRef.current.srcObject = stream
          webcamRef.current.play()
        }
      }, 100)
    } catch (err) {
      showAlert('Tidak bisa mengakses kamera: ' + (err instanceof Error ? err.message : 'Permission denied'))
    }
  }

  // Capture foto dari webcam stream
  const captureWebcam = () => {
    if (!webcamRef.current) return
    const video = webcamRef.current
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth || 640
    canvas.height = video.videoHeight || 480
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob(async (blob) => {
      if (!blob) return
      closeWebcam()
      const file = new File([blob], `webcam-${Date.now()}.jpg`, { type: 'image/jpeg' })
      if (webcamMode === 'loan') {
        await uploadLoanPhotoFile(file)
      } else {
        await uploadImageFile(file)
      }
    }, 'image/jpeg', 0.9)
  }

  // Close webcam + stop stream
  const closeWebcam = () => {
    if (webcamStreamRef.current) {
      webcamStreamRef.current.getTracks().forEach(t => t.stop())
      webcamStreamRef.current = null
    }
    setIsWebcamOpen(false)
  }

  // Upload image file to Drive — for item photo (dipakai oleh gallery input + webcam capture)
  const uploadImageFile = async (file: File) => {
    setIsUploadingImage(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await fetch('/api/inventory/upload-image', { method: 'POST', body: fd })
      if (r.ok) {
        const d = await r.json()
        setFormData(prev => ({ ...prev, imageUrl: d.imageUrl, imageFileId: d.imageFileId }))
        showAlert('Foto berhasil diunggah ke Google Drive')
      } else {
        const reader = new FileReader()
        reader.onload = () => setFormData(prev => ({ ...prev, imageUrl: reader.result as string }))
        reader.readAsDataURL(file)
        showAlert('Foto disimpan sebagai preview (Drive upload gagal)')
      }
    } catch { showAlert('Gagal upload foto') } finally { setIsUploadingImage(false) }
  }

  // Upload image file to Drive — for loan borrower photo
  const uploadLoanPhotoFile = async (file: File) => {
    setIsUploadingLoanPhoto(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await fetch('/api/inventory/upload-image', { method: 'POST', body: fd })
      if (r.ok) {
        const d = await r.json()
        setLoanForm(p => ({ ...p, peminjamPhotoUrl: d.imageUrl, peminjamPhotoFileId: d.imageFileId }))
        showAlert('Foto peminjam berhasil diunggah')
      } else {
        const reader = new FileReader()
        reader.onload = () => setLoanForm(p => ({ ...p, peminjamPhotoUrl: reader.result as string }))
        reader.readAsDataURL(file)
        showAlert('Foto disimpan sebagai preview (Drive upload gagal)')
      }
    } catch { showAlert('Gagal upload foto') } finally { setIsUploadingLoanPhoto(false) }
  }

  const [formData, setFormData] = useState({ kodeBarang: '', namaBarang: '', kategori: 'Merchandise', jumlahTotal: 1, lokasi: '', pengguna: '', penanggungJawab: '', sumberPengadaan: '', tahunPengadaan: '', status: 'baik', catatan: '', imageUrl: '', imageFileId: '' })

  // Loan dialog
  const [isLoanDialogOpen, setIsLoanDialogOpen] = useState(false)
  const [loanForm, setLoanForm] = useState({ peminjamName: '', peminjamUnit: '', peminjamPhone: '', tanggalKembaliRencana: '', keperluan: '', catatan: '', peminjamPhotoUrl: '', peminjamPhotoFileId: '' })
  const [loanItems, setLoanItems] = useState<Array<{ inventoryId: string; jumlahDipinjam: number }>>([])
  const [isLoanSaving, setIsLoanSaving] = useState(false)
  const [isUploadingLoanPhoto, setIsUploadingLoanPhoto] = useState(false)
  const loanCameraInputRef = useRef<HTMLInputElement>(null)
  const loanGalleryInputRef = useRef<HTMLInputElement>(null)
  const [loanTemplates, setLoanTemplates] = useState<string[]>([])
  const [showTemplateDropdown, setShowTemplateDropdown] = useState(false)
  const [printLoanGroupId, setPrintLoanGroupId] = useState<string | null>(null)
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<Set<string>>(new Set())
  const [isDeletingHistory, setIsDeletingHistory] = useState(false)

  // Rekapitulasi filter + sort state
  const [rekapFilterKategori, setRekapFilterKategori] = useState('all')
  const [rekapFilterStatus, setRekapFilterStatus] = useState('all')
  const [rekapSortBy, setRekapSortBy] = useState<'namaBarang' | 'kodeBarang' | 'kategori' | 'jumlahTersedia' | 'jumlahTotal' | 'status' | 'tahunPengadaan' | 'updatedAt'>('updatedAt')
  const [rekapSortAsc, setRekapSortAsc] = useState(false)
  const [rekapSearch, setRekapSearch] = useState('')
  const [isExporting, setIsExporting] = useState(false)

  // Filtered + sorted items for rekapitulasi
  const rekapFiltered = (() => {
    let result = [...items]
    if (rekapFilterKategori !== 'all') result = result.filter(i => i.kategori === rekapFilterKategori)
    if (rekapFilterStatus !== 'all') result = result.filter(i => i.status === rekapFilterStatus)
    if (rekapSearch.trim()) {
      const q = rekapSearch.toLowerCase().trim()
      result = result.filter(i => i.namaBarang.toLowerCase().includes(q) || i.kodeBarang.toLowerCase().includes(q) || (i.lokasi || '').toLowerCase().includes(q))
    }
    result.sort((a, b) => {
      let cmp = 0
      const av = a[rekapSortBy]; const bv = b[rekapSortBy]
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv
      else cmp = String(av ?? '').localeCompare(String(bv ?? ''))
      return rekapSortAsc ? cmp : -cmp
    })
    return result
  })()

  // Export Excel (lazy load xlsx library)
  const exportExcel = async () => {
    setIsExporting(true)
    try {
      const XLSX = await loadXLSX()
      const data = rekapFiltered.map(i => ({
        'Kode': i.kodeBarang,
        'Nama Barang': i.namaBarang,
        'Kategori': i.kategori,
        'Jumlah Total': i.jumlahTotal,
        'Tersedia': i.jumlahTersedia,
        'Dipinjam': i.jumlahDipinjam,
        'Dibagikan': i.jumlahDibagikan,
        'Status': i.status === 'baik' ? 'Baik' : i.status === 'rusak' ? 'Rusak' : 'Hilang',
        'Lokasi/Pengguna/PIC': i.lokasi || '',
        'Sumber Pengadaan': i.sumberPengadaan || '',
        'Tahun Pengadaan': i.tahunPengadaan || '',
        'Catatan': i.catatan || '',
      }))
      const ws = XLSX.utils.json_to_sheet(data)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Rekap Inventaris')
      XLSX.writeFile(wb, `Rekap-Inventaris-${new Date().toISOString().slice(0,10)}.xlsx`)
      showAlert('Excel berhasil di-download.')
    } catch (err) {
      showAlert('Gagal export Excel: ' + (err instanceof Error ? err.message : 'Unknown'))
    } finally {
      setIsExporting(false)
    }
  }

  // Export PDF (jsPDF with table)
  const exportPDF = async () => {
    setIsExporting(true)
    try {
      const { jsPDF } = await loadJsPDF()
      const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
      const pageW = 297; const margin = 10
      let y = 15

      // Header
      doc.setFontSize(14); doc.setFont('helvetica', 'bold')
      doc.text('REKAPITULASI INVENTARIS', pageW / 2, y, { align: 'center' })
      y += 6
      doc.setFontSize(9); doc.setFont('helvetica', 'normal')
      doc.text(`Pusat Hubungan Masyarakat dan Keterbukaan Informasi`, pageW / 2, y, { align: 'center' })
      y += 4
      doc.text(`Filter: Kategori=${rekapFilterKategori === 'all' ? 'Semua' : rekapFilterKategori}, Status=${rekapFilterStatus === 'all' ? 'Semua' : rekapFilterStatus} | ${rekapFiltered.length} barang | ${new Date().toLocaleDateString('id-ID')}`, pageW / 2, y, { align: 'center' })
      y += 8

      // Table header
      const cols = ['Kode', 'Nama Barang', 'Kategori', 'Total', 'Tersedia', 'Dipinjam', 'Dibagikan', 'Status', 'Tahun']
      const colW = [22, 60, 30, 15, 18, 18, 20, 20, 18]
      let cx = margin
      doc.setFillColor(240, 240, 238)
      doc.rect(margin, y - 4, colW.reduce((a, b) => a + b, 0), 6, 'F')
      doc.setFontSize(8); doc.setFont('helvetica', 'bold')
      cols.forEach((c, i) => { doc.text(c, cx + 1, y); cx += colW[i] })
      y += 6

      // Data rows
      doc.setFont('helvetica', 'normal')
      rekapFiltered.forEach((item, idx) => {
        if (y > 200) { doc.addPage(); y = 15 }
        cx = margin
        const rowData = [item.kodeBarang, item.namaBarang, item.kategori, String(item.jumlahTotal), String(item.jumlahTersedia), String(item.jumlahDipinjam), String(item.jumlahDibagikan), item.status, String(item.tahunPengadaan || '—')]
        rowData.forEach((v, i) => { doc.text(String(v).substring(0, 25), cx + 1, y, { maxWidth: colW[i] - 1 }); cx += colW[i] })
        doc.setDrawColor(220); doc.line(margin, y + 1.5, margin + colW.reduce((a, b) => a + b, 0), y + 1.5)
        y += 5
      })

      doc.save(`Rekap-Inventaris-${new Date().toISOString().slice(0,10)}.pdf`)
      showAlert('PDF berhasil di-download.')
    } catch (err) {
      showAlert('Gagal export PDF: ' + (err instanceof Error ? err.message : 'Unknown'))
    } finally {
      setIsExporting(false)
    }
  }

  // Return dialog
  const [returnLoanId, setReturnLoanId] = useState<string | null>(null)
  const [returnForm, setReturnForm] = useState({ kondisi: 'baik', catatan: '' })

  // Distribution dialog
  const [isDistDialogOpen, setIsDistDialogOpen] = useState(false)
  const [distForm, setDistForm] = useState({ inventoryId: '', penerimaName: '', penerimaUnit: '', jumlahDibagikan: 1, keperluan: '', catatan: '' })
  const [isDistSaving, setIsDistSaving] = useState(false)

  // Reject dialog
  const [rejectLoanId, setRejectLoanId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  // Fetch functions
  const fetchItems = useCallback(async () => {
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (filterKategori !== 'all') params.set('kategori', filterKategori)
    if (filterStatus !== 'all') params.set('status', filterStatus)
    const r = await fetch(`/api/inventory?${params}`)
    if (r.ok) setItems(await r.json())
  }, [search, filterKategori, filterStatus])

  const fetchLoans = useCallback(async () => {
    const r = await fetch(`/api/inventory/loans?_t=${Date.now()}`)
    if (r.ok) setLoans(await r.json())
  }, [])

  const fetchDistributions = useCallback(async () => {
    const r = await fetch(`/api/inventory/distributions?_t=${Date.now()}`)
    if (r.ok) setDistributions(await r.json())
  }, [])

  const fetchHistories = useCallback(async () => {
    const r = await fetch(`/api/inventory/history?limit=200&_t=${Date.now()}`)
    if (r.ok) setHistories(await r.json())
  }, [])

  // Load all on mount (no polling — on-demand only)
  useEffect(() => {
    setIsLoading(true)
    Promise.all([fetchItems(), fetchLoans(), fetchDistributions(), fetchHistories()]).finally(() => setIsLoading(false))
  }, [])

  // Re-fetch items when filters change (debounced by search input)
  useEffect(() => { const t = setTimeout(fetchItems, 300); return () => clearTimeout(t) }, [search, filterKategori, filterStatus])

  // Item CRUD handlers
  // Auto-generate kode barang berdasarkan kategori.
  // Format: [PREFIX]-[NOMOR URUT 3 digit], mis. ELE-001, KAL-003.
  // Nomor urut = count barang di kategori tsb + 1 (dihitung dari items yang
  // sudah di-load di state — tidak butuh API call tambahan).
  const generateKodeBarang = (kategori: string): string => {
    const prefix = KATEGORI_PREFIX[kategori] || 'INV'
    const existingInKategori = items.filter(i => i.kategori === kategori)
    const nextNum = existingInKategori.length + 1
    return `${prefix}-${String(nextNum).padStart(3, '0')}`
  }

  // Handler saat user ganti kategori di form tambah — auto-update kodeBarang
  // Hanya untuk ADD (bukan edit — edit pakai kode yang sudah ada).
  const handleKategoriChange = (kategori: string) => {
    setFormData(prev => ({
      ...prev,
      kategori,
      // Hanya auto-generate kalau ini add baru (bukan edit) atau kalau kode
      // masih kosong / masih auto-generated (mulai dengan prefix yang dikenal).
      // Saat edit, jangan override kode yang user sudah mungkin ubah manual.
      ...(editingItem ? {} : { kodeBarang: generateKodeBarang(kategori) }),
    }))
  }

  const openAddDialog = () => {
    setEditingItem(null)
    const defaultKategori = 'Elektronik'
    setFormData({
      kodeBarang: generateKodeBarang(defaultKategori),
      namaBarang: '', kategori: defaultKategori, jumlahTotal: 1,
      lokasi: '', pengguna: '', penanggungJawab: '', sumberPengadaan: '', tahunPengadaan: '', status: 'baik', catatan: '',
      imageUrl: '', imageFileId: '',
    })
    setIsItemDialogOpen(true)
  }
  const openEditDialog = (item: InventoryItem) => { setEditingItem(item); setFormData({ kodeBarang: item.kodeBarang, namaBarang: item.namaBarang, kategori: item.kategori, jumlahTotal: item.jumlahTotal, lokasi: item.lokasi || '', pengguna: item.pengguna || '', penanggungJawab: item.penanggungJawab || '', sumberPengadaan: item.sumberPengadaan || '', tahunPengadaan: item.tahunPengadaan != null ? String(item.tahunPengadaan) : '', status: item.status, catatan: item.catatan || '', imageUrl: item.imageUrl || '', imageFileId: item.imageFileId || '' }); setIsItemDialogOpen(true) }

  const handleSubmit = async () => {
    if (!formData.kodeBarang || !formData.namaBarang || !formData.kategori) { showAlert('Kode, Nama, dan Kategori wajib diisi'); return }
    setIsSaving(true)
    try {
      const payload = { ...formData, createdBy: currentUser?.id }
      const url = editingItem ? `/api/inventory?id=${editingItem.id}` : '/api/inventory'
      const method = editingItem ? 'PUT' : 'POST'
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (r.ok) { const d = await r.json(); showAlert(d.message || 'Berhasil'); setIsItemDialogOpen(false); fetchItemsFresh(); fetchHistories() }
      else { const e = await r.json().catch(() => ({})); showAlert(e?.error || 'Gagal') }
    } catch { showAlert('Gagal menyimpan') } finally { setIsSaving(false) }
  }

  const handleDelete = async (item: InventoryItem) => {
    if (!confirm(`Hapus barang "${item.namaBarang}"?`)) return
    try { const r = await fetch(`/api/inventory?id=${item.id}`, { method: 'DELETE' }); if (r.ok) { showAlert("Barang dihapus"); fetchItemsFresh() } else showAlert('Gagal hapus') } catch { showAlert('Gagal') }
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await uploadImageFile(file)
    // Reset input supaya bisa upload file yang sama lagi
    e.target.value = ''
  }

  // Loan handlers
  // Load catatan templates from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('inventory_loan_templates')
      if (saved) setLoanTemplates(JSON.parse(saved))
    } catch {}
  }, [])

  // Save current catatan as template
  const saveTemplate = () => {
    if (!loanForm.catatan.trim()) { showAlert('Catatan kosong, tidak bisa disimpan sebagai template'); return }
    const updated = [...loanTemplates, loanForm.catatan]
    setLoanTemplates(updated)
    try { localStorage.setItem('inventory_loan_templates', JSON.stringify(updated)) } catch {}
    showAlert('Template catatan berhasil disimpan')
  }

  // Delete template by index
  const deleteTemplate = (idx: number) => {
    const updated = loanTemplates.filter((_, i) => i !== idx)
    setLoanTemplates(updated)
    try { localStorage.setItem('inventory_loan_templates', JSON.stringify(updated)) } catch {}
  }

  // Upload foto peminjam
  const handleLoanPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await uploadLoanPhotoFile(file)
    e.target.value = ''
  }

  const openLoanDialog = (item?: InventoryItem) => {
    setLoanForm({ peminjamName: '', peminjamUnit: '', peminjamPhone: '', tanggalKembaliRencana: '', keperluan: '', catatan: '', peminjamPhotoUrl: '', peminjamPhotoFileId: '' })
    setLoanItems(item ? [{ inventoryId: item.id, jumlahDipinjam: 1 }] : [])
    setIsLoanDialogOpen(true)
  }
  const handleLoanSubmit = async () => {
    if (loanItems.length === 0) { showAlert('Pilih minimal 1 barang'); return }
    if (!loanForm.peminjamName) { showAlert('Nama peminjam wajib diisi'); return }
    setIsLoanSaving(true)
    try {
      const r = await fetch('/api/inventory/loans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: loanItems, ...loanForm }) })
      if (r.ok) { const d = await r.json(); showAlert(d.message || 'Permintaan dibuat'); setIsLoanDialogOpen(false); fetchLoans(); fetchHistories() }
      else { const e = await r.json().catch(() => ({})); showAlert(e?.error || 'Gagal') }
    } catch { showAlert('Gagal') } finally { setIsLoanSaving(false) }
  }
  const addLoanItem = () => { setLoanItems(prev => [...prev, { inventoryId: '', jumlahDipinjam: 1 }]) }
  const removeLoanItem = (idx: number) => { setLoanItems(prev => prev.filter((_, i) => i !== idx)) }
  const updateLoanItem = (idx: number, field: 'inventoryId' | 'jumlahDipinjam', value: string | number) => { setLoanItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: field === 'jumlahDipinjam' ? Number(value) : value } : it)) }
  const handleLoanAction = async (loanId: string, action: string, extra?: Record<string, string>) => {
    try {
      const body: Record<string, string> = { loanId, action, approverId: currentUser?.id || '', ...extra }
      const r = await fetch('/api/inventory/loans', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (r.ok) { const d = await r.json(); showAlert(d.message || 'Berhasil'); fetchLoans(); fetchItemsFresh(); fetchHistories() }
      else { const e = await r.json().catch(() => ({})); showAlert(e?.error || 'Gagal') }
    } catch { showAlert('Gagal') }
  }

  // Hapus peminjaman (hanya untuk status returned/rejected/pending)
  const handleDeleteLoan = async (loanId: string) => {
    if (!confirm('Hapus data peminjaman ini? Tindakan tidak dapat dibatalkan.')) return
    try {
      const r = await fetch(`/api/inventory/loans?id=${loanId}`, { method: 'DELETE' })
      if (r.ok) { showAlert('Peminjaman berhasil dihapus'); fetchLoans(); fetchItemsFresh(); fetchHistories() }
      else { const e = await r.json().catch(() => ({})); showAlert(e?.error || 'Gagal hapus') }
    } catch { showAlert('Gagal') }
  }

  // Hapus history entries yang dicentang
  const handleDeleteHistory = async () => {
    if (selectedHistoryIds.size === 0) return
    if (!confirm(`Hapus ${selectedHistoryIds.size} history terpilih? Tindakan tidak dapat dibatalkan.`)) return
    setIsDeletingHistory(true)
    try {
      const ids = Array.from(selectedHistoryIds).join(',')
      const r = await fetch(`/api/inventory/history?ids=${ids}`, { method: 'DELETE' })
      if (r.ok) {
        const d = await r.json()
        showAlert(d.message || 'History berhasil dihapus')
        setSelectedHistoryIds(new Set())
        fetchHistories()
      } else {
        const e = await r.json().catch(() => ({}))
        showAlert(e?.error || 'Gagal hapus history')
      }
    } catch { showAlert('Gagal') } finally { setIsDeletingHistory(false) }
  }

  // Fetch items dengan cache-buster untuk bypass browser cache setelah
  // perubahan (return/approve/distribution). Tambah _t=timestamp supaya
  // browser tidak pakai cached response yang mungkin stale.
  const fetchItemsFresh = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (filterKategori !== 'all') params.set('kategori', filterKategori)
      if (filterStatus !== 'all') params.set('status', filterStatus)
      params.set('_t', String(Date.now())) // cache-buster
      const response = await fetch(`/api/inventory?${params.toString()}`)
      if (response.ok) {
        const data = await response.json()
        setItems(Array.isArray(data) ? data : [])
      }
    } catch (error) {
      console.error('Failed to fetch inventory:', error)
    }
  }, [search, filterKategori, filterStatus])

  // Distribution handlers
  const openDistDialog = (item?: InventoryItem) => {
    setDistForm({ inventoryId: item?.id || '', penerimaName: '', penerimaUnit: '', jumlahDibagikan: 1, keperluan: '', catatan: '' })
    setIsDistDialogOpen(true)
  }
  const handleDistSubmit = async () => {
    if (!distForm.inventoryId || !distForm.penerimaName) { showAlert('Barang dan penerima wajib diisi'); return }
    setIsDistSaving(true)
    try {
      const r = await fetch('/api/inventory/distributions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...distForm, distribusiById: currentUser?.id }) })
      if (r.ok) { showAlert('Pembagian berhasil'); setIsDistDialogOpen(false); fetchDistributions(); fetchItemsFresh(); fetchHistories() }
      else { const e = await r.json().catch(() => ({})); showAlert(e?.error || 'Gagal') }
    } catch { showAlert('Gagal') } finally { setIsDistSaving(false) }
  }

  // Stats
  const totalItems = items.length
  const totalTersedia = items.reduce((s, i) => s + i.jumlahTersedia, 0)
  const totalDipinjam = items.reduce((s, i) => s + i.jumlahDipinjam, 0)
  const totalDibagikan = items.reduce((s, i) => s + i.jumlahDibagikan, 0)
  const stokHabis = items.filter(i => i.jumlahTersedia === 0)
  const pendingLoans = loans.filter(l => l.status === 'pending')
  const activeLoans = loans.filter(l => l.status === 'active')
  const overdueLoans = loans.filter(l => l.status === 'overdue')

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-4 sm:p-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-stone-900 flex items-center gap-2"><Package className="w-6 h-6 text-violet-600" />Manajemen Inventaris</h1>
          <p className="text-sm text-stone-500 mt-1">Sistem manajemen barang humas — input, peminjaman, pengembalian, pembagian, dan rekapitulasi</p>
        </div>
        <div className="flex gap-2">
          {activeTab === 'barang' && <Button onClick={openAddDialog} className="gap-2"><Plus className="w-4 h-4" />Tambah Barang</Button>}
          {activeTab === 'peminjaman' && <Button onClick={() => openLoanDialog()} className="gap-2"><PackageOpen className="w-4 h-4" />Pinjam Barang</Button>}
          {activeTab === 'pembagian' && <Button onClick={() => openDistDialog()} className="gap-2"><ClipboardList className="w-4 h-4" />Bagikan Barang</Button>}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4"><div className="flex items-center gap-2"><Package className="w-5 h-5 text-violet-500" /><div><p className="text-xs text-stone-500">Total Barang</p><p className="text-2xl font-bold text-stone-900">{totalItems}</p></div></div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="flex items-center gap-2"><PackageCheck className="w-5 h-5 text-green-500" /><div><p className="text-xs text-stone-500">Tersedia</p><p className="text-2xl font-bold text-green-700">{totalTersedia}</p></div></div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="flex items-center gap-2"><PackageOpen className="w-5 h-5 text-orange-500" /><div><p className="text-xs text-stone-500">Dipinjam</p><p className="text-2xl font-bold text-orange-700">{totalDipinjam}</p></div></div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="flex items-center gap-2"><ClipboardList className="w-5 h-5 text-blue-500" /><div><p className="text-xs text-stone-500">Dibagikan</p><p className="text-2xl font-bold text-blue-700">{totalDibagikan}</p></div></div></CardContent></Card>
      </div>

      {/* Stok warnings */}
      {(stokHabis.length > 0) && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-800 text-sm">
          <div className="flex items-start gap-3"><Package className="w-5 h-5 flex-shrink-0 mt-0.5" /><div>
            <p className="font-semibold">⚠️ Stok Habis</p>
            {stokHabis.length > 0 && <p className="mt-1">Barang stok habis ({stokHabis.length}): {stokHabis.map(i => i.namaBarang).join(', ')}</p>}
          </div></div>
        </div>
      )}
      {pendingLoans.length > 0 && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl text-blue-800 text-sm">
          <div className="flex items-start gap-3"><PackageOpen className="w-5 h-5 flex-shrink-0 mt-0.5" /><div>
            <p className="font-semibold">📋 {pendingLoans.length} Permintaan Peminjaman Menunggu Approval</p>
            <p className="mt-1">Klik tab "Peminjaman" untuk menyetujui atau menolak</p>
          </div></div>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-3 md:grid-cols-5 w-full">
          <TabsTrigger value="barang" className="gap-1.5"><Package className="w-4 h-4" /><span className="hidden sm:inline">Barang</span></TabsTrigger>
          <TabsTrigger value="peminjaman" className="gap-1.5"><PackageOpen className="w-4 h-4" />{pendingLoans.length > 0 && <span className="ml-1 inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold bg-amber-500 text-white rounded-full">{pendingLoans.length}</span>}<span className="hidden sm:inline">Peminjaman</span></TabsTrigger>
          <TabsTrigger value="pembagian" className="gap-1.5"><ClipboardList className="w-4 h-4" /><span className="hidden sm:inline">Pembagian</span></TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5"><History className="w-4 h-4" /><span className="hidden sm:inline">History</span></TabsTrigger>
          <TabsTrigger value="rekapitulasi" className="gap-1.5"><PackageCheck className="w-4 h-4" /><span className="hidden sm:inline">Rekap</span></TabsTrigger>
        </TabsList>

        {/* ===== TAB: BARANG ===== */}
        <TabsContent value="barang" className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[200px]"><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" /><Input value={search} onChange={e => setSearch(e.target.value)} className="pl-10" /></div>
            <Select value={filterKategori} onValueChange={setFilterKategori}><SelectTrigger className="w-[160px]"><SelectValue placeholder="Kategori" /></SelectTrigger><SelectContent><SelectItem value="all">Semua</SelectItem>{KATEGORI_OPTIONS.map(k => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent></Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}><SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger><SelectContent><SelectItem value="all">Semua</SelectItem>{STATUS_OPTIONS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent></Select>
          </div>
          <Card><CardContent className="p-0">
            {isLoading ? <div className="flex items-center justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-stone-400" /></div> : items.length === 0 ? (
              <div className="flex flex-col items-center p-12 text-stone-400"><Package className="w-12 h-12 mb-2" /><p className="text-sm">Belum ada barang</p><Button variant="outline" size="sm" className="mt-3 gap-1" onClick={openAddDialog}><Plus className="w-4 h-4" />Tambah</Button></div>
            ) : (
              <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-stone-50 sticky top-0 z-10"><tr className="border-b border-stone-200">
                    <th className="text-left p-3 font-semibold">Foto</th><th className="text-left p-3 font-semibold">Kode</th><th className="text-left p-3 font-semibold">Nama</th><th className="text-left p-3 font-semibold hidden md:table-cell">Kategori</th><th className="text-center p-3 font-semibold">Total</th><th className="text-center p-3 font-semibold">Tersedia</th><th className="text-center p-3 font-semibold hidden sm:table-cell">Dipinjam</th><th className="text-center p-3 font-semibold hidden sm:table-cell">Dibagikan</th><th className="text-center p-3 font-semibold">Status</th><th className="text-center p-3 font-semibold">Aksi</th>
                  </tr></thead>
                  <tbody>
                    {items.map(item => (
                      <tr key={item.id} className="border-b border-stone-100 hover:bg-stone-50">
                        <td className="p-3">{item.imageUrl ? <img src={driveImageUrl(item.imageUrl) || undefined} alt={item.namaBarang} className="w-10 h-10 rounded-lg object-cover border border-stone-200" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} /> : <div className="w-10 h-10 rounded-lg bg-stone-100 flex items-center justify-center"><Package className="w-5 h-5 text-stone-300" /></div>}</td>
                        <td className="p-3 font-mono text-xs">{item.kodeBarang}</td><td className="p-3 font-medium">{item.namaBarang}</td>
                        <td className="p-3 hidden md:table-cell"><Badge variant="outline" className="text-xs">{item.kategori}</Badge></td>
                        <td className="p-3 text-center font-semibold">{item.jumlahTotal}</td>
                        <td className="p-3 text-center"><span className={cn('font-bold', item.jumlahTersedia === 0 ? 'text-red-600' : item.jumlahTersedia <= 2 ? 'text-orange-600' : 'text-green-600')}>{item.jumlahTersedia}</span></td>
                        <td className="p-3 text-center hidden sm:table-cell text-orange-600">{item.jumlahDipinjam}</td><td className="p-3 text-center hidden sm:table-cell text-blue-600">{item.jumlahDibagikan}</td>
                        <td className="p-3 text-center">{getStatusBadge(item.status)}</td>
                        <td className="p-3"><div className="flex items-center justify-center gap-1">
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEditDialog(item)}><Pencil className="w-3.5 h-3.5" /></Button>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-blue-600" title="Pinjam" onClick={() => openLoanDialog(item)}><PackageOpen className="w-3.5 h-3.5" /></Button>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-violet-600" title="Bagikan" onClick={() => openDistDialog(item)}><ClipboardList className="w-3.5 h-3.5" /></Button>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-600" onClick={() => handleDelete(item)}><Trash2 className="w-3.5 h-3.5" /></Button>
                        </div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent></Card>
        </TabsContent>

        {/* ===== TAB: PEMINJAMAN ===== */}
        <TabsContent value="peminjaman" className="space-y-4">
          <Card><CardContent className="p-0">
            {loans.length === 0 ? <div className="flex flex-col items-center p-12 text-stone-400"><PackageOpen className="w-12 h-12 mb-2" /><p className="text-sm">Belum ada peminjaman</p></div> : (
              <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-stone-50 sticky top-0 z-10"><tr className="border-b border-stone-200">
                    <th className="text-left p-3 font-semibold">Barang</th><th className="text-left p-3 font-semibold">Peminjam</th><th className="text-left p-3 font-semibold hidden md:table-cell">Tgl Pinjam</th><th className="text-left p-3 font-semibold hidden md:table-cell">Tanggal Pengembalian</th><th className="text-center p-3 font-semibold">Jml</th><th className="text-center p-3 font-semibold">Status</th><th className="text-center p-3 font-semibold">Aksi</th>
                  </tr></thead>
                  <tbody>
                    {loans.map(loan => (
                      <tr key={loan.id} className="border-b border-stone-100 hover:bg-stone-50">
                        <td className="p-3"><div><p className="font-medium">{loan.namaBarang}</p><p className="text-xs text-stone-500 font-mono">{loan.kodeBarang}</p></div></td>
                        <td className="p-3">{loan.peminjamName}</td>
                        <td className="p-3 hidden md:table-cell text-xs">{formatShortDate(loan.tanggalPinjam)}</td>
                        <td className="p-3 hidden md:table-cell text-xs">{formatShortDate(loan.tanggalKembaliRencana)}</td>
                        <td className="p-3 text-center font-semibold">{loan.jumlahDipinjam}</td>
                        <td className="p-3 text-center">{getLoanStatusBadge(loan.status)}{loan.rejectedReason && <p className="text-[10px] text-red-600 mt-1">{loan.rejectedReason}</p>}</td>
                        <td className="p-3"><div className="flex items-center justify-center gap-1 flex-wrap">
                          {loan.loanGroupId && <Button variant="ghost" size="sm" className="h-7 px-2 text-stone-600" onClick={() => setPrintLoanGroupId(loan.loanGroupId!)} title="Lihat / Print Form"><FileText className="w-3.5 h-3.5 mr-1" />Form</Button>}
                          {loan.status === 'pending' && <>
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-green-600" onClick={() => handleLoanAction(loan.id, 'approve')}><CheckCircle2 className="w-3.5 h-3.5 mr-1" />Approve</Button>
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-red-600" onClick={() => { setRejectLoanId(loan.id); setRejectReason('') }}><XCircle className="w-3.5 h-3.5 mr-1" />Reject</Button>
                          </>}
                          {(loan.status === 'active' || loan.status === 'overdue') && <Button variant="ghost" size="sm" className="h-7 px-2 text-blue-600" onClick={() => { setReturnLoanId(loan.id); setReturnForm({ kondisi: 'baik', catatan: '' }) }}><ArrowLeftRight className="w-3.5 h-3.5 mr-1" />Kembalikan</Button>}
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-600" title="Hapus" onClick={() => handleDeleteLoan(loan.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                        </div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent></Card>
        </TabsContent>

        {/* ===== TAB: PEMBAGIAN ===== */}
        <TabsContent value="pembagian" className="space-y-4">
          <Card><CardContent className="p-0">
            {distributions.length === 0 ? <div className="flex flex-col items-center p-12 text-stone-400"><ClipboardList className="w-12 h-12 mb-2" /><p className="text-sm">Belum ada pembagian</p></div> : (
              <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-stone-50 sticky top-0 z-10"><tr className="border-b border-stone-200">
                    <th className="text-left p-3 font-semibold">Barang</th><th className="text-left p-3 font-semibold">Penerima</th><th className="text-left p-3 font-semibold hidden md:table-cell">Unit</th><th className="text-left p-3 font-semibold hidden md:table-cell">Tanggal</th><th className="text-center p-3 font-semibold">Jml</th><th className="text-left p-3 font-semibold hidden md:table-cell">Keperluan</th>
                  </tr></thead>
                  <tbody>
                    {distributions.map(d => (
                      <tr key={d.id} className="border-b border-stone-100 hover:bg-stone-50">
                        <td className="p-3"><div><p className="font-medium">{d.namaBarang}</p><p className="text-xs text-stone-500 font-mono">{d.kodeBarang}</p></div></td>
                        <td className="p-3 font-medium">{d.penerimaName}</td>
                        <td className="p-3 hidden md:table-cell">{d.penerimaUnit || '—'}</td>
                        <td className="p-3 hidden md:table-cell text-xs">{formatShortDate(d.tanggalBagi)}</td>
                        <td className="p-3 text-center font-semibold">{d.jumlahDibagikan}</td>
                        <td className="p-3 hidden md:table-cell text-xs">{d.keperluan || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent></Card>
        </TabsContent>

        {/* ===== TAB: HISTORY (with checkbox + delete) ===== */}
        <TabsContent value="history" className="space-y-4">
          <Card><CardContent className="p-0">
            {histories.length === 0 ? <div className="flex flex-col items-center p-12 text-stone-400"><History className="w-12 h-12 mb-2" /><p className="text-sm">Belum ada history</p></div> : (
              <>
                {/* Action bar */}
                <div className="flex items-center justify-between p-3 border-b border-stone-200 bg-stone-50">
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox checked={selectedHistoryIds.size === histories.length && histories.length > 0} onCheckedChange={(checked) => {
                        if (checked) { setSelectedHistoryIds(new Set(histories.map(h => h.id))) }
                        else { setSelectedHistoryIds(new Set()) }
                      }} />
                      <span className="text-xs font-medium text-stone-600">Centang Semua</span>
                    </label>
                    {selectedHistoryIds.size > 0 && (
                      <span className="text-xs text-stone-500">{selectedHistoryIds.size} dipilih</span>
                    )}
                  </div>
                  {selectedHistoryIds.size > 0 && (
                    <Button variant="outline" size="sm" className="gap-1.5 text-red-600 border-red-300 hover:bg-red-50" onClick={handleDeleteHistory} disabled={isDeletingHistory}>
                      {isDeletingHistory ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      Hapus ({selectedHistoryIds.size})
                    </Button>
                  )}
                </div>
                <div className="overflow-x-auto max-h-[550px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-stone-50 sticky top-0 z-10"><tr className="border-b border-stone-200">
                      <th className="text-center p-3 w-10"><Checkbox checked={selectedHistoryIds.size === histories.length && histories.length > 0} onCheckedChange={(checked) => {
                        if (checked) { setSelectedHistoryIds(new Set(histories.map(h => h.id))) }
                        else { setSelectedHistoryIds(new Set()) }
                      }} /></th>
                      <th className="text-left p-3 font-semibold">Tanggal</th><th className="text-left p-3 font-semibold">Jenis</th><th className="text-left p-3 font-semibold">Barang</th><th className="text-left p-3 font-semibold">Keterangan</th><th className="text-center p-3 font-semibold hidden sm:table-cell">Jml</th><th className="text-left p-3 font-semibold hidden md:table-cell">Pelaku</th>
                    </tr></thead>
                    <tbody>
                      {histories.map(h => (
                        <tr key={h.id} className={cn("border-b border-stone-100 hover:bg-stone-50", selectedHistoryIds.has(h.id) && "bg-red-50")}>
                          <td className="p-3 text-center"><Checkbox checked={selectedHistoryIds.has(h.id)} onCheckedChange={(checked) => {
                            setSelectedHistoryIds(prev => {
                              const next = new Set(prev)
                              if (checked) next.add(h.id)
                              else next.delete(h.id)
                              return next
                            })
                          }} /></td>
                          <td className="p-3 text-xs">{formatDate(h.tanggalTransaksi)}</td>
                          <td className="p-3">{getHistoryBadge(h.jenisTransaksi)}</td>
                          <td className="p-3"><div><p className="font-medium text-xs">{h.namaBarang}</p><p className="text-[10px] text-stone-500 font-mono">{h.kodeBarang}</p></div></td>
                          <td className="p-3 text-xs">{h.keterangan || '—'}</td>
                          <td className="p-3 text-center hidden sm:table-cell">{h.jumlah != null ? h.jumlah : '—'}</td>
                          <td className="p-3 hidden md:table-cell text-xs">{h.pelakuName || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </CardContent></Card>
        </TabsContent>

        {/* ===== TAB: REKAPITULASI (with filter + sort + export) ===== */}
        <TabsContent value="rekapitulasi" className="space-y-4">
          {/* Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card><CardContent className="p-4"><div className="flex items-center gap-2"><Package className="w-5 h-5 text-violet-500" /><div><p className="text-xs text-stone-500">Total Jenis Barang</p><p className="text-2xl font-bold">{totalItems}</p></div></div></CardContent></Card>
            <Card><CardContent className="p-4"><div className="flex items-center gap-2"><PackageCheck className="w-5 h-5 text-green-500" /><div><p className="text-xs text-stone-500">Total Unit Tersedia</p><p className="text-2xl font-bold text-green-700">{totalTersedia}</p></div></div></CardContent></Card>
            <Card><CardContent className="p-4"><div className="flex items-center gap-2"><PackageOpen className="w-5 h-5 text-orange-500" /><div><p className="text-xs text-stone-500">Sedang Dipinjam</p><p className="text-2xl font-bold text-orange-700">{activeLoans.length + overdueLoans.length}</p></div></div></CardContent></Card>
            <Card><CardContent className="p-4"><div className="flex items-center gap-2"><ClipboardList className="w-5 h-5 text-blue-500" /><div><p className="text-xs text-stone-500">Total Pembagian</p><p className="text-2xl font-bold text-blue-700">{distributions.length}</p></div></div></CardContent></Card>
          </div>

          {/* Filter + Export bar */}
          <Card><CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <Select value={rekapFilterKategori} onValueChange={setRekapFilterKategori}>
                <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">Semua Kategori</SelectItem>{KATEGORI_OPTIONS.map(k => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={rekapFilterStatus} onValueChange={setRekapFilterStatus}>
                <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">Semua Status</SelectItem>{STATUS_OPTIONS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={rekapSortBy} onValueChange={v => setRekapSortBy(v as typeof rekapSortBy)}>
                <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="namaBarang">Urut: Nama Barang</SelectItem>
                  <SelectItem value="kodeBarang">Urut: Kode</SelectItem>
                  <SelectItem value="kategori">Urut: Kategori</SelectItem>
                  <SelectItem value="jumlahTersedia">Urut: Stok Tersedia</SelectItem>
                  <SelectItem value="jumlahTotal">Urut: Jumlah Total</SelectItem>
                  <SelectItem value="status">Urut: Status</SelectItem>
                  <SelectItem value="tahunPengadaan">Urut: Tahun</SelectItem>
                  <SelectItem value="updatedAt">Urut: Update Data</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setRekapSortAsc(!rekapSortAsc)}>
                <ArrowUpDown className="w-3.5 h-3.5" />{rekapSortAsc ? 'A→Z' : 'Z→A'}
              </Button>
              <div className="relative flex-1 min-w-[180px]">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                <Input value={rekapSearch} onChange={e => setRekapSearch(e.target.value)} className="pl-9 h-8" />
              </div>
              <Button variant="outline" size="sm" className="gap-1.5 text-green-700 border-green-300 hover:bg-green-50" onClick={exportExcel} disabled={isExporting}>
                {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}Export Excel
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5 text-red-700 border-red-300 hover:bg-red-50" onClick={exportPDF} disabled={isExporting}>
                {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}Export PDF
              </Button>
            </div>

            {/* Tabel data rekapitulasi */}
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-stone-50 sticky top-0 z-10"><tr className="border-b border-stone-200">
                  <th className="text-left p-2 font-semibold">Kode</th>
                  <th className="text-left p-2 font-semibold">Nama Barang</th>
                  <th className="text-left p-2 font-semibold hidden md:table-cell">Kategori</th>
                  <th className="text-center p-2 font-semibold">Total</th>
                  <th className="text-center p-2 font-semibold">Tersedia</th>
                  <th className="text-center p-2 font-semibold hidden sm:table-cell">Dipinjam</th>
                  <th className="text-center p-2 font-semibold hidden sm:table-cell">Dibagikan</th>
                  <th className="text-center p-2 font-semibold">Status</th>
                  <th className="text-left p-2 font-semibold hidden lg:table-cell">Lokasi/Pengguna/PIC</th>
                  <th className="text-center p-2 font-semibold hidden lg:table-cell">Tahun</th>
                  <th className="text-left p-2 font-semibold hidden xl:table-cell">Sumber</th>
                </tr></thead>
                <tbody>
                  {rekapFiltered.map(item => (
                    <tr key={item.id} className="border-b border-stone-100 hover:bg-stone-50">
                      <td className="p-2 font-mono text-xs">{item.kodeBarang}</td>
                      <td className="p-2 font-medium">{item.namaBarang}</td>
                      <td className="p-2 hidden md:table-cell"><Badge variant="outline" className="text-xs">{item.kategori}</Badge></td>
                      <td className="p-2 text-center font-semibold">{item.jumlahTotal}</td>
                      <td className="p-2 text-center"><span className={cn('font-bold', item.jumlahTersedia === 0 ? 'text-red-600' : 'text-green-600')}>{item.jumlahTersedia}</span></td>
                      <td className="p-2 text-center hidden sm:table-cell text-orange-600">{item.jumlahDipinjam}</td>
                      <td className="p-2 text-center hidden sm:table-cell text-blue-600">{item.jumlahDibagikan}</td>
                      <td className="p-2 text-center">{getStatusBadge(item.status)}</td>
                      <td className="p-2 hidden lg:table-cell text-xs text-stone-500">{item.lokasi || '—'}</td>
                      <td className="p-2 text-center hidden lg:table-cell text-xs">{item.tahunPengadaan || '—'}</td>
                      <td className="p-2 hidden xl:table-cell text-xs">{item.sumberPengadaan || '—'}</td>
                    </tr>
                  ))}
                  {rekapFiltered.length === 0 && <tr><td colSpan={11} className="p-4 text-center text-stone-400">Tidak ada data</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-stone-400 mt-2">Menampilkan {rekapFiltered.length} dari {items.length} barang</p>
          </CardContent></Card>

          {/* Rekap per Kategori */}
          <Card><CardContent className="p-4">
            <h3 className="text-sm font-semibold mb-3">Rekap per Kategori</h3>
            <div className="space-y-2">
              {KATEGORI_OPTIONS.map(kat => {
                const katItems = items.filter(i => i.kategori === kat)
                if (katItems.length === 0) return null
                const total = katItems.reduce((s, i) => s + i.jumlahTotal, 0)
                const tersedia = katItems.reduce((s, i) => s + i.jumlahTersedia, 0)
                const dipinjam = katItems.reduce((s, i) => s + i.jumlahDipinjam, 0)
                const dibagikan = katItems.reduce((s, i) => s + i.jumlahDibagikan, 0)
                return (
                  <div key={kat} className="flex items-center justify-between p-3 bg-stone-50 rounded-lg">
                    <div className="flex items-center gap-2"><Badge variant="outline" className="text-xs">{kat}</Badge><span className="text-xs text-stone-500">{katItems.length} jenis</span></div>
                    <div className="flex gap-4 text-xs"><span>Total: <b>{total}</b></span><span className="text-green-600">Tersedia: <b>{tersedia}</b></span><span className="text-orange-600">Dipinjam: <b>{dipinjam}</b></span><span className="text-blue-600">Dibagikan: <b>{dibagikan}</b></span></div>
                  </div>
                )
              })}
              {items.length === 0 && <p className="text-sm text-stone-400 text-center py-4">Belum ada data</p>}
            </div>
          </CardContent></Card>

          {/* Rekap History Transaksi */}
          <Card><CardContent className="p-4">
            <h3 className="text-sm font-semibold mb-3">Rekap History Transaksi</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Object.entries(HISTORY_TYPES).map(([type, info]) => {
                const count = histories.filter(h => h.jenisTransaksi === type).length
                return <div key={type} className="p-3 bg-stone-50 rounded-lg text-center"><Badge className={cn('text-xs', info.color)}>{info.label}</Badge><p className="text-2xl font-bold mt-1">{count}</p></div>
              })}
            </div>
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      {/* ===== ITEM DIALOG ===== */}
      <Dialog open={isItemDialogOpen} onOpenChange={setIsItemDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingItem ? 'Edit Barang' : 'Tambah Barang Baru'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-4">
              <div className="w-24 h-24 rounded-xl border-2 border-dashed border-stone-300 flex items-center justify-center overflow-hidden bg-stone-50">
                {formData.imageUrl ? <img src={driveImageUrl(formData.imageUrl) || undefined} alt="Preview" className="w-full h-full object-cover" onError={(e) => { const t = e.target as HTMLImageElement; t.style.display = 'none'; t.parentElement!.innerHTML = '<div class="w-10 h-10 text-stone-300"><svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10V8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h6"/><path d="m16 19 2 2 4-4"/></svg></div>' }} /> : <Package className="w-10 h-10 text-stone-300" />}
              </div>
              <div className="flex-1">
                <Label className="text-sm font-medium">Foto Barang</Label><p className="text-xs text-stone-500 mb-2">Ambil foto dengan kamera atau pilih dari galeri</p>
                <div className="flex gap-2 flex-wrap">
                  <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={isUploadingImage} onClick={() => openCamera('item')}>
                    {isUploadingImage ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}<span>Kamera</span>
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={isUploadingImage} onClick={() => galleryInputRef.current?.click()}>
                    {isUploadingImage ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}<span>Galeri / File</span>
                  </Button>
                  {formData.imageUrl && <Button type="button" variant="ghost" size="sm" className="text-red-600" onClick={() => setFormData(prev => ({ ...prev, imageUrl: '', imageFileId: '' }))}><Trash2 className="w-4 h-4" /></Button>}
                </div>
                <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleImageUpload} />
                <input ref={galleryInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="kodeBarang">Kode Barang *</Label>
                <Input
                  id="kodeBarang"
                  required
                  value={formData.kodeBarang}
                  onChange={e => setFormData(p => ({ ...p, kodeBarang: e.target.value }))}
                  className="font-mono"
                />
              </div>
              <div><Label htmlFor="namaBarang">Nama Barang *</Label><Input id="namaBarang" required value={formData.namaBarang} onChange={e => setFormData(p => ({ ...p, namaBarang: e.target.value }))} /></div>
              <div><Label htmlFor="kategori">Kategori *</Label><Select value={formData.kategori} onValueChange={handleKategoriChange}><SelectTrigger id="kategori"><SelectValue /></SelectTrigger><SelectContent>{KATEGORI_OPTIONS.map(k => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent></Select></div>
              <div><Label htmlFor="jumlahTotal">Jumlah Total</Label><Input id="jumlahTotal" type="number" min={0} value={formData.jumlahTotal} onChange={e => setFormData(p => ({ ...p, jumlahTotal: Number(e.target.value) }))} /></div>
              <div><Label htmlFor="lokasi">Lokasi, Pengguna, Penanggung Jawab</Label><Input id="lokasi" value={formData.lokasi} onChange={e => setFormData(p => ({ ...p, lokasi: e.target.value }))} /></div>
              <div><Label htmlFor="sumberPengadaan">Sumber Pengadaan</Label><Select value={formData.sumberPengadaan || 'none'} onValueChange={v => setFormData(p => ({ ...p, sumberPengadaan: v === 'none' ? '' : v }))}><SelectTrigger id="sumberPengadaan"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">— Tidak ada —</SelectItem><SelectItem value="Umum">Umum</SelectItem><SelectItem value="Mandiri">Mandiri</SelectItem></SelectContent></Select></div>
              <div><Label htmlFor="tahunPengadaan">Tahun Pengadaan</Label><Input id="tahunPengadaan" type="number" min={1900} max={2100} value={formData.tahunPengadaan} onChange={e => setFormData(p => ({ ...p, tahunPengadaan: e.target.value }))} /></div>
              <div><Label htmlFor="status">Status</Label><Select value={formData.status} onValueChange={v => setFormData(p => ({ ...p, status: v }))}><SelectTrigger id="status"><SelectValue /></SelectTrigger><SelectContent>{STATUS_OPTIONS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <div><Label htmlFor="catatan">Catatan</Label><Textarea id="catatan" rows={2} value={formData.catatan} onChange={e => setFormData(p => ({ ...p, catatan: e.target.value }))} /></div>
          </div>
          <DialogFooter className="gap-2"><Button variant="outline" onClick={() => setIsItemDialogOpen(false)} disabled={isSaving}>Batal</Button><Button onClick={handleSubmit} disabled={isSaving}>{isSaving ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Menyimpan...</> : editingItem ? 'Update' : 'Tambah'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== LOAN DIALOG (Multi-item + photo + template) ===== */}
      <Dialog open={isLoanDialogOpen} onOpenChange={setIsLoanDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Form Peminjaman Barang</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            {/* Foto peminjam */}
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-xl border-2 border-dashed border-stone-300 flex items-center justify-center overflow-hidden bg-stone-50">
                {loanForm.peminjamPhotoUrl ? <img src={driveImageUrl(loanForm.peminjamPhotoUrl) || undefined} alt="Foto Peminjam" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} /> : <Camera className="w-8 h-8 text-stone-300" />}
              </div>
              <div className="flex-1">
                <Label className="text-sm font-medium">Foto Peminjam (Bukti)</Label>
                <p className="text-xs text-stone-500 mb-2">Foto peminjam sebagai bukti peminjaman</p>
                <div className="flex gap-2 flex-wrap">
                  <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={isUploadingLoanPhoto} onClick={() => openCamera('loan')}>
                    {isUploadingLoanPhoto ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}Kamera
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={isUploadingLoanPhoto} onClick={() => loanGalleryInputRef.current?.click()}>
                    {isUploadingLoanPhoto ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}Galeri / File
                  </Button>
                  {loanForm.peminjamPhotoUrl && <Button type="button" variant="ghost" size="sm" className="text-red-600" onClick={() => setLoanForm(p => ({ ...p, peminjamPhotoUrl: '', peminjamPhotoFileId: '' }))}><Trash2 className="w-4 h-4" /></Button>}
                </div>
                <input ref={loanCameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleLoanPhotoUpload} />
                <input ref={loanGalleryInputRef} type="file" accept="image/*" className="hidden" onChange={handleLoanPhotoUpload} />
              </div>
            </div>

            {/* Borrower info */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label htmlFor="peminjamName">Nama Peminjam *</Label><Input id="peminjamName" value={loanForm.peminjamName} onChange={e => setLoanForm(p => ({ ...p, peminjamName: e.target.value }))} /></div>
              <div><Label htmlFor="peminjamUnit">Unit / Instansi</Label><Input id="peminjamUnit" value={loanForm.peminjamUnit} onChange={e => setLoanForm(p => ({ ...p, peminjamUnit: e.target.value }))} /></div>
              <div><Label htmlFor="peminjamPhone">No. HP / WhatsApp</Label><Input id="peminjamPhone" value={loanForm.peminjamPhone} onChange={e => setLoanForm(p => ({ ...p, peminjamPhone: e.target.value }))} /></div>
              <div><Label htmlFor="tanggalKembaliRencana">Tanggal Pengembalian</Label><Input id="tanggalKembaliRencana" type="date" value={loanForm.tanggalKembaliRencana} onChange={e => setLoanForm(p => ({ ...p, tanggalKembaliRencana: e.target.value }))} /></div>
            </div>
            <div><Label htmlFor="keperluan">Keperluan</Label><Input id="keperluan" value={loanForm.keperluan} onChange={e => setLoanForm(p => ({ ...p, keperluan: e.target.value }))} /></div>

            {/* Multi-item selector */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Barang Dipinjam *</Label>
                <Button type="button" variant="outline" size="sm" className="gap-1 h-7" onClick={addLoanItem}><Plus className="w-3.5 h-3.5" />Tambah Barang</Button>
              </div>
              <div className="space-y-2">
                {loanItems.map((li, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Select value={li.inventoryId} onValueChange={v => updateLoanItem(idx, 'inventoryId', v)}>
                      <SelectTrigger className="flex-1"><SelectValue placeholder="Pilih barang" /></SelectTrigger>
                      <SelectContent>{items.filter(i => i.jumlahTersedia > 0 && (!li.inventoryId || i.id === li.inventoryId)).map(i => <SelectItem key={i.id} value={i.id}>{i.namaBarang} ({i.kodeBarang}) — Tersedia: {i.jumlahTersedia}</SelectItem>)}</SelectContent>
                    </Select>
                    <Input type="number" min={1} className="w-20" value={li.jumlahDipinjam} onChange={e => updateLoanItem(idx, 'jumlahDipinjam', e.target.value)} />
                    <Button type="button" variant="ghost" size="sm" className="h-9 w-9 p-0 text-red-600" onClick={() => removeLoanItem(idx)} disabled={loanItems.length === 1}><Trash2 className="w-4 h-4" /></Button>
                  </div>
                ))}
              </div>
            </div>

            {/* Catatan dengan template */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label htmlFor="loanCatatan">Catatan</Label>
                <div className="flex items-center gap-1">
                  {loanTemplates.length > 0 && (
                    <div className="relative">
                      <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs text-violet-600" onClick={() => setShowTemplateDropdown(!showTemplateDropdown)}>Template ▾</Button>
                      {showTemplateDropdown && (
                        <div className="absolute right-0 top-7 z-20 bg-white border border-stone-200 rounded-lg shadow-lg min-w-[200px] max-w-[300px] max-h-[200px] overflow-y-auto">
                          {loanTemplates.map((tpl, i) => (
                            <div key={i} className="flex items-center gap-1 p-2 hover:bg-stone-50 border-b border-stone-100 last:border-0">
                              <button type="button" className="flex-1 text-left text-xs truncate" onClick={() => { setLoanForm(p => ({ ...p, catatan: tpl })); setShowTemplateDropdown(false) }}>{tpl}</button>
                              <Button type="button" variant="ghost" size="sm" className="h-5 w-5 p-0 text-red-500" onClick={() => deleteTemplate(i)}><XCircle className="w-3 h-3" /></Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs text-green-600" onClick={saveTemplate}>+ Simpan Template</Button>
                </div>
              </div>
              <Textarea id="loanCatatan" rows={2} value={loanForm.catatan} onChange={e => setLoanForm(p => ({ ...p, catatan: e.target.value }))} />
            </div>
          </div>
          <DialogFooter className="gap-2"><Button variant="outline" onClick={() => setIsLoanDialogOpen(false)} disabled={isLoanSaving}>Batal</Button><Button onClick={handleLoanSubmit} disabled={isLoanSaving}>{isLoanSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}Buat Permintaan</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== PRINT FORM DIALOG ===== */}
      {printLoanGroupId && (() => {
        const groupLoans = loans.filter(l => l.loanGroupId === printLoanGroupId)
        const first = groupLoans[0]
        if (!first) return null
        return (
          <Dialog open={true} onOpenChange={() => setPrintLoanGroupId(null)}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader className="no-print"><DialogTitle>Form Peminjaman Barang</DialogTitle></DialogHeader>
              <div className="py-2 print-area">
                {/* Printable form */}
                <div className="border-2 border-stone-800 p-6 rounded-lg">
                  <div className="text-center mb-4">
                    <h2 className="text-lg font-bold">FORM PEMINJAMAN BARANG</h2>
                    <p className="text-sm">Pusat Hubungan Masyarakat dan Keterbukaan Informasi</p>
                    <p className="text-xs text-stone-500 mt-1">ID: {printLoanGroupId}</p>
                  </div>
                  <table className="w-full text-sm mb-4">
                    <tbody>
                      <tr><td className="py-1 font-semibold w-1/3">Nama Peminjam</td><td className="py-1">: {first.peminjamName}</td></tr>
                      <tr><td className="py-1 font-semibold">Unit / Instansi</td><td className="py-1">: {first.peminjamUnit || '—'}</td></tr>
                      <tr><td className="py-1 font-semibold">No. HP / WhatsApp</td><td className="py-1">: {first.peminjamPhone || '—'}</td></tr>
                      <tr><td className="py-1 font-semibold">Tanggal Pinjam</td><td className="py-1">: {formatShortDate(first.tanggalPinjam)}</td></tr>
                      <tr><td className="py-1 font-semibold">Tanggal Pengembalian</td><td className="py-1">: {formatShortDate(first.tanggalKembaliRencana)}</td></tr>
                      <tr><td className="py-1 font-semibold">Keperluan</td><td className="py-1">: {first.keperluan || '—'}</td></tr>
                    </tbody>
                  </table>
                  <table className="w-full text-sm border border-stone-400 mb-4">
                    <thead><tr className="bg-stone-100 border-b border-stone-400">
                      <th className="text-left p-2 border-r border-stone-400">No</th>
                      <th className="text-left p-2 border-r border-stone-400">Kode</th>
                      <th className="text-left p-2 border-r border-stone-400">Nama Barang</th>
                      <th className="text-center p-2 border-r border-stone-400">Jumlah</th>
                      <th className="text-left p-2">Keterangan</th>
                    </tr></thead>
                    <tbody>
                      {groupLoans.map((l, i) => (
                        <tr key={l.id} className="border-b border-stone-300">
                          <td className="p-2 border-r border-stone-300">{i + 1}</td>
                          <td className="p-2 border-r border-stone-300 font-mono">{l.kodeBarang}</td>
                          <td className="p-2 border-r border-stone-300">{l.namaBarang}</td>
                          <td className="p-2 border-r border-stone-300 text-center">{l.jumlahDipinjam}</td>
                          <td className="p-2">{l.status === 'active' ? 'Dipinjam' : l.status === 'returned' ? 'Dikembalikan' : l.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {first.catatan && <p className="text-sm mb-4"><span className="font-semibold">Catatan:</span> {first.catatan}</p>}
                  <div className="flex justify-between mt-8 text-sm">
                    <div className="text-center"><p>Peminjam</p><div className="h-16" /><p className="border-t border-stone-400 pt-1 w-32">(_________________)</p></div>
                    <div className="text-center"><p>Petugas Humas</p><div className="h-16" /><p className="border-t border-stone-400 pt-1 w-32">(_________________)</p></div>
                  </div>
                </div>
              </div>
              <DialogFooter className="gap-2 no-print">
                <Button variant="outline" onClick={() => setPrintLoanGroupId(null)}>Tutup</Button>
                <Button onClick={async () => {
                  const { jsPDF } = await loadJsPDF()
                  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
                  const pageW = 210
                  const margin = 15
                  let y = 20

                  // Header
                  doc.setFontSize(16); doc.setFont('helvetica', 'bold')
                  doc.text('FORM PEMINJAMAN BARANG', pageW / 2, y, { align: 'center' })
                  y += 6
                  doc.setFontSize(11); doc.setFont('helvetica', 'normal')
                  doc.text('Pusat Hubungan Masyarakat dan Keterbukaan Informasi', pageW / 2, y, { align: 'center' })
                  y += 5
                  doc.setFontSize(8); doc.setTextColor(120)
                  doc.text(`ID: ${printLoanGroupId}`, pageW / 2, y, { align: 'center' })
                  doc.setTextColor(0)
                  y += 10

                  // Layout: info peminjam di kiri, foto peminjam di kanan
                  const infoEndY = y + 42 // 7 baris info × 6mm

                  // Foto peminjam di kanan (jika ada)
                  if (first.peminjamPhotoUrl || (loanForm.peminjamPhotoUrl)) {
                    const photoUrl = driveImageUrl(first.peminjamPhotoUrl || loanForm.peminjamPhotoUrl)
                    if (photoUrl) {
                      try {
                        // Fetch image as base64 untuk embed di PDF
                        const imgResp = await fetch(photoUrl)
                        const imgBlob = await imgResp.blob()
                        const reader = new FileReader()
                        const base64Promise = new Promise<string>((resolve) => {
                          reader.onload = () => resolve(reader.result as string)
                          reader.readAsDataURL(imgBlob)
                        })
                        const base64 = await base64Promise
                        // Ukuran foto: 35mm × 45mm (compact, serasi di kanan halaman)
                        const photoW = 35
                        const photoH = 45
                        const photoX = pageW - margin - photoW
                        const photoY = y - 4
                        // Border foto
                        doc.setDrawColor(180); doc.setLineWidth(0.3)
                        doc.rect(photoX - 0.5, photoY - 0.5, photoW + 1, photoH + 1)
                        // Embed foto
                        doc.addImage(base64, 'JPEG', photoX, photoY, photoW, photoH, undefined, 'FAST')
                        // Label
                        doc.setFontSize(7); doc.setFont('helvetica', 'bold')
                        doc.text('Foto Peminjam', photoX + photoW / 2, photoY + photoH + 4, { align: 'center' })
                      } catch (imgErr) {
                        console.error('[PDF] Failed to embed photo:', imgErr)
                        doc.setFontSize(8); doc.setFont('helvetica', 'italic')
                        doc.text('(Foto peminjam tidak tersedia)', pageW - margin - 17, y + 20, { align: 'center' })
                      }
                    }
                  }

                  // Info peminjam di kiri (width dibatasi supaya tidak overlap dengan foto)
                  doc.setFontSize(10); doc.setFont('helvetica', 'normal')
                  const info = [
                    ['Nama Peminjam', first.peminjamName],
                    ['Unit / Instansi', first.peminjamUnit || '—'],
                    ['No. HP / WhatsApp', first.peminjamPhone || '—'],
                    ['Tanggal Pinjam', formatShortDate(first.tanggalPinjam)],
                    ['Tanggal Pengembalian', formatShortDate(first.tanggalKembaliRencana)],
                    ['Keperluan', first.keperluan || '—'],
                  ]
                  const infoMaxW = pageW - margin * 2 - 42 // sisakan ruang untuk foto di kanan
                  for (const [label, value] of info) {
                    doc.setFont('helvetica', 'bold')
                    doc.text(label, margin, y)
                    doc.setFont('helvetica', 'normal')
                    doc.text(`: ${value}`, margin + 50, y, { maxWidth: infoMaxW - 50 })
                    y += 6
                  }
                  y = Math.max(y, infoEndY) + 4

                  // Tabel barang
                  const colW = [12, 35, 75, 20, 38]
                  const tableX = margin
                  doc.setFillColor(245, 245, 244)
                  doc.rect(tableX, y - 4, colW.reduce((a, b) => a + b, 0), 7, 'F')
                  doc.setFontSize(9); doc.setFont('helvetica', 'bold')
                  const headers = ['No', 'Kode', 'Nama Barang', 'Jumlah', 'Keterangan']
                  let cx = tableX
                  for (let i = 0; i < headers.length; i++) {
                    doc.text(headers[i], cx + 2, y, { maxWidth: colW[i] - 2 })
                    cx += colW[i]
                  }
                  y += 8
                  doc.setFont('helvetica', 'normal')
                  doc.setDrawColor(200)
                  groupLoans.forEach((l, i) => {
                    if (y > 270) { doc.addPage(); y = 20 }
                    cx = tableX
                    const rowData = [String(i + 1), l.kodeBarang, l.namaBarang, String(l.jumlahDipinjam), l.status === 'active' ? 'Dipinjam' : l.status === 'returned' ? 'Dikembalikan' : l.status]
                    for (let j = 0; j < rowData.length; j++) {
                      doc.text(rowData[j], cx + 2, y, { maxWidth: colW[j] - 2 })
                      cx += colW[j]
                    }
                    doc.line(tableX, y + 2, tableX + colW.reduce((a, b) => a + b, 0), y + 2)
                    y += 7
                  })

                  // Catatan
                  y += 4
                  if (first.catatan) {
                    doc.setFont('helvetica', 'bold')
                    doc.text('Catatan:', margin, y)
                    doc.setFont('helvetica', 'normal')
                    doc.text(first.catatan, margin + 20, y, { maxWidth: pageW - margin * 2 - 20 })
                    y += 8
                  }

                  // Tanda tangan
                  y += 15
                  if (y > 250) { doc.addPage(); y = 20 }
                  doc.setFontSize(10)
                  doc.text('Peminjam', margin + 30, y, { align: 'center' })
                  doc.text('Petugas Humas', pageW - margin - 35, y, { align: 'center' })
                  y += 25
                  doc.line(margin + 10, y, margin + 55, y)
                  doc.line(pageW - margin - 55, y, pageW - margin - 10, y)
                  y += 5
                  doc.setFontSize(8)
                  doc.text('(____________________)', margin + 32, y, { align: 'center' })
                  doc.text('(____________________)', pageW - margin - 33, y, { align: 'center' })

                  // Download
                  doc.save(`Form-Peminjaman-${first.peminjamName.replace(/\s+/g, '_')}.pdf`)
                  showAlert('Form PDF berhasil di-download.')
                }} className="gap-2"><PackageCheck className="w-4 h-4" />Download PDF</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )
      })()}

      {/* ===== RETURN DIALOG ===== */}
      <Dialog open={returnLoanId !== null} onOpenChange={v => !v && setReturnLoanId(null)}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle>Pengembalian Barang</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div><Label>Kondisi Barang</Label><Select value={returnForm.kondisi} onValueChange={v => setReturnForm(p => ({ ...p, kondisi: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{KONDISI_OPTIONS.map(k => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}</SelectContent></Select></div>
            <div><Label htmlFor="returnCatatan">Catatan</Label><Textarea id="returnCatatan" rows={3} value={returnForm.catatan} onChange={e => setReturnForm(p => ({ ...p, catatan: e.target.value }))} /></div>
            <div className="p-3 bg-stone-50 rounded-lg text-xs text-stone-600"><p>• <b>Baik</b>: stok kembali normal</p><p>• <b>Rusak Ringan</b>: stok kembali, status tetap baik</p><p>• <b>Rusak Berat</b>: stok tidak kembali, status → rusak</p><p>• <b>Hilang</b>: total dikurangi, status → hilang</p></div>
          </div>
          <DialogFooter className="gap-2"><Button variant="outline" onClick={() => setReturnLoanId(null)}>Batal</Button><Button onClick={() => { handleLoanAction(returnLoanId!, 'return', returnForm); setReturnLoanId(null) }}>Kembalikan</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== WEBCAM DIALOG (desktop only) ===== */}
      <Dialog open={isWebcamOpen} onOpenChange={(v) => { if (!v) closeWebcam() }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Ambil Foto dengan Kamera</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="relative rounded-xl overflow-hidden bg-stone-900 aspect-video">
              <video ref={webcamRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            </div>
            <div className="flex justify-center gap-3">
              <Button variant="outline" onClick={closeWebcam}>Batal</Button>
              <Button onClick={captureWebcam} className="gap-2"><Camera className="w-4 h-4" />Ambil Foto</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ===== REJECT DIALOG ===== */}
      <Dialog open={rejectLoanId !== null} onOpenChange={v => !v && setRejectLoanId(null)}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle>Tolak Peminjaman</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2"><div><Label htmlFor="rejectReason">Alasan Penolakan</Label><Textarea id="rejectReason" rows={3} value={rejectReason} onChange={e => setRejectReason(e.target.value)} /></div></div>
          <DialogFooter className="gap-2"><Button variant="outline" onClick={() => setRejectLoanId(null)}>Batal</Button><Button variant="destructive" onClick={() => { handleLoanAction(rejectLoanId!, 'reject', { rejectedReason }); setRejectLoanId(null) }}>Tolak</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== DISTRIBUTION DIALOG ===== */}
      <Dialog open={isDistDialogOpen} onOpenChange={setIsDistDialogOpen}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle>Bagikan Barang</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div><Label>Barang *</Label><Select value={distForm.inventoryId} onValueChange={v => setDistForm(p => ({ ...p, inventoryId: v }))}><SelectTrigger><SelectValue placeholder="Pilih barang" /></SelectTrigger><SelectContent>{items.filter(i => i.jumlahTersedia > 0).map(i => <SelectItem key={i.id} value={i.id}>{i.namaBarang} ({i.kodeBarang}) — Tersedia: {i.jumlahTersedia}</SelectItem>)}</SelectContent></Select></div>
            <div><Label htmlFor="penerimaName">Nama Penerima *</Label><Input id="penerimaName" value={distForm.penerimaName} onChange={e => setDistForm(p => ({ ...p, penerimaName: e.target.value }))} /></div>
            <div><Label htmlFor="penerimaUnit">Unit / Instansi</Label><Input id="penerimaUnit" value={distForm.penerimaUnit} onChange={e => setDistForm(p => ({ ...p, penerimaUnit: e.target.value }))} /></div>
            <div><Label htmlFor="jumlahDibagikan">Jumlah</Label><Input id="jumlahDibagikan" type="number" min={1} value={distForm.jumlahDibagikan} onChange={e => setDistForm(p => ({ ...p, jumlahDibagikan: Number(e.target.value) }))} /></div>
            <div><Label htmlFor="distKeperluan">Keperluan</Label><Input id="distKeperluan" value={distForm.keperluan} onChange={e => setDistForm(p => ({ ...p, keperluan: e.target.value }))} /></div>
            <div><Label htmlFor="distCatatan">Catatan</Label><Textarea id="distCatatan" rows={2} value={distForm.catatan} onChange={e => setDistForm(p => ({ ...p, catatan: e.target.value }))} /></div>
          </div>
          <DialogFooter className="gap-2"><Button variant="outline" onClick={() => setIsDistDialogOpen(false)} disabled={isDistSaving}>Batal</Button><Button onClick={handleDistSubmit} disabled={isDistSaving}>{isDistSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}Bagikan</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
