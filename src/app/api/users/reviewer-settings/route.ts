import { db, ensureDbConnection } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { invalidateCache } from '@/lib/edge-cache'

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
    
    // When auto-approve is turned ON, immediately auto-approve any pending
    // reviewer tasks for this user on projects that are currently at stage 3
    // (Review). This ensures the setting takes immediate effect — the reviewer
    // doesn't have to wait for another task completion event to trigger it.
    // For projects not yet at stage 3, the auto-approve will fire automatically
    // when the stage advances to 3 (handled in the tasks API).
    if (autoApproveReview) {
      const pendingReviewTasks = await db.task.findMany({
        where: {
          assignedTo: userId,
          stage: 3,
          status: 'pending'
        },
        include: { project: true }
      })
      
      // Only auto-approve tasks where the project is at stage 3 (Review)
      const tasksToAutoApprove = pendingReviewTasks.filter(t => t.project.currentStage === 3)
      
      for (const task of tasksToAutoApprove) {
        await db.task.update({
          where: { id: task.id },
          data: { status: 'completed', data: JSON.stringify({ autoApproved: true }) }
        })
        
        // Notify the reviewer
        await db.notification.create({
          data: {
            userId,
            message: `Proyek "${task.project.title}" telah di-auto-approve. Tahap review Anda dilewati otomatis sesuai pengaturan Auto-Approve Anda.`,
            projectId: task.projectId,
            targetView: 'project_detail',
            read: false
          }
        })
        
        // Check if all stage-3 tasks for this project are now completed.
        // If so, advance the project to the next stage (skip Review).
        const projectTasks = await db.task.findMany({ where: { projectId: task.projectId } })
        const stage3Tasks = projectTasks.filter(t => t.stage === 3)
        const stage3AllDone = stage3Tasks.length > 0 && stage3Tasks.every(t => t.status === 'completed')
        
        if (stage3AllDone) {
          // Find the next stage with pending tasks (skip stage 3)
          let nextStage = 4
          while (nextStage <= 4) {
            const nextTasks = projectTasks.filter(t => t.stage === nextStage && t.status === 'pending')
            if (nextTasks.length > 0) break
            const nextCompleted = projectTasks.filter(t => t.stage === nextStage && t.status === 'completed')
            if (nextCompleted.length > 0) { nextStage++; continue }
            nextStage++
          }
          if (nextStage > 4) nextStage = 5
          
          await db.project.update({
            where: { id: task.projectId },
            data: { currentStage: nextStage }
          })
          
          // Notify next-stage workers
          const nextStagePendingTasks = projectTasks.filter(t => t.stage === nextStage && t.status === 'pending')
          for (const nextTask of nextStagePendingTasks) {
            await db.notification.create({
              data: {
                userId: nextTask.assignedTo,
                message: `Proyek ${task.project.title} maju ke tahap ${nextStage}. Giliran Anda!`,
                projectId: task.projectId,
                targetView: 'project_detail',
                read: false
              }
            })
          }
        }
      }
    }

    // === Invalidate edge caches — auto-approve above may have advanced ===
    // projects.currentStage and created notifications. Without this, the
    // dashboard keeps showing the old stage for up to 15s (edge TTL).
    await invalidateCache('/api/projects')
    await invalidateCache('/api/notifications')
    await invalidateCache('/api/surat-tugas')
    await invalidateCache('/api/users')
    
    return NextResponse.json({ 
      success: true, 
      autoApproveReview: autoApproveReview ?? false,
      immediateAutoApproved: autoApproveReview ? true : false
    })
  } catch (error) {
    console.error('Error updating reviewer settings:', error)
    const errorMessage = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
