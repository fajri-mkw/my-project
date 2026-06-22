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
 * POST /api/program-kegiatan/register-document
 *
 * Registers an already-uploaded document's metadata to a program kegiatan record.
 * Used AFTER chunked resumable upload completes.
 *
 * Body: { kegiatanId: string, document: DocumentMeta }
 * Returns: { success: true, document: DocumentMeta, kegiatan: ... }
 */
export async function POST(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    await ensureDbConnection()
    const { kegiatanId, document } = await request.json()

    if (!kegiatanId || !document) {
      return NextResponse.json({ error: 'kegiatanId dan document wajib diisi' }, { status: 400 })
    }

    if (!document.driveFileId || !document.name) {
      return NextResponse.json({ error: 'Document metadata tidak lengkap (driveFileId, name wajib)' }, { status: 400 })
    }

    const kegiatan = await db.programKegiatan.findUnique({ where: { id: kegiatanId } })
    if (!kegiatan) {
      return NextResponse.json({ error: 'Kegiatan tidak ditemukan' }, { status: 404 })
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

    const existingDocs: DocumentMeta[] = JSON.parse(kegiatan.documents || '[]')
    existingDocs.push(docMeta)

    await db.programKegiatan.update({
      where: { id: kegiatanId },
      data: { documents: JSON.stringify(existingDocs) },
    })

    console.log(`[KEGIATAN REGISTER] Registered "${docMeta.name}" for kegiatan ${kegiatan.nomorKegiatan}`)

    const updatedKegiatan = await db.programKegiatan.findUnique({ where: { id: kegiatanId } })

    return NextResponse.json({
      success: true,
      document: docMeta,
      kegiatan: updatedKegiatan ? {
        ...updatedKegiatan,
        documents: JSON.parse(updatedKegiatan.documents || '[]'),
      } : null,
    })
  } catch (error) {
    console.error('[KEGIATAN REGISTER] Error:', error)
    return NextResponse.json(
      { error: 'Gagal mendaftarkan dokumen: ' + (error instanceof Error ? error.message : 'Unknown error') },
      { status: 500 }
    )
  }
}
