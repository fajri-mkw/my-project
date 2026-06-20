'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAppStore, STAGES, getRoleDisplayName } from '@/lib/store'
import { 
  ArrowLeft, 
  FileSpreadsheet, 
  Printer, 
  FileText,
  CheckCircle2,
  UserCircle,
  Loader2,
  Users,
  ExternalLink,
  Globe,
  CalendarDays,
  X
} from 'lucide-react'
import { useState, useRef } from 'react'
import jsPDF from 'jspdf'
import * as XLSX from 'xlsx'

// Platform options for displaying publish links
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

// Get platform info by id
const getPlatformInfo = (platformId: string) => {
  return PUBLISH_PLATFORMS.find(p => p.id === platformId) || { id: platformId, label: platformId, icon: '🔗' }
}

// Check if role is a publisher role that has multiple publish links
const isPublisherRole = (role: string) => {
  const publisherRoles = [
    'Publisher Web',
    'Publisher Social Media',
    'Podcast',
    'Streaming',
    'Youtube'
  ]
  return publisherRoles.some(r => role.toLowerCase().includes(r.toLowerCase()))
}

export function ReportsView() {
  const { projects, users, selectedProjectId, setSelectedProjectId, suratList } = useAppStore()
  const [selectedUserId, setSelectedUserId] = useState<string>('all')
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false)
  const [isExportingExcel, setIsExportingExcel] = useState(false)
  const printRef = useRef<HTMLDivElement>(null)

  // Helper: get Manager info and document links for a project
  const getManagerEntry = (project: typeof projects[0]) => {
    const manager = users.find(u => u.id === project.managerId)
    if (!manager) return null
    const docs = project.documents || []
    
    // Also include surat lampiran links as manager documents
    const relatedSurat = suratList.filter(s => s.projectId === project.id)
    const suratDocs: Array<{ name: string; webViewLink: string; _isSuratLampiran?: boolean }> = []
    relatedSurat.forEach(surat => {
      const sDocs = Array.isArray(surat.documents) ? surat.documents : []
      sDocs.forEach((doc: any, idx: number) => {
        if (doc.webViewLink) {
          suratDocs.push({
            name: `Lampiran ${surat.nomorSurat}${sDocs.length > 1 ? ` (${idx + 1})` : ''}`,
            webViewLink: doc.webViewLink,
            _isSuratLampiran: true
          })
        }
      })
      if (surat.driveFolderLink && sDocs.length === 0) {
        suratDocs.push({
          name: `Folder Surat ${surat.nomorSurat}`,
          webViewLink: surat.driveFolderLink,
          _isSuratLampiran: true
        })
      }
    })
    
    return { manager, docs: [...suratDocs, ...docs] }
  }

  // Filter completed projects based on selected user and date range
  const completedProjects = projects.filter(p => p.currentStage === 5)
  
  const filteredProjects = completedProjects.filter(p => {
    // User filter
    if (selectedUserId !== 'all') {
      const isUserMatch = p.tasks.some(t => t.assignedTo === selectedUserId) || p.managerId === selectedUserId
      if (!isUserMatch) return false
    }
    // Date range filter (based on createdAt)
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

  const formatDateTime = (dateString: string) => {
    if (!dateString) return '-'
    const d = new Date(dateString)
    return d.toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short' })
  }

  const formatDateShort = (dateString: string) => {
    if (!dateString) return '-'
    const d = new Date(dateString)
    return d.toLocaleDateString('id-ID')
  }

  // Get all result links from a task (NO surat lampiran fallback - lampiran only belongs to Tahap 0 Manager)
  const getTaskResultLinks = (task: { data?: { link?: string; publishLinks?: { id: string; platform: string; url: string }[]; notes?: string } }) => {
    const links: { platform: string; label: string; icon: string; url: string }[] = []
    
    // Add publish links if available
    if (task.data?.publishLinks && task.data.publishLinks.length > 0) {
      task.data.publishLinks.forEach(pl => {
        const platformInfo = getPlatformInfo(pl.platform)
        links.push({
          platform: pl.platform,
          label: platformInfo.label,
          icon: platformInfo.icon,
          url: pl.url
        })
      })
    }
    
    // Add single link if available (for non-publisher roles)
    if (task.data?.link && links.length === 0) {
      links.push({
        platform: 'other',
        label: 'Tautan Hasil',
        icon: '🔗',
        url: task.data.link
      })
    }
    
    return links
  }

  // Get fallback notes text
  const getFallbackNotes = (taskNotes?: string) => {
    return taskNotes || 'Selesai tanpa tautan'
  }

  // Export single project to Excel
  const handleExportProjectToExcel = (project: typeof projects[0]) => {
    const wb = XLSX.utils.book_new()
    
    // Project Info Sheet
    const projectInfo = [
      ['LAPORAN KEGIATAN PROYEK PUSHAKIN'],
      [''],
      ['ID Proyek', project.id],
      ['Judul Kegiatan', project.title],
      ['Unit Pemohon', project.requesterUnit],
      ['Lokasi', project.location || '-'],
      ['Waktu Pelaksanaan', formatDateTime(project.executionTime || project.createdAt)],
      ['PIC', `${project.picName || '-'} (${project.picWhatsApp || '-'})`],
      [''],
      ['RINCIAN TUGAS DAN HASIL'],
      ['Tahap', 'Peran', 'Petugas', 'Status', 'Platform', 'Tautan Hasil Produksi']
    ]
    
    // Add Manager row (Tahap 0: Pra-produksi) — selalu tampilkan
    const mgrEntry = getManagerEntry(project)
    if (mgrEntry) {
      if (mgrEntry.docs.length > 0) {
        mgrEntry.docs.forEach((doc, idx) => {
          projectInfo.push([
            idx === 0 ? 'Tahap 0 (Pra-produksi)' : '',
            idx === 0 ? mgrEntry.manager.role : '',
            idx === 0 ? mgrEntry.manager.name : '',
            idx === 0 ? 'Selesai' : '',
            idx === 0 ? 'Surat Permohonan' : doc.name,
            doc.webViewLink || '-'
          ])
        })
      } else {
        projectInfo.push([
          'Tahap 0 (Pra-produksi)',
          mgrEntry.manager.role,
          mgrEntry.manager.name,
          'Selesai',
          'Inisiasi Proyek',
          '-'
        ])
      }
    }

    project.tasks.forEach(t => {
      const user = users.find(u => u.id === t.assignedTo)
      const userName = user ? user.name : 'Tidak ada'
      const links = getTaskResultLinks(t)
      
      if (links.length > 0) {
        // Add each link as a separate row
        links.forEach((link, idx) => {
          projectInfo.push([
            idx === 0 ? `Tahap ${t.stage}` : '',
            idx === 0 ? t.role : '',
            idx === 0 ? userName : '',
            idx === 0 ? (t.status === 'completed' ? 'Selesai' : 'Belum') : '',
            link.label,
            link.url
          ])
        })
      } else {
        // No links, show notes or default message
        const notes = getFallbackNotes(t.data?.notes)
        projectInfo.push([
          `Tahap ${t.stage}`,
          t.role,
          userName,
          t.status === 'completed' ? 'Selesai' : 'Belum',
          '-',
          notes
        ])
      }
    })
    
    const ws = XLSX.utils.aoa_to_sheet(projectInfo)
    
    // Set column widths
    ws['!cols'] = [
      { wch: 12 },
      { wch: 22 },
      { wch: 20 },
      { wch: 10 },
      { wch: 20 },
      { wch: 60 }
    ]
    
    XLSX.utils.book_append_sheet(wb, ws, 'Laporan Kegiatan')
    
    // Generate and download
    XLSX.writeFile(wb, `Laporan_Kegiatan_${project.id}.xlsx`)
  }

  // Export all filtered projects to Excel
  const handleExportAllToExcel = async () => {
    setIsExportingExcel(true)
    
    try {
      const wb = XLSX.utils.book_new()
      
      // Summary Sheet
      const summaryData = [
        ['REKAP LAPORAN KEGIATAN PUSHAKIN FLOWS'],
        [''],
        ['Tanggal Export', new Date().toLocaleString('id-ID')],
        ['Total Proyek', filteredProjects.length.toString()],
        selectedUserId !== 'all' ? ['Filter User', users.find(u => u.id === selectedUserId)?.name || 'Semua'] : ['Filter User', 'Semua User'],
        [''],
        ['DAFTAR PROYEK'],
        ['No', 'ID Proyek', 'Judul Kegiatan', 'Unit Pemohon', 'Lokasi', 'PIC', 'Waktu Selesai', 'Jumlah Tugas']
      ]
      
      filteredProjects.forEach((project, index) => {
        summaryData.push([
          (index + 1).toString(),
          project.id,
          project.title,
          project.requesterUnit,
          project.location || '-',
          `${project.picName || '-'} (${project.picWhatsApp || '-'})`,
          formatDateTime(project.createdAt),
          project.tasks.length.toString()
        ])
      })
      
      const wsSummary = XLSX.utils.aoa_to_sheet(summaryData)
      wsSummary['!cols'] = [
        { wch: 5 },
        { wch: 20 },
        { wch: 40 },
        { wch: 25 },
        { wch: 20 },
        { wch: 30 },
        { wch: 25 },
        { wch: 12 }
      ]
      XLSX.utils.book_append_sheet(wb, wsSummary, 'Rekap')
      
      // Detail Sheet for each project
      filteredProjects.forEach((project, projectIndex) => {
        const detailData = [
          [`PROYEK ${projectIndex + 1}: ${project.title}`],
          [''],
          ['ID Proyek', project.id],
          ['Judul Kegiatan', project.title],
          ['Unit Pemohon', project.requesterUnit],
          ['Lokasi', project.location || '-'],
          ['Waktu Pelaksanaan', formatDateTime(project.executionTime || project.createdAt)],
          ['PIC', `${project.picName || '-'} (${project.picWhatsApp || '-'})`],
          ['Deskripsi', project.description],
          [''],
          ['RINCIAN TUGAS DAN HASIL PRODUKSI'],
          ['Tahap', 'Peran', 'Petugas', 'Status', 'Platform', 'Tautan Hasil Produksi']
        ]
        
        // Add Manager row (Tahap 0: Pra-produksi) — selalu tampilkan
        const mgrEntryAll = getManagerEntry(project)
        if (mgrEntryAll) {
          if (mgrEntryAll.docs.length > 0) {
            mgrEntryAll.docs.forEach((doc, idx) => {
              detailData.push([
                idx === 0 ? 'Tahap 0 (Pra-produksi)' : '',
                idx === 0 ? mgrEntryAll.manager.role : '',
                idx === 0 ? mgrEntryAll.manager.name : '',
                idx === 0 ? 'Selesai' : '',
                idx === 0 ? 'Surat Permohonan' : doc.name,
                doc.webViewLink || '-'
              ])
            })
          } else {
            detailData.push([
              'Tahap 0 (Pra-produksi)',
              mgrEntryAll.manager.role,
              mgrEntryAll.manager.name,
              'Selesai',
              'Inisiasi Proyek',
              '-'
            ])
          }
        }

        project.tasks.forEach(t => {
          const user = users.find(u => u.id === t.assignedTo)
          const userName = user ? user.name : 'Tidak ada'
          const links = getTaskResultLinks(t)
          
          if (links.length > 0) {
            links.forEach((link, idx) => {
              detailData.push([
                idx === 0 ? `Tahap ${t.stage}` : '',
                idx === 0 ? t.role : '',
                idx === 0 ? userName : '',
                idx === 0 ? (t.status === 'completed' ? 'Selesai' : 'Belum') : '',
                link.label,
                link.url
              ])
            })
          } else {
            const notes = getFallbackNotes(t.data?.notes)
            detailData.push([
              `Tahap ${t.stage}`,
              t.role,
              userName,
              t.status === 'completed' ? 'Selesai' : 'Belum',
              '-',
              notes
            ])
          }
        })
        
        // Sheet name must be <= 31 chars
        const sheetName = `Proyek ${projectIndex + 1}`.substring(0, 31)
        const wsDetail = XLSX.utils.aoa_to_sheet(detailData)
        wsDetail['!cols'] = [
          { wch: 12 },
          { wch: 22 },
          { wch: 20 },
          { wch: 10 },
          { wch: 20 },
          { wch: 60 }
        ]
        XLSX.utils.book_append_sheet(wb, wsDetail, sheetName)
      })
      
      // Generate filename with date
      const dateStr = new Date().toISOString().split('T')[0]
      const fileName = selectedUserId === 'all' 
        ? `Rekap_Laporan_${dateStr}.xlsx`
        : `Rekap_Laporan_${users.find(u => u.id === selectedUserId)?.name || 'User'}_${dateStr}.xlsx`
      
      XLSX.writeFile(wb, fileName)
    } catch (error) {
      console.error('Error exporting to Excel:', error)
    } finally {
      setIsExportingExcel(false)
    }
  }

  // Export all filtered projects to PDF
  const handleExportAllToPDF = async () => {
    setIsGeneratingPDF(true)
    
    try {
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
      
      // Title Page
      pdf.setFontSize(24)
      pdf.setFont('helvetica', 'bold')
      pdf.text('REKAP LAPORAN KEGIATAN', pageWidth / 2, yPosition, { align: 'center' })
      yPosition += 15
      
      pdf.setFontSize(14)
      pdf.setFont('helvetica', 'normal')
      pdf.text('Pushakin Flows', pageWidth / 2, yPosition, { align: 'center' })
      yPosition += 10
      
      pdf.setFontSize(10)
      pdf.text(`Tanggal Export: ${new Date().toLocaleString('id-ID')}`, pageWidth / 2, yPosition, { align: 'center' })
      yPosition += 6
      
      pdf.text(`Total Proyek: ${filteredProjects.length}`, pageWidth / 2, yPosition, { align: 'center' })
      yPosition += 6
      
      if (selectedUserId !== 'all') {
        const userName = users.find(u => u.id === selectedUserId)?.name || 'Unknown'
        pdf.text(`Filter User: ${userName}`, pageWidth / 2, yPosition, { align: 'center' })
        yPosition += 6
      }
      
      yPosition += 10
      pdf.setLineWidth(0.5)
      pdf.line(margin, yPosition, pageWidth - margin, yPosition)
      yPosition += 15
      
      // Process each project
      for (let projIndex = 0; projIndex < filteredProjects.length; projIndex++) {
        const project = filteredProjects[projIndex]
        
        // Add new page for each project (except first)
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
        
        // Divider
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
        
        // Tasks section
        yPosition += 5
        checkNewPage(15)
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(10)
        pdf.text('RINCIAN TIM & HASIL PRODUKSI', margin, yPosition)
        yPosition += 8
        
        // Manager entry (Tahap 0: Pra-produksi) — selalu tampilkan
        const mgrEntryAllPdf = getManagerEntry(project)
        if (mgrEntryAllPdf) {
          const docLinks = mgrEntryAllPdf.docs.filter(d => d.webViewLink)
          const mgrBoxH = docLinks.length > 0
            ? Math.max(25, 18 + (docLinks.length * 7))
            : 18
          checkNewPage(mgrBoxH)
          
          pdf.setDrawColor(5, 150, 105)
          pdf.setFillColor(240, 253, 244)
          pdf.roundedRect(margin, yPosition, contentWidth, mgrBoxH, 2, 2, 'FD')
          
          const mgrY = yPosition + 5
          pdf.setFont('helvetica', 'bold')
          pdf.setFontSize(8)
          pdf.text('Tahap 0 (Pra-produksi)', margin + 5, mgrY)
          
          pdf.setFontSize(9)
          pdf.text(mgrEntryAllPdf.manager.role, margin + 42, mgrY)
          
          pdf.setTextColor(34, 197, 94)
          pdf.setFontSize(7)
          pdf.text('TUNTAS', pageWidth - margin - 15, mgrY)
          pdf.setTextColor(0, 0, 0)
          
          pdf.setFont('helvetica', 'normal')
          pdf.setFontSize(8)
          pdf.text(`Inisiasi oleh: ${mgrEntryAllPdf.manager.name}`, margin + 5, mgrY + 5)
          
          if (docLinks.length > 0) {
            pdf.setFontSize(7)
            pdf.setFont('helvetica', 'bold')
            pdf.text('Surat Permohonan:', margin + 5, mgrY + 11)
            pdf.setFont('helvetica', 'normal')
            docLinks.slice(0, 3).forEach((doc, idx) => {
              const linkY = mgrY + 16 + (idx * 7)
              pdf.setFontSize(7)
              pdf.setTextColor(100, 100, 100)
              pdf.text(`[${doc.name.substring(0, 25)}]:`, margin + 5, linkY)
              pdf.setTextColor(0, 0, 0)
              const urlLines = pdf.splitTextToSize(doc.webViewLink, contentWidth - 55)
              pdf.setFontSize(7)
              urlLines.slice(0, 1).forEach((line: string) => {
                pdf.text(line, margin + 50, linkY)
              })
            })
          }
          yPosition += mgrBoxH + 3
        }

        // Task items
        project.tasks.forEach((task) => {
          const user = users.find(u => u.id === task.assignedTo)
          const userName = user ? user.name : 'Unknown'
          const links = getTaskResultLinks(task)
          
          // Calculate required space based on number of links
          const requiredSpace = Math.max(30, 20 + (links.length * 8))
          checkNewPage(requiredSpace)
          
          // Task box background
          const boxHeight = Math.max(25, 18 + (links.length * 8))
          pdf.setDrawColor(200, 200, 200)
          pdf.setFillColor(249, 250, 251)
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
          pdf.text(`Dikerjakan oleh: ${userName}`, margin + 5, taskY + 5)
          
          // Show links
          if (links.length > 0) {
            pdf.setFontSize(7)
            pdf.setFont('helvetica', 'bold')
            pdf.text('Hasil Produksi:', margin + 5, taskY + 11)
            pdf.setFont('helvetica', 'normal')
            
            links.forEach((link, idx) => {
              const linkY = taskY + 16 + (idx * 7)
              pdf.setFontSize(7)
              pdf.setTextColor(100, 100, 100)
              // Don't use emoji in PDF - jsPDF doesn't support it
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
        
        // Footer for each project
        yPosition += 5
        checkNewPage(10)
        pdf.setLineWidth(0.1)
        pdf.line(margin, yPosition, pageWidth - margin, yPosition)
        yPosition += 5
        pdf.setFontSize(7)
        pdf.setTextColor(150, 150, 150)
        pdf.text(`Proyek ${projIndex + 1} dari ${filteredProjects.length}`, pageWidth / 2, yPosition, { align: 'center' })
        pdf.setTextColor(0, 0, 0)
      }
      
      // Final footer
      yPosition = pageHeight - 10
      pdf.setFontSize(7)
      pdf.setTextColor(150, 150, 150)
      pdf.text('Dokumen di-generate oleh Sistem Pushakin Flows', pageWidth / 2, yPosition, { align: 'center' })
      
      // Save PDF
      const dateStr = new Date().toISOString().split('T')[0]
      const fileName = selectedUserId === 'all' 
        ? `Rekap_Laporan_${dateStr}.pdf`
        : `Rekap_Laporan_${users.find(u => u.id === selectedUserId)?.name || 'User'}_${dateStr}.pdf`
      
      pdf.save(fileName)
      
    } catch (error) {
      console.error('Error generating PDF:', error)
    } finally {
      setIsGeneratingPDF(false)
    }
  }

  const handleGeneratePDF = async () => {
    if (!printRef.current) return
    
    setIsGeneratingPDF(true)
    
    try {
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
      
      const addWrappedText = (text: string, x: number, y: number, maxWidth: number, lineHeight: number) => {
        const lines = pdf.splitTextToSize(text, maxWidth)
        lines.forEach((line: string, index: number) => {
          checkNewPage(lineHeight)
          pdf.text(line, x, y + (index * lineHeight))
        })
        return lines.length * lineHeight
      }
      
      const report = filteredProjects.find(p => p.id === selectedProjectId)
      if (!report) return
      
      // Header
      pdf.setFontSize(20)
      pdf.setFont('helvetica', 'bold')
      pdf.text('LAPORAN KEGIATAN', pageWidth / 2, yPosition, { align: 'center' })
      yPosition += 10
      
      pdf.setFontSize(14)
      pdf.setFont('helvetica', 'normal')
      pdf.text(report.title, pageWidth / 2, yPosition, { align: 'center' })
      yPosition += 8
      
      pdf.setFontSize(9)
      pdf.setFont('helvetica', 'normal')
      pdf.text(`Ref ID: ${report.id}`, pageWidth / 2, yPosition, { align: 'center' })
      yPosition += 10
      
      // Divider line
      pdf.setLineWidth(0.5)
      pdf.line(margin, yPosition, pageWidth - margin, yPosition)
      yPosition += 10
      
      // Info Grid
      pdf.setFontSize(10)
      const infoItems = [
        { label: 'Unit Pemohon', value: report.requesterUnit },
        { label: 'Waktu Selesai', value: formatDateTime(report.createdAt) },
        { label: 'Lokasi', value: report.location || '-' },
        { label: 'PIC', value: `${report.picName || '-'} (${report.picWhatsApp || '-'})` }
      ]
      
      for (let i = 0; i < infoItems.length; i += 2) {
        checkNewPage(15)
        
        // Left column
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(8)
        pdf.text(infoItems[i].label.toUpperCase(), margin, yPosition)
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(10)
        pdf.text(infoItems[i].value, margin, yPosition + 5)
        
        // Right column
        if (infoItems[i + 1]) {
          pdf.setFont('helvetica', 'bold')
          pdf.setFontSize(8)
          pdf.text(infoItems[i + 1].label.toUpperCase(), pageWidth / 2, yPosition)
          pdf.setFont('helvetica', 'normal')
          pdf.setFontSize(10)
          pdf.text(infoItems[i + 1].value, pageWidth / 2, yPosition + 5)
        }
        
        yPosition += 12
      }
      
      // Divider
      yPosition += 5
      pdf.setLineWidth(0.2)
      pdf.line(margin, yPosition, pageWidth - margin, yPosition)
      yPosition += 8
      
      // Description section
      checkNewPage(20)
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(10)
      pdf.text('RINCIAN INSTRUKSI MANAGER', margin, yPosition)
      yPosition += 6
      
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(9)
      const descHeight = addWrappedText(report.description, margin, yPosition, contentWidth, 5)
      yPosition += descHeight + 5
      
      // Activity Types & Output Needs
      if (report.activityTypes.length > 0 || report.outputNeeds.length > 0) {
        checkNewPage(10)
        pdf.setFontSize(8)
        pdf.setFont('helvetica', 'bold')
        pdf.text('Jenis Kegiatan: ', margin, yPosition)
        pdf.setFont('helvetica', 'normal')
        const activities = report.activityTypes.join(', ')
        pdf.text(activities, margin + 30, yPosition)
        yPosition += 5
        
        pdf.setFont('helvetica', 'bold')
        pdf.text('Kebutuhan Output: ', margin, yPosition)
        pdf.setFont('helvetica', 'normal')
        const outputs = report.outputNeeds.join(', ')
        pdf.text(outputs, margin + 35, yPosition)
        yPosition += 10
      }
      
      // Divider
      pdf.setLineWidth(0.2)
      pdf.line(margin, yPosition, pageWidth - margin, yPosition)
      yPosition += 8
      
      // Tasks section
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(10)
      pdf.text('REKAPITULASI TIM & HASIL PRODUKSI', margin, yPosition)
      yPosition += 8
      
      // Manager entry (Tahap 0: Pra-produksi) — selalu tampilkan
      const mgrEntryPdf = getManagerEntry(report)
      if (mgrEntryPdf) {
        const docLinksPdf = mgrEntryPdf.docs.filter(d => d.webViewLink)
        const mgrBoxH = docLinksPdf.length > 0
          ? Math.max(30, 22 + (docLinksPdf.length * 8))
          : 18
        checkNewPage(mgrBoxH)
        
        pdf.setDrawColor(5, 150, 105)
        pdf.setFillColor(240, 253, 244)
        pdf.roundedRect(margin, yPosition, contentWidth, mgrBoxH, 2, 2, 'FD')
        
        const mgrY = yPosition + 5
        
        // Tahap badge
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(8)
        pdf.text('Tahap 0 (Pra-produksi)', margin + 5, mgrY)
        
        // Role
        pdf.setFontSize(10)
        pdf.text(mgrEntryPdf.manager.role, margin + 42, mgrY)
        
        // Status
        pdf.setTextColor(34, 197, 94)
        pdf.setFontSize(8)
        pdf.text('TUNTAS', pageWidth - margin - 15, mgrY)
        pdf.setTextColor(0, 0, 0)
        
        // User
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(9)
        pdf.text(`Inisiasi oleh: ${mgrEntryPdf.manager.name}`, margin + 5, mgrY + 6)
        
        // Document links
        if (docLinksPdf.length > 0) {
          pdf.setFontSize(8)
          pdf.setFont('helvetica', 'bold')
          pdf.text('Surat Permohonan:', margin + 5, mgrY + 12)
          pdf.setFont('helvetica', 'normal')
          
          docLinksPdf.slice(0, 4).forEach((doc, idx) => {
            const linkY = mgrY + 17 + (idx * 8)
            pdf.setFontSize(7)
            pdf.setTextColor(100, 100, 100)
            pdf.text(`[${doc.name.substring(0, 25)}]`, margin + 5, linkY)
            pdf.setTextColor(0, 0, 0)
            const urlLines = pdf.splitTextToSize(doc.webViewLink, contentWidth - 10)
            pdf.setFontSize(8)
            urlLines.slice(0, 2).forEach((line: string, i: number) => {
              pdf.text(line, margin + 5, linkY + 4 + (i * 4))
            })
          })
        }
        
        yPosition += mgrBoxH + 5
      }

      // Task items
      report.tasks.forEach((task) => {
        const user = users.find(u => u.id === task.assignedTo)
        const userName = user ? user.name : 'Unknown'
        const links = getTaskResultLinks(task)
        
        // Calculate required space based on number of links
        const requiredSpace = Math.max(35, 25 + (links.length * 10))
        checkNewPage(requiredSpace)
        
        // Task box - dynamic height based on content
        const boxHeight = Math.max(30, 22 + (links.length * 10))
        pdf.setDrawColor(200, 200, 200)
        pdf.setFillColor(249, 250, 251)
        pdf.roundedRect(margin, yPosition, contentWidth, boxHeight, 2, 2, 'FD')
        
        const taskY = yPosition + 5
        
        // Tahap badge
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(8)
        pdf.text(`Tahap ${task.stage}`, margin + 5, taskY)
        
        // Role
        pdf.setFontSize(10)
        pdf.text(task.role, margin + 25, taskY)
        
        // Status
        pdf.setTextColor(34, 197, 94)
        pdf.setFontSize(8)
        pdf.text('TUNTAS', pageWidth - margin - 15, taskY)
        pdf.setTextColor(0, 0, 0)
        
        // User
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(9)
        pdf.text(`Dikerjakan oleh: ${userName}`, margin + 5, taskY + 6)
        
        // Show links
        if (links.length > 0) {
          pdf.setFontSize(8)
          pdf.setFont('helvetica', 'bold')
          pdf.text('Link Hasil Produksi:', margin + 5, taskY + 12)
          pdf.setFont('helvetica', 'normal')
          
          links.forEach((link, idx) => {
            const linkY = taskY + 17 + (idx * 9)
            
            // Platform label - don't use emoji in PDF
            pdf.setFontSize(7)
            pdf.setTextColor(100, 100, 100)
            pdf.text(`[${link.label}]`, margin + 5, linkY)
            pdf.setTextColor(0, 0, 0)
            
            // URL
            const urlLines = pdf.splitTextToSize(link.url, contentWidth - 10)
            pdf.setFontSize(8)
            urlLines.slice(0, 2).forEach((line: string, i: number) => {
              pdf.text(line, margin + 5, linkY + 4 + (i * 4))
            })
          })
        } else {
          // No links - show notes
          pdf.setFontSize(8)
          pdf.setFont('helvetica', 'bold')
          pdf.text('Catatan:', margin + 5, taskY + 12)
          pdf.setFont('helvetica', 'normal')
          const notes = getFallbackNotes(task.data?.notes)
          const noteLines = pdf.splitTextToSize(notes, contentWidth - 10)
          pdf.setFontSize(8)
          noteLines.slice(0, 2).forEach((line: string, i: number) => {
            pdf.text(line, margin + 5, taskY + 17 + (i * 4))
          })
        }
        
        yPosition += boxHeight + 5
      })
      
      // Footer
      yPosition += 10
      checkNewPage(15)
      pdf.setLineWidth(0.2)
      pdf.line(margin, yPosition, pageWidth - margin, yPosition)
      yPosition += 8
      pdf.setFontSize(8)
      pdf.setTextColor(150, 150, 150)
      pdf.text('Dokumen ini di-generate secara otomatis oleh Sistem Pushakin Flows.', pageWidth / 2, yPosition, { align: 'center' })
      pdf.text(`Dicetak pada: ${new Date().toLocaleString('id-ID')}`, pageWidth / 2, yPosition + 5, { align: 'center' })
      
      // Save PDF
      pdf.save(`Laporan_Kegiatan_${report.id}.pdf`)
      
    } catch (error) {
      console.error('Error generating PDF:', error)
    } finally {
      setIsGeneratingPDF(false)
    }
  }

  // Detail View
  if (selectedProjectId) {
    const report = filteredProjects.find(p => p.id === selectedProjectId)
    if (!report) return null

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
          <div className="flex gap-2 sm:gap-3">
            <Button
              variant="outline"
              onClick={() => handleExportProjectToExcel(report)}
              className="gap-2 bg-green-50 text-green-700 hover:bg-green-100 border-green-200"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Unduh Excel</span>
            </Button>
            <Button
              onClick={handleGeneratePDF}
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
        </div>

        {/* Preview Area */}
        <Card ref={printRef}>
          <CardContent className="p-4 sm:p-6 lg:p-10">
            <div className="text-center mb-10 pb-6 border-b-2 border-stone-800">
              <h1 className="text-3xl font-bold text-stone-900 uppercase tracking-widest mb-2">
                Laporan Kegiatan
              </h1>
              <p className="text-lg text-stone-600">{report.title}</p>
              <div className="mt-4 inline-block bg-stone-100 px-4 py-1 rounded-full text-xs font-mono text-stone-600 font-bold border border-stone-200">
                Ref ID: {report.id}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-12 mb-10">
              <div>
                <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-1">
                  Unit Pemohon
                </p>
                <p className="font-semibold text-stone-800 text-lg">{report.requesterUnit}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-1">
                  Waktu Selesai Keseluruhan
                </p>
                <p className="font-semibold text-stone-800 text-lg">{formatDateTime(report.createdAt)}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-1">
                  Lokasi Pelaksanaan
                </p>
                <p className="font-semibold text-stone-800">{report.location || '-'}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-1">
                  Penanggung Jawab (PIC)
                </p>
                <p className="font-semibold text-stone-800">
                  {report.picName || '-'} ({report.picWhatsApp || '-'})
                </p>
              </div>
            </div>

            <div className="mb-10">
              <h3 className="text-sm font-bold text-stone-800 uppercase tracking-wider mb-4 border-b border-stone-200 pb-2">
                Rincian Instruksi Manager
              </h3>
              <p className="text-sm text-stone-700 leading-relaxed whitespace-pre-line">
                {report.description}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {report.activityTypes.map(k => (
                  <Badge key={k} variant="outline" className="bg-stone-100 text-stone-600">
                    {k}
                  </Badge>
                ))}
                {report.outputNeeds.map(o => (
                  <Badge key={o} variant="outline" className="bg-violet-50 text-violet-700">
                    {o}
                  </Badge>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-bold text-stone-800 uppercase tracking-wider mb-4 border-b border-stone-200 pb-2">
                Rekapitulasi Tim & Hasil Produksi
              </h3>
              <div className="space-y-4">
                {(() => {
                  const mgr = getManagerEntry(report)
                  if (!mgr) return null
                  return (
                    <div className="bg-emerald-50/60 border border-emerald-200 rounded-xl p-4">
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-3">
                          <Badge variant="outline" className="bg-emerald-200 text-emerald-800 font-bold">
                            Tahap 0 (Pra-produksi)
                          </Badge>
                          <span className="font-bold text-stone-800">{getRoleDisplayName(mgr.manager.role)}</span>
                          {mgr.docs.length > 0 && (
                            <Badge variant="outline" className="bg-emerald-100 text-emerald-700 text-[10px]">
                              {mgr.docs.length} dokumen arsip
                            </Badge>
                          )}
                        </div>
                        <span className="text-xs font-medium text-stone-500 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-green-600" />
                          <span>Tuntas</span>
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-stone-600 mb-3">
                        <UserCircle className="w-4 h-4 text-stone-400" />
                        <span>Inisiasi oleh: <strong className="text-stone-800">{mgr.manager.name}</strong></span>
                      </div>
                      {mgr.docs.length > 0 ? (
                      <div className="bg-white p-3 rounded-lg border border-emerald-200 text-sm">
                        <strong className="block text-xs uppercase tracking-wider text-stone-400 mb-2">
                          Surat Permohonan & Dokumen Pendukung:
                        </strong>
                        <div className="space-y-2">
                          {mgr.docs.map((doc, idx) => (
                            <div key={idx} className="flex items-start gap-3 p-2 bg-emerald-50/50 rounded-lg border border-emerald-100">
                              <span className="text-lg flex-shrink-0">📎</span>
                              <div className="flex-1 min-w-0">
                                <div className="text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-0.5">
                                  {doc.name}
                                </div>
                                {doc.webViewLink ? (
                                  <a href={doc.webViewLink} target="_blank" rel="noreferrer" className="text-emerald-700 hover:text-emerald-900 underline break-all text-sm flex items-center gap-1">
                                    {doc.webViewLink}
                                    <ExternalLink className="w-3 h-3 flex-shrink-0" />
                                  </a>
                                ) : (
                                  <span className="text-stone-400 italic text-xs">Tersimpan di arsip lokal</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      ) : (
                        <p className="text-xs text-stone-400 italic px-1">Tidak ada dokumen pendukung yang diunggah saat inisiasi.</p>
                      )}
                    </div>
                  )
                })()}
                {report.tasks.map(task => {
                  const user = users.find(u => u.id === task.assignedTo)
                  const links = getTaskResultLinks(task)
                  const isPublisher = isPublisherRole(task.role)
                  
                  return (
                    <div
                      key={task.id}
                      className="bg-stone-50 border border-stone-200 rounded-xl p-4"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-3">
                          <Badge variant="outline" className="bg-stone-200 text-stone-600 font-bold">
                            Tahap {task.stage}
                          </Badge>
                          <span className="font-bold text-stone-800">{getRoleDisplayName(task.role)}</span>
                          {isPublisher && links.length > 0 && (
                            <Badge variant="outline" className="bg-green-50 text-green-700 text-[10px]">
                              {links.length} link produksi
                            </Badge>
                          )}
                        </div>
                        <span className="text-xs font-medium text-stone-500 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-green-600" />
                          <span>Tuntas</span>
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-stone-600 mb-3">
                        <UserCircle className="w-4 h-4 text-stone-400" />
                        <span>Dikerjakan oleh: <strong className="text-stone-800">{user ? user.name : 'Unknown'}</strong></span>
                      </div>
                      
                      <div className="bg-white p-3 rounded-lg border border-stone-200 text-sm">
                        <strong className="block text-xs uppercase tracking-wider text-stone-400 mb-2">
                          {links.length > 0 ? 'Link Hasil Produksi:' : 'Catatan:'}
                        </strong>
                        
                        {links.length > 0 ? (
                          <div className="space-y-2">
                            {links.map((link, idx) => (
                              <div key={idx} className="flex items-start gap-3 p-2 bg-stone-50 rounded-lg border border-stone-100">
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
                })}
              </div>
            </div>
            
            <div className="mt-12 pt-8 border-t border-stone-200 text-center text-xs text-stone-400">
              Dokumen ini di-generate secara otomatis oleh Sistem Pushakin Flows.
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // List View
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <Card>
        <CardContent className="p-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="bg-gradient-to-br from-violet-100 to-purple-100 p-2 rounded-xl text-violet-600">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <h2 className="text-2xl font-bold text-slate-800">Laporan & Rekap Kegiatan</h2>
          </div>
          <p className="text-stone-500">
            Daftar arsip proyek yang telah selesai (Tahap 4) dan siap diunduh untuk kebutuhan pelaporan manajerial.
          </p>
        </CardContent>
      </Card>

      {/* Filter Section */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col gap-4">
            {/* Row 1: User filter + Date range filter */}
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-stone-500" />
                <span className="text-sm font-medium text-stone-700">User:</span>
              </div>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Pilih user..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua User</SelectItem>
                  {users.map(user => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="w-px h-8 bg-stone-200 hidden sm:block" />

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

            {/* Row 2: Export buttons + filter status */}
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3">
                {(selectedUserId !== 'all' || hasDateFilter) && (
                  <div className="flex flex-wrap items-center gap-2">
                    {selectedUserId !== 'all' && (
                      <Badge variant="secondary" className="gap-1.5 px-3 py-1 text-xs font-medium">
                        <Users className="w-3 h-3" />
                        {users.find(u => u.id === selectedUserId)?.name}
                      </Badge>
                    )}
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
              </div>
              
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={handleExportAllToExcel}
                  disabled={isExportingExcel || filteredProjects.length === 0}
                  className="gap-2 bg-green-50 text-green-700 hover:bg-green-100 border-green-200"
                >
                  {isExportingExcel ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <FileSpreadsheet className="w-4 h-4" />
                  )}
                  <span>{isExportingExcel ? 'Mengekspor...' : 'Export Excel'}</span>
                </Button>
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
          </div>
        </CardContent>
      </Card>

      {filteredProjects.length === 0 ? (
        <Card className="p-12 text-center">
          <CardContent className="pt-6">
            <FileText className="w-16 h-16 text-stone-300 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-stone-800">Tidak Ada Laporan</h3>
            <p className="text-stone-500 mt-2">
              {selectedUserId === 'all' 
                ? 'Laporan akan muncul otomatis ketika sebuah proyek telah menyelesaikan proses Publikasi.'
                : 'Tidak ada proyek yang dikerjakan oleh user tersebut.'
              }
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredProjects.map(project => (
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
                <div className="text-xs text-stone-500">
                  <span className="block mb-1">
                    Unit: <strong className="text-stone-700">{project.requesterUnit}</strong>
                  </span>
                  <span>Waktu: {formatDateTime(project.createdAt)}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

