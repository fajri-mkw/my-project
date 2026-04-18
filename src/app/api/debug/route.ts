import { NextResponse } from 'next/server'
import { db, ensureDbConnection } from '@/lib/db'

export async function GET() {
  const debugInfo = {
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    hasDatabaseUrl: !!process.env.DATABASE_URL,
    databaseUrlPrefix: process.env.DATABASE_URL?.substring(0, 30) + '...' || 'NOT SET',
    databaseConnection: 'not_tested'
  }

  try {
    const isConnected = await ensureDbConnection()
    debugInfo.databaseConnection = isConnected ? 'connected' : 'failed'
    
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
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
