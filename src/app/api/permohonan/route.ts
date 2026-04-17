import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const fastTrack = searchParams.get('fastTrack')

    const where: Record<string, unknown> = {}
    if (status) where.status = status
    if (fastTrack !== null && fastTrack !== undefined) {
      where.fastTrack = fastTrack === 'true'
    }

    const permohonanList = await db.permohonan.findMany({
      where,
      include: {
        manager: { select: { id: true, name: true, email: true, role: true } },
        reporter: { select: { id: true, name: true, email: true, role: true } },
        fotografer: { select: { id: true, name: true, email: true, role: true } },
        editor: { select: { id: true, name: true, email: true, role: true } },
        publisherWeb: { select: { id: true, name: true, email: true, role: true } },
        publisherSocial: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json(permohonanList)
  } catch (error) {
    console.error('Failed to fetch permohonan:', error)
    return NextResponse.json(
      { error: 'Gagal memuat data permohonan' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const {
      judul,
      deskripsi,
      fastTrack,
      managerId,
      reporterId,
      fotograferId,
      editorId,
      publisherWebId,
      publisherSocialId,
    } = body

    // ── Validation ──
    if (!judul || !judul.trim()) {
      return NextResponse.json(
        { error: 'Judul permohonan wajib diisi' },
        { status: 400 }
      )
    }

    if (!managerId) {
      return NextResponse.json(
        { error: 'Manager wajib dipilih' },
        { status: 400 }
      )
    }

    // Fast track: at least one publisher must be selected
    if (fastTrack && !publisherWebId && !publisherSocialId) {
      return NextResponse.json(
        { error: 'Fast Track: Pilih minimal satu Publisher (Web atau Social Media)' },
        { status: 400 }
      )
    }

    // ── Build data based on fast track ──
    const isFastTrack = Boolean(fastTrack)

    const data: Record<string, unknown> = {
      judul: judul.trim(),
      deskripsi: deskripsi?.trim() || null,
      fastTrack: isFastTrack,
      status: 'IN_PROGRESS',
      managerId,
    }

    if (isFastTrack) {
      // ── Fast Track: skip reporter, fotografer, editor ──
      data.reporterId = null
      data.reporterStatus = 'SKIPPED'
      data.fotograferId = null
      data.fotograferStatus = 'SKIPPED'
      data.editorId = null
      data.editorStatus = 'SKIPPED'

      // Publishers
      data.publisherWebId = publisherWebId || null
      data.publisherWebStatus = publisherWebId ? 'IN_PROGRESS' : 'SKIPPED'
      data.publisherSocialId = publisherSocialId || null
      data.publisherSocialStatus = publisherSocialId ? 'IN_PROGRESS' : 'SKIPPED'
    } else {
      // ── Normal flow ──
      data.reporterId = reporterId || null
      data.reporterStatus = reporterId ? 'IN_PROGRESS' : 'PENDING'
      data.fotograferId = fotograferId || null
      data.fotograferStatus = 'PENDING'
      data.editorId = editorId || null
      data.editorStatus = 'PENDING'
      data.publisherWebId = publisherWebId || null
      data.publisherWebStatus = 'PENDING'
      data.publisherSocialId = publisherSocialId || null
      data.publisherSocialStatus = 'PENDING'

      // If no reporter assigned, set draft
      if (!reporterId) {
        data.status = 'DRAFT'
      }
    }

    const permohonan = await db.permohonan.create({
      data,
      include: {
        manager: { select: { id: true, name: true, email: true, role: true } },
        reporter: { select: { id: true, name: true, email: true, role: true } },
        fotografer: { select: { id: true, name: true, email: true, role: true } },
        editor: { select: { id: true, name: true, email: true, role: true } },
        publisherWeb: { select: { id: true, name: true, email: true, role: true } },
        publisherSocial: { select: { id: true, name: true, email: true, role: true } },
      },
    })

    return NextResponse.json(permohonan, { status: 201 })
  } catch (error) {
    console.error('Failed to create permohonan:', error)
    return NextResponse.json(
      { error: 'Gagal membuat permohonan' },
      { status: 500 }
    )
  }
}
