import { db, ensureDbConnection } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'

// Transform user for frontend — keep original DB role value
// Display names are handled client-side via ROLE_DISPLAY_NAMES in store.ts
const transformUser = (user: { id: string; name: string; email: string; whatsapp: string | null; avatar: string | null; role: string; autoApproveReview: boolean | null }) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  whatsapp: user.whatsapp || '',
  avatar: user.avatar || '',
  role: user.role,
  autoApproveReview: user.autoApproveReview || false,
})

// POST - Login with email and password
export async function POST(request: NextRequest) {
  try {
    const isConnected = await ensureDbConnection()
    if (!isConnected) {
      return NextResponse.json({ error: 'Koneksi database gagal. Silakan hubungi administrator.' }, { status: 500 })
    }

    const body = await request.json()
    const { email, password } = body

    if (!email || !password) {
      return NextResponse.json({ error: 'Email dan password harus diisi' }, { status: 400 })
    }

    const user = await db.user.findUnique({
      where: { email: email.toLowerCase() }
    })

    if (!user) {
      return NextResponse.json({ error: 'Email atau password salah' }, { status: 401 })
    }

    if (user.password === '$2a$10$placeholder') {
      const defaultPassword = 'pushakin123'
      if (password !== defaultPassword) {
        return NextResponse.json({ 
          error: 'Password default salah. Hubungi administrator.',
          requiresDefaultPassword: true 
        }, { status: 401 })
      }
      
      return NextResponse.json({ 
        user: transformUser(user),
        message: 'Login berhasil. Silakan ganti password Anda.',
        mustChangePassword: true
      })
    }

    const isValidPassword = await bcrypt.compare(password, user.password)

    if (!isValidPassword) {
      return NextResponse.json({ error: 'Email atau password salah' }, { status: 401 })
    }

    return NextResponse.json({ user: transformUser(user) })

  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json({ 
      error: 'Terjadi kesalahan saat login. Silakan coba lagi.',
      details: process.env.NODE_ENV === 'development' && error instanceof Error ? error.message : undefined
    }, { status: 500 })
  }
}
