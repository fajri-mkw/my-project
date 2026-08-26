import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Middleware for setting browser Cache-Control headers on responses.
 *
 * WHY THIS EXISTS
 * ---------------
 * Cloudflare Workers free plan has a 100,000 requests/day cap. Without
 * browser caching, every page navigation re-fetches the HTML shell.
 *
 * The HTML shell is a client-rendered SPA — identical for all users (just
 * `<div>Memuat Pushakin Flows...</div>` with script tags). It can safely be
 * cached for 60 seconds at the browser — users see fresh HTML within 60s
 * of any deploy, and the script chunks (hashed filenames) will re-validate
 * on their own.
 *
 * Static assets under /_next/static/* have hashed filenames and are served
 * by Cloudflare's ASSETS binding (NOT the Worker — 0 Worker requests).
 * They get max-age=0 by default which is fine (304 responses don't count
 * against the Worker request limit).
 *
 * WHAT THIS MIDDLEWARE DOES
 * -------------------------
 * For HTML pages (non-API, non-asset, GET): rewrite the response with
 * `Cache-Control: public, max-age=60` so browsers cache the SPA shell for
 * 60 seconds.
 *
 * We use NextResponse.next() then set headers on the resulting response
 * object — NextResponse.next() returns a Response that Next.js uses to
 * continue processing the request, and headers set on it are preserved in
 * the final response.
 */
export function middleware(request: NextRequest) {
  const url = new URL(request.url)
  const pathname = url.pathname

  // Skip non-GET requests (POST/PUT/DELETE are not cacheable).
  // Skip API routes (they set their own cache-control via withEdgeCache).
  // Skip file extensions (e.g. /logo.svg, /favicon.ico — handled by ASSETS binding).
  // Skip _next paths except _next/data (those are asset routes, not HTML).
  const isHtmlPath =
    request.method === 'GET' &&
    !pathname.startsWith('/api/') &&
    !pathname.startsWith('/_next/static/') &&
    !pathname.match(/\.[a-zA-Z0-9]+$/)

  if (!isHtmlPath) {
    return NextResponse.next()
  }

  // For HTML paths, get the response from Next.js and override Cache-Control.
  // We use NextResponse.next() which preserves the request context so Next.js
  // continues processing, but allows us to add headers to the final response.
  const response = NextResponse.next()
  // Override the cache-control — Next.js defaults to no-store for dynamic
  // pages, but our SPA shell is identical for all users so 60s is safe.
  response.headers.set('Cache-Control', 'public, max-age=60')
  // Tag the response so we can verify middleware ran (debug aid)
  response.headers.set('x-middleware-cache', '1')
  return response
}

/**
 * Matcher: run middleware on all paths EXCEPT /api/* (route handlers set
 * their own cache-control) and /_next/static/* (asset routes — bypass Worker).
 */
export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - /api/* (route handlers set their own cache-control)
     * - /_next/static/* (asset routes — bypass Worker, served by ASSETS binding)
     * - /_next/image* (image optimization, also bypasses Worker)
     */
    '/((?!api|_next/static|_next/image).*)',
  ],
}

