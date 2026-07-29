import { NextRequest, NextResponse } from 'next/server'
import { invalidateCache, deferToBackground } from '@/lib/edge-cache'
import {
  getLibsql,
  nowMs,
  parseJSON,
  bind,
  genId,
} from '@/lib/libsql-client'

// ============================================================================
// ROLE_CANONICAL_STAGE — inline copy of ROLE_CONFIG[role].stage from @/lib/store.
// Inlined (instead of imported) because @/lib/store imports zustand at
// module-load time, which adds unnecessary module-load CPU on Cloudflare
// Workers. Same defensive pattern used in projects/route.ts. Lihat fix V10
// migration di src/lib/db-sync.ts untuk konteks lengkap.
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
 * PUT /api/projects/reassign-task
 *
 * Ganti petugas (assigned worker) untuk sebuah task pada proyek.
 * Manager/Admin only.
 *
 * Body: { projectId, taskId, newAssigneeId }
 *
 * Logic:
 *  1. Verifikasi task milik project yang dimaksud.
 *  2. Verifikasi petugas pengganti ada di DB DAN memiliki peran yang SAMA
 *     dengan task (defensive — mencegah Reporter task di-assign ke Reviewer
 *     dsb.). Konsisten dengan filosofi ROLE_CANONICAL_STAGE (V10 fix).
 *  3. Reset task: assignedTo=newAssigneeId, status='pending', data='{}',
 *     revisionCount=0. Re-clamp stage ke canonical (defensive terhadap
 *     row yang terkorupsi — lihat V10 migration di db-sync.ts).
 *  4. Tandai surat_tugas AKTIF milik petugas LAMA untuk project+role ini
 *     sebagai 'completed' agar berhenti muncul di Inbox petugas lama.
 *  5. Buat surat_tugas BARU untuk petugas pengganti (de-dup check).
 *  6. Notifikasi petugas pengganti ("Anda ditunjuk sebagai pengganti...").
 *  7. Invalidate caches.
 *  8. Return updated task + project currentStage agar store bisa sync.
 *
 * Use case: petugas tiba-tiba berhalangan dan perlu diganti dengan petugas
 * lain yang memiliki peran yang sama. Manager dapat mengganti tanpa harus
 * membuat proyek baru.
 */
