import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'
import { withEdgeCache, invalidateCache } from '@/lib/edge-cache'
import {
  getLibsql,
  toBool,
  toDateISO,
  bind,
  genId,
  parseJSON,
  type InValue,
} from '@/lib/libsql-client'

// ============================================================================
// CRITICAL: This route is called on every dashboard page load AND polled every
// 30-60s for logged-in users. The previous version imported `db,
// ensureDbConnection` from '@/lib/db' (Prisma), which on Cloudflare Workers
// free plan burns CPU on Prisma module-load + ensureSchemaSync subrequests and
// was a contributing cause of recurring Error 1102.
//
// Rewritten to use @libsql/client directly via @/lib/libsql-client — same pattern
// as src/app/api/maintenance/route.ts and src/app/api/users/route.ts.
// ============================================================================

// --- Row mappers (mirror Prisma's JSON shape exactly) ---

/** Bare SuratTugas row → Prisma-shaped object (read=boolean, createdAt=ISO). */
function mapSuratTugas(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ''),
    nomorSurat: String(row.nomorSurat ?? ''),
    projectId: String(row.projectId ?? ''),
    userId: String(row.userId ?? ''),
    role: String(row.role ?? ''),
    stage: Number(row.stage ?? 0),
    status: String(row.status ?? 'active'),
    read: toBool(row.read),
    createdAt: toDateISO(row.createdAt),
  }
}

/** Full User row → Prisma-shaped user object (matches include: manager / user: true). */
function mapUser(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    email: String(row.email ?? ''),
    password: String(row.password ?? '$2a$10$placeholder'),
    whatsapp: row.whatsapp === null || row.whatsapp === undefined ? null : String(row.whatsapp),
    avatar: row.avatar === null || row.avatar === undefined ? null : String(row.avatar),
    role: String(row.role ?? 'Reporter'),
    notifWaEnabled: toBool(row.notifWaEnabled),
    notifEmailEnabled: toBool(row.notifEmailEnabled),
    autoApproveReview: toBool(row.autoApproveReview),
    createdAt: toDateISO(row.createdAt),
    updatedAt: toDateISO(row.updatedAt),
  }
}

/** Fetch a single user by id, returns null if not found. */
async function fetchUser(client: ReturnType<typeof getLibsql>, id: string) {
  const res = await client.execute({
    sql: `SELECT id, name, email, password, whatsapp, avatar, role,
                 notifWaEnabled, notifEmailEnabled, autoApproveReview,
                 createdAt, updatedAt
          FROM users WHERE id = ? LIMIT 1`,
    args: [bind(id)],
  })
  if (res.rows.length === 0) return null
  return mapUser(res.rows[0] as Record<string, unknown>)
}

/** Fetch the manager + key project fields for a given projectId. */
async function fetchProjectWithManager(client: ReturnType<typeof getLibsql>, projectId: string) {
  const res = await client.execute({
    sql: `SELECT id, title, description, requesterUnit, location, executionTime,
                 picName, picWhatsApp, activityTypes, outputNeeds, managerId
          FROM projects WHERE id = ? LIMIT 1`,
    args: [bind(projectId)],
  })
  if (res.rows.length === 0) return null
  const row = res.rows[0] as Record<string, unknown>
  const managerId = row.managerId === null || row.managerId === undefined ? null : String(row.managerId)
  let manager: ReturnType<typeof mapUser> | null = null
  if (managerId) manager = await fetchUser(client, managerId)
  return { row, manager }
}

// Generate nomor surat: ST/001/I/2025
// Replaces db.suratTugas.count({ where: { createdAt: { gte, lte } } }) with a direct COUNT(*).
async function generateNomorSurat(client: ReturnType<typeof getLibsql>): Promise<string> {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1

  const startOfMonthMs = new Date(year, month - 1, 1).getTime()
  const endOfMonthMs = new Date(year, month, 0).getTime()

  const res = await client.execute({
    sql: `SELECT COUNT(*) AS cnt FROM surat_tugas WHERE createdAt >= ? AND createdAt <= ?`,
    args: [bind(startOfMonthMs), bind(endOfMonthMs)],
  })
  const count = Number((res.rows[0] as Record<string, unknown>).cnt ?? 0)

  const romanMonths = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']
  const sequence = (count + 1).toString().padStart(3, '0')

  return `ST/${sequence}/${romanMonths[month - 1]}/${year}`
}

