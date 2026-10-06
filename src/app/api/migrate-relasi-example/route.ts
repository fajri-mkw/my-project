import { NextResponse } from 'next/server'
import { getLibsql } from '@/lib/libsql-client'

export async function GET() {
  const columns = [
    { name: 'exampleFileId', def: 'TEXT' },
    { name: 'exampleFileName', def: 'TEXT' },
    { name: 'exampleFileUrl', def: 'TEXT' },
  ]
  const results: Array<{ column: string; status: string }> = []
  try {
    const client = getLibsql()
    for (const col of columns) {
      try {
        await client.execute({ sql: `ALTER TABLE "relasi_forms" ADD COLUMN "${col.name}" ${col.def}`, args: [] })
        results.push({ column: col.name, status: 'added' })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('already exists') || msg.includes('duplicate')) {
          results.push({ column: col.name, status: 'already exists' })
        } else {
          results.push({ column: col.name, status: `error: ${msg}` })
        }
      }
    }
    return NextResponse.json({ success: true, results })
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error), results }, { status: 500 })
  }
}
