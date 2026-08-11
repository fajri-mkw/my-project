import { NextRequest, NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { getLibsql, toBool, bind, genId, nowMs, type InValue } from '@/lib/libsql-client'

// ============================================================================
// External links route — CRUD for the sidebar's "external apps" list.
//
// Rewritten to use @libsql/client directly (bypasses Prisma CPU overhead) —
// same pattern as src/app/api/maintenance/route.ts and src/app/api/users/route.ts.
// The Prisma import (`db` + `ensureDbConnection`) caused Cloudflare Workers
// Error 1102 (Worker exceeded resource limits) on cold starts because loading
// Prisma's WASM module + running ensureSchemaSync() burned too much CPU on the
// Workers free plan (10ms CPU limit).
//
// THIS ROUTE IS HOT: the sidebar calls GET on every page load. Keeping the
// direct Cloudflare Cache API usage (SEPARATE public/admin cache keys + ctx
// .waitUntil for cache.put) is critical for staying under the Workers CPU
// limit — we only pay DB round-trip cost on cache miss.
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

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

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
// Direct libsql read — NO Prisma, NO ensureDbConnection().
async function verifySuperAdmin(userId: string | null): Promise<boolean> {
  if (!userId) return false
  try {
    const client = getLibsql()
    const result = await client.execute({
      sql: `SELECT role FROM users WHERE id = ? LIMIT 1`,
      args: [bind(userId)],
    })
    if (result.rows.length === 0) return false
    return String((result.rows[0] as Record<string, unknown>).role ?? '') === 'Admin'
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

// Map a raw libsql row (from the external_links table) to the DTO the frontend
// expects. Boolean columns come back as 0/1 from SQLite — toBool() converts.
function mapExternalLink(row: Record<string, unknown>): ExternalLinkDTO {
  return {
    id: String(row.id ?? ''),
    label: String(row.label ?? ''),
    url: String(row.url ?? ''),
    icon:
      row.icon === null || row.icon === undefined ? null : String(row.icon),
    description:
      row.description === null || row.description === undefined
        ? null
        : String(row.description),
    isActive: toBool(row.isActive),
    order: Number(row.order ?? 0),
  }
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

    // 2) Cache miss — query the database (libsql singleton, lazy connect).
    const client = getLibsql()

    // Only reveal inactive links to verified Super Admin.
    // For the admin path we must verify; for the public path we skip the
    // extra DB query entirely (always active-only).
    const allowAll = showAll ? await verifySuperAdmin(adminUserId) : false

    const sql = allowAll
      ? `SELECT id, label, url, icon, description, isActive, \`order\`
         FROM external_links
         ORDER BY \`order\` ASC, createdAt ASC`
      : `SELECT id, label, url, icon, description, isActive, \`order\`
         FROM external_links
         WHERE isActive = 1
         ORDER BY \`order\` ASC, createdAt ASC`

    const result = await client.execute({ sql, args: [] })
    const links = result.rows.map((row) =>
      mapExternalLink(row as Record<string, unknown>),
    )

    const response = NextResponse.json({ links })
    // 3) Cache the successful response (non-blocking via waitUntil)
    await writeCache(cacheKey, response, ttl)
    return response
  } catch (error) {
    console.error('Get external links error:', error)
    return NextResponse.json(
      { error: 'Gagal memuat daftar link eksternal' },
      { status: 500 },
    )
  }
}

// ============================================================================
// POST /api/external-links — Create a new link (Super Admin only)
// Body: { adminUserId, label, url, icon?, description?, isActive?, order? }
// ============================================================================
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { adminUserId, label, url, icon, description, isActive, order } = body as {
      adminUserId?: string
      label?: string
      url?: string
      icon?: string
      description?: string
      isActive?: boolean
      order?: number
    }

    if (!(await verifySuperAdmin(adminUserId ?? null))) {
      return NextResponse.json(
        { error: 'Hanya Super Admin yang dapat menambahkan link eksternal' },
        { status: 403 },
      )
    }

    if (!label || typeof label !== 'string' || !label.trim()) {
      return NextResponse.json(
        { error: 'Nama link wajib diisi' },
        { status: 400 },
      )
    }
    if (!url || typeof url !== 'string' || !isValidUrl(url.trim())) {
      return NextResponse.json(
        { error: 'URL tidak valid. Gunakan format http:// atau https://' },
        { status: 400 },
      )
    }

    // Determine next order if not provided — replaces Prisma's findFirst
    // orderBy: { order: 'desc' }. LIMIT 1 keeps this cheap.
    let nextOrder = typeof order === 'number' ? order : 0
    if (typeof order !== 'number') {
      const client0 = getLibsql()
      const maxRes = await client0.execute({
        sql: `SELECT \`order\` AS o FROM external_links ORDER BY \`order\` DESC LIMIT 1`,
        args: [],
      })
      if (maxRes.rows.length > 0) {
        nextOrder = Number((maxRes.rows[0] as Record<string, unknown>).o ?? 0) + 1
      }
    }

    const id = genId()
    const ts = nowMs()
    const client = getLibsql()
    const safeIcon = typeof icon === 'string' && icon.trim() ? icon.trim() : null
    const safeDescription =
      typeof description === 'string' && description.trim()
        ? description.trim()
        : null
    const safeActive = typeof isActive === 'boolean' ? isActive : true

    await client.execute({
      sql: `INSERT INTO external_links
            (id, label, url, icon, description, isActive, \`order\`, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        bind(id),
        bind(label.trim()),
        bind(url.trim()),
        bind(safeIcon),
        bind(safeDescription),
        bind(safeActive ? 1 : 0),
        bind(nextOrder),
        bind(ts),
        bind(ts),
      ],
    })

    // Re-fetch to mirror Prisma's `create()` returning the persisted row.
    const selRes = await client.execute({
      sql: `SELECT id, label, url, icon, description, isActive, \`order\`
            FROM external_links WHERE id = ? LIMIT 1`,
      args: [bind(id)],
    })
    const created =
      selRes.rows.length > 0
        ? mapExternalLink(selRes.rows[0] as Record<string, unknown>)
        : {
            id,
            label: label.trim(),
            url: url.trim(),
            icon: safeIcon,
            description: safeDescription,
            isActive: safeActive,
            order: nextOrder,
          }

    await bustExternalLinksCache()
    return NextResponse.json({ success: true, link: created })
  } catch (error) {
    console.error('Create external link error:', error)
    return NextResponse.json(
      { error: 'Gagal menambahkan link eksternal' },
      { status: 500 },
    )
  }
}

