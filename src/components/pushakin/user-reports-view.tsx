'use client'

// ============================================================================
// UserReportsView — Laporan Kegiatan mandiri untuk SEMUA role (bukan Manager/Admin).
//
// Perbedaan dengan ReportsView (Manager/Admin only):
//   1. Hanya menampilkan proyek di mana user saat ini adalah task assignee ATAU
//      manager proyek tersebut. Tidak bisa melihat proyek orang lain.
//   2. Hanya tombol "Export PDF" (tidak ada "Export Excel").
//   3. Tidak ada dropdown "Pilih User" — filter selalu terkunci ke currentUser.
//   4. PDF hanya berisi TUGAS USER TERSEBUT di setiap proyek (bukan seluruh tim).
//      Ini melindungi privasi rekan kerja: user tidak bisa melihat siapa yang
//      mengerjakan tahap lain atau apa link hasil produksi orang lain.
//   5. Date range filter tetap ada (untuk mempersempit periode laporan).
//
// Tujuan: Manager tidak perlu lagi me-export laporan untuk setiap anggota tim.
// Setiap user bisa mendownload laporan kegiatannya sendiri kapan saja.
// ============================================================================

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { useAppStore, STAGES, getRoleDisplayName } from '@/lib/store'
import {
  ArrowLeft,
  Printer,
  FileText,
  CheckCircle2,
  UserCircle,
  Loader2,
  ExternalLink,
  Globe,
  CalendarDays,
  X,
} from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { loadJsPDF } from '@/lib/export-utils'

// Platform options for displaying publish links (same as ReportsView)
const PUBLISH_PLATFORMS = [
  { id: 'website', label: 'Website Resmi', icon: '🌐' },
  { id: 'instagram', label: 'Instagram', icon: '📱' },
  { id: 'facebook', label: 'Facebook', icon: '📘' },
  { id: 'twitter', label: 'Twitter / X', icon: '🐦' },
  { id: 'youtube', label: 'YouTube', icon: '▶️' },
  { id: 'tiktok', label: 'TikTok', icon: '🎵' },
  { id: 'linkedin', label: 'LinkedIn', icon: '💼' },
  { id: 'newsletter', label: 'Newsletter', icon: '📧' },
  { id: 'portal', label: 'Portal Berita', icon: '📰' },
  { id: 'spotify', label: 'Spotify', icon: '🎧' },
  { id: 'anchor', label: 'Anchor/Spotify Podcast', icon: '🎙️' },
  { id: 'podcast', label: 'Platform Podcast', icon: '🎙️' },
  { id: 'streaming', label: 'Platform Streaming', icon: '📺' },
  { id: 'other', label: 'Lainnya', icon: '🔗' },
]

const getPlatformInfo = (platformId: string) => {
  return PUBLISH_PLATFORMS.find(p => p.id === platformId) || { id: platformId, label: platformId, icon: '🔗' }
}

// Extract result links from a task's data field
const getTaskResultLinks = (task: { data?: { link?: string; publishLinks?: { id: string; platform: string; url: string }[]; notes?: string } }) => {
  const links: { platform: string; label: string; icon: string; url: string }[] = []
  if (task.data?.publishLinks && task.data.publishLinks.length > 0) {
    task.data.publishLinks.forEach(pl => {
      const platformInfo = getPlatformInfo(pl.platform)
      links.push({ platform: pl.platform, label: platformInfo.label, icon: platformInfo.icon, url: pl.url })
    })
  }
  if (task.data?.link && links.length === 0) {
    links.push({ platform: 'other', label: 'Tautan Hasil', icon: '🔗', url: task.data.link })
  }
  return links
}

const getFallbackNotes = (taskNotes?: string) => {
  return taskNotes || 'Selesai tanpa tautan'
}

