/**
 * Edge caching helper for Cloudflare Workers.
 *
 * Uses the Cache API (caches.default) to cache GET responses at the edge.
 * This dramatically reduces CPU usage for repeated requests, helping stay
 * within the Workers free plan 10ms CPU limit.
 *
 * Usage in API route:
 *   import { withEdgeCache } from '@/lib/edge-cache'
 *   export const GET = withEdgeCache(async (request) => { ... }, { ttl: 60 })
 */

// OpenNext Cloudflare adapter — exposes getCloudflareContext() which returns
// the Workers execution context (with ctx.waitUntil) for the current request.
// The module is safe to import at top level (no side effects); the function
// only throws when CALLED outside a request context, which we guard against.
import { getCloudflareContext } from '@opennextjs/cloudflare'

interface CacheOptions {
  /** Cache duration in seconds (default: 60) */
  ttl?: number
  /** Cache key prefix (default: auto from URL pathname) */
  keyPrefix?: string
  /** Include query params in cache key (default: true) */
  includeQuery?: boolean
  /** Skip cache when this function returns true */
  shouldBypass?: (request: Request) => boolean
}

// Type-safe access to Cloudflare Cache API
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

function buildCacheKey(request: Request, opts: CacheOptions): string {
  const url = new URL(request.url)
  const prefix = opts.keyPrefix || url.pathname
  if (opts.includeQuery === false) {
    return `https://edge-cache.pushakin-flows.workers.dev${prefix}`
  }
  // ===========================================================================
  // CRITICAL FIX: Include the FULL query string in the cache key.
  //
  // The previous implementation only extracted `userId` and `role` params,
  // but many endpoints use different param names (e.g. `userRole` instead of
  // `role`) and additional filtering params (e.g. `jenisSurat`, `status`).
  // This caused TWO severe bugs:
  //
  //   1. Cross-query cache collision: GET /api/surat?...&jenisSurat=Surat+Masuk
  //      and GET /api/surat?...&jenisSurat=Surat+Keluar shared the SAME cache
  //      key (only userId was included), so Surat Masuk and Surat Keluar lists
  //      contaminated each other.
  //
  //   2. `role` param was always null (endpoints use `userRole`), so the role
  //      portion of the key was silently dropped.
  //
  // Using the full sorted query string guarantees every distinct query gets
  // its own cache entry. Params are sorted for deterministic keys regardless
  // of insertion order.
  // ===========================================================================
  const params = url.searchParams
  const sortedEntries = Array.from(params.entries())
    .filter(([, v]) => v != null && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
  const queryString = sortedEntries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
  const query = queryString ? `?${queryString}` : ''
  return `https://edge-cache.pushakin-flows.workers.dev${prefix}${query}`
}

export function withEdgeCache<T extends Request>(
  handler: (request: T) => Promise<Response>,
  opts: CacheOptions = {}
): (request: T) => Promise<Response> {
  const ttl = opts.ttl ?? 60

  return async (request: T) => {
    // Only cache GET requests
    if (request.method !== 'GET') {
      return handler(request)
    }

    // Allow bypass (e.g., for admin preview)
    if (opts.shouldBypass?.(request)) {
      return handler(request)
    }

    const cache = getCache()
    if (!cache) {
      // Not on Workers (local dev) — just run handler
      return handler(request)
    }

    const cacheKey = buildCacheKey(request, opts)

    // Try cache first
    try {
      const cached = await cache.match(cacheKey)
      if (cached) {
        // Return cached response with a header indicating cache hit.
        // The cached entry already has Cache-Control (set during the MISS
        // path below), so the browser will ALSO cache it — meaning repeat
        // requests within the TTL won't even hit the Worker (0 Worker
        // requests for browser-cached responses). This is the key
        // optimization that reduces request COUNT, not just CPU usage.
        const headers = new Headers(cached.headers)
        headers.set('x-edge-cache', 'HIT')
        return new Response(cached.body, {
          status: cached.status,
          statusText: cached.statusText,
          headers,
        })
      }
    } catch {}

    // Cache miss — run handler
    const response = await handler(request)

    // Only cache successful responses
    if (response.status === 200) {
      try {
        // IMPORTANT: clone the response BEFORE touching its body.
        // `new Response(response.body, ...)` would transfer the body stream
        // away from `response`, causing "failed to pipe response" when we
        // `return response` below. Cloning first tees the stream so both the
        // original (returned to client) and the clone (stored in cache) can be
        // read independently.
        const responseClone = response.clone()
        const cacheHeaders = new Headers(responseClone.headers)
        // Set Cache-Control on the cached entry — but ONLY if the handler
        // didn't explicitly set one. This respects handlers that use
        // 'no-store' to opt out of browser caching (e.g., /api/projects
        // sets no-store to prevent stale data after writes). On HIT, the
        // cached entry's Cache-Control is returned to the browser — so if
        // the handler set no-store, HIT responses also have no-store,
        // keeping browser behavior consistent across MISS and HIT paths.
        if (!cacheHeaders.has('Cache-Control')) {
          cacheHeaders.set('Cache-Control', `public, max-age=${ttl}`)
        }
        cacheHeaders.set('x-edge-cache', 'MISS')
        const cachedResponse = new Response(responseClone.body, {
          status: responseClone.status,
          statusText: responseClone.statusText,
          headers: cacheHeaders,
        })
        // Use waitUntil to not block the response. Same pattern as
        // deferToBackground: getCloudflareContext() on OpenNext provides ctx.
        let cachePutDeferred = false
        try {
          const cfCtx = getCloudflareContext() as
            | { ctx?: { waitUntil?: (p: Promise<unknown>) => void } }
            | undefined
          if (cfCtx?.ctx?.waitUntil) {
            cfCtx.ctx.waitUntil(cache.put(cacheKey, cachedResponse))
            cachePutDeferred = true
          }
        } catch {
          // No active CF context (local dev) — fall through to await
        }
        if (!cachePutDeferred) {
          await cache.put(cacheKey, cachedResponse)
        }
      } catch {}

      // =========================================================================
      // CRITICAL: Also set Cache-Control on the response RETURNED to the client.
      //
      // The edge Cache API (caches.default) reduces CPU usage (skips handler
      // on HIT) but does NOT reduce request COUNT — every HTTP request to the
      // Worker still counts against the free plan's 100K/day cap.
      //
      // Setting `Cache-Control: public, max-age=<ttl>` on the response tells
      // the BROWSER to cache it locally. Repeat requests within the TTL are
      // served from the browser cache WITHOUT hitting the Worker at all
      // (0 Worker requests). This is the key optimization that reduces
      // request COUNT.
      //
      // Example: /api/maintenance with ttl=120s. User refreshes dashboard 30
      // times over 8 hours. Without browser cache: 30 Worker requests. With
      // browser cache: ~4 Worker requests (one every 120s), rest served from
      // browser cache. ~7.5x request-count reduction PER CACHED ENDPOINT.
      //
      // OPT-OUT: if the handler explicitly sets `Cache-Control: no-store` on
      // its response (e.g., /api/projects does this to prevent stale data
      // after a manager creates/updates a project), we RESPECT that and do
      // NOT override it. The handler is opting out of browser caching for
      // data-consistency reasons.
      // =========================================================================
      try {
        const browserHeaders = new Headers(response.headers)
        // Only set browser Cache-Control if the handler didn't explicitly
        // set one. This respects handlers that use 'no-store' to opt out.
        if (!browserHeaders.has('Cache-Control')) {
          browserHeaders.set('Cache-Control', `public, max-age=${ttl}`)
        }
        browserHeaders.set('x-edge-cache', 'MISS')
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: browserHeaders,
        })
      } catch {
        // If header modification fails (e.g., immutable headers in some
        // runtime edge cases), return the original response unmodified.
        return response
      }
    }

    return response
  }
}

