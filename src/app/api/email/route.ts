import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'

interface EmailRequest {
  to: string
  subject: string
  html: string
  text?: string
}

export async function POST(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const body: EmailRequest = await request.json()
    const { to, subject, html, text } = body

    if (!to || !subject || !html) {
      return NextResponse.json(
        { error: 'Missing required fields: to, subject, html' },
        { status: 400 }
      )
    }

    // In production, integrate with real email service:
    // - Resend: https://resend.com
    // - SendGrid: https://sendgrid.com
    // - Nodemailer with SMTP
    
    // For demo purposes, we simulate email sending by logging
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('📧 EMAIL SENT (Simulated)')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log(`To: ${to}`)
    console.log(`Subject: ${subject}`)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('HTML Content:')
    console.log(html.substring(0, 500) + (html.length > 500 ? '...' : ''))
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 100))

    return NextResponse.json({
      success: true,
      message: 'Email sent successfully (simulated)',
      messageId: `msg_${Date.now()}`,
      to,
      subject
    })
  } catch (error) {
    console.error('Email send error:', error)
    return NextResponse.json(
      { error: 'Failed to send email' },
      { status: 500 }
    )
  }
}

// Helper function to generate email HTML for task assignment
export function generateTaskAssignmentEmail(params: {
  userName: string
  projectName: string
  projectId: string
  role: string
  stage: number
  stageName: string
  description: string
  executionTime: string
  location: string
  picName: string
  picWhatsApp: string
  managerName: string
}): string {
  const {
    userName,
    projectName,
    projectId,
    role,
    stage,
    stageName,
    description,
    executionTime,
    location,
    picName,
    picWhatsApp,
    managerName
  } = params

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; padding: 30px; border-radius: 16px 16px 0 0; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 16px 16px; }
    .task-card { background: white; border-radius: 12px; padding: 20px; margin: 20px 0; border: 1px solid #e5e7eb; }
    .task-title { font-size: 18px; font-weight: bold; color: #111827; margin-bottom: 10px; }
    .badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: bold; }
    .badge-stage { background: #dbeafe; color: #1d4ed8; }
    .badge-role { background: #fef3c7; color: #92400e; }
    .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #f3f4f6; }
    .info-label { color: #6b7280; font-size: 14px; }
    .info-value { color: #111827; font-weight: 500; font-size: 14px; }
    .button { display: inline-block; background: #6366f1; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; margin-top: 20px; }
    .footer { text-align: center; margin-top: 30px; color: #9ca3af; font-size: 12px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🎬 Pushakin Flows</h1>
    <p style="margin: 10px 0 0 0;">Notifikasi Penugasan Baru</p>
  </div>
  
  <div class="content">
    <p>Halo <strong>${userName}</strong>,</p>
    <p>Anda telah mendapat penugasan baru dalam proyek produksi kehumasan. Berikut detailnya:</p>
    
    <div class="task-card">
      <div class="task-title">${projectName}</div>
      <p style="margin: 5px 0 15px 0; font-size: 12px; color: #6b7280;">ID: ${projectId}</p>
      
      <span class="badge badge-stage">Tahap ${stage}: ${stageName}</span>
      <span class="badge badge-role" style="margin-left: 8px;">${role}</span>
      
      <div style="margin-top: 20px;">
        <div class="info-row">
          <span class="info-label">📍 Lokasi</span>
          <span class="info-value">${location || '-'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">📅 Waktu</span>
          <span class="info-value">${executionTime || '-'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">👤 PIC Lokasi</span>
          <span class="info-value">${picName || '-'} (${picWhatsApp || '-'})</span>
        </div>
        <div class="info-row">
          <span class="info-label">👨‍💼 Manager</span>
          <span class="info-value">${managerName}</span>
        </div>
      </div>
    </div>
    
    <div style="background: white; padding: 15px; border-radius: 8px; border-left: 4px solid #6366f1;">
      <strong style="color: #374151; font-size: 14px;">📋 Instruksi:</strong>
      <p style="margin: 10px 0 0 0; color: #4b5563; font-size: 14px; white-space: pre-wrap;">${description || 'Tidak ada instruksi khusus.'}</p>
    </div>
    
    <div style="text-align: center; margin-top: 30px;">
      <a href="https://pushakin.local" class="button">Buka Dashboard →</a>
    </div>
    
    <p style="margin-top: 30px; font-size: 14px; color: #6b7280;">
      Silakan login ke <strong>Pushakin Flows</strong> untuk melihat detail tugas dan mulai bekerja.
      Notifikasi ini juga tersedia di dalam aplikasi.
    </p>
  </div>
  
  <div class="footer">
    <p> Email ini dikirim otomatis oleh Sistem Pushakin Flows</p>
    <p><strong style="color: #7c3aed;">Sistem Manajemen Produksi</strong> | Tim Pusat Hubungan Masyarakat dan Keterbukaan Informasi</p>
  </div>
</body>
</html>
  `
}
