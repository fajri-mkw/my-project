'use client'

import { useState, useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { type Surat, SURAT_KATEGORI_OPTIONS, SURAT_STATUS_CONFIG } from '@/lib/store'
import {
  BarChart3,
  Filter,
  Download,
  FileSpreadsheet,
  FileText,
  Mail,
  MailOpen,
  Inbox,
  ClipboardList,
  Calendar,
  Paperclip,
  ExternalLink,
  Loader2,
} from 'lucide-react'
import { loadJsPDF, loadXLSX, loadAutoTable } from '@/lib/export-utils'

interface SuratRekapitulasiProps {
  suratList: Surat[]
  users: { id: string; name: string; role: string }[]
}

type PeriodeFilter = 'all' | 'today' | 'month' | 'year' | 'custom'

export function SuratRekapitulasi({ suratList, users }: SuratRekapitulasiProps) {
  const [filterJenis, setFilterJenis] = useState<string>('all')
  const [filterKategori, setFilterKategori] = useState<string>('all')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterPeriode, setFilterPeriode] = useState<PeriodeFilter>('all')
  const [tanggalMulai, setTanggalMulai] = useState('')
  const [tanggalAkhir, setTanggalAkhir] = useState('')
  const [isExportingExcel, setIsExportingExcel] = useState(false)
  const [isExportingPDF, setIsExportingPDF] = useState(false)

  // Summary statistics (based on ALL surat, before filtering)
  const stats = useMemo(() => {
    const total = suratList.length
    const masuk = suratList.filter(s => s.jenisSurat === 'Surat Masuk').length
    const keluar = suratList.filter(s => s.jenisSurat === 'Surat Keluar').length
    const permohonan = suratList.filter(s => s.jenisSurat === 'Surat Masuk' && s.kategori === 'Permohonan').length
    return { total, masuk, keluar, permohonan }
  }, [suratList])

  // Period filter helper
  const isInPeriod = (createdAt: string): boolean => {
    const now = new Date()
    const created = new Date(createdAt)
    switch (filterPeriode) {
      case 'today':
        return created.toDateString() === now.toDateString()
      case 'month':
        return created.getMonth() === now.getMonth() && created.getFullYear() === now.getFullYear()
      case 'year':
        return created.getFullYear() === now.getFullYear()
      case 'custom': {
        if (tanggalMulai) {
          const start = new Date(tanggalMulai)
          start.setHours(0, 0, 0, 0)
          if (created < start) return false
        }
        if (tanggalAkhir) {
          const end = new Date(tanggalAkhir)
          end.setHours(23, 59, 59, 999)
          if (created > end) return false
        }
        return true
      }
      default:
        return true
    }
  }

  // Filtered surat list
  const filteredSurat = useMemo(() => {
    return suratList.filter(s => {
      if (filterJenis !== 'all' && s.jenisSurat !== filterJenis) return false
      if (filterKategori !== 'all' && s.kategori !== filterKategori) return false
      if (filterStatus !== 'all' && s.status !== filterStatus) return false
      if (!isInPeriod(s.createdAt)) return false
      return true
    })
  }, [suratList, filterJenis, filterKategori, filterStatus, filterPeriode, tanggalMulai, tanggalAkhir])

  // Format date in Indonesian locale
  const formatDate = (dateString: string) => {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  }

  const formatDateShort = (dateString: string) => {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleDateString('id-ID', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  }

  const formatDateTime = (dateString: string) => {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleString('id-ID', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  // Get periode description for export
  const getPeriodeDescription = () => {
    const now = new Date()
    switch (filterPeriode) {
      case 'today':
        return `Hari Ini (${now.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })})`
      case 'month':
        return now.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })
      case 'year':
        return `Tahun ${now.getFullYear()}`
      case 'custom':
        const mulai = tanggalMulai ? formatDate(tanggalMulai) : '...'
        const akhir = tanggalAkhir ? formatDate(tanggalAkhir) : '...'
        return `${mulai} s/d ${akhir}`
      default:
        return 'Semua Waktu'
    }
  }

  const getJenisDescription = () => {
    switch (filterJenis) {
      case 'Surat Masuk': return 'Surat Masuk'
      case 'Surat Keluar': return 'Surat Keluar'
      default: return 'Semua'
    }
  }

  // Get status badge config
  const getStatusBadge = (status: string) => {
    const config = SURAT_STATUS_CONFIG[status]
    if (!config) return { label: status, className: 'bg-stone-100 text-stone-600 border-stone-200' }
    return {
      label: config.label,
      className: `${config.bg} ${config.color} ${config.border} border`,
    }
  }

  // Look up manager name
  const getManagerName = (managerId: string | null) => {
    if (!managerId) return '-'
    const user = users.find(u => u.id === managerId)
    return user?.name || '-'
  }

  // Build a guaranteed-valid, absolute Google Drive VIEW url for a surat
  // document. Prefer the official webViewLink; fall back to a constructed
  // view url from driveFileId. Only fall back to downloadUrl last (it
  // forces a download rather than opening the viewer).
  // Returns null when no usable URL is available.
  const getDocLink = (doc: any): string | null => {
    if (!doc) return null
    return (
      doc.webViewLink ||
      (doc.driveFileId ? `https://drive.google.com/file/d/${doc.driveFileId}/view` : null) ||
      doc.downloadUrl ||
      null
    )
  }

  // Resolve a friendly display name for a surat document.
  const getDocName = (doc: any, fallbackIdx: number = 0): string => {
    if (!doc) return `Dokumen ${fallbackIdx + 1}`
    return doc.name || doc.originalName || `Dokumen ${fallbackIdx + 1}`
  }

  // ==================== EXPORT EXCEL ====================
  const exportExcel = async () => {
    setIsExportingExcel(true)
    try {
    const XLSX = await loadXLSX()
    const periodeDesc = getPeriodeDescription()
    const jenisDesc = getJenisDescription()

    const headers = [
      'No',
      'No. Surat',
      'Jenis Surat',
      'Kategori',
      'Tanggal Surat',
      'Pengirim/Penerima',
      'Perihal',
      'File Surat',
      'Status',
      'Manager',
    ]

    const data = filteredSurat.map((s, idx) => [
      idx + 1,
      s.nomorSurat || '-',
      s.jenisSurat,
      s.kategori,
      s.tanggalSurat ? formatDateShort(s.tanggalSurat) : '-',
      s.jenisSurat === 'Surat Masuk' ? (s.pengirim || '-') : (s.penerima || '-'),
      s.perihal,
      // File Surat column — show the first document's name (clickable in Excel).
      // When multiple documents exist, additional names are appended as plain
      // text after the first one's name; the cell's hyperlink (set below)
      // points to the first document. This keeps the cell readable while still
      // providing a one-click shortcut to open the file.
      (s.documents && s.documents.length > 0)
        ? s.documents.map((d: any) => getDocName(d, 0)).join('; ')
        : '-',
      SURAT_STATUS_CONFIG[s.status]?.label || s.status,
      getManagerName(s.managerId),
    ])

    const wsData = [
      ['REKAPITULASI SURAT - Pushakin Flows'],
      [`Periode: ${periodeDesc}, Jenis: ${jenisDesc}, Total: ${filteredSurat.length} surat`],
      [],
      headers,
      ...data,
    ]

    const ws = XLSX.utils.aoa_to_sheet(wsData)

    // Attach clickable hyperlinks to the "File Surat" cells (column H, the
    // 8th column, 0-indexed = 7). The first data row is at spreadsheet row 5
    // (1-indexed), because wsData has 3 leading rows (title, periode, blank)
    // plus 1 header row.
    // Each cell's hyperlink points to the first document that has a usable
    // URL (webViewLink > constructed driveFileId view url > downloadUrl).
    filteredSurat.forEach((s, idx) => {
      const docs = Array.isArray(s.documents) ? s.documents : []
      const firstLinkedDoc = docs.find((d: any) => getDocLink(d))
      if (!firstLinkedDoc) return
      const link = getDocLink(firstLinkedDoc)
      if (!link) return
      const excelRow = 5 + idx // 1-indexed; data starts at row 5
      const cellAddr = XLSX.utils.encode_cell({ r: excelRow - 1, c: 7 })
      const cell = ws[cellAddr]
      if (cell) {
        // .l.Target is the clickable hyperlink; .l.Tooltip is the hover tooltip.
        cell.l = { Target: link, Tooltip: `Buka "${getDocName(firstLinkedDoc, 0)}" di Google Drive` }
      }
    })

    // Set column widths
    ws['!cols'] = [
      { wch: 5 },   // No
      { wch: 20 },  // No. Surat
      { wch: 15 },  // Jenis
      { wch: 18 },  // Kategori
      { wch: 18 },  // Tanggal
      { wch: 30 },  // Pengirim/Penerima
      { wch: 40 },  // Perihal
      { wch: 30 },  // File Surat
      { wch: 15 },  // Status
      { wch: 20 },  // Manager
    ]

    // Merge title row
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 9 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 9 } }]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Rekapitulasi Surat')

    const today = new Date().toISOString().slice(0, 10)
    XLSX.writeFile(wb, `Rekapitulasi_Surat_${today}.xlsx`)
    } catch (error) {
      console.error('Error exporting to Excel:', error)
    } finally {
      setIsExportingExcel(false)
    }
  }

  // ==================== EXPORT PDF ====================
  const exportPDF = async () => {
    setIsExportingPDF(true)
    try {
    const [{ jsPDF }, autoTableMod] = await Promise.all([loadJsPDF(), loadAutoTable()])
    const autoTable = autoTableMod.default
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const pageWidth = doc.internal.pageSize.getWidth()

    // Title
    doc.setFontSize(16)
    doc.setFont('helvetica', 'bold')
    doc.text('REKAPITULASI SURAT', pageWidth / 2, 15, { align: 'center' })

    // Subtitle
    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    const periodeDesc = getPeriodeDescription()
    const jenisDesc = getJenisDescription()
    doc.text(`Periode: ${periodeDesc} | Jenis: ${jenisDesc}`, pageWidth / 2, 22, { align: 'center' })
    doc.text(
      `Dicetak: ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`,
      pageWidth / 2,
      27,
      { align: 'center' }
    )

    // Summary line
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.text(
      `Total: ${stats.total} surat | Masuk: ${stats.masuk} | Keluar: ${stats.keluar} | Permohonan: ${stats.permohonan}`,
      pageWidth / 2,
      33,
      { align: 'center' }
    )

    // Table data
    const headers = [
      'No',
      'No. Surat',
      'Jenis',
      'Kategori',
      'Tgl Surat',
      'Pengirim/Penerima',
      'Perihal',
      'File Surat',
      'Status',
      'Manager',
    ]

    const data = filteredSurat.map((s, idx) => [
      idx + 1,
      s.nomorSurat || '-',
      s.jenisSurat === 'Surat Masuk' ? 'Masuk' : 'Keluar',
      s.kategori,
      s.tanggalSurat ? formatDateShort(s.tanggalSurat) : '-',
      s.jenisSurat === 'Surat Masuk' ? (s.pengirim || '-') : (s.penerima || '-'),
      s.perihal.length > 50 ? s.perihal.substring(0, 50) + '...' : s.perihal,
      // File Surat column — join document display names. The cell is made
      // clickable in didDrawCell below (pointing to the first document that
      // has a usable URL).
      (s.documents && s.documents.length > 0)
        ? s.documents.map((d: any) => getDocName(d, 0)).join(', ')
        : '-',
      SURAT_STATUS_CONFIG[s.status]?.label || s.status,
      getManagerName(s.managerId),
    ])

    // Pre-compute, per body row, the first usable document link (if any).
    // Used by the willDrawCell/didDrawCell hooks below to (a) color the File
    // Surat text blue like a hyperlink and (b) attach a clickable link
    // annotation covering the entire File Surat cell.
    const rowDocLinks: (string | null)[] = filteredSurat.map(s => {
      const docs = Array.isArray(s.documents) ? s.documents : []
      const firstLinkedDoc = docs.find((d: any) => getDocLink(d))
      return firstLinkedDoc ? getDocLink(firstLinkedDoc) : null
    })

    autoTable(doc, {
      head: [headers],
      body: data,
      startY: 38,
      styles: {
        fontSize: 7,
        cellPadding: 2,
        overflow: 'linebreak',
      },
      headStyles: {
        fillColor: [16, 185, 129], // emerald-500
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8,
      },
      alternateRowStyles: {
        fillColor: [245, 245, 244], // stone-100
      },
      columnStyles: {
        0: { cellWidth: 10, halign: 'center' },  // No
        1: { cellWidth: 25 },                       // No. Surat
        2: { cellWidth: 18 },                       // Jenis
        3: { cellWidth: 22 },                       // Kategori
        4: { cellWidth: 22 },                       // Tgl Surat
        5: { cellWidth: 40 },                       // Pengirim/Penerima
        6: { cellWidth: 50 },                       // Perihal
        7: { cellWidth: 30 },                       // File Surat
        8: { cellWidth: 20 },                       // Status
        9: { cellWidth: 28 },                       // Manager
      },
      // Render the File Surat cell text in blue (like a hyperlink) so users
      // know it is clickable. Only applied when a link is available.
      willDrawCell: (hookData) => {
        if (hookData.section !== 'body') return
        if (hookData.column.index !== 7) return // File Surat column
        const rowIndex = hookData.row.index
        if (rowDocLinks[rowIndex]) {
          doc.setTextColor(30, 64, 175) // blue-800
        }
      },
      didDrawCell: (hookData) => {
        if (hookData.section !== 'body') return
        if (hookData.column.index !== 7) return // File Surat column
        const rowIndex = hookData.row.index
        const link = rowDocLinks[rowIndex]
        if (!link) return
        // Reset text color for any subsequent cells autoTable draws.
        doc.setTextColor(0, 0, 0)
        const { x, y, width, height } = hookData.cell
        // Attach a clickable link annotation covering the whole File Surat
        // cell. Clicking opens the document in Google Drive.
        doc.link(x, y, width, height, { url: link })
      },
      didDrawPage: (data) => {
        // Footer with page numbers
        const pageCount = doc.getNumberOfPages()
        const pageNum = data.pageNumber
        doc.setFontSize(8)
        doc.setFont('helvetica', 'normal')
        doc.text(
          `Halaman ${pageNum} dari ${pageCount}`,
          pageWidth / 2,
          doc.internal.pageSize.getHeight() - 10,
          { align: 'center' }
        )
      },
    })

    const today = new Date().toISOString().slice(0, 10)
    doc.save(`Rekapitulasi_Surat_${today}.pdf`)
    } catch (error) {
      console.error('Error generating PDF:', error)
    } finally {
      setIsExportingPDF(false)
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Section Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-amber-50">
          <BarChart3 className="w-6 h-6 text-amber-600" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-stone-800">Rekapitulasi Surat</h2>
          <p className="text-stone-500 text-sm">
            Ringkasan dan laporan seluruh data surat
          </p>
        </div>
      </div>

      {/* Summary Statistics Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Surat */}
        <Card className="border-stone-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-stone-100">
                <Mail className="w-5 h-5 text-stone-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-stone-800">{stats.total}</p>
                <p className="text-xs text-stone-500">Total Surat</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Surat Masuk */}
        <Card className="border-stone-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-100">
                <Inbox className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-emerald-700">{stats.masuk}</p>
                <p className="text-xs text-stone-500">Surat Masuk</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Surat Keluar */}
        <Card className="border-stone-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-stone-200">
                <MailOpen className="w-5 h-5 text-stone-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-stone-700">{stats.keluar}</p>
                <p className="text-xs text-stone-500">Surat Keluar</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Permohonan Produksi */}
        <Card className="border-stone-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-100">
                <ClipboardList className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-amber-700">{stats.permohonan}</p>
                <p className="text-xs text-stone-500">Permohonan Produksi</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter Section */}
      <Card className="border-stone-200">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="w-4 h-4 text-stone-500" />
            <h3 className="text-sm font-semibold text-stone-700">Filter Data</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Jenis Surat */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-stone-600">Jenis Surat</Label>
              <Select value={filterJenis} onValueChange={setFilterJenis}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Semua Jenis" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua</SelectItem>
                  <SelectItem value="Surat Masuk">Surat Masuk</SelectItem>
                  <SelectItem value="Surat Keluar">Surat Keluar</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Kategori */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-stone-600">Kategori</Label>
              <Select value={filterKategori} onValueChange={setFilterKategori}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Semua Kategori" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua</SelectItem>
                  {SURAT_KATEGORI_OPTIONS.map(k => (
                    <SelectItem key={k} value={k}>{k}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Status */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-stone-600">Status</Label>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Semua Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua</SelectItem>
                  {Object.entries(SURAT_STATUS_CONFIG).map(([key, val]) => (
                    <SelectItem key={key} value={key}>{val.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Periode */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-stone-600">Periode</Label>
              <Select value={filterPeriode} onValueChange={(v: string) => setFilterPeriode(v as PeriodeFilter)}>
                <SelectTrigger className="w-full">
                  <Calendar className="w-4 h-4 mr-1 text-stone-400" />
                  <SelectValue placeholder="Semua Waktu" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Waktu</SelectItem>
                  <SelectItem value="today">Hari Ini</SelectItem>
                  <SelectItem value="month">Bulan Ini</SelectItem>
                  <SelectItem value="year">Tahun Ini</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Custom date range */}
          {filterPeriode === 'custom' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 pt-3 border-t border-stone-100">
              <div className="space-y-1.5">
                <Label htmlFor="tanggal-mulai" className="text-xs font-medium text-stone-600">Tanggal Mulai</Label>
                <Input
                  id="tanggal-mulai"
                  type="date"
                  value={tanggalMulai}
                  onChange={e => setTanggalMulai(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tanggal-akhir" className="text-xs font-medium text-stone-600">Tanggal Akhir</Label>
                <Input
                  id="tanggal-akhir"
                  type="date"
                  value={tanggalAkhir}
                  onChange={e => setTanggalAkhir(e.target.value)}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Export Buttons */}
      <div className="flex flex-col sm:flex-row gap-3">
        <Button
          onClick={exportExcel}
          disabled={isExportingExcel}
          className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          {isExportingExcel ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <FileSpreadsheet className="w-4 h-4" />
          )}
          {isExportingExcel ? 'Membuat Excel...' : 'Export Excel'}
        </Button>
        <Button
          onClick={exportPDF}
          disabled={isExportingPDF}
          className="gap-2 bg-stone-600 hover:bg-stone-700 text-white"
        >
          {isExportingPDF ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <FileText className="w-4 h-4" />
          )}
          {isExportingPDF ? 'Membuat PDF...' : 'Export PDF'}
        </Button>
        <Badge variant="secondary" className="h-fit px-3 py-1.5 text-xs text-stone-500">
          <Download className="w-3 h-3 mr-1" />
          {filteredSurat.length} surat terfilter
        </Badge>
      </div>

      {/* Data Table */}
      <Card className="border-stone-200">
        <CardContent className="p-0">
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <h3 className="text-sm font-semibold text-stone-700">
              Data Surat
            </h3>
            <Badge variant="outline" className="text-xs">
              {filteredSurat.length} data
            </Badge>
          </div>

          {filteredSurat.length === 0 ? (
            <div className="py-16 text-center">
              <div className="w-16 h-16 rounded-full bg-stone-100 mx-auto mb-4 flex items-center justify-center">
                <Inbox className="w-8 h-8 text-stone-400" />
              </div>
              <h3 className="text-lg font-semibold text-stone-800">Tidak ada data</h3>
              <p className="text-stone-500 mt-1 text-sm">
                Ubah filter untuk menampilkan data surat
              </p>
            </div>
          ) : (
            <ScrollArea className="max-h-[500px] overflow-y-auto">
              <div className="min-w-[1100px]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-stone-100 border-b border-stone-200">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-stone-600 w-10">No</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-stone-600">No. Surat</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-stone-600 w-24">Jenis</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-stone-600 w-28">Kategori</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-stone-600 w-32">Tanggal Surat</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-stone-600">Pengirim/Penerima</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-stone-600">Perihal</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-stone-600">File Surat</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-stone-600 w-24">Status</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-stone-600 w-32">Manager</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-stone-600 w-32">Dibuat</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {filteredSurat.map((s, idx) => {
                      const statusBadge = getStatusBadge(s.status)
                      return (
                        <tr key={s.id} className="hover:bg-stone-50 transition-colors">
                          <td className="px-4 py-3 text-xs text-stone-500">{idx + 1}</td>
                          <td className="px-4 py-3">
                            <span className="text-xs font-mono font-semibold text-stone-700">
                              {s.nomorSurat || '-'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <Badge
                              variant="outline"
                              className={`text-xs ${
                                s.jenisSurat === 'Surat Masuk'
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                  : 'border-stone-200 bg-stone-50 text-stone-700'
                              }`}
                            >
                              {s.jenisSurat === 'Surat Masuk' ? (
                                <><Inbox className="w-3 h-3 mr-1" />Masuk</>
                              ) : (
                                <><MailOpen className="w-3 h-3 mr-1" />Keluar</>
                              )}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs text-stone-600">{s.kategori}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs text-stone-600">
                              {s.tanggalSurat ? formatDateShort(s.tanggalSurat) : '-'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs text-stone-600">
                              {s.jenisSurat === 'Surat Masuk'
                                ? (s.pengirim || '-')
                                : (s.penerima || '-')}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs text-stone-700 font-medium line-clamp-2" title={s.perihal}>
                              {s.perihal}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {s.documents && Array.isArray(s.documents) && s.documents.length > 0 ? (
                              <div className="flex flex-col gap-1">
                                {s.documents.map((doc: any, docIdx: number) => {
                                  const docName = doc.name || doc.originalName || `Dokumen ${docIdx + 1}`
                                  // Build a guaranteed-valid, absolute Google Drive VIEW url.
                                  // Prefer the official webViewLink; fall back to a constructed view
                                  // url from driveFileId. Only fall back to downloadUrl last (it
                                  // forces a download rather than opening the viewer).
                                  const docLink =
                                    doc.webViewLink ||
                                    (doc.driveFileId ? `https://drive.google.com/file/d/${doc.driveFileId}/view` : null) ||
                                    doc.downloadUrl ||
                                    null
                                  if (!docLink) {
                                    // No usable URL — show name as plain text (not a broken link)
                                    return (
                                      <span
                                        key={docIdx}
                                        className="inline-flex items-center gap-1 text-xs text-stone-400 max-w-[200px]"
                                        title={`${docName} (tautan tidak tersedia)`}
                                      >
                                        <Paperclip className="w-3 h-3 shrink-0" />
                                        <span className="truncate">{docName}</span>
                                      </span>
                                    )
                                  }
                                  return (
                                    <a
                                      key={docIdx}
                                      href={docLink}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      draggable={false}
                                      className="inline-flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-800 hover:underline font-medium max-w-[220px] cursor-pointer"
                                      title={`Buka "${docName}" di Google Drive (tab baru)`}
                                    >
                                      <Paperclip className="w-3 h-3 shrink-0" />
                                      <span className="truncate">{docName}</span>
                                      <ExternalLink className="w-3 h-3 shrink-0 opacity-60" />
                                    </a>
                                  )
                                })}
                              </div>
                            ) : (
                              <span className="text-xs text-stone-400 italic">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant="outline" className={`text-xs border ${statusBadge.className}`}>
                              {statusBadge.label}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs text-stone-600">
                              {getManagerName(s.managerId)}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-[11px] text-stone-400">
                              {formatDateTime(s.createdAt)}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
