import { db } from '@/lib/db'
import { NextResponse } from 'next/server'

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
 * Check if maintenance mode is active.
 * Uses in-memory caching to avoid hitting the database on every API request.
 * Returns null if access is allowed, or a NextResponse blocking the request if maintenance is on.
 * 
 * Admin users are always allowed through (identified via X-User-Role header or X-User-Id header).
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
      const settings = await db.settings.findUnique({
        where: { id: 'main' },
        select: { maintenanceMode: true, maintenanceMessage: true }
      })
      cachedMaintenanceMode = settings?.maintenanceMode ?? false
      cachedMaintenanceMessage = settings?.maintenanceMessage ?? null
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
        const user = await db.user.findUnique({
          where: { id: headerUserId },
          select: { role: true }
        })
        adminUserCache.set(headerUserId, { role: user?.role ?? '', expires: now + ADMIN_CACHE_TTL })
        if (user?.role === 'Admin') return null
      }
    }

    // Also check userId query param for GET requests
    const paramUserId = url.searchParams.get('userId')
    if (paramUserId && paramUserId !== headerUserId) {
      const cachedAdmin = adminUserCache.get(paramUserId)
      if (cachedAdmin && now < cachedAdmin.expires) {
        if (cachedAdmin.role === 'Admin') return null
      } else {
        const user = await db.user.findUnique({
          where: { id: paramUserId },
          select: { role: true }
        })
        adminUserCache.set(paramUserId, { role: user?.role ?? '', expires: now + ADMIN_CACHE_TTL })
        if (user?.role === 'Admin') return null
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
