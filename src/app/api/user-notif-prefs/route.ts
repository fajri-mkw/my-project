import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'

// PUT update current user's notification preferences
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { userId, notifWaEnabled, notifEmailEnabled } = body

    if (!userId) {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 })
    }

    const updateData: Record<string, any> = {}
    if (typeof notifWaEnabled === 'boolean') updateData.notifWaEnabled = notifWaEnabled
    if (typeof notifEmailEnabled === 'boolean') updateData.notifEmailEnabled = notifEmailEnabled

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const user = await db.user.update({
      where: { id: userId },
      data: updateData,
      select: { id: true, notifWaEnabled: true, notifEmailEnabled: true }
    })

    return NextResponse.json({ success: true, ...user })
  } catch (error) {
    console.error('Update user notification prefs error:', error)
    return NextResponse.json({ error: 'Failed to update notification preferences' }, { status: 500 })
  }
}