// ============================================================================
// PUT /api/external-links — Update an existing link (Super Admin only)
// Body: { adminUserId, id, label?, url?, icon?, description?, isActive?, order? }
// ============================================================================
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { adminUserId, id, label, url, icon, description, isActive, order } = body as {
      adminUserId?: string
      id?: string
      label?: string
      url?: string
      icon?: string
      description?: string
      isActive?: boolean
      order?: number
    }

    if (!(await verifySuperAdmin(adminUserId ?? null))) {
      return NextResponse.json(
        { error: 'Hanya Super Admin yang dapat mengubah link eksternal' },
        { status: 403 },
      )
    }

    if (!id || typeof id !== 'string') {
      return NextResponse.json(
        { error: 'ID link wajib diisi' },
        { status: 400 },
      )
    }

    // Build the dynamic SET clause — only update provided fields.
    const sets: string[] = []
    const args: InValue[] = []

    if (typeof label === 'string' && label.trim()) {
      sets.push('label = ?')
      args.push(bind(label.trim()))
    }
    if (typeof url === 'string') {
      if (!isValidUrl(url.trim())) {
        return NextResponse.json(
          { error: 'URL tidak valid. Gunakan format http:// atau https://' },
          { status: 400 },
        )
      }
      sets.push('url = ?')
      args.push(bind(url.trim()))
    }
    if (icon !== undefined) {
      sets.push('icon = ?')
      args.push(
        bind(
          typeof icon === 'string' && icon.trim() ? icon.trim() : null,
        ),
      )
    }
    if (description !== undefined) {
      sets.push('description = ?')
      args.push(
        bind(
          typeof description === 'string' && description.trim()
            ? description.trim()
            : null,
        ),
      )
    }
    if (typeof isActive === 'boolean') {
      sets.push('isActive = ?')
      args.push(bind(isActive ? 1 : 0))
    }
    if (typeof order === 'number') {
      sets.push('`order` = ?')
      args.push(bind(order))
    }

    const client = getLibsql()

    if (sets.length === 0) {
      // Nothing to update — return the existing row so the caller gets a
      // consistent response shape (matching the original Prisma behavior).
      const existing = await client.execute({
        sql: `SELECT id, label, url, icon, description, isActive, \`order\`
              FROM external_links WHERE id = ? LIMIT 1`,
        args: [bind(id)],
      })
      if (existing.rows.length === 0) {
        return NextResponse.json(
          { error: 'Link tidak ditemukan' },
          { status: 404 },
        )
      }
      return NextResponse.json({
        success: true,
        link: mapExternalLink(existing.rows[0] as Record<string, unknown>),
      })
    }

    sets.push('updatedAt = ?')
    args.push(bind(nowMs()))
    args.push(bind(id))

    await client.execute({
      sql: `UPDATE external_links SET ${sets.join(', ')} WHERE id = ?`,
      args,
    })

    // Re-fetch the updated row — mirrors Prisma's `update()` return shape.
    const selRes = await client.execute({
      sql: `SELECT id, label, url, icon, description, isActive, \`order\`
            FROM external_links WHERE id = ? LIMIT 1`,
      args: [bind(id)],
    })
    if (selRes.rows.length === 0) {
      return NextResponse.json(
        { error: 'Link tidak ditemukan' },
        { status: 404 },
      )
    }

    await bustExternalLinksCache()
    return NextResponse.json({
      success: true,
      link: mapExternalLink(selRes.rows[0] as Record<string, unknown>),
    })
  } catch (error) {
    console.error('Update external link error:', error)
    return NextResponse.json(
      { error: 'Gagal mengubah link eksternal' },
      { status: 500 },
    )
  }
}

// ============================================================================
// DELETE /api/external-links?id=...&adminUserId=... — Delete a link (Super Admin only)
// ============================================================================
export async function DELETE(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const id = url.searchParams.get('id')
    const adminUserId = url.searchParams.get('adminUserId')

    if (!(await verifySuperAdmin(adminUserId))) {
      return NextResponse.json(
        { error: 'Hanya Super Admin yang dapat menghapus link eksternal' },
        { status: 403 },
      )
    }

    if (!id) {
      return NextResponse.json(
        { error: 'ID link wajib diisi' },
        { status: 400 },
      )
    }

    const client = getLibsql()
    await client.execute({
      sql: `DELETE FROM external_links WHERE id = ?`,
      args: [bind(id)],
    })

    await bustExternalLinksCache()
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete external link error:', error)
    return NextResponse.json(
      { error: 'Gagal menghapus link eksternal' },
      { status: 500 },
    )
  }
}