export function UserReportsView() {
  const { projects, users, currentUser, selectedProjectId, setSelectedProjectId, suratList } = useAppStore()
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false)
  const printRef = useRef<HTMLDivElement>(null)

  // Filter: completed projects WHERE current user has at least one task
  // assigned OR is the project manager. This is the privacy boundary —
  // users cannot see projects they didn't participate in.
  const myCompletedProjects = projects.filter(p => {
    if (p.currentStage !== 5) return false
    if (!currentUser) return false
    const isAssignee = p.tasks.some(t => t.assignedTo === currentUser.id)
    const isManager = p.managerId === currentUser.id
    return isAssignee || isManager
  })

  // Apply date range filter
  const filteredProjects = myCompletedProjects.filter(p => {
    if (dateFrom) {
      const projectDate = new Date(p.createdAt)
      const from = new Date(dateFrom)
      from.setHours(0, 0, 0, 0)
      if (projectDate < from) return false
    }
    if (dateTo) {
      const projectDate = new Date(p.createdAt)
      const to = new Date(dateTo)
      to.setHours(23, 59, 59, 999)
      if (projectDate > to) return false
    }
    return true
  })

  const hasDateFilter = dateFrom || dateTo
  const clearDateFilter = () => { setDateFrom(''); setDateTo('') }

  // ----- Filename & download helpers -----

  const sanitizeFilename = (str: string): string => {
    return (str || '').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim()
  }

  const getRentangWaktuFilename = (): string => {
    const fmt = (d: string) => new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })
    if (dateFrom && dateTo) return `${fmt(dateFrom)} sd ${fmt(dateTo)}`
    if (dateFrom) return `Dari ${fmt(dateFrom)}`
    if (dateTo) return `Sampai ${fmt(dateTo)}`
    return 'Semua Waktu'
  }

  const buildLaporanFilename = (userName: string, userRole: string): string => {
    const rentang = sanitizeFilename(getRentangWaktuFilename()) || 'Semua Waktu'
    const nama = sanitizeFilename(userName) || 'User'
    const peran = sanitizeFilename(userRole) || 'Peran'
    return `${nama}_${peran}_Laporan Kegiatan_${rentang}_.pdf`
  }

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1500)
  }

  const formatDateTime = (dateString: string) => {
    if (!dateString) return '-'
    const d = new Date(dateString)
    return d.toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short' })
  }

  // Filter tasks within a project to ONLY those owned by the current user.
  // This is the key privacy boundary for the PDF: the user's report only
  // contains THEIR work, not their colleagues'.
  const getMyTasksInProject = (project: typeof projects[0]) => {
    if (!currentUser) return []
    return project.tasks.filter(t => t.assignedTo === currentUser.id)
  }

  // Check if current user is the manager of a project
  const isMyProjectAsManager = (project: typeof projects[0]) => {
    return currentUser?.id === project.managerId
  }

  // ----- PDF Generation -----
  // Generates a PDF blob containing ONLY the current user's tasks across
  // the filtered projects. Each project shows project info + the user's
  // specific tasks (with their result links). Other team members' tasks
  // are NOT included — this protects colleague privacy.
  const generatePDFBlob = async (
    projectsToExport: typeof projects,
  ): Promise<Blob> => {
    const { jsPDF } = await loadJsPDF()
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    })

    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const margin = 15
    const contentWidth = pageWidth - (margin * 2)
    let yPosition = margin

    const checkNewPage = (requiredSpace: number) => {
      if (yPosition + requiredSpace > pageHeight - margin) {
        pdf.addPage()
        yPosition = margin
      }
    }

    const userName = currentUser?.name || 'User'
    const userRole = getRoleDisplayName(currentUser?.role || '')

    // Title Page
    pdf.setFontSize(24)
    pdf.setFont('helvetica', 'bold')
    pdf.text('LAPORAN KEGIATAN', pageWidth / 2, yPosition, { align: 'center' })
    yPosition += 12

    pdf.setFontSize(14)
    pdf.setFont('helvetica', 'normal')
    pdf.text('Pushakin Flows', pageWidth / 2, yPosition, { align: 'center' })
    yPosition += 8

    pdf.setFontSize(10)
    pdf.text(`Tanggal Export: ${new Date().toLocaleString('id-ID')}`, pageWidth / 2, yPosition, { align: 'center' })
    yPosition += 6

    pdf.text(`Nama: ${userName}`, pageWidth / 2, yPosition, { align: 'center' })
    yPosition += 6

    pdf.text(`Peran: ${userRole}`, pageWidth / 2, yPosition, { align: 'center' })
    yPosition += 6

    pdf.text(`Total Proyek: ${projectsToExport.length}`, pageWidth / 2, yPosition, { align: 'center' })
    yPosition += 6

    pdf.text(`Rentang Waktu: ${getRentangWaktuFilename()}`, pageWidth / 2, yPosition, { align: 'center' })
    yPosition += 10

    pdf.setLineWidth(0.5)
    pdf.line(margin, yPosition, pageWidth - margin, yPosition)
    yPosition += 15

    // Process each project — only the current user's tasks
    for (let projIndex = 0; projIndex < projectsToExport.length; projIndex++) {
      const project = projectsToExport[projIndex]
      const myTasks = getMyTasksInProject(project)
      const isManager = isMyProjectAsManager(project)

      // Skip if user has no tasks and isn't the manager (shouldn't happen due to filter)
      if (myTasks.length === 0 && !isManager) continue

      if (projIndex > 0) {
        pdf.addPage()
        yPosition = margin
      }

      // Project Header
      pdf.setFontSize(16)
      pdf.setFont('helvetica', 'bold')
      const titleLines = pdf.splitTextToSize(project.title, contentWidth)
      titleLines.forEach((line: string, idx: number) => {
        pdf.text(line, margin, yPosition + (idx * 7))
      })
      yPosition += titleLines.length * 7 + 5

      pdf.setFontSize(9)
      pdf.setFont('helvetica', 'normal')
      pdf.setTextColor(100, 100, 100)
      pdf.text(`Ref ID: ${project.id}`, margin, yPosition)
      pdf.setTextColor(0, 0, 0)
      yPosition += 8

      pdf.setLineWidth(0.2)
      pdf.line(margin, yPosition, pageWidth - margin, yPosition)
      yPosition += 8

      // Project Info
      pdf.setFontSize(9)
      const infoItems = [
        { label: 'Unit Pemohon', value: project.requesterUnit },
        { label: 'Lokasi', value: project.location || '-' },
        { label: 'Waktu Selesai', value: formatDateTime(project.createdAt) },
        { label: 'PIC', value: `${project.picName || '-'} (${project.picWhatsApp || '-'})` }
      ]

      for (let i = 0; i < infoItems.length; i += 2) {
        checkNewPage(12)

        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(7)
        pdf.text(infoItems[i].label.toUpperCase(), margin, yPosition)
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(9)
        pdf.text(infoItems[i].value, margin, yPosition + 4)

        if (infoItems[i + 1]) {
          pdf.setFont('helvetica', 'bold')
          pdf.setFontSize(7)
          pdf.text(infoItems[i + 1].label.toUpperCase(), pageWidth / 2, yPosition)
          pdf.setFont('helvetica', 'normal')
          pdf.setFontSize(9)
          pdf.text(infoItems[i + 1].value, pageWidth / 2, yPosition + 4)
        }

        yPosition += 10
      }

      // Tasks section — only the current user's tasks
      yPosition += 5
      checkNewPage(15)
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(10)
      pdf.text('RINCIAN TUGAS SAYA', margin, yPosition)
      yPosition += 8

      // If user is the manager, show a Tahap 0 card
      if (isManager) {
        const mgrBoxH = 18
        checkNewPage(mgrBoxH)

        // Green highlight — this is MY card
        pdf.setDrawColor(5, 150, 105)
        pdf.setFillColor(240, 253, 244)
        pdf.roundedRect(margin, yPosition, contentWidth, mgrBoxH, 2, 2, 'FD')

        const mgrY = yPosition + 5
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(8)
        pdf.text('Tahap 0 (Pra-produksi)', margin + 5, mgrY)

        pdf.setFontSize(9)
        pdf.text(userRole, margin + 42, mgrY)

        pdf.setTextColor(34, 197, 94)
        pdf.setFontSize(7)
        pdf.text('TUNTAS', pageWidth - margin - 15, mgrY)
        pdf.setTextColor(0, 0, 0)

        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(8)
        pdf.text(`Inisiasi oleh: ${userName} (Anda)`, margin + 5, mgrY + 5)

        yPosition += mgrBoxH + 3
      }

      // My task cards
      if (myTasks.length === 0) {
        checkNewPage(10)
        pdf.setFont('helvetica', 'italic')
        pdf.setFontSize(9)
        pdf.setTextColor(150, 150, 150)
        pdf.text('(Tidak ada tugas produksi yang dikerjakan pada proyek ini)', margin, yPosition)
        pdf.setTextColor(0, 0, 0)
        yPosition += 8
      } else {
        myTasks.forEach((task) => {
          const links = getTaskResultLinks(task)
          const requiredSpace = Math.max(30, 20 + (links.length * 8))
          checkNewPage(requiredSpace)

          const boxHeight = Math.max(25, 18 + (links.length * 8))
          // Green highlight — this is MY task card
          pdf.setDrawColor(5, 150, 105)
          pdf.setFillColor(240, 253, 244)
          pdf.roundedRect(margin, yPosition, contentWidth, boxHeight, 2, 2, 'FD')

          const taskY = yPosition + 5

          pdf.setFont('helvetica', 'bold')
          pdf.setFontSize(8)
          pdf.text(`Tahap ${task.stage}`, margin + 5, taskY)

          pdf.setFontSize(9)
          pdf.text(task.role, margin + 25, taskY)

          pdf.setTextColor(34, 197, 94)
          pdf.setFontSize(7)
          pdf.text('TUNTAS', pageWidth - margin - 15, taskY)
          pdf.setTextColor(0, 0, 0)

          pdf.setFont('helvetica', 'normal')
          pdf.setFontSize(8)
          pdf.text(`Dikerjakan oleh: ${userName} (Anda)`, margin + 5, taskY + 5)

          if (links.length > 0) {
            pdf.setFontSize(7)
            pdf.setFont('helvetica', 'bold')
            pdf.text('Hasil Produksi:', margin + 5, taskY + 11)
            pdf.setFont('helvetica', 'normal')

            links.forEach((link, idx) => {
              const linkY = taskY + 16 + (idx * 7)
              pdf.setFontSize(7)
              pdf.setTextColor(100, 100, 100)
              pdf.text(`[${link.label}]:`, margin + 5, linkY)
              pdf.setTextColor(0, 0, 0)

              const urlLines = pdf.splitTextToSize(link.url, contentWidth - 50)
              pdf.setFontSize(7)
              pdf.setTextColor(0, 0, 0)
              urlLines.slice(0, 1).forEach((line: string) => {
                pdf.text(line, margin + 45, linkY)
              })
            })
          } else {
            pdf.setFontSize(7)
            pdf.setFont('helvetica', 'bold')
            pdf.text('Catatan:', margin + 5, taskY + 11)
            pdf.setFont('helvetica', 'normal')
            const notes = getFallbackNotes(task.data?.notes)
            pdf.text(notes.substring(0, 80), margin + 5, taskY + 16)
          }

          yPosition += boxHeight + 3
        })
      }

      // Footer for each project
      yPosition += 5
      checkNewPage(10)
      pdf.setLineWidth(0.1)
      pdf.line(margin, yPosition, pageWidth - margin, yPosition)
      yPosition += 5
      pdf.setFontSize(7)
      pdf.setTextColor(150, 150, 150)
      pdf.text(`Proyek ${projIndex + 1} dari ${projectsToExport.length}`, pageWidth / 2, yPosition, { align: 'center' })
      pdf.setTextColor(0, 0, 0)
    }

    // Final footer
    yPosition = pageHeight - 10
    pdf.setFontSize(7)
    pdf.setTextColor(150, 150, 150)
    pdf.text('Dokumen di-generate oleh Sistem Pushakin Flows', pageWidth / 2, yPosition, { align: 'center' })

    return pdf.output('blob')
  }

  // Export all filtered projects to a single PDF (user's own activity report)
  const handleExportAllToPDF = async () => {
    if (!currentUser) return
    setIsGeneratingPDF(true)
    try {
      const blob = await generatePDFBlob(filteredProjects)
      const fileName = buildLaporanFilename(currentUser.name, getRoleDisplayName(currentUser.role))
      downloadBlob(blob, fileName)
    } catch (error) {
      console.error('Error generating PDF:', error)
    } finally {
      setIsGeneratingPDF(false)
    }
  }

  // Generate PDF for a single project (detail view "Unduh PDF" button)
  const handleGenerateSinglePDF = async () => {
    if (!currentUser || !printRef.current) return
    const report = filteredProjects.find(p => p.id === selectedProjectId)
    if (!report) return

    setIsGeneratingPDF(true)
    try {
      const blob = await generatePDFBlob([report])
      const fileName = buildLaporanFilename(currentUser.name, getRoleDisplayName(currentUser.role))
      // For single-project export, include the project ID in the filename
      const singleFileName = fileName.replace('.pdf', `_${report.id}.pdf`)
      downloadBlob(blob, singleFileName)
    } catch (error) {
      console.error('Error generating PDF:', error)
    } finally {
      setIsGeneratingPDF(false)
    }
  }

  // Detail View — clear stale selection
  const selectedReport = selectedProjectId
    ? filteredProjects.find(p => p.id === selectedProjectId)
    : null

  useEffect(() => {
    if (selectedProjectId && !selectedReport) {
      setSelectedProjectId(null)
    }
  }, [selectedProjectId, selectedReport, setSelectedProjectId])

  // ----- Single Project Detail View -----
  if (selectedProjectId && selectedReport) {
    const myTasks = getMyTasksInProject(selectedReport)
    const isManager = isMyProjectAsManager(selectedReport)

    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <Button
            variant="ghost"
            onClick={() => setSelectedProjectId(null)}
            className="gap-2 text-stone-500 hover:text-stone-700"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Kembali ke Daftar Laporan</span>
          </Button>
          <Button
            onClick={handleGenerateSinglePDF}
            disabled={isGeneratingPDF}
            className="gap-2 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 shadow-md shadow-violet-500/20"
          >
            {isGeneratingPDF ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Printer className="w-4 h-4" />
            )}
            <span>{isGeneratingPDF ? 'Membuat PDF...' : 'Unduh PDF'}</span>
          </Button>
        </div>

        {/* Preview Area */}
        <Card ref={printRef}>
          <CardContent className="p-4 sm:p-6 lg:p-10">
            <div className="text-center mb-10 pb-6 border-b-2 border-stone-800">
              <h1 className="text-3xl font-bold text-stone-900 uppercase tracking-widest mb-2">
                Laporan Kegiatan
              </h1>
              <p className="text-lg text-stone-600">{selectedReport.title}</p>
              <div className="mt-4 inline-block bg-stone-100 px-4 py-1 rounded-full text-xs font-mono text-stone-600 font-bold border border-stone-200">
                Ref ID: {selectedReport.id}
              </div>
              <p className="mt-3 text-sm text-stone-500">
                Dikerjakan oleh: <strong className="text-stone-700">{currentUser?.name}</strong> ({getRoleDisplayName(currentUser?.role || '')})
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-12 mb-10">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-stone-400 mb-1">Unit Pemohon</p>
                <p className="text-stone-800 font-medium">{selectedReport.requesterUnit}</p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-stone-400 mb-1">Waktu Selesai</p>
                <p className="text-stone-800 font-medium">{formatDateTime(selectedReport.createdAt)}</p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-stone-400 mb-1">Lokasi</p>
                <p className="text-stone-800 font-medium">{selectedReport.location || '-'}</p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-stone-400 mb-1">PIC</p>
                <p className="text-stone-800 font-medium">
                  {selectedReport.picName || '-'}
                  {selectedReport.picWhatsApp && (
                    <span className="text-stone-500 text-sm ml-2">({selectedReport.picWhatsApp})</span>
                  )}
                </p>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-bold text-stone-800 mb-4 pb-2 border-b border-stone-200">
                Rincian Tugas Saya
              </h3>
              <div className="space-y-4">
                {/* Manager card (Tahap 0) — only if current user is the manager */}
                {isManager && (
                  <div className="bg-emerald-50 border-2 border-emerald-300 rounded-xl p-4">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-3">
                        <Badge variant="outline" className="bg-emerald-200 text-emerald-800 font-bold">
                          Tahap 0 (Pra-produksi)
                        </Badge>
                        <span className="font-bold text-stone-800">{getRoleDisplayName(currentUser?.role || '')}</span>
                      </div>
                      <span className="text-xs font-medium text-stone-500 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-green-600" />
                        <span>Tuntas</span>
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-stone-600 mb-3">
                      <UserCircle className="w-4 h-4 text-stone-400" />
                      <span>Inisiasi oleh: <strong className="text-stone-800">{currentUser?.name} (Anda)</strong></span>
                    </div>
                    <p className="text-xs text-stone-500 italic">
                      Anda berperan sebagai manager/inisiator proyek ini.
                    </p>
                  </div>
                )}

                {/* My task cards */}
                {myTasks.length === 0 && !isManager ? (
                  <p className="text-sm text-stone-400 italic">
                    Tidak ada tugas produksi yang dikerjakan oleh Anda pada proyek ini.
                  </p>
                ) : (
                  myTasks.map(task => {
                    const links = getTaskResultLinks(task)
                    return (
                      <div
                        key={task.id}
                        className="bg-emerald-50 border-2 border-emerald-300 rounded-xl p-4"
                      >
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex items-center gap-3">
                            <Badge variant="outline" className="bg-emerald-200 text-emerald-800 font-bold">
                              Tahap {task.stage}
                            </Badge>
                            <span className="font-bold text-stone-800">{getRoleDisplayName(task.role)}</span>
                          </div>
                          <span className="text-xs font-medium text-stone-500 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-green-600" />
                            <span>Tuntas</span>
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-stone-600 mb-3">
                          <UserCircle className="w-4 h-4 text-stone-400" />
                          <span>Dikerjakan oleh: <strong className="text-stone-800">{currentUser?.name} (Anda)</strong></span>
                        </div>

                        <div className="bg-white p-3 rounded-lg border border-emerald-200 text-sm">
                          <strong className="block text-xs uppercase tracking-wider text-stone-400 mb-2">
                            {links.length > 0 ? 'Link Hasil Produksi:' : 'Catatan:'}
                          </strong>

                          {links.length > 0 ? (
                            <div className="space-y-2">
                              {links.map((link, idx) => (
                                <div key={idx} className="flex items-start gap-3 p-2 bg-emerald-50 rounded-lg border border-emerald-100">
                                  <span className="text-lg flex-shrink-0" title={link.label}>
                                    {link.icon}
                                  </span>
                                  <div className="flex-1 min-w-0">
                                    <div className="text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-0.5">
                                      {link.label}
                                    </div>
                                    <a
                                      href={link.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-violet-600 hover:text-violet-800 underline break-all text-sm flex items-center gap-1"
                                    >
                                      {link.url}
                                      <ExternalLink className="w-3 h-3 flex-shrink-0" />
                                    </a>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-stone-700 italic">
                              {getFallbackNotes(task.data?.notes) || 'Tugas diselesaikan dan diunggah ke Drive tanpa tautan spesifik.'}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            <div className="mt-12 pt-8 border-t border-stone-200 text-center text-xs text-stone-400">
              Dokumen ini di-generate secara otomatis oleh Sistem Pushakin Flows.
              <br />
              Hanya memuat tugas yang dikerjakan oleh {currentUser?.name}.
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ----- List View -----
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <Card>
        <CardContent className="p-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="bg-gradient-to-br from-violet-100 to-purple-100 p-2 rounded-xl text-violet-600">
              <FileText className="w-6 h-6" />
            </div>
            <h2 className="text-2xl font-bold text-slate-800">Laporan Kegiatan Saya</h2>
          </div>
          <p className="text-stone-500">
            Daftar proyek yang telah selesai dan Anda ikuti. Unduh laporan PDF mandiri
            tanpa perlu meminta ke manager.
          </p>
        </CardContent>
      </Card>

      {/* Filter Section — date range only (no user dropdown, locked to self) */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col gap-4">
            {/* Row 1: Date range filter */}
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <CalendarDays className="w-5 h-5 text-stone-500" />
                <span className="text-sm font-medium text-stone-700">Rentang Waktu:</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={e => setDateFrom(e.target.value)}
                  className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder="Dari"
                />
                <span className="text-sm text-stone-400">—</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={e => setDateTo(e.target.value)}
                  className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder="Sampai"
                />
                {hasDateFilter && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-stone-400 hover:text-red-500"
                    onClick={clearDateFilter}
                    title="Hapus filter tanggal"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>

            {/* Row 2: Export button + filter status */}
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3">
                {hasDateFilter && (
                  <div className="flex flex-wrap items-center gap-2">
                    {dateFrom && (
                      <Badge variant="secondary" className="gap-1.5 px-3 py-1 text-xs font-medium">
                        <CalendarDays className="w-3 h-3" />
                        Dari {new Date(dateFrom).toLocaleDateString('id-ID')}
                      </Badge>
                    )}
                    {dateTo && (
                      <Badge variant="secondary" className="gap-1.5 px-3 py-1 text-xs font-medium">
                        <CalendarDays className="w-3 h-3" />
                        Sampai {new Date(dateTo).toLocaleDateString('id-ID')}
                      </Badge>
                    )}
                    <span className="text-sm text-stone-500">
                      → <strong>{filteredProjects.length}</strong> proyek ditemukan
                    </span>
                  </div>
                )}
                {!hasDateFilter && (
                  <span className="text-sm text-stone-500">
                    Menampilkan <strong>{filteredProjects.length}</strong> proyek yang Anda kerjakan
                  </span>
                )}
              </div>

              <Button
                onClick={handleExportAllToPDF}
                disabled={isGeneratingPDF || filteredProjects.length === 0}
                className="gap-2 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 shadow-md shadow-violet-500/20"
              >
                {isGeneratingPDF ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Printer className="w-4 h-4" />
                )}
                <span>{isGeneratingPDF ? 'Membuat PDF...' : 'Export PDF'}</span>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {filteredProjects.length === 0 ? (
        <Card className="p-12 text-center">
          <CardContent className="pt-6">
            <FileText className="w-16 h-16 text-stone-300 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-stone-800">Belum Ada Laporan</h3>
            <p className="text-stone-500 mt-2">
              {hasDateFilter
                ? 'Tidak ada proyek yang Anda kerjakan pada rentang waktu ini.'
                : 'Laporan akan muncul otomatis ketika proyek yang Anda kerjakan telah menyelesaikan proses Publikasi.'
              }
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredProjects.map(project => {
            const myTasks = getMyTasksInProject(project)
            const isManager = isMyProjectAsManager(project)
            return (
              <Card
                key={project.id}
                className="cursor-pointer hover:shadow-md hover:border-violet-300 transition-all group"
                onClick={() => setSelectedProjectId(project.id)}
              >
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <Badge className="bg-gradient-to-r from-violet-100 to-purple-100 text-violet-700 gap-1 border border-violet-200">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>Selesai</span>
                    </Badge>
                    <span className="text-[10px] font-mono text-slate-400">{project.id}</span>
                  </div>
                </CardHeader>
                <CardContent>
                  <h3 className="text-lg font-bold text-slate-900 mb-2 group-hover:text-violet-600 transition-colors">
                    {project.title}
                  </h3>
                  <p className="text-xs text-stone-500 mb-4 line-clamp-2">{project.description}</p>
                  <Separator className="mb-4" />
                  <div className="text-xs text-stone-500 space-y-1">
                    <span className="block">
                      Unit: <strong className="text-stone-700">{project.requesterUnit}</strong>
                    </span>
                    <span className="block">
                      Waktu: {formatDateTime(project.createdAt)}
                    </span>
                    <span className="block mt-2">
                      {isManager && myTasks.length > 0 ? (
                        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 text-[10px] mr-1">
                          Manager + {myTasks.length} tugas
                        </Badge>
                      ) : isManager ? (
                        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 text-[10px]">
                          Sebagai Manager
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-violet-50 text-violet-700 text-[10px]">
                          {myTasks.length} tugas dikerjakan
                        </Badge>
                      )}
                    </span>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
