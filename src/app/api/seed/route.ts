import { db, ensureDbConnection } from '@/lib/db'
import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'

const ROLES: string[] = [
  'Admin', 'Administrator', 'Manager', 'Reporter', 'PhotographerVideographerAudio',
  'EditorMedia', 'EditorWebSocialMedia', 'GraphicDesigner',
  'StreamingOperator', 'PodcastOperator', 'Reviewer', 'PublisherWeb', 'PublisherSocialMedia'
]

const ROLE_DISPLAY_NAMES: Record<string, string> = {
  'Admin': 'Super Admin',
  'Administrator': 'Administrator',
  'Manager': 'Manager',
  'Reporter': 'Reporter',
  'PhotographerVideographerAudio': 'Photographer, Videographer, dan Audio',
  'EditorMedia': 'Editor (Media)',
  'EditorWebSocialMedia': 'Editor (Web Article & Social Media)',
  'GraphicDesigner': 'Graphic Designer',
  'StreamingOperator': 'Streaming Operator',
  'PodcastOperator': 'Podcast Operator',
  'Reviewer': 'Reviewer',
  'PublisherWeb': 'Publisher Web',
  'PublisherSocialMedia': 'Publisher Social Media'
}

export async function GET() {
  try {
    // Ensure DB connection and schema is synced
    const isConnected = await ensureDbConnection()
    if (!isConnected) {
      return NextResponse.json({
        success: false,
        error: 'Database connection failed'
      }, { status: 500 })
    }

    // Check if users already exist
    const existingUsers = await db.user.count()
    if (existingUsers > 0) {
      return NextResponse.json({
        message: 'Database sudah diinisialisasi',
        usersCount: existingUsers,
        alreadySeeded: true
      })
    }

    // Default password for all demo users
    const defaultPassword = await bcrypt.hash('pushakin123', 10)

    // Create users for each role
    const users = []
    for (let idx = 0; idx < ROLES.length; idx++) {
      const role = ROLES[idx]
      const displayName = ROLE_DISPLAY_NAMES[role]
      try {
        const user = await db.user.create({
          data: {
            name: `${displayName.split(' ')[0]} User`,
            email: `user${idx + 1}@pushakin.local`,
            password: defaultPassword,
            whatsapp: `0812345678${idx.toString().padStart(2, '0')}`,
            avatar: `https://i.pravatar.cc/150?u=${idx}`,
            role: role
          }
        })
        users.push(user)
      } catch (userError) {
        console.error(`Failed to create user ${idx + 1}:`, userError)
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Database berhasil diinisialisasi!',
      usersCount: users.length,
      users: users.map(u => ({ id: u.id, name: u.name, role: u.role, email: u.email })),
      defaultPassword: 'pushakin123',
      note: 'Semua user demo menggunakan password: pushakin123'
    })
  } catch (error) {
    console.error('Seed error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({
      success: false,
      error: 'Gagal menginisialisasi database',
      details: errorMessage
    }, { status: 500 })
  }
}
