import { NextResponse } from 'next/server'
import { getLibsql, toBool, bind } from '@/lib/libsql-client'

// ============================================================================
// CRITICAL: This module is imported by ~19 API routes. It MUST NOT import
// `db` from '@/lib/db' (which loads Prisma + adapter at module-load time).
//
// HISTORY: The previous version imported `db` and used Prisma for two queries
// (settings.findUnique + user.findUnique). On Cloudflare Workers, loading
// Prisma at module-load time is CPU-intensive and was a leading cause of
// "Worker threw exception" 500 errors on cold starts — especially on routes
// like /api/tasks and /api/projects that are hit frequently.
//
// FIX: Rewritten to use @libsql/client directly (via getLibsql()). This
// eliminates Prisma from the module-load path of every route that imports
// checkMaintenanceMode. The behavior is identical: same caching, same
// fail-open policy, same admin bypass logic.
// ============================================================================

// Routes that are always allowed even during maintenance
const ALLOWED_ROUTES = [
  '/api/maintenance',
  '/api/auth/login',
  '/api/auth/change-password',
  '/api/health',
  '/api/public-tracker',
  '/api/share',
  '/api/seed',
  '/api/debug',
]

// In-memory cache for maintenance mode status
// Prevents 1-3 DB queries on every single API request
let cachedMaintenanceMode: boolean | null = null
let cachedMaintenanceMessage: string | null = null
let lastMaintenanceCheck = 0
const MAINTENANCE_CACHE_TTL = 5000 // 5 seconds cache

// In-memory cache for admin user IDs
// Prevents DB lookup for admin users on every request
const adminUserCache = new Map<string, { role: string; expires: number }>()
const ADMIN_CACHE_TTL = 30000 // 30 seconds cache

/**
 * Fetch a user's role from the DB via libsql (NO Prisma).
 * Returns '' if the user is not found or on error.
 */
async function fetchUserRole(userId: string): Promise<string> {
  try {
    const client = getLibsql()
    const res = await client.execute({
      sql: `SELECT role FROM users WHERE id = ? LIMIT 1`,
      args: [bind(userId)],
    })
    if (res.rows.length === 0) return ''
    return String((res.rows[0] as Record<string, unknown>).role ?? '')
  } catch {
    // Fail-open: if we can't check, treat as non-admin
    return ''
  }
}

/**
 * Check if maintenance mode is active.
 * Uses in-memory caching to avoid hitting the database on every API request.
 * Returns null if access is allowed, or a NextResponse blocking the request if maintenance is on.
 *
 * Admin users are always allowed through (identified via X-User-Role header or X-User-Id header).
 *
 * IMPLEMENTATION: Uses libsql directly (not Prisma) to avoid loading the Prisma
 * engine on every route that imports this module. This is critical for staying
 * within Cloudflare Workers' CPU limit on cold starts.
 */
export async function checkMaintenanceMode(request: Request): Promise<NextResponse | null> {
  const url = new URL(request.url)
  const pathname = url.pathname

  // Always allow whitelisted routes
  if (ALLOWED_ROUTES.some(route => pathname.startsWith(route))) {
    return null
  }

  // Quick check: if X-User-Role header is 'Admin', allow immediately (no DB lookup needed)
  const userRole = request.headers.get('X-User-Role')
  if (userRole === 'Admin') {
    return null
  }

  try {
    const now = Date.now()

    // Check cached maintenance status first
    if (cachedMaintenanceMode === null || (now - lastMaintenanceCheck) > MAINTENANCE_CACHE_TTL) {
      // libsql direct query (NO Prisma) — keeps the module-load path Prisma-free
      const client = getLibsql()
      const res = await client.execute({
        sql: `SELECT maintenanceMode, maintenanceMessage FROM settings WHERE id = 'main' LIMIT 1`,
        args: [],
      })
      if (res.rows.length > 0) {
        const row = res.rows[0] as Record<string, unknown>
        cachedMaintenanceMode = toBool(row.maintenanceMode)
        cachedMaintenanceMessage = (row.maintenanceMessage as string | null) ?? null
      } else {
        cachedMaintenanceMode = false
        cachedMaintenanceMessage = null
      }
      lastMaintenanceCheck = now
    }

    // If not in maintenance mode, allow immediately
    if (!cachedMaintenanceMode) {
      return null
    }

    // In maintenance mode — check if user is admin
    const headerUserId = request.headers.get('X-User-Id')
    if (headerUserId) {
      const cachedAdmin = adminUserCache.get(headerUserId)
      if (cachedAdmin && now < cachedAdmin.expires) {
        if (cachedAdmin.role === 'Admin') return null
      } else {
        const role = await fetchUserRole(headerUserId)
        adminUserCache.set(headerUserId, { role, expires: now + ADMIN_CACHE_TTL })
        if (role === 'Admin') return null
      }
    }

    // Also check userId query param for GET requests
    const paramUserId = url.searchParams.get('userId')
    if (paramUserId && paramUserId !== headerUserId) {
      const cachedAdmin = adminUserCache.get(paramUserId)
      if (cachedAdmin && now < cachedAdmin.expires) {
        if (cachedAdmin.role === 'Admin') return null
      } else {
        const role = await fetchUserRole(paramUserId)
        adminUserCache.set(paramUserId, { role, expires: now + ADMIN_CACHE_TTL })
        if (role === 'Admin') return null
      }
    }

    return NextResponse.json(
      {
        error: 'MODE_MAINTENANCE',
        message: cachedMaintenanceMessage || 'Sistem sedang dalam maintenance. Silakan coba beberapa saat lagi.'
      },
      { status: 503 }
    )
  } catch (error) {
    // If DB error, don't block — allow the request to proceed
    console.error('[MAINTENANCE CHECK] Error:', error)
    // Reset cache on error so next request retries
    cachedMaintenanceMode = null
  }

  return null
}

/**
 * Invalidate the maintenance mode cache.
 * Call this when maintenance settings are updated.
 */
export function invalidateMaintenanceCache() {
  cachedMaintenanceMode = null
  cachedMaintenanceMessage = null
  lastMaintenanceCheck = 0
}
