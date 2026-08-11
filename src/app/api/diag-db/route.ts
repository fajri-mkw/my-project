import { NextResponse } from 'next/server'
import { getLibsql, bind } from '@/lib/libsql-client'

// TEMPORARY diagnostic endpoint — safe to delete after debugging.
// Returns masked DB URL + attempts a test write to reveal the exact error.
export async function GET() {
  const dbUrl = process.env.DATABASE_URL || ''
  const masked = dbUrl
    ? dbUrl.replace(/(libsql:\/\/[^/]+:)[^@]+@/, '$1***@').replace(/authToken=[^&]+/, 'authToken=***')
    : '(not set)'

  // Mask the hostname partially — show enough to identify the Turso org/db
  // but hide the full token if embedded.
  const hostMatch = dbUrl.match(/libsql:\/\/([^/]+)/)
  const host = hostMatch ? hostMatch[1].split('@').pop() : '(unknown)'

  const client = getLibsql()

  // 1. Try a read (should work even if writes are blocked)
  let readResult: string
  try {
    const r = await client.execute({ sql: 'SELECT COUNT(*) AS c FROM users', args: [] })
    readResult = `OK (users: ${r.rows[0]?.c ?? '?'})`
  } catch (e) {
    readResult = `FAILED: ${e instanceof Error ? e.message : String(e)}`
  }

  // 2. Try a write (this is what's failing)
  let writeResult: string
  try {
    const testId = `diag_${Date.now()}`
    await client.execute({
      sql: `INSERT INTO settings (id, maintenanceMode, maintenanceMessage, updatedAt)
            VALUES (?, 0, 'diag test', ?)
            ON CONFLICT(id) DO UPDATE SET updatedAt = excluded.updatedAt`,
      args: [bind(testId), bind(Date.now())],
    })
    // Clean up the test row
    await client.execute({
      sql: `DELETE FROM settings WHERE id = ?`,
      args: [bind(testId)],
    })
    writeResult = 'OK — writes work'
  } catch (e) {
    writeResult = `FAILED: ${e instanceof Error ? e.message : String(e)}`
  }

  // 3. Check DB size (page_count * page_size = bytes)
  let dbSize: string
  try {
    const pc = await client.execute({ sql: 'PRAGMA page_count', args: [] })
    const ps = await client.execute({ sql: 'PRAGMA page_size', args: [] })
    const pages = Number(pc.rows[0]?.page_count ?? 0)
    const pageSize = Number(ps.rows[0]?.page_size ?? 4096)
    const bytes = pages * pageSize
    const mb = (bytes / 1024 / 1024).toFixed(2)
    dbSize = `${mb} MB (${pages} pages × ${pageSize} bytes)`
  } catch (e) {
    dbSize = `FAILED: ${e instanceof Error ? e.message : String(e)}`
  }

  // 4. Count rows in each table
  const tables = [
    'users', 'projects', 'tasks', 'notifications', 'surat_tugas',
    'settings', 'sops', 'permohonan', 'surat', 'program_kegiatan', 'external_links',
  ]
  const counts: Record<string, number | string> = {}
  for (const t of tables) {
    try {
      const r = await client.execute({ sql: `SELECT COUNT(*) AS c FROM ${t}`, args: [] })
      counts[t] = Number(r.rows[0]?.c ?? 0)
    } catch (e) {
      counts[t] = `err: ${e instanceof Error ? e.message.slice(0, 80) : '?'}`
    }
  }

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    dbHost: host,
    dbUrlMasked: masked,
    read: readResult,
    write: writeResult,
    dbSize,
    tableCounts: counts,
  })
}
