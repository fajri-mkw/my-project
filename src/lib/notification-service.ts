// ============================================================================
// IMPORTANT: This module is imported by hot-path API routes
// (/api/tasks, /api/projects, /api/notification-settings).
//
// To keep Cloudflare Worker cold-start CPU low (and avoid "Worker threw
// exception" 500s), this file MUST NOT import anything that pulls in heavy
// server-side libraries at module-load time — specifically:
//   - Do NOT import `db` from '@/lib/db' (loads Prisma + adapter).
//   - Do NOT import from '@/lib/store' (loads zustand).
//
// The previous version had a dead `import { db }` that loaded Prisma on
// every task-completion request, causing Worker crashes on cold starts.
// `db` was never actually used in this file — it was left over from an
// earlier refactor. It has been removed.
//
// `STAGES` (previously imported from @/lib/store) is inlined below as a
// plain constant so we don't drag zustand into the server bundle.
// ============================================================================

const STAGES: Record<number, string> = {
  0: 'Perencanaan',
  1: 'Produksi',
  2: 'Pasca Produksi',
  3: 'Review',
  4: 'Publikasi',
  5: 'Selesai',
}

// ---- WhatsApp via Fonnte API ----

export async function sendWhatsApp(phone: string, message: string, token: string): Promise<boolean> {
  try {
    const res = await fetch('https://api.fonnte.com/send', {
      method: 'POST',
      headers: {
        'Authorization': token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ target: phone, message })
    })
    const data = await res.json()
    if (!res.ok || data.status === false) {
      console.error('Fonnte WA error:', data)
      return false
    }
    return true
  } catch (err) {
    console.error('sendWhatsApp error:', err)
    return false
  }
}

// ---- Email via Nodemailer SMTP ----
//
// IMPORTANT: nodemailer is dynamically imported (not top-level imported)
// because it depends on Node.js built-in modules (net, tls, fs) that may
// not be fully available on Cloudflare Workers even with nodejs_compat.
// A top-level import would cause the ENTIRE module (and every route that
// imports from it, including /api/tasks) to fail at module-load time —
// producing Cloudflare's "Worker threw exception" before any try/catch
// can run. By deferring the import to when sendEmail() is actually
// called, we isolate any nodemailer failure to the email-sending path
// only, and the try/catch inside sendEmail converts it to a benign
// `return false` instead of a crash.

export async function sendEmail(
  to: string,
  subject: string,
  htmlBody: string,
  config: { host: string; port: number; user: string; pass: string; fromName: string }
): Promise<boolean> {
  try {
    // Dynamic import — only loads nodemailer when email is actually sent
    const { default: nodemailer } = await import('nodemailer')

    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: { user: config.user, pass: config.pass }
    })

    await transporter.sendMail({
      from: `"${config.fromName}" <${config.user}>`,
      to,
      subject,
      html: htmlBody
    })
    return true
  } catch (err) {
    console.error('sendEmail error:', err)
    return false
  }
}

// ---- Settings type helper ----

interface NotifSettings {
  notifWaEnabled: boolean
  notifWaToken: string | null
  notifWaDeviceId: string | null
  notifWaSenderNumber: string | null
  notifEmailEnabled: boolean
  notifEmailHost: string | null
  notifEmailPort: number | null
  notifEmailUser: string | null
  notifEmailPass: string | null
  notifEmailFromName: string | null
}

// ---- Send notification to a single user via their preferred channels ----

