import { db, ensureDbConnection } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'

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
 * This replaces the metadata-saving portion of the old
 * /api/surat/upload-document route (which also handled the file upload itself,
 * loading the entire file into memory).
 *
 * Body: { suratId: string, document: DocumentMeta }
 * Returns: { success: true, document: DocumentMeta, surat: ... }
 */
export async function POST(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    await ensureDbConnection()
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

    // Build document metadata (ensure all fields are present)
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

    // Append to existing documents
    const existingDocs: DocumentMeta[] = JSON.parse(surat.documents || '[]')
    existingDocs.push(docMeta)

    await db.surat.update({
      where: { id: suratId },
      data: { documents: JSON.stringify(existingDocs) },
    })

    console.log(`[SURAT REGISTER] Registered "${docMeta.name}" for surat ${surat.nomorSurat}`)

    const updatedSurat = await db.surat.findUnique({ where: { id: suratId } })

    return NextResponse.json({
      success: true,
      document: docMeta,
      surat: updatedSurat ? {
        ...updatedSurat,
        documents: JSON.parse(updatedSurat.documents || '[]'),
      } : null,
    })
  } catch (error) {
    console.error('[SURAT REGISTER] Error:', error)
    return NextResponse.json(
      { error: 'Gagal mendaftarkan dokumen: ' + (error instanceof Error ? error.message : 'Unknown error') },
      { status: 500 }
    )
  }
}
