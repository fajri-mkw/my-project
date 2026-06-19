import { db, ensureDbConnection } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'
import { withEdgeCache, invalidateCache } from '@/lib/edge-cache'

// GET notifications for a user
// Edge-cached for 10s — per-user (cache key includes userId), short TTL
export const GET = withEdgeCache(async (request: NextRequest) => {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    await ensureDbConnection()
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    
    if (!userId) {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 })
    }
    
    const notifications = await db.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50
    })
    
    return NextResponse.json(notifications.map(n => ({
      id: n.id,
      userId: n.userId,
      message: n.message,
      projectId: n.projectId,
      targetView: n.targetView,
      read: n.read,
      createdAt: n.createdAt
    })))
  } catch (error) {
    console.error('Get notifications error:', error)
    return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 })
  }
}, { ttl: 30 })

// PUT mark notification as read
export async function PUT(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    await ensureDbConnection()
    const body = await request.json()
    const { id } = body
    
    const notification = await db.notification.update({
      where: { id },
      data: { read: true }
    })
    
    await invalidateCache('/api/notifications')
    return NextResponse.json(notification)
  } catch (error) {
    console.error('Update notification error:', error)
    return NextResponse.json({ error: 'Failed to update notification' }, { status: 500 })
  }
}