export async function PUT(request: NextRequest) {
  const requestUserRole = request.headers.get('X-User-Role')
  if (requestUserRole !== 'Admin' && requestUserRole !== 'Manager') {
    return NextResponse.json(
      { error: 'Hanya Admin atau Manager yang dapat mengganti petugas' },
      { status: 403 },
    )
  }

  try {
    const body = await request.json()
    const { projectId, taskId, newAssigneeId } = body as {
      projectId?: string
      taskId?: string
      newAssigneeId?: string
    }

    if (!projectId || !taskId || !newAssigneeId) {
      return NextResponse.json(
        { error: 'projectId, taskId, dan newAssigneeId wajib diisi' },
        { status: 400 },
      )
    }

    const client = getLibsql()

    // 1. Fetch task + project title (verify task belongs to project)
    const taskRes = await client.execute({
      sql: `SELECT t.id, t.role, t.stage, t.status, t.data, t.assignedTo,
                   p.title, p.currentStage
            FROM tasks t
            JOIN projects p ON p.id = t.projectId
            WHERE t.id = ? AND t.projectId = ?`,
      args: [bind(taskId), bind(projectId)],
    })

    if (taskRes.rows.length === 0) {
      return NextResponse.json(
        { error: 'Tugas tidak ditemukan pada proyek ini' },
        { status: 404 },
      )
    }

    const taskRow = taskRes.rows[0] as Record<string, unknown>
    const taskRole = String(taskRow.role)
    const oldAssigneeId = taskRow.assignedTo ? String(taskRow.assignedTo) : ''
    const taskData = parseJSON<Record<string, unknown>>(taskRow.data, {})

    // Don't allow reassigning fast-tracked (auto-completed) tasks —
    // they are auto-completed by the system and have no real worker to replace.
    if (taskData?.fastTracked === true) {
      return NextResponse.json(
        {
          error:
            'Tugas Fast Track (otomatis dilewati) tidak perlu diganti petugasnya',
        },
        { status: 400 },
      )
    }

    // 2. Verify new assignee exists and has the SAME role as the task
    const userRes = await client.execute({
      sql: `SELECT id, name, role FROM users WHERE id = ?`,
      args: [bind(newAssigneeId)],
    })

    if (userRes.rows.length === 0) {
      return NextResponse.json(
        { error: 'Petugas pengganti tidak ditemukan' },
        { status: 404 },
      )
    }

    const newUser = userRes.rows[0] as Record<string, unknown>
    const newUserRole = String(newUser.role)

    if (newUserRole !== taskRole) {
      return NextResponse.json(
        {
          error: `Petugas pengganti harus memiliki peran yang sama (${taskRole}). Petugas yang dipilih berperan sebagai ${newUserRole}.`,
        },
        { status: 400 },
      )
    }

    if (newAssigneeId === oldAssigneeId) {
      return NextResponse.json(
        { error: 'Petugas pengganti sama dengan petugas saat ini' },
        { status: 400 },
      )
    }

    // 3. Reassign + reset the task
    const canonicalStage = ROLE_CANONICAL_STAGE[taskRole] ?? Number(taskRow.stage)
    const ts = nowMs()

    await client.execute({
      sql: `UPDATE tasks
            SET assignedTo = ?, status = 'pending', data = '{}',
                revisionCount = 0, stage = ?, updatedAt = ?
            WHERE id = ?`,
      args: [bind(newAssigneeId), canonicalStage, ts, bind(taskId)],
    })

    // 4. Mark old assignee's active surat_tugas as completed (so it stops
    //    showing in their Inbox as "Aktif")
    if (oldAssigneeId) {
      try {
        await client.execute({
          sql: `UPDATE surat_tugas
                SET status = 'completed'
                WHERE projectId = ? AND userId = ? AND role = ? AND status = 'active'`,
          args: [bind(projectId), bind(oldAssigneeId), bind(taskRole)],
        })
      } catch (suratErr) {
        // Non-critical — the reassign itself already succeeded.
        console.error('[REASSIGN-TASK] surat_tugas close-old failed:', suratErr)
      }
    }

    // 5. Create new surat_tugas for new assignee (de-dup check)
    try {
      const existingSurat = await client.execute({
        sql: `SELECT id FROM surat_tugas WHERE projectId = ? AND userId = ? AND role = ? LIMIT 1`,
        args: [bind(projectId), bind(newAssigneeId), bind(taskRole)],
      })
      if (existingSurat.rows.length === 0) {
        await client.execute({
          sql: `INSERT INTO surat_tugas (id, nomorSurat, projectId, userId, role, stage, status, read, createdAt)
                VALUES (?, ?, ?, ?, ?, ?, 'active', 0, ?)`,
          args: [
            genId(),
            `ST/GANTI/${canonicalStage}/${Date.now()}`,
            bind(projectId),
            bind(newAssigneeId),
            bind(taskRole),
            canonicalStage,
            ts,
          ],
        })
      }
    } catch (suratErr) {
      console.error('[REASSIGN-TASK] surat_tugas create-new failed:', suratErr)
    }

    // 6. Invalidate caches (before deferred work so next GET /api/projects
    //    reflects the new assignee)
    await invalidateCache('/api/projects')
    await invalidateCache('/api/notifications')
    await invalidateCache('/api/surat-tugas')

    // 7. Defer notification creation to background (non-critical)
    const projectTitle = String(taskRow.title)
    const stageName = STAGE_NAMES[canonicalStage] || `Tahap ${canonicalStage}`
    deferToBackground((async () => {
      try {
        await client.execute({
          sql: `INSERT INTO notifications (id, message, projectId, targetView, read, userId, createdAt)
                VALUES (?, ?, ?, 'project_detail', 0, ?, ?)`,
          args: [
            genId(),
            `Anda ditunjuk sebagai pengganti petugas ${taskRole} untuk proyek "${projectTitle}" (Tahap ${canonicalStage}: ${stageName}). Segera kerjakan tugas Anda.`,
            bind(projectId),
            bind(newAssigneeId),
            nowMs(),
          ],
        })
      } catch (notifErr) {
        console.error('[REASSIGN-TASK] BG notification create failed:', notifErr)
      }
    })())

    // 8. Return updated task + project currentStage for store sync
    return NextResponse.json({
      success: true,
      taskId,
      projectId,
      task: {
        id: taskId,
        role: taskRole,
        stage: canonicalStage,
        status: 'pending' as const,
        assignedTo: newAssigneeId,
        data: {},
        revisionCount: 0,
      },
      currentStage: Number(taskRow.currentStage),
      message: 'Petugas berhasil diganti',
    })
  } catch (error) {
    console.error('[REASSIGN-TASK] Error:', error)
    return NextResponse.json(
      {
        error:
          'Gagal mengganti petugas: ' +
          (error instanceof Error ? error.message : 'Unknown error'),
      },
      { status: 500 },
    )
  }
}
