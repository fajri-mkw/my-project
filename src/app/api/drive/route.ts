import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'
import { getLibsql } from '@/lib/libsql-client'
import {
  getCachedAccessToken,
  checkSharedDriveAccess,
  listFoldersByName,
  getFileParents,
  createDriveFolder,
  shareWithAnyone,
} from '@/lib/drive-service'

// Interface for folder creation result
interface CreatedFolder {
  id: string
  name: string
  webViewLink: string
  folderId: string
}

// Interface for assigned users
interface AssignedUser {
  role: string
  userName: string
  userId: string
  stage: number
}

// Interface for Drive settings (read via lightweight libsql — no Prisma)
interface DriveSettings {
  driveServiceAccountKey: string | null
  driveSharedDriveId: string | null
  driveParentFolderId: string | null
  driveAutoCreate: boolean
}

/**
 * Read Drive settings directly via libsql (NO Prisma, NO ensureDbConnection).
 *
 * WHY: On Cloudflare Workers free plan, `ensureDbConnection()` →
 * `ensureSchemaSync()` can run 40+ migration queries on cold starts when the
 * schema version isn't stored, exhausting the 50-subrequest limit before the
 * actual work begins. By reading settings via getLibsql() directly (1 HTTP
 * subrequest), we bypass Prisma + schema sync entirely.
 *
 * This mirrors the approach already used by checkMaintenanceMode().
 */
async function readDriveSettings(): Promise<DriveSettings | null> {
  try {
    const client = getLibsql()
    const res = await client.execute({
      sql: `SELECT driveServiceAccountKey, driveSharedDriveId, driveParentFolderId, driveAutoCreate FROM settings WHERE id = 'main' LIMIT 1`,
      args: [],
    })
    if (res.rows.length === 0) return null
    const row = res.rows[0] as Record<string, unknown>
    return {
      driveServiceAccountKey: (row.driveServiceAccountKey as string | null) ?? null,
      driveSharedDriveId: (row.driveSharedDriveId as string | null) ?? null,
      driveParentFolderId: (row.driveParentFolderId as string | null) ?? null,
      driveAutoCreate: Boolean(Number(row.driveAutoCreate ?? 0)),
    }
  } catch (error) {
    console.error('[DRIVE] readDriveSettings error:', error)
    return null
  }
}

// Indonesian month names
const BULAN_INDONESIA = [
  '01 Januari', '02 Februari', '03 Maret', '04 April',
  '05 Mei', '06 Juni', '07 Juli', '08 Agustus',
  '09 September', '10 Oktober', '11 November', '12 Desember'
]

// Indonesian month names (plain, no numeric prefix) — used for building
// human-readable folder name prefixes like "8 Juli 2026".
const BULAN_SINGKAT = [
  'Januari', 'Februari', 'Maret', 'April',
  'Mei', 'Juni', 'Juli', 'Agustus',
  'September', 'Oktober', 'November', 'Desember'
]

/**
 * Format an executionTime value (datetime-local string like "2026-07-08T14:30"
 * or an ISO date) into an Indonesian date string like "8 Juli 2026".
 *
 * Returns an empty string if the input is empty or cannot be parsed, so the
 * folder name falls back to just the project title (no broken prefixes).
 *
 * Time component is intentionally dropped — the folder name should reflect
 * the event DATE, not the event time, for easy per-date browsing in Drive.
 */
function formatTanggalIndonesia(executionTime?: string): string {
  if (!executionTime || typeof executionTime !== 'string') return ''
  // Trim and normalize; reject clearly invalid values
  const trimmed = executionTime.trim()
  if (!trimmed) return ''
  const d = new Date(trimmed)
  if (isNaN(d.getTime())) return ''
  const day = d.getDate()
  const month = BULAN_SINGKAT[d.getMonth()]
  const year = d.getFullYear()
  return `${day} ${month} ${year}`
}

/**
 * Build the main project folder name.
 *
 * Format: "{tanggal pelaksanaan} - {judul proyek}"
 *   e.g. "8 Juli 2026 - UM Mandiri 2026"
 *
 * If executionTime is empty or invalid, falls back to just the project title
 * (preserving backward compatibility for projects initiated without a date).
 *
 * The date prefix makes it easy for managers to locate folders by event date
 * when retrieving activity evidence from Google Drive.
 */
