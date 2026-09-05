import { NextRequest, NextResponse } from 'next/server'
import { withEdgeCache } from '@/lib/edge-cache'
import { getCachedAccessToken } from '@/lib/drive-service'
import { readDriveSettings } from '@/lib/drive-helpers'

// GET /api/inventory/proxy-image?fileId=XXX
// Fetch raw image bytes dari Google Drive pakai Service Account,
// return ke browser sebagai response image.
//
// WHY PROXY: Browser fetch() ke drive.google.com/thumbnail?id=XXX GAGAL
// karena CORS. <img> tag bisa render (no CORS enforcement), tapi fetch()
// di jsPDF pipeline butuh CORS-OK response. Proxy = same-origin = no CORS.
//
// WHY EDGE CACHE: Foto peminjam jarang berubah (upload sekali, pakai selamanya).
// Dengan edge cache 24 jam:
//   - First request: Worker processes + Drive API call
//   - Subsequent requests (same fileId): served from edge cache, 0 Worker CPU
// Browser juga cache 24h (max-age=86400) → repeat requests dari browser yang
// sama tidak hit Worker sama sekali.
//
// shouldBypass: non-admin requests skip cache (always run handler → 403).
// Admin requests use cache. Ini mencegah non-admin akses cached admin response.
export const GET = withEdgeCache(async (request: NextRequest) => {
  const userRole = request.headers.get('X-User-Role')
  if (!['Admin', 'Administrator', 'Manager'].includes(userRole || '')) {
    return NextResponse.json({ error: 'Hanya Super Admin' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const fileId = searchParams.get('fileId')
  if (!fileId) return NextResponse.json({ error: 'fileId wajib diisi' }, { status: 400 })

  try {
    const settings = await readDriveSettings()
    if (!settings?.driveServiceAccountKey) {
      return NextResponse.json({ error: 'Drive belum dikonfigurasi' }, { status: 400 })
    }

    const accessToken = await getCachedAccessToken(settings.driveServiceAccountKey)

    // Drive API v3: alt=media returns raw file bytes
    const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      redirect: 'follow',
    })

    if (!resp.ok) {
      return NextResponse.json({ error: `Gagal fetch dari Drive (${resp.status})` }, { status: 502 })
    }

    const contentType = resp.headers.get('Content-Type') || 'image/jpeg'
    const buf = await resp.arrayBuffer()

    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, s-maxage=86400',
        'Access-Control-Allow-Origin': '*',
        'Content-Length': String(buf.byteLength),
      },
    })
  } catch (error) {
    return NextResponse.json({ error: 'Gagal fetch image' }, { status: 500 })
  }
}, {
  ttl: 86400, // 24 jam — foto jarang berubah
  shouldBypass: (request: Request) => {
    // Non-admin requests skip cache (always run handler → 403)
    const role = request.headers.get('X-User-Role')
    return !['Admin', 'Administrator', 'Manager'].includes(role || '')
  }
})
