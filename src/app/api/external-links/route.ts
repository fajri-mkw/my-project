import { db, ensureDbConnection } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { withEdgeCache, invalidateCache } from '@/lib/edge-cache'

// ============================================================================
// Public interface for an external link (returned to clients)
// ============================================================================
export interface ExternalLinkDTO {
  id: string
  label: string
  url: string
  icon: string | null
  description: string | null
  isActive: boolean
  order: number
}

// ============================================================================
// Helpers
// ============================================================================

function isValidUrl(value: string): boolean {
  if (!value) return false
  try {
    const u = new URL(value)
    // Only allow http/https — never javascript:, data:, etc. for safety
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

// Verify that the given userId belongs to a Super Admin (role === 'Admin').
// Used for all mutating operations (POST/PUT/DELETE) — consistent with the
// maintenance route's admin verification pattern.
async function verifySuperAdmin(userId: string | null): Promise<boolean> {
  if (!userId) return false
  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { role: true }
    })
    return !!user && user.role === 'Admin'
  } catch {
    return false
  }
}

// ============================================================================
// GET /api/external-links
//   - Public: returns only active links, sorted by `order` then `createdAt`
//   - Admin (pass ?adminUserId=...&all=true): returns all links (incl. inactive)
//
// NOTE: We bypass the edge cache when an admin requests `all=true`, otherwise
// the cached public (active-only) response would leak back to the admin.
// ============================================================================
export const GET = withEdgeCache(async (request: NextRequest) => {
  try {
    await ensureDbConnection()

    const url = new URL(request.url)
    const showAll = url.searchParams.get('all') === 'true'
    const adminUserId = url.searchParams.get('adminUserId')

    // Only reveal inactive links to verified Super Admin
    const allowAll = showAll && await verifySuperAdmin(adminUserId)

    const links = await db.externalLink.findMany({
      where: allowAll ? {} : { isActive: true },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }]
    })

    const result: ExternalLinkDTO[] = links.map(l => ({
      id: l.id,
      label: l.label,
      url: l.url,
      icon: l.icon,
      description: l.description,
      isActive: l.isActive,
      order: l.order
    }))

    return NextResponse.json({ links: result })
  } catch (error) {
    console.error('Get external links error:', error)
    return NextResponse.json(
      { error: 'Gagal memuat daftar link eksternal' },
      { status: 500 }
    )
  }
}, {
  ttl: 30,
  // Bypass cache for admin "show all" requests so inactive links don't leak
  // through the public cache entry.
  shouldBypass: (request: Request) => {
    try {
      const url = new URL(request.url)
      return url.searchParams.get('all') === 'true' ||
        !!url.searchParams.get('adminUserId')
    } catch {
      return false
    }
  }
})

// ============================================================================
// POST /api/external-links — Create a new link (Super Admin only)
// Body: { adminUserId, label, url, icon?, description?, isActive?, order? }
// ============================================================================
export async function POST(request: NextRequest) {
  try {
    await ensureDbConnection()

    const body = await request.json()
    const { adminUserId, label, url, icon, description, isActive, order } = body

    if (!(await verifySuperAdmin(adminUserId))) {
      return NextResponse.json(
        { error: 'Hanya Super Admin yang dapat menambahkan link eksternal' },
        { status: 403 }
      )
    }

    if (!label || typeof label !== 'string' || !label.trim()) {
      return NextResponse.json(
        { error: 'Nama link wajib diisi' },
        { status: 400 }
      )
    }
    if (!url || typeof url !== 'string' || !isValidUrl(url.trim())) {
      return NextResponse.json(
        { error: 'URL tidak valid. Gunakan format http:// atau https://' },
        { status: 400 }
      )
    }

    // Determine next order if not provided
    let nextOrder = typeof order === 'number' ? order : 0
    if (typeof order !== 'number') {
      const maxRow = await db.externalLink.findFirst({
        orderBy: { order: 'desc' },
        select: { order: true }
      })
      nextOrder = maxRow ? maxRow.order + 1 : 0
    }

    const created = await db.externalLink.create({
      data: {
        label: label.trim(),
        url: url.trim(),
        icon: typeof icon === 'string' && icon.trim() ? icon.trim() : null,
        description: typeof description === 'string' && description.trim() ? description.trim() : null,
        isActive: typeof isActive === 'boolean' ? isActive : true,
        order: nextOrder
      }
    })

    await invalidateCache('/api/external-links')
    return NextResponse.json({ success: true, link: created })
  } catch (error) {
    console.error('Create external link error:', error)
    return NextResponse.json(
      { error: 'Gagal menambahkan link eksternal' },
      { status: 500 }
    )
  }
}

// ============================================================================
// PUT /api/external-links — Update an existing link (Super Admin only)
// Body: { adminUserId, id, label?, url?, icon?, description?, isActive?, order? }
// ============================================================================
export async function PUT(request: NextRequest) {
  try {
    await ensureDbConnection()

    const body = await request.json()
    const { adminUserId, id, label, url, icon, description, isActive, order } = body

    if (!(await verifySuperAdmin(adminUserId))) {
      return NextResponse.json(
        { error: 'Hanya Super Admin yang dapat mengubah link eksternal' },
        { status: 403 }
      )
    }

    if (!id || typeof id !== 'string') {
      return NextResponse.json(
        { error: 'ID link wajib diisi' },
        { status: 400 }
      )
    }

    const updateData: {
      label?: string
      url?: string
      icon?: string | null
      description?: string | null
      isActive?: boolean
      order?: number
    } = {}

    if (typeof label === 'string' && label.trim()) updateData.label = label.trim()
    if (typeof url === 'string') {
      if (!isValidUrl(url.trim())) {
        return NextResponse.json(
          { error: 'URL tidak valid. Gunakan format http:// atau https://' },
          { status: 400 }
        )
      }
      updateData.url = url.trim()
    }
    if (icon !== undefined) {
      updateData.icon = typeof icon === 'string' && icon.trim() ? icon.trim() : null
    }
    if (description !== undefined) {
      updateData.description = typeof description === 'string' && description.trim() ? description.trim() : null
    }
    if (typeof isActive === 'boolean') updateData.isActive = isActive
    if (typeof order === 'number') updateData.order = order

    const updated = await db.externalLink.update({
      where: { id },
      data: updateData
    })

    await invalidateCache('/api/external-links')
    return NextResponse.json({ success: true, link: updated })
  } catch (error) {
    console.error('Update external link error:', error)
    return NextResponse.json(
      { error: 'Gagal mengubah link eksternal' },
      { status: 500 }
    )
  }
}

// ============================================================================
// DELETE /api/external-links?id=...&adminUserId=... — Delete a link (Super Admin only)
// ============================================================================
export async function DELETE(request: NextRequest) {
  try {
    await ensureDbConnection()

    const url = new URL(request.url)
    const id = url.searchParams.get('id')
    const adminUserId = url.searchParams.get('adminUserId')

    if (!(await verifySuperAdmin(adminUserId))) {
      return NextResponse.json(
        { error: 'Hanya Super Admin yang dapat menghapus link eksternal' },
        { status: 403 }
      )
    }

    if (!id) {
      return NextResponse.json(
        { error: 'ID link wajib diisi' },
        { status: 400 }
      )
    }

    await db.externalLink.delete({ where: { id } })

    await invalidateCache('/api/external-links')
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete external link error:', error)
    return NextResponse.json(
      { error: 'Gagal menghapus link eksternal' },
      { status: 500 }
    )
  }
}
