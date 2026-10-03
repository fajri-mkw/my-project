import { NextResponse } from 'next/server'
import { getLibsql } from '@/lib/libsql-client'

// One-shot migration: tambah kolom lihumGalleryId TEXT di projects table.
// Idempotent (skip kalau kolom sudah ada) — aman dijalankan berkali-kali.
// TIDAK mengganggu sistem yang berjalan karena:
// 1. ALTER TABLE ADD COLUMN tidak lock table di SQLite/D1
// 2. Kolom baru nullable (default NULL) — project lama tetap work
// 3. Endpoint terpisah, tidak di-auto-run di startup
export async function GET() {
  try {
    const client = getLibsql()
    try {
      await client.execute({ sql: `ALTER TABLE "projects" ADD COLUMN "lihumGalleryId" TEXT`, args: [] })
      return NextResponse.json({ success: true, message: 'Column lihumGalleryId added to projects table' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('already exists') || msg.includes('duplicate')) {
        return NextResponse.json({ success: true, message: 'Column lihumGalleryId already exists (skipped)' })
      }
      throw err
    }
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
