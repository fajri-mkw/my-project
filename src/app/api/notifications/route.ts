import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'
import { withEdgeCache, invalidateCache } from '@/lib/edge-cache'
import {
  getLibsql,
  toBool,
  toDateISO,
  bind,
} from '@/lib/libsql-client'

// ============================================================================
// CRITICAL: This route is called on every dashboard page load AND polled every
// 30-60s for logged-in users (the bell icon in AppContent). The previous
// version imported `db, ensureDbConnection` from '@/lib/db' (Prisma), which on
// Cloudflare Workers free plan burns CPU on Prisma module-load + ensureSchemaSync
// subrequests and was a contributing cause of recurring Error 1102.
//
// Rewritten to use @libsql/client directly via @/lib/libsql-client — same pattern
// as src/app/api/maintenance/route.ts and src/app/api/users/route.ts.
// ============================================================================

// GET notifications for a user
// Edge-cached for 30s — per-user (cache key includes userId)
export const GET = withEdgeCache(async (request: NextRequest) => {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const client = getLibsql()
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')

    if (!userId) {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 })
    }

    // Equivalent of Prisma: db.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 })
    const result = await client.execute({
      sql: `SELECT id, message, projectId, targetView, read, userId, createdAt
            FROM notifications
            WHERE userId = ?
            ORDER BY createdAt DESC
            LIMIT 50`,
      args: [bind(userId)],
    })

    const notifications = result.rows.map((row) => ({
      id: String(row.id ?? ''),
      userId: String(row.userId ?? ''),
      message: String(row.message ?? ''),
      projectId: row.projectId === null || row.projectId === undefined ? null : String(row.projectId),
      targetView: String(row.targetView ?? 'project_detail'),
      read: toBool(row.read),
      createdAt: toDateISO(row.createdAt),
    }))

    return NextResponse.json(notifications)
  } catch (error) {
    console.error('Get notifications error:', error)
    return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 })
  }
}, { ttl: 30 })

// PUT mark notification as read
// Original returned the full Prisma notification object after update — we mirror
// that exact shape: { id, userId, message, projectId, targetView, read, createdAt }
export async function PUT(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const client = getLibsql()
    const body = await request.json()
    const { id } = body

    if (!id) {
      return NextResponse.json({ error: 'Notification ID required' }, { status: 400 })
    }

    // UPDATE then SELECT to mirror Prisma's `db.notification.update` returning the row.
    await client.execute({
      sql: `UPDATE notifications SET read = 1 WHERE id = ?`,
      args: [bind(id)],
    })

    const res = await client.execute({
      sql: `SELECT id, message, projectId, targetView, read, userId, createdAt
            FROM notifications
            WHERE id = ?
            LIMIT 1`,
      args: [bind(id)],
    })

    if (res.rows.length === 0) {
      // Mirrors Prisma's P2025 "Record to update not found" → 500 in the original.
      return NextResponse.json({ error: 'Failed to update notification' }, { status: 500 })
    }

    const row = res.rows[0]
    const notification = {
      id: String(row.id ?? ''),
      userId: String(row.userId ?? ''),
      message: String(row.message ?? ''),
      projectId: row.projectId === null || row.projectId === undefined ? null : String(row.projectId),
      targetView: String(row.targetView ?? 'project_detail'),
      read: toBool(row.read),
      createdAt: toDateISO(row.createdAt),
    }

    await invalidateCache('/api/notifications')
    return NextResponse.json(notification)
  } catch (error) {
    console.error('Update notification error:', error)
    return NextResponse.json({ error: 'Failed to update notification' }, { status: 500 })
  }
}
