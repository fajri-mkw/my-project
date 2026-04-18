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

/**
 * Check if maintenance mode is active.
 * Call this at the beginning of API routes that should be blocked during maintenance.
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
    const settings = await db.settings.findUnique({
      where: { id: 'main' },
      select: { maintenanceMode: true, maintenanceMessage: true }
    })

    if (settings?.maintenanceMode) {
      // If not identified as Admin via header, also check X-User-Id against DB
      const headerUserId = request.headers.get('X-User-Id')
      if (headerUserId) {
        const user = await db.user.findUnique({
          where: { id: headerUserId },
          select: { role: true }
        })
        if (user?.role === 'Admin') {
          return null
        }
      }

      // Also check userId query param for GET requests
      const paramUserId = url.searchParams.get('userId')
      if (paramUserId) {
        const user = await db.user.findUnique({
          where: { id: paramUserId },
          select: { role: true }
        })
        if (user?.role === 'Admin') {
          return null
        }
      }

      return NextResponse.json(
        {
          error: 'MODE_MAINTENANCE',
          message: settings.maintenanceMessage || 'Sistem sedang dalam maintenance. Silakan coba beberapa saat lagi.'
        },
        { status: 503 }
      )
    }
  } catch (error) {
    // If DB error, don't block — allow the request to proceed
    console.error('[MAINTENANCE CHECK] Error:', error)
  }

  return null
}
