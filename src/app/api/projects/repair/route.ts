import { NextRequest, NextResponse } from 'next/server'
import { getLibsql, nowMs } from '@/lib/libsql-client'
import { invalidateCache } from '@/lib/edge-cache'

/**
 * POST /api/projects/repair
 *
 * Self-heal endpoint: fixes projects where currentStage doesn't match the
 * actual task completion state. Two repair passes:
 *
 * PASS 1 — "all done" repair (original):
 *   Projects where ALL tasks are completed but currentStage != 5.
 *   → Set currentStage = 5 (Selesai) + close surat_tugas.
 *   This is the case when Cloudflare Workers CPU limit kills /api/tasks
 *   mid-execution after the last task is marked completed but before the
 *   stage-advance UPDATE runs.
 *
 * PASS 2 — "stuck at intermediate stage" repair (NEW):
 *   Projects where currentStage is stuck at a stage where ALL that stage's
 *   tasks are already completed, but the project hasn't advanced to the next
 *   stage with pending tasks.
 *   Example: currentStage=3 (Review), Reviewer task completed, but project
 *   never advanced to stage 4 (Publikasi). PublisherWeb (stage 4, pending)
 *   is locked because task.stage (4) != project.currentStage (3).
 *   → Advance currentStage to the lowest stage that has pending tasks.
 *   → If no pending tasks remain (shouldn't happen here — Pass 1 catches
 *     that), advance to 5.
 *
 * This second pass is critical for the user-reported bug:
 *   "Publisher web tidak bisa mengerjakan tugas karna publisher sosmed sudah
 *    lebih dulu menyelesaikan tugas"
 * The project was stuck at stage 3 even though the Reviewer was done, so
 * Publisher Web (stage 4) was locked. This pass advances the project to
 * stage 4 so Publisher Web can work.
 *
 * IMPORTANT: This pass does NOT advance to stage 5 unless ALL tasks are done.
 * It respects the invariant: project advances to stage 5 only when ALL
 * publication tasks (stage 4) are completed.
 *
 * Admin/Manager only.
 */
