import { NextResponse } from 'next/server'
import { db, ensureDbConnection } from '@/lib/db'

export async function GET(request: Request) {
  try {
    await ensureDbConnection()
    const { searchParams } = new URL(request.url)
    const isFastTrack = searchParams.get('fastTrack')

    const where: Record<string, unknown> = {}
    if (isFastTrack !== null && isFastTrack !== undefined) {
      where.isFastTrack = isFastTrack === 'true'
    }

    const rekapitulasi = await db.rekapitulasi.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        permohonan: {
          select: {
            id: true,
            judul: true,
            fastTrack: true,
            status: true,
            deskripsi: true,
            createdAt: true,
            manager: { select: { id: true, name: true } },
          },
        },
      },
    })

    return NextResponse.json(rekapitulasi)
  } catch (error) {
    console.error('Failed to fetch rekapitulasi:', error)
    return NextResponse.json(
      { error: 'Gagal memuat rekapitulasi' },
      { status: 500 }
    )
  }
}
