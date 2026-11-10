import { NextRequest, NextResponse } from 'next/server'
import { getLibsql, bind, genId, nowMs } from '@/lib/libsql-client'

// ============================================================================
// POST /api/relasi/upload — upload file kecil (foto, file contoh) dari form Relasi.
//
// File disimpan:
//   - Cloudflare Workers: di D1 tabel `relasi_files` sebagai base64
//     (Batas Workers: ~5MB per request. FOTO maks 5MB, file contoh maks 5MB.)
//   - Local dev: di filesystem `/home/z/my-project/upload/relasi/{formId}/`
//     (maks 20MB — filesystem tidak punya batas 5MB D1).
//
// Untuk VIDEO (file besar), frontend menggunakan path chunked Google Drive
// (chunkedUploadFile) secara langsung — lihat relasi-public-view.tsx.
// Endpoint ini HANYA untuk file kecil (foto + file contoh).
//
// Response: { success, fileId, name, url }
//   - fileId: ID di relasi_files (untuk download via /api/relasi/download)
//   - url: URL download relatif (?fileId=...&formId=...&name=...)
// ============================================================================

// 5 MB — batas aman untuk D1 base64 storage di Cloudflare Workers.
const MAX_FILE_SIZE_WORKERS = 5 * 1024 * 1024
// 20 MB — batas filesystem local dev (tidak ada batas D1).
const MAX_FILE_SIZE_LOCAL = 20 * 1024 * 1024

// Content types yang diperbolehkan untuk upload via endpoint ini (file kecil).
// Video TIDAK termasuk — video menggunakan path Google Drive.
const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'application/zip',
])

function isCloudflareWorkers(): boolean {
  return (
    typeof (globalThis as unknown as { caches?: unknown }).caches !== 'undefined' &&
    process.env.CF_PAGES === undefined
  )
}

export async function POST(request: NextRequest) {
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Request tidak valid (FormData diperlukan)' }, { status: 400 })
  }
  try {
    const file = formData.get('file') as File | null
    const formId = (formData.get('formId') as string) || 'new'
    const isExample = formData.get('isExample') === 'true'

    if (!file) {
      return NextResponse.json({ error: 'File wajib diisi' }, { status: 400 })
    }

    // Validasi tipe file — tolak video di endpoint ini (video via Drive)
    const contentType = file.type || 'application/octet-stream'
    if (contentType.startsWith('video/')) {
      return NextResponse.json(
        { error: 'Video harus diupload melalui jalur Google Drive. Hubungi admin.' },
        { status: 400 },
      )
    }
    if (!ALLOWED_TYPES.has(contentType)) {
      return NextResponse.json(
        { error: `Tipe file tidak didukung: ${contentType}` },
        { status: 400 },
      )
    }

    // Validasi ukuran
    const onWorkers = isCloudflareWorkers()
    const maxSize = onWorkers ? MAX_FILE_SIZE_WORKERS : MAX_FILE_SIZE_LOCAL
    if (file.size > maxSize) {
      const maxMB = Math.round(maxSize / (1024 * 1024))
      return NextResponse.json(
        { error: `Ukuran file melebihi batas ${maxMB}MB` },
        { status: 400 },
      )
    }

    const fileId = genId()
    const ts = nowMs()

    if (onWorkers) {
      // === Workers: simpan base64 di D1 ===
      const arrayBuffer = await file.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      const base64Data = buffer.toString('base64')

      const client = getLibsql()
      await client.execute({
        sql: `INSERT INTO relasi_files (id, formId, fileName, contentType, fileData, fileSize, createdAt)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          bind(fileId),
          bind(formId),
          bind(file.name),
          bind(contentType),
          bind(base64Data),
          bind(file.size),
          bind(ts),
        ],
      })
    } else {
      // === Local dev: simpan di filesystem ===
      const fs = await import('fs/promises')
      const path = await import('path')
      const dir = `/home/z/my-project/upload/relasi/${formId}`
      await fs.mkdir(dir, { recursive: true })
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const filePath = path.join(dir, `${fileId}_${safeName}`)
      const arrayBuffer = await file.arrayBuffer()
      await fs.writeFile(filePath, Buffer.from(arrayBuffer))
    }

    // URL download relatif — /api/relasi/download?fileId=...&formId=...&name=...
    const url = `/api/relasi/download?fileId=${encodeURIComponent(fileId)}&formId=${encodeURIComponent(formId)}&name=${encodeURIComponent(file.name)}`

    return NextResponse.json({
      success: true,
      fileId,
      name: file.name,
      url,
      isExample,
    })
  } catch (error) {
    console.error('[RELASI UPLOAD] Error:', error)
    return NextResponse.json(
      { error: 'Gagal upload file' },
      { status: 500 },
    )
  }
}
