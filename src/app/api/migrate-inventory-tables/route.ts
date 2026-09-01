import { NextResponse } from 'next/server'
import { getLibsql } from '@/lib/libsql-client'

/**
 * GET /api/migrate-inventory-tables
 *
 * One-shot migration to create inventory tables on Cloudflare D1, bypassing
 * Prisma's WASM client (which silently fails on CREATE TABLE on cold starts).
 */
export async function GET() {
  const results: Array<{ step: string; status: 'ok' | 'skipped' | 'error'; detail?: string }> = []

  const tables: Array<{ name: string; sql: string }> = [
    {
      name: 'inventory',
      sql: `CREATE TABLE IF NOT EXISTS "inventory" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "kodeBarang" TEXT NOT NULL UNIQUE,
        "namaBarang" TEXT NOT NULL,
        "kategori" TEXT NOT NULL,
        "jumlahTotal" INTEGER NOT NULL DEFAULT 0,
        "jumlahTersedia" INTEGER NOT NULL DEFAULT 0,
        "jumlahDipinjam" INTEGER NOT NULL DEFAULT 0,
        "jumlahDibagikan" INTEGER NOT NULL DEFAULT 0,
        "lokasi" TEXT,
        "status" TEXT NOT NULL DEFAULT 'baik',
        "kondisiCatatan" TEXT,
        "imageFileId" TEXT,
        "imageUrl" TEXT,
        "catatan" TEXT,
        "createdBy" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL
      )`,
    },
    {
      name: 'inventory_loans',
      sql: `CREATE TABLE IF NOT EXISTS "inventory_loans" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "inventoryId" TEXT NOT NULL,
        "peminjamId" TEXT,
        "peminjamName" TEXT NOT NULL,
        "tanggalPinjam" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "tanggalKembaliRencana" DATETIME,
        "tanggalKembaliAktual" DATETIME,
        "jumlahDipinjam" INTEGER NOT NULL DEFAULT 1,
        "status" TEXT NOT NULL DEFAULT 'pending',
        "keperluan" TEXT,
        "catatan" TEXT,
        "approverId" TEXT,
        "approvedAt" DATETIME,
        "rejectedReason" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL,
        CONSTRAINT "inventory_loans_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "inventory" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      )`,
    },
    {
      name: 'inventory_returns',
      sql: `CREATE TABLE IF NOT EXISTS "inventory_returns" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "loanId" TEXT NOT NULL UNIQUE,
        "tanggalKembali" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "kondisi" TEXT NOT NULL,
        "jumlahDikembalikan" INTEGER NOT NULL DEFAULT 1,
        "catatan" TEXT,
        "receivedById" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "inventory_returns_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "inventory_loans" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      )`,
    },
    {
      name: 'inventory_distributions',
      sql: `CREATE TABLE IF NOT EXISTS "inventory_distributions" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "inventoryId" TEXT NOT NULL,
        "penerimaName" TEXT NOT NULL,
        "penerimaUnit" TEXT,
        "jumlahDibagikan" INTEGER NOT NULL DEFAULT 1,
        "tanggalBagi" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "keperluan" TEXT,
        "catatan" TEXT,
        "distribusiById" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "inventory_distributions_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "inventory" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      )`,
    },
    {
      name: 'inventory_history',
      sql: `CREATE TABLE IF NOT EXISTS "inventory_history" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "inventoryId" TEXT NOT NULL,
        "jenisTransaksi" TEXT NOT NULL,
        "tanggalTransaksi" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "pelakuId" TEXT,
        "pelakuName" TEXT,
        "keterangan" TEXT,
        "jumlah" INTEGER,
        "loanId" TEXT,
        "distributionId" TEXT,
        "returnId" TEXT,
        CONSTRAINT "inventory_history_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "inventory" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      )`,
    },
  ]

  const indexes: Array<{ name: string; sql: string }> = [
    { name: 'inventory_kategori_idx', sql: `CREATE INDEX IF NOT EXISTS "inventory_kategori_idx" ON "inventory"("kategori")` },
    { name: 'inventory_status_idx', sql: `CREATE INDEX IF NOT EXISTS "inventory_status_idx" ON "inventory"("status")` },
    { name: 'inventory_loans_inventoryId_idx', sql: `CREATE INDEX IF NOT EXISTS "inventory_loans_inventoryId_idx" ON "inventory_loans"("inventoryId")` },
    { name: 'inventory_loans_status_idx', sql: `CREATE INDEX IF NOT EXISTS "inventory_loans_status_idx" ON "inventory_loans"("status")` },
    { name: 'inventory_distributions_inventoryId_idx', sql: `CREATE INDEX IF NOT EXISTS "inventory_distributions_inventoryId_idx" ON "inventory_distributions"("inventoryId")` },
    { name: 'inventory_history_inventoryId_idx', sql: `CREATE INDEX IF NOT EXISTS "inventory_history_inventoryId_idx" ON "inventory_history"("inventoryId")` },
  ]

  try {
    const client = getLibsql()

    for (const { name, sql } of tables) {
      try {
        await client.execute({ sql, args: [] })
        results.push({ step: `CREATE TABLE ${name}`, status: 'ok' })
      } catch (err) {
        results.push({ step: `CREATE TABLE ${name}`, status: 'error', detail: err instanceof Error ? err.message : String(err) })
      }
    }

    for (const { name, sql } of indexes) {
      try {
        await client.execute({ sql, args: [] })
        results.push({ step: `CREATE INDEX ${name}`, status: 'ok' })
      } catch (err) {
        results.push({ step: `CREATE INDEX ${name}`, status: 'error', detail: err instanceof Error ? err.message : String(err) })
      }
    }

    try {
      const verify = await client.execute({ sql: `SELECT COUNT(*) as cnt FROM inventory`, args: [] })
      const count = Number((verify.rows[0] as Record<string, unknown>).cnt ?? 0)
      results.push({ step: 'VERIFY inventory', status: 'ok', detail: `${count} items` })
    } catch (verifyErr) {
      results.push({ step: 'VERIFY inventory', status: 'error', detail: verifyErr instanceof Error ? verifyErr.message : String(verifyErr) })
    }

    const allOk = results.every(r => r.status !== 'error')
    return NextResponse.json({ success: allOk, results }, { status: allOk ? 200 : 500 })
  } catch (error) {
    return NextResponse.json({ success: false, results, error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
