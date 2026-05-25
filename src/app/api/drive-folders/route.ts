import { db, ensureDbConnection } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'

// PUT update drive folder links and role assignments
export async function PUT(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    await ensureDbConnection()
    const body = await request.json()
    const { projectId, folders } = body as {
      projectId: string
      folders: { id: string; link: string; assignedRoles?: string[] }[]
    }
    
    const updates = await Promise.all(
      folders.map((f) => 
        db.driveFolder.update({
          where: { id: f.id },
          data: { 
            link: f.link,
            assignedRoles: f.assignedRoles ? JSON.stringify(f.assignedRoles) : null
          }
        })
      )
    )
    
    return NextResponse.json({ success: true, count: updates.length })
  } catch (error) {
    console.error('Update drive folders error:', error)
    return NextResponse.json({ error: 'Failed to update drive folders' }, { status: 500 })
  }
}
