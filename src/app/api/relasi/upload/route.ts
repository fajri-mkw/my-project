import { NextRequest, NextResponse } from 'next/server'
import { getLibsql, bind, nowMs, genId } from '@/lib/libsql-client'

// ============================================================================
// POST /api/relasi/upload — upload file contoh untuk form Relasi
//
// Cloudflare Workers tidak punya filesystem (fs.mkdir tidak didukung).
// File disimpan sebagai base64 di tabel relasi_files (D1 database).
// Untuk local dev, file disimpan di filesystem (fs works di Node.js).
//
// Menerima: multipart/form-data dengan field:
//   - file: File (PDF, DOCX, XLSX, JPG, PNG, dll — max 20MB)
//   - formId: string (ID form atau "new" jika form belum disimpan)
//   - isExample: string ('true' untuk file contoh)
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
    doc: 'application/msword',
    xls: 'application/vnd.ms-excel',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    txt: 'text/plain',
    zip: 'application/zip',
    json: 'application/json',
    csv: 'text/csv',
    mp4: 'video/mp4',
    mp3: 'audio/mpeg',
    mov: 'video/quicktime',
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

    // Cek apakah di Cloudflare Workers (tidak ada fs) atau local dev
    const isCloudflareWorkers = typeof (globalThis as any).caches !== 'undefined' && typeof process.env.CF_PAGES === 'undefined'

    if (isCloudflareWorkers) {
      // Workers: simpan file di D1 sebagai base64 (untuk file kecil <= 5MB)
      if (file.size > MAX_DB_FILE_SIZE) {
        return NextResponse.json({
          success: false,
          error: 'File terlalu besar untuk upload di Cloudflare Workers free plan (maks 5MB). Gunakan Google Drive link sebagai alternatif.'
        }, { status: 400 })
      }

      const base64Data = buffer.toString('base64')
      const client = getLibsql()

      // Buat tabel relasi_files jika belum ada
      try {
        await client.execute({
          sql: `CREATE TABLE IF NOT EXISTS relasi_files (
            id TEXT PRIMARY KEY,
            formId TEXT,
            fileName TEXT,
            contentType TEXT,
            fileData TEXT,
            fileSize INTEGER,
            createdAt INTEGER
          )`,
          args: [],
        })
      } catch (e) {
        // Tabel mungkin sudah ada
      }

      // Simpan file ke D1
      await client.execute({
        sql: `INSERT INTO relasi_files (id, formId, fileName, contentType, fileData, fileSize, createdAt)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          bind(fileId), bind(formId), bind(safeFileName),
          bind(contentType), bind(base64Data), bind(file.size), bind(nowMs())
        ],
      })

      const downloadUrl = `/api/relasi/download?fileId=${fileId}&formId=${formId}&name=${encodeURIComponent(safeFileName)}`

      console.log('[RELASI UPLOAD] File saved to D1:', { fileId, name: safeFileName, size: file.size })

      return NextResponse.json({
        success: true,
        fileId,
        name: safeFileName,
        url: downloadUrl,
        size: file.size,
      })
    } else {
      // Local dev (Node.js): simpan ke filesystem
      const fs = await import('fs/promises')
      const uploadDir = `/home/z/my-project/upload/relasi/${formId}`
      await fs.mkdir(uploadDir, { recursive: true })

      const filePath = `${uploadDir}/${fileId}_${safeFileName}`
      await fs.writeFile(filePath, buffer)

      const downloadUrl = `/api/relasi/download?fileId=${fileId}&formId=${formId}&name=${encodeURIComponent(safeFileName)}`

      console.log('[RELASI UPLOAD] File saved to filesystem:', { fileId, name: safeFileName, size: file.size })

      return NextResponse.json({
        success: true,
        fileId,
        name: safeFileName,
        url: downloadUrl,
        size: file.size,
      })
    }
  } catch (error) {
    console.error('[RELASI UPLOAD] Error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Gagal upload' },
      { status: 500 }
    )
  }
}
