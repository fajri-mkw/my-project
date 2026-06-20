import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { getLibsql, nowMs } from '@/lib/libsql-client'

// POST - Change user password
// Rewritten to use @libsql/client directly (bypasses Prisma CPU overhead).
// Also fixes local dev (Prisma's WASM engine fails in some Node environments).
export async function POST(request: NextRequest) {
  try {
    const client = getLibsql()
    const body = await request.json()
    const { userId, currentPassword, newPassword } = body

    if (!userId || !currentPassword || !newPassword) {
      return NextResponse.json({ error: 'Semua field harus diisi' }, { status: 400 })
    }

    if (newPassword.length < 8) {
      return NextResponse.json({ error: 'Password baru minimal 8 karakter' }, { status: 400 })
    }

    if (!/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      return NextResponse.json(
        { error: 'Password baru harus kombinasi huruf dan angka' },
        { status: 400 },
      )
    }

    // Find user
    const result = await client.execute({
      sql: `SELECT password FROM users WHERE id = ? LIMIT 1`,
      args: [userId],
    })

    const row = result.rows[0]
    if (!row) {
      return NextResponse.json({ error: 'User tidak ditemukan' }, { status: 404 })
    }

    const dbPassword = String(row.password ?? '')

    // Check current password (for placeholder, use default password)
    if (dbPassword === '$2a$10$placeholder') {
      if (currentPassword !== 'pushakin123') {
        return NextResponse.json({ error: 'Password saat ini salah' }, { status: 401 })
      }
    } else {
      const isValidPassword = await bcrypt.compare(currentPassword, dbPassword)
      if (!isValidPassword) {
        return NextResponse.json({ error: 'Password saat ini salah' }, { status: 401 })
      }
    }

    // Hash new password (bcrypt cost 6 — optimized for Workers free plan)
    const hashedPassword = await bcrypt.hash(newPassword, 6)

    // Update password
    await client.execute({
      sql: `UPDATE users SET password = ?, updatedAt = ? WHERE id = ?`,
      args: [hashedPassword, nowMs(), userId],
    })

    return NextResponse.json({ message: 'Password berhasil diubah' })
  } catch (error) {
    console.error('Change password error:', error)
    return NextResponse.json(
      { error: 'Terjadi kesalahan saat mengubah password' },
      { status: 500 },
    )
  }
}
