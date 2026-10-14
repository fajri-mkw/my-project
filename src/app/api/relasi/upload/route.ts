import { NextRequest, NextResponse } from 'next/server'
import { getLibsql, bind, nowMs, genId } from '@/lib/libsql-client'

// ============================================================================
// POST /api/relasi/upload — upload file contoh untuk form Relasi
//
// Cloudflare Workers tidak punya filesystem (fs.mkdir tidak didukung).
// File disimpan sebagai base64 di tabel relasi_files (D1 database).
// Untuk local dev, file disimpan di filesystem (fs works di Node.js).
// ============================================================================

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB
const MAX_DB_FILE_SIZE = 5 * 1024 * 1024 // 5MB untuk DB storage (base64)

const ALLOWED_EXTENSIONS = [
  'pdf', 'docx', 'xlsx', 'doc', 'xls',
  'jpg', 'jpeg', 'png', 'gif', 'webp',
  'txt', 'zip', 'json', 'csv', 'mp4', 'mp3', 'mov'
]

function getContentType(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  const types: Record<string, string> = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    txt: 'text/plain',
  }
  return types[ext] || 'application/octet-stream'
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const formId = (formData.get('formId') as string) || 'new'
    const isExample = formData.get('isExample') === 'true'

    if (!file) {
      return NextResponse.json({ success: false, error: 'File tidak ditemukan' }, { status: 400 })
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ success: false, error: 'Maksimal 20MB' }, { status: 400 })
    }

    const ext = file.name.split('.').pop()?.toLowerCase() || ''
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return NextResponse.json({ success: false, error: 'Tipe file tidak didukung' }, { status: 400 })
    }

    const fileId = genId()
    const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const contentType = getContentType(file.name)
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Detect Cloudflare Workers (no fs) vs local dev
    const isCloudflareWorkers = typeof (globalThis as any).caches !== 'undefined'

    if (isCloudflareWorkers) {
      if (file.size > MAX_DB_FILE_SIZE) {
        return NextResponse.json({
          success: false,
          error: 'File terlalu besar untuk Cloudflare Workers (maks 5MB)'
        }, { status: 400 })
      }

      const base64Data = buffer.toString('base64')
      const client = getLibsql()

      try {
        await client.execute({
          sql: `CREATE TABLE IF NOT EXISTS relasi_files (
            id TEXT PRIMARY KEY, formId TEXT, fileName TEXT,
            contentType TEXT, fileData TEXT, fileSize INTEGER, createdAt INTEGER
          )`,
          args: [],
        })
      } catch {}

      await client.execute({
        sql: `INSERT INTO relasi_files (id, formId, fileName, contentType, fileData, fileSize, createdAt)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [bind(fileId), bind(formId), bind(safeFileName),
               bind(contentType), bind(base64Data), bind(file.size), bind(nowMs())],
      })

      const downloadUrl = `/api/relasi/download?fileId=${fileId}&formId=${formId}&name=${encodeURIComponent(safeFileName)}`
      return NextResponse.json({ success: true, fileId, name: safeFileName, url: downloadUrl, size: file.size })
    } else {
      const fs = await import('fs/promises')
      const uploadDir = `/home/z/my-project/upload/relasi/${formId}`
      await fs.mkdir(uploadDir, { recursive: true })
      await fs.writeFile(`${uploadDir}/${fileId}_${safeFileName}`, buffer)
      const downloadUrl = `/api/relasi/download?fileId=${fileId}&formId=${formId}&name=${encodeURIComponent(safeFileName)}`
      return NextResponse.json({ success: true, fileId, name: safeFileName, url: downloadUrl, size: file.size })
    }
  } catch (error) {
    console.error('[RELASI UPLOAD] Error:', error)
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Gagal upload' }, { status: 500 })
  }
}
