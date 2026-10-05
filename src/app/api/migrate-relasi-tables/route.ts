import { NextResponse } from 'next/server'
import { getLibsql } from '@/lib/libsql-client'

export async function GET() {
  const tables = [
    {
      name: 'relasi_forms',
      sql: `CREATE TABLE IF NOT EXISTS "relasi_forms" (
        "id" TEXT PRIMARY KEY,
        "title" TEXT NOT NULL,
        "description" TEXT DEFAULT '',
        "fields" TEXT DEFAULT '[]',
        "publicToken" TEXT UNIQUE,
        "driveFolderId" TEXT,
        "status" TEXT DEFAULT 'active',
        "createdBy" TEXT,
        "createdAt" INTEGER,
        "updatedAt" INTEGER
      )`
    },
    {
      name: 'relasi_submissions',
      sql: `CREATE TABLE IF NOT EXISTS "relasi_submissions" (
        "id" TEXT PRIMARY KEY,
        "formId" TEXT NOT NULL,
        "data" TEXT DEFAULT '{}',
        "uploadedFiles" TEXT DEFAULT '[]',
        "submitterName" TEXT,
        "submitterEmail" TEXT,
        "status" TEXT DEFAULT 'new',
        "ipAddress" TEXT,
        "createdAt" INTEGER
      )`
    },
    {
      name: 'relasi_templates',
      sql: `CREATE TABLE IF NOT EXISTS "relasi_templates" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT NOT NULL,
        "fields" TEXT DEFAULT '[]',
        "createdBy" TEXT,
        "createdAt" INTEGER
      )`
    },
  ]
  const results: Array<{ table: string; status: string }> = []
  try {
    const client = getLibsql()
    for (const t of tables) {
      try {
        await client.execute({ sql: t.sql, args: [] })
        results.push({ table: t.name, status: 'created (or already exists)' })
      } catch (err) {
        results.push({ table: t.name, status: `error: ${err instanceof Error ? err.message : String(err)}` })
      }
    }
    try {
      await client.execute({ sql: `CREATE INDEX IF NOT EXISTS "idx_relasi_forms_token" ON "relasi_forms" ("publicToken")`, args: [] })
      await client.execute({ sql: `CREATE INDEX IF NOT EXISTS "idx_relasi_submissions_formId" ON "relasi_submissions" ("formId")`, args: [] })
    } catch {}
    return NextResponse.json({ success: true, results })
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error), results }, { status: 500 })
  }
}
