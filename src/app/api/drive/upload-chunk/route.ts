import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'
import { google } from 'googleapis'

const CHUNK_SIZE = 1 * 1024 * 1024 // 1MB per chunk (well under Vercel's 4.5MB limit)

export async function POST(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const formData = await request.formData()
    const uploadUrl = formData.get('uploadUrl') as string
    const chunkIndex = parseInt(formData.get('chunkIndex') as string, 10)
    const totalSize = parseInt(formData.get('totalSize') as string, 10)
    const chunk = formData.get('chunk') as File

    if (!uploadUrl || isNaN(chunkIndex) || isNaN(totalSize) || !chunk) {
      return NextResponse.json({ error: 'Parameter tidak lengkap' }, { status: 400 })
    }

    // Get service account access token
    const settings = await db.settings.findUnique({ where: { id: 'main' } })
    if (!settings?.driveServiceAccountKey) {
      return NextResponse.json({ error: 'Google Drive belum dikonfigurasi' }, { status: 400 })
    }

    const credentials = JSON.parse(settings.driveServiceAccountKey)
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive']
    })
    const authClient = await auth.getClient()
    const accessToken = (await authClient.getAccessToken()).token as string

    // Calculate byte range for this chunk
    const start = chunkIndex * CHUNK_SIZE
    const chunkData = Buffer.from(await chunk.arrayBuffer())
    const end = start + chunkData.length - 1

    // Forward chunk to Google Drive resumable upload session
    const driveResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/octet-stream',
        'Content-Range': `bytes ${start}-${end}/${totalSize}`,
        'Content-Length': chunkData.length.toString(),
      },
      body: chunkData,
    })

    // 308 = Resume Incomplete (more chunks needed)
    // 200/201 = Upload Complete
    if (driveResponse.status === 308) {
      return NextResponse.json({
        complete: false,
        nextChunk: chunkIndex + 1
      })
    }

    if (driveResponse.status === 200 || driveResponse.status === 201) {
      let fileData: Record<string, string | undefined> = {}
      try {
        fileData = await driveResponse.json()
      } catch {
        // Response might be empty
      }

      // Share the file
      if (fileData?.id) {
        try {
          const drive = google.drive({ version: 'v3', auth })
          await drive.permissions.create({
            fileId: fileData.id,
            requestBody: { type: 'anyone', role: 'writer', allowFileDiscovery: false },
            supportsAllDrives: true
          })
        } catch (shareErr) {
          console.error('[UPLOAD-CHUNK] Share failed (non-critical):', shareErr)
        }
      }

      return NextResponse.json({
        complete: true,
        file: {
          id: fileData.id,
          name: fileData.name,
          webViewLink: fileData.webViewLink,
          webContentLink: fileData.webContentLink,
        }
      })
    }

    // Unexpected status
    const errorText = await driveResponse.text()
    console.error('[UPLOAD-CHUNK] Google API error:', driveResponse.status, errorText)
    return NextResponse.json(
      { error: `Upload gagal: HTTP ${driveResponse.status}` },
      { status: 502 }
    )
  } catch (error) {
    console.error('[UPLOAD-CHUNK] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Gagal mengupload chunk' },
      { status: 500 }
    )
  }
}
