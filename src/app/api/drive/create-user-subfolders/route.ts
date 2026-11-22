import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'
import { getCachedAccessToken, resolveDriveTarget } from '@/lib/drive-service'
import { readDriveSettings } from '@/lib/drive-helpers'
import { roleGetsDriveDivisions, DRIVE_DIVISION_ROLES } from '@/lib/store'

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
//     workerCustomOutput: { userId: "custom text" },
//     divisions?: ["umum", "private"]  // NEW — only for folderType "raw"
//   }
//
// DIVISIONS (UMUM/PRIVATE merge into PRODUKSI):
// Previously PUBLIC/UMUM and PRIVATE/RAHASIA were separate TOP-LEVEL folders,
// each getting its own user subfolders + output folders. A stage-1 worker with
// outputs [Foto, Video] ended up with 3 identically-named "Foto" folders
// (PRODUKSI, PUBLIC-UMUM, PRIVATE-RAHASIA) — confusing and duplicative.
//
// With `divisions`, the sorting happens INSIDE the worker's own PRODUKSI
// subfolder instead:
//
//   1. PRODUKSI (Berkas Mentah)/
//     └── HS_Ahmad_Photographer.../          ← worker's ONE folder
//         ├── UMUM/                           ← division
//         │   ├── Foto/                       ← auto-named output folder
//         │   └── Video/
//         └── PRIVATE/                        ← division
//             ├── Foto/
//             └── Video/
//
// DIVISION ELIGIBILITY (role whitelist — see DRIVE_DIVISION_ROLES in store.ts):
// Pembagian UMUM/PRIVATE hanya untuk petugas yang hasil kerjanya menjadi isi
// galeri LIHUM: Photographer, Videographer, Content Creator, dan Audio
// (role 'PhotographerVideographerAudio'). Petugas Tahap 1 lainnya — Reporter
// dan Graphic Designer — TIDAK mendapat pembagian karena tugasnya memang tidak
// akan dibagikan; subfolder mereka memakai struktur flat (folder output
// langsung di dalam subfolder petugas), sama seperti legacy.
//
//   1. PRODUKSI (Berkas Mentah)/
//     └── RH_Rudi_GraphicDesigner/
//         ├── Desain Feed/                    ← flat output folders
//         └── Desain Banner/                  ← (NO UMUM/PRIVATE division)
//
// Logical folder IDs (stored in the drive_folders table):
//   User subfolder:  raw-{role}-{userId}                      (unchanged)
//   UMUM division:   raw-{role}-{userId}-umum
//   PRIVATE division:raw-{role}-{userId}-private
//   Division output: raw-{role}-{userId}-{umum|private}-output-{i}
//
// When `divisions` is NOT passed (backward compatibility — e.g. regenerating
// an OLD project that still has top-level PUBLIC/PRIVATE folders), the flat
// legacy structure is created (outputs directly inside the user subfolder).
//
// Subrequest budget with divisions (worst case: mixed roles, 5 users × 3 outputs):
//   2 division users × (1 user folder + 2 divisions + 6 division outputs) = 18
//   3 flat users × (1 user folder + 3 outputs) = 12 → total ~30 calls —
//   comfortably within the 50 limit. The frontend batches per folder type and
//   the access token is cached, so this is acceptable.
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
    const { folderType, parentDriveId, users, workerOutputs, workerCustomOutput, divisions } = body as {
      folderType: string
      parentDriveId: string
      users: AssignedUser[]
      workerOutputs?: Record<string, string[]>
      workerCustomOutput?: Record<string, string>
      /** NEW: create UMUM/PRIVATE divisions inside each PRODUKSI user subfolder */
      divisions?: string[]
    }

    if (!folderType || !parentDriveId) {
      return NextResponse.json({ error: 'folderType dan parentDriveId wajib diisi' }, { status: 400 })
    }
    if (!users || !Array.isArray(users) || users.length === 0) {
      return NextResponse.json({ success: true, subfolders: [] })
    }

    // Divisions only apply to PRODUKSI ('raw') — other folder types (PASCA
    // PRODUKSI, custom) keep the flat user-subfolder → output structure.
    // NOTE: even for 'raw', divisions are only created for ELIGIBLE roles
    // (see DRIVE_DIVISION_ROLES) — enforced per-user inside the loop below.
    const useDivisions = folderType === 'raw'
      && Array.isArray(divisions)
      && divisions.some(d => d === 'umum' || d === 'private')
    // Sanitize the division list (order preserved: UMUM first for a natural layout)
    const divisionList = useDivisions
      ? (divisions!.includes('umum') && divisions!.includes('private')
          ? ['umum', 'private']
          : divisions!.filter(d => d === 'umum' || d === 'private'))
      : []

    const settings = await readDriveSettings()
    if (!settings?.driveServiceAccountKey) {
      return NextResponse.json({ error: 'Drive belum dikonfigurasi' }, { status: 400 })
    }

    const target = resolveDriveTarget(settings)
    if (!target) {
      return NextResponse.json({ error: 'Drive target tidak dikonfigurasi' }, { status: 400 })
    }

    const driveIdForCreate = target.isSharedDrive ? target.rootId : ''
    const accessToken = await getCachedAccessToken(settings.driveServiceAccountKey, settings.driveMode === "folder" ? settings.driveAdminEmail : undefined)

    const createdSubfolders: CreatedFolder[] = []

    // Resolve the display name for a single output type (handles "Lainnya" → custom text)
    const resolveOutputName = (userId: string, outputType: string) =>
      outputType === 'Lainnya' && workerCustomOutput?.[userId]
        ? workerCustomOutput[userId]
        : outputType

    // Create user subfolders + output subfolders for this ONE folder type
    for (const user of users) {
      const userCode = generateUserCode(user.userName)
      const subfolderName = `${userCode}_${user.userName.replace(/\s+/g, '_')}_${user.role.replace(/\s*&\s*/g, '_')}`

      // DIVISION ELIGIBILITY (per user): hanya Photographer, Videographer,
      // Content Creator, dan Audio (isi galeri LIHUM) yang mendapat pembagian
      // UMUM/PRIVATE. Reporter & Graphic Designer (dan role lain) mendapat
      // struktur flat — output langsung di dalam subfolder petugas.
      const userUseDivisions = useDivisions && roleGetsDriveDivisions(user.role)

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

      const outputTypes = workerOutputs?.[user.userId] || []

      if (userUseDivisions) {
        // === DIVISION STRUCTURE (eligible roles only — gallery content) ===
        // The stage-1 worker gets ONE folder with the public/private sorting
        // built in. Output folders are created inside EACH division.
        for (const division of divisionList) {
          const divisionName = division === 'umum' ? 'UMUM' : 'PRIVATE'
          const divisionFolder = await createFolder(
            accessToken,
            divisionName,
            userSubfolder.id,
            driveIdForCreate
          )
          const divisionLogicalId = `${userSubfolderLogicalId}-${division}`

          createdSubfolders.push({
            ...divisionFolder,
            folderId: divisionLogicalId,
          })

          // Output-type subfolders inside this division
          for (let i = 0; i < outputTypes.length; i++) {
            const outputName = resolveOutputName(user.userId, outputTypes[i])
            const outputSubfolder = await createFolder(
              accessToken,
              outputName,
              divisionFolder.id,
              driveIdForCreate
            )
            createdSubfolders.push({
              ...outputSubfolder,
              folderId: `${divisionLogicalId}-output-${i}`,
            })
          }
        }
      } else {
        // === FLAT STRUCTURE (non-eligible roles: Reporter, Graphic Designer,
        // etc. — AND legacy regeneration) ===
        // Output-type subfolders directly inside the user's folder.
        // Used for non-raw folder types, old-structure regeneration, and
        // Tahap-1 roles whose work is never shared publicly.
        for (let i = 0; i < outputTypes.length; i++) {
          const outputName = resolveOutputName(user.userId, outputTypes[i])
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
      divisions: divisionList,
      divisionEligibleRoles: DRIVE_DIVISION_ROLES,
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
