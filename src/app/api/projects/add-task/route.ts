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
// Workers. Same defensive pattern used in projects/route.ts and
// reassign-task/route.ts. Lihat fix V10 migration di src/lib/db-sync.ts.
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
 * POST /api/projects/add-task
 *
 * Tambah petugas BARU ke sebuah tahap pada proyek yang sudah berjalan.
 * Manager/Admin only.
 *
 * Body: { projectId, role, assigneeId }
 *
 * Use case: Manager ingin menambah petugas pada tahapan tertentu di tengah
 * proyek yang sudah berjalan (mis. tambah 1 Photographer lagi di Tahap 1,
 * atau tambah Editor (Web Article) di Tahap 2). Berbeda dengan "Ganti Petugas"
 * (reassign-task) yang hanya mengganti assignedTo pada task yang sudah ada,
 * endpoint ini membuat row Task BARU sehingga ada 2+ petugas sejenis di tahap
 * yang sama.
 *
 * Logic:
 *  1. Verifikasi proyek ada DAN belum selesai (currentStage !== 5).
 *  2. Verifikasi role adalah role kanonik yang dikenal (ada di
 *     ROLE_CANONICAL_STAGE).
 *  3. Verifikasi petugas ada di DB DAN memiliki peran yang SAMA dengan role
 *     yang diminta (defensive — mencegah Reporter task di-assign ke user
 *     dengan role Reviewer dsb.).
 *  4. Cek duplikat: tolak jika sudah ada task dengan role+assignedTo yang
 *     sama di proyek ini (petugas tersebut sudah ditugaskan untuk peran ini).
 *  5. INSERT task baru: status='pending', data='{}', revisionCount=0,
 *     stage=canonicalStage.
 *  6. Buat surat_tugas untuk petugas baru (de-dup check — tidak insert jika
 *     sudah ada surat_tugas aktif untuk project+user+role ini).
 *  7. Notifikasi petugas baru ("Anda ditunjuk sebagai petugas...").
 *  8. Invalidate caches.
 *  9. Return task baru + project currentStage agar store bisa sync.
 */
