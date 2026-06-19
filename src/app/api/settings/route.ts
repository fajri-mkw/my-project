import { db, ensureDbConnection } from '@/lib/db'
import { invalidateMaintenanceCache } from '@/lib/maintenance-check'
import { sanitizeServiceAccountKey, validateServiceAccountKeyString } from '@/lib/drive-service'
import { NextRequest, NextResponse } from 'next/server'

// GET settings
export async function GET() {
  try {
    await ensureDbConnection()
    let settings = await db.settings.findUnique({
      where: { id: 'main' }
    })

    if (!settings) {
      settings = await db.settings.create({
        data: { id: 'main' }
      })
    }

    // Don't return the full service account key for security
    return NextResponse.json({
      driveAutoCreate: settings.driveAutoCreate || false,
      driveParentFolderId: settings.driveParentFolderId || '',
      driveSharedDriveId: settings.driveSharedDriveId || '',
      hasServiceAccountKey: !!settings.driveServiceAccountKey,
      driveApiKey: settings.driveApiKey || '',
      maintenanceMode: settings.maintenanceMode || false,
      maintenanceMessage: settings.maintenanceMessage || ''
    })
  } catch (error) {
    console.error('Get settings error:', error)
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 })
  }
}

// PUT update settings
export async function PUT(request: NextRequest) {
  try {
    await ensureDbConnection()
    const body = await request.json()
    const { driveAutoCreate, driveParentFolderId, driveSharedDriveId, driveServiceAccountKey, driveApiKey, maintenanceMode, maintenanceMessage } = body

    const updateData: {
      driveAutoCreate?: boolean
      driveParentFolderId?: string | null
      driveSharedDriveId?: string | null
      driveServiceAccountKey?: string | null
      driveApiKey?: string | null
      maintenanceMode?: boolean
      maintenanceMessage?: string | null
    } = {}

    if (typeof driveAutoCreate === 'boolean') {
      updateData.driveAutoCreate = driveAutoCreate
    }
    if (driveParentFolderId !== undefined) {
      updateData.driveParentFolderId = driveParentFolderId || null
    }
    if (driveSharedDriveId !== undefined) {
      updateData.driveSharedDriveId = driveSharedDriveId || null
    }
    if (driveServiceAccountKey !== undefined) {
      if (driveServiceAccountKey) {
        // Validate & sanitize the service account key before storing it.
        // This prevents "Bad control character in string literal" errors
        // when the key is later parsed by getDriveClient().
        const validation = validateServiceAccountKeyString(driveServiceAccountKey)
        if (!validation.valid) {
          return NextResponse.json({
            error: 'Service Account Key tidak valid',
            details: validation.error
          }, { status: 400 })
        }
        // Store the sanitized (clean JSON) form so future parses always work
        updateData.driveServiceAccountKey = sanitizeServiceAccountKey(driveServiceAccountKey)
        console.log('[SETTINGS] Service account key saved & sanitized:', {
          clientEmail: validation.clientEmail,
          projectId: validation.projectId
        })
      } else {
        updateData.driveServiceAccountKey = null
      }
    }
    if (driveApiKey !== undefined) {
      updateData.driveApiKey = driveApiKey || null
    }
    if (typeof maintenanceMode === 'boolean') {
      updateData.maintenanceMode = maintenanceMode
    }
    if (maintenanceMessage !== undefined) {
      updateData.maintenanceMessage = maintenanceMessage || null
    }

    const settings = await db.settings.upsert({
      where: { id: 'main' },
      update: updateData,
      create: {
        id: 'main',
        ...updateData
      }
    })

    // Invalidate maintenance mode cache when settings change
    if (typeof maintenanceMode === 'boolean' || maintenanceMessage !== undefined) {
      invalidateMaintenanceCache()
    }

    return NextResponse.json({
      success: true,
      driveAutoCreate: settings.driveAutoCreate || false,
      driveParentFolderId: settings.driveParentFolderId || '',
      driveSharedDriveId: settings.driveSharedDriveId || '',
      hasServiceAccountKey: !!settings.driveServiceAccountKey,
      driveApiKey: settings.driveApiKey || '',
      maintenanceMode: settings.maintenanceMode || false,
      maintenanceMessage: settings.maintenanceMessage || ''
    })
  } catch (error) {
    console.error('Update settings error:', error)
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 })
  }
}
