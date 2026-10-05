import { NextRequest, NextResponse } from 'next/server'
import { getLibsql, bind, nowMs, genId } from '@/lib/libsql-client'

// GET /api/relasi/public?token=XXX — ambil form untuk publik (tanpa login)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const token = searchParams.get('token')
    if (!token) return NextResponse.json({ error: 'Token tidak ditemukan' }, { status: 400 })

    const client = getLibsql()
    const res = await client.execute({
      sql: `SELECT id, title, description, fields, status FROM relasi_forms WHERE publicToken = ? LIMIT 1`,
      args: [bind(token)],
    })

    if (res.rows.length === 0) {
      return NextResponse.json({ error: 'Form tidak ditemukan atau link tidak valid' }, { status: 404 })
    }

    const row = res.rows[0] as Record<string, unknown>
    const status = String(row.status || 'active')

    if (status !== 'active') {
      return NextResponse.json({ error: 'Form ini sudah ditutup. Hubungi pengelola.' }, { status: 410 })
    }

    return NextResponse.json({
      id: String(row.id),
      title: String(row.title || ''),
      description: String(row.description || ''),
      fields: JSON.parse(String(row.fields || '[]')),
    })
  } catch (error) {
    console.error('[RELASI PUBLIC GET] Error:', error)
    return NextResponse.json({ error: 'Gagal memuat form' }, { status: 500 })
  }
}

// POST /api/relasi/public — submit form dari publik (tanpa login)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { formId, data, uploadedFiles, submitterName, submitterEmail } = body as {
      formId?: string
      data?: Record<string, unknown>
      uploadedFiles?: Array<{ name: string; fileId: string; url: string }>
      submitterName?: string
      submitterEmail?: string
    }

    if (!formId) return NextResponse.json({ error: 'formId wajib diisi' }, { status: 400 })
    if (!data) return NextResponse.json({ error: 'data wajib diisi' }, { status: 400 })

    const client = getLibsql()

    // Cek form exists dan active
    const formRes = await client.execute({
      sql: `SELECT id, status FROM relasi_forms WHERE id = ? LIMIT 1`,
      args: [bind(formId)],
    })
    if (formRes.rows.length === 0) {
      return NextResponse.json({ error: 'Form tidak ditemukan' }, { status: 404 })
    }
    const formRow = formRes.rows[0] as Record<string, unknown>
    if (String(formRow.status) !== 'active') {
      return NextResponse.json({ error: 'Form sudah ditutup' }, { status: 410 })
    }

    // Rate limit: max 10 submission per IP per jam
    const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown'
    const oneHourAgo = nowMs() - 3600000
    const countRes = await client.execute({
      sql: `SELECT COUNT(*) as cnt FROM relasi_submissions WHERE ipAddress = ? AND createdAt > ?`,
      args: [bind(ip), bind(oneHourAgo)],
    })
    const count = Number((countRes.rows[0] as Record<string, unknown>).cnt || 0)
    if (count >= 10) {
      return NextResponse.json({ error: 'Batas pengiriman tercapai. Coba lagi dalam 1 jam.' }, { status: 429 })
    }

    // Simpan submission
    const id = genId()
    const ts = nowMs()
    await client.execute({
      sql: `INSERT INTO relasi_submissions (id, formId, data, uploadedFiles, submitterName, submitterEmail, status, ipAddress, createdAt)
            VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?)`,
      args: [
        bind(id), bind(formId),
        bind(JSON.stringify(data)),
        bind(JSON.stringify(uploadedFiles || [])),
        bind(submitterName || null),
        bind(submitterEmail || null),
        bind(ip),
        bind(ts),
      ],
    })

    return NextResponse.json({
      success: true,
      ticketId: id,
      message: 'Terima kasih! Isian Anda berhasil dikirim. Pengelola akan meninjau.',
    })
  } catch (error) {
    console.error('[RELASI PUBLIC POST] Error:', error)
    return NextResponse.json({ error: 'Gagal mengirim isian' }, { status: 500 })
  }
}
