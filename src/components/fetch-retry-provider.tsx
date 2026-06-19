'use client'

import { useEffect } from 'react'

/**
 * Patches the global `fetch` to automatically retry GET requests that fail
 * with HTTP 5xx errors. This is specifically to handle Cloudflare Workers
 * free plan CPU limit (10ms) which causes intermittent 500 errors on the
 * first request to uncached endpoints.
 *
 * The retry happens after a short delay (500ms), by which time the worker
 * is typically warm enough to succeed, or the edge cache has been populated.
 *
 * Only GET requests are retried (POST/PUT/DELETE are not retried to avoid
 * duplicate side effects).
 */

const MAX_RETRIES = 2
const RETRY_DELAY_MS = 500

export function FetchRetryProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if ((window as any).__fetchRetryPatched) return

    const originalFetch = window.fetch

    const patchedFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const method = (init?.method || 'GET').toUpperCase()
      const isGet = method === 'GET'

      // Only retry GET requests
      if (!isGet) {
        return originalFetch(input, init)
      }

      let lastError: Error | null = null
      let lastResponse: Response | null = null

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const response = await originalFetch(input, init)

          // If 5xx error, retry (unless it's the last attempt)
          if (response.status >= 500 && response.status < 600 && attempt < MAX_RETRIES) {
            // Clone the response before consuming it (in case we need to return it on last attempt)
            // Actually, we can't clone a consumed response, so just retry
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)))
            continue
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

      // Should not reach here, but just in case
      if (lastError) throw lastError
      throw new Error('Fetch failed after retries')
    }

    window.fetch = patchedFetch as typeof window.fetch
    ;(window as any).__fetchRetryPatched = true

    return () => {
      // Restore original fetch on unmount (shouldn't happen in practice)
      window.fetch = originalFetch
      ;(window as any).__fetchRetryPatched = false
    }
  }, [])

  return <>{children}</>
}