function buildProjectFolderName(projectTitle: string, executionTime?: string): string {
  const tanggal = formatTanggalIndonesia(executionTime)
  if (tanggal) {
    return `${tanggal} - ${projectTitle}`
  }
  return projectTitle
}

// Find or create a category folder inside a parent folder (e.g. PROJECT, SURAT, KEGIATAN)
async function findOrCreateCategoryFolder(
  accessToken: string,
  sharedDriveId: string,
  parentFolderId: string,
  categoryName: string
): Promise<string> {
  const folders = await listFoldersByName(accessToken, sharedDriveId, categoryName)

  if (folders.length > 0) {
    for (const f of folders) {
      if (f.id) {
        const parentList = await getFileParents(accessToken, f.id)
        if (parentList.includes(parentFolderId)) {
          console.log(`[DRIVE] Found existing category folder: ${categoryName} (${f.id})`)
          return f.id
        }
      }
    }
  }

  // Create if not found
  const folder = await createFolder(accessToken, categoryName, parentFolderId, sharedDriveId)
  console.log(`[DRIVE] Created category folder: ${categoryName} (${folder.id})`)
  return folder.id
}

// Find or create Year > Month folder hierarchy in Google Drive
// Returns the Month folder ID where the project/surat folder should be placed
async function findOrCreateYearMonthFolder(
  accessToken: string,
  sharedDriveId: string,
  rootParentId: string | null,
  date: Date
): Promise<string> {
  const year = date.getFullYear().toString()
  const monthName = BULAN_INDONESIA[date.getMonth()]

  // Search for existing Year folder
  const yearFolders = await listFoldersByName(accessToken, sharedDriveId, year)

  let yearFolderId: string | null = null

  // Find the Year folder that is a direct child of root
  if (yearFolders.length > 0) {
    for (const f of yearFolders) {
      if (f.id) {
        // Check if this folder's parent matches our root
        const parentList = await getFileParents(accessToken, f.id)
        if (parentList.includes(rootParentId || '') || parentList.includes(sharedDriveId)) {
          yearFolderId = f.id
          break
        }
      }
    }
  }

  // Create Year folder if not found
  if (!yearFolderId) {
    const yearFolder = await createFolder(accessToken, year, rootParentId, sharedDriveId)
    yearFolderId = yearFolder.id
    console.log(`[DRIVE] Created Year folder: ${year} (${yearFolderId})`)
  } else {
    console.log(`[DRIVE] Found existing Year folder: ${year} (${yearFolderId})`)
  }

  // Search for existing Month folder inside Year folder
  const monthFolders = await listFoldersByName(accessToken, sharedDriveId, monthName)

  let monthFolderId: string | null = null

  if (monthFolders.length > 0) {
    for (const f of monthFolders) {
      if (f.id) {
        const parentList = await getFileParents(accessToken, f.id)
        if (parentList.includes(yearFolderId)) {
          monthFolderId = f.id
          break
        }
      }
    }
  }

  // Create Month folder if not found
  if (!monthFolderId) {
    const monthFolder = await createFolder(accessToken, monthName, yearFolderId, sharedDriveId)
    monthFolderId = monthFolder.id
    console.log(`[DRIVE] Created Month folder: ${monthName} (${monthFolderId})`)
  } else {
    console.log(`[DRIVE] Found existing Month folder: ${monthName} (${monthFolderId})`)
  }

  return monthFolderId
}

// Create a folder in Google Drive (supports Shared Drives)
// Wrapper around the native fetch-based createDriveFolder helper.
async function createFolder(
  accessToken: string,
  name: string,
  parentId: string | null,
  sharedDriveId?: string | null
): Promise<CreatedFolder> {
  const result = await createDriveFolder(accessToken, {
    name,
    parentId,
    sharedDriveId: sharedDriveId || '',
  })

  return {
    id: result.id,
    name: result.name,
    webViewLink: result.webViewLink,
    folderId: result.id,
  }
}

// Share folder with anyone who has the link
// This allows access WITHOUT requiring a Google account
// Uses the native fetch-based shareWithAnyone helper (no googleapis needed).
async function shareWithLink(
  accessToken: string,
  folderId: string,
  role: 'reader' | 'writer' = 'writer'
): Promise<boolean> {
  const ok = await shareWithAnyone(accessToken, folderId, role)
  if (ok) {
    console.log('[DRIVE] Successfully shared folder with link:', folderId)
  } else {
    console.error('[DRIVE] Failed to share with link:', folderId)
  }
  return ok
}

