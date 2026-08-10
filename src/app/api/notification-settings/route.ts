import { NextRequest, NextResponse } from 'next/server'
import { sendTestNotification } from '@/lib/notification-service'
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

// Notification-related columns on the settings table (single row, id='main').
const NOTIF_SETTINGS_COLUMNS = `id, notifWaEnabled, notifWaToken, notifWaDeviceId,
  notifWaSenderNumber, notifEmailEnabled, notifEmailHost, notifEmailPort,
  notifEmailUser, notifEmailPass, notifEmailFromName, updatedAt`

/** Boolean columns among notification settings (Prisma Boolean → SQLite 0/1). */
const BOOLEAN_NOTIF_KEYS = new Set(['notifWaEnabled', 'notifEmailEnabled'])

/** Integer columns among notification settings. */
const INT_NOTIF_KEYS = new Set(['notifEmailPort'])

// Helper to mask secrets (kept identical to the original).
function maskSecret(val: string | null): string {
  if (!val) return ''
  if (val.length <= 6) return '••••••'
  return val.slice(0, 3) + '••••••' + val.slice(-3)
}

/** Convert a raw notif settings row to the GET response shape (matches original). */
function formatNotifSettingsResponse(row: Record<string, unknown>) {
  const notifWaToken =
    row.notifWaToken === null || row.notifWaToken === undefined ? null : String(row.notifWaToken)
  const notifEmailPass =
    row.notifEmailPass === null || row.notifEmailPass === undefined ? null : String(row.notifEmailPass)
  const notifEmailPort =
    row.notifEmailPort === null || row.notifEmailPort === undefined ? null : Number(row.notifEmailPort)
  return {
    notifWaEnabled: toBool(row.notifWaEnabled),
    hasNotifWaToken: !!notifWaToken,
    notifWaTokenMasked: maskSecret(notifWaToken),
    notifWaDeviceId: row.notifWaDeviceId === null || row.notifWaDeviceId === undefined ? '' : String(row.notifWaDeviceId),
    notifWaSenderNumber: row.notifWaSenderNumber === null || row.notifWaSenderNumber === undefined ? '' : String(row.notifWaSenderNumber),
    notifEmailEnabled: toBool(row.notifEmailEnabled),
    hasNotifEmailPass: !!notifEmailPass,
    notifEmailPassMasked: maskSecret(notifEmailPass),
    notifEmailHost: row.notifEmailHost === null || row.notifEmailHost === undefined ? '' : String(row.notifEmailHost),
    notifEmailPort: notifEmailPort ?? 587,
    notifEmailUser: row.notifEmailUser === null || row.notifEmailUser === undefined ? '' : String(row.notifEmailUser),
    notifEmailFromName: row.notifEmailFromName === null || row.notifEmailFromName === undefined ? '' : String(row.notifEmailFromName),
  }
}

/** Fetch the single 'main' notif-settings row, or null if it doesn't exist yet. */
async function fetchNotifSettingsRow(client: ReturnType<typeof getLibsql>): Promise<Record<string, unknown> | null> {
  const res = await client.execute({
    sql: `SELECT ${NOTIF_SETTINGS_COLUMNS} FROM settings WHERE id = 'main' LIMIT 1`,
    args: [],
  })
  if (res.rows.length === 0) return null
  return res.rows[0] as Record<string, unknown>
}

/** Convert a settings cell value to its SQLite bind form (bool→0/1, int→int). */
function toSqlValue(key: string, value: unknown): unknown {
  if (BOOLEAN_NOTIF_KEYS.has(key)) {
    return value ? 1 : 0
  }
  if (INT_NOTIF_KEYS.has(key)) {
    if (value === null || value === undefined || value === '') return null
    const n = typeof value === 'number' ? value : parseInt(String(value), 10)
    return Number.isNaN(n) ? null : n
  }
  return value
}

// GET notification settings (masked)
export async function GET() {
  try {
    const client = getLibsql()
    let settings = await fetchNotifSettingsRow(client)

    if (!settings) {
      // Mirror original `db.settings.create({ data: { id: 'main' } })` —
      // create a bare row with id='main' (other columns default to NULL in SQLite,
      // which the response shape treats the same as Prisma's default `false`/`''`/`587`).
      await client.execute({
        sql: `INSERT INTO settings (id, updatedAt) VALUES ('main', ?)`,
        args: [bind(nowMs())],
      })
      settings = await fetchNotifSettingsRow(client)
      if (!settings) {
        return NextResponse.json(formatNotifSettingsResponse({}))
      }
    }

    return NextResponse.json(formatNotifSettingsResponse(settings))
  } catch (error) {
    console.error('Get notification settings error:', error)
    return NextResponse.json({ error: 'Failed to fetch notification settings' }, { status: 500 })
  }
}

