import { NextResponse } from 'next/server'
import { getCachedSettings } from '@/lib/drive-settings-cache'
import { getCachedAccessToken } from '@/lib/drive-service'

/**
 * POST /api/drive/warmup
 *
 * Pre-caches Google Drive settings and access token on the current
 * Cloudflare Workers isolate.
 *
 * WHY THIS EXISTS:
 * The `/api/drive/upload-url` endpoint does several CPU-intensive things:
 *   1. DB query for settings (~1ms CPU)
 *   2. RSA-256 JWT signing via crypto.subtle (~3-5ms CPU on cold isolate,
 *      includes PEM parsing + key import)
 *   3. OAuth token fetch (network I/O, minimal CPU)
 *   4. Google Drive resumable session init POST (network I/O, minimal CPU)
 *
 * On a COLD Cloudflare Workers isolate (free plan = 10ms CPU limit), the
 * cumulative CPU of steps 1-3 alone can reach 8-11ms. Adding step 4 and
 * module-load overhead pushes it OVER the 10ms limit, causing the Worker
 * to be killed mid-request. The result is an HTTP 500 with an EMPTY
 * response body — which the frontend can't parse, so it shows the generic
 * error: "Gagal menyiapkan upload (HTTP 500)".
 *
 * This warmup endpoint does ONLY steps 1-3 (no Drive API call). After it
 * succeeds, the isolate has:
 *   - Settings cached at module level (5-min TTL)
 *   - CryptoKey cached at module level (RSA private key)
 *   - Access token cached at module level (50-min TTL)
 *
 * The subsequent `/api/drive/upload-url` request (which usually hits the
 * SAME warm isolate) then only needs to do step 4 — the Drive init POST.
 * That's ~2ms CPU, well within the 10ms limit.
 *
 * FRONTEND USAGE:
 * The frontend calls this endpoint BEFORE calling upload-url, with retry.
 * Even if the first warmup request fails (cold isolate CPU limit), the
 * retry usually lands on a warmer isolate. Once warmup succeeds, the
 * upload-url request is virtually guaranteed to succeed.
 *
 * This endpoint is also safe to call proactively (e.g. when a page with
 * upload functionality mounts) to pre-warm the isolate before the user
 * even starts uploading.
 */
export async function POST() {
  try {
    // Step 1: Fetch & cache settings (DB query)
    let settings
    try {
      settings = await getCachedSettings()
    } catch (dbErr) {
      console.error('[WARMUP] settings fetch error:', dbErr)
      return NextResponse.json(
        { ok: false, error: 'Gagal membaca konfigurasi Google Drive' },
        { status: 500 },
      )
    }

    if (!settings?.driveServiceAccountKey) {
      return NextResponse.json(
        { ok: false, error: 'Google Drive belum dikonfigurasi' },
        { status: 400 },
      )
    }

    // Step 2: Fetch & cache access token (JWT signing + OAuth)
    // This is the heaviest CPU operation. On a cold isolate it may take
    // 3-5ms CPU (RSA key import + signing). But since there's no Drive API
    // call after it, the total CPU stays under the 10ms limit.
    try {
      await getCachedAccessToken(settings.driveServiceAccountKey)
    } catch (tokenErr) {
      console.error('[WARMUP] access token error:', tokenErr)
      return NextResponse.json(
        { ok: false, error: 'Gagal autentikasi ke Google Drive' },
        { status: 502 },
      )
    }

    return NextResponse.json({
      ok: true,
      warmed: true,
      // Return the resolved Drive target so the frontend can validate Drive
      // is configured in the right mode (shared-drive ID vs My Drive folder ID).
      driveMode: settings.driveMode || 'shared',
      sharedDriveId: settings.driveSharedDriveId || null,
      driveFolderId: settings.driveFolderId || null,
    })
  } catch (error) {
    console.error('[WARMUP] Error:', error)
    return NextResponse.json(
      { ok: false, error: 'Gagal warmup Google Drive' },
      { status: 500 },
    )
  }
}

/**
 * GET handler — same as POST but accessible via GET for easier preloading
 * (e.g. <link rel="preload"> or fetch in useEffect without method).
 */
export async function GET() {
  return POST()
}
