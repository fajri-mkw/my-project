import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'
import { sendStageAdvanceNotification, sendReviewRejectionNotification } from '@/lib/notification-service'

// PUT complete task
export async function PUT(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const body = await request.json()
    const { projectId, taskId, taskData, isReviewReject, rejectReason } = body
    
    if (isReviewReject) {
      // Handle review rejection - reset tasks to pending
      const project = await db.project.findUnique({
        where: { id: projectId },
        include: { tasks: true }
      })
      
      if (!project) {
        return NextResponse.json({ error: 'Project not found' }, { status: 404 })
      }
      
      // Update all stage 2 and 3 tasks to pending
      const updatedTasks = await Promise.all(
        project.tasks
          .filter(t => t.stage === 2 || t.stage === 3)
          .map(t => db.task.update({
            where: { id: t.id },
            data: { status: 'pending', data: '{}' }
          }))
      )
      
      // Update project to stage 2
      await db.project.update({
        where: { id: projectId },
        data: { currentStage: 2 }
      })
      
      // Create notifications for stage 2 tasks
      const stage2Tasks = project.tasks.filter(t => t.stage === 2)
      for (const task of stage2Tasks) {
        const reasonText = rejectReason ? `\n\nAlasan: ${rejectReason}` : ''
        await db.notification.create({
          data: {
            userId: task.assignedTo,
            message: `Proyek "${project.title}" ditolak oleh Reviewer. Silakan perbaiki.${reasonText}`,
            projectId: projectId,
            targetView: 'project_detail',
            read: false
          }
        })
      }

      // Send WA/Email for review rejection
      try {
        const settings = await db.settings.findFirst({ where: { id: 'main' } })
        const notifEnabled = settings?.notifWaEnabled || settings?.notifEmailEnabled
        if (notifEnabled) {
          const stage2UserIds = [...new Set(stage2Tasks.map(t => t.assignedTo))]
          const users = await db.user.findMany({ where: { id: { in: stage2UserIds } } })
          for (const user of users) {
            await sendReviewRejectionNotification(user, {
              notifWaEnabled: settings!.notifWaEnabled || false,
              notifWaToken: settings!.notifWaToken,
              notifWaDeviceId: settings!.notifWaDeviceId,
              notifWaSenderNumber: settings!.notifWaSenderNumber,
              notifEmailEnabled: settings!.notifEmailEnabled || false,
              notifEmailHost: settings!.notifEmailHost,
              notifEmailPort: settings!.notifEmailPort,
              notifEmailUser: settings!.notifEmailUser,
              notifEmailPass: settings!.notifEmailPass,
              notifEmailFromName: settings!.notifEmailFromName
            }, {
              projectTitle: project.title,
              rejectReason
            })
          }
        }
      } catch (err) {
        console.error('Failed to send rejection notifications:', err)
      }
      
      return NextResponse.json({ success: true, action: 'rejected' })
    }
    
    // Handle task completion
    const task = await db.task.update({
      where: { id: taskId },
      data: {
        status: 'completed',
        data: JSON.stringify(taskData)
      },
      include: { project: true }
    })
    
    // Check if all current stage tasks are completed
    const projectTasks = await db.task.findMany({
      where: { projectId }
    })
    
    // Get project to check isFastTrack
    const project = await db.project.findUnique({ where: { id: projectId } })
    
    const currentStageTasks = projectTasks.filter(t => t.stage === task.project.currentStage)
    const allCurrentDone = currentStageTasks.length > 0 && currentStageTasks.every(t => t.status === 'completed')
    
    let nextStage = task.project.currentStage
    
    if (allCurrentDone) {
      nextStage = task.project.currentStage + 1
      
      // Fast Track: skip stages 1-3, jump directly to stage 4 (Publikasi)
      if (project?.isFastTrack && nextStage < 4) {
        nextStage = 4
        // Auto-complete all tasks in skipped stages
        await Promise.all(
          projectTasks
            .filter(t => t.stage >= 1 && t.stage <= 3 && t.status === 'pending')
            .map(t => db.task.update({
              where: { id: t.id },
              data: { status: 'completed', data: JSON.stringify({ fastTracked: true }) }
            }))
        )
      }
      
      // Update project stage
      await db.project.update({
        where: { id: projectId },
        data: { currentStage: nextStage }
      })
      
      // Create notifications for next stage tasks
      const nextStageTasks = projectTasks.filter(t => t.stage === nextStage)
      for (const nextTask of nextStageTasks) {
        await db.notification.create({
          data: {
            userId: nextTask.assignedTo,
            message: `Proyek ${task.project.title} maju ke tahap ${nextStage}. Giliran Anda!`,
            projectId: projectId,
            targetView: 'project_detail',
            read: false
          }
        })
      }

      // Send WA/Email for stage advance
      try {
        const settings = await db.settings.findFirst({ where: { id: 'main' } })
        const notifEnabled = settings?.notifWaEnabled || settings?.notifEmailEnabled
        if (notifEnabled && nextStageTasks.length > 0) {
          const nextStageUserIds = [...new Set(nextStageTasks.map(t => t.assignedTo))]
          const users = await db.user.findMany({ where: { id: { in: nextStageUserIds } } })
          for (const user of users) {
            await sendStageAdvanceNotification(user, {
              notifWaEnabled: settings!.notifWaEnabled || false,
              notifWaToken: settings!.notifWaToken,
              notifWaDeviceId: settings!.notifWaDeviceId,
              notifWaSenderNumber: settings!.notifWaSenderNumber,
              notifEmailEnabled: settings!.notifEmailEnabled || false,
              notifEmailHost: settings!.notifEmailHost,
              notifEmailPort: settings!.notifEmailPort,
              notifEmailUser: settings!.notifEmailUser,
              notifEmailPass: settings!.notifEmailPass,
              notifEmailFromName: settings!.notifEmailFromName
            }, {
              projectTitle: task.project.title,
              newStage: nextStage
            })
          }
        }
      } catch (err) {
        console.error('Failed to send stage advance notifications:', err)
 }
      
      // If completed (stage 5), notify manager
      if (nextStage === 5) {
        await db.notification.create({
          data: {
            userId: task.project.managerId,
            message: `Proyek ${task.project.title} telah selesai dan terpublikasi! Laporan kegiatan tersedia.`,
            projectId: projectId,
            targetView: 'reports',
            read: false
          }
        })
      }
    }
    
    return NextResponse.json({
      success: true,
      task: {
        id: task.id,
        status: task.status,
        data: JSON.parse(task.data || '{}')
      },
      newStage: nextStage
    })
  } catch (error) {
    console.error('Update task error:', error)
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 })
  }
}