// GET - Get all surat tugas for a user
// Edge-cached for 30s — per-user (cache key includes userId)
export const GET = withEdgeCache(async (request: NextRequest) => {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const client = getLibsql()
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const suratId = searchParams.get('id')

    // Get single surat tugas by ID
    if (suratId) {
      const res = await client.execute({
        sql: `SELECT id, nomorSurat, projectId, userId, role, stage, status, read, createdAt
              FROM surat_tugas
              WHERE id = ?
              LIMIT 1`,
        args: [bind(suratId)],
      })
      if (res.rows.length === 0) {
        return NextResponse.json({ error: 'Surat tugas not found' }, { status: 404 })
      }
      const suratRow = res.rows[0] as Record<string, unknown>
      const projectId = String(suratRow.projectId ?? '')

      const projData = await fetchProjectWithManager(client, projectId)
      const user = await fetchUser(client, String(suratRow.userId ?? ''))

      // The original response shape (preserved exactly):
      // { id, nomorSurat, projectId, userId, role, stage, status, read, createdAt,
      //   project: { id, title, description, requesterUnit, location, executionTime,
      //              picName, picWhatsApp, activityTypes, outputNeeds, manager },
      //   user: { id, name, email, role } }
      const projRow = projData?.row ?? {}
      return NextResponse.json({
        ...mapSuratTugas(suratRow),
        project: {
          id: String(projRow.id ?? projectId),
          title: String(projRow.title ?? ''),
          description: String(projRow.description ?? ''),
          requesterUnit: String(projRow.requesterUnit ?? ''),
          location: projRow.location === null || projRow.location === undefined ? '' : String(projRow.location),
          executionTime: projRow.executionTime === null || projRow.executionTime === undefined ? '' : String(projRow.executionTime),
          picName: projRow.picName === null || projRow.picName === undefined ? '' : String(projRow.picName),
          picWhatsApp: projRow.picWhatsApp === null || projRow.picWhatsApp === undefined ? '' : String(projRow.picWhatsApp),
          activityTypes: parseJSON(projRow.activityTypes, []),
          outputNeeds: parseJSON(projRow.outputNeeds, []),
          manager: projData?.manager ?? null,
        },
        user: user
          ? { id: user.id, name: user.name, email: user.email, role: user.role }
          : null,
      })
    }

    // Get all surat tugas for user
    if (!userId) {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 })
    }

    const listRes = await client.execute({
      sql: `SELECT id, nomorSurat, projectId, userId, role, stage, status, read, createdAt
            FROM surat_tugas
            WHERE userId = ?
            ORDER BY createdAt DESC`,
      args: [bind(userId)],
    })

    // Fetch manager for each distinct projectId in parallel (avoids N+1 sequential round-trips).
    const distinctProjectIds = Array.from(new Set(
      listRes.rows.map((r) => String((r as Record<string, unknown>).projectId ?? '')),
    )).filter(Boolean)
    const managerByProjectId = new Map<string, Awaited<ReturnType<typeof fetchUser>>>()
    if (distinctProjectIds.length > 0) {
      // Single query: projects + their manager rows joined.
      const placeholders = distinctProjectIds.map(() => '?').join(',')
      const projRes = await client.execute({
        sql: `SELECT p.id AS pid, p.title AS ptitle, p.managerId AS pmid,
                     u.id AS uid, u.name AS uname, u.email AS uemail, u.password AS upassword,
                     u.whatsapp AS uwhatsapp, u.avatar AS uavatar, u.role AS urole,
                     u.notifWaEnabled AS unotifWaEnabled, u.notifEmailEnabled AS unotifEmailEnabled,
                     u.autoApproveReview AS uautoApproveReview,
                     u.createdAt AS ucreatedAt, u.updatedAt AS uupdatedAt
              FROM projects p
              LEFT JOIN users u ON u.id = p.managerId
              WHERE p.id IN (${placeholders})`,
        args: distinctProjectIds.map((id) => bind(id)),
      })
      for (const row of projRes.rows) {
        const r = row as Record<string, unknown>
        const pid = String(r.pid ?? '')
        if (r.uid === null || r.uid === undefined) {
          managerByProjectId.set(pid, null)
        } else {
          managerByProjectId.set(
            pid,
            mapUser({
              id: r.uid, name: r.uname, email: r.uemail, password: r.upassword,
              whatsapp: r.uwhatsapp, avatar: r.uavatar, role: r.urole,
              notifWaEnabled: r.unotifWaEnabled, notifEmailEnabled: r.unotifEmailEnabled,
              autoApproveReview: r.uautoApproveReview, createdAt: r.ucreatedAt, updatedAt: r.uupdatedAt,
            }),
          )
        }
      }
      // Also need project titles — refetch via the same query (we already have pid + ptitle).
      // Build a parallel map for titles.
      const titleByProjectId = new Map<string, string>()
      for (const row of projRes.rows) {
        const r = row as Record<string, unknown>
        titleByProjectId.set(String(r.pid ?? ''), String(r.ptitle ?? ''))
      }
      // Now we have both title and manager. Map over listRes.rows.
      const out = listRes.rows.map((s) => {
        const sr = s as Record<string, unknown>
        const pid = String(sr.projectId ?? '')
        return {
          ...mapSuratTugas(sr),
          project: {
            id: pid,
            title: titleByProjectId.get(pid) ?? '',
            manager: managerByProjectId.get(pid) ?? null,
          },
        }
      })
      return NextResponse.json(out)
    }

    return NextResponse.json(
      listRes.rows.map((s) => {
        const sr = s as Record<string, unknown>
        return {
          ...mapSuratTugas(sr),
          project: { id: String(sr.projectId ?? ''), title: '', manager: null },
        }
      }),
    )
  } catch (error) {
    console.error('Get surat tugas error:', error)
    return NextResponse.json({ error: 'Failed to fetch surat tugas' }, { status: 500 })
  }
}, { ttl: 30 })

