import { db, ensureDbConnection } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'
import { withEdgeCache } from '@/lib/edge-cache'

// Auto-generate nomor kegiatan: KG-001/2025
async function generateNomorKegiatan(): Promise<string> {
  const prefix = 'KG'
  const year = new Date().getFullYear()

  const latest = await db.programKegiatan.findFirst({
    where: {
      nomorKegiatan: { startsWith: `${prefix}-` },
      createdAt: {
        gte: new Date(`${year}-01-01`),
        lt: new Date(`${year + 1}-01-01`)
      }
    },
    orderBy: { createdAt: 'desc' }
  })

  let nextNumber = 1
  if (latest) {
    const match = latest.nomorKegiatan.match(new RegExp(`${prefix}-(\\d+)`))
    if (match) {
      nextNumber = parseInt(match[1]) + 1
    }
  }

  return `${prefix}-${String(nextNumber).padStart(3, '0')}/${year}`
}

// GET all program kegiatan (edge-cached 30s)
export const GET = withEdgeCache(async (request: NextRequest) => {
  try {
    const isConnected = await ensureDbConnection()
    if (!isConnected) {
      return NextResponse.json({ error: 'Database connection failed', programKegiatan: [] }, { status: 500 })
    }

    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const userRole = searchParams.get('userRole')
    const status = searchParams.get('status')

    const where: any = {}

    if (status) {
      where.status = status
    }

    // Role-based filtering
    if (userRole === 'Admin') {
      // Super Admin sees all
    } else if ((userRole === 'Manager') && userId) {
      // Manager sees their own kegiatan
      where.managerId = userId
    } else {
      return NextResponse.json([])
    }

    const kegiatanList = await db.programKegiatan.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    })

    // Parse JSON fields
    const transformed = kegiatanList.map((k: any) => ({
      ...k,
      documents: JSON.parse(k.documents || '[]'),
    }))

    return NextResponse.json(transformed)
  } catch (error) {
    console.error('Get program kegiatan error:', error)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: 'Failed to fetch program kegiatan', details: msg, programKegiatan: [] }, { status: 500 })
  }
}, { ttl: 30 })

// POST create program kegiatan
export async function POST(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const isConnected = await ensureDbConnection()
    if (!isConnected) {
      return NextResponse.json({ error: 'Database connection failed' }, { status: 500 })
    }

    const body = await request.json()
    // Verbose body logging only in dev — on Cloudflare Workers free plan,
    // console.log of large bodies wastes CPU and can push the request past
    // the 10ms limit (the exact cause of the "Terjadi kesalahan koneksi" bug).
    if (process.env.NODE_ENV === 'development') {
      console.log('[KEGIATAN POST] Body received:', JSON.stringify(body, null, 2))
    }
    const {
      tanggalKegiatan, perihal, deskripsi, documents, managerId,
    } = body

    if (!perihal) {
      return NextResponse.json({ error: 'Nama kegiatan wajib diisi' }, { status: 400 })
    }

    // Auto-generate nomor kegiatan
    const nomorKegiatan = await generateNomorKegiatan()

    const kegiatan = await db.programKegiatan.create({
      data: {
        nomorKegiatan,
        jenisKegiatan: 'Kegiatan',
        kategori: 'Umum',
        tanggalKegiatan: tanggalKegiatan ? new Date(tanggalKegiatan) : null,
        perihal,
        deskripsi: deskripsi || null,
        status: 'direncanakan',
        catatan: null,
        documents: JSON.stringify(documents || []),
        managerId: managerId || null,
      }
    })

    const result = {
      ...kegiatan,
      documents: JSON.parse(kegiatan.documents || '[]'),
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Create program kegiatan error:', error)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    const stack = error instanceof Error ? error.stack : ''
    console.error('[KEGIATAN POST] Error details:', msg, stack)
    return NextResponse.json({ error: 'Failed to create program kegiatan', details: msg }, { status: 500 })
  }
}

// PUT update program kegiatan
export async function PUT(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const isConnected = await ensureDbConnection()
    if (!isConnected) {
      return NextResponse.json({ error: 'Database connection failed' }, { status: 500 })
    }

    const body = await request.json()
    const { id, ...updateData } = body

    if (!id) {
      return NextResponse.json({ error: 'Kegiatan ID required' }, { status: 400 })
    }

    // Prepare update payload - serialize documents
    const payload: any = {}
    for (const [key, value] of Object.entries(updateData)) {
      if (key === 'documents') {
        payload[key] = JSON.stringify(value)
      } else {
        payload[key] = value
      }
    }

    // Handle tanggalKegiatan as Date
    if (payload.tanggalKegiatan) {
      payload.tanggalKegiatan = new Date(payload.tanggalKegiatan)
    }

    const updated = await db.programKegiatan.update({
      where: { id },
      data: payload
    })

    const result = {
      ...updated,
      documents: JSON.parse(updated.documents || '[]'),
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Update program kegiatan error:', error)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: 'Failed to update program kegiatan', details: msg }, { status: 500 })
  }
}

// DELETE program kegiatan
export async function DELETE(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const isConnected = await ensureDbConnection()
    if (!isConnected) {
      return NextResponse.json({ error: 'Database connection failed' }, { status: 500 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Kegiatan ID required' }, { status: 400 })
    }

    const kegiatan = await db.programKegiatan.findUnique({ where: { id } })
    if (!kegiatan) {
      return NextResponse.json({ error: 'Kegiatan not found' }, { status: 404 })
    }

    await db.programKegiatan.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete program kegiatan error:', error)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: 'Failed to delete program kegiatan', details: msg }, { status: 500 })
  }
}
