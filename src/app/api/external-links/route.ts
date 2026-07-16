import { db, ensureDbConnection } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'

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

// ----------------------------------------------------------------------------
// Direct Cache API helpers (bypasses the generic withEdgeCache wrapper).
//
// We use SEPARATE cache keys for the public (active-only) and admin (all)
// responses so that:
//   1. Inactive links never leak into the public cache entry.
//   2. The admin list is also cached (short TTL) to avoid repeated DB round
//      trips on every settings-page reload — this prevents the Worker from
//      hanging under concurrent DB load (Cloudflare cancels hung Workers).
// ----------------------------------------------------------------------------
const CACHE_BASE = 'https://edge-cache.pushakin-flows.workers.dev/api/external-links'
const PUBLIC_CACHE_KEY = `${CACHE_BASE}?public`
const ADMIN_CACHE_KEY = `${CACHE_BASE}?admin`
const PUBLIC_TTL = 30   // seconds — active links rarely change
const ADMIN_TTL = 10    // seconds — short so admin sees fresh data after toggles

function getCache(): Cache | null {
  try {
    // @ts-ignore - caches is available in Cloudflare Workers runtime
    if (typeof caches !== 'undefined' && caches.default) {
      // @ts-ignore
      return caches.default
    }
  } catch {}
  return null
}

async function readCache(key: string): Promise<Response | null> {
  try {
    const cache = getCache()
    if (!cache) return null
    const cached = await cache.match(key)
    return cached || null
  } catch {
    return null
  }
}

async function writeCache(key: string, response: Response, ttl: number): Promise<void> {
  try {
    const cache = getCache()
    if (!cache) return
    const clone = response.clone()
    const headers = new Headers(clone.headers)
    headers.set('Cache-Control', `public, max-age=${ttl}`)
    const cached = new Response(clone.body, {
      status: clone.status,
      statusText: clone.statusText,
      headers,
    })
    // Defer cache.put via ctx.waitUntil when on Cloudflare Workers (OpenNext),
    // otherwise await it inline (local dev). The old code checked
    // `typeof ctx !== 'undefined'` but ctx is NOT a global on OpenNext —
    // getCloudflareContext() is the correct accessor.
    let cachePutDeferred = false
    try {
      const cfCtx = getCloudflareContext() as
        | { ctx?: { waitUntil?: (p: Promise<unknown>) => void } }
        | undefined
      if (cfCtx?.ctx?.waitUntil) {
        cfCtx.ctx.waitUntil(cache.put(key, cached))
        cachePutDeferred = true
      }
    } catch {
      // No active CF context (local dev) — fall through to await
    }
    if (!cachePutDeferred) {
      await cache.put(key, cached)
    }
  } catch {}
}

// Bust BOTH cache entries after any mutation (create/update/delete).
// We call cache.delete directly with the full key (invalidateCache would
// double the base-URL prefix).
async function bustExternalLinksCache(): Promise<void> {
  const cache = getCache()
  if (!cache) return
  try {
    await Promise.all([
      cache.delete(PUBLIC_CACHE_KEY),
      cache.delete(ADMIN_CACHE_KEY),
    ])
  } catch {}
}

// ============================================================================
// GET /api/external-links
//   - Public: returns only active links, sorted by `order` then `createdAt`
//   - Admin (pass ?adminUserId=...&all=true): returns all links (incl. inactive)
//
// Both responses are cached at the edge with SEPARATE keys so the admin list
// (which requires 2 DB round trips: verifySuperAdmin + findMany) doesn't hammer
// the database on every settings-page reload. The short admin TTL (10s) keeps
// the data fresh while dramatically reducing DB load.
// ============================================================================
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const showAll = url.searchParams.get('all') === 'true'
    const adminUserId = url.searchParams.get('adminUserId')

    // Choose cache key based on whether this is an admin "show all" request
    const cacheKey = showAll ? ADMIN_CACHE_KEY : PUBLIC_CACHE_KEY
    const ttl = showAll ? ADMIN_TTL : PUBLIC_TTL

    // 1) Try cache first — avoids DB entirely on hit
    const cached = await readCache(cacheKey)
    if (cached) {
      const headers = new Headers(cached.headers)
      headers.set('x-edge-cache', 'HIT')
      return new Response(cached.body, {
        status: cached.status,
        statusText: cached.statusText,
        headers,
      })
    }

    // 2) Cache miss — query the database
    await ensureDbConnection()

    // Only reveal inactive links to verified Super Admin.
    // For the admin path we must verify; for the public path we skip the
    // extra DB query entirely (always active-only).
    const allowAll = showAll ? await verifySuperAdmin(adminUserId) : false

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

    const response = NextResponse.json({ links: result })
    // 3) Cache the successful response (non-blocking via waitUntil)
    await writeCache(cacheKey, response, ttl)
    return response
  } catch (error) {
    console.error('Get external links error:', error)
    return NextResponse.json(
      { error: 'Gagal memuat daftar link eksternal' },
      { status: 500 }
    )
  }
}

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

    await bustExternalLinksCache()
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

    await bustExternalLinksCache()
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

    await bustExternalLinksCache()
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete external link error:', error)
    return NextResponse.json(
      { error: 'Gagal menghapus link eksternal' },
      { status: 500 }
    )
  }
}