// POST - Create new surat tugas
export async function POST(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const client = getLibsql()
    const body = await request.json()
    const { projectId, userId, role, stage } = body

    if (!projectId || !userId || !role || stage === undefined) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Check if surat tugas already exists for this project-user-role combination.
    // Replaces db.suratTugas.findFirst({ where: { projectId, userId, role } }).
    const existingRes = await client.execute({
      sql: `SELECT id, nomorSurat, projectId, userId, role, stage, status, read, createdAt
            FROM surat_tugas
            WHERE projectId = ? AND userId = ? AND role = ?
            LIMIT 1`,
      args: [bind(projectId), bind(userId), bind(role)],
    })
    if (existingRes.rows.length > 0) {
      const existing = mapSuratTugas(existingRes.rows[0] as Record<string, unknown>)
      return NextResponse.json({
        message: 'Surat tugas already exists',
        surat: existing,
      })
    }

    const nomorSurat = await generateNomorSurat(client)
    const id = genId()
    const createdAt = Date.now()

    await client.execute({
      sql: `INSERT INTO surat_tugas
            (id, nomorSurat, projectId, userId, role, stage, status, read, createdAt)
            VALUES (?, ?, ?, ?, ?, ?, 'active', 0, ?)`,
      args: [
        bind(id),
        bind(nomorSurat),
        bind(projectId),
        bind(userId),
        bind(role),
        bind(Number(stage) || 0),
        bind(createdAt),
      ],
    })

    // Create a notification for the assigned user so they see it in the bell.
    // Replaces db.notification.findFirst + create with direct SQL.
    try {
      const projRes = await client.execute({
        sql: `SELECT id, title FROM projects WHERE id = ? LIMIT 1`,
        args: [bind(projectId)],
      })
      if (projRes.rows.length > 0) {
        const projectRow = projRes.rows[0] as Record<string, unknown>
        const projectTitle = String(projectRow.title ?? '')
        const notifMessage = `Tugas baru dialokasikan untuk proyek ${projectTitle}`

        // Only create notification if one doesn't already exist for this assignment.
        // MATCHES: Prisma's `message: { contains: ... }` — SQLite LIKE with no wildcards is the equivalent of contains.
        const existingNotifRes = await client.execute({
          sql: `SELECT id FROM notifications
                WHERE userId = ? AND projectId = ? AND message LIKE ?
                LIMIT 1`,
          args: [bind(userId), bind(projectId), bind(`%${notifMessage}%`)],
        })
        if (existingNotifRes.rows.length === 0) {
          const notifId = genId()
          const notifCreatedAt = Date.now()
          await client.execute({
            sql: `INSERT INTO notifications
                  (id, userId, message, projectId, targetView, read, createdAt)
                  VALUES (?, ?, ?, ?, 'inbox', 0, ?)`,
            args: [
              bind(notifId),
              bind(userId),
              bind(notifMessage),
              bind(projectId),
              bind(notifCreatedAt),
            ],
          })
        }
      }
    } catch (notifErr) {
      console.error('Failed to create surat tugas notification:', notifErr)
    }

    // Invalidate caches — new surat tugas + notification were just created
    await invalidateCache('/api/surat-tugas')
    await invalidateCache('/api/notifications')

    // Fetch the freshly-created row's project+manager to mirror the original include.
    const projData = await fetchProjectWithManager(client, projectId)

    return NextResponse.json({
      id,
      nomorSurat,
      projectId,
      userId,
      role,
      stage: Number(stage) || 0,
      status: 'active',
      read: false,
      createdAt: toDateISO(createdAt),
      project: {
        id: projectId,
        title: projData ? String(projData.row.title ?? '') : '',
        manager: projData?.manager ?? null,
      },
    })
  } catch (error) {
    console.error('Create surat tugas error:', error)
    return NextResponse.json({ error: 'Failed to create surat tugas' }, { status: 500 })
  }
}

