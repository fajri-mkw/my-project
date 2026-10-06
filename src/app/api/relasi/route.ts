import { NextRequest, NextResponse } from 'next/server'
import { withEdgeCache, invalidateCache, deferToBackground } from '@/lib/edge-cache'
import { getLibsql, bind, nowMs, genId } from '@/lib/libsql-client'

// GET /api/relasi — list semua form (Admin only, cached 30s)
export const GET = withEdgeCache(async (request: NextRequest) => {
  const userRole = request.headers.get('X-User-Role')
  if (userRole !== 'Admin') {
    return NextResponse.json({ error: 'Hanya Super Admin' }, { status: 403 })
  }
  try {
    const client = getLibsql()
    const res = await client.execute({
      sql: `SELECT id, title, description, fields, publicToken, driveFolderId, status,
            exampleFileId, exampleFileName, exampleFileUrl, createdAt, updatedAt
            FROM relasi_forms ORDER BY createdAt DESC`,
      args: [],
    })
    const forms = res.rows.map(r => {
      const row = r as Record<string, unknown>
      const token = row.publicToken != null ? String(row.publicToken) : null
      return {
        id: String(row.id),
        title: String(row.title || ''),
        description: String(row.description || ''),
        fields: JSON.parse(String(row.fields || '[]')),
        publicToken: token,
        driveFolderId: row.driveFolderId != null ? String(row.driveFolderId) : null,
        status: String(row.status || 'active'),
        createdAt: Number(row.createdAt || 0),
        updatedAt: Number(row.updatedAt || 0),
        exampleFileId: row.exampleFileId != null ? String(row.exampleFileId) : null,
        exampleFileName: row.exampleFileName != null ? String(row.exampleFileName) : null,
        exampleFileUrl: row.exampleFileUrl != null ? String(row.exampleFileUrl) : null,
        // URL halaman publik (bukan API) — ?relasi=TOKEN
        publicUrl: token ? `/?relasi=${token}` : null,
      }
    })
    return NextResponse.json(forms)
  } catch (error) {
    console.error('[RELASI GET] Error:', error)
    return NextResponse.json([])
  }
}, { ttl: 30 })

// POST /api/relasi — buat form baru (Admin only)
export async function POST(request: NextRequest) {
  const userRole = request.headers.get('X-User-Role')
  const userId = request.headers.get('X-User-Id')
  if (userRole !== 'Admin') {
    return NextResponse.json({ error: 'Hanya Super Admin' }, { status: 403 })
  }
  try {
    const body = await request.json()
    const { title, description, fields, exampleFileId, exampleFileName, exampleFileUrl } = body as {
      title?: string
      description?: string
      fields?: Array<Record<string, unknown>>
      exampleFileId?: string | null
      exampleFileName?: string | null
      exampleFileUrl?: string | null
    }

    if (!title) return NextResponse.json({ error: 'title wajib diisi' }, { status: 400 })

    const id = genId()
    const token = `relasi-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const ts = nowMs()

    const client = getLibsql()
    await client.execute({
      sql: `INSERT INTO relasi_forms (id, title, description, fields, publicToken, status, createdBy,
            exampleFileId, exampleFileName, exampleFileUrl, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
      args: [
        bind(id), bind(title), bind(description || ''),
        bind(JSON.stringify(fields || [])),
        bind(token), bind(userId || ''),
        bind(exampleFileId || null), bind(exampleFileName || null), bind(exampleFileUrl || null),
        bind(ts), bind(ts),
      ],
    })

    return NextResponse.json({
      success: true,
      id,
      publicToken: token,
      publicUrl: `/?relasi=${token}`,
      message: 'Form berhasil dibuat. Bagikan link publik ke pengunjung.',
    })
    deferToBackground(invalidateCache('/api/relasi'))
  } catch (error) {
    console.error('[RELASI POST] Error:', error)
    return NextResponse.json({ error: 'Gagal membuat form' }, { status: 500 })
  }
}

// PUT /api/relasi?id=XXX — update form (Admin only)
export async function PUT(request: NextRequest) {
  const userRole = request.headers.get('X-User-Role')
  if (userRole !== 'Admin') {
    return NextResponse.json({ error: 'Hanya Super Admin' }, { status: 403 })
  }
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id wajib diisi' }, { status: 400 })

    const body = await request.json()
    const { title, description, fields, status, exampleFileId, exampleFileName, exampleFileUrl } = body as Record<string, unknown>

    const updates: string[] = []
    const args: unknown[] = []

    if (title !== undefined) { updates.push('"title" = ?'); args.push(bind(String(title))) }
    if (description !== undefined) { updates.push('"description" = ?'); args.push(bind(String(description))) }
    if (fields !== undefined) { updates.push('"fields" = ?'); args.push(bind(JSON.stringify(fields))) }
    if (status !== undefined) { updates.push('"status" = ?'); args.push(bind(String(status))) }
    if (exampleFileId !== undefined) { updates.push('"exampleFileId" = ?'); args.push(bind(exampleFileId as string | null)) }
    if (exampleFileName !== undefined) { updates.push('"exampleFileName" = ?'); args.push(bind(exampleFileName as string | null)) }
    if (exampleFileUrl !== undefined) { updates.push('"exampleFileUrl" = ?'); args.push(bind(exampleFileUrl as string | null)) }

    if (updates.length === 0) return NextResponse.json({ success: true, message: 'Tidak ada perubahan' })

    updates.push('"updatedAt" = ?')
    args.push(bind(nowMs()))
    args.push(bind(id))

    const client = getLibsql()
    await client.execute({
      sql: `UPDATE relasi_forms SET ${updates.join(', ')} WHERE id = ?`,
      args,
    })

    deferToBackground(invalidateCache('/api/relasi'))
    return NextResponse.json({ success: true, message: 'Form berhasil diupdate' })
  } catch (error) {
    console.error('[RELASI PUT] Error:', error)
    return NextResponse.json({ error: 'Gagal update form' }, { status: 500 })
  }
}

// DELETE /api/relasi?id=XXX — hapus form (Admin only)
export async function DELETE(request: NextRequest) {
  const userRole = request.headers.get('X-User-Role')
  if (userRole !== 'Admin') {
    return NextResponse.json({ error: 'Hanya Super Admin' }, { status: 403 })
  }
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id wajib diisi' }, { status: 400 })

    const client = getLibsql()
    // Hapus submissions dulu, lalu form
    await client.execute({ sql: `DELETE FROM relasi_submissions WHERE formId = ?`, args: [bind(id)] })
    await client.execute({ sql: `DELETE FROM relasi_forms WHERE id = ?`, args: [bind(id)] })

    deferToBackground(invalidateCache('/api/relasi'))
    return NextResponse.json({ success: true, message: 'Form dan semua isian berhasil dihapus' })
  } catch (error) {
    console.error('[RELASI DELETE] Error:', error)
    return NextResponse.json({ error: 'Gagal hapus form' }, { status: 500 })
  }
}
