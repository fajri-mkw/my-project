import { db, ensureDbConnection } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'

// GET reviewer settings
export async function GET(request: NextRequest) {
  try {
    const isConnected = await ensureDbConnection()
    if (!isConnected) {
      return NextResponse.json({ error: 'Database connection failed' }, { status: 500 })
    }
    
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    
    if (!userId) {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 })
    }
    
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { autoApproveReview: true }
    })
    
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }
    
    return NextResponse.json({ autoApproveReview: user.autoApproveReview || false })
  } catch (error) {
    console.error('Error fetching reviewer settings:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT update reviewer settings
export async function PUT(request: NextRequest) {
  try {
    const isConnected = await ensureDbConnection()
    if (!isConnected) {
      return NextResponse.json({ error: 'Database connection failed' }, { status: 500 })
    }
    
    const body = await request.json()
    const { userId, autoApproveReview } = body
    
    if (!userId) {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 })
    }
    
    // Verify user is a Reviewer
    const user = await db.user.findUnique({ where: { id: userId } })
    if (!user || user.role !== 'Reviewer') {
      return NextResponse.json({ error: 'Only Reviewers can update these settings' }, { status: 403 })
    }
    
    await db.user.update({
      where: { id: userId },
      data: { autoApproveReview: autoApproveReview ?? false }
    })
    
    return NextResponse.json({ success: true, autoApproveReview: autoApproveReview ?? false })
  } catch (error) {
    console.error('Error updating reviewer settings:', error)
    const errorMessage = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
