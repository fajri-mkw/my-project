import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'
import { invalidateCache } from '@/lib/edge-cache'
import { getLibsql, parseJSON, bind } from '@/lib/libsql-client'
import { setupWorkerDriveFolders, WorkerFolderSetupResult } from '@/lib/drive-worker-folders'

// ============================================================================
// POST /api/projects/repair-task-folders
//
// Perbaiki folder Drive untuk petugas yang TIDAK punya folder padahal
// tugasnya menuntut upload ("Anda tidak memiliki akses ke folder yang
// sesuai untuk tahapan ini").
//
// Root cause historis: add-task dulu membuat folder petugas di background
// (deferToBackground) yang tidak reliable di Cloudflare Workers — 4 petugas
// di 4 proyek (semua photographer tambahan) kehilangan folder-nya. Endpoint
// ini menjalankan setupWorkerDriveFolders (idempotent) untuk memperbaiki.
//
// Body: { projectId?: string }
//   - projectId diberikan  → periksa SEMUA petugas pending di proyek itu
//     (mengisi folder/akses yang kurang — idempotent).
//   - projectId kosong    → pindai SEMUA proyek, perbaiki hanya petugas
//     yang hilang dari semua folder (broken total).
//
// Admin/Manager only.
// ============================================================================

interface PendingTaskRow {
  projectId: string
  role: string
  stage: number
  assignedTo: string
  userName: string
}

export async function POST(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock

  const requestUserRole = request.headers.get('X-User-Role')
  if (requestUserRole !== 'Admin' && requestUserRole !== 'Manager') {
    return NextResponse.json(
      { error: 'Hanya Admin atau Manager yang dapat memperbaiki folder petugas' },
      { status: 403 },
    )
  }

  try {
    const body = await request.json().catch(() => ({}))
    const { projectId } = (body || {}) as { projectId?: string }

    const client = getLibsql()

    // ------------------------------------------------------------------
    // 1. Kumpulkan kandidat petugas pending (dengan nama user)
    // ------------------------------------------------------------------
    let candidates: PendingTaskRow[] = []

    if (projectId) {
      // Mode per-proyek: SEMUA petugas pending di proyek ini (setup idempotent
      // akan skip yang sudah punya folder, hanya mengisi yang kurang).
      const res = await client.execute({
        sql: `SELECT t.projectId, t.role, t.stage, t.assignedTo, u.name AS userName
              FROM tasks t
              JOIN users u ON u.id = t.assignedTo
              WHERE t.projectId = ? AND t.status = 'pending' AND t.assignedTo IS NOT NULL`,
        args: [bind(projectId)],
      })
      candidates = res.rows.map(r => {
        const x = r as Record<string, unknown>
        return {
          projectId: String(x.projectId),
          role: String(x.role),
          stage: Number(x.stage),
          assignedTo: String(x.assignedTo),
          userName: String(x.userName),
        }
      })
    } else {
      // Mode global: SEMUA petugas pending di semua proyek, difilter nanti
      // terhadap folder yang ada (hanya yang broken total diperbaiki).
      const res = await client.execute(
        `SELECT t.projectId, t.role, t.stage, t.assignedTo, u.name AS userName
         FROM tasks t
         JOIN users u ON u.id = t.assignedTo
         WHERE t.status = 'pending' AND t.assignedTo IS NOT NULL`,
      )
      candidates = res.rows.map(r => {
        const x = r as Record<string, unknown>
        return {
          projectId: String(x.projectId),
          role: String(x.role),
          stage: Number(x.stage),
          assignedTo: String(x.assignedTo),
          userName: String(x.userName),
        }
      })
    }

    // ------------------------------------------------------------------
    // 2. Petugas mana yang bermasalah?
    //    Mode per-proyek: semua kandidat (idempotent fill).
    //    Mode global   : hanya yang userId-nya tidak muncul di assignedUsers
    //                    folder MANA PUN pada proyeknya (broken total).
    // ------------------------------------------------------------------
    let toRepair: PendingTaskRow[] = []

    if (projectId) {
      toRepair = candidates
    } else {
      // Muat assignedUsers semua folder, kelompokkan per proyek
      const foldersRes = await client.execute(
        `SELECT projectId, assignedUsers FROM drive_folders`,
      )
      const usersByProject = new Map<string, Set<string>>()
      for (const row of foldersRes.rows) {
        const x = row as Record<string, unknown>
        const pid = String(x.projectId)
        const au = parseJSON(x.assignedUsers, []) as Array<{ userId: string }>
        const s = usersByProject.get(pid) || new Set<string>()
        for (const a of au) s.add(a.userId)
        usersByProject.set(pid, s)
      }
      toRepair = candidates.filter(t => {
        const s = usersByProject.get(t.projectId)
        return !s || !s.has(t.assignedTo)
      })
    }

    // ------------------------------------------------------------------
    // 3. Jalankan setupWorkerDriveFolders — satu kali per
    //    (projectId, userId, role) agar tidak duplikat pekerjaan.
    // ------------------------------------------------------------------
    const seen = new Set<string>()
    const repaired: WorkerFolderSetupResult[] = []
    const warnings: string[] = []

    for (const t of toRepair) {
      const key = `${t.projectId}|${t.assignedTo}|${t.role}`
      if (seen.has(key)) continue
      seen.add(key)

      try {
        const res = await setupWorkerDriveFolders({
          projectId: t.projectId,
          userId: t.assignedTo,
          userName: t.userName,
          role: t.role,
          stage: t.stage,
        })
        repaired.push(res)
        if (res.skippedParents.length > 0) {
          warnings.push(`${t.userName}: ${res.skippedParents.join(', ')}`)
        }
      } catch (err) {
        console.error(`[REPAIR-FOLDERS] Gagal setup folder untuk ${t.userName} (${t.role}) di ${t.projectId}:`, err)
        repaired.push({
          ok: false,
          projectId: t.projectId,
          userId: t.assignedTo,
          userName: t.userName,
          role: t.role,
          stage: t.stage,
          createdLogicalIds: [],
          updatedParentIds: [],
          skippedParents: [],
          error: err instanceof Error ? err.message : 'Unknown error',
        })
      }
    }

    await invalidateCache('/api/projects')

    // Ringkasan mudah dibaca
    const fixed = repaired.filter(r => r.ok && (r.createdLogicalIds.length > 0 || r.updatedParentIds.length > 0))
    const failed = repaired.filter(r => !r.ok)

    return NextResponse.json({
      success: true,
      checked: candidates.length,
      repairedCount: fixed.length,
      failedCount: failed.length,
      repaired,
      warnings,
      summary: failed.length > 0
        ? `${fixed.length} petugas diperbaiki, ${failed.length} gagal.`
        : fixed.length > 0
          ? `${fixed.length} petugas diperbaiki.`
          : 'Semua petugas sudah memiliki folder yang sesuai — tidak ada yang perlu diperbaiki.',
    })
  } catch (error) {
    console.error('[REPAIR-FOLDERS] Error:', error)
    return NextResponse.json(
      {
        error: 'Gagal memperbaiki folder petugas: ' +
          (error instanceof Error ? error.message : 'Unknown error'),
      },
      { status: 500 },
    )
  }
}
