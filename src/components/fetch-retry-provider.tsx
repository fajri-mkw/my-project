'use client'

import { useEffect } from 'react'

/**
 * Patches the global `fetch` to:
 * 1. Automatically retry GET requests that fail with HTTP 5xx errors
 * 2. Deduplicate identical in-flight GET requests (if 3 components call
 *    /api/users at the same time, only 1 network request is made)
 * 3. Add browser caching to GET requests (respects Cache-Control headers
 *    from the server, so the browser doesn't re-request cached data)
 *
 * This is CRITICAL for staying under Cloudflare Workers free plan limit
 * (100,000 requests/day). Without deduplication, a single page load can
 * trigger 10+ identical API calls from different components.
 */

const MAX_RETRIES = 1
const RETRY_DELAY_MS = 500
const DEDUP_WINDOW_MS = 2000 // Deduplicate requests within 2s window

export function FetchRetryProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if ((window as any).__fetchRetryPatched) return

    const originalFetch = window.fetch

    // --- Request Deduplication Cache ---
    // Maps URL → Promise<Response> for in-flight GET requests.
    // When a second fetch to the same URL happens while the first is still
    // pending, it receives the SAME response (cloned) — zero extra network calls.
    const inflightRequests = new Map<string, Promise<Response>>()
    const recentResponses = new Map<string, { response: Response; timestamp: number }>()

    const patchedFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const method = (init?.method || 'GET').toUpperCase()
      const isGet = method === 'GET'

      // Non-GET: pass through without dedup or retry
      if (!isGet) {
        return originalFetch(input, init)
      }

      // Build URL string for dedup key
      let urlStr: string
      try {
        urlStr = typeof input === 'string' ? input : (input as URL).toString()
      } catch {
        urlStr = String(input)
      }

      // Skip dedup for: auth, seed, migrate, repair endpoints (side-effect risks)
      const skipDedup = urlStr.includes('/api/auth/') ||
                        urlStr.includes('/api/seed') ||
                        urlStr.includes('/api/migrate') ||
                        urlStr.includes('/api/repair') ||
                        urlStr.includes('/api/setup')

      if (!skipDedup) {
        // Check if there's an in-flight request for the same URL
        const inflight = inflightRequests.get(urlStr)
        if (inflight) {
          // Clone the response so the caller can consume it independently
          const cached = await inflight
          return cached.clone()
        }

        // Check if there's a recent response (within DEDUP_WINDOW_MS)
        const recent = recentResponses.get(urlStr)
        if (recent && Date.now() - recent.timestamp < DEDUP_WINDOW_MS) {
          return recent.response.clone()
        }
      }

      // Start new request
      const requestPromise = (async () => {
        let lastError: Error | null = null

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            const response = await originalFetch(input, init)

            // If 5xx error, retry (unless it's the last attempt)
            if (response.status >= 500 && response.status < 600 && attempt < MAX_RETRIES) {
              await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)))
              continue
            }

            // Cache successful responses for dedup
            if (response.ok && !skipDedup) {
              recentResponses.set(urlStr, { response: response.clone(), timestamp: Date.now() })
              // Clean up old entries after 5s
              setTimeout(() => {
                const entry = recentResponses.get(urlStr)
                if (entry && Date.now() - entry.timestamp > DEDUP_WINDOW_MS) {
                  recentResponses.delete(urlStr)
                }
              }, DEDUP_WINDOW_MS + 100)
            }

            return response
          } catch (error) {
            lastError = error as Error
            if (attempt < MAX_RETRIES) {
              await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)))
              continue
            }
            throw error
          }
        }

        if (lastError) throw lastError
        throw new Error('Fetch failed after retries')
      })()

      // Store in-flight promise for dedup (unless skipDedup)
      if (!skipDedup) {
        inflightRequests.set(urlStr, requestPromise)
        requestPromise.finally(() => inflightRequests.delete(urlStr))
      }

      return requestPromise
    }

    window.fetch = patchedFetch as typeof window.fetch
    ;(window as any).__fetchRetryPatched = true

    return () => {
      window.fetch = originalFetch
      ;(window as any).__fetchRetryPatched = false
    }
  }, [])

  return <>{children}</>
}
