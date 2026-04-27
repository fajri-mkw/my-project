import { NextResponse } from 'next/server'
import { ensureDbConnection, getLastDbError } from '@/lib/db'

export async function GET() {
  const dbUrl = process.env.DATABASE_URL || ''
  const isConnected = await ensureDbConnection()

  return NextResponse.json({
    status: isConnected ? 'ok' : 'error',
    timestamp: new Date().toISOString(),
    message: isConnected ? 'Server is running' : 'Database connection failed',
    hasDatabaseUrl: !!dbUrl,
    databaseType: dbUrl.startsWith('file:') ? 'SQLite' : dbUrl.startsWith('postgres') ? 'PostgreSQL' : dbUrl.startsWith('mysql') ? 'MySQL' : 'unknown',
    dbError: isConnected ? null : getLastDbError(),
  })
}
