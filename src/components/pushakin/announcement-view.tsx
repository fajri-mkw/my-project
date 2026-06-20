'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { useAppStore } from '@/lib/store'
import {
  Megaphone,
  FileText,
  BookOpen,
  Plus,
  Edit,
  Trash2,
  Eye,
  EyeOff,
  Loader2,
  Calendar,
  User,
  ImageIcon,
  FileImage,
  X,
  ChevronUp,
  ChevronDown,
  Download
} from 'lucide-react'
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } from 'docx'
import { saveAs } from 'file-saver'
import { cn } from '@/lib/utils'

interface SOPItem {
  id: string
  title: string
  content: string
  type: 'SOP' | 'Pengumuman' | 'Panduan'
  displayMode: 'text' | 'static' | 'slideshow' | 'pdf'
  files: string | null
  slideshowSpeed: number
  published: boolean
  order: number
  authorId: string
  createdAt: string
  updatedAt: string
  author: {
    id: string
    name: string
    email: string
    role: string
  }
}

export function AnnouncementView() {
  const { currentUser, showAlert } = useAppStore()
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [items, setItems] = useState<SOPItem[]>([])
  const [activeTab, setActiveTab] = useState<'Pengumuman' | 'SOP' | 'Panduan'>('Pengumuman')
  const [previewFile, setPreviewFile] = useState<{ url: string; type: 'pdf' | 'image' } | null>(null)
  const [previewIndex, setPreviewIndex] = useState(0)

  const canManage = currentUser?.role === 'Admin' || currentUser?.role === 'Manager'

  // Form state
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<SOPItem | null>(null)
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    type: 'Pengumuman' as 'SOP' | 'Pengumuman' | 'Panduan',
    displayMode: 'text' as 'text' | 'static' | 'slideshow' | 'pdf',
    files: [] as string[],
    slideshowSpeed: 5000,
    published: false,
    order: 0
  })

  // Fetch items — non-managers only see published items
  const fetchItems = async () => {
    try {
      const params = new URLSearchParams({ type: activeTab })
      if (!canManage) {
        params.set('published', 'true')
      }
      const response = await fetch(`/api/sop?${params}`)
      if (response.ok) {
        const data = await response.json()
        setItems(data)
      }
    } catch (error) {
      console.error('Failed to fetch items:', error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchItems()
  }, [activeTab])

  // Reset form
  const resetForm = () => {
    setFormData({
      title: '',
      content: '',
      type: activeTab,
      displayMode: 'text',
      files: [],
      slideshowSpeed: 5000,
      published: false,
      order: 0
    })
    setEditingItem(null)
  }

  // Open create dialog
  const openCreateDialog = () => {
    resetForm()
    setFormData(prev => ({ ...prev, type: activeTab }))
    setIsDialogOpen(true)
  }

  // Open edit dialog
  const openEditDialog = (item: SOPItem) => {
    setEditingItem(item)
    setFormData({
      title: item.title,
      content: item.content,
      type: item.type,
      displayMode: item.displayMode,
      files: item.files ? JSON.parse(item.files) : [],
      slideshowSpeed: item.slideshowSpeed,
      published: item.published,
      order: item.order
    })
    setIsDialogOpen(true)
  }

  // Handle file upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    Array.from(files).forEach(file => {
      const reader = new FileReader()
      reader.onload = (event) => {
        const base64 = event.target?.result as string
        setFormData(prev => ({
          ...prev,
          files: [...prev.files, base64]
        }))
      }
      reader.readAsDataURL(file)
    })
  }

  // Remove file
  const removeFile = (index: number) => {
    setFormData(prev => ({
      ...prev,
      files: prev.files.filter((_, i) => i !== index)
    }))
  }

  // Save item
  const handleSave = async () => {
    if (!formData.title.trim() || !formData.content.trim()) {
      showAlert('Judul dan konten wajib diisi')
      return
    }

    setIsSaving(true)
    try {
      const payload = {
        ...formData,
        authorId: currentUser?.id,
        files: formData.files.length > 0 ? formData.files : null
      }

      let response
      if (editingItem) {
        response = await fetch('/api/sop', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editingItem.id, ...payload })
        })
      } else {
        response = await fetch('/api/sop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
      }

      if (response.ok) {
        showAlert(editingItem ? 'Berhasil diperbarui!' : 'Berhasil dibuat!')
        setIsDialogOpen(false)
        resetForm()
        fetchItems()
      } else {
        const data = await response.json()
        showAlert(data.error || 'Gagal menyimpan')
      }
    } catch (error) {
      console.error('Error saving:', error)
      showAlert('Terjadi kesalahan')
    } finally {
      setIsSaving(false)
    }
  }

  // Delete item
  const handleDelete = async (id: string) => {
    if (!confirm('Yakin ingin menghapus item ini?')) return

    try {
      const response = await fetch(`/api/sop?id=${id}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        showAlert('Berhasil dihapus!')
        fetchItems()
      } else {
        showAlert('Gagal menghapus')
      }
    } catch (error) {
      console.error('Error deleting:', error)
      showAlert('Terjadi kesalahan')
    }
  }

  // Toggle publish status
  const togglePublish = async (item: SOPItem) => {
    try {
      const response = await fetch('/api/sop', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: item.id,
          published: !item.published
        })
      })

      if (response.ok) {
        showAlert(item.published ? 'Dipindahkan ke draft!' : 'Dipublikasikan!')
        fetchItems()
      }
    } catch (error) {
      console.error('Error toggling publish:', error)
    }
  }

  // Move order
  const moveOrder = async (item: SOPItem, direction: 'up' | 'down') => {
    const currentIndex = items.findIndex(i => i.id === item.id)
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1

    if (targetIndex < 0 || targetIndex >= items.length) return

    const targetItem = items[targetIndex]

    try {
      await Promise.all([
        fetch('/api/sop', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: item.id, order: targetItem.order })
        }),
        fetch('/api/sop', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: targetItem.id, order: item.order })
        })
      ])

      fetchItems()
    } catch (error) {
      console.error('Error moving order:', error)
    }
  }

  const getTabIcon = (tab: string) => {
    switch (tab) {
      case 'Pengumuman': return <Megaphone className="w-4 h-4" />
      case 'SOP': return <FileText className="w-4 h-4" />
      case 'Panduan': return <BookOpen className="w-4 h-4" />
      default: return <FileText className="w-4 h-4" />
    }
  }

  // Download as DOCX
  const downloadAsDocx = async (item: SOPItem) => {
    try {
      const paragraphs: Paragraph[] = []

      // Title
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: item.title,
              bold: true,
              size: 32, // 16pt
              font: 'Calibri'
            })
          ],
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 }
        })
      )

      // Type badge
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `Tipe: ${item.type}`,
              italics: true,
              size: 20,
              color: '666666',
              font: 'Calibri'
            })
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 }
        })
      )

      // Author & date
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `Oleh: ${item.author.name} | ${new Date(item.createdAt).toLocaleDateString('id-ID', {
                day: 'numeric',
                month: 'long',
                year: 'numeric'
              })}`,
              size: 20,
              color: '888888',
              font: 'Calibri'
            })
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 600 }
        })
      )

      // Separator line
      paragraphs.push(
        new Paragraph({
          children: [],
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' }
          },
          spacing: { after: 400 }
        })
      )

      // Content paragraphs
      const contentLines = item.content.split('\n')
      contentLines.forEach((line) => {
        const trimmed = line.trim()
        if (!trimmed) {
          paragraphs.push(new Paragraph({ children: [], spacing: { after: 200 } }))
          return
        }

        // Detect headings (lines starting with # or all caps short lines)
        if (trimmed.startsWith('# ')) {
          paragraphs.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: trimmed.replace(/^#\s+/, ''),
                  bold: true,
                  size: 28,
                  font: 'Calibri'
                })
              ],
              heading: HeadingLevel.HEADING_2,
              spacing: { before: 300, after: 200 }
            })
          )
        } else if (trimmed.startsWith('## ')) {
          paragraphs.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: trimmed.replace(/^##\s+/, ''),
                  bold: true,
                  size: 24,
                  font: 'Calibri'
                })
              ],
              heading: HeadingLevel.HEADING_3,
              spacing: { before: 200, after: 150 }
            })
          )
        } else if (trimmed.startsWith('### ')) {
          paragraphs.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: trimmed.replace(/^###\s+/, ''),
                  bold: true,
                  size: 22,
                  font: 'Calibri'
                })
              ],
              spacing: { before: 150, after: 100 }
            })
          )
        } else if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
          // Bullet points
          const bulletText = trimmed.replace(/^[-•]\s+/, '')
          // Handle bold within bullet: **text**
          const parts = bulletText.split(/(\*\*.*?\*\*)/g)
          const children: TextRun[] = [new TextRun({ text: '• ', size: 22, font: 'Calibri' })]
          parts.forEach((part) => {
            if (part.startsWith('**') && part.endsWith('**')) {
              children.push(new TextRun({ text: part.slice(2, -2), bold: true, size: 22, font: 'Calibri' }))
            } else if (part) {
              children.push(new TextRun({ text: part, size: 22, font: 'Calibri' }))
            }
          })
          paragraphs.push(
            new Paragraph({
              children,
              spacing: { after: 80 }
            })
          )
        } else if (/^\d+\.\s/.test(trimmed)) {
          // Numbered lists
          const parts = trimmed.split(/(\*\*.*?\*\*)/g)
          const children: TextRun[] = []
          parts.forEach((part) => {
            if (part.startsWith('**') && part.endsWith('**')) {
              children.push(new TextRun({ text: part.slice(2, -2), bold: true, size: 22, font: 'Calibri' }))
            } else if (part) {
              children.push(new TextRun({ text: part, size: 22, font: 'Calibri' }))
            }
          })
          paragraphs.push(
            new Paragraph({
              children,
              spacing: { after: 80 }
            })
          )
        } else {
          // Regular text — handle inline bold
          const parts = trimmed.split(/(\*\*.*?\*\*)/g)
          const children: TextRun[] = []
          parts.forEach((part) => {
            if (part.startsWith('**') && part.endsWith('**')) {
              children.push(new TextRun({ text: part.slice(2, -2), bold: true, size: 22, font: 'Calibri' }))
            } else if (part) {
              children.push(new TextRun({ text: part, size: 22, font: 'Calibri' }))
            }
          })
          paragraphs.push(
            new Paragraph({
              children,
              spacing: { after: 120 }
            })
          )
        }
      })

      // Footer
      paragraphs.push(
        new Paragraph({
          children: [],
          border: {
            top: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' }
          },
          spacing: { before: 600, after: 200 }
        })
      )
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: 'Dokumen ini dihasilkan dari Pushakin Flows',
              italics: true,
              size: 16,
              color: '999999',
              font: 'Calibri'
            })
          ],
          alignment: AlignmentType.CENTER
        })
      )

      const doc = new Document({
        sections: [
          {
            properties: {
              page: {
                margin: {
                  top: 1440,    // 1 inch
                  right: 1440,
                  bottom: 1440,
                  left: 1440
                }
              }
            },
            children: paragraphs
          }
        ]
      })

      const blob = await Packer.toBlob(doc)
      const fileName = item.title.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_') + '.docx'
      saveAs(blob, fileName)
      showAlert('File berhasil diunduh!')
    } catch (error) {
      console.error('Error generating DOCX:', error)
      showAlert('Gagal mengunduh file')
    }
  }

  const SOP_CONTENT = `# Standar Operasional Prosedur (SOP)
## Sistem Manajemen Produksi Pushakin Flows

---

# 1. Pendahuluan

SOP ini berisi panduan lengkap penggunaan aplikasi **Pushakin Flows** sebagai sistem manajemen produksi konten. Dokumen ini ditujukan untuk seluruh tim agar dapat menggunakan aplikasi secara efektif dan konsisten.

## 1.1 Tujuan
- Menstandarkan proses kerja produksi konten
- Memastikan setiap anggota tim memahami peran dan tanggung jawabnya
- Meminimalkan kesalahan komunikasi antar tim
- Menciptakan alur kerja yang terukur dan dapat dilacak

## 1.2 Ruang Lingkup
SOP ini mencakup seluruh alur kerja dari permohonan hingga publikasi konten melalui sistem Pushakin Flows.

---

# 2. Struktur Peran & Akses

Sistem Pushakin Flows memiliki 3 tingkat akses utama:

## 2.1 Super Admin
- Penguasa penuh sistem
- Mengelola user, pengaturan, dan konten (SOP/Pengumuman/Panduan)
- Dapat mengimpersonasi user lain untuk troubleshooting
- Melihat seluruh data proyek dan statistik

## 2.2 Administrator
- Mengelola surat masuk dan keluar
- Membuat dan meneruskan permohonan ke Manager
- Melihat dashboard dan statistik seluruh proyek

## 2.3 Manager
- Membuat dan mengelola proyek produksi
- Menugaskan tim ke setiap tahapan produksi
- Mengelola Workspace Drive dan dokumen pendukung
- Mengunduh laporan kegiatan (PDF/Excel)
- Melihat Program Kegiatan dan Laporan Kegiatan

## 2.4 Tim Produksi (Staff)
Seluruh staff melihat dashboard, statistik, dan inbox yang sama:

### **Tahap 1 - Produksi**
- **Reporter**: Mengupload materi liputan berupa teks/artikel
- **Photographer, Videographer, dan Audio**: Mengupload foto, video, dan file audio mentah
- **Graphic Designer**: Mengupload file desain grafis mentah

### **Tahap 2 - Pasca Produksi**
- **Editor (Video)**: Mendownload file video mentah, mengedit, dan mengupload hasil editan
- **Editor (Web Article/Author)**: Mendownload file mentah, menyunting artikel/konten web
- **Editor (Foto)**: Mendownload file foto mentah, mengedit, dan mengupload hasil editan
- **Editor (Template Sosial Media)**: Membuat template konten media sosial dari foto hasil editan Editor (Foto) — dikerjakan **STELAH** Editor (Foto) menyelesaikan tugasnya
- **Streaming Operator**: Menempelkan tautan streaming (URL)
- **Podcast Operator**: Menempelkan tautan YouTube/podcast (URL)

### **Tahap 3 - Review**
- **Reviewer**: Melakukan quality control terhadap seluruh hasil Tahap 2 (Pasca Produksi), termasuk template media sosial. Dapat menyetujui (lanjut ke Publikasi) atau menolak (kembali ke Tahap 2)

### **Tahap 4 - Publikasi**
- **Publisher Web**: Mendownload file final, menambahkan tautan publish ke platform web
- **Publisher Social Media**: Mendownload file final, menambahkan tautan publish ke platform media sosial

---

# 3. Alur Kerja Utama

## 3.1 Alur Permohonan

### **Langkah 1: Penerimaan Permohonan**
- Administrator menerima permohonan dari unit/instansi
- Membuat entri permohonan baru di tab **Manajemen Surat**
- Melampirkan dokumen pendukung (surat resmi, proposal, dll)
- Mengisi data: unit pemohon, lokasi, waktu pelaksanaan, PIC, jenis kegiatan, kebutuhan output

### **Langkah 2: Penerusan ke Manager**
- Administrator mengklik **"Teruskan ke Manager"**
- Status berubah menjadi "Diteruskan"
- Manager menerima notifikasi di **Inbox**

### **Langkah 3: Persetujuan Manager**
- Manager membuka permohonan dari Inbox
- Meninjau detail dan dokumen lampiran
- Memilih **"Terima"** (membuat proyek baru) atau **"Tolak"** (dengan alasan)
- Jika diterima, sistem otomatis membuat proyek baru

## 3.2 Alur Proyek Produksi

### **Tahap 0 - Perencanaan (Manager)**
1. Manager melengkapi detail proyek
2. Memilih anggota tim untuk setiap peran yang dibutuhkan
3. Sistem otomatis membuat:
   - Folder Workspace Drive (PRODUKSI & PASCA PRODUKSI sudah tercentang otomatis; tambahan DESAIN dan ADDITIONAL ASSET opsional)
   - Surat Tugas untuk setiap anggota tim
   - Task sesuai peran dan tahapan
   - Akses Download/Upload tiap petugas diisi otomatis sesuai tahapan kerja
4. Manager mengupload dokumen pendukung (laporan kegiatan)

### **Tahap 1 - Produksi**
1. Setiap staff menerima **Surat Tugas** di Inbox
2. Staff membuka proyek melalui tautan di Inbox
3. Staff menyelesaikan tugas sesuai peran:
   - Upload file mentah ke folder yang ditentukan
   - Klik **"Selesai"** pada task card
4. Setelah **semua task Tahap 1 selesai**, proyek otomatis naik ke Tahap 2

### **Tahap 2 - Pasca Produksi**
1. Editor menerima notifikasi bahwa proyek sudah masuk Tahap 2
2. Editor mendownload file mentah dari folder PRODUKSI
3. Editor melakukan proses editing (video, web article, foto)
4. **Editor (Template Sosial Media)** menunggu hingga **Editor (Foto)** menyelesaikan tugasnya, lalu membuat template konten media sosial dari foto hasil editan
5. Editor mengupload hasil editing ke folder PASCA PRODUKSI
6. Streaming/Podcast Operator menempelkan tautan URL
7. Klik **"Selesai"** pada task card
8. Setelah **semua task Tahap 2 selesai** (termasuk Editor (Foto) & Editor (Template Sosial Media)), proyek otomatis naik ke Tahap 3 (Review)

### **Tahap 3 - Review**
1. Reviewer menerima notifikasi
2. Reviewer meninjau seluruh hasil Tahap 2 (Pasca Produksi), termasuk template media sosial
3. Reviewer memilih:
   - **Setujui** → Proyek naik ke Tahap 4 (Publikasi)
   - **Tolak** → Proyek kembali ke Tahap 2, seluruh task Tahap 2 dan 3 di-reset ke status pending
4. Jika ditolak, tim Tahap 2 harus memperbaiki dan mengupload ulang

### **Tahap 4 - Publikasi**
1. Publisher menerima notifikasi
2. Publisher mendownload file final dari folder PASCA PRODUKSI (saat file tugas diteruskan oleh Reviewer)
3. Publisher mempublikasikan ke platform yang ditentukan
4. Publisher menambahkan tautan publish di task card
5. Klik **"Selesai"** pada task card
6. Setelah **semua task Tahap 4 selesai**, proyek otomatis berstatus **Selesai (Tahap 5)**

---

# 4. Panduan Workspace Drive

## 4.1 Struktur Folder
Setiap proyek memiliki 4 pilihan folder (PRODUKSI & PASCA PRODUKSI tercentang otomatis saat inisiasi):

- **PRODUKSI (Berkas Mentah)**: File mentah dari tim produksi (Tahap 1)
- **PASCA PRODUKSI (Draft & Editing)**: File hasil editing (Tahap 2-4)
- **DESAIN FOLDER (Aset Visual)**: Aset desain grafis (opsional)
- **Additional Asset (Tambahan Foto/Footage)**: Folder kustom tambahan selain file kebutuhan output utama (opsional)

> Catatan: Folder FINAL PRODUCT (Siap Publish) sudah tidak digunakan. File siap publikasi kini diambil langsung dari folder PASCA PRODUKSI oleh Publisher.

## 4.2 Aturan Akses Otomatis
Saat proyek dibuat, sistem mengisi hak akses Download (DL) / Upload (UL) otomatis sesuai tahapan kerja, agar Manager tidak perlu menentukan satu per satu:

- **PRODUKSI**: Tahap 1 (Upload), Tahap 2 (Download)
- **PASCA PRODUKSI**: Tahap 2 (Upload), Tahap 3/4/5 (Download — saat file tugas diteruskan oleh Reviewer)

Manager tetap dapat menyesuaikan akses secara manual di form pembuatan proyek.

## 4.3 Aturan Upload
- **Hanya upload file melalui Tugas Anda** di halaman detail proyek
- **JANGAN** upload langsung ke Google Drive
- Pastikan format file sesuai kebutuhan (JPG, PNG, MP4, MP3, PDF, dll)
- Beri nama file dengan jelas dan konsisten
- Ukuran file maksimal sesuai batas yang ditentukan sistem

---

# 5. Panduan Inbox & Notifikasi

## 5.1 Inbox
- **Surat Tugas**: Notifikasi penugasan proyek baru dengan detail lengkap
- **Notifikasi Proyek**: Perubahan status tahapan proyek
- **Notifikasi Review**: Hasil review (disetujui/ditolak)

## 5.2 Tips Penting
- Selalu cek Inbox secara berkala
- Baca Surat Tugas dengan teliti sebelum memulai tugas
- Tandai Surat Tugas sebagai "Dibaca" setelah dipahami
- Klik tautan di Inbox untuk langsung menuju proyek terkait

---

# 6. Statistik & Progress

## 6.1 Dashboard
- Menampilkan seluruh proyek dalam dua mode: **Alur Kerja** dan **Tabel**
- Setiap user dapat melihat progress seluruh proyek secara realtime
- Filter waktu: Semua, Hari Ini, Minggu Ini, Bulan Ini, Tahun Ini

## 6.2 Statistik & Progress
- Menampilkan metrik: Total Proyek, Sedang Berjalan, Telah Selesai
- Detail progress per proyek dengan visualisasi 5 tahapan
- Informasi anggota tim per tahapan dengan status penyelesaian
- Tombol **"Bagikan ke Publik"** untuk mendapatkan tautan tracker publik

## 6.3 Tracker Publik
- Tautan publik dapat dibagikan tanpa login
- Cocok ditampilkan di monitor/TV kantor
- Auto-refresh dan auto-paginasi
- Konfigurasi grid: dari 1x1 hingga 4x4

---

# 7. Laporan Kegiatan

## 7.1 Akses
Hanya tersedia untuk **Manager** dan **Super Admin**

## 7.2 Konten Laporan
- Menampilkan proyek yang telah **selesai (Tahap 5)**
- Detail per tahapan: peran, petugas, status, platform, tautan hasil produksi
- Dokumen pendukung dari Manager
- Tautan lampiran surat permohonan

## 7.3 Format Export
- **PDF**: Laporan individual dan rekapitulasi seluruh proyek
- **Excel (XLSX)**: Data tabel untuk analisis lebih lanjut

---

# 8. Keamanan Akun

## 8.1 Password
- Minimal 8 karakter
- Kombinasi huruf dan angka
- Ganti password secara berkala
- Jangan membagikan password kepada siapapun

## 8.2 Login
- Gunakan email dan password yang telah terdaftar
- Jika pertama kali login, sistem akan meminta ganti password
- Hubungi Super Admin jika lupa password

---

# 9. Tips & Best Practices

## 9.1 Untuk Semua User
- Selalu update profil (nama, foto, WhatsApp) di menu **Profil Saya**
- Cek notifikasi dan inbox secara rutin
- Komunikasikan kendala melalui fitur yang tersedia di sistem
- Dokumentasikan setiap aktivitas dengan jelas

## 9.2 Untuk Administrator
- Pastikan surat dan permohonan diinput dengan data yang lengkap
- Teruskan permohonan ke Manager segera setelah diverifikasi
- Lampirkan dokumen pendukung yang relevan

## 9.3 Untuk Manager
- Pilih anggota tim yang tepat untuk setiap peran
- Monitor progress proyek secara berkala
- Upload dokumen pendukung di Tahap 0
- Gunakan fitur laporan untuk dokumentasi kegiatan

## 9.4 Untuk Tim Produksi
- Selesaikan tugas sesuai urutan tahapan
- Upload file dengan nama yang jelas dan deskriptif
- Tandai tugas sebagai selesai setelah benar-benar selesai
- Koordinasi dengan tim tahapan berikutnya

---

# 10. Kontak & Bantuan

Jika mengalami kendala teknis atau pertanyaan terkait SOP:
- Hubungi **Super Admin** melalui aplikasi
- Lihat tab **Panduan** untuk informasi tambahan
- Cek tab **Pengumuman** untuk update terbaru

---

**Dokumen ini bersifat dinamis dan dapat diperbarui sesuai kebutuhan.**
**Terakhir diperbarui melalui Sistem Pushakin Flows**`

  // Seed default SOP
  const [isSeeding, setIsSeeding] = useState(false)
  const seedDefaultSOP = async () => {
    if (!confirm('Buat SOP default "Panduan Lengkap Sistem Manajemen Produksi"?')) return
    setIsSeeding(true)
    try {
      const payload = {
        title: 'SOP Pushakin Flows - Panduan Lengkap Sistem Manajemen Produksi',
        content: SOP_CONTENT,
        type: 'SOP',
        displayMode: 'text',
        published: true,
        order: 0,
        authorId: currentUser?.id
      }
      const response = await fetch('/api/sop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (response.ok) {
        showAlert('SOP berhasil dibuat!')
        fetchItems()
      } else {
        const data = await response.json()
        showAlert(data.error || 'Gagal membuat SOP')
      }
    } catch (error) {
      console.error('Error seeding SOP:', error)
      showAlert('Terjadi kesalahan')
    } finally {
      setIsSeeding(false)
    }
  }

  // Render the items list
  const renderItems = () => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-violet-600" />
        </div>
      )
    }

    if (items.length === 0) {
      return (
        <Card className="border-dashed">
          <CardContent className="p-12 text-center">
            <div className={cn("w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center",
              activeTab === 'Pengumuman' ? 'bg-orange-100' :
              activeTab === 'SOP' ? 'bg-blue-100' : 'bg-green-100'
            )}>
              {getTabIcon(activeTab)}
            </div>
            <h3 className="text-lg font-semibold text-stone-800">
              {canManage ? `Belum ada ${activeTab}` : `Belum ada ${activeTab.toLowerCase()}`}
            </h3>
            <p className="text-stone-500 mt-2 mb-4">
              {canManage
                ? `Klik tombol "Buat Baru" untuk membuat ${activeTab.toLowerCase()} pertama`
                : `Belum ada ${activeTab.toLowerCase()} yang dipublikasikan.`}
            </p>
            {canManage && (
              <div className="flex items-center gap-2">
                <Button onClick={openCreateDialog} variant="outline">
                  <Plus className="w-4 h-4 mr-2" />
                  Buat {activeTab}
                </Button>
                {activeTab === 'SOP' && (
                  <Button
                    onClick={seedDefaultSOP}
                    disabled={isSeeding}
                    variant="outline"
                    className="border-violet-300 text-violet-700 hover:bg-violet-50"
                  >
                    {isSeeding ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <FileText className="w-4 h-4 mr-2" />
                    )}
                    {isSeeding ? 'Membuat...' : 'Buat SOP Default'}
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )
    }

    return (
      <div className="space-y-4">
        {items.map((item, index) => (
          <Card key={item.id} className={cn(
            "transition-all",
            item.published ? "border-l-4 border-l-green-500" : "border-l-4 border-l-stone-300"
          )}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <CardTitle className="text-lg">{item.title}</CardTitle>
                    {item.published ? (
                      <Badge variant="default" className="bg-green-600">Published</Badge>
                    ) : (
                      <Badge variant="secondary">Draft</Badge>
                    )}
                  </div>
                  <CardDescription className="flex items-center gap-4 text-xs">
                    <span className="flex items-center gap-1">
                      <User className="w-3 h-3" />
                      {item.author.name}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(item.createdAt).toLocaleDateString('id-ID', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric'
                      })}
                    </span>
                    {item.displayMode !== 'text' && (
                      <Badge variant="outline" className="text-xs">
                        {item.displayMode === 'slideshow' ? 'Slideshow' :
                         item.displayMode === 'static' ? 'Gambar' : 'PDF'}
                      </Badge>
                    )}
                  </CardDescription>
                </div>
                {/* Action buttons */}
                <div className="flex items-center gap-1">
                  {/* Download button — visible to ALL users */}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => downloadAsDocx(item)}
                    className="h-8 w-8 text-violet-600 hover:text-violet-700 hover:bg-violet-50"
                    title="Download sebagai DOCX"
                  >
                    <Download className="w-4 h-4" />
                  </Button>
                  {/* Admin/Manager action buttons */}
                  {canManage && (
                    <>
                      <Button variant="ghost" size="icon" onClick={() => moveOrder(item, 'up')} disabled={index === 0} className="h-8 w-8">
                        <ChevronUp className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => moveOrder(item, 'down')} disabled={index === items.length - 1} className="h-8 w-8">
                        <ChevronDown className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => togglePublish(item)} className={cn("h-8 w-8", item.published ? "text-green-600" : "text-stone-400")}>
                        {item.published ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => openEditDialog(item)} className="h-8 w-8">
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(item.id)} className="h-8 w-8 text-red-500 hover:text-red-600">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-stone-600 text-sm whitespace-pre-line">
                {item.content}
              </p>
              {item.files && (() => {
                const fileList = JSON.parse(item.files)
                const visibleFiles = fileList.slice(0, 4)
                const extraCount = fileList.length - 4
                return (
                  <div className="flex gap-2 mt-3 overflow-x-auto pb-2">
                    {visibleFiles.map((file: string, i: number) => {
                      const isPdf = file.startsWith('data:application/pdf')
                      return (
                        <div
                          key={i}
                          className="relative w-20 h-20 rounded-lg overflow-hidden border bg-stone-100 shrink-0 cursor-pointer hover:ring-2 hover:ring-violet-500 hover:shadow-md transition-all group"
                          onClick={() => {
                            if (isPdf) {
                              // Open PDF in new tab
                              const link = window.document.createElement('a')
                              link.href = file
                              link.target = '_blank'
                              link.rel = 'noopener noreferrer'
                              link.click()
                            } else {
                              // Open image in preview dialog
                              setPreviewIndex(i)
                              setPreviewFile({ url: file, type: 'image' })
                            }
                          }}
                          title={isPdf ? 'Klik untuk buka PDF' : 'Klik untuk preview gambar'}
                        >
                          {isPdf ? (
                            <div className="w-full h-full flex flex-col items-center justify-center bg-red-50">
                              <FileText className="w-8 h-8 text-red-500" />
                              <span className="text-[8px] text-red-400 mt-0.5 font-medium">PDF</span>
                            </div>
                          ) : (
                            <>
                              <img src={file} alt="" className="w-full h-full object-cover" />
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
                                <Eye className="w-6 h-6 text-white drop-shadow-lg" />
                              </div>
                            </>
                          )}
                          {extraCount > 0 && i === 3 && (
                            <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white text-sm font-medium">
                              +{fileList.length - 4}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })()}
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Megaphone className={cn(
            "w-6 h-6",
            activeTab === 'Pengumuman' ? "text-orange-500" :
            activeTab === 'SOP' ? "text-blue-500" : "text-green-500"
          )} />
          <div>
            <h1 className="text-2xl font-bold text-stone-800">
              {canManage ? 'Manajemen Konten' : 'Informasi'}
            </h1>
            <p className="text-stone-500 text-sm">
              {canManage ? 'Kelola Pengumuman, SOP, dan Panduan' : 'Pengumuman, SOP, dan Panduan terbaru'}
            </p>
          </div>
        </div>
        {canManage && (
          <Button
            onClick={openCreateDialog}
            className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700"
          >
            <Plus className="w-4 h-4 mr-2" />
            Buat Baru
          </Button>
        )}
      </div>

      {/* Tabs - shown to ALL users (Admin/Manager sees management UI, others see published only) */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
        <TabsList className="grid w-full grid-cols-3 max-w-md">
          <TabsTrigger value="Pengumuman" className="gap-2">
            <Megaphone className="w-4 h-4" />
            Pengumuman
          </TabsTrigger>
          <TabsTrigger value="SOP" className="gap-2">
            <FileText className="w-4 h-4" />
            SOP
          </TabsTrigger>
          <TabsTrigger value="Panduan" className="gap-2">
            <BookOpen className="w-4 h-4" />
            Panduan
          </TabsTrigger>
        </TabsList>
        <TabsContent value={activeTab} className="mt-6">
          {renderItems()}
        </TabsContent>
      </Tabs>

      {/* File Preview Dialog */}
      <Dialog open={!!previewFile} onOpenChange={(open) => { if (!open) setPreviewFile(null) }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden p-0">
          <DialogHeader className="p-6 pb-2">
            <DialogTitle>Preview File</DialogTitle>
            <DialogDescription>
              {previewFile?.type === 'pdf' ? 'Preview dokumen PDF' : 'Preview gambar'}
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 pb-6">
            {previewFile?.type === 'image' && (
              <div className="rounded-lg overflow-hidden border">
                <img
                  src={previewFile.url}
                  alt="Preview"
                  className="max-w-full max-h-[70vh] object-contain mx-auto"
                />
              </div>
            )}
            {previewFile?.type === 'pdf' && (
              <div className="rounded-lg overflow-hidden border bg-stone-50">
                <iframe
                  src={previewFile.url}
                  className="w-full h-[70vh]"
                  title="PDF Preview"
                />
              </div>
            )}
          </div>
          <DialogFooter className="px-6 pb-6">
            <Button
              variant="outline"
              onClick={() => {
                if (previewFile) {
                  const link = window.document.createElement('a')
                  link.href = previewFile.url
                  link.download = previewFile.type === 'pdf' ? 'document.pdf' : 'image.png'
                  link.click()
                }
              }}
            >
              <FileText className="w-4 h-4 mr-2" />
              Download
            </Button>
            <Button onClick={() => setPreviewFile(null)}>Tutup</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create/Edit Dialog - Admin/Manager only */}
      {canManage && (
        <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) resetForm(); }}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingItem ? `Edit ${activeTab}` : `Buat ${activeTab} Baru`}
              </DialogTitle>
              <DialogDescription>
                Isi form di bawah untuk {editingItem ? 'memperbarui' : 'membuat'} {activeTab.toLowerCase()}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="title">Judul</Label>
                <Input
                  id="title"
                  value={formData.title}
                  onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                  placeholder={`Judul ${activeTab}`}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="content">Konten</Label>
                <Textarea
                  id="content"
                  value={formData.content}
                  onChange={(e) => setFormData(prev => ({ ...prev, content: e.target.value }))}
                  placeholder={`Tulis isi ${activeTab.toLowerCase()} di sini...`}
                  rows={6}
                />
              </div>

              <div className="space-y-2">
                <Label>Mode Tampilan</Label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: 'text', label: 'Teks', icon: FileText },
                    { value: 'static', label: 'Gambar Statis', icon: ImageIcon },
                    { value: 'slideshow', label: 'Slideshow', icon: FileImage },
                    { value: 'pdf', label: 'PDF', icon: FileText }
                  ].map((mode) => (
                    <Button
                      key={mode.value}
                      type="button"
                      variant={formData.displayMode === mode.value ? 'default' : 'outline'}
                      className="justify-start"
                      onClick={() => setFormData(prev => ({
                        ...prev,
                        displayMode: mode.value as typeof formData.displayMode
                      }))}
                    >
                      <mode.icon className="w-4 h-4 mr-2" />
                      {mode.label}
                    </Button>
                  ))}
                </div>
              </div>

              {(formData.displayMode === 'static' || formData.displayMode === 'slideshow' || formData.displayMode === 'pdf') && (
                <div className="space-y-2">
                  <Label>Upload File (PDF/JPG/PNG)</Label>
                  <div className="border-2 border-dashed rounded-xl p-6 text-center">
                    <input
                      type="file"
                      id="file-upload"
                      multiple
                      accept=".pdf,image/*"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                    <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center gap-2">
                      <div className="w-12 h-12 rounded-full bg-violet-100 flex items-center justify-center">
                        <ImageIcon className="w-6 h-6 text-violet-600" />
                      </div>
                      <span className="text-sm text-stone-600">Klik untuk upload atau drag & drop</span>
                      <span className="text-xs text-stone-400">PDF, JPG, PNG (maks. 5MB per file)</span>
                    </label>
                  </div>

                  {formData.files.length > 0 && (
                    <div className="grid grid-cols-4 gap-2 mt-3">
                      {formData.files.map((file, i) => (
                        <div key={i} className="relative group">
                          <div className="aspect-square rounded-lg overflow-hidden border bg-stone-100">
                            {file.startsWith('data:application/pdf') ? (
                              <div className="w-full h-full flex items-center justify-center bg-red-50">
                                <FileText className="w-8 h-8 text-red-500" />
                              </div>
                            ) : (
                              <img src={file} alt="" className="w-full h-full object-cover" />
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => removeFile(i)}
                            className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {formData.displayMode === 'slideshow' && (
                <div className="space-y-2">
                  <Label htmlFor="speed">Kecepatan Slideshow (detik)</Label>
                  <Input
                    id="speed"
                    type="number"
                    value={formData.slideshowSpeed / 1000}
                    onChange={(e) => setFormData(prev => ({
                      ...prev,
                      slideshowSpeed: (parseInt(e.target.value) || 5) * 1000
                    }))}
                    min={1}
                    max={30}
                  />
                </div>
              )}

              <div className="flex items-center justify-between p-4 rounded-xl bg-stone-50">
                <div>
                  <Label className="font-semibold">Publikasikan</Label>
                  <p className="text-sm text-stone-500">
                    {formData.published
                      ? 'Akan terlihat oleh semua user'
                      : 'Disimpan sebagai draft'}
                  </p>
                </div>
                <Switch
                  checked={formData.published}
                  onCheckedChange={(checked) => setFormData(prev => ({ ...prev, published: checked }))}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => { setIsDialogOpen(false); resetForm(); }}>
                Batal
              </Button>
              <Button
                onClick={handleSave}
                disabled={isSaving || !formData.title.trim() || !formData.content.trim()}
                className="bg-gradient-to-r from-violet-600 to-purple-600"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Menyimpan...
                  </>
                ) : (
                  editingItem ? 'Perbarui' : 'Simpan'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
