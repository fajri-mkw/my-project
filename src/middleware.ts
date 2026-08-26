import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Middleware for setting browser Cache-Control headers on HTML responses.
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
 * For HTML pages (non-API, non-asset, GET): rewrite the response using
 * NextResponse.rewrite() to the same URL (no actual rewriting), then set
 * `Cache-Control: public, max-age=60` on the rewrite response. This forces
 * the response to go through our header setting, which is preserved in the
 * final response.
 *
 * Alternative approach: use NextResponse.next() + headers.set — but Next.js
 * may override the Cache-Control header in some OpenNext configurations.
 * Using rewrite() to the same URL is a more reliable way to ensure our
 * headers are preserved.
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

  // For HTML paths, rewrite to the same URL (no actual rewriting, just to
  // get a response object where we can set headers that won't be overridden).
  // We use NextResponse.rewrite() with the SAME URL as the request — this
  // creates a rewrite response that Next.js processes as if the user
  // requested the same page, but our headers are set on the response.
  const response = NextResponse.rewrite(url.toString())
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


