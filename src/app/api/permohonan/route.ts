import { db, ensureDbConnection } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'

// GET all permohonan
export async function GET(request: NextRequest) {
  try {
    const isConnected = await ensureDbConnection()
    if (!isConnected) {
      return NextResponse.json({ error: 'Database connection failed', permohonan: [] }, { status: 500 })
    }

    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const userRole = searchParams.get('userRole')

    let permohonan
    if (userRole === 'Admin') {
      // Super Admin sees all
      permohonan = await db.permohonan.findMany({ orderBy: { createdAt: 'desc' } })
    } else if (userRole === 'Administrator') {
      // Administrator sees all
      permohonan = await db.permohonan.findMany({ orderBy: { createdAt: 'desc' } })
    } else if (userRole === 'Manager' && userId) {
      // Manager sees only permohonan forwarded to them
      permohonan = await db.permohonan.findMany({
        where: { managerId: userId },
        orderBy: { createdAt: 'desc' }
      })
    } else {
      permohonan = []
    }

    // Parse JSON fields
    const transformed = permohonan.map((p: any) => ({
      ...p,
      activityTypes: JSON.parse(p.activityTypes || '[]'),
      outputNeeds: JSON.parse(p.outputNeeds || '[]'),
      documents: JSON.parse(p.documents || '[]'),
    }))

    return NextResponse.json(transformed)
  } catch (error) {
    console.error('Get permohonan error:', error)
    return NextResponse.json({ error: 'Failed to fetch permohonan', permohonan: [] }, { status: 500 })
  }
}

// POST create permohonan
export async function POST(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const isConnected = await ensureDbConnection()
    if (!isConnected) {
      return NextResponse.json({ error: 'Database connection failed' }, { status: 500 })
    }

    const body = await request.json()
    const { title, description, requesterUnit, location, executionTime, picName, picWhatsApp, activityTypes, customActivity, outputNeeds, customOutput, adminNote, documents, administratorId } = body

    const permohonan = await db.permohonan.create({
      data: {
        title,
        description,
        requesterUnit,
        location: location || null,
        executionTime: executionTime || null,
        picName: picName || null,
        picWhatsApp: picWhatsApp || null,
        activityTypes: JSON.stringify(activityTypes || []),
        customActivity: customActivity || null,
        outputNeeds: JSON.stringify(outputNeeds || []),
        customOutput: customOutput || null,
        status: 'pending',
        adminNote: adminNote || null,
        documents: JSON.stringify(documents || []),
        administratorId: administratorId || null,
      }
    })

    // Notify all Manager users
    if (administratorId) {
      const managers = await db.user.findMany({ where: { role: 'Manager' } })
      for (const manager of managers) {
        await db.notification.create({
          data: {
            message: `Permohonan baru dari Administrator: ${title}`,
            userId: manager.id,
            projectId: null,
            targetView: 'dashboard',
          }
        })
      }
    }

    const result = {
      ...permohonan,
      activityTypes: JSON.parse(permohonan.activityTypes),
      outputNeeds: JSON.parse(permohonan.outputNeeds),
      documents: JSON.parse(permohonan.documents),
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Create permohonan error:', error)
    return NextResponse.json({ error: 'Failed to create permohonan' }, { status: 500 })
  }
}

// PUT update permohonan
export async function PUT(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const isConnected = await ensureDbConnection()
    if (!isConnected) {
      return NextResponse.json({ error: 'Database connection failed' }, { status: 500 })
    }

    const body = await request.json()
    const { id, ...updateData } = body

    if (!id) {
      return NextResponse.json({ error: 'Permohonan ID required' }, { status: 400 })
    }

    // Prepare update payload - serialize arrays
    const payload: any = {}
    for (const [key, value] of Object.entries(updateData)) {
      if (key === 'activityTypes' || key === 'outputNeeds' || key === 'documents') {
        payload[key] = JSON.stringify(value)
      } else {
        payload[key] = value
      }
    }

    const updated = await db.permohonan.update({
      where: { id },
      data: payload
    })

    // Create notifications for specific actions
    if (updateData.status === 'forwarded' && updateData.managerId) {
      // Notify the selected manager
      const permohonan = await db.permohonan.findUnique({ where: { id } })
      if (permohonan) {
        await db.notification.create({
          data: {
            message: `Permohonan '${permohonan.title}' telah diteruskan kepada Anda`,
            userId: updateData.managerId as string,
            projectId: null,
            targetView: 'dashboard',
          }
        })

        // Notify administrator that it was forwarded
        if (permohonan.administratorId) {
          const manager = await db.user.findUnique({ where: { id: updateData.managerId as string } })
          await db.notification.create({
            data: {
              message: `Permohonan '${permohonan.title}' telah diteruskan kepada ${manager?.name || 'Manager'}`,
              userId: permohonan.administratorId,
              projectId: null,
              targetView: 'permohonan',
            }
          })
        }
      }
    }

    if (updateData.status === 'rejected') {
      const permohonan = await db.permohonan.findUnique({ where: { id } })
      if (permohonan && permohonan.administratorId) {
        const manager = await db.user.findUnique({ where: { id: updateData.managerId as string } })
        await db.notification.create({
          data: {
            message: `Permohonan '${permohonan.title}' telah ditolak oleh ${manager?.name || 'Manager'}${updateData.adminNote ? `. Alasan: ${updateData.adminNote}` : ''}`,
            userId: permohonan.administratorId,
            projectId: null,
            targetView: 'permohonan',
          }
        })
      }
    }

    if (updateData.status === 'completed' && updateData.projectId && updateData.managerId) {
      const permohonan = await db.permohonan.findUnique({ where: { id } })
      if (permohonan && permohonan.administratorId) {
        await db.notification.create({
          data: {
            message: `Permohonan '${permohonan.title}' telah diterima. Proyek telah dibuat.`,
            userId: permohonan.administratorId,
            projectId: updateData.projectId as string,
            targetView: 'project_detail',
          }
        })
      }
    }

    const result = {
      ...updated,
      activityTypes: JSON.parse(updated.activityTypes),
      outputNeeds: JSON.parse(updated.outputNeeds),
      documents: JSON.parse(updated.documents),
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Update permohonan error:', error)
    return NextResponse.json({ error: 'Failed to update permohonan' }, { status: 500 })
  }
}

// DELETE permohonan
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
      return NextResponse.json({ error: 'Permohonan ID required' }, { status: 400 })
    }

    // Allow deleting pending (by Admin) or forwarded (by Manager from inbox) permohonan
    const permohonan = await db.permohonan.findUnique({ where: { id } })
    if (!permohonan) {
      return NextResponse.json({ error: 'Permohonan not found' }, { status: 404 })
    }
    if (permohonan.status !== 'pending' && permohonan.status !== 'forwarded') {
      return NextResponse.json(
        { error: 'Hanya permohonan dengan status pending atau forwarded yang dapat dihapus' },
        { status: 400 },
      )
    }

    // If the permohonan already has an associated project, clean it up too so the
    // manager is not left with an orphaned project containing bad data.
    const deletedProjectId = permohonan.projectId
    await db.permohonan.delete({ where: { id } })
    if (deletedProjectId) {
      try {
        await db.project.delete({ where: { id: deletedProjectId } })
      } catch {
        // Project may already be gone; ignore
      }
    }
    return NextResponse.json({ success: true, deletedProjectId })
  } catch (error) {
    console.error('Delete permohonan error:', error)
    return NextResponse.json({ error: 'Failed to delete permohonan' }, { status: 500 })
  }
}