// PUT - Update surat tugas (mark as read, update status)
export async function PUT(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const client = getLibsql()
    const body = await request.json()
    const { id, read, status } = body

    if (!id) {
      return NextResponse.json({ error: 'Surat tugas ID required' }, { status: 400 })
    }

    // Build UPDATE SET clause dynamically based on provided fields.
    const setClauses: string[] = []
    const args: InValue[] = []
    if (read !== undefined) {
      setClauses.push('read = ?')
      args.push(bind(read ? 1 : 0))
    }
    if (status !== undefined) {
      setClauses.push('status = ?')
      args.push(bind(String(status)))
    }
    if (setClauses.length === 0) {
      // Nothing to update — just fetch and return the row.
    } else {
      args.push(bind(id))
      await client.execute({
        sql: `UPDATE surat_tugas SET ${setClauses.join(', ')} WHERE id = ?`,
        args,
      })
    }

    // Fetch the (updated) row to mirror Prisma's `update` returning the object.
    const res = await client.execute({
      sql: `SELECT id, nomorSurat, projectId, userId, role, stage, status, read, createdAt
            FROM surat_tugas
            WHERE id = ?
            LIMIT 1`,
      args: [bind(id)],
    })
    if (res.rows.length === 0) {
      // Prisma would throw P2025 here → caught → 500.
      return NextResponse.json({ error: 'Failed to update surat tugas' }, { status: 500 })
    }
    const surat = mapSuratTugas(res.rows[0] as Record<string, unknown>)

    // Invalidate surat-tugas cache so the inbox reflects the new read/status
    await invalidateCache('/api/surat-tugas')

    return NextResponse.json(surat)
  } catch (error) {
    console.error('Update surat tugas error:', error)
    return NextResponse.json({ error: 'Failed to update surat tugas' }, { status: 500 })
  }
}
