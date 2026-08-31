import { NextRequest, NextResponse } from 'next/server'
import { invalidateCache, deferToBackground } from '@/lib/edge-cache'
import {
  getLibsql,
  nowMs,
  parseJSON,
  bind,
  genId,
} from '@/lib/libsql-client'
import { readDriveSettings, getDriveTarget } from '@/lib/drive-helpers'
import {
  getCachedAccessToken,
  createDriveFolder,
} from '@/lib/drive-service'

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

    // 6b. BUKAN CRITICAL PATH: Create user subfolder di Google Drive + update
    //     drive_folders.assignedUsers untuk semua parent folder aktif di tahap
    //     petugas baru. DEFER ke background (deferToBackground) supaya tidak
    //     block response — petugas bisa lihat task dia segera, subfolder dibuat
    //     secara async (paling lambat ~3-5 detik).
    //
    //     TANPA INI: petugas pengganti tidak bisa upload karena UI filter
    //     getUploadFolders() cek assignedUsers. Petugas juga tidak punya
    //     subfolder sendiri (Foto/, Video/) di parent folder RAW/REVISED/etc.
    //     sehingga file yang di-upload tidak ter-organisir per petugas.
    //
    //     DENGAN INI: petugas pengganti mendapat:
    //       - User subfolder sendiri di setiap parent folder (HS_... role)
    //       - Output subfolder (Foto/, Video/, dll.) sesuai workerOutputs
    //         project (kalau ada — jika tidak, fallback ke user subfolder)
    //       - assignedUsers entry di drive_folders rows sehingga UI filter
    //         tampilkan folder ini untuk petugas pengganti
    //
    //     Logika di-defer karena:
    //       - Drive API calls (1 per parent folder + 1 per output subfolder)
    //         butuh 1-3 detik
    //       - Tidak boleh block response — petugas butuh lihat task cepat
    //       - Kalau gagal (Drive quota, dll), petugas tetap bisa upload ke
    //         parent folder sebagai fallback (UI handle empty getUploadFolders
    //         dengan fallback ke parent yang assignedRoles match)
    deferToBackground((async () => {
      try {
        await setupFoldersForNewPetugas(
          client,
          projectId,
          role,
          assigneeId,
          userRow.name as string,
          canonicalStage,
        )
      } catch (folderErr) {
        console.error('[ADD-TASK] BG setupFoldersForNewPetugas failed:', folderErr)
        // Non-fatal — petugas tetap bisa upload ke parent folder sebagai fallback
      }
    })())

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

