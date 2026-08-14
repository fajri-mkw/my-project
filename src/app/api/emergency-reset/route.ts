import { NextRequest, NextResponse } from 'next/server'
import { getLibsql } from '@/lib/libsql-client'
import bcrypt from 'bcryptjs'

// ============================================================================
// ⚠️  TEMPORARY EMERGENCY ENDPOINT — DELETE IMMEDIATELY AFTER USE  ⚠️
//
// Purpose: Reset a forgotten Super Admin password when no other admin can
// log in to use the normal /api/users/reset-password endpoint.
//
// Security: Gated by a strong one-time secret. Only resets the password for
// the specified email — does not expose any other user data.
//
// This endpoint will be DELETED and the app redeployed right after the reset
// is confirmed successful.
// ============================================================================

const EMERGENCY_SECRET = 'ef82686e6df76139e9c5e95c44c88dfc3b7a0af329277507'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { secret, email, newPassword } = body as {
      secret?: string
      email?: string
      newPassword?: string
    }

    // 1. Verify the secret
    if (!secret || secret !== EMERGENCY_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 2. Validate inputs
    if (!email || !newPassword) {
      return NextResponse.json(
        { error: 'Email dan password baru harus diisi' },
        { status: 400 },
      )
    }

    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: 'Password baru minimal 8 karakter' },
        { status: 400 },
      )
    }

    if (!/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      return NextResponse.json(
        { error: 'Password baru harus kombinasi huruf dan angka' },
        { status: 400 },
      )
    }

    // 3. Find the user by email
    const client = getLibsql()
    const res = await client.execute({
      sql: `SELECT id, name, role FROM users WHERE email = ? LIMIT 1`,
      args: [email.toLowerCase()],
    })

    if (res.rows.length === 0) {
      return NextResponse.json(
        { error: `User dengan email "${email}" tidak ditemukan` },
        { status: 404 },
      )
    }

    const user = res.rows[0] as { id: string; name: string; role: string }

    // 4. Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 6)

    // 5. Update the password
    await client.execute({
      sql: `UPDATE users SET password = ?, updatedAt = ? WHERE id = ?`,
      args: [hashedPassword, Date.now(), user.id],
    })

    return NextResponse.json({
      success: true,
      message: `Password untuk "${user.name}" (${user.role}) berhasil direset`,
      userId: user.id,
    })
  } catch (error) {
    console.error('[EMERGENCY-RESET] error:', error)
    return NextResponse.json(
      {
        error: 'Gagal mereset password',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    )
  }
}
