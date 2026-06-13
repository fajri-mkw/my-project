import { db, ensureDbConnection } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'
import { sendTaskAssignmentNotification } from '@/lib/notification-service'
import { getRoleDisplayName } from '@/lib/store'

// GET all projects with relations
// Optimized: excludes full assignee/manager objects (frontends has /api/users data)
export async function GET(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  await ensureDbConnection()
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const role = searchParams.get('role')
    
    // Optimization: Don't include full assignee/manager objects — 
    // the frontend already has user data from /api/users.
    // This cuts response size by ~60% for projects with many tasks.
    const projects = await db.project.findMany({
      include: {
        tasks: {
          select: {
            id: true,
            role: true,
            stage: true,
            status: true,
            assignedTo: true,
            data: true,
            revisionCount: true,
          }
        },
        driveFolders: true,
      },
      orderBy: { createdAt: 'desc' }
    })
    
    // Filter projects based on user role
    let filteredProjects = projects
    if (userId && role && !['Admin', 'Manager'].includes(role)) {
      filteredProjects = projects.filter(p => 
        p.tasks.some(t => t.assignedTo === userId)
      )
    }
    
    // Transform to match frontend format
    const transformedProjects = filteredProjects.map(p => ({
      id: p.id,
      title: p.title,
      description: p.description,
      requesterUnit: p.requesterUnit,
      documents: JSON.parse(p.documents || '[]'),
      location: p.location || '',
      executionTime: p.executionTime || '',
      picName: p.picName || '',
      picWhatsApp: p.picWhatsApp || '',
      activityTypes: JSON.parse(p.activityTypes || '[]'),
      customActivity: p.customActivity || '',
      outputNeeds: JSON.parse(p.outputNeeds || '[]'),
      customOutput: p.customOutput || '',
      workerOutputs: JSON.parse(p.workerOutputs || '{}'),
      workerCustomOutput: JSON.parse(p.workerCustomOutput || '{}'),
      currentStage: p.currentStage,
      isFastTrack: p.isFastTrack,
      isFastProduction: p.isFastProduction,
      managerId: p.managerId,
      createdAt: p.createdAt.toISOString(),
      tasks: p.tasks.map(t => ({
        id: t.id,
        role: t.role,
        stage: t.stage,
        status: t.status,
        assignedTo: t.assignedTo,
        data: t.data ? JSON.parse(t.data) : {},
        revisionCount: t.revisionCount || 0
      })),
      driveFolders: p.driveFolders.map(f => ({
        id: f.id,
        folderId: f.folderId,
        name: f.name,
        desc: f.description || '',
        color: f.color || '',
        bg: f.bgColor || '',
        border: f.borderColor || '',
        link: f.link || '',
        assignedRoles: JSON.parse(f.assignedRoles || '[]'),
        assignedUsers: JSON.parse((f as any).assignedUsers || '[]'),
        parentFolderId: f.parentFolderId || null
      }))
    }))
    
    return NextResponse.json(transformedProjects, {
      headers: { 'Cache-Control': 'private, max-age=10, stale-while-revalidate=30' }
    })
  } catch (error) {
    console.error('Get projects error:', error)
    return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 })
  }
}

