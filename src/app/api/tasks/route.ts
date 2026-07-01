import { db, ensureDbConnection } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'
import { sendStageAdvanceNotification, sendReviewRejectionNotification } from '@/lib/notification-service'
import { invalidateCache, deferToBackground } from '@/lib/edge-cache'

// PUT complete task
export async function PUT(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  await ensureDbConnection()
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
      // DEFERRED to background (ctx.waitUntil) — each WA/Email call can take
      // 1-3s and is already fire-and-forget (wrapped in try/catch). Running
      // it synchronously was adding 1-5s to the response time, pushing us
      // past Cloudflare Workers' wall-clock limits on slow days and causing
      // the "Gagal menyelesaikan tugas: Gagal menyelesaikan tugas" non-JSON
      // errors users kept seeing.
      deferToBackground((async () => {
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
      })())

      // === CRITICAL: invalidate edge caches so other clients see the stage reset ===
      // Without this, /api/projects keeps serving the old (pre-rejection) currentStage
      // for up to 60s, causing the dashboard to show stale status.
      await invalidateCache('/api/projects')
      await invalidateCache('/api/notifications')
      await invalidateCache('/api/surat-tugas')

      return NextResponse.json({ success: true, action: 'rejected' })
    }
    
    // Handle task completion
    // Support for revision: if isRevision is true, allow re-completing a completed task
    const { isRevision, isAdminOverride } = body
    
    // For Fast Production: allow completing tasks at any stage
    const existingTask = await db.task.findUnique({ where: { id: taskId } })
    if (!existingTask) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }
    
    const proj = await db.project.findUnique({ where: { id: projectId } })
    
    // Check if requesting user is Super Admin
    const requestUserRole = request.headers.get('X-User-Role')
    const isSuperAdmin = requestUserRole === 'Admin'
    
    // For Fast Production projects: allow completing any task regardless of stage
    // For normal/Fast Track: block only tasks AHEAD of the current stage.
    //
    // A worker whose task stage is AT or BEFORE the project's current stage is
    // allowed to complete their task (e.g. late uploads, revisions that reopen
    // an earlier stage, late assignments). Previously the gate used `!==`,
    // which permanently blocked stage-1 workers once the project advanced to
    // stage 2+ — the project never goes back, so they could never finish.
    // Super Admin override: bypass stage gate entirely.
    const projCurrentStage = proj?.currentStage ?? 0
    if (!proj?.isFastProduction && existingTask.stage > projCurrentStage && !isRevision && !isSuperAdmin) {
      const stageNames: Record<number, string> = {
        0: 'Perencanaan', 1: 'Produksi', 2: 'Pasca Produksi', 3: 'Review', 4: 'Publikasi', 5: 'Selesai'
      }
      const taskStageName = stageNames[existingTask.stage] || ''
      const projStageName = stageNames[projCurrentStage] || ''
      return NextResponse.json({ 
        error: `Tugas Anda berada di Tahap ${existingTask.stage} (${taskStageName}), tetapi proyek saat ini masih di Tahap ${projCurrentStage} (${projStageName}). Tunggu hingga proyek mencapai tahap Anda.` 
      }, { status: 400 })
    }

    // === Intra-stage dependency di Tahap 2 (Pasca Produksi) ===
    // Editor (Template Sosial Media) hanya bisa mengerjakan setelah Editor (Foto)
    // menyelesaikan tugasnya di tahap & project yang sama. Fast Production &
    // Super Admin override bypass gate ini (mode override/bypass).
    //
    // PENTING: Jika manager menonaktifkan fitur Editor (Foto) saat inisiasi
    // (enableFotoEditor=false), maka tidak ada task EditorFoto yang dibuat,
    // dan ETSM TIDAK perlu menunggu — dependency otomatis terpenuhi.
    // Gate ini hanya berlaku jika ada task EditorFoto yang masih pending.
    if (!proj?.isFastProduction
        && !isSuperAdmin
        && existingTask.stage === 2
        && existingTask.role === 'EditorTemplateSosialMedia'
        && proj?.enableFotoEditor !== false) {
      const fotoTasks = await db.task.findMany({
        where: { projectId, stage: 2, role: 'EditorFoto' },
      })
      const fotoStillPending = fotoTasks.length > 0 && fotoTasks.some(t => t.status !== 'completed')
      if (fotoStillPending) {
        return NextResponse.json({
          error: `Tugas Editor (Template Sosial Media) belum bisa dikerjakan. Tunggu Editor (Foto) menyelesaikan tugasnya terlebih dahulu di Tahap 2 (Pasca Produksi).`
        }, { status: 400 })
      }
    }

    const revisionCount = (existingTask.revisionCount || 0) + (isRevision ? 1 : 0)
    
    const task = await db.task.update({
      where: { id: taskId },
      data: {
        status: 'completed',
        data: JSON.stringify(taskData),
        revisionCount: isRevision ? revisionCount : existingTask.revisionCount || 0
      },
      include: { project: true }
    })
    
    // Check if all current stage tasks are completed
    const projectTasks = await db.task.findMany({
      where: { projectId }
    })
    
    // Get project to check isFastTrack/isFastProduction
    const project = await db.project.findUnique({ where: { id: projectId } })
    
    // For Fast Production: check if ALL tasks across ALL stages are done
    if (project?.isFastProduction) {
      // Auto-approve: If there are pending reviewer tasks (stage 3), auto-complete them
      // This handles cases where reviewer tasks weren't auto-approved at creation
      const pendingReviewerTasks = projectTasks.filter(t => t.stage === 3 && t.status === 'pending')
      if (pendingReviewerTasks.length > 0) {
        const reviewerIds = [...new Set(pendingReviewerTasks.map(t => t.assignedTo))]
        const reviewers = await db.user.findMany({
          where: { id: { in: reviewerIds } }
        })
        
        // Auto-approve ALL reviewer tasks in Fast Production mode
        await Promise.all(
          pendingReviewerTasks.map(t => db.task.update({
            where: { id: t.id },
            data: { status: 'completed', data: JSON.stringify({ autoApproved: true }) }
          }))
        )
        
        // Notify reviewers about auto-approve
        for (const reviewer of reviewers) {
          await db.notification.create({
            data: {
              userId: reviewer.id,
              message: `Proyek "${task.project.title}" menggunakan mode Fast Production. Tahap review telah di-auto-approve otomatis.`,
              projectId: projectId,
              targetView: 'project_detail',
              read: false
            }
          })
        }
        
        // Refresh task list after auto-approve
        const refreshedTasks = await db.task.findMany({ where: { projectId } })
        projectTasks.length = 0
        projectTasks.push(...refreshedTasks)
      }
      
      const allDone = projectTasks.every(t => t.status === 'completed')
      if (allDone) {
        await db.project.update({
          where: { id: projectId },
          data: { currentStage: 5 }
        })
      } else {
        // Update currentStage to the lowest stage with pending tasks (excluding completed stage 3)
        const pendingStages = projectTasks.filter(t => t.status === 'pending').map(t => t.stage)
        if (pendingStages.length > 0) {
          const minPending = Math.min(...pendingStages)
          if (minPending !== project.currentStage) {
            await db.project.update({
              where: { id: projectId },
              data: { currentStage: minPending }
            })
          }
        }
      }
      
      // Return full project tasks data for store sync
      const updatedProjectTasks = await db.task.findMany({ where: { projectId } })
      const updatedProject = await db.project.findUnique({ where: { id: projectId } })
      
      return NextResponse.json({
        success: true,
        task: {
          id: task.id,
          status: task.status,
          data: JSON.parse(task.data || '{}'),
          revisionCount: task.revisionCount || 0
        },
        newStage: updatedProject!.currentStage,
        // Send full project state for store sync
        projectState: {
          currentStage: updatedProject!.currentStage,
          tasks: updatedProjectTasks.map(t => ({
            id: t.id,
            role: t.role,
            stage: t.stage,
            status: t.status,
            assignedTo: t.assignedTo,
            data: t.data ? JSON.parse(t.data) : {},
            revisionCount: t.revisionCount || 0
          }))
        }
      })
    }
    
    const currentStageTasks = projectTasks.filter(t => t.stage === task.project.currentStage)
    let allCurrentDone = currentStageTasks.length > 0 && currentStageTasks.every(t => t.status === 'completed')
    
    let nextStage = task.project.currentStage
    let stageAdvanced = false
    let autoApprovedTasks: string[] = []
    let fastTrackedTasks: string[] = []
    
    // === Per-reviewer Auto-Approve for Review stage (stage 3) — Case A ===
    // When the project is ALREADY at stage 3 (Review) and a task was just completed,
    // auto-approve any remaining pending reviewer tasks where the reviewer has
    // autoApproveReview enabled. This handles the co-reviewer scenario:
    // Reviewer B (manual) completes → Reviewer A (auto-approve setting) gets auto-completed.
    // Per-reviewer: only auto-completes tasks for reviewers who HAVE the setting enabled;
    // reviewers without it keep their tasks pending for manual review.
    if (!project?.isFastProduction && task.project.currentStage === 3) {
      const pendingReviewers = projectTasks.filter(t => t.stage === 3 && t.status === 'pending')
      if (pendingReviewers.length > 0) {
        const reviewerIds = [...new Set(pendingReviewers.map(t => t.assignedTo))]
        const autoApproveReviewers = await db.user.findMany({
          where: { id: { in: reviewerIds }, autoApproveReview: true }
        })
        const autoApproveIds = new Set(autoApproveReviewers.map(r => r.id))
        const toAutoApprove = pendingReviewers.filter(t => autoApproveIds.has(t.assignedTo))
        
        if (toAutoApprove.length > 0) {
          await Promise.all(
            toAutoApprove.map(t => db.task.update({
              where: { id: t.id },
              data: { status: 'completed', data: JSON.stringify({ autoApproved: true }) }
            }))
          )
          autoApprovedTasks = toAutoApprove.map(t => t.id)
          
          for (const reviewer of autoApproveReviewers) {
            await db.notification.create({
              data: {
                userId: reviewer.id,
                message: `Proyek "${task.project.title}" telah di-auto-approve. Tahap review Anda dilewati otomatis sesuai pengaturan Auto-Approve Anda.`,
                projectId, targetView: 'project_detail', read: false
              }
            })
          }
          
          // Refresh task list to include auto-approved tasks
          const refreshedTasks = await db.task.findMany({ where: { projectId } })
          projectTasks.length = 0
          projectTasks.push(...refreshedTasks)
          
          // Re-check allCurrentDone — auto-approving may have completed all stage-3 tasks
          const stage3Tasks = projectTasks.filter(t => t.stage === 3)
          allCurrentDone = stage3Tasks.length > 0 && stage3Tasks.every(t => t.status === 'completed')
        }
      }
    }
    
    if (allCurrentDone) {
      nextStage = task.project.currentStage + 1
      
      // Fast Track: skip stages 1-3, jump directly to stage 4 (Publikasi)
      if (project?.isFastTrack && nextStage < 4) {
        nextStage = 4
        // Auto-complete all tasks in skipped stages (1-3)
        const skippedTasks = projectTasks.filter(t => t.stage >= 1 && t.stage <= 3 && t.status === 'pending')
        await Promise.all(
          skippedTasks.map(t => db.task.update({
            where: { id: t.id },
            data: { status: 'completed', data: JSON.stringify({ fastTracked: true }) }
          }))
        )
        fastTrackedTasks = skippedTasks.map(t => t.id)
      }
      
      // FIX: Skip empty stages — advance to the next stage that actually has pending tasks
      // This prevents projects from getting stuck at stages with no workers
      const freshTasks = await db.task.findMany({ where: { projectId } })
      while (nextStage <= 4) {
        const nextStageTasks = freshTasks.filter(t => t.stage === nextStage && t.status === 'pending')
        if (nextStageTasks.length > 0) {
          break // Found a stage with pending tasks
        }
        // Check if this stage has completed tasks (already done) — skip it
        const nextStageCompleted = freshTasks.filter(t => t.stage === nextStage && t.status === 'completed')
        if (nextStageCompleted.length > 0) {
          // All tasks at this stage are already completed, skip to next
          nextStage++
          continue
        }
        // No tasks at this stage at all — skip to next
        nextStage++
      }
      
      // === Per-reviewer Auto-Approve for Review stage (stage 3) — Case B ===
      // When the stage is ADVANCING to stage 3 (Review), auto-approve reviewer tasks
      // where the reviewer has autoApproveReview enabled. This runs AFTER the
      // empty-stage skip loop, so it correctly handles the case where stage 2
      // (Pasca Produksi) was empty and the project jumps from stage 1 directly to 3.
      // Per-reviewer: only auto-completes tasks for reviewers who HAVE the setting;
      // reviewers without it keep their tasks pending for manual review.
      if (!project?.isFastProduction && nextStage === 3) {
        const pendingReviewers = freshTasks.filter(t => t.stage === 3 && t.status === 'pending')
        if (pendingReviewers.length > 0) {
          const reviewerIds = [...new Set(pendingReviewers.map(t => t.assignedTo))]
          const autoApproveReviewers = await db.user.findMany({
            where: { id: { in: reviewerIds }, autoApproveReview: true }
          })
          const autoApproveIds = new Set(autoApproveReviewers.map(r => r.id))
          const toAutoApprove = pendingReviewers.filter(t => autoApproveIds.has(t.assignedTo))
          
          if (toAutoApprove.length > 0) {
            await Promise.all(
              toAutoApprove.map(t => db.task.update({
                where: { id: t.id },
                data: { status: 'completed', data: JSON.stringify({ autoApproved: true }) }
              }))
            )
            autoApprovedTasks = [...autoApprovedTasks, ...toAutoApprove.map(t => t.id)]
            
            for (const reviewer of autoApproveReviewers) {
              await db.notification.create({
                data: {
                  userId: reviewer.id,
                  message: `Proyek "${task.project.title}" telah di-auto-approve. Tahap review Anda dilewati otomatis sesuai pengaturan Auto-Approve Anda.`,
                  projectId, targetView: 'project_detail', read: false
                }
              })
            }
            
            // Re-check: are ALL stage-3 tasks now completed?
            const refreshedTasks2 = await db.task.findMany({ where: { projectId } })
            const stage3Tasks = refreshedTasks2.filter(t => t.stage === 3)
            const stage3AllDone = stage3Tasks.length > 0 && stage3Tasks.every(t => t.status === 'completed')
            
            if (stage3AllDone) {
              // All review tasks done (auto-approved) — skip stage 3, advance to next non-empty stage
              nextStage = 4
              while (nextStage <= 4) {
                const nextTasks = refreshedTasks2.filter(t => t.stage === nextStage && t.status === 'pending')
                if (nextTasks.length > 0) break
                const nextCompleted = refreshedTasks2.filter(t => t.stage === nextStage && t.status === 'completed')
                if (nextCompleted.length > 0) { nextStage++; continue }
                nextStage++
              }
            }
            
            // Update freshTasks for downstream notification logic
            freshTasks.length = 0
            freshTasks.push(...refreshedTasks2)
          }
        }
      }
      
      // If we've passed stage 4 with all tasks done, mark as completed
      if (nextStage > 4) {
        nextStage = 5
      }
      
      stageAdvanced = true
      
      // Update project stage
      await db.project.update({
        where: { id: projectId },
        data: { currentStage: nextStage }
      })
      
      // Create notifications for next stage tasks (at the final nextStage, not intermediate)
      const nextStagePendingTasks = freshTasks.filter(t => t.stage === nextStage && t.status === 'pending')
      for (const nextTask of nextStagePendingTasks) {
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

      // Create Surat Tugas for next stage tasks (so they appear in inbox)
      for (const nextTask of nextStagePendingTasks) {
        try {
          const existingSurat = await db.suratTugas.findFirst({
            where: { projectId, userId: nextTask.assignedTo, role: nextTask.role }
          })
          if (!existingSurat) {
            await db.suratTugas.create({
              data: {
                nomorSurat: `ST/AUTO/${nextStage}/${Date.now()}`,
                projectId,
                userId: nextTask.assignedTo,
                role: nextTask.role,
                stage: nextTask.stage,
                status: 'active',
                read: false
              }
            })
          }
        } catch (suratErr) {
          console.error('Failed to create surat tugas on stage advance:', suratErr)
        }
      }

      // Send WA/Email for stage advance
      // DEFERRED to background (ctx.waitUntil) — each WA/Email call can take
      // 1-3s per recipient. With multiple next-stage workers, this was adding
      // 3-10s to the response time, frequently pushing the request past
      // Cloudflare Workers' wall-clock limit and causing non-JSON error
      // responses (the redundant "Gagal menyelesaikan tugas" message).
      deferToBackground((async () => {
        try {
          const settings = await db.settings.findFirst({ where: { id: 'main' } })
          const notifEnabled = settings?.notifWaEnabled || settings?.notifEmailEnabled
          if (notifEnabled && nextStagePendingTasks.length > 0) {
            const nextStageUserIds = [...new Set(nextStagePendingTasks.map(t => t.assignedTo))]
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
      })())
      
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

    // === Intra-stage handoff notification (Tahap 2) ===
    // Saat Editor (Foto) menyelesaikan tugasnya dan tidak ada lagi Editor (Foto)
    // yang pending, Editor (Template Sosial Media) yang sedang menunggu menjadi
    // ter-unblock. Beri notifikasi agar mereka tahu gilirannya tiba (tanpa harus
    // menunggu perpindahan tahap, karena ini handoff di dalam Tahap 2 itu sendiri).
    if (!project?.isFastProduction && task.role === 'EditorFoto' && task.stage === 2) {
      const remainingFoto = await db.task.findMany({
        where: { projectId, stage: 2, role: 'EditorFoto', status: 'pending' }
      })
      if (remainingFoto.length === 0) {
        const unblockedTemplateTasks = await db.task.findMany({
          where: { projectId, stage: 2, role: 'EditorTemplateSosialMedia', status: 'pending' }
        })
        for (const tt of unblockedTemplateTasks) {
          await db.notification.create({
            data: {
              userId: tt.assignedTo,
              message: `Editor (Foto) telah menyelesaikan tugas pada proyek "${task.project.title}". Giliran Anda membuat Template Sosial Media (Tahap 2 — Pasca Produksi).`,
              projectId,
              targetView: 'project_detail',
              read: false
            }
          })
        }
      }
    }

    // Return full project state for store sync to prevent desync
    const finalProjectTasks = await db.task.findMany({ where: { projectId } })
    const finalProject = await db.project.findUnique({ where: { id: projectId } })

    // === CRITICAL: invalidate edge caches AFTER all DB mutations, BEFORE returning ===
    // The task completion above mutated projects.currentStage, tasks.status,
    // notifications, and surat_tugas. Without invalidating the /api/projects,
    // /api/notifications, and /api/surat-tugas edge caches, other clients (and
    // this client's own 60s poll) will keep reading STALE data and overwrite
    // the optimistic local update — causing "status tidak update / lambat".
    // Placed here (after the intra-stage handoff that creates more notifications)
    // so every mutation is reflected once the cache is busted.
    await invalidateCache('/api/projects')
    await invalidateCache('/api/notifications')
    await invalidateCache('/api/surat-tugas')
    
    return NextResponse.json({
      success: true,
      task: {
        id: task.id,
        status: task.status,
        data: JSON.parse(task.data || '{}'),
        revisionCount: task.revisionCount || 0
      },
      newStage: finalProject!.currentStage,
      stageAdvanced,
      nextStageTasks: stageAdvanced ? finalProjectTasks.filter(t => t.stage === finalProject!.currentStage && t.status === 'pending').map(t => ({
        assignedTo: t.assignedTo,
        role: t.role,
        stage: t.stage
      })) : [],
      // Send full project state for store sync
      projectState: {
        currentStage: finalProject!.currentStage,
        tasks: finalProjectTasks.map(t => ({
          id: t.id,
          role: t.role,
          stage: t.stage,
          status: t.status,
          assignedTo: t.assignedTo,
          data: t.data ? JSON.parse(t.data) : {},
          revisionCount: t.revisionCount || 0
        }))
      }
    })
  } catch (error) {
    console.error('Update task error:', error)
    // Return a meaningful, actionable error message so the client can surface
    // it to the user (the old generic "Failed to update task" was English and
    // unhelpful, and when the response was lost entirely the client fell back
    // to "Gagal menyelesaikan tugas: Gagal menyelesaikan tugas").
    const detail = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: `Gagal memperbarui tugas di server: ${detail}` },
      { status: 500 }
    )
  }
}
