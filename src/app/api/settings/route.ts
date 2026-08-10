import { NextRequest, NextResponse } from 'next/server'
import { invalidateMaintenanceCache } from '@/lib/maintenance-check'
import { sanitizeServiceAccountKey, validateServiceAccountKeyString } from '@/lib/drive-service'
import { withEdgeCache, invalidateCache } from '@/lib/edge-cache'
import {
  getLibsql,
  toBool,
  bind,
  nowMs,
  type InValue,
} from '@/lib/libsql-client'

// ============================================================================
// CRITICAL: This route is called on every dashboard page load AND when the
// settings view loads. The previous version imported `db, ensureDbConnection`
// from '@/lib/db' (Prisma), which on Cloudflare Workers free plan burns CPU on
// Prisma module-load + ensureSchemaSync subrequests and was a contributing
// cause of recurring Error 1102.
//
// Rewritten to use @libsql/client directly via @/lib/libsql-client — same pattern
// as src/app/api/maintenance/route.ts and src/app/api/users/route.ts.
// ============================================================================

// Settings columns used by this route (GET selects these; PUT may update any subset).
const SETTINGS_COLUMNS = `id, driveAutoCreate, driveParentFolderId, driveSharedDriveId,
  driveServiceAccountKey, driveApiKey, maintenanceMode, maintenanceMessage,
  notifWaEnabled, notifWaToken, notifWaDeviceId, notifWaSenderNumber,
  notifEmailEnabled, notifEmailHost, notifEmailPort, notifEmailUser, notifEmailPass,
  notifEmailFromName, updatedAt`

/** Boolean columns in the settings table (Prisma Boolean → SQLite 0/1). */
const BOOLEAN_SETTINGS_KEYS = new Set([
  'driveAutoCreate',
  'maintenanceMode',
  'notifWaEnabled',
  'notifEmailEnabled',
])

/** Format a settings row as the GET response object (matches original Prisma shape). */
function formatSettingsResponse(row: Record<string, unknown>) {
  return {
    driveAutoCreate: toBool(row.driveAutoCreate),
    driveParentFolderId: row.driveParentFolderId === null || row.driveParentFolderId === undefined ? '' : String(row.driveParentFolderId),
    driveSharedDriveId: row.driveSharedDriveId === null || row.driveSharedDriveId === undefined ? '' : String(row.driveSharedDriveId),
    hasServiceAccountKey: !!row.driveServiceAccountKey,
    driveApiKey: row.driveApiKey === null || row.driveApiKey === undefined ? '' : String(row.driveApiKey),
    maintenanceMode: toBool(row.maintenanceMode),
    maintenanceMessage: row.maintenanceMessage === null || row.maintenanceMessage === undefined ? '' : String(row.maintenanceMessage),
  }
}

/** Fetch the single 'main' settings row, or null if it doesn't exist yet. */
async function fetchSettingsRow(client: ReturnType<typeof getLibsql>): Promise<Record<string, unknown> | null> {
  const res = await client.execute({
    sql: `SELECT ${SETTINGS_COLUMNS} FROM settings WHERE id = 'main' LIMIT 1`,
    args: [],
  })
  if (res.rows.length === 0) return null
  return res.rows[0] as Record<string, unknown>
}

