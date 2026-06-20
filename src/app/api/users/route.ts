import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { checkMaintenanceMode } from '@/lib/maintenance-check'
import { withEdgeCache, invalidateCache } from '@/lib/edge-cache'
import {
  getLibsql,
  toBool,
  bind,
  genId,
  nowMs,
} from '@/lib/libsql-client'

// GET all users — always allowed (needed for login)
// Rewritten to use @libsql/client directly (bypasses Prisma CPU overhead).
// Edge-cached for 60s to reduce CPU usage on Workers free plan.
export const GET = withEdgeCache(async (_request: NextRequest) => {
  try {
    const client = getLibsql()

    // Single query — fetches exactly the columns the frontend needs.
    // password is included so we can compute hasPassword.
    const result = await client.execute({
      sql: `SELECT id, name, email, whatsapp, avatar, role, password,
                   notifWaEnabled, notifEmailEnabled, autoApproveReview
            FROM users
            ORDER BY createdAt DESC`,
      args: [],
    })

    const transformedUsers = result.rows.map((row) => {
      const name = String(row.name ?? '')
      const avatar = String(row.avatar ?? '')
      // Replace massive base64 avatars with a lightweight URL placeholder.
      // This reduces response from ~1.7MB to ~15KB, preventing timeout errors.
      const finalAvatar =
        avatar.startsWith('data:image') && avatar.length > 50000
          ? `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=7c3aed&color=fff&size=150`
          : avatar

      return {
        id: String(row.id ?? ''),
        name,
        email: String(row.email ?? ''),
        whatsapp: String(row.whatsapp ?? ''),
        avatar: finalAvatar,
        role: String(row.role ?? 'Reporter'),
        notifWaEnabled: toBool(row.notifWaEnabled),
        notifEmailEnabled: toBool(row.notifEmailEnabled),
        hasPassword: !!(
          row.password &&
          String(row.password) !== '$2a$10$placeholder'
        ),
        autoApproveReview: toBool(row.autoApproveReview),
      }
    })

    return NextResponse.json(transformedUsers, {
      headers: { 'Cache-Control': 'private, max-age=10, stale-while-revalidate=30' },
    })
  } catch (error) {
    console.error('Get users error:', error)
    return NextResponse.json(
      {
        error: 'Failed to fetch users',
        details: error instanceof Error ? error.message : 'Unknown error',
        users: [],
      },
      { status: 500 },
    )
  }
}, { ttl: 60 })

// POST create user
export async function POST(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock

  try {
    const client = getLibsql()
    const body = await request.json()
    const { name, email, whatsapp, avatar, role, password } = body

    // Frontend sends DB role values directly, no conversion needed
    const dbRole = role || 'Reporter'

    // Hash password or use default (bcrypt cost 6 — optimized for Workers free plan)
    const hashedPassword = password
      ? await bcrypt.hash(password, 6)
      : await bcrypt.hash('pushakin123', 6)

    const id = genId()
    const ts = nowMs()

    try {
      await client.execute({
        sql: `INSERT INTO users
              (id, name, email, password, whatsapp, avatar, role,
               notifWaEnabled, notifEmailEnabled, autoApproveReview,
               createdAt, updatedAt)
              VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 0, ?, ?)`,
        args: [
          id,
          name,
          email,
          hashedPassword,
          bind(whatsapp) ?? '',
          bind(avatar) ?? `https://i.pravatar.cc/150?u=${ts}`,
          dbRole,
          ts,
          ts,
        ],
      })
    } catch (insertError) {
      const msg =
        insertError instanceof Error ? insertError.message : String(insertError)
      // SQLite unique constraint violation
      if (
        msg.includes('UNIQUE constraint failed') ||
        msg.includes('unique') ||
        msg.includes('already exists')
      ) {
        return NextResponse.json(
          { error: 'Email sudah digunakan pengguna lain' },
          { status: 400 },
        )
      }
      throw insertError
    }

    await invalidateCache('/api/users')
    return NextResponse.json({
      id,
      name,
      email,
      whatsapp: whatsapp || '',
      avatar: avatar || `https://i.pravatar.cc/150?u=${ts}`,
      role: dbRole,
      autoApproveReview: false,
      defaultPassword: password ? null : 'pushakin123',
    })
  } catch (error) {
    console.error('Create user error:', error)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: 'Failed to create user', details: msg },
      { status: 500 },
    )
  }
}

// PUT update user
export async function PUT(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock

  try {
    const client = getLibsql()
    const body = await request.json()
    const { id, name, email, whatsapp, avatar, role } = body

    // Frontend sends DB role values directly, no conversion needed
    const dbRole = role || 'Reporter'

    // autoApproveReview: if undefined, keep existing value (COALESCE).
    // Pass null to skip; pass 0/1 to update.
    const autoApproveVal =
      body.autoApproveReview !== undefined
        ? body.autoApproveReview
          ? 1
          : 0
        : null

    const ts = nowMs()

    await client.execute({
      sql: `UPDATE users SET
              name = ?,
              email = ?,
              whatsapp = ?,
              avatar = ?,
              role = ?,
              autoApproveReview = COALESCE(?, autoApproveReview),
              updatedAt = ?
            WHERE id = ?`,
      args: [
        bind(name),
        bind(email),
        bind(whatsapp),
        bind(avatar),
        dbRole,
        autoApproveVal,
        ts,
        id,
      ],
    })

    await invalidateCache('/api/users')
    return NextResponse.json({
      id,
      name,
      email: email ?? '',
      whatsapp: whatsapp ?? '',
      avatar: avatar ?? '',
      role: dbRole,
      // If autoApproveReview was provided, echo it back; otherwise default false
      // (matches original behavior where Prisma returned the actual DB value)
      autoApproveReview:
        body.autoApproveReview !== undefined ? !!body.autoApproveReview : false,
    })
  } catch (error) {
    console.error('Update user error:', error)
    return NextResponse.json(
      { error: 'Failed to update user' },
      { status: 500 },
    )
  }
}

// DELETE user — FK cascade (ON DELETE CASCADE) handles tasks, notifications,
// surat_tugas, sops, and projects-as-manager automatically.
export async function DELETE(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock

  try {
    const client = getLibsql()
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { error: 'User ID required' },
        { status: 400 },
      )
    }

    await client.execute({
      sql: `DELETE FROM users WHERE id = ?`,
      args: [id],
    })

    await invalidateCache('/api/users')
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete user error:', error)
    return NextResponse.json(
      { error: 'Failed to delete user' },
      { status: 500 },
    )
  }
}
