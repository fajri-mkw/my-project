import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'
import {
  getLibsql,
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

/** Convert a nullable SQLite cell to string | null (matches Prisma String? shape). */
function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null
  return String(v)
}

/** Map a raw permohonan row to the Prisma-shaped response object.
 *  Parses activityTypes/outputNeeds/documents JSON columns (matches the spread +
 *  override pattern in the original Prisma route). */
function mapPermohonan(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ''),
    title: String(row.title ?? ''),
    description: String(row.description ?? ''),
    requesterUnit: String(row.requesterUnit ?? ''),
    location: strOrNull(row.location),
    executionTime: strOrNull(row.executionTime),
    picName: strOrNull(row.picName),
    picWhatsApp: strOrNull(row.picWhatsApp),
    activityTypes: parseJSON(row.activityTypes, []),
    customActivity: strOrNull(row.customActivity),
    outputNeeds: parseJSON(row.outputNeeds, []),
    customOutput: strOrNull(row.customOutput),
    status: String(row.status ?? 'pending'),
    adminNote: strOrNull(row.adminNote),
    documents: parseJSON(row.documents, []),
    administratorId: strOrNull(row.administratorId),
    managerId: strOrNull(row.managerId),
    projectId: strOrNull(row.projectId),
    createdAt: toDateISO(row.createdAt),
    updatedAt: toDateISO(row.updatedAt),
  }
}

const PERMOHONAN_COLUMNS = `id, title, description, requesterUnit, location, executionTime,
  picName, picWhatsApp, activityTypes, customActivity, outputNeeds, customOutput,
  status, adminNote, documents, administratorId, managerId, projectId,
  createdAt, updatedAt`

// GET all permohonan
export async function GET(request: NextRequest) {
  try {
    const client = getLibsql()
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const userRole = searchParams.get('userRole')

    let result
    if (userRole === 'Admin' || userRole === 'Administrator') {
      // Super Admin / Administrator sees all
      result = await client.execute({
        sql: `SELECT ${PERMOHONAN_COLUMNS} FROM permohonan ORDER BY createdAt DESC`,
        args: [],
      })
    } else if (userRole === 'Manager' && userId) {
      // Manager sees only permohonan forwarded to them
      result = await client.execute({
        sql: `SELECT ${PERMOHONAN_COLUMNS} FROM permohonan WHERE managerId = ? ORDER BY createdAt DESC`,
        args: [bind(userId)],
      })
    } else {
      return NextResponse.json([])
    }

    const transformed = result.rows.map((r) =>
      mapPermohonan(r as Record<string, unknown>),
    )
    return NextResponse.json(transformed)
  } catch (error) {
    console.error('Get permohonan error:', error)
    return NextResponse.json({ error: 'Failed to fetch permohonan', permohonan: [] }, { status: 500 })
  }
}