// POST create project
export async function POST(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const body = await request.json()
    const {
      title, description, requesterUnit, location, executionTime,
      picName, picWhatsApp, activityTypes, customActivity,
      outputNeeds, customOutput, workerOutputs, workerCustomOutput,
      managerId, tasks, driveFolders,
      isFastTrack, isFastProduction
    } = body
    
    const projectId = `PRJ-${Date.now().toString().slice(-6)}`
    
    const project = await db.project.create({
      data: {
        id: projectId,
        title,
        description,
        requesterUnit,
        location: location || null,
        executionTime: executionTime || null,
        picName: picName || null,
        picWhatsApp: picWhatsApp || null,
        activityTypes: JSON.stringify(activityTypes),
        customActivity: customActivity || null,
        outputNeeds: JSON.stringify(outputNeeds),
        customOutput: customOutput || null,
        workerOutputs: JSON.stringify(workerOutputs || {}),
        workerCustomOutput: JSON.stringify(workerCustomOutput || {}),
        currentStage: isFastTrack ? 5 : 1, // Fast Track: langsung ke tahap Publikasi (5)
        isFastTrack: isFastTrack || false,
        isFastProduction: isFastProduction || false,
        managerId,
        tasks: {
          create: tasks.map((t: { role: string; stage: number; assignedTo: string }) => ({
            role: t.role,
            stage: t.stage,
            status: isFastTrack && t.stage < 5 ? 'completed' : 'pending', // Fast Track: auto-complete stages 1-4
            assignedTo: t.assignedTo,
            data: isFastTrack && t.stage < 5 ? JSON.stringify({ fastTracked: true }) : '{}',
            revisionCount: 0
          }))
        },
        driveFolders: {
          create: driveFolders.map((f: { folderId: string; name: string; desc: string; color: string; bg: string; border: string; link: string; assignedRoles: string[]; assignedUsers?: any[]; parentFolderId?: string }) => ({
            folderId: f.folderId,
            name: f.name,
            description: f.desc,
            color: f.color,
            bgColor: f.bg,
            borderColor: f.border,
            link: f.link,
            assignedRoles: JSON.stringify(f.assignedRoles),
            assignedUsers: f.assignedUsers ? JSON.stringify(f.assignedUsers) : null,
            parentFolderId: f.parentFolderId || null
          }))
        }
      },
      include: {
        tasks: true,
        driveFolders: true
      }
    })
    
    // Create notifications for tasks in the current active stage
    const activeStage = isFastTrack ? 5 : 1
    const activeStageTasks = project.tasks.filter(t => t.stage === activeStage && t.status === 'pending')
    for (const task of activeStageTasks) {
      await db.notification.create({
        data: {
          userId: task.assignedTo,
          message: `Tugas baru dialokasikan untuk proyek ${title}`,
          projectId: project.id,
          targetView: 'project_detail',
          read: false
        }
      })
    }

    // Send WhatsApp/Email notifications only for active stage users (not fast-tracked/skipped)
    try {
      const settings = await db.settings.findFirst({ where: { id: 'main' } })
      const notifEnabled = settings?.notifWaEnabled || settings?.notifEmailEnabled
      if (notifEnabled) {
        const activeTaskUserIds = [...new Set(project.tasks.filter(t => t.status === 'pending').map(t => t.assignedTo))]
        const users = await db.user.findMany({ where: { id: { in: activeTaskUserIds } } })
        const manager = await db.user.findUnique({ where: { id: managerId } })

        for (const user of users) {
          const userTasks = project.tasks.filter(t => t.assignedTo === user.id)
          const userRole = userTasks.length > 0 ? userTasks[0].role : ''
          await sendTaskAssignmentNotification(user, {
            notifWaEnabled: settings.notifWaEnabled || false,
            notifWaToken: settings.notifWaToken,
            notifWaDeviceId: settings.notifWaDeviceId,
            notifWaSenderNumber: settings.notifWaSenderNumber,
            notifEmailEnabled: settings.notifEmailEnabled || false,
            notifEmailHost: settings.notifEmailHost,
            notifEmailPort: settings.notifEmailPort,
            notifEmailUser: settings.notifEmailUser,
            notifEmailPass: settings.notifEmailPass,
            notifEmailFromName: settings.notifEmailFromName
          }, {
            projectTitle: title,
            managerName: manager?.name || 'Manager',
            requesterUnit,
            role: getRoleDisplayName(userRole)
          })
        }
      }
    } catch (err) {
      console.error('Failed to send external notifications:', err)
    }

    return NextResponse.json({
      id: project.id,
      title: project.title,
      description: project.description,
      requesterUnit: project.requesterUnit,
      documents: JSON.parse(project.documents || '[]'),
      location: project.location || '',
      executionTime: project.executionTime || '',
      picName: project.picName || '',
      picWhatsApp: project.picWhatsApp || '',
      activityTypes: JSON.parse(project.activityTypes || '[]'),
      customActivity: project.customActivity || '',
      outputNeeds: JSON.parse(project.outputNeeds || '[]'),
      customOutput: project.customOutput || '',
      currentStage: project.currentStage,
      isFastTrack: project.isFastTrack,
      isFastProduction: project.isFastProduction,
      managerId: project.managerId,
      createdAt: project.createdAt.toISOString(),
      tasks: project.tasks.map(t => ({
        id: t.id,
        role: t.role,
        stage: t.stage,
        status: t.status,
        assignedTo: t.assignedTo,
        data: t.status === 'completed' && isFastTrack && t.stage < 5 ? { fastTracked: true } : (t.data ? JSON.parse(t.data) : {}),
        revisionCount: t.revisionCount || 0
      })),
      driveFolders: project.driveFolders.map(f => ({
        id: f.id,
        folderId: f.folderId,
        name: f.name,
        desc: f.description || '',
        color: f.color || '',
        bg: f.bgColor || '',
        border: f.borderColor || '',
        link: f.link || '',
        assignedRoles: JSON.parse(f.assignedRoles || '[]'),
        assignedUsers: JSON.parse((f as any).assignedUsers || '[]'),
        parentFolderId: f.parentFolderId || null
      }))
    })
  } catch (error) {
    console.error('Create project error:', error)
    return NextResponse.json({ error: 'Failed to create project' }, { status: 500 })
  }
}

