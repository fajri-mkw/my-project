import { db, ensureDbConnection } from '@/lib/db'
import { NextResponse } from 'next/server'

// One-time setup: Create surat table if not exists
export async function GET() {
  try {
    const isConnected = await ensureDbConnection()
    if (!isConnected) {
      return NextResponse.json({ error: 'Database connection failed' }, { status: 500 })
    }

    // Create surat table (no trailing semicolon for prepared statement compatibility)
    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "surat" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "nomorSurat" TEXT NOT NULL,
        "jenisSurat" TEXT NOT NULL,
        "kategori" TEXT NOT NULL,
        "tanggalSurat" TIMESTAMP(3),
        "pengirim" TEXT,
        "penerima" TEXT,
        "perihal" TEXT NOT NULL,
        "deskripsi" TEXT,
        "status" TEXT NOT NULL DEFAULT 'diterima',
        "catatan" TEXT,
        "documents" TEXT DEFAULT '[]',
        "driveFolderId" TEXT,
        "driveFolderLink" TEXT,
        "administratorId" TEXT,
        "managerId" TEXT,
        "projectId" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL
      )
    `)

    // Create indexes one by one (Prisma doesn't support multiple statements)
    const indexes = [
      'CREATE INDEX IF NOT EXISTS "surat_jenisSurat_idx" ON "surat" ("jenisSurat")',
      'CREATE INDEX IF NOT EXISTS "surat_status_idx" ON "surat" ("status")',
      'CREATE INDEX IF NOT EXISTS "surat_administratorId_idx" ON "surat" ("administratorId")',
      'CREATE INDEX IF NOT EXISTS "surat_managerId_idx" ON "surat" ("managerId")',
      'CREATE INDEX IF NOT EXISTS "surat_kategori_idx" ON "surat" ("kategori")',
    ]
    for (const idx of indexes) {
      try {
        await db.$executeRawUnsafe(idx)
      } catch (e) {
        console.log(`Index creation note:`, e)
      }
    }

    // Verify table exists
    const result = await db.$queryRawUnsafe(`SELECT COUNT(*) as count FROM "surat"`)
    
    return NextResponse.json({ 
      success: true, 
      message: 'Tabel surat berhasil dibuat/diverifikasi',
      recordCount: (result as any)[0]?.count || 0
    })
  } catch (error) {
    console.error('Setup surat table error:', error)
    return NextResponse.json({ 
      error: 'Failed to create surat table', 
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