/**
 * Invalidate cache for a specific prefix.
 * Call this after POST/PUT/DELETE to bust stale cache.
 *
 * IMPORTANT LIMITATION: The Cloudflare Cache API only supports deleting keys by
 * their EXACT value — there is no wildcard/prefix deletion. Since `buildCacheKey`
 * now includes the full query string, a single endpoint can have MANY cached
 * keys (one per distinct query). `invalidateCache(prefix)` only deletes the
 * no-query key, which may not match any actual cached entry.
 *
 * For endpoints where stale data after a write is unacceptable (e.g. `/api/surat`
 * where a just-created record MUST appear in the next list fetch), the correct
 * solution is to NOT use `withEdgeCache` on that GET endpoint at all — see
 * `/api/surat/route.ts` for the reference implementation.
 *
 * This function is kept as a best-effort helper for endpoints that cache
 * query-less responses (e.g. `/api/settings`, `/api/maintenance`).
 */
export async function invalidateCache(prefix: string): Promise<void> {
  const cache = getCache()
  if (!cache) return
  try {
    const key = `https://edge-cache.pushakin-flows.workers.dev${prefix}`
    await cache.delete(key)
  } catch {}
}

/**
 * Defer non-critical background work to run AFTER the response is sent.
 *
 * On Cloudflare Workers, `ctx.waitUntil(promise)` keeps the Worker alive
 * after the response is returned so the promise can complete. This is
 * perfect for fire-and-forget side-effects like:
 *   - Sending WA/Email notifications (each call can take 1-3s)
 *   - Creating notification DB rows for OTHER users (not the requester)
 *   - Creating surat_tugas rows for next-stage workers
 *
 * On local dev (no Cloudflare context), the work runs inline — preserving
 * correctness at the cost of latency.
 *
 * IMPLEMENTATION NOTE:
 *   The OpenNext Cloudflare adapter does NOT expose `ctx` as a global.
 *   Instead, the Cloudflare execution context (with `waitUntil`) is stored
 *   in an AsyncLocalStorage and must be retrieved via `getCloudflareContext()`
 *   from `@opennextjs/cloudflare`. The previous implementation checked
 *   `typeof ctx !== 'undefined'` which was ALWAYS false on Workers — meaning
 *   all "deferred" work actually ran inline in the main request path, causing
 *   "Worker threw exception" 500 errors when task completion triggered many
 *   background DB writes + WA/Email sends.
 *
 * IMPORTANT: Only defer work whose FAILURE does not affect the response.
 * The caller has already wrapped such work in try/catch (so a thrown error
 * won't crash the Worker). Deferring just moves it off the response path.
 */
export function deferToBackground(promise: Promise<void>): void {
  // Attach a safety-net rejection handler FIRST so the promise can never
  // become an unhandled rejection (which would crash the Worker on CF).
  promise.catch(() => {})

  // Try to register the promise with the Cloudflare execution context so it
  // runs AFTER the response is sent (via ctx.waitUntil). This is the
  // production path on Cloudflare Workers with OpenNext.
  try {
    const cfCtx = getCloudflareContext() as
      | { ctx?: { waitUntil?: (p: Promise<unknown>) => void } }
      | undefined
    if (cfCtx?.ctx?.waitUntil) {
      cfCtx.ctx.waitUntil(promise)
      return
    }
  } catch {
    // getCloudflareContext() throws when there's no active request context
    // (e.g., local dev, cold-start module init, or non-Workers runtime).
    // Fall through to inline fire-and-forget.
  }

  // No Cloudflare context (local dev / non-Workers / no active request) —
  // the promise is already running fire-and-forget (started by the IIFE in
  // the caller). The safety-net .catch() above ensures no unhandled rejection.
  // In local dev this means the work runs inline, which is fine for dev.
}
