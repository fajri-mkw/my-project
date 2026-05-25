import { db, ensureDbConnection } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { sendTestNotification } from '@/lib/notification-service'

// Helper to mask secrets
function maskSecret(val: string | null): string {
  if (!val) return ''
  if (val.length <= 6) return '••••••'
  return val.slice(0, 3) + '••••••' + val.slice(-3)
}

// GET notification settings (masked)
export async function GET() {
  try {
    await ensureDbConnection()
    let settings = await db.settings.findUnique({ where: { id: 'main' } })
    if (!settings) {
      settings = await db.settings.create({ data: { id: 'main' } })
    }

    return NextResponse.json({
      notifWaEnabled: settings.notifWaEnabled || false,
      hasNotifWaToken: !!settings.notifWaToken,
      notifWaTokenMasked: maskSecret(settings.notifWaToken),
      notifWaDeviceId: settings.notifWaDeviceId || '',
      notifWaSenderNumber: settings.notifWaSenderNumber || '',
      notifEmailEnabled: settings.notifEmailEnabled || false,
      hasNotifEmailPass: !!settings.notifEmailPass,
      notifEmailPassMasked: maskSecret(settings.notifEmailPass),
      notifEmailHost: settings.notifEmailHost || '',
      notifEmailPort: settings.notifEmailPort || 587,
      notifEmailUser: settings.notifEmailUser || '',
      notifEmailFromName: settings.notifEmailFromName || ''
    })
  } catch (error) {
    console.error('Get notification settings error:', error)
    return NextResponse.json({ error: 'Failed to fetch notification settings' }, { status: 500 })
  }
}

// PUT update notification settings
export async function PUT(request: NextRequest) {
  try {
    await ensureDbConnection()
    const body = await request.json()

    const updateData: Record<string, any> = {}

    if (typeof body.notifWaEnabled === 'boolean') updateData.notifWaEnabled = body.notifWaEnabled
    if (body.notifWaToken !== undefined) updateData.notifWaToken = body.notifWaToken || null
    if (body.notifWaDeviceId !== undefined) updateData.notifWaDeviceId = body.notifWaDeviceId || null
    if (body.notifWaSenderNumber !== undefined) updateData.notifWaSenderNumber = body.notifWaSenderNumber || null
    if (typeof body.notifEmailEnabled === 'boolean') updateData.notifEmailEnabled = body.notifEmailEnabled
    if (body.notifEmailHost !== undefined) updateData.notifEmailHost = body.notifEmailHost || null
    if (body.notifEmailPort !== undefined) updateData.notifEmailPort = body.notifEmailPort ? parseInt(body.notifEmailPort) : null
    if (body.notifEmailUser !== undefined) updateData.notifEmailUser = body.notifEmailUser || null
    if (body.notifEmailPass !== undefined) updateData.notifEmailPass = body.notifEmailPass || null
    if (body.notifEmailFromName !== undefined) updateData.notifEmailFromName = body.notifEmailFromName || null

    const settings = await db.settings.upsert({
      where: { id: 'main' },
      update: updateData,
      create: { id: 'main', ...updateData }
    })

    return NextResponse.json({
      success: true,
      notifWaEnabled: settings.notifWaEnabled || false,
      hasNotifWaToken: !!settings.notifWaToken,
      notifWaTokenMasked: maskSecret(settings.notifWaToken),
      notifWaDeviceId: settings.notifWaDeviceId || '',
      notifWaSenderNumber: settings.notifWaSenderNumber || '',
      notifEmailEnabled: settings.notifEmailEnabled || false,
      hasNotifEmailPass: !!settings.notifEmailPass,
      notifEmailPassMasked: maskSecret(settings.notifEmailPass),
      notifEmailHost: settings.notifEmailHost || '',
      notifEmailPort: settings.notifEmailPort || 587,
      notifEmailUser: settings.notifEmailUser || '',
      notifEmailFromName: settings.notifEmailFromName || ''
    })
  } catch (error) {
    console.error('Update notification settings error:', error)
    return NextResponse.json({ error: 'Failed to update notification settings' }, { status: 500 })
  }
}

// POST test notification
export async function POST(request: NextRequest) {
  try {
    await ensureDbConnection()
    const body = await request.json()
    const { adminUserId } = body

    if (!adminUserId) {
      return NextResponse.json({ error: 'Admin user ID required' }, { status: 400 })
    }

    const user = await db.user.findUnique({ where: { id: adminUserId } })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const settings = await db.settings.findUnique({ where: { id: 'main' } })
    if (!settings) {
      return NextResponse.json({ error: 'Settings not found' }, { status: 404 })
    }

    const result = await sendTestNotification(user, {
      notifWaEnabled: settings.notifWaEnabled || false,
      notifWaToken: settings.notifWaToken,
      notifWaDeviceId: settings.notifWaDeviceId,
      notifWaSenderNumber: settings.notifWaSenderNumber,
      notifEmailEnabled: settings.notifEmailEnabled || false,
      notifEmailHost: settings.notifEmailHost,
      notifEmailPort: settings.notifEmailPort,
      notifEmailUser: settings.notifEmailUser,
      notifEmailPass: settings.notifEmailPass,
      notifEmailFromName: settings.notifEmailFromName
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Test notification error:', error)
    return NextResponse.json({ error: 'Failed to send test notification' }, { status: 500 })
  }
}
