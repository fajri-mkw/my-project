import { db, ensureDbConnection } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { checkMaintenanceMode } from '@/lib/maintenance-check'

// GET all users — always allowed (needed for login)
export async function GET() {
  try {
    // Ensure database connection
    const isConnected = await ensureDbConnection()
    if (!isConnected) {
      return NextResponse.json({ 
        error: 'Database connection failed',
        users: [] 
      }, { status: 500 })
    }

    // Single query to fetch all user data (was 2 queries before)
    const users = await db.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        whatsapp: true,
        role: true,
        notifWaEnabled: true,
        notifEmailEnabled: true,
        password: true,
        avatar: true,
        autoApproveReview: true,
      }
    })
    
    // Return users with original DB role values
    // Display names are handled client-side via ROLE_DISPLAY_NAMES in store.ts
    // IMPORTANT: Replace large base64 avatars with lightweight URLs to prevent
    // API response bloat (some avatars are 700KB+ causing browser fetch timeouts)
    const transformedUsers = users.map(u => {
      const avatar = u.avatar || ''
      // Replace massive base64 avatars with a lightweight URL placeholder
      // This reduces response from ~1.7MB to ~15KB, preventing timeout errors
      const finalAvatar = (avatar.startsWith('data:image') && avatar.length > 50000)
        ? `https://ui-avatars.com/api/?name=${encodeURIComponent(u.name)}&background=7c3aed&color=fff&size=150`
        : avatar
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        whatsapp: u.whatsapp || '',
        avatar: finalAvatar,
        role: u.role,
        notifWaEnabled: u.notifWaEnabled,
        notifEmailEnabled: u.notifEmailEnabled,
        hasPassword: !!(u.password && u.password !== '$2a$10$placeholder'),
        autoApproveReview: u.autoApproveReview || false,
      }
    })
    
    return NextResponse.json(transformedUsers, {
      headers: { 'Cache-Control': 'private, max-age=10, stale-while-revalidate=30' }
    })
  } catch (error) {
    console.error('Get users error:', error)
    return NextResponse.json({ 
      error: 'Failed to fetch users',
      details: error instanceof Error ? error.message : 'Unknown error',
      users: []
    }, { status: 500 })
  }
}

// POST create user
export async function POST(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const isConnected = await ensureDbConnection()
    if (!isConnected) {
      return NextResponse.json({ error: 'Database connection failed' }, { status: 500 })
    }

    const body = await request.json()
    const { name, email, whatsapp, avatar, role, password } = body
    
    // Frontend now sends DB role values directly, no conversion needed
    const dbRole = role || 'Reporter'
    
    // Hash password or use default
    const hashedPassword = password 
      ? await bcrypt.hash(password, 6)
      : await bcrypt.hash('pushakin123', 6)
    
    const user = await db.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        whatsapp: whatsapp || '',
        avatar: avatar || `https://i.pravatar.cc/150?u=${Date.now()}`,
        role: dbRole
      }
    })
    
    return NextResponse.json({
      id: user.id,
      name: user.name,
      email: user.email,
      whatsapp: user.whatsapp || '',
      avatar: user.avatar || '',
      role: user.role,
      autoApproveReview: user.autoApproveReview || false,
      defaultPassword: password ? null : 'pushakin123'
    })
  } catch (error) {
    console.error('Create user error:', error)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    if (msg.includes('Unique constraint') || msg.includes('unique')) {
      return NextResponse.json({ error: 'Email sudah digunakan pengguna lain' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Failed to create user', details: msg }, { status: 500 })
  }
}

// PUT update user
export async function PUT(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const isConnected = await ensureDbConnection()
    if (!isConnected) {
      return NextResponse.json({ error: 'Database connection failed' }, { status: 500 })
    }

    const body = await request.json()
    const { id, name, email, whatsapp, avatar, role } = body
    
    // Frontend now sends DB role values directly, no conversion needed
    const dbRole = role || 'Reporter'
    
    const user = await db.user.update({
      where: { id },
      data: {
        name,
        email,
        whatsapp,
        avatar,
        role: dbRole,
        autoApproveReview: body.autoApproveReview !== undefined ? body.autoApproveReview : undefined,
      }
    })
    
    return NextResponse.json({
      id: user.id,
      name: user.name,
      email: user.email,
      whatsapp: user.whatsapp || '',
      avatar: user.avatar || '',
      role: user.role,
      autoApproveReview: user.autoApproveReview || false,
    })
  } catch (error) {
    console.error('Update user error:', error)
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 })
  }
}

// DELETE user
export async function DELETE(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const isConnected = await ensureDbConnection()
    if (!isConnected) {
      return NextResponse.json({ error: 'Database connection failed' }, { status: 500 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    
    if (!id) {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 })
    }
    
    await db.user.delete({
      where: { id }
    })
    
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete user error:', error)
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 })
  }
}
