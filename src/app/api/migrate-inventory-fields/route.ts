import { NextResponse } from 'next/server'
import { getLibsql } from '@/lib/libsql-client'

export async function GET() {
  const results: Array<{ step: string; status: string; detail?: string }> = []
  const columns = [
    { name: 'pengguna', sql: `ALTER TABLE "inventory" ADD COLUMN "pengguna" TEXT` },
    { name: 'penanggungJawab', sql: `ALTER TABLE "inventory" ADD COLUMN "penanggungJawab" TEXT` },
    { name: 'sumberPengadaan', sql: `ALTER TABLE "inventory" ADD COLUMN "sumberPengadaan" TEXT` },
    { name: 'tahunPengadaan', sql: `ALTER TABLE "inventory" ADD COLUMN "tahunPengadaan" INTEGER` },
  ]
  try {
    const client = getLibsql()
    for (const col of columns) {
      try {
        await client.execute({ sql: col.sql, args: [] })
        results.push({ step: `ADD COLUMN ${col.name}`, status: 'ok' })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('already exists') || msg.includes('duplicate')) {
          results.push({ step: `ADD COLUMN ${col.name}`, status: 'skipped', detail: 'already exists' })
        } else {
          results.push({ step: `ADD COLUMN ${col.name}`, status: 'error', detail: msg })
        }
      }
    }
    const allOk = results.every(r => r.status !== 'error')
    return NextResponse.json({ success: allOk, results }, { status: allOk ? 200 : 500 })
  } catch (error) {
    return NextResponse.json({ success: false, results, error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
