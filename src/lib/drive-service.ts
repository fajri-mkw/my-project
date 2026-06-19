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
