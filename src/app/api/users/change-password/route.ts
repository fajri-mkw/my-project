import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { userId, currentPassword, newPassword } = body

    if (!userId || !currentPassword || !newPassword) {
      return NextResponse.json({ 
        error: 'User ID, password saat ini, dan password baru harus diisi' 
      }, { status: 400 })
    }

    // Validate password length
    if (newPassword.length < 8) {
      return NextResponse.json({ 
        error: 'Password baru minimal 8 karakter' 
      }, { status: 400 })
    }

    // Validate password complexity: must contain letters and numbers
    if (!/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      return NextResponse.json({ 
        error: 'Password baru harus kombinasi huruf dan angka' 
      }, { status: 400 })
    }

    // Get user from database
    const user = await db.user.findUnique({
      where: { id: userId }
    })

    if (!user) {
      return NextResponse.json({ 
        error: 'User tidak ditemukan' 
      }, { status: 404 })
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.password)
    if (!isValidPassword) {
      return NextResponse.json({ 
        error: 'Password saat ini tidak valid' 
      }, { status: 400 })
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10)

    // Update password
    await db.user.update({
      where: { id: userId },
      data: { password: hashedPassword }
    })

    return NextResponse.json({ 
      success: true,
      message: 'Password berhasil diubah' 
    })
  } catch (error) {
    console.error('Change password error:', error)
    return NextResponse.json({ 
      error: 'Gagal mengubah password' 
    }, { status: 500 })
  }
}
