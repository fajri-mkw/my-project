import { db, ensureDbConnection } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'
import { withEdgeCache } from '@/lib/edge-cache'

// Auto-generate nomor surat
async function generateNomorSurat(jenisSurat: string): Promise<string> {
  const prefix = jenisSurat === 'Surat Masuk' ? 'SM' : 'SK'
  const year = new Date().getFullYear()

  // Find the latest surat with the same prefix and year
  const latestSurat = await db.surat.findFirst({
    where: {
      nomorSurat: { startsWith: `${prefix}-` },
      createdAt: {
        gte: new Date(`${year}-01-01`),
        lt: new Date(`${year + 1}-01-01`)
      }
    },
    orderBy: { createdAt: 'desc' }
  })

  let nextNumber = 1
  if (latestSurat) {
    const match = latestSurat.nomorSurat.match(new RegExp(`${prefix}-(\\d+)`))
    if (match) {
      nextNumber = parseInt(match[1]) + 1
    }
  }

  return `${prefix}-${String(nextNumber).padStart(3, '0')}/${year}`
}

// GET all surat (edge-cached 30s)
export const GET = withEdgeCache(async (request: NextRequest) => {
  try {
    const isConnected = await ensureDbConnection()
    if (!isConnected) {
      return NextResponse.json({ error: 'Database connection failed', surat: [] }, { status: 500 })
    }

    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const userRole = searchParams.get('userRole')
    const jenisSurat = searchParams.get('jenisSurat')
    const status = searchParams.get('status')

    const where: any = {}

    if (jenisSurat) {
      where.jenisSurat = jenisSurat
    }
    if (status) {
      where.status = status
    }

    // Role-based filtering
    if (userRole === 'Admin') {
      // Super Admin sees all
    } else if (userRole === 'Administrator' && userId) {
      // Administrator sees their own surat
      where.administratorId = userId
    } else if (userRole === 'Manager' && userId) {
      // Manager sees surat forwarded to them
      where.managerId = userId
    } else {
      return NextResponse.json([])
    }

    const suratList = await db.surat.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    })

    // Parse JSON fields
    const transformed = suratList.map((s: any) => ({
      ...s,
      documents: JSON.parse(s.documents || '[]'),
    }))

    return NextResponse.json(transformed)
  } catch (error) {
    console.error('Get surat error:', error)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: 'Failed to fetch surat', details: msg, surat: [] }, { status: 500 })
  }
}, { ttl: 30 })

// POST create surat
export async function POST(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const isConnected = await ensureDbConnection()
    if (!isConnected) {
      return NextResponse.json({ error: 'Database connection failed' }, { status: 500 })
    }

    const body = await request.json()
    const {
      jenisSurat, kategori, tanggalSurat, pengirim, penerima,
      perihal, deskripsi, catatan, documents, administratorId,
      location, executionTime, picName, picWhatsApp, nomorSurat: manualNomorSurat
    } = body

    if (!jenisSurat || !perihal) {
      return NextResponse.json({ error: 'Jenis surat dan perihal wajib diisi' }, { status: 400 })
    }

    // Use manual nomor surat if provided, otherwise auto-generate
    const nomorSurat = manualNomorSurat?.trim() || await generateNomorSurat(jenisSurat)

    const surat = await db.surat.create({
      data: {
        nomorSurat,
        jenisSurat,
        kategori: kategori || 'Lainnya',
        tanggalSurat: tanggalSurat ? new Date(tanggalSurat) : null,
        pengirim: pengirim || null,
        penerima: penerima || null,
        perihal,
        deskripsi: deskripsi || null,
        status: 'diterima',
        catatan: catatan || null,
        documents: JSON.stringify(documents || []),
        administratorId: administratorId || null,
        location: location || null,
        executionTime: executionTime || null,
        picName: picName || null,
        picWhatsApp: picWhatsApp || null,
      }
    })

    // Return surat — Google Drive folder is created only when documents are uploaded
    const result = {
      ...surat,
      documents: JSON.parse(surat.documents || '[]'),
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Create surat error:', error)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    // If table doesn't exist, auto-create it and retry
    if (msg.includes('surat') && (msg.includes('does not exist') || msg.includes('relation') || msg.includes('not found'))) {
      try {
        // Auto-create surat table (no trailing semicolon)
        await db.$executeRawUnsafe(`
          CREATE TABLE IF NOT EXISTS "surat" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "nomorSurat" TEXT NOT NULL,
            "jenisSurat" TEXT NOT NULL,
            "kategori" TEXT NOT NULL,
            "tanggalSurat" TIMESTAMP(3),
            "pengirim" TEXT,
            "penerima" TEXT,
            "perihal" TEXT NOT NULL,
            "deskripsi" TEXT,
            "status" TEXT NOT NULL DEFAULT 'diterima',
            "catatan" TEXT,
            "documents" TEXT DEFAULT '[]',
            "driveFolderId" TEXT,
            "driveFolderLink" TEXT,
            "location" TEXT,
            "executionTime" TEXT,
            "picName" TEXT,
            "picWhatsApp" TEXT,
            "administratorId" TEXT,
            "managerId" TEXT,
            "projectId" TEXT,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL
          )
        `)
        console.log('[SURAT] Auto-created surat table')
        return NextResponse.json({ error: 'Tabel surat baru saja dibuat otomatis. Silakan coba lagi.' }, { status: 503 })
      } catch (setupError) {
        console.error('[SURAT] Failed to auto-create table:', setupError)
      }
    }
    return NextResponse.json({ error: 'Failed to create surat', details: msg }, { status: 500 })
  }
}

// PUT update surat
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
      return NextResponse.json({ error: 'Surat ID required' }, { status: 400 })
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

    // Handle tanggalSurat as Date
    if (payload.tanggalSurat) {
      payload.tanggalSurat = new Date(payload.tanggalSurat)
    }

    const updated = await db.surat.update({
      where: { id },
      data: payload
    })

    // Create notifications for specific actions
    if (updateData.status === 'diteruskan' && updateData.managerId) {
      const surat = await db.surat.findUnique({ where: { id } })
      if (surat) {
        // Notify the selected manager
        await db.notification.create({
          data: {
            message: `Surat masuk "${surat.perihal}" (${surat.nomorSurat}) telah diteruskan kepada Anda`,
            userId: updateData.managerId as string,
            projectId: null,
            targetView: 'inbox',
          }
        })

        // Notify administrator that it was forwarded
        if (surat.administratorId) {
          const manager = await db.user.findUnique({ where: { id: updateData.managerId as string } })
          await db.notification.create({
            data: {
              message: `Surat "${surat.perihal}" (${surat.nomorSurat}) telah diteruskan kepada ${manager?.name || 'Manager'}`,
              userId: surat.administratorId,
              projectId: null,
              targetView: 'permohonan',
            }
          })
        }

        // Note: Google Drive folder is only created when documents are uploaded,
        // not during forwarding. This prevents duplicate folder creation.
      }
    }

    const result = {
      ...updated,
      documents: JSON.parse(updated.documents || '[]'),
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Update surat error:', error)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: 'Failed to update surat', details: msg }, { status: 500 })
  }
}

// DELETE surat
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
      return NextResponse.json({ error: 'Surat ID required' }, { status: 400 })
    }

    const surat = await db.surat.findUnique({ where: { id } })
    if (!surat) {
      return NextResponse.json({ error: 'Surat not found' }, { status: 404 })
    }

    await db.surat.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete surat error:', error)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: 'Failed to delete surat', details: msg }, { status: 500 })
  }
}
