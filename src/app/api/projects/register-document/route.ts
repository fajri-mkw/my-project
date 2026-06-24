import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'

interface DocumentMeta {
  id: string
  name: string
  mimeType: string
  size: number
  driveFileId: string
  webViewLink: string
  uploadedAt: string
}

/**
 * POST /api/projects/register-document
 *
 * Registers an already-uploaded document's metadata to a project record.
 * Used AFTER chunked resumable upload completes.
 *
 * Body: { projectId: string, document: DocumentMeta, label?: string }
 * Returns: { success: true, document: DocumentMeta }
 *
 * PERFORMANCE: Lightweight — NO checkMaintenanceMode, NO ensureDbConnection
 * (schema sync). Only 2 DB round trips to stay within Cloudflare Workers'
 * free-plan CPU limit.
 */
export async function POST(request: NextRequest) {
  try {
    const { projectId, document, label } = await request.json()

    if (!projectId || !document) {
      return NextResponse.json({ error: 'projectId dan document wajib diisi' }, { status: 400 })
    }

    if (!document.driveFileId || !document.name) {
      return NextResponse.json({ error: 'Document metadata tidak lengkap (driveFileId, name wajib)' }, { status: 400 })
    }

    const project = await db.project.findUnique({ where: { id: projectId } })
    if (!project) {
      return NextResponse.json({ error: 'Proyek tidak ditemukan' }, { status: 404 })
    }

    const docMeta: DocumentMeta = {
      id: document.id || `DOC-${Date.now()}`,
      name: document.name,
      mimeType: document.mimeType || 'application/octet-stream',
      size: document.size || 0,
      driveFileId: document.driveFileId,
      webViewLink: document.webViewLink || `https://drive.google.com/file/d/${document.driveFileId}/view`,
      uploadedAt: document.uploadedAt || new Date().toISOString(),
    }

    const existingDocs = JSON.parse(project.documents || '[]')
    existingDocs.push(docMeta)

    await db.project.update({
      where: { id: projectId },
      data: { documents: JSON.stringify(existingDocs) },
    })

    return NextResponse.json({ success: true, document: docMeta })
  } catch (error) {
    console.error('[PROJECTS REGISTER] Error:', error)
    return NextResponse.json(
      { error: 'Gagal mendaftarkan dokumen: ' + (error instanceof Error ? error.message : 'Unknown error') },
      { status: 500 }
    )
  }
}
