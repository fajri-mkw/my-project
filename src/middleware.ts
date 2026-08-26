import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Middleware for setting browser Cache-Control headers on responses that
 * the OpenNext Cloudflare adapter doesn't cache by default.
 *
 * WHY THIS EXISTS
 * ---------------
 * Cloudflare Workers free plan has a 100,000 requests/day cap. Without
 * browser caching, every page navigation re-fetches:
 *   - The HTML shell (Next.js default: `no-store` for App Router dynamic pages)
 *   - 10+ JS chunks (Next.js default: `max-age=0, must-revalidate`)
 *   - 2+ CSS files (same default)
 *
 * That's 12+ Worker requests per page navigation × 19 users × 20 loads/day
 * = ~4,500+ unnecessary requests/day JUST for static asset validation.
 *
 * The HTML shell is identical for all users (it's a client-rendered SPA —
 * the HTML is just `<div>Memuat Pushakin Flows...</div>` with script tags).
 * It can safely be cached for 60 seconds at the browser — users see fresh
 * HTML within 60s of any deploy, and the script chunks (hashed filenames)
 * will re-validate on their own.
 *
 * Static chunks under `/_next/static/` have hashed filenames (e.g.
 * `main-a6c1c99344de134e.js`). When the app is rebuilt, the hash changes
 * and the HTML references the NEW filename — old cached files become
 * orphaned and irrelevant. So caching them for 1 year is safe and standard
 * (this is what Vercel/Netlify do by default for Next.js apps).
 *
 * WHAT THIS MIDDLEWARE DOES
 * -------------------------
 * 1. For `/` and other HTML pages: set `Cache-Control: public, max-age=60`
 *    so browsers cache the SPA shell for 60 seconds.
 * 2. For `/_next/static/*`: set `Cache-Control: public, max-age=31536000,
 *    immutable` so browsers cache static assets for 1 year without
 *    revalidation.
 * 3. For other requests: don't touch the headers (API routes already set
 *    their own via withEdgeCache, and the OpenNext adapter handles the rest).
 *
 * This middleware runs on EVERY request — but it's CPU-cheap (just header
 * checks + set) and adds ~0.1ms to each request. The browser-cache savings
 * far outweigh this overhead.
 */
export function middleware(request: NextRequest) {
  const url = new URL(request.url)
  const pathname = url.pathname

  // Get the response (let Next.js handle the request normally)
  const response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  // === Static assets (hashed, immutable) ===
  // Cache for 1 year — file hashes change on rebuild, so old files become
  // irrelevant when the app is updated.
  if (pathname.startsWith('/_next/static/')) {
    response.headers.set('Cache-Control', 'public, max-age=31536000, immutable')
    return response
  }

  // === HTML shell (SPA root) ===
  // The HTML response from App Router is a client-rendered shell — identical
  // for all users (just `<div>Memuat Pushakin Flows...</div>` + script tags).
  // Cache for 60s so browsers don't re-fetch on every navigation.
  //
  // Skip API routes (they set their own cache-control via withEdgeCache or
  // have their own custom headers).
  // Skip non-GET requests (POST/PUT/DELETE are not cacheable).
  // Skip file extensions (e.g. /logo.svg, /favicon.ico — handled separately).
  if (
    request.method === 'GET' &&
    !pathname.startsWith('/api/') &&
    !pathname.match(/\.[a-zA-Z0-9]+$/) && // no file extension
    !response.headers.has('Cache-Control')
  ) {
    response.headers.set('Cache-Control', 'public, max-age=60')
  }

  return response
}

/**
 * Matcher: run middleware on all paths EXCEPT /api/* (handled by route
 * handlers themselves), /_next/static/* (handled above — but we DO want
 * to run on static to set the long cache header, so we exclude only
 * /api/* and specific asset paths that should NOT be cached).
 */
export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - /api/* (route handlers set their own cache-control)
     * - /_next/static/media/* (fonts/images — OpenNext handles, but matcher
     *   excludes from middleware to keep it cheap; we catch them above)
     */
    '/((?!api).*)',
  ],
}
