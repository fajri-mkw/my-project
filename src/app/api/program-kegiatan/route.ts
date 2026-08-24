import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'
import { withEdgeCache } from '@/lib/edge-cache'
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
//
// COLUMN NAME NOTE: Prisma field `perihal` is mapped to SQLite column
// `namaKegiatan` via `@map("namaKegiatan")`. The response object MUST expose the
// field as `perihal` (matching the Prisma serialization). We therefore alias
// `namaKegiatan AS perihal` in every SELECT.
// ============================================================================

/** Convert a nullable SQLite cell to string | null (matches Prisma String? shape). */
function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null
  return String(v)
}

/** Convert a SQLite epoch-ms (or null) to ISO string | null (matches Prisma DateTime?). */
function dateOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null
  return toDateISO(v)
}

/** Map a raw program_kegiatan row to the Prisma-shaped response object.
 *  Parses documents JSON column (matches original spread + override pattern). */
function mapProgramKegiatan(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ''),
    nomorKegiatan: String(row.nomorKegiatan ?? ''),
    jenisKegiatan: String(row.jenisKegiatan ?? 'Kegiatan'),
    kategori: String(row.kategori ?? 'Umum'),
    tanggalKegiatan: dateOrNull(row.tanggalKegiatan),
    penyelenggara: strOrNull(row.penyelenggara),
    perihal: String(row.perihal ?? ''),
    deskripsi: strOrNull(row.deskripsi),
    status: String(row.status ?? 'direncanakan'),
    catatan: strOrNull(row.catatan),
    documents: parseJSON(row.documents, []),
    driveFolderId: strOrNull(row.driveFolderId),
    driveFolderLink: strOrNull(row.driveFolderLink),
    location: strOrNull(row.location),
    executionTime: strOrNull(row.executionTime),
    picName: strOrNull(row.picName),
    picWhatsApp: strOrNull(row.picWhatsApp),
    managerId: strOrNull(row.managerId),
    projectId: strOrNull(row.projectId),
    createdAt: toDateISO(row.createdAt),
    updatedAt: toDateISO(row.updatedAt),
  }
}

// `namaKegiatan AS perihal` — see COLUMN NAME NOTE above.
const KEGIATAN_COLUMNS = `id, nomorKegiatan, jenisKegiatan, kategori, tanggalKegiatan,
  penyelenggara, namaKegiatan AS perihal, deskripsi, status, catatan, documents,
  driveFolderId, driveFolderLink, location, executionTime, picName, picWhatsApp,
  managerId, projectId, createdAt, updatedAt`

// Auto-generate nomor kegiatan: KG-001/2025
// Replaces db.programKegiatan.findFirst({ where: { nomorKegiatan: { startsWith }, createdAt: { gte, lt } }, orderBy: { createdAt: 'desc' } }).
async function generateNomorKegiatan(client: ReturnType<typeof getLibsql>): Promise<string> {
  const prefix = 'KG'
  const year = new Date().getFullYear()
  const startOfYearMs = new Date(`${year}-01-01`).getTime()
  const startOfNextYearMs = new Date(`${year + 1}-01-01`).getTime()

  const res = await client.execute({
    sql: `SELECT nomorKegiatan FROM program_kegiatan
          WHERE nomorKegiatan LIKE ? AND createdAt >= ? AND createdAt < ?
          ORDER BY createdAt DESC
          LIMIT 1`,
    args: [bind(`${prefix}-%`), bind(startOfYearMs), bind(startOfNextYearMs)],
  })

  let nextNumber = 1
  if (res.rows.length > 0) {
    const latestNomor = String((res.rows[0] as Record<string, unknown>).nomorKegiatan ?? '')
    const match = latestNomor.match(new RegExp(`${prefix}-(\\d+)`))
    if (match) {
      nextNumber = parseInt(match[1], 10) + 1
    }
  }

  return `${prefix}-${String(nextNumber).padStart(3, '0')}/${year}`
}

// GET all program kegiatan (edge-cached 30s)
export const GET = withEdgeCache(async (request: NextRequest) => {
  try {
    const client = getLibsql()
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const userRole = searchParams.get('userRole')
    const status = searchParams.get('status')

    // Build WHERE clause dynamically (mirrors original `where: any = {}`).
    const conditions: string[] = []
    const args: InValue[] = []
    if (status) {
      conditions.push('status = ?')
      args.push(bind(status))
    }

    // Role-based filtering
    if (userRole === 'Admin') {
      // Super Admin sees all
    } else if (userRole === 'Manager' && userId) {
      conditions.push('managerId = ?')
      args.push(bind(userId))
    } else {
      return NextResponse.json([])
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const result = await client.execute({
      sql: `SELECT ${KEGIATAN_COLUMNS} FROM program_kegiatan ${whereSql} ORDER BY createdAt DESC`,
      args,
    })

    const transformed = result.rows.map((r) => mapProgramKegiatan(r as Record<string, unknown>))
    return NextResponse.json(transformed)
  } catch (error) {
    console.error('Get program kegiatan error:', error)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: 'Failed to fetch program kegiatan', details: msg, programKegiatan: [] }, { status: 500 })
  }
}, { ttl: 60 })

