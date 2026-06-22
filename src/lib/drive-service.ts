/**
 * Google Drive service account key parser & Drive client factory.
 *
 * Robustly parses a Google Service Account JSON key that may have been
 * corrupted during paste/save (e.g. CSV-style double-quoted, literal
 * newlines inside string values, extra wrapper quotes).
 *
 * Used by all Drive-related API routes to avoid "Bad control character
 * in string literal" errors when the stored key is malformed.
 */
import { google } from 'googleapis'

/**
 * Sanitize a possibly-corrupted service account key string into valid JSON.
 *
 * Handles three common corruption patterns:
 *  1. CSV-style wrapping: the whole JSON is wrapped in "..." and internal
 *     " characters are doubled to "".
 *  2. Literal control characters (newlines, tabs) inside JSON string
 *     values — these must be converted to their \n / \t escape sequences.
 *  3. Leading/trailing whitespace or BOM.
 */
export function sanitizeServiceAccountKey(raw: string): string {
  if (!raw || typeof raw !== 'string') {
    throw new Error('Service account key is empty or not a string')
  }

  // Strip BOM and trim whitespace
  let s = raw.replace(/^\uFEFF/, '').trim()

  // Pattern 1: CSV-style wrapping — starts with " followed by { and ends with }"
  // Strip the outer " wrapper and unescape doubled "" → "
  if (s.startsWith('"{') && s.endsWith('}"')) {
    s = s.slice(1, -1) // remove outer quotes
    s = s.replace(/""/g, '"') // unescape CSV-style doubled quotes
  } else if (s.startsWith('"{') && s.endsWith('"')) {
    // Might be wrapped but end quote is just "
    s = s.slice(1, -1)
    s = s.replace(/""/g, '"')
  }

  // Pattern 2: Walk through and escape literal control characters that appear
  // INSIDE JSON string literals. Control chars between tokens (whitespace)
  // are fine and left alone.
  let out = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    const code = s.charCodeAt(i)

    if (escaped) {
      // Previous char was backslash inside string — keep this char as-is
      out += c
      escaped = false
      continue
    }
    if (inString && c === '\\') {
      out += c
      escaped = true
      continue
    }
    if (c === '"') {
      inString = !inString
      out += c
      continue
    }
    if (inString && code < 0x20) {
      // Control character inside a string literal — must be escaped
      if (code === 0x0a) out += '\\n'
      else if (code === 0x0d) out += '\\r'
      else if (code === 0x09) out += '\\t'
      else if (code === 0x08) out += '\\b'
      else if (code === 0x0c) out += '\\f'
      else out += '\\u' + code.toString(16).padStart(4, '0')
    } else {
      out += c
    }
  }

  return out
}

/**
 * Parse a service account key string into a credentials object.
 * Throws a descriptive Error if the key cannot be parsed.
 */
export function parseServiceAccountKey(raw: string): Record<string, unknown> {
  if (!raw || typeof raw !== 'string' || raw.trim() === '') {
    throw new Error('Service Account Key kosong')
  }

  // Try parsing as-is first (fast path for valid JSON)
  try {
    return JSON.parse(raw)
  } catch {
    // fall through to sanitization
  }

  // Sanitize and retry
  const sanitized = sanitizeServiceAccountKey(raw)
  try {
    return JSON.parse(sanitized)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(
      `Format Service Account Key tidak valid. Pastikan Anda menyalin JSON lengkap dari Google Cloud Console. Detail: ${msg}`
    )
  }
}

/**
 * Validate that a parsed credentials object has the minimum required fields
 * for a Google Service Account.
 */
export function validateServiceAccountCredentials(creds: Record<string, unknown>): void {
  const required = ['type', 'project_id', 'private_key', 'client_email']
  const missing = required.filter((k) => !creds[k])
  if (missing.length > 0) {
    throw new Error(
      `Service Account Key tidak lengkap. Field wajib hilang: ${missing.join(', ')}`
    )
  }
  if (creds.type !== 'service_account') {
    throw new Error(
      `Tipe kredensial salah (harus "service_account", dapat "${creds.type}")`
    )
  }
}