// GET settings
// Edge-cached for 30s to reduce CPU usage on Workers free plan
export const GET = withEdgeCache(async (_request: NextRequest) => {
  try {
    const client = getLibsql()
    let settings = await fetchSettingsRow(client)

    if (!settings) {
      // Mirror original `db.settings.create({ data: { id: 'main' } })` —
      // create a bare row with id='main' (other columns default to NULL in SQLite,
      // which the response shape treats the same as Prisma's default `false`/`''`).
      await client.execute({
        sql: `INSERT INTO settings (id, updatedAt) VALUES ('main', ?)`,
        args: [bind(nowMs())],
      })
      settings = await fetchSettingsRow(client)
      if (!settings) {
        // Defensive: should never happen, but fail-safe.
        return NextResponse.json(formatSettingsResponse({}))
      }
    }

    return NextResponse.json(formatSettingsResponse(settings))
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
    const client = getLibsql()
    const body = await request.json()
    const { driveAutoCreate, driveParentFolderId, driveSharedDriveId, driveServiceAccountKey, driveApiKey, maintenanceMode, maintenanceMessage, forceClear } = body

    // Fetch the existing settings so we can protect non-empty values from
    // being overwritten by accidental empty-string submissions.
    const existing = await fetchSettingsRow(client)

    // updateData: colName → raw JS value (boolean/string/null). Booleans are
    // converted to 0/1 at bind time. We preserve original column-name keys
    // (no @map renames in the Settings model — column === field).
    const updateData: Record<string, unknown> = {}

    if (typeof driveAutoCreate === 'boolean') {
      updateData.driveAutoCreate = driveAutoCreate
    }
    if (driveParentFolderId !== undefined) {
      // Protected field: don't overwrite an existing non-empty value with
      // an empty string unless forceClear is explicitly true.
      const newVal = driveParentFolderId || null
      const oldVal =
        existing?.driveParentFolderId === null || existing?.driveParentFolderId === undefined
          ? null
          : String(existing.driveParentFolderId)
      if (newVal || !oldVal || forceClear === true) {
        updateData.driveParentFolderId = newVal
      } else {
        console.warn('[SETTINGS] Ignored empty driveParentFolderId (existing value preserved). Pass forceClear:true to override.')
      }
    }
    if (driveSharedDriveId !== undefined) {
      // Protected field: same safeguard as driveParentFolderId.
      const newVal = driveSharedDriveId || null
      const oldVal =
        existing?.driveSharedDriveId === null || existing?.driveSharedDriveId === undefined
          ? null
          : String(existing.driveSharedDriveId)
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
    if (!existing) {
      // INSERT new row: id='main' + updateData + updatedAt.
      const cols = ['id', ...Object.keys(updateData), 'updatedAt']
      const vals: InValue[] = [bind('main')]
      for (const [k, v] of Object.entries(updateData)) {
        if (BOOLEAN_SETTINGS_KEYS.has(k)) {
          vals.push(bind(v ? 1 : 0))
        } else {
          vals.push(bind(v))
        }
      }
      vals.push(bind(nowMs()))
      const placeholders = cols.map(() => '?').join(', ')
      await client.execute({
        sql: `INSERT INTO settings (${cols.join(', ')}) VALUES (${placeholders})`,
        args: vals,
      })
    } else if (Object.keys(updateData).length > 0) {
      // UPDATE existing row.
      const setClauses: string[] = []
      const args: InValue[] = []
      for (const [k, v] of Object.entries(updateData)) {
        if (BOOLEAN_SETTINGS_KEYS.has(k)) {
          setClauses.push(`${k} = ?`)
          args.push(bind(v ? 1 : 0))
        } else {
          setClauses.push(`${k} = ?`)
          args.push(bind(v))
        }
      }
      setClauses.push('updatedAt = ?')
      args.push(bind(nowMs()))
      args.push(bind('main'))
      await client.execute({
        sql: `UPDATE settings SET ${setClauses.join(', ')} WHERE id = ?`,
        args,
      })
    }

    // Invalidate maintenance mode cache when settings change
    if (typeof maintenanceMode === 'boolean' || maintenanceMessage !== undefined) {
      invalidateMaintenanceCache()
    }

    await invalidateCache('/api/settings')
    // Also bust the maintenance GET cache if maintenance mode changed (so the
    // AppShell banner updates immediately).
    if (typeof maintenanceMode === 'boolean' || maintenanceMessage !== undefined) {
      await invalidateCache('/api/maintenance')
    }

    // Fetch the final row state (mirrors Prisma's update returning the row).
    const finalRow = await fetchSettingsRow(client)
    const response = finalRow
      ? formatSettingsResponse(finalRow)
      : formatSettingsResponse({})

    return NextResponse.json({
      success: true,
      ...response,
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
