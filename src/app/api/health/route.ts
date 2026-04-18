import { NextResponse } from 'next/server'

// Simple health check - no database required
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    message: 'Server is running',
    hasDatabaseUrl: !!process.env.DATABASE_URL
  })
}