export async function POST(request: NextRequest) {
  const requestUserRole = request.headers.get('X-User-Role')
  if (requestUserRole !== 'Admin' && requestUserRole !== 'Manager') {
    return NextResponse.json(
      { error: 'Hanya Admin atau Manager yang dapat menambah petugas' },
      { status: 403 },
    )
  }

  try {
    const body = await request.json()
    const { projectId, role, assigneeId } = body as {
      projectId?: string
      role?: string
      assigneeId?: string
    }

    if (!projectId || !role || !assigneeId) {
      return NextResponse.json(
        { error: 'projectId, role, dan assigneeId wajib diisi' },
        { status: 400 },
      )
    }

    // 2. Validate role is a known canonical role
    const canonicalStage = ROLE_CANONICAL_STAGE[role]
    if (canonicalStage === undefined) {
      return NextResponse.json(
        { error: `Peran "${role}" tidak dikenal` },
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
    const currentStage = Number(projRow.currentStage)

    if (currentStage === 5) {
      return NextResponse.json(
        { error: 'Proyek sudah selesai. Tidak dapat menambah petugas.' },
        { status: 400 },
      )
    }

    // 3. Verify assignee exists and has the SAME role as requested
    const userRes = await client.execute({
      sql: `SELECT id, name, role FROM users WHERE id = ?`,
      args: [bind(assigneeId)],
    })

    if (userRes.rows.length === 0) {
      return NextResponse.json(
        { error: 'Petugas tidak ditemukan' },
        { status: 404 },
      )
    }

    const userRow = userRes.rows[0] as Record<string, unknown>
    const userRole = String(userRow.role)

    if (userRole !== role) {
      return NextResponse.json(
        {
          error: `Petugas harus memiliki peran ${role}. Petugas yang dipilih berperan sebagai ${userRole}.`,
        },
        { status: 400 },
      )
    }

    // 4. Duplicate check — reject if this user is already assigned this role
    //    on this project (prevents adding the same person twice).
    const dupRes = await client.execute({
      sql: `SELECT id FROM tasks WHERE projectId = ? AND role = ? AND assignedTo = ? LIMIT 1`,
      args: [bind(projectId), bind(role), bind(assigneeId)],
    })

    if (dupRes.rows.length > 0) {
      return NextResponse.json(
        {
          error: 'Petugas tersebut sudah ditugaskan untuk peran ini pada proyek ini.',
        },
        { status: 400 },
      )
    }

    // 5. INSERT the new task
    const taskId = genId()
    const ts = nowMs()

    await client.execute({
      sql: `INSERT INTO tasks (id, role, stage, status, data, revisionCount, assignedTo, projectId, createdAt, updatedAt)
            VALUES (?, ?, ?, 'pending', '{}', 0, ?, ?, ?, ?)`,
      args: [
        bind(taskId),
        bind(role),
        canonicalStage,
        bind(assigneeId),
        bind(projectId),
        ts,
        ts,
      ],
    })

    // 6. Create surat_tugas for the new assignee (de-dup check — only insert
    //    if none exists yet, so re-adding a previously-removed worker won't
    //    create duplicate surat rows).
    try {
      const existingSurat = await client.execute({
        sql: `SELECT id FROM surat_tugas WHERE projectId = ? AND userId = ? AND role = ? LIMIT 1`,
        args: [bind(projectId), bind(assigneeId), bind(role)],
      })
      if (existingSurat.rows.length === 0) {
        await client.execute({
          sql: `INSERT INTO surat_tugas (id, nomorSurat, projectId, userId, role, stage, status, read, createdAt)
                VALUES (?, ?, ?, ?, ?, ?, 'active', 0, ?)`,
          args: [
            genId(),
            `ST/TAMBAH/${canonicalStage}/${Date.now()}`,
            bind(projectId),
            bind(assigneeId),
            bind(role),
            canonicalStage,
            ts,
          ],
        })
      } else {
        // Reactivate existing surat_tugas if it was previously completed
        await client.execute({
          sql: `UPDATE surat_tugas
                SET status = 'active', read = 0
                WHERE projectId = ? AND userId = ? AND role = ? AND status = 'completed'`,
          args: [bind(projectId), bind(assigneeId), bind(role)],
        })
      }
    } catch (suratErr) {
      console.error('[ADD-TASK] surat_tugas create failed:', suratErr)
    }

    // 7. Invalidate caches (before deferred work so next GET /api/projects
    //    reflects the new task)
    await invalidateCache('/api/projects')
    await invalidateCache('/api/notifications')
    await invalidateCache('/api/surat-tugas')

    // 8. Defer notification creation to background (non-critical)
    const stageName = STAGE_NAMES[canonicalStage] || `Tahap ${canonicalStage}`
    deferToBackground((async () => {
      try {
        await client.execute({
          sql: `INSERT INTO notifications (id, message, projectId, targetView, read, userId, createdAt)
                VALUES (?, ?, ?, 'project_detail', 0, ?, ?)`,
          args: [
            genId(),
            `Anda ditunjuk sebagai petugas ${role} untuk proyek "${projectTitle}" (Tahap ${canonicalStage}: ${stageName}). Segera kerjakan tugas Anda.`,
            bind(projectId),
            bind(assigneeId),
            nowMs(),
          ],
        })
      } catch (notifErr) {
        console.error('[ADD-TASK] BG notification create failed:', notifErr)
      }
    })())

    // 9. Return the new task + project currentStage for store sync
    return NextResponse.json({
      success: true,
      taskId,
      projectId,
      task: {
        id: taskId,
        role,
        stage: canonicalStage,
        status: 'pending' as const,
        assignedTo: assigneeId,
        data: {},
        revisionCount: 0,
      },
      currentStage,
      message: 'Petugas berhasil ditambahkan',
    })
  } catch (error) {
    console.error('[ADD-TASK] Error:', error)
    return NextResponse.json(
      {
        error:
          'Gagal menambah petugas: ' +
          (error instanceof Error ? error.message : 'Unknown error'),
      },
      { status: 500 },
    )
  }
}