// PUT update project
export async function PUT(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const body = await request.json()
    
    // Force complete: Super Admin only
    if (body.action === 'force-complete') {
      const requestUserRole = request.headers.get('X-User-Role')
      if (requestUserRole !== 'Admin') {
        return NextResponse.json({ error: 'Only Super Admin can force-complete projects' }, { status: 403 })
      }
      
      const { id } = body
      if (!id) {
        return NextResponse.json({ error: 'Project ID required' }, { status: 400 })
      }
      
      const project = await db.project.findUnique({
        where: { id },
        include: { tasks: true }
      })
      
      if (!project) {
        return NextResponse.json({ error: 'Project not found' }, { status: 404 })
      }
      
      // Complete all pending tasks
      await Promise.all(
        project.tasks
          .filter(t => t.status !== 'completed')
          .map(t => db.task.update({
            where: { id: t.id },
            data: { 
              status: 'completed', 
              data: JSON.stringify({ forceCompleted: true, completedBy: 'Super Admin' })
            }
          }))
      )
      
      // Set project to stage 6 (completed)
      await db.project.update({
        where: { id },
        data: { currentStage: 6 }
      })
      
      // Notify the manager
      await db.notification.create({
        data: {
          userId: project.managerId,
          message: `Proyek "${project.title}" telah dipaksa selesai (Force Complete) oleh Super Admin.`,
          projectId: id,
          targetView: 'project_detail',
          read: false
        }
      })
      
      return NextResponse.json({ success: true, action: 'force-complete', newStage: 6 })
    }
    
    // Normal update
    const { id, ...data } = body
    
    const project = await db.project.update({
      where: { id },
      data: {
        title: data.title,
        description: data.description,
        requesterUnit: data.requesterUnit,
        location: data.location,
        executionTime: data.executionTime,
        picName: data.picName,
        picWhatsApp: data.picWhatsApp
      }
    })
    
    return NextResponse.json(project)
  } catch (error) {
    console.error('Update project error:', error)
    return NextResponse.json({ error: 'Failed to update project' }, { status: 500 })
  }
}

// DELETE project
export async function DELETE(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    
    if (!id) {
      return NextResponse.json({ error: 'Project ID required' }, { status: 400 })
    }
    
    await db.project.delete({
      where: { id }
    })
    
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete project error:', error)
    return NextResponse.json({ error: 'Failed to delete project' }, { status: 500 })
  }
}
