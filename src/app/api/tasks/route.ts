import { NextRequest, NextResponse } from 'next/server'
import { sendStageAdvanceNotification, sendReviewRejectionNotification } from '@/lib/notification-service'
import { invalidateCache, deferToBackground } from '@/lib/edge-cache'
import {
  getLibsql,
  toBool,
  nowMs,
  parseJSON,
  bind,
  genId,
  type InStatement,
} from '@/lib/libsql-client'

// ============================================================================
// PUT /api/tasks — complete a task (or reject a review)
//
// REWRITE: This route was previously the #1 source of 500 errors on
// Cloudflare Workers because it did 20+ sequential Prisma queries per
// request (task lookup, project lookup, task update, task list ×4,
// project lookup ×3, notification create ×N in a loop, surat tugas
// findFirst+create ×N in a loop). Each Prisma query adds CPU overhead
// (query building + result mapping) on top of the network round-trip.
//
// On the Workers free plan (10ms CPU / request), this routinely exceeded
// the limit and the Worker was killed — producing an empty 500 response
// that the frontend couldn't parse ("Server error 500 (HTTP 500)").
//
// FIX:
//   1. Use @libsql/client directly (skip Prisma CPU overhead).
//   2. Fetch project + all tasks ONCE (2 queries), then filter in memory.
//   3. Defer notification creates + surat tugas creates to background
//      (ctx.waitUntil). The frontend already adds them optimistically.
//   4. Main path is now ~5 DB queries instead of 20+.
//   5. All JSON.parse calls are wrapped to prevent crashes on bad data.
//
// ADDITIONAL FIX (Worker threw exception):
//   The original rewrite still called checkMaintenanceMode() which uses
//   Prisma — adding CPU overhead AND running OUTSIDE the try/catch. If
//   the Prisma query or the libsql client init threw, the exception was
//   completely unhandled, producing Cloudflare's "Worker threw exception"
//   HTML error page (not a JSON response the frontend could parse).
//
//   Now: (a) maintenance mode is checked via libsql directly (no Prisma),
//   (b) EVERYTHING including client init is inside the try/catch, and
//   (c) step-by-step console logging helps identify any future crash point.
// ============================================================================

const STAGE_NAMES: Record<number, string> = {
  0: 'Perencanaan', 1: 'Produksi', 2: 'Pasca Produksi', 3: 'Review', 4: 'Publikasi', 5: 'Selesai'
}

/** Safely parse task.data JSON, returning {} on failure. */
function safeParseData(raw: unknown): Record<string, unknown> {
  return parseJSON<Record<string, unknown>>(raw, {})
}

/** Map a raw libsql task row to the frontend-expected shape. */
function mapTaskRow(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    role: String(r.role),
    stage: Number(r.stage),
    status: String(r.status),
    assignedTo: String(r.assignedTo),
    data: safeParseData(r.data),
    revisionCount: r.revisionCount != null ? Number(r.revisionCount) : 0,
    projectId: String(r.projectId),
  }
}

// ---------------------------------------------------------------------------
// Lightweight maintenance-mode check using libsql directly (NO Prisma).
//
// WHY: The original checkMaintenanceMode() in @/lib/maintenance-check uses
// Prisma (db.settings.findUnique). On Cloudflare Workers, Prisma adds
// significant CPU overhead per query. This route already uses libsql
// directly for all other queries — using Prisma just for the maintenance
// check negates much of the optimization. Worse, if the Prisma engine
// throws (e.g., on a cold start or adapter issue), the error runs OUTSIDE
// the route's try/catch and produces "Worker threw exception".
//
// This helper does the same check with a single libsql query and never
// throws — on any error it allows the request through (fail-open).
// ---------------------------------------------------------------------------
let _maintenanceCached: boolean = false
let _maintenanceCachedAt = 0
const _MAINTENANCE_TTL = 5000 // 5s cache, same as the Prisma version

async function isMaintenanceMode(request: NextRequest): Promise<boolean> {
  // Admin role bypasses maintenance
  const role = request.headers.get('X-User-Role')
  if (role === 'Admin') return false

  const now = Date.now()
  if (now - _maintenanceCachedAt < _MAINTENANCE_TTL) {
    return _maintenanceCached
  }

  try {
    const client = getLibsql()
    const res = await client.execute({
      sql: `SELECT maintenanceMode FROM settings WHERE id = 'main' LIMIT 1`,
      args: [],
    })
    _maintenanceCached = res.rows.length > 0 ? toBool((res.rows[0] as Record<string, unknown>).maintenanceMode) : false
    _maintenanceCachedAt = now
  } catch {
    // Fail-open: if we can't check, allow the request
    _maintenanceCached = false
    _maintenanceCachedAt = now
  }
  return _maintenanceCached
}

