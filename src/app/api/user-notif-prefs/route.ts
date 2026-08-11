import { NextRequest, NextResponse } from 'next/server'
import { getLibsql, bind, type InValue } from '@/lib/libsql-client'

// ============================================================================
// PUT update current user's notification preferences.
//
// Rewritten to use @libsql/client directly (bypasses Prisma CPU overhead) —
// same pattern as src/app/api/maintenance/route.ts and src/app/api/users/route.ts.
// The Prisma import (`db` + `ensureDbConnection`) caused Cloudflare Workers
// Error 1102 (Worker exceeded resource limits) on cold starts because loading
// Prisma's WASM module + running ensureSchemaSync() burned too much CPU on the
// Workers free plan (10ms CPU limit).
// ============================================================================

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { userId, notifWaEnabled, notifEmailEnabled } = body as {
      userId?: string
      notifWaEnabled?: boolean
      notifEmailEnabled?: boolean
    }

    if (!userId) {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 })
    }

    // Build dynamic SET clause — only update the boolean fields actually provided.
    const sets: string[] = []
    const args: InValue[] = []

    if (typeof notifWaEnabled === 'boolean') {
      sets.push('notifWaEnabled = ?')
      args.push(bind(notifWaEnabled ? 1 : 0))
    }
    if (typeof notifEmailEnabled === 'boolean') {
      sets.push('notifEmailEnabled = ?')
      args.push(bind(notifEmailEnabled ? 1 : 0))
    }

    if (sets.length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const client = getLibsql()
    const result = await client.execute({
      sql: `UPDATE users SET ${sets.join(', ')} WHERE id = ?`,
      args: [...args, bind(userId)],
    })

    if (result.rowsAffected === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Echo back the requested values (defaulting to false if the field was
    // not provided in this request — matches the original Prisma shape which
    // always returned both booleans).
    return NextResponse.json({
      success: true,
      id: userId,
      notifWaEnabled: typeof notifWaEnabled === 'boolean' ? notifWaEnabled : false,
      notifEmailEnabled: typeof notifEmailEnabled === 'boolean' ? notifEmailEnabled : false,
    })
  } catch (error) {
    console.error('Update user notification prefs error:', error)
    return NextResponse.json({ error: 'Failed to update notification preferences' }, { status: 500 })
  }
}
