import { NextResponse } from 'next/server'
import { getLibsql } from '@/lib/libsql-client'

// One-shot migration: buat tabel `relasi_files` untuk menyimpan file upload
// (foto, file contoh) dari form Relasi publik.
//
// Skema:
//   id          TEXT PRIMARY KEY   — genId()
//   formId      TEXT               — ID form (atau 'new' untuk form yg belum disave)
//   fileName    TEXT               — nama file asli
//   contentType TEXT               — MIME type (image/jpeg, application/pdf, ...)
//   fileData    TEXT               — base64-encoded file content (untuk D1/Workers)
//   fileSize    INTEGER            — ukuran file dalam bytes
//   createdAt   INTEGER            — epoch-ms
//
// Idempotent (CREATE TABLE IF NOT EXISTS) — aman dijalankan berkali-kali.
export async function GET() {
  try {
    const client = getLibsql()
    await client.execute({
      sql: `CREATE TABLE IF NOT EXISTS "relasi_files" (
        "id" TEXT PRIMARY KEY,
        "formId" TEXT NOT NULL DEFAULT 'new',
        "fileName" TEXT NOT NULL DEFAULT '',
        "contentType" TEXT NOT NULL DEFAULT 'application/octet-stream',
        "fileData" TEXT NOT NULL DEFAULT '',
        "fileSize" INTEGER NOT NULL DEFAULT 0,
        "createdAt" INTEGER NOT NULL DEFAULT 0
      )`,
      args: [],
    })
    // Index untuk query by formId (download/list)
    try {
      await client.execute({
        sql: `CREATE INDEX IF NOT EXISTS "idx_relasi_files_formId" ON "relasi_files" ("formId")`,
        args: [],
      })
    } catch {}
    return NextResponse.json({ success: true, message: 'relasi_files table ready' })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
