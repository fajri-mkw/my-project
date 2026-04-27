import { NextResponse } from 'next/server'
import { db, ensureDbConnection, getLastDbError } from '@/lib/db'

export async function GET() {
  const dbUrl = process.env.DATABASE_URL || ''
  const debugInfo = {
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    hasDatabaseUrl: !!dbUrl,
    databaseUrlPrefix: dbUrl ? dbUrl.substring(0, 30) + '...' : 'NOT SET',
    databaseUrlType: dbUrl.startsWith('file:') ? 'SQLite' : dbUrl.startsWith('postgres') ? 'PostgreSQL' : dbUrl.startsWith('mysql') ? 'MySQL' : 'unknown',
    directDbUrl: !!process.env.DIRECT_DATABASE_URL,
    databaseConnection: 'not_tested' as string,
    connectionError: null as string | null,
  }

  try {
    const isConnected = await ensureDbConnection()
    debugInfo.databaseConnection = isConnected ? 'connected' : 'failed'
    debugInfo.connectionError = getLastDbError()

    if (isConnected) {
      const userCount = await db.user.count()
      return NextResponse.json({
        ...debugInfo,
        userCount,
        status: 'ok'
      })
    }

    return NextResponse.json({
      ...debugInfo,
      status: 'connection_failed'
    }, { status: 500 })
  } catch (error) {
    return NextResponse.json({
      ...debugInfo,
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
      connectionError: getLastDbError()
    }, { status: 500 })
  }
}