export async function POST(request: NextRequest) {
  const requestUserRole = request.headers.get('X-User-Role')
  if (requestUserRole !== 'Admin' && requestUserRole !== 'Manager') {
    return NextResponse.json(
      { error: 'Hanya Admin atau Manager yang dapat menjalankan repair' },
      { status: 403 },
    )
  }

  try {
    const client = getLibsql()
    const ts = nowMs()
    let totalFixed = 0
    let pass1Fixed = 0
    let pass2Fixed = 0

    // ========================================================================
    // PASS 1: "all done" — all tasks completed but currentStage != 5
    // ========================================================================
    const pass1Result = await client.execute({
      sql: `UPDATE projects
            SET currentStage = 5, updatedAt = ?
            WHERE currentStage != 5
              AND EXISTS (SELECT 1 FROM tasks WHERE projectId = projects.id)
              AND NOT EXISTS (
                SELECT 1 FROM tasks
                WHERE projectId = projects.id AND status != 'completed'
              )`,
      args: [ts],
    })
    pass1Fixed = Number(pass1Result.rowsAffected ?? 0)
    totalFixed += pass1Fixed

    if (pass1Fixed > 0) {
      // Close active surat_tugas for the fully-completed projects
      await client.execute({
        sql: `UPDATE surat_tugas
              SET status = 'completed'
              WHERE status = 'active'
                AND projectId IN (
                  SELECT id FROM projects WHERE currentStage = 5 AND updatedAt = ?
                )`,
        args: [ts],
      })
    }

    // ========================================================================
    // PASS 2: "stuck at intermediate stage"
    //
    // For each project where currentStage < 5 and currentStage != 4:
    //   - Check if ALL tasks at currentStage are completed
    //   - If yes, find the lowest stage > currentStage that has pending tasks
    //   - Advance currentStage to that stage (or 5 if no pending tasks)
    //
    // We also handle currentStage = 4 where all stage-4 tasks are done but
    // there are no pending tasks at any stage (edge case → advance to 5).
    //
    // This must be done in JS (not a single SQL UPDATE) because we need to
    // compute the "lowest pending stage" per project. We batch the updates
    // to minimize DB round-trips.
    // ========================================================================

    // Find candidate projects: currentStage < 5, has tasks, not all tasks done
    // (all-done was already handled by Pass 1).
    const candidatesRes = await client.execute({
      sql: `SELECT p.id AS pid, p.currentStage AS pstage
            FROM projects p
            WHERE p.currentStage < 5
              AND EXISTS (SELECT 1 FROM tasks WHERE projectId = p.id)
              AND EXISTS (SELECT 1 FROM tasks WHERE projectId = p.id AND status != 'completed')
            `,
      args: [],
    })

    type RepairAction = {
      projectId: string
      newStage: number
    }
    const repairs: RepairAction[] = []

    for (const row of candidatesRes.rows) {
      const r = row as Record<string, unknown>
      const pid = String(r.pid)
      const pstage = Number(r.pstage)

      // Fetch all tasks for this project
      const tasksRes = await client.execute({
        sql: `SELECT stage, status FROM tasks WHERE projectId = ?`,
        args: [pid],
      })
      const tasks = tasksRes.rows.map((t) => ({
        stage: Number((t as Record<string, unknown>).stage),
        status: String((t as Record<string, unknown>).status),
      }))

      // Check if ALL tasks at currentStage are completed
      const currentStageTasks = tasks.filter((t) => t.stage === pstage)
      if (currentStageTasks.length === 0) continue
      const allCurrentDone = currentStageTasks.every((t) => t.status === 'completed')
      if (!allCurrentDone) continue

      // Find the lowest stage > currentStage that has pending tasks
      const pendingStages = tasks
        .filter((t) => t.status !== 'completed' && t.stage > pstage)
        .map((t) => t.stage)

      let newStage: number
      if (pendingStages.length > 0) {
        newStage = Math.min(...pendingStages)
      } else {
        // No pending tasks at higher stages — check if ALL remaining tasks
        // are completed. If so, advance to 5.
        const hasPendingAnywhere = tasks.some((t) => t.status !== 'completed')
        newStage = hasPendingAnywhere ? pstage : 5
      }

      if (newStage !== pstage) {
        repairs.push({ projectId: pid, newStage })
      }
    }

    // Batch-update all projects that need stage advancement
    if (repairs.length > 0) {
      // Use a batch of UPDATE statements
      const { bind } = await import('@/lib/libsql-client')
      const stmts = repairs.map((r) => ({
        sql: `UPDATE projects SET currentStage = ?, updatedAt = ? WHERE id = ?`,
        args: [r.newStage, ts, bind(r.projectId)],
      }))
      try {
        await client.batch(stmts, 'write')
        pass2Fixed = repairs.length
        totalFixed += pass2Fixed
      } catch (batchErr) {
        console.error('[PROJECTS REPAIR] Pass 2 batch update failed:', batchErr)
        // Fall back to individual updates
        for (const r of repairs) {
          try {
            await client.execute({
              sql: `UPDATE projects SET currentStage = ?, updatedAt = ? WHERE id = ?`,
              args: [r.newStage, ts, r.projectId],
            })
            pass2Fixed++
            totalFixed++
          } catch (indivErr) {
            console.error(`[PROJECTS REPAIR] Failed to update project ${r.projectId}:`, indivErr)
          }
        }
      }
    }

    // Invalidate caches if anything was fixed
    if (totalFixed > 0) {
      await invalidateCache('/api/projects')
      await invalidateCache('/api/notifications')
      await invalidateCache('/api/surat-tugas')
    }

    const messageParts: string[] = []
    if (pass1Fixed > 0) messageParts.push(`${pass1Fixed} proyek → Selesai (stage 5)`)
    if (pass2Fixed > 0) messageParts.push(`${pass2Fixed} proyek → stage diadvance`)

    return NextResponse.json({
      success: true,
      repairedProjects: totalFixed,
      pass1Fixed,
      pass2Fixed,
      message:
        totalFixed > 0
          ? `${totalFixed} proyek berhasil diperbaiki (${messageParts.join(', ')})`
          : 'Tidak ada proyek yang perlu diperbaiki',
    })
  } catch (error) {
    console.error('[PROJECTS REPAIR] Error:', error)
    return NextResponse.json(
      {
        error:
          'Gagal memperbaiki proyek: ' +
          (error instanceof Error ? error.message : 'Unknown error'),
      },
      { status: 500 },
    )
  }
}
