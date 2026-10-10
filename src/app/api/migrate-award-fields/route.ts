import { NextResponse } from 'next/server'
import { getLibsql } from '@/lib/libsql-client'

// One-shot migration: tambah kolom untuk modul Objektif + Key Messages + Outcome
// di projects table. Idempotent (skip kalau kolom sudah ada) — aman dijalankan
// berkali-kali. TIDAK mengganggu sistem yang berjalan.
//
// Kolom baru (semua nullable TEXT/JSON, default NULL):
// - objective: Tujuan komunikasi (inform/educate/persuade/engage) + narasi
// - targetAudience: Target audiens (demografi, segment)
// - kpiTarget: KPI target kuantitatif (JSON: { metric, target, baseline })
// - mainMessage: Pesan kunci utama (1 kalimat)
// - supportingMessages: Pesan pendukung (JSON array 3-5 poin)
// - toneManner: Tone & manner (formal/akrab/edukatif/inspiratif)
// - outcomeMetrics: Metrik hasil post-publikasi (JSON: { reach, engagement, sentiment, feedback })
// - strategyLink: Link ke Renstra/Renhumas/Strategi Kementerian
// - lessonsLearned: Evaluasi & lessons learned post-project
export async function GET() {
  const columns = [
    { name: 'objective', def: 'TEXT' },
    { name: 'targetAudience', def: 'TEXT' },
    { name: 'kpiTarget', def: 'TEXT' },
    { name: 'mainMessage', def: 'TEXT' },
    { name: 'supportingMessages', def: 'TEXT' },
    { name: 'toneManner', def: 'TEXT' },
    { name: 'outcomeMetrics', def: 'TEXT' },
    { name: 'strategyLink', def: 'TEXT' },
    { name: 'lessonsLearned', def: 'TEXT' },
  ]
  const results: Array<{ column: string; status: string }> = []
  try {
    const client = getLibsql()
    for (const col of columns) {
      try {
        await client.execute({ sql: `ALTER TABLE "projects" ADD COLUMN "${col.name}" ${col.def}`, args: [] })
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
    const allOk = results.every(r => r.status !== 'error' && !r.status.startsWith('error'))
    return NextResponse.json({ success: allOk, results })
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error), results }, { status: 500 })
  }
}
