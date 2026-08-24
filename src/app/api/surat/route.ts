import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'
import { invalidateCache, deferToBackground } from '@/lib/edge-cache'
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
// ============================================================================
// EDGE CACHE REMOVED (2026-08-15):
// The GET handler was previously wrapped in `withEdgeCache({ ttl: 30 })`. This
// caused a critical data-consistency bug: after a user created/updated/deleted a
// surat (POST/PUT/DELETE), the edge cache was NOT invalidated (Cloudflare's
// Cache API cannot delete param-ized keys by wildcard). The result was that the
// "Tutup" button on the success modal called `fetchSurat()`, which hit the
// stale 30s cache and returned the OLD list — overwriting the optimistic
// `addSurat` update and making the just-saved surat VANISH from the list.
// Symptom reported by user: "berhasil disimpan oleh administrator, tapi tidak
// tersimpan pada surat masuk."
//
// The surat GET is a single indexed SELECT via libsql (a subrequest that does
// NOT count toward the Workers 10ms CPU limit), so it is fast enough to serve
// uncached. Removing the cache eliminates the entire class of stale-data bugs.
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

/** Map a raw surat row to the Prisma-shaped response object.
 *  Parses documents JSON column (matches original spread + override pattern). */
function mapSurat(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ''),
    nomorSurat: String(row.nomorSurat ?? ''),
    jenisSurat: String(row.jenisSurat ?? ''),
    kategori: String(row.kategori ?? ''),
    tanggalSurat: dateOrNull(row.tanggalSurat),
    pengirim: strOrNull(row.pengirim),
    penerima: strOrNull(row.penerima),
    perihal: String(row.perihal ?? ''),
    deskripsi: strOrNull(row.deskripsi),
    status: String(row.status ?? 'diterima'),
    catatan: strOrNull(row.catatan),
    documents: parseJSON(row.documents, []),
    driveFolderId: strOrNull(row.driveFolderId),
    driveFolderLink: strOrNull(row.driveFolderLink),
    location: strOrNull(row.location),
    executionTime: strOrNull(row.executionTime),
    picName: strOrNull(row.picName),
    picWhatsApp: strOrNull(row.picWhatsApp),
    administratorId: strOrNull(row.administratorId),
    managerId: strOrNull(row.managerId),
    projectId: strOrNull(row.projectId),
    createdAt: toDateISO(row.createdAt),
    updatedAt: toDateISO(row.updatedAt),
  }
}

const SURAT_COLUMNS = `id, nomorSurat, jenisSurat, kategori, tanggalSurat, pengirim, penerima,
  perihal, deskripsi, status, catatan, documents, driveFolderId, driveFolderLink,
  location, executionTime, picName, picWhatsApp, administratorId, managerId, projectId,
  createdAt, updatedAt`

// Auto-generate nomor surat.
// Replaces db.surat.findFirst({ where: { nomorSurat: { startsWith }, createdAt: { gte, lt } }, orderBy: { createdAt: 'desc' } })
// with a direct SELECT.
async function generateNomorSurat(client: ReturnType<typeof getLibsql>, jenisSurat: string): Promise<string> {
  const prefix = jenisSurat === 'Surat Masuk' ? 'SM' : 'SK'
  const year = new Date().getFullYear()
  const startOfYearMs = new Date(`${year}-01-01`).getTime()
  const startOfNextYearMs = new Date(`${year + 1}-01-01`).getTime()

  const res = await client.execute({
    sql: `SELECT nomorSurat FROM surat
          WHERE nomorSurat LIKE ? AND createdAt >= ? AND createdAt < ?
          ORDER BY createdAt DESC
          LIMIT 1`,
    args: [bind(`${prefix}-%`), bind(startOfYearMs), bind(startOfNextYearMs)],
  })

  let nextNumber = 1
  if (res.rows.length > 0) {
    const latestNomor = String((res.rows[0] as Record<string, unknown>).nomorSurat ?? '')
    const match = latestNomor.match(new RegExp(`${prefix}-(\\d+)`))
    if (match) {
      nextNumber = parseInt(match[1], 10) + 1
    }
  }

  return `${prefix}-${String(nextNumber).padStart(3, '0')}/${year}`
}

