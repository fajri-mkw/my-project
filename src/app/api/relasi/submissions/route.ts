import { NextRequest, NextResponse } from 'next/server'
import { getLibsql, bind } from '@/lib/libsql-client'

// GET /api/relasi/submissions?formId=XXX — list submissions (Admin only)
export async function GET(request: NextRequest) {
  const userRole = request.headers.get('X-User-Role')
  if (userRole !== 'Admin') {
    return NextResponse.json({ error: 'Hanya Super Admin' }, { status: 403 })
  }
  try {
    const { searchParams } = new URL(request.url)
    const formId = searchParams.get('formId')
    if (!formId) return NextResponse.json({ error: 'formId wajib diisi' }, { status: 400 })

    const client = getLibsql()
    const res = await client.execute({
      sql: `SELECT id, formId, data, uploadedFiles, submitterName, submitterEmail, status, createdAt
            FROM relasi_submissions WHERE formId = ? ORDER BY createdAt DESC`,
      args: [bind(formId)],
    })

    const submissions = res.rows.map(r => {
      const row = r as Record<string, unknown>
      return {
        id: String(row.id),
        formId: String(row.formId),
        data: JSON.parse(String(row.data || '{}')),
        uploadedFiles: JSON.parse(String(row.uploadedFiles || '[]')),
        submitterName: row.submitterName != null ? String(row.submitterName) : null,
        submitterEmail: row.submitterEmail != null ? String(row.submitterEmail) : null,
        status: String(row.status || 'new'),
        createdAt: Number(row.createdAt || 0),
      }
    })

    return NextResponse.json(submissions)
  } catch (error) {
    console.error('[RELASI SUBMISSIONS GET] Error:', error)
    return NextResponse.json([])
  }
}

// PUT /api/relasi/submissions?id=XXX — update submission status (Admin only)
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
    const { status } = body as { status?: string }
    if (!status || !['new', 'reviewed', 'published', 'rejected'].includes(status)) {
      return NextResponse.json({ error: 'status tidak valid' }, { status: 400 })
    }

    const client = getLibsql()
    await client.execute({
      sql: `UPDATE relasi_submissions SET status = ? WHERE id = ?`,
      args: [bind(status), bind(id)],
    })

    return NextResponse.json({ success: true, message: 'Status submission diupdate' })
  } catch (error) {
    console.error('[RELASI SUBMISSIONS PUT] Error:', error)
    return NextResponse.json({ error: 'Gagal update status' }, { status: 500 })
  }
}
