import { NextRequest, NextResponse } from 'next/server'
import {
  readKegiatanForUpload,
  updateKegiatanFields,
} from '@/lib/drive-helpers'

interface DocumentMeta {
  id: string
  name: string
  originalName?: string
  subfolderName?: string
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
 * Returns: { success: true, document: DocumentMeta }
 *
 * ----
 * CRITICAL FIX (Task ID 15 — surat document upload failure):
 * Same root cause as /api/surat/register-document: this route previously
 * used Prisma (`db.programKegiatan.findUnique` + `db.programKegiatan.update`)
 * which on Cloudflare Workers cold isolates triggers the lazy Prisma WASM
 * module load (~1.5MB) + 2 DB round-trips, exceeding the 10ms CPU limit
 * (Error 1102) → HTTP 500. The kegiatan version of the same "document
 * failed to register" bug.
 *
 * FIX: Switched to libsql via shared drive-helpers (readKegiatanForUpload +
 * updateKegiatanFields). Total: 2 subrequests + ~0.1ms CPU. No Prisma.
 *
 * PERFORMANCE: Lightweight — NO checkMaintenanceMode, NO ensureDbConnection
 * (schema sync). Only 2 DB round trips to stay within Cloudflare Workers'
 * free-plan CPU limit.
 */
export async function POST(request: NextRequest) {
  try {
    const { kegiatanId, document } = await request.json()

    if (!kegiatanId || !document) {
      return NextResponse.json({ error: 'kegiatanId dan document wajib diisi' }, { status: 400 })
    }

    if (!document.driveFileId || !document.name) {
      return NextResponse.json({ error: 'Document metadata tidak lengkap (driveFileId, name wajib)' }, { status: 400 })
    }

    // 1 subrequest — read existing documents via libsql (NO Prisma)
    const kegiatan = await readKegiatanForUpload(kegiatanId)
    if (!kegiatan) {
      return NextResponse.json({ error: 'Kegiatan tidak ditemukan' }, { status: 404 })
    }

    const docMeta: DocumentMeta = {
      id: document.id || `DOC-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: document.name,
      originalName: document.originalName,
      subfolderName: document.subfolderName,
      mimeType: document.mimeType || 'application/octet-stream',
      size: document.size || 0,
      driveFileId: document.driveFileId,
      webViewLink: document.webViewLink || `https://drive.google.com/file/d/${document.driveFileId}/view`,
      downloadUrl: document.downloadUrl || `https://drive.google.com/uc?export=download&id=${document.driveFileId}`,
      uploadedAt: document.uploadedAt || new Date().toISOString(),
    }

    let existingDocs: DocumentMeta[]
    try {
      existingDocs = JSON.parse(kegiatan.documents || '[]')
      if (!Array.isArray(existingDocs)) existingDocs = []
    } catch {
      console.warn('[KEGIATAN REGISTER] Corrupt documents JSON, resetting to empty array')
      existingDocs = []
    }
    existingDocs.push(docMeta)

    // 1 subrequest — UPDATE program_kegiatan.documents via libsql (NO Prisma)
    const ok = await updateKegiatanFields(kegiatanId, {
      documents: JSON.stringify(existingDocs),
    })
    if (!ok) {
      return NextResponse.json(
        { error: 'Gagal menyimpan metadata dokumen ke database' },
        { status: 500 },
      )
    }

    return NextResponse.json({
      success: true,
      document: docMeta,
    })
  } catch (error) {
    console.error('[KEGIATAN REGISTER] Error:', error)
    return NextResponse.json(
      { error: 'Gagal mendaftarkan dokumen: ' + (error instanceof Error ? error.message : 'Unknown error') },
      { status: 500 },
    )
  }
}
