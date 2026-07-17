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
import { type ProgramKegiatan } from '@/lib/store'
import {
  BarChart3,
  Filter,
  Download,
  FileSpreadsheet,
  FileText,
  Calendar,
  ClipboardList,
  FolderOpen,
  Users,
  CalendarDays,
  TrendingUp,
  Loader2,
} from 'lucide-react'
import { loadJsPDF, loadXLSX, loadAutoTable } from '@/lib/export-utils'

interface ProgramKegiatanRekapitulasiProps {
  kegiatanList: ProgramKegiatan[]
  users: { id: string; name: string; role: string }[]
}

type PeriodeFilter = 'all' | 'today' | 'month' | 'year' | 'custom'

export function ProgramKegiatanRekapitulasi({ kegiatanList, users }: ProgramKegiatanRekapitulasiProps) {
  const [filterPeriode, setFilterPeriode] = useState<PeriodeFilter>('all')
  const [tanggalMulai, setTanggalMulai] = useState('')
  const [tanggalAkhir, setTanggalAkhir] = useState('')
  const [isExportingExcel, setIsExportingExcel] = useState(false)
  const [isExportingPDF, setIsExportingPDF] = useState(false)

  // Helper: get manager name by id
  const getManagerName = (managerId: string | null) => {
    if (!managerId) return '-'
    const user = users.find(u => u.id === managerId)
    return user?.name || '-'
  }

  // Helper: count uploaded documents
  const getDocCount = (k: ProgramKegiatan) => {
    if (!k.documents || !Array.isArray(k.documents)) return 0
    return k.documents.filter((d: any) => d.webViewLink || d.driveFileId).length
  }

  // Helper: get document names as string
  const getDocNames = (k: ProgramKegiatan) => {
    if (!k.documents || !Array.isArray(k.documents)) return '-'
    const docs = k.documents.filter((d: any) => d.webViewLink || d.driveFileId)
    if (docs.length === 0) return '-'
    return docs.map((d: any) => d.name || d.originalName || 'Dokumen').join('; ')
  }

  // Summary statistics
  const stats = useMemo(() => {
    const total = kegiatanList.length
    const now = new Date()
    const bulanIni = kegiatanList.filter(k => {
      if (!k.tanggalKegiatan) return false
      const d = new Date(k.tanggalKegiatan)
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
    }).length
    const totalDocs = kegiatanList.reduce((sum, k) => sum + getDocCount(k), 0)
    const kegiatanDenganDokumen = kegiatanList.filter(k => getDocCount(k) > 0).length
    return { total, bulanIni, totalDocs, kegiatanDenganDokumen }
  }, [kegiatanList])

  // Period filter helper
  const isInPeriod = (tanggalKegiatan: string | null): boolean => {
    if (!tanggalKegiatan) return true // show kegiatan without tanggal in all filters
    const now = new Date()
    const tanggal = new Date(tanggalKegiatan)
    switch (filterPeriode) {
      case 'today':
        return tanggal.toDateString() === now.toDateString()
      case 'month':
        return tanggal.getMonth() === now.getMonth() && tanggal.getFullYear() === now.getFullYear()
      case 'year':
        return tanggal.getFullYear() === now.getFullYear()
      case 'custom': {
        if (tanggalMulai) {
          const start = new Date(tanggalMulai)
          start.setHours(0, 0, 0, 0)
          if (tanggal < start) return false
        }
        if (tanggalAkhir) {
          const end = new Date(tanggalAkhir)
          end.setHours(23, 59, 59, 999)
          if (tanggal > end) return false
        }
        return true
      }
      default:
        return true
    }
  }

  // Filtered kegiatan list
  const filteredKegiatan = useMemo(() => {
    return kegiatanList.filter(k => isInPeriod(k.tanggalKegiatan))
  }, [kegiatanList, filterPeriode, tanggalMulai, tanggalAkhir])

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

  // ==================== EXPORT EXCEL ====================
  const exportExcel = async () => {
    setIsExportingExcel(true)
    try {
    const XLSX = await loadXLSX()
    const periodeDesc = getPeriodeDescription()

    const headers = [
      'No',
      'Nama Kegiatan',
      'Tanggal Kegiatan',
      'Deskripsi',
      'Jumlah Dokumen',
      'Daftar Dokumen',
      'Manager',
      'Dibuat',
    ]

    const data = filteredKegiatan.map((k, idx) => [
      idx + 1,
      k.perihal || '-',
      k.tanggalKegiatan ? formatDateShort(k.tanggalKegiatan) : '-',
      (k.deskripsi || '-').length > 200 ? (k.deskripsi || '-').substring(0, 200) + '...' : (k.deskripsi || '-'),
      getDocCount(k),
      getDocNames(k),
      getManagerName(k.managerId),
      formatDateTime(k.createdAt),
    ])

    const wsData = [
      ['REKAPITULASI KEGIATAN - Pushakin Flows'],
      [`Periode: ${periodeDesc}, Total: ${filteredKegiatan.length} kegiatan, Total Dokumen: ${stats.totalDocs}`],
      [],
      headers,
      ...data,
    ]

    const ws = XLSX.utils.aoa_to_sheet(wsData)

    // Set column widths
    ws['!cols'] = [
      { wch: 5 },   // No
      { wch: 40 },  // Nama Kegiatan
      { wch: 18 },  // Tanggal
      { wch: 50 },  // Deskripsi
      { wch: 15 },  // Jumlah Dokumen
      { wch: 50 },  // Daftar Dokumen
      { wch: 20 },  // Manager
      { wch: 20 },  // Dibuat
    ]

    // Merge title rows
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 7 } },
    ]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Rekapitulasi Kegiatan')

    const today = new Date().toISOString().slice(0, 10)
    XLSX.writeFile(wb, `Rekapitulasi_Kegiatan_${today}.xlsx`)
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
    doc.text('REKAPITULASI KEGIATAN', pageWidth / 2, 15, { align: 'center' })

    // Subtitle
    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    const periodeDesc = getPeriodeDescription()
    doc.text(`Periode: ${periodeDesc}`, pageWidth / 2, 22, { align: 'center' })
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
      `Total: ${stats.total} kegiatan | Bulan Ini: ${stats.bulanIni} | Dengan Dokumen: ${stats.kegiatanDenganDokumen} | Total Dokumen: ${stats.totalDocs}`,
      pageWidth / 2,
      33,
      { align: 'center' }
    )

    // Table data
    const headers = [
      'No',
      'Nama Kegiatan',
      'Tgl Kegiatan',
      'Deskripsi',
      'Dokumen',
      'Manager',
    ]

    const data = filteredKegiatan.map((k, idx) => [
      idx + 1,
      (k.perihal || '-').length > 40 ? (k.perihal || '-').substring(0, 40) + '...' : (k.perihal || '-'),
      k.tanggalKegiatan ? formatDateShort(k.tanggalKegiatan) : '-',
      (k.deskripsi || '-').length > 60 ? (k.deskripsi || '-').substring(0, 60) + '...' : (k.deskripsi || '-'),
      getDocNames(k).length > 50 ? getDocNames(k).substring(0, 50) + '...' : getDocNames(k),
      getManagerName(k.managerId),
    ])

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
        fillColor: [5, 150, 105], // emerald-600
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8,
      },
      alternateRowStyles: {
        fillColor: [245, 245, 244], // stone-100
      },
      columnStyles: {
        0: { cellWidth: 10, halign: 'center' },  // No
        1: { cellWidth: 60 },                       // Nama Kegiatan
        2: { cellWidth: 25 },                       // Tgl Kegiatan
        3: { cellWidth: 80 },                       // Deskripsi
        4: { cellWidth: 70 },                       // Dokumen
        5: { cellWidth: 30 },                       // Manager
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
    doc.save(`Rekapitulasi_Kegiatan_${today}.pdf`)
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
          <h2 className="text-xl font-bold text-stone-800">Rekapitulasi Kegiatan</h2>
          <p className="text-stone-500 text-sm">
            Ringkasan dan laporan seluruh data kegiatan
          </p>
        </div>
      </div>

      {/* Summary Statistics Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Kegiatan */}
        <Card className="border-stone-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-100">
                <ClipboardList className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-stone-800">{stats.total}</p>
                <p className="text-xs text-stone-500">Total Kegiatan</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Kegiatan Bulan Ini */}
        <Card className="border-stone-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100">
                <CalendarDays className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-blue-700">{stats.bulanIni}</p>
                <p className="text-xs text-stone-500">Bulan Ini</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Kegiatan Dengan Dokumen */}
        <Card className="border-stone-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-100">
                <FolderOpen className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-amber-700">{stats.kegiatanDenganDokumen}</p>
                <p className="text-xs text-stone-500">Dengan Dokumen</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Total Dokumen */}
        <Card className="border-stone-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-violet-100">
                <FileText className="w-5 h-5 text-violet-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-violet-700">{stats.totalDocs}</p>
                <p className="text-xs text-stone-500">Total Dokumen</p>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {/* Periode */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-stone-600">Periode</Label>
              <Select value={filterPeriode} onValueChange={(v: string) => {
                setFilterPeriode(v as PeriodeFilter)
                if (v !== 'custom') { setTanggalMulai(''); setTanggalAkhir('') }
              }}>
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
          {filteredKegiatan.length} kegiatan terfilter
        </Badge>
      </div>

      {/* Data Table */}
      <Card className="border-stone-200">
        <CardContent className="p-0">
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <h3 className="text-sm font-semibold text-stone-700">
              Data Kegiatan
            </h3>
            <Badge variant="outline" className="text-xs">
              {filteredKegiatan.length} data
            </Badge>
          </div>

          {filteredKegiatan.length === 0 ? (
            <div className="py-16 text-center">
              <div className="w-16 h-16 rounded-full bg-stone-100 mx-auto mb-4 flex items-center justify-center">
                <ClipboardList className="w-8 h-8 text-stone-400" />
              </div>
              <h3 className="text-lg font-semibold text-stone-800">Tidak ada data</h3>
              <p className="text-stone-500 mt-1 text-sm">
                Ubah filter untuk menampilkan data kegiatan
              </p>
            </div>
          ) : (
            <ScrollArea className="max-h-[500px] overflow-y-auto">
              <div className="min-w-[800px]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-stone-100 border-b border-stone-200">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-stone-600 w-10">No</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-stone-600">Nama Kegiatan</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-stone-600 w-32">Tanggal Kegiatan</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-stone-600">Deskripsi</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-stone-600 w-24">Dokumen</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-stone-600 w-28">Manager</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-stone-600 w-32">Dibuat</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {filteredKegiatan.map((k, idx) => {
                      const docCount = getDocCount(k)
                      const docs = k.documents?.filter((d: any) => d.webViewLink || d.driveFileId) || []
                      return (
                        <tr key={k.id} className="hover:bg-stone-50 transition-colors">
                          <td className="px-4 py-3 text-xs text-stone-500">{idx + 1}</td>
                          <td className="px-4 py-3">
                            <span className="text-sm font-semibold text-stone-800">
                              {k.perihal || '-'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs text-stone-600 whitespace-nowrap">
                              {k.tanggalKegiatan ? formatDateShort(k.tanggalKegiatan) : '-'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs text-stone-600 line-clamp-2" title={k.deskripsi || ''}>
                              {k.deskripsi || '-'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {docCount > 0 ? (
                              <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs">
                                <FileText className="w-3 h-3 mr-1" />
                                {docCount} berkas
                              </Badge>
                            ) : (
                              <span className="text-xs text-stone-400">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs text-stone-600">
                              {getManagerName(k.managerId)}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-[11px] text-stone-400">
                              {formatDateTime(k.createdAt)}
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
