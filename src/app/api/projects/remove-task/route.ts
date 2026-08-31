import { NextRequest, NextResponse } from 'next/server'
import { invalidateCache, deferToBackground } from '@/lib/edge-cache'
import {
  getLibsql,
  nowMs,
  bind,
} from '@/lib/libsql-client'

// ============================================================================
// ROLE_CANONICAL_STAGE — inline copy of ROLE_CONFIG[role].stage from @/lib/store.
// Inlined (instead of imported) because @/lib/store imports zustand at
// module-load time, which adds unnecessary module-load CPU on Cloudflare
// Workers. Same defensive pattern used in projects/route.ts, add-task,
// reassign-task. Lihat fix V10 migration di src/lib/db-sync.ts untuk konteks.
// ============================================================================
const ROLE_CANONICAL_STAGE: Record<string, number> = {
  'Reporter': 1,
  'ContentCreator': 1,
  'PhotographerVideographerAudio': 1,
  'GraphicDesigner': 1,
  'EditorVideo': 2,
  'EditorWebArticle': 2,
  'EditorFoto': 2,
  'EditorTemplateSosialMedia': 2,
  'StreamingOperator': 2,
  'PodcastOperator': 2,
  'Reviewer': 3,
  'PublisherWeb': 4,
  'PublisherSocialMedia': 4,
}

const STAGE_NAMES: Record<number, string> = {
  0: 'Perencanaan',
  1: 'Produksi',
  2: 'Pasca Produksi',
  3: 'Review',
  4: 'Publikasi',
  5: 'Selesai',
}

/**
 * POST /api/projects/remove-task
 *
 * Hapus petugas dari proyek (DELETE task row).
 *
 * Manager/Admin only. Digunakan ketika:
 *   - Petugas berhalangan dan sudah diganti oleh petugas lain (yang sudah
 *     ditambahkan via "Tambah Petugas").
 *   - Manager ingin menarik petugas dari tahap agar sistem bisa lanjut ke
 *     tahap berikutnya (sistem advance ketika semua task di tahap berjalan
 *     completed — jika task pending dibiarkan, tahap tidak bisa advance).
 *
 * ATURAN KEAMANAN:
 *   1. Hanya task dengan status 'pending' yang bisa dihapus. Task 'completed'
 *      tidak bisa dihapus (sudah ada kontribusi ke proyek + history).
 *   2. Tidak bisa hapus task jika itu adalah satu-satunya task di tahapnya dan
 *      tahap belum completed (akan menyebabkan tahap kosong → sistem tidak
 *      tahu kapan harus advance). Manager harus tambah petugas pengganti
 *      dulu, baru hapus yang lama.
 *   3. Tidak bisa hapus task di project yang sudah Selesai (currentStage=5).
 *   4. Setelah hapus, jalankan self-heal stage advance (sama seperti
 *      /api/tasks PUT) — kalau tahap ini sekarang punya 0 task pending,
 *      sistem bisa advance ke tahap berikutnya.
 *
 * Body: { projectId, taskId }
 *
 * Returns: { success: true, removedTaskId, newCurrentStage }
 */
