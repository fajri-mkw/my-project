import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST - Run migration to ensure program_kegiatan table and all columns exist
export async function POST() {
  try {
    // Check if table exists
    const tableCheck = await db.$queryRawUnsafe(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'program_kegiatan'
      )
    `) as any[]

    if (tableCheck[0]?.exists) {
      // Check existing columns
      const colCheck = await db.$queryRawUnsafe(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'program_kegiatan' AND table_schema = 'public'
      `) as any[]

      const existingCols = colCheck.map(c => c.column_name)
      const actions: string[] = []

      // If 'perihal' column exists but 'namaKegiatan' doesn't, rename it back (Prisma uses @map)
      if (existingCols.includes('perihal') && !existingCols.includes('namaKegiatan')) {
        await db.$executeRawUnsafe(`ALTER TABLE "program_kegiatan" RENAME COLUMN "perihal" TO "namaKegiatan"`)
        actions.push('Renamed perihal → namaKegiatan')
        existingCols[existingCols.indexOf('perihal')] = 'namaKegiatan'
      }

      // Ensure all required columns exist
      const requiredCols: { name: string; sql: string }[] = [
        { name: 'nomorKegiatan', sql: `ALTER TABLE "program_kegiatan" ADD COLUMN IF NOT EXISTS "nomorKegiatan" TEXT NOT NULL DEFAULT ''` },
        { name: 'jenisKegiatan', sql: `ALTER TABLE "program_kegiatan" ADD COLUMN IF NOT EXISTS "jenisKegiatan" TEXT NOT NULL DEFAULT 'Kegiatan'` },
        { name: 'kategori', sql: `ALTER TABLE "program_kegiatan" ADD COLUMN IF NOT EXISTS "kategori" TEXT NOT NULL DEFAULT 'Umum'` },
        { name: 'tanggalKegiatan', sql: `ALTER TABLE "program_kegiatan" ADD COLUMN IF NOT EXISTS "tanggalKegiatan" TIMESTAMPTZ` },
        { name: 'penyelenggara', sql: `ALTER TABLE "program_kegiatan" ADD COLUMN IF NOT EXISTS "penyelenggara" TEXT` },
        { name: 'namaKegiatan', sql: `ALTER TABLE "program_kegiatan" ADD COLUMN IF NOT EXISTS "namaKegiatan" TEXT NOT NULL DEFAULT ''` },
        { name: 'deskripsi', sql: `ALTER TABLE "program_kegiatan" ADD COLUMN IF NOT EXISTS "deskripsi" TEXT` },
        { name: 'status', sql: `ALTER TABLE "program_kegiatan" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'direncanakan'` },
        { name: 'catatan', sql: `ALTER TABLE "program_kegiatan" ADD COLUMN IF NOT EXISTS "catatan" TEXT` },
        { name: 'documents', sql: `ALTER TABLE "program_kegiatan" ADD COLUMN IF NOT EXISTS "documents" TEXT DEFAULT '[]'` },
        { name: 'driveFolderId', sql: `ALTER TABLE "program_kegiatan" ADD COLUMN IF NOT EXISTS "driveFolderId" TEXT` },
        { name: 'driveFolderLink', sql: `ALTER TABLE "program_kegiatan" ADD COLUMN IF NOT EXISTS "driveFolderLink" TEXT` },
        { name: 'location', sql: `ALTER TABLE "program_kegiatan" ADD COLUMN IF NOT EXISTS "location" TEXT` },
        { name: 'executionTime', sql: `ALTER TABLE "program_kegiatan" ADD COLUMN IF NOT EXISTS "executionTime" TEXT` },
        { name: 'picName', sql: `ALTER TABLE "program_kegiatan" ADD COLUMN IF NOT EXISTS "picName" TEXT` },
        { name: 'picWhatsApp', sql: `ALTER TABLE "program_kegiatan" ADD COLUMN IF NOT EXISTS "picWhatsApp" TEXT` },
        { name: 'managerId', sql: `ALTER TABLE "program_kegiatan" ADD COLUMN IF NOT EXISTS "managerId" TEXT` },
        { name: 'projectId', sql: `ALTER TABLE "program_kegiatan" ADD COLUMN IF NOT EXISTS "projectId" TEXT` },
      ]

      for (const col of requiredCols) {
        if (!existingCols.includes(col.name)) {
          try {
            await db.$executeRawUnsafe(col.sql)
            actions.push(`Added column: ${col.name}`)
          } catch (e) {
            console.error(`[MIGRATION] Failed to add ${col.name}:`, e)
          }
        }
      }

      if (actions.length > 0) {
        return NextResponse.json({ success: true, message: actions.join('. ') })
      }
      return NextResponse.json({ success: true, message: 'Table already up to date.' })
    }

    // Create table from scratch with namaKegiatan column (matching Prisma @map)
    await db.$executeRawUnsafe(`
      CREATE TABLE "program_kegiatan" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "nomorKegiatan" TEXT NOT NULL DEFAULT '',
        "jenisKegiatan" TEXT NOT NULL DEFAULT 'Kegiatan',
        "kategori" TEXT NOT NULL DEFAULT 'Umum',
        "tanggalKegiatan" TIMESTAMPTZ,
        "penyelenggara" TEXT,
        "namaKegiatan" TEXT NOT NULL DEFAULT '',
        "deskripsi" TEXT,
        "status" TEXT NOT NULL DEFAULT 'direncanakan',
        "catatan" TEXT,
        "documents" TEXT DEFAULT '[]',
        "driveFolderId" TEXT,
        "driveFolderLink" TEXT,
        "location" TEXT,
        "executionTime" TEXT,
        "picName" TEXT,
        "picWhatsApp" TEXT,
        "managerId" TEXT,
        "projectId" TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `)

    await db.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "program_kegiatan_managerId_idx" ON "program_kegiatan"("managerId");
      CREATE INDEX IF NOT EXISTS "program_kegiatan_status_idx" ON "program_kegiatan"("status");
    `)

    return NextResponse.json({ success: true, message: 'Table program_kegiatan created.' })
  } catch (error) {
    console.error('[MIGRATION] Error:', error)
    return NextResponse.json({
      error: 'Migration failed',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}
