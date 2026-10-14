import { NextRequest, NextResponse } from 'next/server'
import { getLibsql, bind } from '@/lib/libsql-client'

// ============================================================================
// GET /api/relasi/download — download file contoh dari form Relasi
//
// Mendukung dua mode:
// - Cloudflare Workers: file disimpan di D1 sebagai base64
// - Local dev: file disimpan di filesystem
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const fileId = searchParams.get('fileId')
    const formId = searchParams.get('formId') || 'new'
    const name = searchParams.get('name') || 'file'

    if (!fileId) {
      return NextResponse.json({ error: 'fileId required' }, { status: 400 })
    }

    const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const isCloudflareWorkers = typeof (globalThis as any).caches !== 'undefined' && typeof process.env.CF_PAGES === 'undefined'

    if (isCloudflareWorkers) {
      // Workers: ambil file dari D1
      const client = getLibsql()
      try {
        const res = await client.execute({
          sql: `SELECT fileName, contentType, fileData, fileSize FROM relasi_files WHERE id = ? LIMIT 1`,
          args: [bind(fileId)],
        })
        if (res.rows.length === 0) {
          return NextResponse.json({ error: 'File tidak ditemukan' }, { status: 404 })
        }
        const row = res.rows[0] as Record<string, unknown>
        const fileName = String(row.fileName || safeName)
        const contentType = String(row.contentType || 'application/octet-stream')
        const base64Data = String(row.fileData || '')
        const fileSize = Number(row.fileSize || 0)

        if (!base64Data) {
          return NextResponse.json({ error: 'File data kosong' }, { status: 404 })
        }

        // Convert base64 ke buffer
        const buffer = Buffer.from(base64Data, 'base64')

        return new NextResponse(buffer, {
          headers: {
            'Content-Type': contentType,
            'Content-Disposition': `attachment; filename="${fileName}"`,
            'Cache-Control': 'public, max-age=86400',
          },
        })
      } catch (dbErr) {
        console.error('[RELASI DOWNLOAD] D1 error:', dbErr)
        return NextResponse.json({ error: 'Gagal mengambil file dari database' }, { status: 500 })
      }
    } else {
      // Local dev: ambil dari filesystem
      const fs = await import('fs/promises')
      const filePath = `/home/z/my-project/upload/relasi/${formId}/${fileId}_${safeName}`
      try {
        const buffer = await fs.readFile(filePath)
        const ext = safeName.split('.').pop()?.toLowerCase() || ''
        const contentTypes: Record<string, string> = {
          pdf: 'application/pdf',
          docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          png: 'image/png',
          gif: 'image/gif',
          txt: 'text/plain',
          zip: 'application/zip',
        }
        const contentType = contentTypes[ext] || 'application/octet-stream'

        return new NextResponse(buffer, {
          headers: {
            'Content-Type': contentType,
            'Content-Disposition': `attachment; filename="${safeName}"`,
            'Cache-Control': 'public, max-age=86400',
          },
        })
      } catch {
        return NextResponse.json({ error: 'File tidak ditemukan' }, { status: 404 })
      }
    }
  } catch (error) {
    console.error('[RELASI DOWNLOAD] Error:', error)
    return NextResponse.json({ error: 'Gagal download' }, { status: 500 })
  }
}
