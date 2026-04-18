import { NextResponse } from 'next/server'

export async function GET() {
  const dbUrl = process.env.DATABASE_URL || ''
  const directUrl = process.env.DIRECT_DATABASE_URL || ''
  
  return NextResponse.json({
    databaseUrl: dbUrl,
    directDatabaseUrl: directUrl
  })
}
