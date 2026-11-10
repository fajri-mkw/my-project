import { NextResponse } from 'next/server'
import { getLibsql } from '@/lib/libsql-client'

// One-shot migration: tambah kolom `driveAdminEmail` TEXT di settings table.
//
// Kolom ini menyimpan email admin Google Workspace yang akan diimpersonate
// oleh Service Account saat driveMode='folder' (domain-wide delegation).
// Tanpa ini, Service Account upload ke My Drive folder gagal dengan
// "Service Accounts do not have storage quota" (HTTP 403).
//
// Idempotent (ALTER TABLE ... ADD COLUMN — skip kalau kolom sudah ada).
export async function GET() {
  try {
    const client = getLibsql()
    try {
      await client.execute({
        sql: `ALTER TABLE "settings" ADD COLUMN "driveAdminEmail" TEXT`,
        args: [],
      })
      return NextResponse.json({ success: true, message: 'Column driveAdminEmail added to settings table' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('already exists') || msg.includes('duplicate')) {
        return NextResponse.json({ success: true, message: 'Column driveAdminEmail already exists (skipped)' })
      }
      throw err
    }
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
