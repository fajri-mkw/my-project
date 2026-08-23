/**
 * Module-level cache for Google Drive settings.
 *
 * WHY: On Cloudflare Workers free plan (10ms CPU limit per request), every
 * millisecond counts. The settings DB query (driveServiceAccountKey +
 * driveSharedDriveId) is read on EVERY upload-url, upload-chunk, and
 * upload-complete request. By caching it at the module level for 5 minutes,
 * we eliminate the DB query (and its CPU cost) for all subsequent requests
 * on the same isolate.
 *
 * The cache is per-isolate (module-level variable). Each new isolate starts
 * with an empty cache and must fetch settings once. The `/api/drive/warmup`
 * endpoint is designed to do this first — it "primes" the isolate so that
 * the subsequent upload-url request finds settings already cached.
 *
 * Settings rarely change (only when an admin reconfigures the Drive
 * connection), so a 5-minute TTL is safe. If settings are updated, the
 * cache will refresh within 5 minutes.
 */

import { getLibsql } from '@/lib/libsql-client'

export interface DriveSettings {
  driveServiceAccountKey: string
  driveSharedDriveId: string
  driveFolderId: string
  driveMode: string  // 'shared' (default) | 'folder' — drives upload-mode selection
  driveParentFolderId?: string | null
}

interface CachedSettings {
  data: DriveSettings | null
  expiresAt: number // epoch millis
}

let cachedSettings: CachedSettings | null = null
const SETTINGS_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Get Google Drive settings from the module-level cache, or fetch from DB
 * if the cache is empty/expired.
 *
 * Returns null if settings are not configured (no service account key).
 * Throws if the DB query fails.
 */
export async function getCachedSettings(): Promise<DriveSettings | null> {
  const now = Date.now()

  // Return cached settings if still valid
  if (cachedSettings && cachedSettings.expiresAt > now) {
    return cachedSettings.data
  }

  // Cache miss or expired — fetch from DB
  const client = getLibsql()
  const result = await client.execute({
    sql: `SELECT driveServiceAccountKey, driveSharedDriveId, driveFolderId, driveMode, driveParentFolderId FROM settings WHERE id = 'main' LIMIT 1`,
    args: [],
  })

  if (result.rows.length === 0) {
    // Cache the "not configured" result too (avoids repeated DB queries
    // when Drive is not set up — e.g. during onboarding)
    cachedSettings = { data: null, expiresAt: now + SETTINGS_CACHE_TTL_MS }
    return null
  }

  const row = result.rows[0]
  const data: DriveSettings = {
    driveServiceAccountKey: (row.driveServiceAccountKey as string) || '',
    driveSharedDriveId: (row.driveSharedDriveId as string) || '',
    driveFolderId: (row.driveFolderId as string) || '',
    driveMode: (row.driveMode as string) || 'shared', // NULL → 'shared' for backward compat
    driveParentFolderId: (row.driveParentFolderId as string) || null,
  }

  cachedSettings = { data, expiresAt: now + SETTINGS_CACHE_TTL_MS }
  return data
}

/**
 * Clear the settings cache. Useful when settings are updated (e.g. admin
 * reconfigures the Drive connection) to ensure the next request fetches
 * fresh settings.
 */
export function clearSettingsCache(): void {
  cachedSettings = null
}
