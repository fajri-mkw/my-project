import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { invalidateCache, deferToBackground } from '@/lib/edge-cache'

interface DocumentMeta {
  id: string
  name: string
  originalName?: string
  mimeType: string
  size: number
  driveFileId: string
  webViewLink: string
  downloadUrl: string
  uploadedAt: string
}

/**
 * POST /api/surat/register-document
 *
 * Registers an already-uploaded document's metadata to a surat record.
 * This is used AFTER the chunked resumable upload completes (via
 * /api/drive/upload-url + /api/drive/upload-chunk).
 *
 * Body: { suratId: string, document: DocumentMeta }
 * Returns: { success: true, document: DocumentMeta }
 *
 * PERFORMANCE: Lightweight — NO checkMaintenanceMode, NO ensureDbConnection
 * (schema sync). The surat was just created/updated in the same request flow,
 * so the schema is guaranteed current. Only 2 DB round trips to stay within
 * Cloudflare Workers' free-plan CPU limit.
 */
export async function POST(request: NextRequest) {
  try {
    const { suratId, document } = await request.json()

    if (!suratId || !document) {
      return NextResponse.json({ error: 'suratId dan document wajib diisi' }, { status: 400 })
    }

    if (!document.driveFileId || !document.name) {
      return NextResponse.json({ error: 'Document metadata tidak lengkap (driveFileId, name wajib)' }, { status: 400 })
    }

    const surat = await db.surat.findUnique({ where: { id: suratId } })
    if (!surat) {
      return NextResponse.json({ error: 'Surat tidak ditemukan' }, { status: 404 })
    }

    const docMeta: DocumentMeta = {
      id: document.id || `DOC-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: document.name,
      originalName: document.originalName,
      mimeType: document.mimeType || 'application/octet-stream',
      size: document.size || 0,
      driveFileId: document.driveFileId,
      webViewLink: document.webViewLink || `https://drive.google.com/file/d/${document.driveFileId}/view`,
      downloadUrl: document.downloadUrl || `https://drive.google.com/uc?export=download&id=${document.driveFileId}`,
      uploadedAt: document.uploadedAt || new Date().toISOString(),
    }

    const existingDocs: DocumentMeta[] = JSON.parse(surat.documents || '[]')
    existingDocs.push(docMeta)

    await db.surat.update({
      where: { id: suratId },
      data: { documents: JSON.stringify(existingDocs) },
    })

    // Defense-in-depth: bust any residual edge cache for the surat list endpoint.
    deferToBackground(invalidateCache('/api/surat'))

    return NextResponse.json({
      success: true,
      document: docMeta,
    })
  } catch (error) {
    console.error('[SURAT REGISTER] Error:', error)
    return NextResponse.json(
      { error: 'Gagal mendaftarkan dokumen: ' + (error instanceof Error ? error.message : 'Unknown error') },
      { status: 500 }
    )
  }
}