// Generate user code from name (e.g., "Ahmad Fauzi" -> "AF")
function generateUserCode(userName: string): string {
  const nameParts = userName.split(' ')
  return nameParts.length >= 2
    ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
    : userName.substring(0, 2).toUpperCase()
}

// Create output-type subfolders inside a user's subfolder
async function createOutputSubfolders(
  accessToken: string,
  parentFolderId: string,
  parentFolderType: string,
  userSubfolderId: string,
  userName: string,
  outputTypes: string[],
  customOutput: string | undefined,
  sharedDriveId: string,
  createdFolders: CreatedFolder[]
): Promise<void> {
  for (let i = 0; i < outputTypes.length; i++) {
    const outputType = outputTypes[i]
    const outputName = outputType === 'Lainnya' && customOutput
      ? customOutput
      : outputType

    const outputSubfolder = await createFolder(
      accessToken,
      outputName,
      parentFolderId,
      sharedDriveId
    )

    createdFolders.push({
      ...outputSubfolder,
      folderId: `${userSubfolderId}-output-${i}`
    })

    console.log(`[DRIVE] Created output subfolder "${outputName}" inside ${parentFolderType} for ${userName}`)
  }
}

// Create user subfolders inside a parent folder
// Always creates: Parent > AM_Ahmad_Reporter/ > Foto/, Video/, etc.
// Structure applies to ALL stages (including Fast Track)
async function createUserSubfolders(
  accessToken: string,
  parentFolderId: string,
  parentFolderType: string,
  users: AssignedUser[],
  sharedDriveId: string,
  createdFolders: CreatedFolder[],
  workerOutputs?: Record<string, string[]>,
  workerCustomOutput?: Record<string, string>
): Promise<void> {
  for (const user of users) {
    const userCode = generateUserCode(user.userName)
    const subfolderName = `${userCode}_${user.userName.replace(/\s+/g, '_')}_${user.role.replace(/\s*&\s*/g, '_')}`

    // Always create user-named subfolder first
    const userSubfolder = await createFolder(
      accessToken,
      subfolderName,
      parentFolderId,
      sharedDriveId
    )

    const userSubfolderLogicalId = `${parentFolderType}-${user.role.toLowerCase().replace(/\s*&\s*/g, '-')}-${user.userId}`

    createdFolders.push({
      ...userSubfolder,
      folderId: userSubfolderLogicalId
    })

    console.log(`[DRIVE] Created user subfolder "${subfolderName}" inside ${parentFolderType} for ${user.userName} (${user.role})`)

    // Create output-type subfolders inside user's folder when workerOutputs are defined
    // This applies to ALL stages (including Fast Track)
    if (workerOutputs && workerOutputs[user.userId] && workerOutputs[user.userId].length > 0) {
      await createOutputSubfolders(
        accessToken,
        userSubfolder.id,
        parentFolderType,
        userSubfolderLogicalId,
        user.userName,
        workerOutputs[user.userId],
        workerCustomOutput?.[user.userId],
        sharedDriveId,
        createdFolders
      )
    }
  }
}

