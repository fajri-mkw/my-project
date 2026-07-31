import { db, ensureDbConnection } from '@/lib/db'
import { invalidateMaintenanceCache } from '@/lib/maintenance-check'
import { sanitizeServiceAccountKey, validateServiceAccountKeyString } from '@/lib/drive-service'
import { NextRequest, NextResponse } from 'next/server'
import { withEdgeCache, invalidateCache } from '@/lib/edge-cache'

// GET settings
// Edge-cached for 30s to reduce CPU usage on Workers free plan
export const GET = withEdgeCache(async (_request: NextRequest) => {
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
}, { ttl: 30 })

// PUT update settings
//
// SAFEGUARD against "Drive auto-create deactivates itself" bug:
// The Shared Drive ID, Parent Folder ID, and Service Account Key are treated
// as "protected" fields. If a PUT request sends an EMPTY value for one of
// these fields but the DB already has a NON-EMPTY value, the empty value is
// IGNORED (the existing value is preserved). This prevents accidental wiping
// when the frontend form fails to load current values (e.g. cold-start 5xx on
// Cloudflare Workers free plan) and the user clicks "Save" — the empty form
// state would otherwise overwrite the real DB values with null.
//
// To EXPLICITLY clear a protected field (e.g. admin wants to disconnect Drive),
// the request must include `forceClear: true` OR send the field as an explicit
// `null` with `forceClear: true`. An empty string alone is treated as an
// accidental submission and is ignored.
export async function PUT(request: NextRequest) {
  try {
    await ensureDbConnection()
    const body = await request.json()
    const { driveAutoCreate, driveParentFolderId, driveSharedDriveId, driveServiceAccountKey, driveApiKey, maintenanceMode, maintenanceMessage, forceClear } = body

    // Fetch the existing settings so we can protect non-empty values from
    // being overwritten by accidental empty-string submissions.
    const existing = await db.settings.findUnique({ where: { id: 'main' } })

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
      // Protected field: don't overwrite an existing non-empty value with
      // an empty string unless forceClear is explicitly true.
      const newVal = driveParentFolderId || null
      const oldVal = existing?.driveParentFolderId || null
      if (newVal || !oldVal || forceClear === true) {
        updateData.driveParentFolderId = newVal
      } else {
        console.warn('[SETTINGS] Ignored empty driveParentFolderId (existing value preserved). Pass forceClear:true to override.')
      }
    }
    if (driveSharedDriveId !== undefined) {
      // Protected field: same safeguard as driveParentFolderId.
      const newVal = driveSharedDriveId || null
      const oldVal = existing?.driveSharedDriveId || null
      if (newVal || !oldVal || forceClear === true) {
        updateData.driveSharedDriveId = newVal
      } else {
        console.warn('[SETTINGS] Ignored empty driveSharedDriveId (existing value preserved). Pass forceClear:true to override.')
      }
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
      } else if (forceClear === true) {
        // Only clear the service account key if explicitly requested.
        updateData.driveServiceAccountKey = null
        console.log('[SETTINGS] Service account key cleared (forceClear:true)')
      } else {
        console.warn('[SETTINGS] Ignored empty driveServiceAccountKey (existing value preserved). Pass forceClear:true to override.')
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

    // Use findUnique + update/create instead of upsert.
    // The upsert() call was causing 500 errors on Turso/libsql adapter
    // (the GET route uses the same findUnique+create pattern successfully,
    //  but upsert consistently failed — likely an adapter quirk with the
    //  @updatedAt field on the update path). This mirrors the GET pattern.
    let settings = existing
    if (!settings) {
      settings = await db.settings.create({
        data: { id: 'main', ...updateData }
      })
    } else if (Object.keys(updateData).length > 0) {
      settings = await db.settings.update({
        where: { id: 'main' },
        data: updateData
      })
    }

    // Invalidate maintenance mode cache when settings change
    if (typeof maintenanceMode === 'boolean' || maintenanceMessage !== undefined) {
      invalidateMaintenanceCache()
    }

    await invalidateCache('/api/settings')
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
    // Return detailed error info so the frontend can show a useful message
    const errMsg = error instanceof Error ? error.message : String(error)
    return NextResponse.json(
      { error: 'Failed to update settings', details: errMsg },
      { status: 500 }
    )
  }
}