export async function POST(request: NextRequest) {
  const requestUserRole = request.headers.get('X-User-Role')
  if (requestUserRole !== 'Admin' && requestUserRole !== 'Manager') {
    return NextResponse.json(
      { error: 'Hanya Admin atau Manager yang dapat menghapus petugas' },
      { status: 403 },
    )
  }

  try {
    const body = await request.json()
    const { projectId, taskId } = body as {
      projectId?: string
      taskId?: string
    }

    if (!projectId || !taskId) {
      return NextResponse.json(
        { error: 'projectId dan taskId wajib diisi' },
        { status: 400 },
      )
    }

    const client = getLibsql()

    // 1. Fetch project (must exist and not be completed)
    const projRes = await client.execute({
      sql: `SELECT id, title, currentStage FROM projects WHERE id = ?`,
      args: [bind(projectId)],
    })

    if (projRes.rows.length === 0) {
      return NextResponse.json(
        { error: 'Proyek tidak ditemukan' },
        { status: 404 },
      )
    }

    const projRow = projRes.rows[0] as Record<string, unknown>
    const projectTitle = String(projRow.title)
    const projectCurrentStage = Number(projRow.currentStage)

    if (projectCurrentStage === 5) {
      return NextResponse.json(
        { error: 'Proyek sudah selesai. Tidak dapat menghapus petugas.' },
        { status: 400 },
      )
    }

    // 2. Fetch task (must exist, belong to this project, status='pending')
    const taskRes = await client.execute({
      sql: `SELECT id, role, stage, status, assignedTo FROM tasks WHERE id = ? AND projectId = ?`,
      args: [bind(taskId), bind(projectId)],
    })

    if (taskRes.rows.length === 0) {
      return NextResponse.json(
        { error: 'Tugas tidak ditemukan di proyek ini' },
        { status: 404 },
      )
    }

    const taskRow = taskRes.rows[0] as Record<string, unknown>
    const taskStatus = String(taskRow.status)
    const taskRole = String(taskRow.role)
    const taskStage = Number(taskRow.stage)
    const taskAssigneeId = String(taskRow.assignedTo)

    if (taskStatus === 'completed') {
      return NextResponse.json(
        {
          error: `Tidak dapat menghapus petugas yang sudah menyelesaikan tugasnya. ` +
                 `Petugas ini sudah berkontribusi ke proyek dan history-nya harus tetap ada untuk keperluan audit. ` +
                 `Gunakan "Ganti Petugas" jika perlu mengganti petugas yang sudah selesai.`,
        },
        { status: 400 },
      )
    }

    if (taskStatus === 'in_progress') {
      return NextResponse.json(
        {
          error: `Tidak dapat menghapus petugas yang sedang mengerjakan tugas. ` +
                 `Tunggu hingga petugas menyelesaikan atau batalkan tugasnya terlebih dahulu.`,
        },
        { status: 400 },
      )
    }

    // 3. Safety check: jangan hapus jika ini satu-satunya task pending di tahapnya
    //    dan tahap belum completed. Manager harus tambah pengganti dulu.
    const stageTasksRes = await client.execute({
      sql: `SELECT id, status FROM tasks WHERE projectId = ? AND stage = ? AND id != ?`,
      args: [bind(projectId), bind(taskStage), bind(taskId)],
    })
    const remainingStageTasks = stageTasksRes.rows.map(r => ({
      status: String((r as Record<string, unknown>).status),
    }))

    const hasOtherPending = remainingStageTasks.some(t => t.status === 'pending')
    const hasOtherCompleted = remainingStageTasks.some(t => t.status === 'completed')

    // Kalau tahap belum selesai dan ini satu-satunya task pending → block.
    // (Tidak ada task lain yang bisa meng-advance tahap).
    if (!hasOtherPending && !hasOtherCompleted) {
      return NextResponse.json(
        {
          error: `Tidak dapat menghapus petugas ini karena ini satu-satunya tugas di Tahap ${taskStage} (${STAGE_NAMES[taskStage] || ''}). ` +
                 `Jika dihapus, tahap akan kosong dan sistem tidak bisa lanjut ke tahap berikutnya. ` +
                 `Tambahkan petugas pengganti terlebih dahulu (klik "+ Tambah Petugas"), lalu hapus petugas ini.`,
        },
        { status: 400 },
      )
    }

    // Kalau tahap belum selesai dan tidak ada pengganti yang pending → block.
    // (Manager hapus yang pending, padahal tahap belum advance).
    if (!hasOtherPending && hasOtherCompleted && projectCurrentStage <= taskStage) {
      return NextResponse.json(
        {
          error: `Tidak dapat menghapus petugas ini. Tahap ${taskStage} (${STAGE_NAMES[taskStage] || ''}) ` +
                 `sudah ada yang completed tetapi belum advance. ` +
                 `Hubungi admin atau coba refresh halaman — sistem akan auto-advance. ` +
                 `Jika tetap ingin hapus, pastikan ada petugas pengganti dengan status 'pending' di tahap ini.`,
        },
        { status: 400 },
      )
    }

    // 4. Hapus task
    await client.execute({
      sql: `DELETE FROM tasks WHERE id = ? AND projectId = ?`,
      args: [bind(taskId), bind(projectId)],
    })

    // 5. Hapus surat_tugas aktif untuk task ini (kalau ada)
    //    surat_tugas aktif = status='active'. Surat tugas 'completed' tetap
    //    dipertahankan untuk history audit.
    try {
      await client.execute({
        sql: `DELETE FROM surat_tugas WHERE projectId = ? AND userId = ? AND role = ? AND status = 'active'`,
        args: [bind(projectId), bind(taskAssigneeId), bind(taskRole)],
      })
    } catch (suratErr) {
      console.error('[REMOVE-TASK] Failed to delete surat_tugas:', suratErr)
      // Non-fatal — task sudah dihapus, surat_tugas orphaned tidak masalah
    }

    // 6. Self-heal: cek apakah tahap sekarang bisa advance
    //    (sama seperti logic di /api/tasks PUT setelah task completed)
    let newCurrentStage = projectCurrentStage
    if (hasOtherCompleted && projectCurrentStage <= taskStage) {
      // Cek ulang: apakah semua task di tahap sekarang completed?
      const stageCheckRes = await client.execute({
        sql: `SELECT COUNT(*) as totalPending FROM tasks WHERE projectId = ? AND stage = ? AND status != 'completed'`,
        args: [bind(projectId), bind(projectCurrentStage)],
      })
      const remainingPending = Number((stageCheckRes.rows[0] as Record<string, unknown>).totalPending ?? 0)

      if (remainingPending === 0) {
        // Cari tahap berikutnya yang punya task pending
        let nextStage = projectCurrentStage + 1
        while (nextStage <= 4) {
          const nextPendingRes = await client.execute({
            sql: `SELECT COUNT(*) as cnt FROM tasks WHERE projectId = ? AND stage = ? AND status = 'pending'`,
            args: [bind(projectId), bind(nextStage)],
          })
          const nextPending = Number((nextPendingRes.rows[0] as Record<string, unknown>).cnt ?? 0)
          if (nextPending > 0) break
          nextStage++
        }

        if (nextStage <= 4) {
          // Advance project ke nextStage
          await client.execute({
            sql: `UPDATE projects SET currentStage = ?, updatedAt = ? WHERE id = ?`,
            args: [bind(nextStage), bind(nowMs()), bind(projectId)],
          })
          newCurrentStage = nextStage
          console.log(`[REMOVE-TASK] Project ${projectId} advanced from stage ${projectCurrentStage} to ${nextStage}`)
        } else {
          // Tidak ada task pending di tahap manapun → project selesai
          await client.execute({
            sql: `UPDATE projects SET currentStage = 5, updatedAt = ? WHERE id = ?`,
            args: [bind(nowMs()), bind(projectId)],
          })
          newCurrentStage = 5
          console.log(`[REMOVE-TASK] Project ${projectId} advanced to stage 5 (Selesai)`)
        }
      }
    }

    // 7. Invalidate caches
    deferToBackground(invalidateCache('/api/projects'))
    deferToBackground(invalidateCache('/api/tasks'))
    deferToBackground(invalidateCache('/api/notifications'))
    deferToBackground(invalidateCache('/api/surat-tugas'))

    return NextResponse.json({
      success: true,
      removedTaskId: taskId,
      newCurrentStage,
      message: `Petugas berhasil dihapus dari tahap ${taskStage}.`,
    })
  } catch (error) {
    console.error('[REMOVE-TASK] Error:', error)
    return NextResponse.json(
      {
        error: 'Gagal menghapus petugas: ' +
               (error instanceof Error ? error.message : 'Unknown error'),
      },
      { status: 500 },
    )
  }
}