export async function sendTaskNotification(
  user: { email: string; whatsapp: string | null; notifWaEnabled: boolean; notifEmailEnabled: boolean; name: string },
  title: string,
  message: string,
  settings: NotifSettings
): Promise<void> {
  // WhatsApp
  if (
    settings.notifWaEnabled &&
    settings.notifWaToken &&
    user.notifWaEnabled &&
    user.whatsapp
  ) {
    const waMessage = `*Pushakin Flows*\n\n${message}\n\n— ${title}`
    await sendWhatsApp(user.whatsapp, waMessage, settings.notifWaToken)
  }

  // Email
  if (
    settings.notifEmailEnabled &&
    settings.notifEmailHost &&
    settings.notifEmailPort &&
    settings.notifEmailUser &&
    settings.notifEmailPass &&
    user.notifEmailEnabled &&
    user.email
  ) {
    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #7c3aed, #6d28d9); padding: 20px; border-radius: 12px 12px 0 0;">
          <h2 style="color: white; margin: 0;">Pushakin Flows</h2>
        </div>
        <div style="border: 1px solid #e5e7eb; padding: 24px; border-radius: 0 0 12px 12px;">
          <h3 style="color: #1f2937; margin-top: 0;">${title}</h3>
          <p style="color: #4b5563; line-height: 1.6;">${message}</p>
        </div>
        <p style="color: #9ca3af; font-size: 12px; text-align: center; margin-top: 16px;">
          Email ini dikirim otomatis oleh Pushakin Flows.
        </p>
      </div>
    `
    await sendEmail(user.email, `[Pushakin Flows] ${title}`, htmlBody, {
      host: settings.notifEmailHost,
      port: settings.notifEmailPort,
      user: settings.notifEmailUser,
      pass: settings.notifEmailPass,
      fromName: settings.notifEmailFromName || 'Pushakin Flows'
    })
  }
}

// ---- Notify users on task assignment (new project) ----

export async function sendTaskAssignmentNotification(
  user: { email: string; whatsapp: string | null; notifWaEnabled: boolean; notifEmailEnabled: boolean; name: string },
  settings: NotifSettings,
  info: { projectTitle: string; managerName: string; requesterUnit: string; role: string }
): Promise<void> {
  const message = `Halo ${user.name},\n\nAnda menerima tugas baru sebagai *${info.role}* untuk proyek:\n\n*${info.projectTitle}*\nUnit: ${info.requesterUnit}\nManager: ${info.managerName}\n\nSilakan cek aplikasi Pushakin Flows untuk detail selengkapnya.`
  await sendTaskNotification(user, `Tugas Baru: ${info.projectTitle}`, message, settings)
}

// ---- Notify users on stage advance ----

export async function sendStageAdvanceNotification(
  user: { email: string; whatsapp: string | null; notifWaEnabled: boolean; notifEmailEnabled: boolean; name: string },
  settings: NotifSettings,
  info: { projectTitle: string; newStage: number }
): Promise<void> {
  const stageName = STAGES[info.newStage] || `Tahap ${info.newStage}`
  const message = `Halo ${user.name},\n\nProyek *${info.projectTitle}* telah maju ke *${stageName}*. Giliran Anda untuk mengerjakan tugas!\n\nSilakan cek aplikasi Pushakin Flows.`
  await sendTaskNotification(user, `Proyek Maju ke ${stageName}: ${info.projectTitle}`, message, settings)
}

// ---- Notify users on review rejection ----

export async function sendReviewRejectionNotification(
  user: { email: string; whatsapp: string | null; notifWaEnabled: boolean; notifEmailEnabled: boolean; name: string },
  settings: NotifSettings,
  info: { projectTitle: string; rejectReason?: string }
): Promise<void> {
  const reasonText = info.rejectReason ? `\n\nAlasan: ${info.rejectReason}` : ''
  const message = `Halo ${user.name},\n\nProyek *${info.projectTitle}* ditolak oleh Reviewer. Silakan perbaiki karya Anda.${reasonText}\n\nSilakan cek aplikasi Pushakin Flows.`
  await sendTaskNotification(user, `Proyek Ditolak: ${info.projectTitle}`, message, settings)
}

// ---- Send test notification (for admin to verify settings) ----

export async function sendTestNotification(
  user: { email: string; whatsapp: string | null; name: string },
  settings: NotifSettings
): Promise<{ waSuccess: boolean; emailSuccess: boolean; waError?: string; emailError?: string }> {
  const testMessage = 'Ini adalah pesan test notifikasi dari Pushakin Flows. Jika Anda menerima pesan ini, konfigurasi sudah benar.'

  let waSuccess = false
  let emailSuccess = false
  let waError: string | undefined
  let emailError: string | undefined

  // Test WA
  if (settings.notifWaEnabled && settings.notifWaToken) {
    const target = settings.notifWaSenderNumber || user.whatsapp
    if (target) {
      waSuccess = await sendWhatsApp(target, testMessage, settings.notifWaToken)
      if (!waSuccess) waError = 'Gagal mengirim WhatsApp. Periksa token dan nomor tujuan.'
    } else {
      waError = 'Nomor WhatsApp tujuan belum diisi (Sender Number atau WhatsApp profil Anda kosong).'
    }
  } else {
    waError = 'Notifikasi WhatsApp belum diaktifkan atau token belum diisi.'
  }

  // Test Email
  if (settings.notifEmailEnabled && settings.notifEmailHost && settings.notifEmailPort && settings.notifEmailUser && settings.notifEmailPass) {
    emailSuccess = await sendEmail(user.email, '[Pushakin Flows] Test Notifikasi', `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #7c3aed, #6d28d9); padding: 20px; border-radius: 12px 12px 0 0;">
          <h2 style="color: white; margin: 0;">Pushakin Flows - Test</h2>
        </div>
        <div style="border: 1px solid #e5e7eb; padding: 24px; border-radius: 0 0 12px 12px;">
          <p style="color: #4b5563; line-height: 1.6;">${testMessage}</p>
        </div>
      </div>
    `, {
      host: settings.notifEmailHost,
      port: settings.notifEmailPort,
      user: settings.notifEmailUser,
      pass: settings.notifEmailPass,
      fromName: settings.notifEmailFromName || 'Pushakin Flows'
    })
    if (!emailSuccess) emailError = 'Gagal mengirim email. Periksa konfigurasi SMTP.'
  } else {
    emailError = 'Notifikasi Email belum diaktifkan atau konfigurasi SMTP belum lengkap.'
  }

  return { waSuccess, emailSuccess, waError, emailError }
}
