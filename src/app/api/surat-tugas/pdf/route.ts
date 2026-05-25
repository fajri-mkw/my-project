import { db, ensureDbConnection } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'
import { STAGES } from '@/lib/store'

// Generate PDF content as base64
function generateSuratTugasPdfContent(data: {
  nomorSurat: string
  userName: string
  userRole: string
  projectName: string
  projectId: string
  projectDescription: string
  requesterUnit: string
  location: string
  executionTime: string
  picName: string
  picWhatsApp: string
  managerName: string
  role: string
  stage: number
  activityTypes: string[]
  outputNeeds: string[]
  createdAt: string
}): string {
  const {
    nomorSurat,
    userName,
    userRole,
    projectName,
    projectId,
    projectDescription,
    requesterUnit,
    location,
    executionTime,
    picName,
    picWhatsApp,
    managerName,
    role,
    stage,
    activityTypes,
    outputNeeds,
    createdAt
  } = data

  // Format dates
  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr)
      return date.toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      })
    } catch {
      return dateStr
    }
  }

  const formatDateTime = (dateStr: string) => {
    try {
      const date = new Date(dateStr)
      return date.toLocaleDateString('id-ID', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    } catch {
      return dateStr
    }
  }

  const romanMonths = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']
  const now = new Date()
  const monthRoman = romanMonths[now.getMonth()]
  const year = now.getFullYear()
  const day = now.getDate()

  // Generate HTML for PDF
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @page {
      size: A4;
      margin: 20mm 25mm;
    }
    
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Times New Roman', Times, serif;
      font-size: 12pt;
      line-height: 1.5;
      color: #000;
    }
    
    .header {
      text-align: center;
      margin-bottom: 10px;
      padding-bottom: 15px;
    }
    
    .header-logo {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 20px;
      margin-bottom: 10px;
    }
    
    .logo-placeholder {
      width: 70px;
      height: 70px;
      background: #f0f0f0;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      color: #666;
    }
    
    .header-text h1 {
      font-size: 14pt;
      font-weight: bold;
      margin-bottom: 2px;
    }
    
    .header-text h2 {
      font-size: 12pt;
      font-weight: normal;
      margin-bottom: 2px;
    }
    
    .header-text p {
      font-size: 10pt;
    }
    
    .divider {
      border: none;
      border-top: 3px double #000;
      margin: 15px 0;
    }
    
    .title {
      text-align: center;
      margin-bottom: 20px;
    }
    
    .title h2 {
      font-size: 14pt;
      font-weight: bold;
      text-decoration: underline;
      margin-bottom: 5px;
    }
    
    .title .nomor {
      font-size: 11pt;
    }
    
    .content {
      margin-bottom: 20px;
    }
    
    .intro {
      margin-bottom: 15px;
      text-align: justify;
    }
    
    .detail-table {
      width: 100%;
      margin-bottom: 15px;
    }
    
    .detail-table td {
      vertical-align: top;
      padding: 2px 0;
    }
    
    .detail-table .label {
      width: 140px;
      font-weight: normal;
    }
    
    .detail-table .separator {
      width: 15px;
      text-align: center;
    }
    
    .task-box {
      border: 1px solid #000;
      padding: 10px 15px;
      margin: 15px 0;
    }
    
    .task-box h4 {
      font-size: 11pt;
      font-weight: bold;
      margin-bottom: 8px;
    }
    
    .description-box {
      background: #f9f9f9;
      border: 1px solid #ccc;
      padding: 10px;
      margin: 10px 0;
      font-size: 11pt;
      text-align: justify;
    }
    
    .signature-section {
      margin-top: 30px;
      display: flex;
      justify-content: flex-end;
    }
    
    .signature-box {
      text-align: center;
      width: 200px;
    }
    
    .signature-box .place-date {
      margin-bottom: 60px;
    }
    
    .signature-box .name {
      font-weight: bold;
      text-decoration: underline;
    }
    
    .footer {
      margin-top: 30px;
      padding-top: 10px;
      border-top: 1px solid #ccc;
      font-size: 9pt;
      text-align: center;
      color: #666;
    }
    
    .badge {
      display: inline-block;
      padding: 2px 8px;
      background: #e0e0e0;
      border-radius: 3px;
      font-size: 10pt;
      margin-right: 5px;
      margin-bottom: 3px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-logo">
      <div class="logo-placeholder">LOGO</div>
      <div class="header-text">
        <h1>PUSAT HUBUNGAN MASYARAKAT DAN KETERBUKAAN INFORMASI</h1>
        <h2>SISTEM MANAJEMEN PRODUKSI KEHUMASAN</h2>
        <p>Pushakin Flows</p>
      </div>
      <div class="logo-placeholder">LOGO</div>
    </div>
  </div>
  
  <hr class="divider">
  
  <div class="title">
    <h2>SURAT TUGAS</h2>
    <p class="nomor">Nomor: ${nomorSurat}</p>
  </div>
  
  <div class="content">
    <p class="intro">
      Yang bertanda tangan di bawah ini, Manager Produksi Kehumasan, memberikan tugas kepada:
    </p>
    
    <table class="detail-table">
      <tr>
        <td class="label">Nama</td>
        <td class="separator">:</td>
        <td><strong>${userName}</strong></td>
      </tr>
      <tr>
        <td class="label">Jabatan/Peran</td>
        <td class="separator">:</td>
        <td>${userRole}</td>
      </tr>
      <tr>
        <td class="label">Unit</td>
        <td class="separator">:</td>
        <td>Pusat Hubungan Masyarakat dan Keterbukaan Informasi</td>
      </tr>
    </table>
    
    <p class="intro" style="margin-top: 15px;">
      Untuk melaksanakan tugas produksi kehumasan dengan rincian sebagai berikut:
    </p>
    
    <div class="task-box">
      <h4>RINCIAN PENUGASAN</h4>
      <table class="detail-table">
        <tr>
          <td class="label">Nama Kegiatan</td>
          <td class="separator">:</td>
          <td><strong>${projectName}</strong></td>
        </tr>
        <tr>
          <td class="label">ID Proyek</td>
          <td class="separator">:</td>
          <td>${projectId}</td>
        </tr>
        <tr>
          <td class="label">Unit Pemohon</td>
          <td class="separator">:</td>
          <td>${requesterUnit || '-'}</td>
        </tr>
        <tr>
          <td class="label">Lokasi</td>
          <td class="separator">:</td>
          <td>${location || '-'}</td>
        </tr>
        <tr>
          <td class="label">Waktu Pelaksanaan</td>
          <td class="separator">:</td>
          <td>${formatDateTime(executionTime) || '-'}</td>
        </tr>
        <tr>
          <td class="label">PIC Lokasi</td>
          <td class="separator">:</td>
          <td>${picName || '-'} ${picWhatsApp ? `(${picWhatsApp})` : ''}</td>
        </tr>
        <tr>
          <td class="label">Peran Ditugaskan</td>
          <td class="separator">:</td>
          <td><strong>${role}</strong></td>
        </tr>
        <tr>
          <td class="label">Tahap</td>
          <td class="separator">:</td>
          <td>Tahap ${stage}: ${STAGES[stage] || 'Tidak Diketahui'}</td>
        </tr>
      </table>
      
      ${activityTypes && activityTypes.length > 0 ? `
      <p style="margin-top: 10px;"><strong>Jenis Kegiatan:</strong></p>
      <p>${activityTypes.map(t => `<span class="badge">${t}</span>`).join(' ')}</p>
      ` : ''}
      
      ${outputNeeds && outputNeeds.length > 0 ? `
      <p style="margin-top: 10px;"><strong>Kebutuhan Output:</strong></p>
      <p>${outputNeeds.map(o => `<span class="badge">${o}</span>`).join(' ')}</p>
      ` : ''}
    </div>
    
    ${projectDescription ? `
    <p style="margin-bottom: 5px;"><strong>Deskripsi & Instruksi:</strong></p>
    <div class="description-box">
      ${projectDescription.replace(/\n/g, '<br>')}
    </div>
    ` : ''}
    
    <p class="intro" style="margin-top: 15px;">
      Demikian surat tugas ini dibuat untuk dilaksanakan dengan penuh tanggung jawab.
    </p>
  </div>
  
  <div class="signature-section">
    <div class="signature-box">
      <p class="place-date">Banjarbaru, ${day} ${monthRoman} ${year}</p>
      <p>Manager Produksi Kehumasan,</p>
      <br><br><br><br>
      <p class="name">${managerName}</p>
    </div>
  </div>
  
  <div class="footer">
    <p>Dokumen ini diterbitkan secara elektronik melalui Sistem Pushakin Flows</p>
    <p>Tanggal terbit: ${formatDate(createdAt)}</p>
  </div>
</body>
</html>
  `

  return html
}

export async function GET(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    await ensureDbConnection()
    const { searchParams } = new URL(request.url)
    const suratId = searchParams.get('id')
    
    if (!suratId) {
      return NextResponse.json({ error: 'Surat tugas ID required' }, { status: 400 })
    }
    
    // Get surat tugas with all details
    const surat = await db.suratTugas.findUnique({
      where: { id: suratId },
      include: {
        project: {
          include: {
            manager: true,
            tasks: {
              include: {
                assignee: true
              }
            }
          }
        },
        user: true
      }
    })
    
    if (!surat) {
      return NextResponse.json({ error: 'Surat tugas not found' }, { status: 404 })
    }
    
    // Generate PDF content
    const htmlContent = generateSuratTugasPdfContent({
      nomorSurat: surat.nomorSurat,
      userName: surat.user.name,
      userRole: surat.user.role,
      projectName: surat.project.title,
      projectId: surat.projectId,
      projectDescription: surat.project.description || '',
      requesterUnit: surat.project.requesterUnit || '',
      location: surat.project.location || '',
      executionTime: surat.project.executionTime || '',
      picName: surat.project.picName || '',
      picWhatsApp: surat.project.picWhatsApp || '',
      managerName: surat.project.manager.name,
      role: surat.role,
      stage: surat.stage,
      activityTypes: JSON.parse(surat.project.activityTypes || '[]'),
      outputNeeds: JSON.parse(surat.project.outputNeeds || '[]'),
      createdAt: surat.createdAt.toISOString()
    })
    
    // Return HTML that will be converted to PDF on client side
    // For production, you'd use a proper PDF library like puppeteer or wkhtmltopdf
    // For now, we'll return a simple HTML response
    
    // Create a proper PDF using a data URL approach
    const pdfDataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`
    
    // Return the HTML content with PDF headers
    return new NextResponse(htmlContent, {
      headers: {
        'Content-Type': 'text/html',
        'Content-Disposition': `attachment; filename="Surat_Tugas_${surat.nomorSurat.replace(/\//g, '-')}.html"`,
      }
    })
  } catch (error) {
    console.error('Generate PDF error:', error)
    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 })
  }
}
