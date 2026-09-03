import { NextRequest, NextResponse } from 'next/server'
import { getCachedAccessToken } from '@/lib/drive-service'
import { readDriveSettings } from '@/lib/drive-helpers'

// GET /api/inventory/proxy-image?fileId=XXX
// Fetch raw image bytes dari Google Drive pakai Service Account,
// return ke browser sebagai response image dengan CORS headers.
//
// WHY: Browser fetch() ke drive.google.com/thumbnail?id=XXX GAGAL
// karena CORS (Drive tidak kirim Access-Control-Allow-Origin untuk
// endpoint thumbnail). <img> tag bisa render karena tidak enforce
// CORS, tapi fetch() di jsPDF pipeline butuh response yang CORS-OK.
//
// Dengan proxy ini, frontend fetch dari same-origin → tidak ada CORS.
// Backend pakai service account → akses file apapun di Drive folder.
export async function GET(request: NextRequest) {
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
      console.error('[PROXY-IMAGE] Drive API error:', resp.status, await resp.text().catch(() => ''))
      return NextResponse.json({ error: `Gagal fetch dari Drive (${resp.status})` }, { status: 502 })
    }

    const contentType = resp.headers.get('Content-Type') || 'image/jpeg'
    const buf = await resp.arrayBuffer()

    // Cache 24 jam di browser + edge — foto jarang berubah, hemat request.
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
    console.error('[PROXY-IMAGE] Error:', error)
    return NextResponse.json({ error: 'Gagal fetch image' }, { status: 500 })
  }
}
