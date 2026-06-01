import { db, ensureDbConnection } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'

// POST — Super Admin resets another user's password
export async function POST(request: NextRequest) {
  try {
    await ensureDbConnection()
    const body = await request.json()
    const { adminUserId, targetUserId, newPassword } = body

    if (!adminUserId || !targetUserId || !newPassword) {
      return NextResponse.json({ 
        error: 'Admin ID, Target User ID, dan password baru harus diisi' 
      }, { status: 400 })
    }

    // Verify the admin user exists and has Admin role
    const admin = await db.user.findUnique({
      where: { id: adminUserId }
    })

    if (!admin || admin.role !== 'Admin') {
      return NextResponse.json({ 
        error: 'Hanya Super Admin yang dapat mereset password pengguna' 
      }, { status: 403 })
    }

    // Cannot reset own password through this endpoint
    if (adminUserId === targetUserId) {
      return NextResponse.json({ 
        error: 'Gunakan menu ubah password di profil untuk mengubah password Anda sendiri' 
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

    // Verify target user exists
    const targetUser = await db.user.findUnique({
      where: { id: targetUserId }
    })

    if (!targetUser) {
      return NextResponse.json({ 
        error: 'Pengguna tidak ditemukan' 
      }, { status: 404 })
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10)

    // Update password
    await db.user.update({
      where: { id: targetUserId },
      data: { password: hashedPassword }
    })

    return NextResponse.json({ 
      success: true,
      message: `Password pengguna "${targetUser.name}" berhasil direset` 
    })
  } catch (error) {
    console.error('Reset password error:', error)
    return NextResponse.json({ 
      error: 'Gagal mereset password' 
    }, { status: 500 })
  }
}