// GET all surat — NO edge cache (see header comment for rationale).
export async function GET(request: NextRequest) {
  try {
    const client = getLibsql()
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const userRole = searchParams.get('userRole')
    const jenisSurat = searchParams.get('jenisSurat')
    const status = searchParams.get('status')

    // Build WHERE clause dynamically (mirrors original `where: any = {}`).
    const conditions: string[] = []
    const args: InValue[] = []
    if (jenisSurat) {
      conditions.push('jenisSurat = ?')
      args.push(bind(jenisSurat))
    }
    if (status) {
      conditions.push('status = ?')
      args.push(bind(status))
    }

    // Role-based filtering
    if (userRole === 'Admin') {
      // Super Admin sees all
    } else if (userRole === 'Administrator' && userId) {
      conditions.push('administratorId = ?')
      args.push(bind(userId))
    } else if (userRole === 'Manager' && userId) {
      conditions.push('managerId = ?')
      args.push(bind(userId))
    } else {
      return NextResponse.json([])
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    // LIMIT 500 as a defensive measure against D1 row-read quota.
    // The Cloudflare D1 free tier enforces 5M rows read/day from September 1,
    // 2026. Without a LIMIT, a query that returns ALL surat (potentially
    // thousands) would read thousands of rows per call. 500 is well above the
    // current ~67 surat in production, so this doesn't change behavior today
    // but caps row reads if the dataset grows 10x in the future.
    // Surat older than ~6 months should be archived manually if the count
    // approaches 500.
    const result = await client.execute({
      sql: `SELECT ${SURAT_COLUMNS} FROM surat ${whereSql} ORDER BY createdAt DESC LIMIT 500`,
      args,
    })

    const transformed = result.rows.map((r) => mapSurat(r as Record<string, unknown>))
    return NextResponse.json(transformed)
  } catch (error) {
    console.error('Get surat error:', error)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: 'Failed to fetch surat', details: msg, surat: [] }, { status: 500 })
  }
}

