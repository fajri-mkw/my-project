import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const permohonan = await db.permohonan.findUnique({
      where: { id },
      include: {
        manager: { select: { id: true, name: true, email: true, role: true } },
        reporter: { select: { id: true, name: true, email: true, role: true } },
        fotografer: { select: { id: true, name: true, email: true, role: true } },
        editor: { select: { id: true, name: true, email: true, role: true } },
        publisherWeb: { select: { id: true, name: true, email: true, role: true } },
        publisherSocial: { select: { id: true, name: true, email: true, role: true } },
      },
    })

    if (!permohonan) {
      return NextResponse.json(
        { error: 'Permohonan tidak ditemukan' },
        { status: 404 }
      )
    }

    return NextResponse.json(permohonan)
  } catch (error) {
    console.error('Failed to fetch permohonan:', error)
    return NextResponse.json(
      { error: 'Gagal memuat data permohonan' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { step, content, linkPublikasiWeb, linkPublikasiSocial } = body

    // ── Fetch current permohonan ──
    const permohonan = await db.permohonan.findUnique({ where: { id } })
    if (!permohonan) {
      return NextResponse.json(
        { error: 'Permohonan tidak ditemukan' },
        { status: 404 }
      )
    }

    const now = new Date()
    const updateData: Record<string, unknown> = { updatedAt: now }

    // ── Complete a workflow step ──
    switch (step) {
      case 'reporter':
        if (permohonan.reporterStatus === 'SKIPPED') {
          return NextResponse.json(
            { error: 'Step ini dilewati (Fast Track)' },
            { status: 400 }
          )
        }
        updateData.reporterStatus = 'COMPLETED'
        updateData.reporterCompletedAt = now
        if (content) updateData.kontenBerita = content
        // Move next step
        if (permohonan.fotograferId && permohonan.fotograferStatus === 'PENDING') {
          updateData.fotograferStatus = 'IN_PROGRESS'
        }
        break

      case 'fotografer':
        if (permohonan.fotograferStatus === 'SKIPPED') {
          return NextResponse.json(
            { error: 'Step ini dilewati (Fast Track)' },
            { status: 400 }
          )
        }
        updateData.fotograferStatus = 'COMPLETED'
        updateData.fotograferCompletedAt = now
        if (content) updateData.fotoUrls = content
        // Move next step
        if (permohonan.editorId && permohonan.editorStatus === 'PENDING') {
          updateData.editorStatus = 'IN_PROGRESS'
        }
        break

      case 'editor':
        if (permohonan.editorStatus === 'SKIPPED') {
          return NextResponse.json(
            { error: 'Step ini dilewati (Fast Track)' },
            { status: 400 }
          )
        }
        updateData.editorStatus = 'COMPLETED'
        updateData.editorCompletedAt = now
        if (content) updateData.editedContent = content
        // Move to publishing phase
        updateData.status = 'PUBLISHING'
        if (permohonan.publisherWebId && permohonan.publisherWebStatus === 'PENDING') {
          updateData.publisherWebStatus = 'IN_PROGRESS'
        }
        if (permohonan.publisherSocialId && permohonan.publisherSocialStatus === 'PENDING') {
          updateData.publisherSocialStatus = 'IN_PROGRESS'
        }
        break

      case 'publisherWeb':
        if (permohonan.publisherWebStatus === 'SKIPPED') {
          return NextResponse.json(
            { error: 'Step ini dilewati' },
            { status: 400 }
          )
        }
        updateData.publisherWebStatus = 'COMPLETED'
        updateData.publisherWebCompletedAt = now
        if (linkPublikasiWeb) updateData.linkPublikasiWeb = linkPublikasiWeb
        if (!permohonan.fastTrack && permohonan.status !== 'PUBLISHING') {
          updateData.status = 'PUBLISHING'
        }
        break

      case 'publisherSocial':
        if (permohonan.publisherSocialStatus === 'SKIPPED') {
          return NextResponse.json(
            { error: 'Step ini dilewati' },
            { status: 400 }
          )
        }
        updateData.publisherSocialStatus = 'COMPLETED'
        updateData.publisherSocialCompletedAt = now
        if (linkPublikasiSocial) updateData.linkPublikasiSocial = linkPublikasiSocial
        if (!permohonan.fastTrack && permohonan.status !== 'PUBLISHING') {
          updateData.status = 'PUBLISHING'
        }
        break

      default:
        return NextResponse.json(
          { error: 'Step tidak valid' },
          { status: 400 }
        )
    }

    // ── Apply update ──
    const updated = await db.permohonan.update({
      where: { id },
      data: updateData,
      include: {
        manager: { select: { id: true, name: true, email: true, role: true } },
        reporter: { select: { id: true, name: true, email: true, role: true } },
        fotografer: { select: { id: true, name: true, email: true, role: true } },
        editor: { select: { id: true, name: true, email: true, role: true } },
        publisherWeb: { select: { id: true, name: true, email: true, role: true } },
        publisherSocial: { select: { id: true, name: true, email: true, role: true } },
      },
    })

    // ── Check if all assigned steps are completed → mark COMPLETED & create Rekapitulasi ──
    const allDone =
      (updated.reporterStatus === 'SKIPPED' || updated.reporterStatus === 'COMPLETED') &&
      (updated.fotograferStatus === 'SKIPPED' || updated.fotograferStatus === 'COMPLETED') &&
      (updated.editorStatus === 'SKIPPED' || updated.editorStatus === 'COMPLETED') &&
      (updated.publisherWebStatus === 'SKIPPED' || updated.publisherWebStatus === 'COMPLETED') &&
      (updated.publisherSocialStatus === 'SKIPPED' || updated.publisherSocialStatus === 'COMPLETED')

    if (allDone && updated.status !== 'COMPLETED') {
      await db.permohonan.update({
        where: { id },
        data: { status: 'COMPLETED', updatedAt: new Date() },
      })

      // ── Create Rekapitulasi ──
      const existingRekap = await db.rekapitulasi.findUnique({
        where: { permohonanId: id },
      })

      if (!existingRekap) {
        await db.rekapitulasi.create({
          data: {
            permohonanId: id,
            judul: updated.judul,
            isFastTrack: updated.fastTrack,
            tanggalSelesai: new Date(),
            linkWeb: updated.linkPublikasiWeb,
            linkSocial: updated.linkPublikasiSocial,
            namaPublisherWeb: updated.publisherWeb?.name || null,
            namaPublisherSocial: updated.publisherSocial?.name || null,
          },
        })
      }
    }

    // Re-fetch with final state
    const finalPermohonan = await db.permohonan.findUnique({
      where: { id },
      include: {
        manager: { select: { id: true, name: true, email: true, role: true } },
        reporter: { select: { id: true, name: true, email: true, role: true } },
        fotografer: { select: { id: true, name: true, email: true, role: true } },
        editor: { select: { id: true, name: true, email: true, role: true } },
        publisherWeb: { select: { id: true, name: true, email: true, role: true } },
        publisherSocial: { select: { id: true, name: true, email: true, role: true } },
      },
    })

    return NextResponse.json(finalPermohonan)
  } catch (error) {
    console.error('Failed to update permohonan:', error)
    return NextResponse.json(
      { error: 'Gagal memperbarui permohonan' },
      { status: 500 }
    )
  }
}
