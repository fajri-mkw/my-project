import { NextRequest, NextResponse } from 'next/server'
import { getLibsql } from '@/lib/libsql-client'
import { getCachedAccessToken } from '@/lib/drive-service'

// ============================================================================
// GET /api/drive/folder-files?folderId=XXX
//
// Lists the non-trashed files inside a single Google Drive folder.
//
// WHY THIS EXISTS:
// The "Unggah Hasil Kerja" page was redesigned so petugas upload directly
// via Google Drive (faster, no Cloudflare Worker chunked-upload errors).
// To preserve the "wajib unggah minimal 1 file sebelum serah-terima" rule,
// the frontend polls this endpoint every ~20s to detect whether the
// petugas's folder has any files yet. As soon as ≥1 file is detected, the
// completion checkbox is auto-enabled (and auto-checked) so the petugas
// can immediately click "Selesaikan & Serahkan".
//
// This is the ONLY call the frontend makes during the polling loop — kept
// intentionally lightweight (1 Drive API subrequest + 1 libsql settings
// read = 2 subrequests total, well within Cloudflare Workers' 50-subreq
// free-plan limit).
// ============================================================================

interface DriveSettings {
  driveServiceAccountKey: string | null
  driveSharedDriveId: string | null
}

async function readDriveSettings(): Promise<DriveSettings | null> {
  try {
    const client = getLibsql()
    const res = await client.execute({
      sql: `SELECT driveServiceAccountKey, driveSharedDriveId FROM settings WHERE id = 'main' LIMIT 1`,
      args: [],
    })
    if (res.rows.length === 0) return null
    const row = res.rows[0] as Record<string, unknown>
    return {
      driveServiceAccountKey: (row.driveServiceAccountKey as string | null) ?? null,
      driveSharedDriveId: (row.driveSharedDriveId as string | null) ?? null,
    }
  } catch (error) {
    console.error('[FOLDER-FILES] readDriveSettings error:', error)
    return null
  }
}

export async function GET(request: NextRequest) {
  try {
    const folderId = request.nextUrl.searchParams.get('folderId')
    if (!folderId) {
      return NextResponse.json(
        { error: 'folderId parameter required' },
        { status: 400 },
      )
    }

    // Basic sanity check — reject mock IDs (e.g. "raw-...", "mock-...")
    const MOCK_PREFIXES = ['raw-', 'revised-', 'final-', 'desain-', 'lainnya-', 'mock-']
    if (MOCK_PREFIXES.some((p) => folderId.startsWith(p)) || folderId.length < 20) {
      return NextResponse.json({
        fileCount: 0,
        files: [],
        folderLink: '',
        mock: true,
        message: 'Folder ID appears to be a mock placeholder. Manager has not created real Drive folders yet.',
      })
    }

    const settings = await readDriveSettings()
    if (!settings?.driveServiceAccountKey || !settings?.driveSharedDriveId) {
      return NextResponse.json(
        { error: 'Drive not configured. Admin must set Service Account Key and Shared Drive ID in Settings.' },
        { status: 400 },
      )
    }

    const accessToken = await getCachedAccessToken(settings.driveServiceAccountKey)

    // List files in the folder.
    // For Shared Drives, must pass corpora=drive + driveId + supportsAllDrives +
    // includeItemsFromAllDrives. We also filter trashed=false so deleted files
    // don't count toward the "minimum 1 file" gate.
    const q = `'${folderId.replace(/'/g, "\\'")}' in parents and trashed=false`
    const params = new URLSearchParams({
      q,
      corpora: 'drive',
      driveId: settings.driveSharedDriveId,
      includeItemsFromAllDrives: 'true',
      supportsAllDrives: 'true',
      fields: 'files(id,name,mimeType,size,modifiedTime)',
      pageSize: '100', // cap to avoid huge responses; 100 is enough for a "is there anything?" check
      orderBy: 'modifiedTime desc',
    })

    const listUrl = `https://www.googleapis.com/drive/v3/files?${params}`
    const response = await fetch(listUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      console.error(`[FOLDER-FILES] Drive API ${response.status}:`, errText.substring(0, 200))
      return NextResponse.json(
        {
          error: `Drive API error ${response.status}`,
          details: errText.substring(0, 200),
        },
        { status: 502 },
      )
    }

    const data = await response.json()
    const files = (data.files || []) as Array<{
      id: string
      name: string
      mimeType: string
      size?: string
      modifiedTime?: string
    }>

    // Filter out subfolders — only count actual files (videos, images, docs, etc.)
    // so an empty user folder (which may contain output-type subfolders like
    // "Foto/", "Video/") doesn't falsely report "files exist".
    const realFiles = files.filter(
      (f) => f.mimeType !== 'application/vnd.google-apps.folder',
    )

    return NextResponse.json({
      fileCount: realFiles.length,
      files: realFiles.map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        size: f.size,
        modifiedTime: f.modifiedTime,
      })),
      folderLink: `https://drive.google.com/drive/folders/${folderId}`,
      mock: false,
    })
  } catch (error) {
    console.error('[FOLDER-FILES] error:', error)
    return NextResponse.json(
      {
        error: 'Failed to list folder files',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    )
  }
}