// POST create program kegiatan
export async function POST(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const client = getLibsql()
    const body = await request.json()
    // Verbose body logging only in dev — on Cloudflare Workers free plan,
    // console.log of large bodies wastes CPU and can push the request past
    // the 10ms limit (the exact cause of the "Terjadi kesalahan koneksi" bug).
    if (process.env.NODE_ENV === 'development') {
      console.log('[KEGIATAN POST] Body received:', JSON.stringify(body, null, 2))
    }
    const {
      tanggalKegiatan, perihal, deskripsi, documents, managerId,
    } = body

    if (!perihal) {
      return NextResponse.json({ error: 'Nama kegiatan wajib diisi' }, { status: 400 })
    }

    // Auto-generate nomor kegiatan
    const nomorKegiatan = await generateNomorKegiatan(client)
    const id = genId()
    const now = Date.now()
    const tanggalKegiatanMs = tanggalKegiatan ? new Date(tanggalKegiatan).getTime() : null

    await client.execute({
      sql: `INSERT INTO program_kegiatan
            (id, nomorKegiatan, jenisKegiatan, kategori, tanggalKegiatan,
             penyelenggara, namaKegiatan, deskripsi, status, catatan,
             documents, driveFolderId, driveFolderLink, location, executionTime,
             picName, picWhatsApp, managerId, projectId, createdAt, updatedAt)
            VALUES (?, ?, 'Kegiatan', 'Umum', ?, NULL, ?, ?, 'direncanakan', NULL,
                    ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, NULL, ?, ?)`,
      args: [
        bind(id),
        bind(nomorKegiatan),
        bind(tanggalKegiatanMs),
        bind(perihal),
        bind(deskripsi || null),
        bind(JSON.stringify(documents || [])),
        bind(managerId || null),
        bind(now),
        bind(now),
      ],
    })

    const result = {
      id,
      nomorKegiatan,
      jenisKegiatan: 'Kegiatan',
      kategori: 'Umum',
      tanggalKegiatan: tanggalKegiatanMs === null ? null : toDateISO(tanggalKegiatanMs),
      penyelenggara: null,
      perihal,
      deskripsi: deskripsi || null,
      status: 'direncanakan',
      catatan: null,
      documents: documents || [],
      driveFolderId: null,
      driveFolderLink: null,
      location: null,
      executionTime: null,
      picName: null,
      picWhatsApp: null,
      managerId: managerId || null,
      projectId: null,
      createdAt: toDateISO(now),
      updatedAt: toDateISO(now),
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Create program kegiatan error:', error)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    const stack = error instanceof Error ? error.stack : ''
    console.error('[KEGIATAN POST] Error details:', msg, stack)
    return NextResponse.json({ error: 'Failed to create program kegiatan', details: msg }, { status: 500 })
  }
}

// PUT update program kegiatan
export async function PUT(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const client = getLibsql()
    const body = await request.json()
    const { id, ...updateData } = body

    if (!id) {
      return NextResponse.json({ error: 'Kegiatan ID required' }, { status: 400 })
    }

    // Prepare update payload - serialize documents + convert tanggalKegiatan to epoch-ms.
    // NOTE: if the body sends `perihal`, we must write it to the `namaKegiatan` column
    // (the @map'd column name). All other keys map 1:1 to column names.
    const setClauses: string[] = []
    const args: InValue[] = []
    for (const [key, value] of Object.entries(updateData)) {
      let val: unknown = value
      let colName = key
      if (key === 'documents') {
        val = JSON.stringify(value)
      } else if (key === 'tanggalKegiatan') {
        if (val) {
          val = new Date(val as string).getTime()
        } else {
          val = null
        }
      } else if (key === 'perihal') {
        // Prisma field `perihal` maps to SQLite column `namaKegiatan`.
        colName = 'namaKegiatan'
      }
      setClauses.push(`${colName} = ?`)
      args.push(bind(val))
    }
    setClauses.push('updatedAt = ?')
    const now = Date.now()
    args.push(bind(now))
    args.push(bind(id))

    await client.execute({
      sql: `UPDATE program_kegiatan SET ${setClauses.join(', ')} WHERE id = ?`,
      args,
    })

    // Fetch the updated row (mirrors Prisma's `update` returning the object).
    const updatedRes = await client.execute({
      sql: `SELECT ${KEGIATAN_COLUMNS} FROM program_kegiatan WHERE id = ? LIMIT 1`,
      args: [bind(id)],
    })
    if (updatedRes.rows.length === 0) {
      return NextResponse.json({ error: 'Failed to update program kegiatan' }, { status: 500 })
    }
    const updated = mapProgramKegiatan(updatedRes.rows[0] as Record<string, unknown>)

    return NextResponse.json(updated)
  } catch (error) {
    console.error('Update program kegiatan error:', error)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: 'Failed to update program kegiatan', details: msg }, { status: 500 })
  }
}

// DELETE program kegiatan
export async function DELETE(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const client = getLibsql()
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Kegiatan ID required' }, { status: 400 })
    }

    const existingRes = await client.execute({
      sql: `SELECT id FROM program_kegiatan WHERE id = ? LIMIT 1`,
      args: [bind(id)],
    })
    if (existingRes.rows.length === 0) {
      return NextResponse.json({ error: 'Kegiatan not found' }, { status: 404 })
    }

    await client.execute({
      sql: `DELETE FROM program_kegiatan WHERE id = ?`,
      args: [bind(id)],
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete program kegiatan error:', error)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: 'Failed to delete program kegiatan', details: msg }, { status: 500 })
  }
}
