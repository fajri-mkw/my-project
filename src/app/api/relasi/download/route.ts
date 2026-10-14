import { NextRequest, NextResponse } from 'next/server'

// ============================================================================
// GET /api/relasi/download — download file contoh dari form Relasi
//
// Query params:
//   - fileId: string
//   - formId: string
//   - name: string (filename)
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

    // Sanitize filename
    const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const filePath = `/home/z/my-project/upload/relasi/${formId}/${fileId}_${safeName}`

    const fs = await import('fs/promises')
    try {
      const buffer = await fs.readFile(filePath)
      
      // Determine content type from extension
      const ext = safeName.split('.').pop()?.toLowerCase() || ''
      const contentTypes: Record<string, string> = {
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
  } catch (error) {
    console.error('[RELASI DOWNLOAD] Error:', error)
    return NextResponse.json({ error: 'Gagal download' }, { status: 500 })
  }
}