// ============================================================================
// setupFoldersForNewPetugas — berikan petugas pengganti akses folder yang
// sama dengan petugas asli (yang ada saat create project).
// ---------------------------------------------------------------------------
// Dipanggil di background (deferToBackground) dari POST handler.
//
// Apa yang dilakukan:
//   1. Fetch project's drive_folders (parent folders yang sudah dibuat saat
//      create project: RAW, REVISED, FINAL, DESAIN, LAINNYA + custom folders).
//   2. Untuk setiap parent folder:
//      a. Buat user subfolder di Google Drive (HS_<userName>_<role>) di
//         dalam parent folder tsb.
//      b. INSERT row baru di drive_folders untuk subfolder ini, dengan
//         assignedUsers = [{userId, userName, download: true, upload: true}]
//         sehingga UI filter tampilkan subfolder ini untuk petugas pengganti.
//      c. Baca project's workerOutputs config untuk petugas ini (kalau ada),
//          buat output subfolders (Foto/, Video/, dll.) di dalam user subfolder.
//   3. Update assignedUsers di parent folder rows untuk include petugas baru
//      dengan download+upload=true (sama seperti saat create project).
//
// KEAMANAN:
//   - Cek duplikat: kalau subfolder sudah ada untuk user+role+parent ini,
//     skip (re-adding petugas yang pernah dihapus).
//   - Drive errors di-catch dan log saja — tidak fail the whole add-task
//     (petugas tetap bisa upload ke parent folder sebagai fallback).
// ============================================================================
async function setupFoldersForNewPetugas(
  client: ReturnType<typeof getLibsql>,
  projectId: string,
  role: string,
  assigneeId: string,
  assigneeName: string,
  _canonicalStage: number,
): Promise<void> {
  // 1. Baca drive settings untuk dapat access token + target
  const settings = await readDriveSettings()
  if (!settings?.driveServiceAccountKey) {
    console.warn('[ADD-TASK] BG setupFolders: Drive tidak dikonfigurasi, skip')
    return
  }
  const target = getDriveTarget(settings)
  if (!target) {
    console.warn('[ADD-TASK] BG setupFolders: Drive target tidak resolve, skip')
    return
  }

  // 2. Fetch parent folder rows (yang di-create saat create project)
  const parentFoldersRes = await client.execute({
    sql: `SELECT id, folderId, name, link, assignedRoles, assignedUsers, parentFolderId
          FROM drive_folders
          WHERE projectId = ? AND parentFolderId IS NULL`,
    args: [bind(projectId)],
  })

  if (parentFoldersRes.rows.length === 0) {
    console.warn('[ADD-TASK] BG setupFolders: no parent folders for project, skip')
    return
  }

  // 3. Fetch workerOutputs untuk project (kalau ada) untuk tau output types
  //    per user. Format: { userId: ['Foto', 'Video', ...], ... }
  const projRes = await client.execute({
    sql: `SELECT workerOutputs, workerCustomOutput FROM projects WHERE id = ?`,
    args: [bind(projectId)],
  })
  let workerOutputs: Record<string, string[]> = {}
  let workerCustomOutput: Record<string, string> = {}
  if (projRes.rows.length > 0) {
    const projRow = projRes.rows[0] as Record<string, unknown>
    workerOutputs = parseJSON(projRow.workerOutputs, {}) as Record<string, string[]>
    workerCustomOutput = parseJSON(projRow.workerCustomOutput, {}) as Record<string, string>
  }

  // 4. Cek apakah petugas ini sudah punya subfolder di parent folder manapun
  //    (re-adding petugas yang pernah dihapus). Kalau sudah ada, skip create
  //    subfolder, hanya pastikan assignedUsers include petugas ini.
  const userSubfolderPattern = `${role.toLowerCase().replace(/\s*&\s*/g, '-')}-${assigneeId}`

  const accessToken = await getCachedAccessToken(settings.driveServiceAccountKey)
  const driveIdForCreate = target.isSharedDrive ? target.rootId : ''

  // 5. Untuk setiap parent folder, buat user subfolder + output subfolders
  for (const row of parentFoldersRes.rows) {
    const r = row as Record<string, unknown>
    const parentDriveFolderId = String(r.folderId) // Google Drive folder ID
    const parentRowId = String(r.id) // DB row id (cuid)
    const parentLogicalFolderId = parentDriveFolderId // used as prefix for subfolder logical IDs
    const existingAssignedUsers = parseJSON(r.assignedUsers, []) as Array<{
      userId: string
      userName: string
      download: boolean
      upload: boolean
    }>
    const existingAssignedRoles = parseJSON(r.assignedRoles, '[]') as string[]

    // 5a. Cek apakah petugas baru sudah ada di assignedUsers parent folder.
    //     Kalau sudah, skip update (idempotent).
    const alreadyAssigned = existingAssignedUsers.some(au => au.userId === assigneeId)

    // 5b. Cek apakah subfolder sudah ada untuk user+role+parent ini di DB
    const existingSubRes = await client.execute({
      sql: `SELECT id FROM drive_folders
            WHERE projectId = ? AND folderId LIKE ?`,
      args: [bind(projectId), bind(`${parentLogicalFolderId}-${userSubfolderPattern}%)`)],
    })
    // Note: LIKE pattern for matching prefix — Drive folder IDs are alphanumeric
    // and may contain dashes. Using LIKE with % at end is safe here.
    const subfolderAlreadyExists = existingSubRes.rows.length > 0

    if (!subfolderAlreadyExists) {
      // 5c. Buat user subfolder di Google Drive
      //     Nama subfolder: <Initials>_<userName>_<roleDisplay>
      //     Contoh: "AH_Ahmad Hidayat_PhotographerVideographerAudio"
      const userInitials = assigneeName
        .split(/\s+/)
        .map(p => p.charAt(0))
        .join('')
        .substring(0, 2)
        .toUpperCase()
      const userSubName = `${userInitials}_${assigneeName.replace(/\s+/g, '_')}_${role.replace(/\s*&\s*/g, '_')}`
      const userSubLogicalId = `${parentLogicalFolderId}-${userSubfolderPattern}`

      try {
        const userSubFolder = await createDriveFolder(accessToken, {
          name: userSubName,
          parentId: parentDriveFolderId,
          sharedDriveId: driveIdForCreate,
        })

        // INSERT row drive_folders untuk user subfolder
        const subRowId = genId()
        await client.execute({
          sql: `INSERT INTO drive_folders
                (id, folderId, name, description, link, assignedRoles,
                 color, bgColor, borderColor, assignedUsers, projectId, parentFolderId)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            subRowId,
            bind(userSubLogicalId), // logical ID, bukan Drive ID (untuk UI filter)
            bind(userSubName),
            bind(`Subfolder ${assigneeName} (${role})`),
            bind(userSubFolder.webViewLink),
            bind(JSON.stringify([role])),
            bind('text-stone-400'),
            bind('bg-stone-50/50'),
            bind('border-stone-100'),
            bind(JSON.stringify([{
              userId: assigneeId,
              userName: assigneeName,
              download: true,
              upload: true,
            }])),
            bind(projectId),
            bind(parentLogicalFolderId), // parent reference
          ],
        })

        // 5d. Buat output subfolders (Foto/, Video/, dst.) di dalam user subfolder
        //     sesuai workerOutputs untuk user ini
        const outputs = workerOutputs[assigneeId] || []
        for (let i = 0; i < outputs.length; i++) {
          const outputType = outputs[i]
          const outputName = outputType === 'Lainnya' && workerCustomOutput[assigneeId]
            ? workerCustomOutput[assigneeId]
            : outputType
          if (!outputName) continue

          try {
            const outputFolder = await createDriveFolder(accessToken, {
              name: outputName,
              parentId: userSubFolder.id,
              sharedDriveId: driveIdForCreate,
            })

            const outputSubRowId = genId()
            const outputSubLogicalId = `${userSubLogicalId}-output-${i}`
            await client.execute({
              sql: `INSERT INTO drive_folders
                    (id, folderId, name, description, link, assignedRoles,
                     color, bgColor, borderColor, assignedUsers, projectId, parentFolderId)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              args: [
                outputSubRowId,
                bind(outputSubLogicalId),
                bind(outputName),
                bind(`Output - ${assigneeName}`),
                bind(outputFolder.webViewLink),
                bind(JSON.stringify([role])),
                bind('text-stone-400'),
                bind('bg-stone-50/50'),
                bind('border-stone-100'),
                bind(JSON.stringify([{
                  userId: assigneeId,
                  userName: assigneeName,
                  download: true,
                  upload: true,
                }])),
                bind(projectId),
                bind(userSubLogicalId),
              ],
            })
          } catch (outputErr) {
            console.error(`[ADD-TASK] BG create output subfolder "${outputName}" failed:`, outputErr)
            // Non-fatal — continue with next output
          }
        }
      } catch (subErr) {
        console.error(`[ADD-TASK] BG create user subfolder for parent "${parentLogicalFolderId}" failed:`, subErr)
        // Non-fatal — continue with next parent folder
      }
    }

    // 5e. Update assignedUsers di parent folder untuk include petugas baru
    //     (kalau belum ada) — supaya UI filter getDownloadFolders() tampilkan
    //     parent folder ini untuk petugas pengganti juga.
    if (!alreadyAssigned) {
      const updatedAssignedUsers = [
        ...existingAssignedUsers,
        { userId: assigneeId, userName: assigneeName, download: true, upload: true },
      ]
      try {
        await client.execute({
          sql: `UPDATE drive_folders SET assignedUsers = ? WHERE id = ?`,
          args: [bind(JSON.stringify(updatedAssignedUsers)), bind(parentRowId)],
        })
      } catch (updateErr) {
        console.error(`[ADD-TASK] BG update parent assignedUsers failed:`, updateErr)
        // Non-fatal
      }
    }
  }

  // 6. Invalidate cache /api/projects supaya next fetch bawa folder baru
  await invalidateCache('/api/projects')
}

