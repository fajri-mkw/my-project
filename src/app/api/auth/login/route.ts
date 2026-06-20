import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { getLibsql, toBool } from '@/lib/libsql-client'

// Transform user for frontend — keep original DB role value
// Display names are handled client-side via ROLE_DISPLAY_NAMES in store.ts
const transformUser = (user: {
  id: unknown
  name: unknown
  email: unknown
  whatsapp: unknown
  avatar: unknown
  role: unknown
  autoApproveReview: unknown
}) => ({
  id: String(user.id ?? ''),
  name: String(user.name ?? ''),
  email: String(user.email ?? ''),
  whatsapp: String(user.whatsapp ?? ''),
  avatar: String(user.avatar ?? ''),
  role: String(user.role ?? 'Reporter'),
  autoApproveReview: toBool(user.autoApproveReview),
})

// POST - Login with email and password
// Rewritten to use @libsql/client directly (bypasses Prisma CPU overhead).
// This also fixes local dev (the patched @libsql/client doesn't support
// `file:` URLs, so libsql-client.ts routes file: URLs to better-sqlite3).
export async function POST(request: NextRequest) {
  try {
    const client = getLibsql()
    const body = await request.json()
    const { email, password } = body

    if (!email || !password) {
      return NextResponse.json({ error: 'Email dan password harus diisi' }, { status: 400 })
    }

    const result = await client.execute({
      sql: `SELECT id, name, email, whatsapp, avatar, role, password, autoApproveReview
            FROM users
            WHERE email = ?
            LIMIT 1`,
      args: [String(email).toLowerCase()],
    })

    const row = result.rows[0]
    if (!row) {
      return NextResponse.json({ error: 'Email atau password salah' }, { status: 401 })
    }

    const dbPassword = String(row.password ?? '')

    if (dbPassword === '$2a$10$placeholder') {
      const defaultPassword = 'pushakin123'
      if (password !== defaultPassword) {
        return NextResponse.json(
          {
            error: 'Password default salah. Hubungi administrator.',
            requiresDefaultPassword: true,
          },
          { status: 401 },
        )
      }

      return NextResponse.json({
        user: transformUser(row),
        message: 'Login berhasil. Silakan ganti password Anda.',
        mustChangePassword: true,
      })
    }

    const isValidPassword = await bcrypt.compare(password, dbPassword)

    if (!isValidPassword) {
      return NextResponse.json({ error: 'Email atau password salah' }, { status: 401 })
    }

    return NextResponse.json({ user: transformUser(row) })
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json(
      {
        error: 'Terjadi kesalahan saat login. Silakan coba lagi.',
        details:
          process.env.NODE_ENV === 'development' && error instanceof Error
            ? error.message
            : undefined,
      },
      { status: 500 },
    )
  }
}
