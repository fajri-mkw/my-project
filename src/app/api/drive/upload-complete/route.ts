import { NextRequest, NextResponse } from 'next/server'
import { getCachedSettings } from '@/lib/drive-settings-cache'
import { getCachedAccessToken, shareWithAnyone } from '@/lib/drive-service'

// 20 second timeout for Google Drive API calls
const DRIVE_API_TIMEOUT_MS = 20_000

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DRIVE_API_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

export async function POST(request: NextRequest) {
  try {
    const { fileId } = await request.json()

    if (!fileId) {
      return NextResponse.json({ error: 'fileId wajib diisi' }, { status: 400 })
    }

    // Use CACHED settings (module-level, 5-min TTL) — avoids DB query
    // on every upload-complete call. The warmup endpoint pre-caches this.
    let settings
    try {
      settings = await getCachedSettings()
    } catch (dbErr) {
      console.error('[UPLOAD-COMPLETE] settings fetch error:', dbErr)
      return NextResponse.json(
        { error: 'Gagal membaca konfigurasi Google Drive' },
        { status: 500 },
      )
    }

    const serviceAccountKey = settings?.driveServiceAccountKey || null

    if (!serviceAccountKey) {
      return NextResponse.json({ error: 'Google Drive belum dikonfigurasi' }, { status: 400 })
    }

    // Use cached access token
    let accessToken: string
    try {
      accessToken = await getCachedAccessToken(serviceAccountKey)
    } catch (tokenErr) {
      console.error('[UPLOAD-COMPLETE] access token error:', tokenErr)
      return NextResponse.json(
        { error: 'Gagal autentikasi ke Google Drive' },
        { status: 502 },
      )
    }

    // Get file metadata via direct fetch
    const metaResp = await fetchWithTimeout(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,webViewLink,webContentLink&supportsAllDrives=true`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } },
    )

    if (!metaResp.ok) {
      const errText = await metaResp.text()
      console.error('[UPLOAD-COMPLETE] Failed to get file metadata:', metaResp.status, errText.substring(0, 300))
      return NextResponse.json(
        { error: `Gagal mendapatkan metadata file: HTTP ${metaResp.status}` },
        { status: 502 },
      )
    }

    const fileData = await metaResp.json()

    // Share with anyone (writer access) using direct fetch — best-effort
    try {
      await shareWithAnyone(accessToken, fileId, 'writer')
    } catch (shareErr) {
      // Non-fatal — file was uploaded successfully
      console.error('[UPLOAD-COMPLETE] shareWithAnyone failed (non-fatal):', shareErr)
    }

    return NextResponse.json({
      success: true,
      file: {
        id: fileData.id,
        name: fileData.name,
        webViewLink: fileData.webViewLink,
        webContentLink: fileData.webContentLink,
      },
    })
  } catch (error) {
    console.error('[UPLOAD-COMPLETE] Error:', error)
    const aborted = error instanceof Error && error.name === 'AbortError'
    return NextResponse.json(
      {
        error: aborted
          ? 'Permintaan ke Google Drive timeout'
          : 'Gagal menyelesaikan upload',
      },
      { status: aborted ? 504 : 500 },
    )
  }
}