// POST create permohonan
export async function POST(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const client = getLibsql()
    const body = await request.json()
    const {
      title, description, requesterUnit, location, executionTime,
      picName, picWhatsApp, activityTypes, customActivity, outputNeeds,
      customOutput, adminNote, documents, administratorId,
    } = body

    const id = genId()
    const now = Date.now()

    await client.execute({
      sql: `INSERT INTO permohonan
            (id, title, description, requesterUnit, location, executionTime,
             picName, picWhatsApp, activityTypes, customActivity, outputNeeds,
             customOutput, status, adminNote, documents, administratorId,
             createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
      args: [
        bind(id),
        bind(title),
        bind(description),
        bind(requesterUnit),
        bind(location || null),
        bind(executionTime || null),
        bind(picName || null),
        bind(picWhatsApp || null),
        bind(JSON.stringify(activityTypes || [])),
        bind(customActivity || null),
        bind(JSON.stringify(outputNeeds || [])),
        bind(customOutput || null),
        bind(adminNote || null),
        bind(JSON.stringify(documents || [])),
        bind(administratorId || null),
        bind(now),
        bind(now),
      ],
    })

    // Notify all Manager users (replaces db.user.findMany + db.notification.create loop).
    if (administratorId) {
      try {
        const managersRes = await client.execute({
          sql: `SELECT id FROM users WHERE role = 'Manager'`,
          args: [],
        })
        if (managersRes.rows.length > 0) {
          const notifMessage = `Permohonan baru dari Administrator: ${title}`
          const placeholders = managersRes.rows.map(() => '(?, ?, NULL, ?, 0, ?)').join(', ')
          const flatArgs: InValue[] = []
          const notifTs = Date.now()
          for (const m of managersRes.rows) {
            const managerId = String((m as Record<string, unknown>).id ?? '')
            flatArgs.push(
              bind(genId()),
              bind(managerId),
              bind(notifMessage),
              bind('dashboard'),
              bind(notifTs),
            )
          }
          await client.execute({
            sql: `INSERT INTO notifications
                  (id, userId, projectId, message, read, targetView, createdAt)
                  VALUES ${placeholders}`,
            args: flatArgs,
          })
        }
      } catch (notifErr) {
        console.error('Failed to create permohonan notifications:', notifErr)
      }
    }

    // Return the new row in the same shape as the original Prisma response.
    const result = {
      id,
      title,
      description,
      requesterUnit,
      location: location || null,
      executionTime: executionTime || null,
      picName: picName || null,
      picWhatsApp: picWhatsApp || null,
      activityTypes: activityTypes || [],
      customActivity: customActivity || null,
      outputNeeds: outputNeeds || [],
      customOutput: customOutput || null,
      status: 'pending',
      adminNote: adminNote || null,
      documents: documents || [],
      administratorId: administratorId || null,
      managerId: null,
      projectId: null,
      createdAt: toDateISO(now),
      updatedAt: toDateISO(now),
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Create permohonan error:', error)
    return NextResponse.json({ error: 'Failed to create permohonan' }, { status: 500 })
  }
}

// PUT update permohonan
export async function PUT(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const client = getLibsql()
    const body = await request.json()
    const { id, ...updateData } = body

    if (!id) {
      return NextResponse.json({ error: 'Permohonan ID required' }, { status: 400 })
    }

    // Prepare update payload - serialize arrays (mirrors original logic).
    const setClauses: string[] = []
    const args: InValue[] = []
    for (const [key, value] of Object.entries(updateData)) {
      let val: unknown = value
      if (key === 'activityTypes' || key === 'outputNeeds' || key === 'documents') {
        val = JSON.stringify(value)
      }
      setClauses.push(`${key} = ?`)
      args.push(bind(val))
    }
    setClauses.push('updatedAt = ?')
    const now = Date.now()
    args.push(bind(now))
    args.push(bind(id))

    await client.execute({
      sql: `UPDATE permohonan SET ${setClauses.join(', ')} WHERE id = ?`,
      args,
    })

    // Fetch the updated row (mirrors Prisma's `update` returning the object).
    const updatedRes = await client.execute({
      sql: `SELECT ${PERMOHONAN_COLUMNS} FROM permohonan WHERE id = ? LIMIT 1`,
      args: [bind(id)],
    })
    if (updatedRes.rows.length === 0) {
      return NextResponse.json({ error: 'Failed to update permohonan' }, { status: 500 })
    }
    const updated = mapPermohonan(updatedRes.rows[0] as Record<string, unknown>)

    // Create notifications for specific status transitions
    // (mirrors original Prisma notification.create calls — same messages, same targets).
    try {
      if (updateData.status === 'forwarded' && updateData.managerId) {
        // Notify the selected manager
        await client.execute({
          sql: `INSERT INTO notifications
                (id, userId, projectId, message, targetView, read, createdAt)
                VALUES (?, ?, NULL, ?, 'dashboard', 0, ?)`,
          args: [
            bind(genId()),
            bind(String(updateData.managerId)),
            bind(`Permohonan '${updated.title}' telah diteruskan kepada Anda`),
            bind(Date.now()),
          ],
        })

        // Notify administrator that it was forwarded
        if (updated.administratorId) {
          const managerRes = await client.execute({
            sql: `SELECT name FROM users WHERE id = ? LIMIT 1`,
            args: [bind(String(updateData.managerId))],
          })
          const managerName =
            managerRes.rows.length > 0
              ? String((managerRes.rows[0] as Record<string, unknown>).name ?? '')
              : ''
          await client.execute({
            sql: `INSERT INTO notifications
                  (id, userId, projectId, message, targetView, read, createdAt)
                  VALUES (?, ?, NULL, ?, 'permohonan', 0, ?)`,
            args: [
              bind(genId()),
              bind(updated.administratorId),
              bind(`Permohonan '${updated.title}' telah diteruskan kepada ${managerName || 'Manager'}`),
              bind(Date.now()),
            ],
          })
        }
      }

      if (updateData.status === 'rejected') {
        if (updated.administratorId) {
          const managerRes = await client.execute({
            sql: `SELECT name FROM users WHERE id = ? LIMIT 1`,
            args: [bind(String(updateData.managerId ?? ''))],
          })
          const managerName =
            managerRes.rows.length > 0
              ? String((managerRes.rows[0] as Record<string, unknown>).name ?? '')
              : ''
          const reasonText = updateData.adminNote ? `. Alasan: ${updateData.adminNote}` : ''
          await client.execute({
            sql: `INSERT INTO notifications
                  (id, userId, projectId, message, targetView, read, createdAt)
                  VALUES (?, ?, NULL, ?, 'permohonan', 0, ?)`,
            args: [
              bind(genId()),
              bind(updated.administratorId),
              bind(`Permohonan '${updated.title}' telah ditolak oleh ${managerName || 'Manager'}${reasonText}`),
              bind(Date.now()),
            ],
          })
        }
      }

      if (updateData.status === 'completed' && updateData.projectId && updateData.managerId) {
        if (updated.administratorId) {
          await client.execute({
            sql: `INSERT INTO notifications
                  (id, userId, projectId, message, targetView, read, createdAt)
                  VALUES (?, ?, ?, ?, 'project_detail', 0, ?)`,
            args: [
              bind(genId()),
              bind(updated.administratorId),
              bind(String(updateData.projectId)),
              bind(`Permohonan '${updated.title}' telah diterima. Proyek telah dibuat.`),
              bind(Date.now()),
            ],
          })
        }
      }
    } catch (notifErr) {
      console.error('Failed to create permohonan status notifications:', notifErr)
    }

    return NextResponse.json(updated)
  } catch (error) {
    console.error('Update permohonan error:', error)
    return NextResponse.json({ error: 'Failed to update permohonan' }, { status: 500 })
  }
}

// DELETE permohonan
export async function DELETE(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const client = getLibsql()
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Permohonan ID required' }, { status: 400 })
    }

    // Allow deleting pending (by Admin) or forwarded (by Manager from inbox) permohonan
    const existingRes = await client.execute({
      sql: `SELECT status, projectId FROM permohonan WHERE id = ? LIMIT 1`,
      args: [bind(id)],
    })
    if (existingRes.rows.length === 0) {
      return NextResponse.json({ error: 'Permohonan not found' }, { status: 404 })
    }
    const existingRow = existingRes.rows[0] as Record<string, unknown>
    const existingStatus = String(existingRow.status ?? '')
    if (existingStatus !== 'pending' && existingStatus !== 'forwarded') {
      return NextResponse.json(
        { error: 'Hanya permohonan dengan status pending atau forwarded yang dapat dihapus' },
        { status: 400 },
      )
    }

    // If the permohonan already has an associated project, clean it up too so the
    // manager is not left with an orphaned project containing bad data.
    const deletedProjectId =
      existingRow.projectId === null || existingRow.projectId === undefined
        ? null
        : String(existingRow.projectId)

    await client.execute({
      sql: `DELETE FROM permohonan WHERE id = ?`,
      args: [bind(id)],
    })
    if (deletedProjectId) {
      try {
        await client.execute({
          sql: `DELETE FROM projects WHERE id = ?`,
          args: [bind(deletedProjectId)],
        })
      } catch {
        // Project may already be gone; ignore
      }
    }
    return NextResponse.json({ success: true, deletedProjectId })
  } catch (error) {
    console.error('Delete permohonan error:', error)
    return NextResponse.json({ error: 'Failed to delete permohonan' }, { status: 500 })
  }
}
