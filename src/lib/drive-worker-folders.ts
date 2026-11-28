// ============================================================================
// setupWorkerDriveFolders — berikan seorang petugas subfolder Google Drive
// (user subfolder + output subfolders + pembagian UMUM/PRIVATE untuk role
// yang berhak) dan entri assignedUsers di parent folder, untuk proyek yang
// SUDAH berjalan.
// ----------------------------------------------------------------------------
//
// KENAPA FILE INI ADA:
// Ketika proyek dibuat, create-user-subfolders membuat subfolder setiap
// petugas. Tapi petugas yang DITAMBAHKAN / DIGANTI di tengah proyek
// (add-task / reassign-task) sebelumnya mengandalkan background job
// (deferToBackground) yang TIDAK reliable di Cloudflare Workers — promise
// bisa terputus setelah response terkirim. Akibatnya 4 petugas di 4 proyek
// (semua photographer tambahan) TIDAK punya folder Drive sama sekali dan
// melihat error "Anda tidak memiliki akses ke folder yang sesuai untuk
// tahapan ini" saat mau upload tugas.
//
// Helper ini dipakai secara SINKRON (await) dari:
//   - POST /api/projects/add-task        (petugas baru di tengah proyek)
//   - PUT  /api/projects/reassign-task   (petugas pengganti)
//   - POST /api/projects/repair-task-folders (perbaiki data lama yang rusak)
//
// STRUKTUR yang dibuat (sama dengan create-user-subfolders):
//   PRODUKSI/raw/  ← parent (folderId logis 'raw', link = folder Drive asli)
//     └── XX_Nama_Petugas_Role/                 ← user subfolder
//         ├── UMUM/   ← hanya role galeri LIHUM (DRIVE_DIVISION_ROLES)
//         │   ├── Foto/  └── Audio/            ← sesuai workerOutputs
//         └── PRIVATE/
//             ├── Foto/  └── Audio/
//
//   Untuk role non-galeri (Reporter, Graphic Designer) ATAU proyek legacy
//   (yang masih punya folder top-level PUBLIC/PRIVATE), output dibuat FLAT
//   langsung di dalam user subfolder.
//
// IDEMPOTENT: subfolder yang sudah ada dilewati (cek LIKE prefix), entri
// assignedUsers yang sudah ada tidak diduplikasi. Aman dipanggil berulang.
//
// Subrequest budget: 1 parent × (1 user sub + 2 divisions + ≤6 output) ≤ 9
// Drive API calls per petugas — jauh di bawah limit 50 Cloudflare Workers.
// ============================================================================

import { readDriveSettings, getDriveTarget } from '@/lib/drive-helpers'
import { getCachedAccessToken, createDriveFolder } from '@/lib/drive-service'
import { invalidateCache } from '@/lib/edge-cache'
import { getLibsql, parseJSON, bind, genId } from '@/lib/libsql-client'
import { FOLDER_ACCESS_DEFAULTS, DRIVE_DIVISIONS, roleGetsDriveDivisions } from '@/lib/store'

export interface WorkerFolderSetupResult {
  ok: boolean
  projectId: string
  userId: string
  userName: string
  role: string
  stage: number
  /** Logical folder IDs yang BARU dibuat (raw-...-userId, -umum, -output-i, dst.) */
  createdLogicalIds: string[]
  /** Parent folder types ('raw', 'revised', ...) yang assignedUsers-nya di-update */
  updatedParentIds: string[]
  /** Parent folder types yang dilewati beserta alasannya */
  skippedParents: string[]
  error?: string
}

/** Kode petugas 2-3 huruf — SAMA dengan generateUserCode di create-user-subfolders. */
function generateUserCode(userName: string): string {
  const parts = userName.trim().split(/\s+/)
  if (parts.length === 0) return 'XX'
  const first = parts[0].substring(0, 2).toUpperCase()
  const last = parts.length > 1 ? parts[parts.length - 1].substring(0, 1).toUpperCase() : ''
  return first + last
}

/** Ambil Drive folder ID asli dari webViewLink (satu-satunya tempat ID asli tersimpan). */
function extractDriveIdFromLink(link: string): string | null {
  const m = link.match(/\/folders\/([a-zA-Z0-9_-]+)/)
  return m ? m[1] : null
}

