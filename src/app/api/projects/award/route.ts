import { NextRequest, NextResponse } from 'next/server'
import { getLibsql, bind } from '@/lib/libsql-client'
import { invalidateCache, deferToBackground } from '@/lib/edge-cache'

// ============================================================================
// PUT /api/projects/award — Update Objektif + Key Messages + Outcome fields
//
// Endpoint terpisah untuk modul Penghargaan Pengelolaan Komunikasi Publik
// Inovatif Kementerian Agama. Tidak mengganggu endpoint project utama.
//
// Indikator yang di-cover:
// - Objektif (20%): objective, targetAudience, kpiTarget, strategyLink
// - Key Messages (15%): mainMessage, supportingMessages, toneManner
// - Pengukuran (15%): outcomeMetrics, lessonsLearned
//
// Body: { projectId, ...fields }
// ============================================================================

export async function PUT(request: NextRequest) {
  const userRole = request.headers.get('X-User-Role')
  if (!['Admin', 'Administrator', 'Manager'].includes(userRole || '')) {
    return NextResponse.json({ error: 'Hanya Manager/Admin' }, { status: 403 })
  }

  try {
    const body = await request.json()
    const {
      projectId,
      objective,
      targetAudience,
      kpiTarget,
      mainMessage,
      supportingMessages,
      toneManner,
      outcomeMetrics,
      strategyLink,
      lessonsLearned,
    } = body as {
      projectId?: string
      objective?: string | null
      targetAudience?: string | null
      kpiTarget?: Array<{ metric: string; target: string; baseline: string }> | null
      mainMessage?: string | null
      supportingMessages?: string[] | null
      toneManner?: string | null
      outcomeMetrics?: { reach?: number; engagement?: number; sentiment?: string; feedback?: string; downloads?: number } | null
      strategyLink?: string | null
      lessonsLearned?: string | null
    }

    if (!projectId) {
      return NextResponse.json({ error: 'projectId wajib diisi' }, { status: 400 })
    }

    const client = getLibsql()

    // Build SET clause dinamis — hanya update field yang dikirim (null-safe)
    const updates: string[] = []
    const args: unknown[] = []

    const addField = (col: string, val: unknown) => {
      if (val !== undefined) {
        updates.push(`"${col}" = ?`)
        if (col === 'kpiTarget' || col === 'supportingMessages' || col === 'outcomeMetrics') {
          args.push(bind(JSON.stringify(val)))
        } else {
          args.push(bind(val as string | null))
        }
      }
    }

    addField('objective', objective)
    addField('targetAudience', targetAudience)
    addField('kpiTarget', kpiTarget)
    addField('mainMessage', mainMessage)
    addField('supportingMessages', supportingMessages)
    addField('toneManner', toneManner)
    addField('outcomeMetrics', outcomeMetrics)
    addField('strategyLink', strategyLink)
    addField('lessonsLearned', lessonsLearned)

    if (updates.length === 0) {
      return NextResponse.json({ success: true, message: 'Tidak ada field untuk diupdate' })
    }

    // Tambah updatedAt
    updates.push(`"updatedAt" = ?`)
    args.push(bind(Date.now()))
    args.push(bind(projectId))

    await client.execute({
      sql: `UPDATE projects SET ${updates.join(', ')} WHERE id = ?`,
      args,
    })

    deferToBackground(invalidateCache('/api/projects'))

    return NextResponse.json({
      success: true,
      message: 'Modul Objektif & Key Messages berhasil disimpan',
      updatedFields: updates.length - 1, // exclude updatedAt
    })
  } catch (error) {
    console.error('[AWARD UPDATE] Error:', error)
    return NextResponse.json({
      error: 'Gagal update modul award',
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 })
  }
}