// PUT update notification settings
export async function PUT(request: NextRequest) {
  try {
    const client = getLibsql()
    const body = await request.json()

    // Build updateData (mirrors original per-field conditions).
    const updateData: Record<string, unknown> = {}

    if (typeof body.notifWaEnabled === 'boolean') updateData.notifWaEnabled = body.notifWaEnabled
    if (body.notifWaToken !== undefined) updateData.notifWaToken = body.notifWaToken || null
    if (body.notifWaDeviceId !== undefined) updateData.notifWaDeviceId = body.notifWaDeviceId || null
    if (body.notifWaSenderNumber !== undefined) updateData.notifWaSenderNumber = body.notifWaSenderNumber || null
    if (typeof body.notifEmailEnabled === 'boolean') updateData.notifEmailEnabled = body.notifEmailEnabled
    if (body.notifEmailHost !== undefined) updateData.notifEmailHost = body.notifEmailHost || null
    if (body.notifEmailPort !== undefined) updateData.notifEmailPort = body.notifEmailPort ? parseInt(body.notifEmailPort, 10) : null
    if (body.notifEmailUser !== undefined) updateData.notifEmailUser = body.notifEmailUser || null
    if (body.notifEmailPass !== undefined) updateData.notifEmailPass = body.notifEmailPass || null
    if (body.notifEmailFromName !== undefined) updateData.notifEmailFromName = body.notifEmailFromName || null

    // Use findUnique + update/create instead of upsert (same fix as settings route —
    // upsert was causing 500 errors on Turso/libsql adapter).
    const existing = await fetchNotifSettingsRow(client)
    if (!existing) {
      // INSERT new row: id='main' + updateData + updatedAt.
      const cols = ['id', ...Object.keys(updateData), 'updatedAt']
      const vals: InValue[] = [bind('main')]
      for (const [k, v] of Object.entries(updateData)) {
        vals.push(bind(toSqlValue(k, v)))
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
        setClauses.push(`${k} = ?`)
        args.push(bind(toSqlValue(k, v)))
      }
      setClauses.push('updatedAt = ?')
      args.push(bind(nowMs()))
      args.push(bind('main'))
      await client.execute({
        sql: `UPDATE settings SET ${setClauses.join(', ')} WHERE id = ?`,
        args,
      })
    }

    // Fetch the final row state to mirror Prisma's update returning the row.
    const finalRow = await fetchNotifSettingsRow(client)
    const response = finalRow
      ? formatNotifSettingsResponse(finalRow)
      : formatNotifSettingsResponse({})

    return NextResponse.json({
      success: true,
      ...response,
    })
  } catch (error) {
    console.error('Update notification settings error:', error)
    return NextResponse.json({ error: 'Failed to update notification settings' }, { status: 500 })
  }
}

// POST test notification
export async function POST(request: NextRequest) {
  try {
    const client = getLibsql()
    const body = await request.json()
    const { adminUserId } = body

    if (!adminUserId) {
      return NextResponse.json({ error: 'Admin user ID required' }, { status: 400 })
    }

    // Fetch user (only the fields sendTestNotification needs).
    const userRes = await client.execute({
      sql: `SELECT email, whatsapp, name FROM users WHERE id = ? LIMIT 1`,
      args: [bind(adminUserId)],
    })
    if (userRes.rows.length === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }
    const userRow = userRes.rows[0] as Record<string, unknown>
    const user = {
      email: String(userRow.email ?? ''),
      whatsapp: userRow.whatsapp === null || userRow.whatsapp === undefined ? null : String(userRow.whatsapp),
      name: String(userRow.name ?? ''),
    }

    // Fetch settings (single 'main' row).
    const settings = await fetchNotifSettingsRow(client)
    if (!settings) {
      return NextResponse.json({ error: 'Settings not found' }, { status: 404 })
    }

    // Build the NotifSettings object sendTestNotification expects —
    // matches the original `db.settings.findUnique` shape passed to sendTestNotification.
    const notifWaToken =
      settings.notifWaToken === null || settings.notifWaToken === undefined ? null : String(settings.notifWaToken)
    const notifWaDeviceId =
      settings.notifWaDeviceId === null || settings.notifWaDeviceId === undefined ? null : String(settings.notifWaDeviceId)
    const notifWaSenderNumber =
      settings.notifWaSenderNumber === null || settings.notifWaSenderNumber === undefined ? null : String(settings.notifWaSenderNumber)
    const notifEmailHost =
      settings.notifEmailHost === null || settings.notifEmailHost === undefined ? null : String(settings.notifEmailHost)
    const notifEmailPort =
      settings.notifEmailPort === null || settings.notifEmailPort === undefined ? null : Number(settings.notifEmailPort)
    const notifEmailUser =
      settings.notifEmailUser === null || settings.notifEmailUser === undefined ? null : String(settings.notifEmailUser)
    const notifEmailPass =
      settings.notifEmailPass === null || settings.notifEmailPass === undefined ? null : String(settings.notifEmailPass)
    const notifEmailFromName =
      settings.notifEmailFromName === null || settings.notifEmailFromName === undefined ? null : String(settings.notifEmailFromName)

    const result = await sendTestNotification(user, {
      notifWaEnabled: toBool(settings.notifWaEnabled),
      notifWaToken: notifWaToken,
      notifWaDeviceId: notifWaDeviceId,
      notifWaSenderNumber: notifWaSenderNumber,
      notifEmailEnabled: toBool(settings.notifEmailEnabled),
      notifEmailHost: notifEmailHost,
      notifEmailPort: notifEmailPort,
      notifEmailUser: notifEmailUser,
      notifEmailPass: notifEmailPass,
      notifEmailFromName: notifEmailFromName,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Test notification error:', error)
    return NextResponse.json({ error: 'Failed to send test notification' }, { status: 500 })
  }
}
