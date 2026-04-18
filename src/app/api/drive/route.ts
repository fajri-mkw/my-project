import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'
import { google } from 'googleapis'

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

// Indonesian month names
const BULAN_INDONESIA = [
  '01 Januari', '02 Februari', '03 Maret', '04 April',
  '05 Mei', '06 Juni', '07 Juli', '08 Agustus',
  '09 September', '10 Oktober', '11 November', '12 Desember'
]

// Find or create a category folder inside a parent folder (e.g. PROJECT, SURAT, KEGIATAN)
async function findOrCreateCategoryFolder(
  drive: ReturnType<typeof google.drive>,
  sharedDriveId: string,
  parentFolderId: string,
  categoryName: string
): Promise<string> {
  const query = `name='${categoryName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const folders = await drive.files.list({
    q: query,
    corpora: 'drive',
    driveId: sharedDriveId,
    fields: 'files(id, name)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    pageSize: 10
  })

  if (folders.data.files && folders.data.files.length > 0) {
    for (const f of folders.data.files) {
      if (f.id) {
        const parents = await drive.files.get({
          fileId: f.id,
          fields: 'parents',
          supportsAllDrives: true
        })
        const parentList = (parents.data as any).parents || []
        if (parentList.includes(parentFolderId)) {
          console.log(`[DRIVE] Found existing category folder: ${categoryName} (${f.id})`)
          return f.id
        }
      }
    }
  }

  // Create if not found
  const folder = await createFolder(drive, categoryName, parentFolderId, sharedDriveId)
  console.log(`[DRIVE] Created category folder: ${categoryName} (${folder.id})`)
  return folder.id
}

// Find or create Year > Month folder hierarchy in Google Drive
// Returns the Month folder ID where the project/surat folder should be placed
async function findOrCreateYearMonthFolder(
  drive: ReturnType<typeof google.drive>,
  sharedDriveId: string,
  rootParentId: string | null,
  date: Date
): Promise<string> {
  const year = date.getFullYear().toString()
  const monthName = BULAN_INDONESIA[date.getMonth()]

  // Search for existing Year folder
  const yearQuery = `name='${year}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const yearFolders = await drive.files.list({
    q: yearQuery,
    corpora: 'drive',
    driveId: sharedDriveId,
    fields: 'files(id, name)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    pageSize: 10
  })

  let yearFolderId: string | null = null

  // Find the Year folder that is a direct child of root
  if (yearFolders.data.files && yearFolders.data.files.length > 0) {
    for (const f of yearFolders.data.files) {
      if (f.id) {
        // Check if this folder's parent matches our root
        const parents = await drive.files.get({
          fileId: f.id,
          fields: 'parents',
          supportsAllDrives: true
        })
        const parentList = (parents.data as any).parents || []
        if (parentList.includes(rootParentId) || parentList.includes(sharedDriveId)) {
          yearFolderId = f.id
          break
        }
      }
    }
  }

  // Create Year folder if not found
  if (!yearFolderId) {
    const yearFolder = await createFolder(drive, year, rootParentId, sharedDriveId)
    yearFolderId = yearFolder.id
    console.log(`[DRIVE] Created Year folder: ${year} (${yearFolderId})`)
  } else {
    console.log(`[DRIVE] Found existing Year folder: ${year} (${yearFolderId})`)
  }

  // Search for existing Month folder inside Year folder
  const monthQuery = `name='${monthName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const monthFolders = await drive.files.list({
    q: monthQuery,
    corpora: 'drive',
    driveId: sharedDriveId,
    fields: 'files(id, name)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    pageSize: 10
  })

  let monthFolderId: string | null = null

  if (monthFolders.data.files && monthFolders.data.files.length > 0) {
    for (const f of monthFolders.data.files) {
      if (f.id) {
        const parents = await drive.files.get({
          fileId: f.id,
          fields: 'parents',
          supportsAllDrives: true
        })
        const parentList = (parents.data as any).parents || []
        if (parentList.includes(yearFolderId)) {
          monthFolderId = f.id
          break
        }
      }
    }
  }

  // Create Month folder if not found
  if (!monthFolderId) {
    const monthFolder = await createFolder(drive, monthName, yearFolderId, sharedDriveId)
    monthFolderId = monthFolder.id
    console.log(`[DRIVE] Created Month folder: ${monthName} (${monthFolderId})`)
  } else {
    console.log(`[DRIVE] Found existing Month folder: ${monthName} (${monthFolderId})`)
  }

  return monthFolderId
}

// Create Google Drive client from service account
function getDriveClient(serviceAccountKey: string) {
  const credentials = JSON.parse(serviceAccountKey)
  
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive']
  })
  
  return google.drive({ version: 'v3', auth })
}

// Create a folder in Google Drive (supports Shared Drives)
async function createFolder(
  drive: ReturnType<typeof google.drive>,
  name: string,
  parentId: string | null,
  sharedDriveId?: string | null
): Promise<CreatedFolder> {
  const fileMetadata: {
    name: string
    mimeType: string
    parents?: string[]
    driveId?: string
  } = {
    name,
    mimeType: 'application/vnd.google-apps.folder'
  }
  
  // If we have a shared drive, use it
  if (sharedDriveId) {
    fileMetadata.driveId = sharedDriveId
    if (parentId) {
      fileMetadata.parents = [parentId]
    } else {
      // If no parent, create in root of shared drive
      fileMetadata.parents = [sharedDriveId]
    }
  } else if (parentId) {
    fileMetadata.parents = [parentId]
  }
  
  const response = await drive.files.create({
    requestBody: fileMetadata,
    fields: 'id, name, webViewLink',
    supportsAllDrives: true // Required for Shared Drives
  })
  
  return {
    id: response.data.id!,
    name: response.data.name!,
    webViewLink: response.data.webViewLink!,
    folderId: response.data.id!
  }
}

// Share folder with anyone who has the link
// This allows access WITHOUT requiring a Google account
async function shareWithLink(
  drive: ReturnType<typeof google.drive>,
  folderId: string,
  role: 'reader' | 'writer' = 'writer'
): Promise<boolean> {
  try {
    await drive.permissions.create({
      fileId: folderId,
      requestBody: {
        type: 'anyone',
        role: role,
        allowFileDiscovery: false
      },
      supportsAllDrives: true
    })
    console.log('[DRIVE] Successfully shared folder with link:', folderId)
    return true
  } catch (error) {
    console.error('[DRIVE] Failed to share with link:', error)
    return false
  }
}

// Generate user code from name (e.g., "Ahmad Fauzi" -> "AF")
function generateUserCode(userName: string): string {
  const nameParts = userName.split(' ')
  return nameParts.length >= 2 
    ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
    : userName.substring(0, 2).toUpperCase()
}

// Create user subfolders inside a parent folder
async function createUserSubfolders(
  drive: ReturnType<typeof google.drive>,
  parentFolderId: string,
  parentFolderType: string,
  users: AssignedUser[],
  sharedDriveId: string,
  createdFolders: CreatedFolder[]
): Promise<void> {
  for (const user of users) {
    const userCode = generateUserCode(user.userName)
    const subfolderName = `${userCode}_${user.userName.replace(/\s+/g, '_')}_${user.role.replace(/\s*&\s*/g, '_')}`
    
    const userSubfolder = await createFolder(
      drive,
      subfolderName,
      parentFolderId,
      sharedDriveId
    )
    
    createdFolders.push({
      ...userSubfolder,
      folderId: `${parentFolderType}-${user.role.toLowerCase().replace(/\s*&\s*/g, '-')}-${user.userId}`
    })
    
    console.log(`[DRIVE] Created user subfolder "${subfolderName}" inside ${parentFolderType} for ${user.userName} (${user.role})`)
  }
}

// POST - Create folders for a project with link sharing
export async function POST(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const body = await request.json()
    const { projectTitle, folderTypes, assignedUsers, folderUserAccess } = body as {
      projectTitle: string
      folderTypes: string[]
      assignedUsers?: AssignedUser[] // ALL assigned users with stage info
      folderUserAccess?: Record<string, Record<string, { download: boolean; upload: boolean }>> // DL/UL per folder per user
    }
    
    // Get settings
    const settings = await db.settings.findUnique({
      where: { id: 'main' }
    })
    
    if (!settings?.driveAutoCreate) {
      return NextResponse.json({ 
        error: 'Google Drive auto-create is disabled',
        mockMode: true
      }, { status: 400 })
    }
    
    if (!settings.driveServiceAccountKey) {
      return NextResponse.json({ 
        error: 'Google Service Account not configured',
        mockMode: true
      }, { status: 400 })
    }
    
    // Check for Shared Drive ID (required for Service Accounts without storage quota)
    if (!settings.driveSharedDriveId) {
      return NextResponse.json({ 
        error: 'Shared Drive ID is required. Service Accounts do not have storage quota. Please configure a Shared Drive ID in settings.',
        details: 'Service Accounts do not have storage quota. Use a Shared Drive instead.'
      }, { status: 400 })
    }
    
    const drive = getDriveClient(settings.driveServiceAccountKey)
    
    // Find or create Year > Month > PROJECT folder structure based on current date
    const now = new Date()
    const monthFolderId = await findOrCreateYearMonthFolder(
      drive,
      settings.driveSharedDriveId,
      settings.driveParentFolderId || null,
      now
    )
    
    // Find or create PROJECT category folder inside the Month folder
    const projectCategoryFolderId = await findOrCreateCategoryFolder(
      drive,
      settings.driveSharedDriveId,
      monthFolderId,
      'PROJECT'
    )
    
    // Create main project folder INSIDE the PROJECT category folder
    const mainFolder = await createFolder(
      drive,
      projectTitle,
      projectCategoryFolderId,
      settings.driveSharedDriveId
    )
    
    console.log(`[DRIVE] Created project folder "${projectTitle}" in PROJECT/${BULAN_INDONESIA[now.getMonth()]} ${now.getFullYear()}`)
    
    // Share main folder with anyone who has the link (no Google account required)
    console.log('[DRIVE] Sharing folder with link (anyone with link can edit)...')
    const linkShared = await shareWithLink(drive, mainFolder.id, 'writer')
    console.log('[DRIVE] Link sharing result:', linkShared)
    
    // Create subfolders
    const folderNames: Record<string, string> = {
      raw: '1. RAW FOLDER (Hasil Mentah)',
      revised: '2. REVISED FOLDER (Draft & Editing)',
      final: '3. FINAL PRODUCT (Siap Publish)',
      desain: '4. DESAIN FOLDER (Aset Visual)',
      lainnya: '5. LAINNYA (Folder Tambahan)'
    }
    
    const createdFolders: CreatedFolder[] = []
    const folderIdMap: Record<string, string> = {} // folderType -> Drive folder ID
    
    for (const folderType of folderTypes) {
      if (folderNames[folderType]) {
        const subFolder = await createFolder(
          drive,
          folderNames[folderType],
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
        await createUserSubfolders(drive, parentDriveId, folderType, usersWithUpload, settings.driveSharedDriveId, createdFolders)
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
    
    const settings = await db.settings.findUnique({
      where: { id: 'main' }
    })
    
    if (!settings?.driveServiceAccountKey) {
      return NextResponse.json({ 
        error: 'Service Account not configured'
      }, { status: 400 })
    }
    
    const drive = getDriveClient(settings.driveServiceAccountKey)
    
    // Enable link sharing (works for non-Google accounts too)
    const linkShared = await shareWithLink(drive, folderId, role || 'writer')
    
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
    const settings = await db.settings.findUnique({
      where: { id: 'main' }
    })
    
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
    
    const drive = getDriveClient(settings.driveServiceAccountKey)
    
    // Test by checking the shared drive
    try {
      await drive.drives.get({
        driveId: settings.driveSharedDriveId
      })
      
      return NextResponse.json({ 
        connected: true,
        message: 'Koneksi Google Drive berhasil. Shared Drive terdeteksi.'
      })
    } catch {
      // Try listing files if drives.get fails
      await drive.files.list({
        pageSize: 1,
        fields: 'files(id, name)',
        corpora: 'drive',
        driveId: settings.driveSharedDriveId,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
      })
      
      return NextResponse.json({ 
        connected: true,
        message: 'Koneksi Google Drive berhasil'
      })
    }
  } catch (error) {
    console.error('Test Drive connection error:', error)
    return NextResponse.json({ 
      connected: false,
      message: 'Koneksi gagal: ' + (error instanceof Error ? error.message : 'Unknown error')
    })
  }
}
