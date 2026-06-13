import { db, ensureDbConnection } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'

// Generate nomor surat: ST/001/I/2025
async function generateNomorSurat(): Promise<string> {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  
  // Get count of surat tugas this month
  const startOfMonth = new Date(year, month - 1, 1)
  const endOfMonth = new Date(year, month, 0)
  
  const count = await db.suratTugas.count({
    where: {
      createdAt: {
        gte: startOfMonth,
        lte: endOfMonth
      }
    }
  })
  
  const romanMonths = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']
  const sequence = (count + 1).toString().padStart(3, '0')
  
  return `ST/${sequence}/${romanMonths[month - 1]}/${year}`
}

// GET - Get all surat tugas for a user
export async function GET(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    await ensureDbConnection()
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const suratId = searchParams.get('id')
    
    // Get single surat tugas by ID
    if (suratId) {
      const surat = await db.suratTugas.findUnique({
        where: { id: suratId },
        include: {
          project: {
            include: {
              manager: true,
              tasks: {
                include: {
                  assignee: true
                }
              }
            }
          },
          user: true
        }
      })
      
      if (!surat) {
        return NextResponse.json({ error: 'Surat tugas not found' }, { status: 404 })
      }
      
      return NextResponse.json({
        id: surat.id,
        nomorSurat: surat.nomorSurat,
        projectId: surat.projectId,
        userId: surat.userId,
        role: surat.role,
        stage: surat.stage,
        status: surat.status,
        read: surat.read,
        createdAt: surat.createdAt.toISOString(),
        project: {
          id: surat.project.id,
          title: surat.project.title,
          description: surat.project.description,
          requesterUnit: surat.project.requesterUnit,
          location: surat.project.location || '',
          executionTime: surat.project.executionTime || '',
          picName: surat.project.picName || '',
          picWhatsApp: surat.project.picWhatsApp || '',
          activityTypes: JSON.parse(surat.project.activityTypes || '[]'),
          outputNeeds: JSON.parse(surat.project.outputNeeds || '[]'),
          manager: surat.project.manager
        },
        user: {
          id: surat.user.id,
          name: surat.user.name,
          email: surat.user.email,
          role: surat.user.role
        }
      })
    }
    
    // Get all surat tugas for user
    if (!userId) {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 })
    }
    
    const suratList = await db.suratTugas.findMany({
      where: { userId },
      include: {
        project: {
          include: {
            manager: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    })
    
    return NextResponse.json(suratList.map(s => ({
      id: s.id,
      nomorSurat: s.nomorSurat,
      projectId: s.projectId,
      userId: s.userId,
      role: s.role,
      stage: s.stage,
      status: s.status,
      read: s.read,
      createdAt: s.createdAt.toISOString(),
      project: {
        id: s.project.id,
        title: s.project.title,
        manager: s.project.manager
      }
    })))
  } catch (error) {
    console.error('Get surat tugas error:', error)
    return NextResponse.json({ error: 'Failed to fetch surat tugas' }, { status: 500 })
  }
}

// POST - Create new surat tugas
export async function POST(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    await ensureDbConnection()
    const body = await request.json()
    const { projectId, userId, role, stage } = body
    
    if (!projectId || !userId || !role || stage === undefined) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    
    // Check if surat tugas already exists for this project-user-role combination
    const existing = await db.suratTugas.findFirst({
      where: {
        projectId,
        userId,
        role
      }
    })
    
    if (existing) {
      return NextResponse.json({ 
        message: 'Surat tugas already exists',
        surat: existing 
      })
    }
    
    const nomorSurat = await generateNomorSurat()
    
    const surat = await db.suratTugas.create({
      data: {
        nomorSurat,
        projectId,
        userId,
        role,
        stage,
        status: 'active',
        read: false
      },
      include: {
        project: {
          include: {
            manager: true
          }
        },
        user: true
      }
    })
    
    // Create a notification for the assigned user so they see it in the bell
    try {
      const project = await db.project.findUnique({ where: { id: projectId } })
      if (project) {
        const existingNotif = await db.notification.findFirst({
          where: {
            userId,
            projectId,
            message: { contains: `Tugas baru dialokasikan untuk proyek ${project.title}` }
          }
        })
        // Only create notification if one doesn't already exist for this assignment
        if (!existingNotif) {
          await db.notification.create({
            data: {
              userId,
              message: `Tugas baru dialokasikan untuk proyek ${project.title}`,
              projectId,
              targetView: 'inbox',
              read: false
            }
          })
        }
      }
    } catch (notifErr) {
      console.error('Failed to create surat tugas notification:', notifErr)
    }
    
    return NextResponse.json({
      id: surat.id,
      nomorSurat: surat.nomorSurat,
      projectId: surat.projectId,
      userId: surat.userId,
      role: surat.role,
      stage: surat.stage,
      status: surat.status,
      read: surat.read,
      createdAt: surat.createdAt.toISOString(),
      project: {
        id: surat.project.id,
        title: surat.project.title,
        manager: surat.project.manager
      }
    })
  } catch (error) {
    console.error('Create surat tugas error:', error)
    return NextResponse.json({ error: 'Failed to create surat tugas' }, { status: 500 })
  }
}

// PUT - Update surat tugas (mark as read, update status)
export async function PUT(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    await ensureDbConnection()
    const body = await request.json()
    const { id, read, status } = body
    
    if (!id) {
      return NextResponse.json({ error: 'Surat tugas ID required' }, { status: 400 })
    }
    
    const updateData: { read?: boolean; status?: string } = {}
    if (read !== undefined) updateData.read = read
    if (status !== undefined) updateData.status = status
    
    const surat = await db.suratTugas.update({
      where: { id },
      data: updateData
    })
    
    return NextResponse.json(surat)
  } catch (error) {
    console.error('Update surat tugas error:', error)
    return NextResponse.json({ error: 'Failed to update surat tugas' }, { status: 500 })
  }
}