export async function PUT(request: NextRequest) {
  // Unique ID for correlating log lines for this single request
  const reqId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

  try {
    // Step 1: Maintenance check (libsql, no Prisma, never throws)
    const inMaintenance = await isMaintenanceMode(request)
    if (inMaintenance) {
      return NextResponse.json(
        { error: 'MODE_MAINTENANCE', message: 'Sistem sedang dalam maintenance. Silakan coba beberapa saat lagi.' },
        { status: 503 }
      )
    }

    // Step 2: Get DB client (inside try/catch — previously was outside)
    const client = getLibsql()

    const body = await request.json()
    const { projectId, taskId, taskData, isReviewReject, rejectReason } = body

    // =========================================================================
    // PATH 1: Review rejection — reset stage 2 & 3 tasks to pending
    // =========================================================================
    if (isReviewReject) {
      // Fetch project + tasks in 2 queries
      const projRes = await client.execute({
        sql: `SELECT id, title, managerId, currentStage FROM projects WHERE id = ? LIMIT 1`,
        args: [bind(projectId)],
      })
      if (projRes.rows.length === 0) {
        return NextResponse.json({ error: 'Project not found' }, { status: 404 })
      }
      const project = projRes.rows[0] as Record<string, unknown>

      // Reset stage 2 and 3 tasks to pending
      await client.execute({
        sql: `UPDATE tasks SET status = 'pending', data = '{}', updatedAt = ? WHERE projectId = ? AND (stage = 2 OR stage = 3)`,
        args: [nowMs(), bind(projectId)],
      })

      // Update project to stage 2
      await client.execute({
        sql: `UPDATE projects SET currentStage = 2, updatedAt = ? WHERE id = ?`,
        args: [nowMs(), bind(projectId)],
      })

      // Fetch stage 2 tasks for notifications (deferred to background)
      const stage2Res = await client.execute({
        sql: `SELECT assignedTo FROM tasks WHERE projectId = ? AND stage = 2`,
        args: [bind(projectId)],
      })
      const stage2UserIds = [...new Set(stage2Res.rows.map(r => String((r as Record<string, unknown>).assignedTo)))]

      // DEFER: Create notifications + send WA/Email in background
      deferToBackground((async () => {
        try {
          for (const userId of stage2UserIds) {
            const reasonText = rejectReason ? `\n\nAlasan: ${rejectReason}` : ''
            await client.execute({
              sql: `INSERT INTO notifications (id, message, projectId, targetView, read, userId, createdAt)
                    VALUES (?, ?, ?, 'project_detail', 0, ?, ?)`,
              args: [genId(), `Proyek "${project.title}" ditolak oleh Reviewer. Silakan perbaiki.${reasonText}`, bind(projectId), bind(userId), nowMs()],
            })
          }

          // Send WA/Email
          const settingsRes = await client.execute({
            sql: `SELECT notifWaEnabled, notifWaToken, notifWaDeviceId, notifWaSenderNumber,
                         notifEmailEnabled, notifEmailHost, notifEmailPort, notifEmailUser,
                         notifEmailPass, notifEmailFromName FROM settings WHERE id = 'main' LIMIT 1`,
            args: [],
          })
          if (settingsRes.rows.length > 0) {
            const s = settingsRes.rows[0] as Record<string, unknown>
            const notifEnabled = toBool(s.notifWaEnabled) || toBool(s.notifEmailEnabled)
            if (notifEnabled && stage2UserIds.length > 0) {
              const placeholders = stage2UserIds.map(() => '?').join(',')
              const usersRes = await client.execute({
                sql: `SELECT id, name, email, whatsapp, notifWaEnabled, notifEmailEnabled FROM users WHERE id IN (${placeholders})`,
                args: stage2UserIds.map(bind),
              })
              const notifConfig = {
                notifWaEnabled: toBool(s.notifWaEnabled),
                notifWaToken: s.notifWaToken as string | null,
                notifWaDeviceId: s.notifWaDeviceId as string | null,
                notifWaSenderNumber: s.notifWaSenderNumber as string | null,
                notifEmailEnabled: toBool(s.notifEmailEnabled),
                notifEmailHost: s.notifEmailHost as string | null,
                notifEmailPort: s.notifEmailPort ? Number(s.notifEmailPort) : null,
                notifEmailUser: s.notifEmailUser as string | null,
                notifEmailPass: s.notifEmailPass as string | null,
                notifEmailFromName: s.notifEmailFromName as string | null,
              }
              for (const row of usersRes.rows) {
                const u = row as Record<string, unknown>
                await sendReviewRejectionNotification(
                  { name: String(u.name), email: String(u.email), whatsapp: u.whatsapp as string | null, notifWaEnabled: toBool(u.notifWaEnabled), notifEmailEnabled: toBool(u.notifEmailEnabled) },
                  notifConfig,
                  { projectTitle: String(project.title), rejectReason },
                )
              }
            }
          }
        } catch (err) {
          console.error('[TASKS] Background rejection notifications failed:', err)
        }
      })())

      await invalidateCache('/api/projects')
      await invalidateCache('/api/notifications')
      await invalidateCache('/api/surat-tugas')

      return NextResponse.json({ success: true, action: 'rejected' })
    }

    // =========================================================================
    // PATH 2: Task completion
    // =========================================================================
    const { isRevision, isAdminOverride } = body
    const requestUserRole = request.headers.get('X-User-Role')
    const isSuperAdmin = requestUserRole === 'Admin'
    console.log(`[TASKS ${reqId}] start task completion: project=${projectId} task=${taskId} role=${requestUserRole} revision=${!!isRevision}`)

    // Fetch the task + project in 2 queries (instead of separate findUnique calls)
    const taskRes = await client.execute({
      sql: `SELECT id, role, stage, status, assignedTo, revisionCount, projectId, data
            FROM tasks WHERE id = ? LIMIT 1`,
      args: [bind(taskId)],
    })
    if (taskRes.rows.length === 0) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }
    const existingTask = taskRes.rows[0] as Record<string, unknown>

    const projRes = await client.execute({
      sql: `SELECT id, title, managerId, currentStage, isFastTrack, isFastProduction,
                   enableFotoEditor, enableTemplateEditor
            FROM projects WHERE id = ? LIMIT 1`,
      args: [bind(projectId)],
    })
    if (projRes.rows.length === 0) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }
    const proj = projRes.rows[0] as Record<string, unknown>

    let projCurrentStage = Number(proj.currentStage ?? 0)
    const isFastProduction = toBool(proj.isFastProduction)
    const isFastTrack = toBool(proj.isFastTrack)
    const enableFotoEditor = proj.enableFotoEditor != null ? toBool(proj.enableFotoEditor) : true
    const existingTaskStage = Number(existingTask.stage)

    // =========================================================================
    // SELF-HEAL: Auto-advance stuck project stages (runs for ALL users)
    // =========================================================================
    // If the task's stage is AHEAD of the project's currentStage, the project
    // may be "stuck" — all tasks at currentStage are completed but the
    // stage-advance UPDATE never ran (typically because Cloudflare Workers
    // CPU limit killed the previous /api/tasks request mid-execution).
    //
    // Without this self-heal, a publisher at stage 4 sees "Terkunci" forever
    // because project.currentStage is stuck at 3, and only Admin/Manager can
    // trigger /api/projects/repair. This lets ANY user unblock their own task
    // by simply attempting to complete it.
    //
    // This is idempotent: if the project is NOT stuck, no UPDATE runs.
    if (!isFastProduction && existingTaskStage > projCurrentStage && !isRevision) {
      const healRes = await client.execute({
        sql: `SELECT id, stage, status FROM tasks WHERE projectId = ?`,
        args: [bind(projectId)],
      })
      const healTasks = healRes.rows.map(r => mapTaskRow(r as Record<string, unknown>))
      const currentStageTasks = healTasks.filter(t => t.stage === projCurrentStage)
      // Empty stage OR all completed → stage is done and should have advanced
      const allCurrentDone =
        currentStageTasks.length === 0 ||
        currentStageTasks.every(t => t.status === 'completed')

      if (allCurrentDone) {
        // Advance to the lowest pending stage above currentStage (or 5 if none)
        const pendingStages = healTasks
          .filter(t => t.status !== 'completed' && t.stage > projCurrentStage)
          .map(t => t.stage)
        let nextStage: number
        if (pendingStages.length > 0) {
          nextStage = Math.min(...pendingStages)
        } else {
          const hasPendingAnywhere = healTasks.some(t => t.status !== 'completed')
          nextStage = hasPendingAnywhere ? projCurrentStage : 5
        }

        if (nextStage > projCurrentStage) {
          await client.execute({
            sql: `UPDATE projects SET currentStage = ?, updatedAt = ? WHERE id = ?`,
            args: [nextStage, nowMs(), bind(projectId)],
          })
          console.log(`[TASKS ${reqId}] SELF-HEAL: advanced project ${projectId} stage ${projCurrentStage} → ${nextStage}`)
          projCurrentStage = nextStage
        }
      }
    }

    // Stage gate: block tasks AHEAD of current stage (unless override)
    if (!isFastProduction && existingTaskStage > projCurrentStage && !isRevision && !isSuperAdmin) {
      const taskStageName = STAGE_NAMES[existingTaskStage] || ''
      const projStageName = STAGE_NAMES[projCurrentStage] || ''
      return NextResponse.json({
        error: `Tugas Anda berada di Tahap ${existingTaskStage} (${taskStageName}), tetapi proyek saat ini masih di Tahap ${projCurrentStage} (${projStageName}). Tunggu hingga proyek mencapai tahap Anda.`
      }, { status: 400 })
    }

    // Intra-stage dependency: Editor (Template Sosial Media) waits for Editor (Foto)
    if (!isFastProduction && !isSuperAdmin && existingTaskStage === 2
        && String(existingTask.role) === 'EditorTemplateSosialMedia' && enableFotoEditor) {
      const fotoRes = await client.execute({
        sql: `SELECT status FROM tasks WHERE projectId = ? AND stage = 2 AND role = 'EditorFoto'`,
        args: [bind(projectId)],
      })
      const fotoStillPending = fotoRes.rows.length > 0 && fotoRes.rows.some(r => String((r as Record<string, unknown>).status) !== 'completed')
      if (fotoStillPending) {
        return NextResponse.json({
          error: `Tugas Editor (Template Sosial Media) belum bisa dikerjakan. Tunggu Editor (Foto) menyelesaikan tugasnya terlebih dahulu di Tahap 2 (Pasca Produksi).`
        }, { status: 400 })
      }
    }

    // Mark the task as completed
    const revisionCount = (Number(existingTask.revisionCount) || 0) + (isRevision ? 1 : 0)
    await client.execute({
      sql: `UPDATE tasks SET status = 'completed', data = ?, revisionCount = ?, updatedAt = ? WHERE id = ?`,
      args: [JSON.stringify(taskData || {}), revisionCount, nowMs(), bind(taskId)],
    })
    console.log(`[TASKS ${reqId}] task marked completed, fetching all project tasks`)

    // Fetch ALL project tasks (single query, used for all downstream logic)
    const allTasksRes = await client.execute({
      sql: `SELECT id, role, stage, status, assignedTo, data, revisionCount, projectId FROM tasks WHERE projectId = ?`,
      args: [bind(projectId)],
    })
    const projectTasks = allTasksRes.rows.map(r => mapTaskRow(r as Record<string, unknown>))
    console.log(`[TASKS ${reqId}] got ${projectTasks.length} tasks, currentStage=${projCurrentStage}, isFastProduction=${isFastProduction}`)

    let newStage = projCurrentStage
    let stageAdvanced = false
    let nextStagePendingTasks: typeof projectTasks = []

    // =========================================================================
    // Fast Production: check if ALL tasks across ALL stages are done
    // =========================================================================
    if (isFastProduction) {
      // Auto-approve pending reviewer tasks (stage 3)
      const pendingReviewerTasks = projectTasks.filter(t => t.stage === 3 && t.status === 'pending')
      if (pendingReviewerTasks.length > 0) {
        // Batch update all pending reviewer tasks
        const updateStmts: InStatement[] = pendingReviewerTasks.map(t => ({
          sql: `UPDATE tasks SET status = 'completed', data = ?, updatedAt = ? WHERE id = ?`,
          args: [JSON.stringify({ autoApproved: true }), nowMs(), bind(t.id)],
        }))
        try { await client.batch(updateStmts) } catch (e) { console.error('[TASKS] batch auto-approve failed:', e) }

        // Update in-memory state
        for (const t of pendingReviewerTasks) {
          t.status = 'completed'
          t.data = { autoApproved: true }
        }

        // DEFER: notify reviewers about auto-approve
        const reviewerIds = [...new Set(pendingReviewerTasks.map(t => t.assignedTo))]
        deferToBackground((async () => {
          try {
            for (const rid of reviewerIds) {
              await client.execute({
                sql: `INSERT INTO notifications (id, message, projectId, targetView, read, userId, createdAt)
                      VALUES (?, ?, ?, 'project_detail', 0, ?, ?)`,
                args: [genId(), `Proyek "${proj.title}" menggunakan mode Fast Production. Tahap review telah di-auto-approve otomatis.`, bind(projectId), bind(rid), nowMs()],
              })
            }
          } catch (err) { console.error('[TASKS] BG auto-approve notif failed:', err) }
        })())
      }

      const allDone = projectTasks.every(t => t.status === 'completed')
      if (allDone) {
        newStage = 5
        await client.execute({
          sql: `UPDATE projects SET currentStage = 5, updatedAt = ? WHERE id = ?`,
          args: [nowMs(), bind(projectId)],
        })
      } else {
        // Update currentStage to lowest pending stage
        const pendingStages = projectTasks.filter(t => t.status === 'pending').map(t => t.stage)
        if (pendingStages.length > 0) {
          const minPending = Math.min(...pendingStages)
          if (minPending !== projCurrentStage) {
            newStage = minPending
            await client.execute({
              sql: `UPDATE projects SET currentStage = ?, updatedAt = ? WHERE id = ?`,
              args: [minPending, nowMs(), bind(projectId)],
            })
          }
        }
      }
    } else {
      // =========================================================================
      // Normal production: check if all current-stage tasks are done
      // =========================================================================
      const currentStageTasks = projectTasks.filter(t => t.stage === projCurrentStage)
      // Empty stage OR all completed → stage is done (should advance).
      // Previously this was `length > 0 && every(...)` which caused projects
      // to get PERMANENTLY stuck when a stage had zero tasks assigned.
      let allCurrentDone = currentStageTasks.length === 0 || currentStageTasks.every(t => t.status === 'completed')

      // Per-reviewer auto-approve — Case A: already at stage 3
      if (projCurrentStage === 3) {
        const pendingReviewers = projectTasks.filter(t => t.stage === 3 && t.status === 'pending')
        if (pendingReviewers.length > 0) {
          const reviewerIds = [...new Set(pendingReviewers.map(t => t.assignedTo))]
          const placeholders = reviewerIds.map(() => '?').join(',')
          const autoApproveRes = await client.execute({
            sql: `SELECT id FROM users WHERE id IN (${placeholders}) AND autoApproveReview = 1`,
            args: reviewerIds.map(bind),
          })
          const autoApproveIds = new Set(autoApproveRes.rows.map(r => String((r as Record<string, unknown>).id)))
          const toAutoApprove = pendingReviewers.filter(t => autoApproveIds.has(t.assignedTo))

          if (toAutoApprove.length > 0) {
            const updateStmts: InStatement[] = toAutoApprove.map(t => ({
              sql: `UPDATE tasks SET status = 'completed', data = ?, updatedAt = ? WHERE id = ?`,
              args: [JSON.stringify({ autoApproved: true }), nowMs(), bind(t.id)],
            }))
            try { await client.batch(updateStmts) } catch (e) { console.error('[TASKS] batch auto-approve A failed:', e) }

            for (const t of toAutoApprove) {
              t.status = 'completed'
              t.data = { autoApproved: true }
            }

            // DEFER: notify auto-approved reviewers
            deferToBackground((async () => {
              try {
                for (const reviewer of autoApproveRes.rows) {
                  const rid = String((reviewer as Record<string, unknown>).id)
                  await client.execute({
                    sql: `INSERT INTO notifications (id, message, projectId, targetView, read, userId, createdAt)
                          VALUES (?, ?, ?, 'project_detail', 0, ?, ?)`,
                    args: [genId(), `Proyek "${proj.title}" telah di-auto-approve. Tahap review Anda dilewati otomatis sesuai pengaturan Auto-Approve Anda.`, bind(projectId), bind(rid), nowMs()],
                  })
                }
              } catch (err) { console.error('[TASKS] BG auto-approve A notif failed:', err) }
            })())

            // Re-check allCurrentDone
            const stage3Tasks = projectTasks.filter(t => t.stage === 3)
            allCurrentDone = stage3Tasks.length > 0 && stage3Tasks.every(t => t.status === 'completed')
          }
        }
      }

      if (allCurrentDone) {
        let nextStageNum = projCurrentStage + 1

        // Fast Track: skip to stage 4
        if (isFastTrack && nextStageNum < 4) {
          nextStageNum = 4
          const skippedTasks = projectTasks.filter(t => t.stage >= 1 && t.stage <= 3 && t.status === 'pending')
          if (skippedTasks.length > 0) {
            const updateStmts: InStatement[] = skippedTasks.map(t => ({
              sql: `UPDATE tasks SET status = 'completed', data = ?, updatedAt = ? WHERE id = ?`,
              args: [JSON.stringify({ fastTracked: true }), nowMs(), bind(t.id)],
            }))
            try { await client.batch(updateStmts) } catch (e) { console.error('[TASKS] batch fast-track failed:', e) }
            for (const t of skippedTasks) {
              t.status = 'completed'
              t.data = { fastTracked: true }
            }
          }
        }

        // Skip empty stages — advance to the next stage with pending tasks
        while (nextStageNum <= 4) {
          const nextStageTasks = projectTasks.filter(t => t.stage === nextStageNum && t.status === 'pending')
          if (nextStageTasks.length > 0) break
          const nextStageCompleted = projectTasks.filter(t => t.stage === nextStageNum && t.status === 'completed')
          if (nextStageCompleted.length > 0) { nextStageNum++; continue }
          nextStageNum++
        }

        // Per-reviewer auto-approve — Case B: advancing TO stage 3
        if (nextStageNum === 3) {
          const pendingReviewers = projectTasks.filter(t => t.stage === 3 && t.status === 'pending')
          if (pendingReviewers.length > 0) {
            const reviewerIds = [...new Set(pendingReviewers.map(t => t.assignedTo))]
            const placeholders = reviewerIds.map(() => '?').join(',')
            const autoApproveRes = await client.execute({
              sql: `SELECT id FROM users WHERE id IN (${placeholders}) AND autoApproveReview = 1`,
              args: reviewerIds.map(bind),
            })
            const autoApproveIds = new Set(autoApproveRes.rows.map(r => String((r as Record<string, unknown>).id)))
            const toAutoApprove = pendingReviewers.filter(t => autoApproveIds.has(t.assignedTo))

            if (toAutoApprove.length > 0) {
              const updateStmts: InStatement[] = toAutoApprove.map(t => ({
                sql: `UPDATE tasks SET status = 'completed', data = ?, updatedAt = ? WHERE id = ?`,
                args: [JSON.stringify({ autoApproved: true }), nowMs(), bind(t.id)],
              }))
              try { await client.batch(updateStmts) } catch (e) { console.error('[TASKS] batch auto-approve B failed:', e) }
              for (const t of toAutoApprove) {
                t.status = 'completed'
                t.data = { autoApproved: true }
              }

              // DEFER: notify auto-approved reviewers
              deferToBackground((async () => {
                try {
                  for (const reviewer of autoApproveRes.rows) {
                    const rid = String((reviewer as Record<string, unknown>).id)
                    await client.execute({
                      sql: `INSERT INTO notifications (id, message, projectId, targetView, read, userId, createdAt)
                            VALUES (?, ?, ?, 'project_detail', 0, ?, ?)`,
                      args: [genId(), `Proyek "${proj.title}" telah di-auto-approve. Tahap review Anda dilewati otomatis sesuai pengaturan Auto-Approve Anda.`, bind(projectId), bind(rid), nowMs()],
                    })
                  }
                } catch (err) { console.error('[TASKS] BG auto-approve B notif failed:', err) }
              })())

              // Re-check: all stage 3 done?
              const stage3Tasks = projectTasks.filter(t => t.stage === 3)
              const stage3AllDone = stage3Tasks.length === 0 || stage3Tasks.every(t => t.status === 'completed')
              if (stage3AllDone) {
                nextStageNum = 4
                while (nextStageNum <= 4) {
                  const nextTasks = projectTasks.filter(t => t.stage === nextStageNum && t.status === 'pending')
                  if (nextTasks.length > 0) break
                  const nextCompleted = projectTasks.filter(t => t.stage === nextStageNum && t.status === 'completed')
                  if (nextCompleted.length > 0) { nextStageNum++; continue }
                  nextStageNum++
                }
              }
            }
          }
        }

        if (nextStageNum > 4) nextStageNum = 5
        newStage = nextStageNum
        stageAdvanced = true
        console.log(`[TASKS ${reqId}] stage advancing ${projCurrentStage} → ${newStage}`)

        // Update project stage
        await client.execute({
          sql: `UPDATE projects SET currentStage = ?, updatedAt = ? WHERE id = ?`,
          args: [newStage, nowMs(), bind(projectId)],
        })

        // Identify next-stage pending tasks for notifications + surat tugas
        nextStagePendingTasks = projectTasks.filter(t => t.stage === newStage && t.status === 'pending')

        // DEFER: Create notifications + surat tugas + WA/Email for next-stage workers
        deferToBackground((async () => {
          try {
            const stageName = STAGE_NAMES[newStage] || `Tahap ${newStage}`
            const nextStageUserIds = [...new Set(nextStagePendingTasks.map(t => t.assignedTo))]
            console.log(`[TASKS ${reqId}] BG: starting deferred work, ${nextStagePendingTasks.length} next-stage tasks, newStage=${newStage}`)

            // Create notifications
            for (const nextTask of nextStagePendingTasks) {
              await client.execute({
                sql: `INSERT INTO notifications (id, message, projectId, targetView, read, userId, createdAt)
                      VALUES (?, ?, ?, 'project_detail', 0, ?, ?)`,
                args: [genId(), `Proyek ${proj.title} maju ke tahap ${newStage}. Giliran Anda!`, bind(projectId), bind(nextTask.assignedTo), nowMs()],
              })
            }

            // Create surat tugas (check existing first)
            for (const nextTask of nextStagePendingTasks) {
              try {
                const existingRes = await client.execute({
                  sql: `SELECT id FROM surat_tugas WHERE projectId = ? AND userId = ? AND role = ? LIMIT 1`,
                  args: [bind(projectId), bind(nextTask.assignedTo), bind(nextTask.role)],
                })
                if (existingRes.rows.length === 0) {
                  await client.execute({
                    sql: `INSERT INTO surat_tugas (id, nomorSurat, projectId, userId, role, stage, status, read, createdAt)
                          VALUES (?, ?, ?, ?, ?, ?, 'active', 0, ?)`,
                    args: [genId(), `ST/AUTO/${newStage}/${Date.now()}`, bind(projectId), bind(nextTask.assignedTo), bind(nextTask.role), newStage, nowMs()],
                  })
                }
              } catch (suratErr) {
                console.error('[TASKS] BG surat tugas create failed:', suratErr)
              }
            }

            // If completed (stage 5), notify manager
            if (newStage === 5) {
              await client.execute({
                sql: `INSERT INTO notifications (id, message, projectId, targetView, read, userId, createdAt)
                      VALUES (?, ?, ?, 'reports', 0, ?, ?)`,
                args: [genId(), `Proyek ${proj.title} telah selesai dan terpublikasi! Laporan kegiatan tersedia.`, bind(projectId), bind(proj.managerId), nowMs()],
              })
            }

            // Send WA/Email
            if (nextStageUserIds.length > 0) {
              const settingsRes = await client.execute({
                sql: `SELECT notifWaEnabled, notifWaToken, notifWaDeviceId, notifWaSenderNumber,
                             notifEmailEnabled, notifEmailHost, notifEmailPort, notifEmailUser,
                             notifEmailPass, notifEmailFromName FROM settings WHERE id = 'main' LIMIT 1`,
                args: [],
              })
              if (settingsRes.rows.length > 0) {
                const s = settingsRes.rows[0] as Record<string, unknown>
                const notifEnabled = toBool(s.notifWaEnabled) || toBool(s.notifEmailEnabled)
                if (notifEnabled) {
                  const placeholders = nextStageUserIds.map(() => '?').join(',')
                  const usersRes = await client.execute({
                    sql: `SELECT id, name, email, whatsapp, notifWaEnabled, notifEmailEnabled FROM users WHERE id IN (${placeholders})`,
                    args: nextStageUserIds.map(bind),
                  })
                  const notifConfig = {
                    notifWaEnabled: toBool(s.notifWaEnabled),
                    notifWaToken: s.notifWaToken as string | null,
                    notifWaDeviceId: s.notifWaDeviceId as string | null,
                    notifWaSenderNumber: s.notifWaSenderNumber as string | null,
                    notifEmailEnabled: toBool(s.notifEmailEnabled),
                    notifEmailHost: s.notifEmailHost as string | null,
                    notifEmailPort: s.notifEmailPort ? Number(s.notifEmailPort) : null,
                    notifEmailUser: s.notifEmailUser as string | null,
                    notifEmailPass: s.notifEmailPass as string | null,
                    notifEmailFromName: s.notifEmailFromName as string | null,
                  }
                  for (const row of usersRes.rows) {
                    const u = row as Record<string, unknown>
                    await sendStageAdvanceNotification(
                      { name: String(u.name), email: String(u.email), whatsapp: u.whatsapp as string | null, notifWaEnabled: toBool(u.notifWaEnabled), notifEmailEnabled: toBool(u.notifEmailEnabled) },
                      notifConfig,
                      { projectTitle: String(proj.title), newStage },
                    )
                  }
                }
              }
            }
          } catch (err) {
            console.error(`[TASKS ${reqId}] BG: stage-advance work failed:`, err)
          }
        })())
      }

      // =========================================================================
      // Intra-stage handoff: Editor (Foto) → Editor (Template Sosial Media)
      // =========================================================================
      if (String(existingTask.role) === 'EditorFoto' && existingTaskStage === 2) {
        const remainingFoto = projectTasks.filter(t => t.stage === 2 && t.role === 'EditorFoto' && t.status === 'pending')
        if (remainingFoto.length === 0) {
          const unblockedTemplateTasks = projectTasks.filter(t => t.stage === 2 && t.role === 'EditorTemplateSosialMedia' && t.status === 'pending')
          if (unblockedTemplateTasks.length > 0) {
            // DEFER: create handoff notifications
            deferToBackground((async () => {
              try {
                for (const tt of unblockedTemplateTasks) {
                  await client.execute({
                    sql: `INSERT INTO notifications (id, message, projectId, targetView, read, userId, createdAt)
                          VALUES (?, ?, ?, 'project_detail', 0, ?, ?)`,
                    args: [genId(), `Editor (Foto) telah menyelesaikan tugas pada proyek "${proj.title}". Giliran Anda membuat Template Sosial Media (Tahap 2 — Pasca Produksi).`, bind(projectId), bind(tt.assignedTo), nowMs()],
                  })
                }
              } catch (err) { console.error('[TASKS] BG handoff notif failed:', err) }
            })())
          }
        }
      }
    }

    // =========================================================================
    // Invalidate edge caches (after all MAIN-path DB mutations, before return)
    // =========================================================================
    await invalidateCache('/api/projects')
    await invalidateCache('/api/notifications')
    await invalidateCache('/api/surat-tugas')
    console.log(`[TASKS ${reqId}] caches invalidated, building response`)

    // Return full project state for store sync.
    // Wrap in try/catch — if JSON serialization fails (e.g., due to an
    // unexpected BigInt or circular reference in task data), we still
    // return a valid JSON error instead of "Worker threw exception".
    try {
      const responseBody = {
        success: true,
        task: {
          id: String(existingTask.id),
          status: 'completed',
          data: taskData || {},
          revisionCount,
        },
        newStage,
        stageAdvanced,
        nextStageTasks: stageAdvanced ? nextStagePendingTasks.map(t => ({
          assignedTo: t.assignedTo,
          role: t.role,
          stage: t.stage,
        })) : [],
        projectState: {
          currentStage: newStage,
          tasks: projectTasks.map(t => ({
            id: t.id,
            role: t.role,
            stage: t.stage,
            status: t.status,
            assignedTo: t.assignedTo,
            data: t.data,
            revisionCount: t.revisionCount,
          })),
        },
      }
      console.log(`[TASKS ${reqId}] success, stageAdvanced=${stageAdvanced}, newStage=${newStage}`)
      return NextResponse.json(responseBody)
    } catch (serializeErr) {
      console.error(`[TASKS ${reqId}] response serialization failed:`, serializeErr)
      return NextResponse.json(
        { error: 'Gagal membuat response server. Tugas mungkin sudah tersimpan — silakan refresh halaman.' },
        { status: 500 }
      )
    }
  } catch (error) {
    console.error(`[TASKS ${reqId}] Update task error:`, error)
    const detail = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: `Gagal memperbarui tugas di server: ${detail}` },
      { status: 500 }
    )
  }
}
