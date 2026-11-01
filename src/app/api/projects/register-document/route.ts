import { NextRequest, NextResponse } from 'next/server'
import {
  readProjectForUpload,
  updateProjectFields,
} from '@/lib/drive-helpers'

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
 * ----
 * CRITICAL FIX (Task ID 15 — surat document upload failure):
 * Same root cause as /api/surat/register-document: this route previously
 * used Prisma (`db.project.findUnique` + `db.project.update`) which on
 * Cloudflare Workers cold isolates triggers the lazy Prisma WASM module
 * load (~1.5MB) + 2 DB round-trips, exceeding the 10ms CPU limit
 * (Error 1102) → HTTP 500. The project version of the same "document
 * failed to register" bug.
 *
 * FIX: Switched to libsql via shared drive-helpers (readProjectForUpload +
 * updateProjectFields). Total: 2 subrequests + ~0.1ms CPU. No Prisma.
 *
 * PERFORMANCE: Lightweight — NO checkMaintenanceMode, NO ensureDbConnection
 * (schema sync). Only 2 DB round trips to stay within Cloudflare Workers'
 * free-plan CPU limit.
 */
export async function POST(request: NextRequest) {
  try {
    const { projectId, document } = await request.json()

    if (!projectId || !document) {
      return NextResponse.json({ error: 'projectId dan document wajib diisi' }, { status: 400 })
    }

    if (!document.driveFileId || !document.name) {
      return NextResponse.json({ error: 'Document metadata tidak lengkap (driveFileId, name wajib)' }, { status: 400 })
    }

    // 1 subrequest — read existing documents via libsql (NO Prisma)
    const project = await readProjectForUpload(projectId)
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

    let existingDocs: DocumentMeta[]
    try {
      existingDocs = JSON.parse(project.documents || '[]')
      if (!Array.isArray(existingDocs)) existingDocs = []
    } catch {
      console.warn('[PROJECTS REGISTER] Corrupt documents JSON, resetting to empty array')
      existingDocs = []
    }
    existingDocs.push(docMeta)

    // 1 subrequest — UPDATE projects.documents via libsql (NO Prisma)
    const ok = await updateProjectFields(projectId, {
      documents: JSON.stringify(existingDocs),
    })
    if (!ok) {
      return NextResponse.json(
        { error: 'Gagal menyimpan metadata dokumen ke database' },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true, document: docMeta })
  } catch (error) {
    console.error('[PROJECTS REGISTER] Error:', error)
    return NextResponse.json(
      { error: 'Gagal mendaftarkan dokumen: ' + (error instanceof Error ? error.message : 'Unknown error') },
      { status: 500 },
    )
  }
}
