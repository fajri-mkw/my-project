import { NextRequest, NextResponse } from 'next/server'
import { deferToBackground, invalidateCache } from '@/lib/edge-cache'
import {
  readSuratForUpload,
  updateSuratFields,
} from '@/lib/drive-helpers'

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
 * ----
 * CRITICAL FIX (Task ID 15 — surat document upload failure):
 * This route previously used Prisma via `import { db } from '@/lib/db'`:
 *
 *   const surat = await db.surat.findUnique({ where: { id: suratId } })
 *   await db.surat.update({ where: { id: suratId }, data: { documents: ... } })
 *
 * On Cloudflare Workers free plan, the FIRST call on a cold isolate triggers
 * the lazy Prisma proxy to `await import('@prisma/client')` (~1.5MB WASM
 * module). Combined with two DB round-trips, this routinely exceeds the 10ms
 * CPU limit → Error 1102 → HTTP 500 "Worker exceeded resource limits".
 *
 * Symptom reported by the administrator:
 *   "surat berhasil disimpan tetapi dokument berkas surat tidak berhasil
 *    di upload atau gagal" — the surat row was saved (POST /api/surat
 * succeeded) but every document upload failed at the register step, even
 * though the chunked upload to Google Drive itself actually succeeded.
 *
 * The frontend's 2-retry loop (in uploadDocumentsToDrive) kept landing on
 * cold isolates and failing, so the user saw "X dokumen gagal diupload"
 * while the orphaned files were already sitting in the Drive folder.
 *
 * FIX: Switched to libsql via the shared drive-helpers (readSuratForUpload +
 * updateSuratFields). Total cost: 2 subrequests + ~0.1ms CPU. No Prisma WASM
 * load, no schema sync, no 1102.
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

    // 1 subrequest — read existing documents array via libsql (NO Prisma)
    const surat = await readSuratForUpload(suratId)
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

    // Parse existing documents (defensive — readSuratForUpload returns '[]' if null)
    let existingDocs: DocumentMeta[]
    try {
      existingDocs = JSON.parse(surat.documents || '[]')
      if (!Array.isArray(existingDocs)) existingDocs = []
    } catch {
      // Defensive: corrupt JSON in documents column — start fresh instead of failing
      console.warn('[SURAT REGISTER] Corrupt documents JSON, resetting to empty array')
      existingDocs = []
    }
    existingDocs.push(docMeta)

    // 1 subrequest — UPDATE surat.documents via libsql (NO Prisma)
    const ok = await updateSuratFields(suratId, {
      documents: JSON.stringify(existingDocs),
    })
    if (!ok) {
      return NextResponse.json(
        { error: 'Gagal menyimpan metadata dokumen ke database' },
        { status: 500 },
      )
    }

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
      { status: 500 },
    )
  }
}
