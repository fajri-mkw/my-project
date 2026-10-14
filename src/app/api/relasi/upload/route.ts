import { NextRequest, NextResponse } from 'next/server'
import { getLibsql, bind, nowMs, genId } from '@/lib/libsql-client'

// ============================================================================
// POST /api/relasi/upload — upload file contoh untuk form Relasi
//
// Menerima: multipart/form-data dengan field:
//   - file: File (PDF, DOCX, XLSX, JPG, PNG, dll — max 20MB)
//   - formId: string (ID form atau "new" jika form belum disimpan)
//   - isExample: string ('true' untuk file contoh)
//
// Menyimpan file ke filesystem (local dev) atau return URL untuk download.
// File disimpan di folder upload/relasi/{formId}/{fileId}_{filename}
// ============================================================================

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB
const ALLOWED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.ms-excel',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'text/plain',
  'application/zip',
]

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

    // Validate file type (allow if extension is common even if MIME is unknown)
    const ext = file.name.split('.').pop()?.toLowerCase() || ''
    const allowedExtensions = ['pdf', 'docx', 'xlsx', 'doc', 'xls', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'txt', 'zip', 'json', 'csv', 'mp4', 'mp3', 'mov']
    if (!ALLOWED_TYPES.includes(file.type) && !allowedExtensions.includes(ext)) {
      return NextResponse.json({ success: false, error: 'Tipe file tidak didukung' }, { status: 400 })
    }

    // Generate file ID and path
    const fileId = genId()
    const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const uploadDir = `/home/z/my-project/upload/relasi/${formId}`

    // Create directory if needed (Node.js fs)
    const fs = await import('fs/promises')
    await fs.mkdir(uploadDir, { recursive: true })

    // Save file to filesystem
    const filePath = `${uploadDir}/${fileId}_${safeFileName}`
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    await fs.writeFile(filePath, buffer)

    // Build download URL (relative path for the app to serve)
    const downloadUrl = `/api/relasi/download?fileId=${fileId}&formId=${formId}&name=${encodeURIComponent(safeFileName)}`

    console.log('[RELASI UPLOAD] File saved:', {
      fileId,
      name: safeFileName,
      size: file.size,
      formId,
      isExample,
    })

    return NextResponse.json({
      success: true,
      fileId,
      name: safeFileName,
      url: downloadUrl,
      size: file.size,
    })
  } catch (error) {
    console.error('[RELASI UPLOAD] Error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Gagal upload' },
      { status: 500 }
    )
  }
}
