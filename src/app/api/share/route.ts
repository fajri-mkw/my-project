import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// Generate random token
function generateToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

// GET - Get project by public token
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const token = searchParams.get('token')
    
    if (!token) {
      return NextResponse.json({ error: 'Token required' }, { status: 400 })
    }
    
    const project = await db.project.findFirst({
      where: { publicToken: token },
      include: {
        tasks: {
          include: {
            assignee: {
              select: { id: true, name: true, avatar: true, role: true }
            }
          }
        },
        manager: {
          select: { id: true, name: true, avatar: true }
        }
      }
    })
    
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }
    
    return NextResponse.json({ project })
  } catch (error) {
    console.error('Error fetching public project:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Generate public token for a project
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { projectId } = body
    
    if (!projectId) {
      return NextResponse.json({ error: 'Project ID required' }, { status: 400 })
    }
    
    // Check if project already has a token
    const existingProject = await db.project.findUnique({
      where: { id: projectId },
      select: { publicToken: true }
    })
    
    if (existingProject?.publicToken) {
      return NextResponse.json({ 
        token: existingProject.publicToken,
        message: 'Token already exists'
      })
    }
    
    // Generate new token
    const token = generateToken()
    
    await db.project.update({
      where: { id: projectId },
      data: { publicToken: token }
    })
    
    return NextResponse.json({ 
      token,
      message: 'Public token generated successfully'
    })
  } catch (error) {
    console.error('Error generating public token:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Revoke public token
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get('projectId')
    
    if (!projectId) {
      return NextResponse.json({ error: 'Project ID required' }, { status: 400 })
    }
    
    await db.project.update({
      where: { id: projectId },
      data: { publicToken: null }
    })
    
    return NextResponse.json({ message: 'Public token revoked' })
  } catch (error) {
    console.error('Error revoking public token:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