/**
 * Create a Google Drive client from a (possibly corrupted) service account key string.
 *
 * Usage:
 *   const drive = getDriveClient(settings.driveServiceAccountKey)
 */
export function getDriveClient(serviceAccountKey: string) {
  const credentials = parseServiceAccountKey(serviceAccountKey)
  validateServiceAccountCredentials(credentials)

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive'],
  })

  return google.drive({ version: 'v3', auth })
}

/**
 * Validate a service account key string.
 * Returns { valid: true } on success, or { valid: false, error: "..." } on failure.
 * Used by the settings API to give the user immediate feedback.
 */
export function validateServiceAccountKeyString(
  raw: string
): { valid: boolean; error?: string; clientEmail?: string; projectId?: string } {
  try {
    const creds = parseServiceAccountKey(raw)
    validateServiceAccountCredentials(creds)
    return {
      valid: true,
      clientEmail: creds.client_email as string,
      projectId: creds.project_id as string,
    }
  } catch (e) {
    return {
      valid: false,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

/**
 * Get a Google API access token using service account credentials.
 * Uses googleapis internally — auth-only operations work fine in Cloudflare Workers.
 */
export async function getAccessToken(serviceAccountKey: string): Promise<string> {
  const credentials = parseServiceAccountKey(serviceAccountKey)
  validateServiceAccountCredentials(credentials)
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive'],
  })
  const authClient = await auth.getClient()
  const token = await authClient.getAccessToken()
  if (!token || !token.token) {
    throw new Error('Failed to obtain Google API access token')
  }
  return token.token
}

// ---------------------------------------------------------------------------
// Module-level token cache (per-isolate).
//
// Google OAuth access tokens are valid for 1 hour. Re-signing a JWT with
// RSA-256 + making an OAuth HTTP request on EVERY chunk upload is extremely
// wasteful (a 143 MB file with 1 MB chunks = 144 JWT signings). This cache
// ensures each isolate only obtains a fresh token once every 50 minutes.
//
// On Cloudflare Workers, each isolate handles many requests, so this cache
// is shared across chunk uploads within the same isolate. Different isolates
// will each fetch their own token, but that's still a massive reduction.
// ---------------------------------------------------------------------------

interface CachedToken {
  token: string
  expiresAt: number // epoch millis
}

let cachedAccessToken: CachedToken | null = null
const TOKEN_CACHE_TTL_MS = 50 * 60 * 1000 // 50 minutes (Google tokens last 60 min)

/**
 * Get a cached Google API access token.
 *
 * Returns the cached token if it's still valid (with a 5-minute safety margin).
 * Otherwise, fetches a new token and caches it.
 *
 * This is critical for chunked uploads: without caching, each 1 MB chunk of a
 * large file triggers a full OAuth handshake (JWT signing + HTTP request),
 * which frequently exceeds the Cloudflare Workers CPU/wall-clock limits.
 */
export async function getCachedAccessToken(serviceAccountKey: string): Promise<string> {
  const now = Date.now()
  const safetyMargin = 5 * 60 * 1000 // refresh 5 min before expiry

  if (cachedAccessToken && cachedAccessToken.expiresAt - safetyMargin > now) {
    return cachedAccessToken.token
  }

  // Fetch a new token (this does JWT signing + OAuth HTTP request)
  const token = await getAccessToken(serviceAccountKey)
  cachedAccessToken = { token, expiresAt: now + TOKEN_CACHE_TTL_MS }
  return token
}

/**
 * Clear the cached access token. Useful when a token is rejected by Google
 * (e.g. revoked) and we need to force a refresh on the next call.
 */
export function clearCachedAccessToken(): void {
  cachedAccessToken = null
}

/**
 * Share a file or folder with "anyone who has the link".
 * Uses fetch directly to avoid googleapis stream quirks (defensive —
 * drive.permissions.create is JSON-only and usually works, but we keep
 * the option to use this helper if needed).
 */
export async function shareWithAnyone(
  accessToken: string,
  fileId: string,
  role: 'reader' | 'writer' = 'reader',
): Promise<boolean> {
  try {
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?supportsAllDrives=true`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'anyone',
          role,
          allowFileDiscovery: false,
        }),
      },
    )
    return response.ok
  } catch (err) {
    console.error('[DRIVE] shareWithAnyone failed:', err)
    return false
  }
}

/**
 * Upload a file to Google Drive using the multipart/related upload method
 * via direct fetch(). This bypasses googleapis's stream-based multipart
 * builder (gaxios) which fails in Cloudflare Workers with
 * "Missing end boundary in multipart body" — the underlying Readable
 * stream's end event does not flush the closing boundary marker in the
 * Workers runtime.
 *
 * We build the multipart/related body manually as a Uint8Array (no streams)
 * and POST it to the Google Drive API. This is robust on Cloudflare Workers.
 *
 * Retries up to 2 times on transient failures (5xx / network errors).
 */
export async function uploadFileToDrive(params: {
  serviceAccountKey: string
  fileName: string
  mimeType: string
  content: Uint8Array
  parents: string[]
  sharedDriveId?: string
}): Promise<{ id: string; name: string; webViewLink: string; size?: string }> {
  const { serviceAccountKey, fileName, mimeType, content, parents, sharedDriveId } = params

  const accessToken = await getAccessToken(serviceAccountKey)

  // Build the multipart/related body manually as a single Uint8Array.
  // Format:
  //   --{boundary}\r\n
  //   Content-Type: application/json; charset=UTF-8\r\n\r\n
  //   {metadataJson}\r\n
  //   --{boundary}\r\n
  //   Content-Type: {mimeType}\r\n\r\n
  //   {file bytes}\r\n
  //   --{boundary}--\r\n
  const boundary = 'pushakin_boundary_' + (crypto.randomUUID().replace(/-/g, ''))
  const encoder = new TextEncoder()

  const metadata: Record<string, unknown> = { name: fileName, mimeType }
  if (sharedDriveId) metadata.driveId = sharedDriveId
  metadata.parents = parents

  const metadataJson = JSON.stringify(metadata)
  const part1 = encoder.encode(
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    metadataJson + '\r\n',
  )
  const part2 = encoder.encode(
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`,
  )
  const part4 = encoder.encode(`\r\n--${boundary}--\r\n`)

  const totalLen = part1.byteLength + part2.byteLength + content.byteLength + part4.byteLength
  const body = new Uint8Array(totalLen)
  body.set(part1, 0)
  body.set(part2, part1.byteLength)
  body.set(content, part1.byteLength + part2.byteLength)
  body.set(part4, part1.byteLength + part2.byteLength + content.byteLength)

  const url =
    'https://www.googleapis.com/upload/drive/v3/files' +
    '?uploadType=multipart&supportsAllDrives=true' +
    '&fields=id,name,webViewLink,size'

  let lastError: Error | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
          'Content-Length': totalLen.toString(),
        },
        body,
      })

      if (!response.ok) {
        const errorText = await response.text()
        // 4xx errors won't fix on retry
        if (response.status >= 400 && response.status < 500) {
          throw new Error(`Google Drive API ${response.status}: ${errorText}`)
        }
        // 5xx — retry
        throw new Error(`Google Drive API ${response.status} (transient): ${errorText}`)
      }

      const fileData = await response.json()
      return {
        id: fileData.id,
        name: fileData.name,
        webViewLink: fileData.webViewLink,
        size: fileData.size,
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      const isTransient = /transient|5\d\d|Failed to fetch|NetworkError/i.test(lastError.message)
      if (!isTransient || attempt === 2) {
        throw lastError
      }
      // Exponential backoff: 600ms, 1200ms
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)))
    }
  }
  throw lastError || new Error('Upload gagal — tidak diketahui')
}
