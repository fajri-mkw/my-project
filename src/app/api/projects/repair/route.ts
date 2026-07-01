import { NextRequest, NextResponse } from 'next/server'
import { getLibsql, nowMs } from '@/lib/libsql-client'
import { invalidateCache } from '@/lib/edge-cache'

/**
 * POST /api/projects/repair
 *
 * Self-heal endpoint: fixes projects where ALL tasks are completed but
 * currentStage is stuck at a value other than 5 (Selesai).
 *
 * This happens when:
 * 1. Cloudflare Workers 10ms CPU limit kills /api/tasks mid-execution —
 *    the task gets marked completed but the stage-advance logic never runs.
 * 2. Historical data from older code versions that didn't advance stages
 *    reliably.
 * 3. Force-complete API calls that failed (network/CPU) but the task data
 *    was already partially written with forceCompleted: true.
 *
 * Uses a single efficient SQL UPDATE with subquery — no JS loops, minimal CPU.
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

    // Single SQL statement: find all projects where:
    // - currentStage != 5 (not yet marked Selesai)
    // - has at least one task
    // - has NO pending tasks (all completed)
    // Then set currentStage = 5 for all of them at once.
    //
    // Also close all active surat_tugas for those projects (same as
    // force-complete does) so the Inbox reflects "Selesai".
    const repairResult = await client.execute({
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

    const fixedCount = Number(repairResult.rowsAffected ?? 0)

    // Only do surat_tugas cleanup + cache invalidation if something was fixed
    if (fixedCount > 0) {
      // Close active surat_tugas for the repaired projects
      await client.execute({
        sql: `UPDATE surat_tugas
              SET status = 'completed'
              WHERE status = 'active'
                AND projectId IN (
                  SELECT id FROM projects WHERE currentStage = 5 AND updatedAt = ?
                )`,
        args: [ts],
      })

      // Invalidate all affected caches
      await invalidateCache('/api/projects')
      await invalidateCache('/api/notifications')
      await invalidateCache('/api/surat-tugas')
    }

    return NextResponse.json({
      success: true,
      repairedProjects: fixedCount,
      message:
        fixedCount > 0
          ? `${fixedCount} proyek berhasil diperbaiki (currentStage → 5)`
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
