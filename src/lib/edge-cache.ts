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
  // For per-user endpoints, include relevant query params
  const params = url.searchParams
  const userId = params.get('userId')
  const role = params.get('role')
  const query = userId ? `?userId=${userId}` : ''
  const roleQuery = role ? `${query ? '&' : '?'}role=${role}` : ''
  return `https://edge-cache.pushakin-flows.workers.dev${prefix}${query}${roleQuery}`
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
        // Return cached response with a header indicating cache hit
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
        const headers = new Headers(response.headers)
        headers.set('Cache-Control', `public, max-age=${ttl}`)
        headers.set('x-edge-cache', 'MISS')
        const cachedResponse = new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        })
        // Use waitUntil to not block the response
        // @ts-ignore - ctx is available in Workers
        if (typeof ctx !== 'undefined' && ctx.waitUntil) {
          // @ts-ignore
          ctx.waitUntil(cache.put(cacheKey, cachedResponse.clone()))
        } else {
          await cache.put(cacheKey, cachedResponse.clone())
        }
      } catch {}
    }

    return response
  }
}

/**
 * Invalidate cache for a specific prefix.
 * Call this after POST/PUT/DELETE to bust stale cache.
 */
export async function invalidateCache(prefix: string): Promise<void> {
  const cache = getCache()
  if (!cache) return
  try {
    // Cache API doesn't support wildcard deletion, but we can delete specific keys
    // For simplicity, we just delete the main endpoint cache
    const key = `https://edge-cache.pushakin-flows.workers.dev${prefix}`
    await cache.delete(key)
  } catch {}
}
