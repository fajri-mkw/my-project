import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'
import { getCachedAccessToken, resolveDriveTarget } from '@/lib/drive-service'
import { readDriveSettings } from '@/lib/drive-helpers'

// ============================================================================
// POST /api/drive/create-user-subfolders
//
// Creates user subfolders + output subfolders for ONE folder type.
// Called by the frontend AFTER POST /api/drive returns the stage folder IDs.
//
// WHY THIS EXISTS (Error 1102 fix):
// The old POST /api/drive created ALL folders (structure + user subfolders +
// output subfolders) in a single request. With 4 folder types × 5 users ×
// (1 user subfolder + 3 output subfolders) = 80 Drive API calls, plus the
// ~12 structure calls = ~92 total subrequests. Cloudflare Workers free plan
// has a 50-subrequest-per-invocation limit → Error 1102 + HTTP 500.
//
// This endpoint creates subfolders for ONE folder type at a time:
//   - 5 users × (1 user subfolder + 3 outputs) = 20 Drive API calls
//   - Well within the 50-subrequest limit
//
// The frontend calls this endpoint once per folder type (sequentially),
// accumulating the returned subfolder IDs into the project's folder list.
//
// Body:
//   {
//     folderType: "raw" | "revised" | "desain" | "lainnya",
//     parentDriveId: "Drive folder ID of the stage folder",
//     users: [{ userId, userName, role, stage }],
//     workerOutputs: { userId: ["Foto", "Video", ...] },
//     workerCustomOutput: { userId: "custom text" }
//   }
//
// Returns:
//   { success: true, subfolders: [{ folderId, name, webViewLink, ... }] }
// ============================================================================

interface AssignedUser {
  userId: string
  userName: string
  role: string
  stage?: number
}

interface CreatedFolder {
  id: string
  name: string
  webViewLink: string
  folderId: string
}

function generateUserCode(userName: string): string {
  const parts = userName.trim().split(/\s+/)
  if (parts.length === 0) return 'XX'
  const first = parts[0].substring(0, 2).toUpperCase()
  const last = parts.length > 1 ? parts[parts.length - 1].substring(0, 1).toUpperCase() : ''
  return first + last
}

async function createFolder(
  accessToken: string,
  name: string,
  parentId: string,
  sharedDriveId: string
): Promise<{ id: string; name: string; webViewLink: string }> {
  const metadata: Record<string, unknown> = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [parentId],
  }
  if (sharedDriveId) metadata.driveId = sharedDriveId

  const resp = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink&supportsAllDrives=true', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(metadata),
  })

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '')
    throw new Error(`Drive API error ${resp.status}: ${errText}`)
  }

  return await resp.json()
}

export async function POST(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock

  try {
    const body = await request.json()
    const { folderType, parentDriveId, users, workerOutputs, workerCustomOutput } = body as {
      folderType: string
      parentDriveId: string
      users: AssignedUser[]
      workerOutputs?: Record<string, string[]>
      workerCustomOutput?: Record<string, string>
    }

    if (!folderType || !parentDriveId) {
      return NextResponse.json({ error: 'folderType dan parentDriveId wajib diisi' }, { status: 400 })
    }
    if (!users || !Array.isArray(users) || users.length === 0) {
      return NextResponse.json({ success: true, subfolders: [] })
    }

    const settings = await readDriveSettings()
    if (!settings?.driveServiceAccountKey) {
      return NextResponse.json({ error: 'Drive belum dikonfigurasi' }, { status: 400 })
    }

    const target = resolveDriveTarget(settings)
    if (!target) {
      return NextResponse.json({ error: 'Drive target tidak dikonfigurasi' }, { status: 400 })
    }

    const driveIdForCreate = target.isSharedDrive ? target.rootId : ''
    const accessToken = await getCachedAccessToken(settings.driveServiceAccountKey)

    const createdSubfolders: CreatedFolder[] = []

    // Create user subfolders + output subfolders for this ONE folder type
    for (const user of users) {
      const userCode = generateUserCode(user.userName)
      const subfolderName = `${userCode}_${user.userName.replace(/\s+/g, '_')}_${user.role.replace(/\s*&\s*/g, '_')}`

      // Create user-named subfolder
      const userSubfolder = await createFolder(
        accessToken,
        subfolderName,
        parentDriveId,
        driveIdForCreate
      )

      const userSubfolderLogicalId = `${folderType}-${user.role.toLowerCase().replace(/\s*&\s*/g, '-')}-${user.userId}`

      createdSubfolders.push({
        ...userSubfolder,
        folderId: userSubfolderLogicalId,
      })

      // Create output-type subfolders inside user's folder
      if (workerOutputs && workerOutputs[user.userId] && workerOutputs[user.userId].length > 0) {
        const outputTypes = workerOutputs[user.userId]
        for (let i = 0; i < outputTypes.length; i++) {
          const outputType = outputTypes[i]
          const outputName = outputType === 'Lainnya' && workerCustomOutput?.[user.userId]
            ? workerCustomOutput[user.userId]
            : outputType

          const outputSubfolder = await createFolder(
            accessToken,
            outputName,
            userSubfolder.id,
            driveIdForCreate
          )

          createdSubfolders.push({
            ...outputSubfolder,
            folderId: `${userSubfolderLogicalId}-output-${i}`,
          })
        }
      }
    }

    return NextResponse.json({
      success: true,
      folderType,
      subfolders: createdSubfolders,
    })
  } catch (error) {
    console.error('[CREATE-USER-SUBFOLDERS] Error:', error)
    return NextResponse.json({
      error: 'Failed to create user subfolders',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
