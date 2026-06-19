import { NextRequest, NextResponse } from 'next/server'
import { db, ensureDbConnection } from '@/lib/db'
import { checkMaintenanceMode } from '@/lib/maintenance-check'
import { withEdgeCache, invalidateCache } from '@/lib/edge-cache'

// GET - Fetch all SOPs/Pengumuman
// Edge-cached for 300s (5 min) — SOPs rarely change
export const GET = withEdgeCache(async (request: NextRequest) => {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    await ensureDbConnection()
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') // SOP, Pengumuman, Panduan
    const published = searchParams.get('published')

    const where: {
      type?: 'SOP' | 'Pengumuman' | 'Panduan'
      published?: boolean
    } = {}

    if (type && ['SOP', 'Pengumuman', 'Panduan'].includes(type)) {
      where.type = type as 'SOP' | 'Pengumuman' | 'Panduan'
    }

    if (published === 'true') {
      where.published = true
    }

    const sops = await db.sOP.findMany({
      where,
      include: {
        author: {
          select: { id: true, name: true, email: true, role: true }
        }
      },
      orderBy: [
        { order: 'asc' },
        { createdAt: 'desc' }
      ]
    })

    return NextResponse.json(sops)
  } catch (error) {
    console.error('Error fetching SOPs:', error)
    return NextResponse.json(
      { error: 'Gagal mengambil data' },
      { status: 500 }
    )
  }
}, { ttl: 300 })

// POST - Create new SOP/Pengumuman
export async function POST(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    await ensureDbConnection()
    const body = await request.json()
    const {
      title,
      content,
      type = 'SOP',
      displayMode = 'text',
      files,
      slideshowSpeed = 5000,
      published = false,
      order = 0,
      authorId
    } = body

    if (!title || !content || !authorId) {
      return NextResponse.json(
        { error: 'Judul, konten, dan author wajib diisi' },
        { status: 400 }
      )
    }

    const sop = await db.sOP.create({
      data: {
        title,
        content,
        type: type as 'SOP' | 'Pengumuman' | 'Panduan',
        displayMode: displayMode as 'text' | 'static' | 'slideshow' | 'pdf',
        files: files ? JSON.stringify(files) : null,
        slideshowSpeed,
        published,
        order,
        authorId
      },
      include: {
        author: {
          select: { id: true, name: true, email: true, role: true }
        }
      }
    })

    await invalidateCache('/api/sop')
    return NextResponse.json(sop)
  } catch (error) {
    console.error('Error creating SOP:', error)
    return NextResponse.json(
      { error: 'Gagal membuat data' },
      { status: 500 }
    )
  }
}

// PUT - Update SOP/Pengumuman
export async function PUT(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    await ensureDbConnection()
    const body = await request.json()
    const { id, ...data } = body

    if (!id) {
      return NextResponse.json(
        { error: 'ID wajib diisi' },
        { status: 400 }
      )
    }

    const updateData: {
      title?: string
      content?: string
      type?: 'SOP' | 'Pengumuman' | 'Panduan'
      displayMode?: 'text' | 'static' | 'slideshow' | 'pdf'
      files?: string | null
      slideshowSpeed?: number
      published?: boolean
      order?: number
    } = {}

    if (data.title) updateData.title = data.title
    if (data.content) updateData.content = data.content
    if (data.type && ['SOP', 'Pengumuman', 'Panduan'].includes(data.type)) {
      updateData.type = data.type as 'SOP' | 'Pengumuman' | 'Panduan'
    }
    if (data.displayMode && ['text', 'static', 'slideshow', 'pdf'].includes(data.displayMode)) {
      updateData.displayMode = data.displayMode as 'text' | 'static' | 'slideshow' | 'pdf'
    }
    if (data.files !== undefined) {
      updateData.files = data.files ? JSON.stringify(data.files) : null
    }
    if (data.slideshowSpeed !== undefined) updateData.slideshowSpeed = data.slideshowSpeed
    if (data.published !== undefined) updateData.published = data.published
    if (data.order !== undefined) updateData.order = data.order

    const sop = await db.sOP.update({
      where: { id },
      data: updateData,
      include: {
        author: {
          select: { id: true, name: true, email: true, role: true }
        }
      }
    })

    await invalidateCache('/api/sop')
    return NextResponse.json(sop)
  } catch (error) {
    console.error('Error updating SOP:', error)
    return NextResponse.json(
      { error: 'Gagal mengupdate data' },
      { status: 500 }
    )
  }
}

// DELETE - Delete SOP/Pengumuman
export async function DELETE(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    await ensureDbConnection()
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { error: 'ID wajib diisi' },
        { status: 400 }
      )
    }

    await db.sOP.delete({
      where: { id }
    })

    await invalidateCache('/api/sop')
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting SOP:', error)
    return NextResponse.json(
      { error: 'Gagal menghapus data' },
      { status: 500 }
    )
  }
}