// POST - Create folders for a project with link sharing
export async function POST(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const body = await request.json()
    const { projectTitle, folderTypes, assignedUsers, folderUserAccess, workerOutputs, workerCustomOutput, executionTime, customFolderDefs } = body as {
      projectTitle: string
      folderTypes: string[]
      assignedUsers?: AssignedUser[] // ALL assigned users with stage info
      folderUserAccess?: Record<string, Record<string, { download: boolean; upload: boolean }>> // DL/UL per folder per user
      workerOutputs?: Record<string, string[]> // userId → list of output types
      workerCustomOutput?: Record<string, string> // userId → custom "Lainnya" text
      executionTime?: string // datetime-local string, e.g. "2026-07-08T14:30" — used to prefix the folder name
      customFolderDefs?: Array<{ id: string; name: string; desc?: string }> // user-created custom folders (id starts with "custom-")
    }

    // Read settings via lightweight libsql (bypasses Prisma + schema sync
    // to avoid exhausting the Cloudflare Workers subrequest limit)
    const settings = await readDriveSettings()

    // NOTE: Folder creation no longer gated on the `driveAutoCreate` toggle.
    // If a Service Account Key + Shared Drive ID are configured, the manager
    // intends for real Drive folders to be created — so we always proceed.
    // This prevents projects from silently falling back to mock folders
    // (which break petugas uploads) just because a separate toggle was off.
    if (!settings?.driveServiceAccountKey) {
      return NextResponse.json({
        error: 'Google Service Account belum dikonfigurasi. Buka menu Pengaturan dan unggah Service Account Key.',
        mockMode: false
      }, { status: 400 })
    }

    // Check for Shared Drive ID (required for Service Accounts without storage quota)
    if (!settings.driveSharedDriveId) {
      return NextResponse.json({
        error: 'Shared Drive ID wajib diisi. Service Account tidak memiliki kuota penyimpanan sendiri. Konfigurasikan Shared Drive ID di Pengaturan.',
        details: 'Service Accounts do not have storage quota. Use a Shared Drive instead.'
      }, { status: 400 })
    }

    // Use cached access token (native Web Crypto API JWT signing — no googleapis)
    const accessToken = await getCachedAccessToken(settings.driveServiceAccountKey)

    // Find or create Year > Month > PROJECT folder structure based on current date
    const now = new Date()
    const monthFolderId = await findOrCreateYearMonthFolder(
      accessToken,
      settings.driveSharedDriveId,
      settings.driveParentFolderId || null,
      now
    )

    // Find or create PROJECT category folder inside the Month folder
    const projectCategoryFolderId = await findOrCreateCategoryFolder(
      accessToken,
      settings.driveSharedDriveId,
      monthFolderId,
      'PROJECT'
    )

    // Create main project folder INSIDE the PROJECT category folder.
    // Folder name is prefixed with the event date (e.g. "8 Juli 2026 - UM Mandiri 2026")
    // so managers can easily locate folders per event date when retrieving
    // activity evidence and other documentation from Google Drive.
    const folderName = buildProjectFolderName(projectTitle, executionTime)
    const mainFolder = await createFolder(
      accessToken,
      folderName,
      projectCategoryFolderId,
      settings.driveSharedDriveId
    )

    console.log(`[DRIVE] Created project folder "${folderName}" in PROJECT/${BULAN_INDONESIA[now.getMonth()]} ${now.getFullYear()}`)

    // Share main folder with anyone who has the link (no Google account required)
    console.log('[DRIVE] Sharing folder with link (anyone with link can edit)...')
    const linkShared = await shareWithLink(accessToken, mainFolder.id, 'writer')
    console.log('[DRIVE] Link sharing result:', linkShared)

    // Create subfolders
    // Standard folder types → predefined names. Custom folders (id starts with
    // "custom-") → use the user-provided name from customFolderDefs.
    // Previously, custom folders were SILENTLY SKIPPED because they weren't in
    // the folderNames lookup — this caused the "folder tidak dibuat otomatis"
    // bug when managers added custom folders during project initiation.
    const folderNames: Record<string, string> = {
      raw: '1. PRODUKSI (Berkas Mentah)',
      revised: '2. PASCA PRODUKSI (Draft & Editing)',
      desain: '3. DESAIN FOLDER (Aset Visual)',
      lainnya: '4. Additional Asset (Tambahan Foto/Footage)'
    }

    // Build a lookup for custom folder definitions so we can resolve names
    // for any folderType that starts with "custom-".
    const customLookup: Record<string, { name: string; desc?: string }> = {}
    if (customFolderDefs && Array.isArray(customFolderDefs)) {
      for (const cf of customFolderDefs) {
        if (cf.id && cf.name) {
          customLookup[cf.id] = { name: cf.name, desc: cf.desc }
        }
      }
    }

    const createdFolders: CreatedFolder[] = []
    const folderIdMap: Record<string, string> = {} // folderType -> Drive folder ID

    for (const folderType of folderTypes) {
      // Resolve the folder name: standard lookup first, then custom folder defs
      let folderNameToUse: string | undefined = folderNames[folderType]
      if (!folderNameToUse && folderType.startsWith('custom-')) {
        const customDef = customLookup[folderType]
        if (customDef) {
          folderNameToUse = customDef.name
        } else {
          // Custom folder ID without a matching definition — skip with a warning
          console.warn(`[DRIVE] Custom folder "${folderType}" has no matching definition in customFolderDefs — skipping`)
          continue
        }
      }

      if (folderNameToUse) {
        const subFolder = await createFolder(
          accessToken,
          folderNameToUse,
          mainFolder.id,
          settings.driveSharedDriveId
        )
        createdFolders.push({
          ...subFolder,
          folderId: folderType
        })
        folderIdMap[folderType] = subFolder.id
        // Subfolders inherit permissions from parent, no need to share individually
      }
    }

    // Create user subfolders based on folderUserAccess (DL/UL checkboxes from Manager)
    // Siapapun yang dicentang UL di folder mana → dapat subfolder di folder tersebut
    const allUsers = assignedUsers || []
    const access = folderUserAccess || {}

    for (const folderType of folderTypes) {
      const parentDriveId = folderIdMap[folderType]
      if (!parentDriveId) continue

      const folderAccess = access[folderType] || {}
      // Cari user yang dicentang UL untuk folder ini
      const usersWithUpload = allUsers.filter(u =>
        folderAccess[u.userId]?.upload
      )

      if (usersWithUpload.length > 0) {
        console.log(`[DRIVE] Creating subfolders in ${folderType} for UL-checked users:`, usersWithUpload.map(u => u.userName).join(', '))
        await createUserSubfolders(accessToken, parentDriveId, folderType, usersWithUpload, settings.driveSharedDriveId, createdFolders, workerOutputs, workerCustomOutput)
      }
    }

    return NextResponse.json({
      success: true,
      mainFolder: mainFolder.webViewLink,
      mainFolderId: mainFolder.id,
      folders: createdFolders,
      linkShared: linkShared,
      sharedDriveId: settings.driveSharedDriveId,
      note: linkShared
        ? 'Folder dapat diakses oleh siapa saja yang memiliki link. Tidak perlu akun Google.'
        : 'Link sharing gagal. Cek permission Service Account.'
    })
  } catch (error) {
    console.error('Create Drive folders error:', error)
    return NextResponse.json({
      error: 'Failed to create folders',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

// PUT - Enable link sharing for existing folder
export async function PUT(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const body = await request.json()
    const { folderId, role } = body as {
      folderId: string
      role?: 'reader' | 'writer'
    }

    // Read settings via lightweight libsql (bypasses Prisma + schema sync)
    const settings = await readDriveSettings()

    if (!settings?.driveServiceAccountKey) {
      return NextResponse.json({
        error: 'Service Account not configured'
      }, { status: 400 })
    }

    const accessToken = await getCachedAccessToken(settings.driveServiceAccountKey)

    // Enable link sharing (works for non-Google accounts too)
    const linkShared = await shareWithLink(accessToken, folderId, role || 'writer')

    return NextResponse.json({
      success: true,
      linkShared,
      note: linkShared
        ? 'Folder dapat diakses oleh siapa saja yang memiliki link.'
        : 'Link sharing gagal.'
    })
  } catch (error) {
    console.error('Share folder error:', error)
    return NextResponse.json({
      error: 'Failed to share folder',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

// GET - Test Google Drive connection
export async function GET(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    // Read settings via lightweight libsql (bypasses Prisma + schema sync
    // to avoid exhausting the Cloudflare Workers subrequest limit)
    const settings = await readDriveSettings()

    if (!settings?.driveServiceAccountKey) {
      return NextResponse.json({
        connected: false,
        message: 'Service Account belum dikonfigurasi'
      })
    }

    if (!settings.driveSharedDriveId) {
      return NextResponse.json({
        connected: false,
        message: 'Shared Drive ID belum dikonfigurasi. Service Account memerlukan Shared Drive untuk penyimpanan.'
      })
    }

    // Use cached access token (native Web Crypto API JWT signing — no googleapis)
    const accessToken = await getCachedAccessToken(settings.driveServiceAccountKey)

    // Test by checking the shared drive via native fetch (1 subrequest)
    const result = await checkSharedDriveAccess(accessToken, settings.driveSharedDriveId)

    if (result.ok) {
      return NextResponse.json({
        connected: true,
        message: 'Koneksi Google Drive berhasil. Shared Drive terdeteksi.'
      })
    }

    return NextResponse.json({
      connected: false,
      message: 'Koneksi gagal: ' + (result.error || 'Shared Drive tidak dapat diakses')
    })
  } catch (error) {
    console.error('Test Drive connection error:', error)
    return NextResponse.json({
      connected: false,
      message: 'Koneksi gagal: ' + (error instanceof Error ? error.message : 'Unknown error')
    })
  }
}