// POST create surat
export async function POST(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const client = getLibsql()
    const body = await request.json()
    const {
      jenisSurat, kategori, tanggalSurat, pengirim, penerima,
      perihal, deskripsi, catatan, documents, administratorId,
      location, executionTime, picName, picWhatsApp, nomorSurat: manualNomorSurat,
    } = body

    if (!jenisSurat || !perihal) {
      return NextResponse.json({ error: 'Jenis surat dan perihal wajib diisi' }, { status: 400 })
    }

    // Use manual nomor surat if provided, otherwise auto-generate
    const nomorSurat = manualNomorSurat?.trim() || await generateNomorSurat(client, jenisSurat)
    const id = genId()
    const now = Date.now()
    // Convert tanggalSurat ISO string → epoch-ms (or null). Matches Prisma's `new Date(tanggalSurat)`.
    const tanggalSuratMs = tanggalSurat ? new Date(tanggalSurat).getTime() : null

    try {
      await client.execute({
        sql: `INSERT INTO surat
              (id, nomorSurat, jenisSurat, kategori, tanggalSurat, pengirim, penerima,
               perihal, deskripsi, status, catatan, documents, administratorId,
               location, executionTime, picName, picWhatsApp, createdAt, updatedAt)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'diterima', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          bind(id),
          bind(nomorSurat),
          bind(jenisSurat),
          bind(kategori || 'Lainnya'),
          bind(tanggalSuratMs),
          bind(pengirim || null),
          bind(penerima || null),
          bind(perihal),
          bind(deskripsi || null),
          bind(catatan || null),
          bind(JSON.stringify(documents || [])),
          bind(administratorId || null),
          bind(location || null),
          bind(executionTime || null),
          bind(picName || null),
          bind(picWhatsApp || null),
          bind(now),
          bind(now),
        ],
      })
    } catch (insertError) {
      const msg =
        insertError instanceof Error ? insertError.message : String(insertError)
      // If table doesn't exist, auto-create it (mirrors original Prisma fallback).
      if (msg.includes('surat') && (msg.includes('does not exist') || msg.includes('no such table') || msg.includes('relation') || msg.includes('not found'))) {
        try {
          // Note: TIMESTAMP(3) here mirrors the original DDL — SQLite ignores the precision hint
          // and stores DateTime as INTEGER (epoch-ms) per Prisma convention.
          await client.execute({
            sql: `CREATE TABLE IF NOT EXISTS "surat" (
              "id" TEXT NOT NULL PRIMARY KEY,
              "nomorSurat" TEXT NOT NULL,
              "jenisSurat" TEXT NOT NULL,
              "kategori" TEXT NOT NULL,
              "tanggalSurat" INTEGER,
              "pengirim" TEXT,
              "penerima" TEXT,
              "perihal" TEXT NOT NULL,
              "deskripsi" TEXT,
              "status" TEXT NOT NULL DEFAULT 'diterima',
              "catatan" TEXT,
              "documents" TEXT DEFAULT '[]',
              "driveFolderId" TEXT,
              "driveFolderLink" TEXT,
              "location" TEXT,
              "executionTime" TEXT,
              "picName" TEXT,
              "picWhatsApp" TEXT,
              "administratorId" TEXT,
              "managerId" TEXT,
              "projectId" TEXT,
              "createdAt" INTEGER NOT NULL,
              "updatedAt" INTEGER NOT NULL
            )`,
            args: [],
          })
          console.log('[SURAT] Auto-created surat table')
          return NextResponse.json({ error: 'Tabel surat baru saja dibuat otomatis. Silakan coba lagi.' }, { status: 503 })
        } catch (setupError) {
          console.error('[SURAT] Failed to auto-create table:', setupError)
        }
      }
      throw insertError
    }

    // Return surat — Google Drive folder is created only when documents are uploaded
    const result = {
      id,
      nomorSurat,
      jenisSurat,
      kategori: kategori || 'Lainnya',
      tanggalSurat: tanggalSuratMs === null ? null : toDateISO(tanggalSuratMs),
      pengirim: pengirim || null,
      penerima: penerima || null,
      perihal,
      deskripsi: deskripsi || null,
      status: 'diterima',
      catatan: catatan || null,
      documents: documents || [],
      driveFolderId: null,
      driveFolderLink: null,
      location: location || null,
      executionTime: executionTime || null,
      picName: picName || null,
      picWhatsApp: picWhatsApp || null,
      administratorId: administratorId || null,
      managerId: null,
      projectId: null,
      createdAt: toDateISO(now),
      updatedAt: toDateISO(now),
    }

    // Defense-in-depth: bust any residual edge cache for this endpoint.
    // (GET is no longer cached, but this protects against future re-enablement.)
    deferToBackground(invalidateCache('/api/surat'))

    return NextResponse.json(result)
  } catch (error) {
    console.error('Create surat error:', error)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: 'Failed to create surat', details: msg }, { status: 500 })
  }
}

// PUT update surat
export async function PUT(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const client = getLibsql()
    const body = await request.json()
    const { id, ...updateData } = body

    if (!id) {
      return NextResponse.json({ error: 'Surat ID required' }, { status: 400 })
    }

    // Prepare update payload - serialize documents + convert tanggalSurat to epoch-ms
    // (mirrors original `payload[key] = value` + `payload.tanggalSurat = new Date(payload.tanggalSurat)`).
    const setClauses: string[] = []
    const args: InValue[] = []
    let tanggalSuratProvided = false
    for (const [key, value] of Object.entries(updateData)) {
      let val: unknown = value
      if (key === 'documents') {
        val = JSON.stringify(value)
      } else if (key === 'tanggalSurat') {
        // Mirrors Prisma's `new Date(payload.tanggalSurat)` — only converts if truthy.
        if (val) {
          val = new Date(val as string).getTime()
        } else {
          val = null
        }
        tanggalSuratProvided = true
      }
      setClauses.push(`${key} = ?`)
      args.push(bind(val))
    }
    setClauses.push('updatedAt = ?')
    const now = Date.now()
    args.push(bind(now))
    args.push(bind(id))

    await client.execute({
      sql: `UPDATE surat SET ${setClauses.join(', ')} WHERE id = ?`,
      args,
    })

    // Fetch the updated row (mirrors Prisma's `update` returning the object).
    const updatedRes = await client.execute({
      sql: `SELECT ${SURAT_COLUMNS} FROM surat WHERE id = ? LIMIT 1`,
      args: [bind(id)],
    })
    if (updatedRes.rows.length === 0) {
      return NextResponse.json({ error: 'Failed to update surat' }, { status: 500 })
    }
    const updated = mapSurat(updatedRes.rows[0] as Record<string, unknown>)

    // Create notifications for forwarding action (mirrors original logic).
    // Note: `tanggalSuratProvided` is unused but kept for parity with original
    // (the original mutates payload.tanggalSurat). Avoid lint warning by referencing it.
    void tanggalSuratProvided

    try {
      if (updateData.status === 'diteruskan' && updateData.managerId) {
        // Notify the selected manager
        await client.execute({
          sql: `INSERT INTO notifications
                (id, userId, projectId, message, targetView, read, createdAt)
                VALUES (?, ?, NULL, ?, 'inbox', 0, ?)`,
          args: [
            bind(genId()),
            bind(String(updateData.managerId)),
            bind(`Surat masuk "${updated.perihal}" (${updated.nomorSurat}) telah diteruskan kepada Anda`),
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
              bind(`Surat "${updated.perihal}" (${updated.nomorSurat}) telah diteruskan kepada ${managerName || 'Manager'}`),
              bind(Date.now()),
            ],
          })
        }

        // Note: Google Drive folder is only created when documents are uploaded,
        // not during forwarding. This prevents duplicate folder creation.
      }
    } catch (notifErr) {
      console.error('Failed to create surat forwarding notifications:', notifErr)
    }

    // Defense-in-depth: bust any residual edge cache for this endpoint.
    deferToBackground(invalidateCache('/api/surat'))

    return NextResponse.json(updated)
  } catch (error) {
    console.error('Update surat error:', error)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: 'Failed to update surat', details: msg }, { status: 500 })
  }
}

// DELETE surat
export async function DELETE(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const client = getLibsql()
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Surat ID required' }, { status: 400 })
    }

    const existingRes = await client.execute({
      sql: `SELECT id FROM surat WHERE id = ? LIMIT 1`,
      args: [bind(id)],
    })
    if (existingRes.rows.length === 0) {
      return NextResponse.json({ error: 'Surat not found' }, { status: 404 })
    }

    await client.execute({
      sql: `DELETE FROM surat WHERE id = ?`,
      args: [bind(id)],
    })

    // Defense-in-depth: bust any residual edge cache for this endpoint.
    deferToBackground(invalidateCache('/api/surat'))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete surat error:', error)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: 'Failed to delete surat', details: msg }, { status: 500 })
  }
}