interface FolderRowInsert {
  projectId: string
  folderId: string
  name: string
  description: string
  link: string
  assignedRoles: string
  color: string
  bgColor: string
  borderColor: string
  assignedUsers: string
  parentFolderId: string
}

async function insertFolderRow(client: ReturnType<typeof getLibsql>, row: FolderRowInsert): Promise<void> {
  await client.execute({
    sql: `INSERT INTO drive_folders
          (id, folderId, name, description, link, assignedRoles, color, bgColor, borderColor, assignedUsers, projectId, parentFolderId)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      genId(),
      bind(row.folderId),
      bind(row.name),
      bind(row.description),
      bind(row.link),
      bind(row.assignedRoles),
      bind(row.color),
      bind(row.bgColor),
      bind(row.borderColor),
      bind(row.assignedUsers),
      bind(row.projectId),
      bind(row.parentFolderId),
    ],
  })
}

export async function setupWorkerDriveFolders(params: {
  projectId: string
  userId: string
  userName: string
  role: string
  stage: number
}): Promise<WorkerFolderSetupResult> {
  const { projectId, userId, userName, role, stage } = params

  const result: WorkerFolderSetupResult = {
    ok: false,
    projectId,
    userId,
    userName,
    role,
    stage,
    createdLogicalIds: [],
    updatedParentIds: [],
    skippedParents: [],
  }

  // ------------------------------------------------------------------
  // 1. Drive settings + access token
  // ------------------------------------------------------------------
  const settings = await readDriveSettings()
  if (!settings?.driveServiceAccountKey) {
    throw new Error('Google Drive belum dikonfigurasi di Pengaturan')
  }
  const target = getDriveTarget(settings)
  if (!target) {
    throw new Error('Drive target tidak dikonfigurasi')
  }
  const accessToken = await getCachedAccessToken(
    settings.driveServiceAccountKey,
    settings.driveMode === 'folder' ? (settings.driveAdminEmail ?? undefined) : undefined,
  )
  const driveIdForCreate = target.isSharedDrive ? target.rootId : ''

  const client = getLibsql()

  // ------------------------------------------------------------------
  // 2. Parent folders proyek (parentFolderId IS NULL → 'raw', 'revised',
  //    'public', 'private', atau folder kustom)
  // ------------------------------------------------------------------
  const parentsRes = await client.execute({
    sql: `SELECT id, folderId, name, link, assignedUsers
          FROM drive_folders
          WHERE projectId = ? AND parentFolderId IS NULL`,
    args: [bind(projectId)],
  })

  if (parentsRes.rows.length === 0) {
    throw new Error('Proyek belum punya folder utama Drive. Gunakan "Buat Ulang Folder Drive" terlebih dahulu.')
  }

  // ------------------------------------------------------------------
  // 3. Deteksi struktur legacy (folder top-level PUBLIC/PRIVATE terpisah).
  //    Proyek legacy → TIDAK membuat pembagian UMUM/PRIVATE di dalam user
  //    subfolder (output dibuat flat), konsisten dengan struktur proyeknya.
  // ------------------------------------------------------------------
  const parentTypes = parentsRes.rows.map(r => String((r as Record<string, unknown>).folderId))
  const isLegacyStructure = parentTypes.includes('public') || parentTypes.includes('private')

  // ------------------------------------------------------------------
  // 4. workerOutputs untuk petugas ini. Kalau petugas ditambahkan di tengah
  //    proyek, dia belum punya konfigurasi output — fallback ke output
  //    petugas LAIN dengan role yang sama di proyek yang sama (pekerjaan
  //    sejenis → kebutuhan folder output yang sama).
  // ------------------------------------------------------------------
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

  let outputs: string[] = workerOutputs[userId] || []
  let customOutputForLainnya: string | undefined = workerCustomOutput[userId]
  let outputsSourceUserId = userId
  if (outputs.length === 0) {
    // Cari petugas lain dengan role sama yang punya output terkonfigurasi
    const sameRoleRes = await client.execute({
      sql: `SELECT DISTINCT assignedTo FROM tasks
            WHERE projectId = ? AND role = ? AND assignedTo IS NOT NULL AND assignedTo != ?`,
      args: [bind(projectId), bind(role), bind(userId)],
    })
    for (const rrow of sameRoleRes.rows) {
      const otherId = String((rrow as Record<string, unknown>).assignedTo)
      const otherOutputs = workerOutputs[otherId] || []
      if (otherOutputs.length > 0) {
        outputs = otherOutputs
        customOutputForLainnya = workerCustomOutput[otherId]
        outputsSourceUserId = otherId
        break
      }
    }
  }

  // ------------------------------------------------------------------
  // 5. Proses setiap parent folder yang petugas ini PUNYA akses upload
  //    (sesuai kebijakan FOLDER_ACCESS_DEFAULTS per tahap).
  // ------------------------------------------------------------------
  const roleSlug = role.toLowerCase().replace(/\s*&\s*/g, '-')
  const userSubPattern = `${roleSlug}-${userId}`
  const userCode = generateUserCode(userName)
  const userSubName = `${userCode}_${userName.replace(/\s+/g, '_')}_${role.replace(/\s*&\s*/g, '_')}`

  const resolveOutputName = (outputType: string) =>
    outputType === 'Lainnya'
      ? (customOutputForLainnya || 'Lainnya')
      : outputType

  for (const row of parentsRes.rows) {
    const r = row as Record<string, unknown>
    const parentType = String(r.folderId)
    const parentRowId = String(r.id)
    const parentLink = String(r.link || '')
    const parentAssignedUsers = parseJSON(r.assignedUsers, []) as Array<{
      userId: string
      userName: string
      download: boolean
      upload: boolean
    }>

    // Hanya parent dengan kebijakan upload untuk tahap petugas ini
    const policy = FOLDER_ACCESS_DEFAULTS[parentType]?.[stage]
    if (!policy || !policy.upload) continue

    // ID folder Drive asli — dari webViewLink parent
    const parentDriveId = extractDriveIdFromLink(parentLink)
    if (!parentDriveId) {
      result.skippedParents.push(`${parentType} (link tidak valid)`)
      continue
    }

    // 5a. Subfolder petugas sudah ada? → idempotent skip
    const existingSubRes = await client.execute({
      sql: `SELECT id FROM drive_folders
            WHERE projectId = ? AND folderId LIKE ?`,
      args: [bind(projectId), bind(`${parentType}-${userSubPattern}%`)],
    })
    const subfolderExists = existingSubRes.rows.length > 0

    if (!subfolderExists) {
      // 5b. Buat user subfolder di Google Drive
      const userSubLogicalId = `${parentType}-${userSubPattern}`
      try {
        const userSub = await createDriveFolder(accessToken, {
          name: userSubName,
          parentId: parentDriveId,
          sharedDriveId: driveIdForCreate,
        })

        await insertFolderRow(client, {
          projectId,
          folderId: userSubLogicalId,
          name: userSubName,
          description: `Subfolder untuk ${userName}`,
          link: userSub.webViewLink,
          assignedRoles: JSON.stringify([role]),
          color: 'text-stone-500',
          bgColor: 'bg-stone-50',
          borderColor: 'border-stone-200',
          assignedUsers: JSON.stringify([{
            userId,
            userName,
            download: policy.download,
            upload: true,
          }]),
          parentFolderId: parentType,
        })
        result.createdLogicalIds.push(userSubLogicalId)

        // 5c. Pembagian UMUM/PRIVATE — hanya untuk role galeri LIHUM
        //     (Photographer, Videographer, Content Creator, Audio) di
        //     folder PRODUKSI proyek struktur baru.
        const useDivisions = parentType === 'raw' && !isLegacyStructure && roleGetsDriveDivisions(role)

        if (useDivisions) {
          for (const division of DRIVE_DIVISIONS) {
            const divisionName = division === 'umum' ? 'UMUM' : 'PRIVATE'
            const isUmum = division === 'umum'
            const divLogicalId = `${userSubLogicalId}-${division}`

            const divFolder = await createDriveFolder(accessToken, {
              name: divisionName,
              parentId: userSub.id,
              sharedDriveId: driveIdForCreate,
            })

            await insertFolderRow(client, {
              projectId,
              folderId: divLogicalId,
              name: divisionName,
              description: isUmum
                ? `Hasil yang boleh dibagikan — ${userName}`
                : `Hasil yang TIDAK boleh dibagikan — ${userName}`,
              link: divFolder.webViewLink,
              assignedRoles: JSON.stringify([role]),
              color: isUmum ? 'text-green-600' : 'text-red-500',
              bgColor: isUmum ? 'bg-green-50' : 'bg-red-50',
              borderColor: isUmum ? 'border-green-200' : 'border-red-200',
              assignedUsers: JSON.stringify([{
                userId,
                userName,
                download: true,
                upload: true,
              }]),
              parentFolderId: userSubLogicalId,
            })
            result.createdLogicalIds.push(divLogicalId)

            // Output subfolders di dalam division
            for (let i = 0; i < outputs.length; i++) {
              const outputName = resolveOutputName(outputs[i])
              if (!outputName) continue
              const outFolder = await createDriveFolder(accessToken, {
                name: outputName,
                parentId: divFolder.id,
                sharedDriveId: driveIdForCreate,
              })
              const outLogicalId = `${divLogicalId}-output-${i}`
              await insertFolderRow(client, {
                projectId,
                folderId: outLogicalId,
                name: outputName,
                description: `Output ${outputName} (${divisionName}) — ${userName}`,
                link: outFolder.webViewLink,
                assignedRoles: JSON.stringify([role]),
                color: isUmum ? 'text-green-500' : 'text-red-400',
                bgColor: isUmum ? 'bg-green-50/50' : 'bg-red-50/50',
                borderColor: isUmum ? 'border-green-100' : 'border-red-100',
                assignedUsers: JSON.stringify([{
                  userId,
                  userName,
                  download: policy.download,
                  upload: true,
                }]),
                parentFolderId: divLogicalId,
              })
              result.createdLogicalIds.push(outLogicalId)
            }
          }
        } else {
          // 5d. FLAT — output langsung di dalam user subfolder
          //     (role non-galeri, folder non-PRODUKSI, atau proyek legacy)
          for (let i = 0; i < outputs.length; i++) {
            const outputName = resolveOutputName(outputs[i])
            if (!outputName) continue
            const outFolder = await createDriveFolder(accessToken, {
              name: outputName,
              parentId: userSub.id,
              sharedDriveId: driveIdForCreate,
            })
            const outLogicalId = `${userSubLogicalId}-output-${i}`
            await insertFolderRow(client, {
              projectId,
              folderId: outLogicalId,
              name: outputName,
              description: `Output ${outputName} — ${userName}`,
              link: outFolder.webViewLink,
              assignedRoles: JSON.stringify([role]),
              color: 'text-stone-400',
              bgColor: 'bg-stone-50/50',
              borderColor: 'border-stone-100',
              assignedUsers: JSON.stringify([{
                userId,
                userName,
                download: policy.download,
                upload: true,
              }]),
              parentFolderId: userSubLogicalId,
            })
            result.createdLogicalIds.push(outLogicalId)
          }
        }
      } catch (subErr) {
        console.error(`[WORKER-FOLDERS] Gagal buat user subfolder di "${parentType}" untuk ${userName}:`, subErr)
        result.skippedParents.push(`${parentType} (error: ${subErr instanceof Error ? subErr.message : 'unknown'})`)
        // Non-fatal — lanjut ke parent berikutnya (entry parent tetap di-update)
      }
    }

    // 5e. Pastikan petugas ada di assignedUsers parent (dengan kebijakan
    //     dl/ul tahapnya) supaya UI filter menampilkan folder ini.
    const alreadyAssigned = parentAssignedUsers.some(au => au.userId === userId)
    if (!alreadyAssigned) {
      const updatedAssignedUsers = [
        ...parentAssignedUsers,
        { userId, userName, download: policy.download, upload: policy.upload },
      ]
      try {
        await client.execute({
          sql: `UPDATE drive_folders SET assignedUsers = ? WHERE id = ?`,
          args: [bind(JSON.stringify(updatedAssignedUsers)), bind(parentRowId)],
        })
        result.updatedParentIds.push(parentType)
      } catch (updateErr) {
        console.error(`[WORKER-FOLDERS] Gagal update assignedUsers parent "${parentType}":`, updateErr)
        result.skippedParents.push(`${parentType} (gagal update akses)`)
      }
    }
  }

  // ------------------------------------------------------------------
  // 6. Invalidate cache supaya GET /api/projects berikutnya bawa folder baru
  // ------------------------------------------------------------------
  await invalidateCache('/api/projects')

  result.ok = true
  return result
}
