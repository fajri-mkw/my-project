/**
 * Shared Google Drive warmup utility.
 *
 * WHY: On Cloudflare Workers free plan (10ms CPU limit per request), the
 * `/api/drive/upload-url` endpoint can exceed the CPU limit on a COLD
 * isolate because it does: DB query + RSA-256 JWT signing + OAuth fetch +
 * Drive API init — all in one request. When the Worker is killed by the
 * CPU limit, it returns an HTTP 500 with an EMPTY body, which the frontend
 * can't parse, resulting in the generic error:
 *   "Gagal menyiapkan upload (HTTP 500)"
 *
 * The warmup endpoint (/api/drive/warmup) does ONLY the DB query + JWT
 * signing + OAuth fetch (no Drive API call). After it succeeds, the
 * isolate has cached settings + access token, so the subsequent
 * upload-url request only needs to do the Drive API init — ~2ms CPU,
 * well within the 10ms limit.
 *
 * This module provides a shared `warmupDrive()` function that the frontend
 * calls before starting any upload. It retries up to 5 times with
 * exponential backoff, because the first warmup request may also hit a
 * cold isolate and fail.
 */

export interface WarmupResult {
  ok: boolean
  sharedDriveId?: string | null
  error?: string
}

/**
 * Warm up the Google Drive isolate by calling /api/drive/warmup.
 *
 * Retries up to `maxRetries` times with exponential backoff (1s, 2s, 3s, 4s).
 * Returns { ok: true } on success, or { ok: false, error } on persistent failure.
 *
 * @param maxRetries Number of retry attempts (default: 5)
 * @param signal Optional AbortSignal for cancellation
 */
export async function warmupDrive(
  maxRetries: number = 5,
  signal?: AbortSignal,
): Promise<WarmupResult> {
  let lastError: string | undefined

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (signal?.aborted) {
      return { ok: false, error: 'Dibatalkan' }
    }

    try {
      const response = await fetch('/api/drive/warmup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
      })

      if (response.ok) {
        const data = await response.json()
        return { ok: true, sharedDriveId: data.sharedDriveId }
      }

      // Parse error
      let errorMsg = `Warmup gagal (HTTP ${response.status})`
      try {
        const d = await response.json()
        if (d?.error) errorMsg = d.error
      } catch {
        // Empty body (Worker killed by CPU limit) — retry
      }

      // 4xx — don't retry (client error, e.g. Drive not configured)
      if (response.status >= 400 && response.status < 500) {
        return { ok: false, error: errorMsg }
      }

      lastError = errorMsg
    } catch (err) {
      if (signal?.aborted) return { ok: false, error: 'Dibatalkan' }
      lastError = err instanceof Error ? err.message : 'Network error'
    }

    // Exponential backoff: 1s, 2s, 3s, 4s
    if (attempt < maxRetries - 1) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
    }
  }

  return { ok: false, error: lastError || 'Warmup gagal setelah beberapa percobaan' }
}
