/**
 * Shared lightweight Google Drive helpers — bypass googleapis + Prisma.
 *
 * WHY: This module exists because the previous Drive integration kept
 * breaking on Cloudflare Workers (it has happened THREE times). The root
 * cause each time was the same: routes that import `googleapis` (heavy CJS
 * module that makes 40+ internal subrequests on Workers) AND call
 * `ensureDbConnection()` (which runs 40+ migration subrequests on cold
 * starts) BLOW PAST the Cloudflare Workers free-plan limit of 50
 * subrequests per request, returning HTTP 500.
 *
 * Task ID 10 fixed this for `/api/drive/route.ts` only. The fix was NOT
 * applied to the other 5 routes that also touch Google Drive:
 *   - /api/surat/prepare-upload
 *   - /api/surat/upload-document
 *   - /api/projects/upload-document
 *   - /api/program-kegiatan/prepare-upload
 *   - /api/program-kegiatan/upload-document
 *
 * This module extracts the proven Task ID 10 pattern (libsql + native
 * fetch) into a single shared library so ALL Drive-touching routes use
 * the same lightweight code path. Total subrequests per request: ~3-6
 * (well under the 50 limit).
 */

import { getLibsql, bind } from '@/lib/libsql-client'
import {
  getCachedAccessToken,
  listFoldersByName,
  getFileParents,
  createDriveFolder,
  shareWithAnyone,
} from '@/lib/drive-service'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DriveSettings {
  driveServiceAccountKey: string | null
  driveSharedDriveId: string | null
  driveParentFolderId: string | null
  driveAutoCreate: boolean
}

export interface DriveFolderInfo {
  id: string
  webViewLink: string
}

// Indonesian month names with numeric prefix (matches existing folder naming)
const BULAN_INDONESIA = [
  '01 Januari', '02 Februari', '03 Maret', '04 April',
  '05 Mei', '06 Juni', '07 Juli', '08 Agustus',
  '09 September', '10 Oktober', '11 November', '12 Desember'
]

// ---------------------------------------------------------------------------
// Drive settings — read via libsql (1 subrequest, NO Prisma, NO schema sync)
// ---------------------------------------------------------------------------

/**
 * Read Drive settings directly from the `settings` table via libsql.
 *
 * Returns null if settings are missing or the query fails. This intentionally
 * does NOT throw — callers can return a friendly "Drive belum dikonfigurasi"
 * message to the user.
 *
 * Replaces: `await ensureDbConnection(); const settings = await db.settings.findUnique(...)`
 *           (which was 40+ subrequests on cold starts).
 */
export async function readDriveSettings(): Promise<DriveSettings | null> {
  try {
    const client = getLibsql()
    const res = await client.execute({
      sql: `SELECT driveServiceAccountKey, driveSharedDriveId, driveParentFolderId, driveAutoCreate FROM settings WHERE id = 'main' LIMIT 1`,
      args: [],
    })
    if (res.rows.length === 0) return null
    const row = res.rows[0] as Record<string, unknown>
    return {
      driveServiceAccountKey: (row.driveServiceAccountKey as string | null) ?? null,
      driveSharedDriveId: (row.driveSharedDriveId as string | null) ?? null,
      driveParentFolderId: (row.driveParentFolderId as string | null) ?? null,
      driveAutoCreate: Boolean(Number(row.driveAutoCreate ?? 0)),
    }
  } catch (error) {
    console.error('[DRIVE HELPERS] readDriveSettings error:', error)
    return null
  }
}

// ---------------------------------------------------------------------------
// Year > Month > Category folder hierarchy
// ---------------------------------------------------------------------------

/**
 * Find or create the Year > Month > {category} folder hierarchy inside the
 * Shared Drive, using NATIVE fetch (NO googleapis).
 *
 * Returns the {category} folder ID where the entity (surat/kegiatan/project)
 * folder should be placed.
 *
 * Subrequest budget per call:
 *   - getAccessToken: 1 (cached for 50 min afterwards)
 *   - listFoldersByName × 3 (year/month/category): 3 subrequests
 *   - getFileParents × 3 (one per folder lookup, to verify parent): 3 subrequests
 *   - createDriveFolder × 3 (only if folders don't exist): 3 subrequests
 *   TOTAL WORST CASE: ~10 subrequests (vs 20+ with googleapis).
 *   TOTAL BEST CASE (warm cache + folders exist): 4 subrequests.
 *
 * @param settings Drive settings (must have driveServiceAccountKey + driveSharedDriveId)
 * @param category Folder name inside Month (e.g. "SURAT", "KEGIATAN", "PROJECT")
 * @param date Date used to determine Year + Month folder names
 */
export async function findOrCreateYearMonthCategoryFolder(
  settings: DriveSettings,
  category: string,
  date: Date,
): Promise<string> {
  const sharedDriveId = settings.driveSharedDriveId!
  const rootParentId = settings.driveParentFolderId || sharedDriveId
  const accessToken = await getCachedAccessToken(settings.driveServiceAccountKey!)

  const year = date.getFullYear().toString()
  const monthName = BULAN_INDONESIA[date.getMonth()]

  // --- Year folder ---
  let yearFolderId: string | null = null
  const yearFolders = await listFoldersByName(accessToken, sharedDriveId, year)
  for (const f of yearFolders) {
    if (!f.id) continue
    const parentList = await getFileParents(accessToken, f.id)
    if (parentList.includes(rootParentId) || parentList.includes(sharedDriveId)) {
      yearFolderId = f.id
      break
    }
  }
  if (!yearFolderId) {
    const created = await createDriveFolder(accessToken, {
      name: year,
      parentId: rootParentId,
      sharedDriveId,
    })
    yearFolderId = created.id
    console.log(`[DRIVE HELPERS] Created Year folder: ${year} (${yearFolderId})`)
  }

  // --- Month folder (inside Year) ---
  let monthFolderId: string | null = null
  const monthFolders = await listFoldersByName(accessToken, sharedDriveId, monthName)
  for (const f of monthFolders) {
    if (!f.id) continue
    const parentList = await getFileParents(accessToken, f.id)
    if (parentList.includes(yearFolderId)) {
      monthFolderId = f.id
      break
    }
  }
  if (!monthFolderId) {
    const created = await createDriveFolder(accessToken, {
      name: monthName,
      parentId: yearFolderId,
      sharedDriveId,
    })
    monthFolderId = created.id
    console.log(`[DRIVE HELPERS] Created Month folder: ${monthName} (${monthFolderId})`)
  }

  // --- Category folder (inside Month) ---
  let categoryFolderId: string | null = null
  const categoryFolders = await listFoldersByName(accessToken, sharedDriveId, category)
  for (const f of categoryFolders) {
    if (!f.id) continue
    const parentList = await getFileParents(accessToken, f.id)
    if (parentList.includes(monthFolderId)) {
      categoryFolderId = f.id
      break
    }
  }
  if (!categoryFolderId) {
    const created = await createDriveFolder(accessToken, {
      name: category,
      parentId: monthFolderId,
      sharedDriveId,
    })
    categoryFolderId = created.id
    console.log(`[DRIVE HELPERS] Created ${category} folder in ${monthName} ${year} (${categoryFolderId})`)
  }

  return categoryFolderId
}

/**
 * Create a folder for an entity (surat/kegiatan/project) inside the given
 * parent folder, share it with anyone-who-has-link, and return its info.
 *
 * Uses native fetch only (NO googleapis).
 */
export async function createEntityFolder(
  settings: DriveSettings,
  folderName: string,
  parentFolderId: string,
): Promise<DriveFolderInfo> {
  const accessToken = await getCachedAccessToken(settings.driveServiceAccountKey!)
  const sharedDriveId = settings.driveSharedDriveId!

  const folder = await createDriveFolder(accessToken, {
    name: folderName,
    parentId: parentFolderId,
    sharedDriveId,
  })

  // Share folder with anyone who has the link (reader) — best-effort
  try {
    await shareWithAnyone(accessToken, folder.id, 'reader')
  } catch (shareErr) {
    console.error(`[DRIVE HELPERS] Failed to share folder "${folderName}":`, shareErr)
  }

  return {
    id: folder.id,
    webViewLink: folder.webViewLink,
  }
}

// ---------------------------------------------------------------------------
// Direct libsql helpers — read/write entity records without Prisma
// ---------------------------------------------------------------------------

/**
 * Read the minimal fields needed by upload routes from a `surat` row.
 * Uses libsql directly (1 subrequest, NO Prisma, NO schema sync).
 */
export async function readSuratForUpload(suratId: string): Promise<{
  id: string
  nomorSurat: string
  perihal: string
  tanggalSurat: string | null
  documents: string
  driveFolderId: string | null
  driveFolderLink: string | null
} | null> {
  try {
    const client = getLibsql()
    const res = await client.execute({
      sql: `SELECT id, nomorSurat, perihal, tanggalSurat, documents, driveFolderId, driveFolderLink FROM surat WHERE id = ? LIMIT 1`,
      args: [bind(suratId)],
    })
    if (res.rows.length === 0) return null
    const row = res.rows[0] as Record<string, unknown>
    return {
      id: String(row.id),
      nomorSurat: String(row.nomorSurat),
      perihal: String(row.perihal),
      tanggalSurat: (row.tanggalSurat as string | null) ?? null,
      documents: (row.documents as string) ?? '[]',
      driveFolderId: (row.driveFolderId as string | null) ?? null,
      driveFolderLink: (row.driveFolderLink as string | null) ?? null,
    }
  } catch (error) {
    console.error('[DRIVE HELPERS] readSuratForUpload error:', error)
    return null
  }
}

/**
 * Read the minimal fields needed by upload routes from a `program_kegiatan` row.
 */
export async function readKegiatanForUpload(kegiatanId: string): Promise<{
  id: string
  nomorKegiatan: string
  perihal: string
  tanggalKegiatan: string | null
  documents: string
  driveFolderId: string | null
  driveFolderLink: string | null
} | null> {
  try {
    const client = getLibsql()
    // Note: Prisma maps ProgramKegiatan.perihal to the `namaKegiatan` column.
    const res = await client.execute({
      sql: `SELECT id, nomorKegiatan, namaKegiatan, tanggalKegiatan, documents, driveFolderId, driveFolderLink FROM program_kegiatan WHERE id = ? LIMIT 1`,
      args: [bind(kegiatanId)],
    })
    if (res.rows.length === 0) return null
    const row = res.rows[0] as Record<string, unknown>
    return {
      id: String(row.id),
      nomorKegiatan: String(row.nomorKegiatan),
      perihal: String(row.namaKegiatan ?? ''),
      tanggalKegiatan: (row.tanggalKegiatan as string | null) ?? null,
      documents: (row.documents as string) ?? '[]',
      driveFolderId: (row.driveFolderId as string | null) ?? null,
      driveFolderLink: (row.driveFolderLink as string | null) ?? null,
    }
  } catch (error) {
    console.error('[DRIVE HELPERS] readKegiatanForUpload error:', error)
    return null
  }
}

/**
 * Read the minimal fields needed by upload routes from a `projects` row.
 */
export async function readProjectForUpload(projectId: string): Promise<{
  id: string
  title: string
  documents: string
} | null> {
  try {
    const client = getLibsql()
    const res = await client.execute({
      sql: `SELECT id, title, documents FROM projects WHERE id = ? LIMIT 1`,
      args: [bind(projectId)],
    })
    if (res.rows.length === 0) return null
    const row = res.rows[0] as Record<string, unknown>
    return {
      id: String(row.id),
      title: String(row.title),
      documents: (row.documents as string) ?? '[]',
    }
  } catch (error) {
    console.error('[DRIVE HELPERS] readProjectForUpload error:', error)
    return null
  }
}

/**
 * Update a `surat` row with the given patch (key/value pairs). Uses libsql
 * directly so we avoid Prisma + ensureDbConnection overhead.
 *
 * Only updates the columns supplied; others are left untouched.
 */
export async function updateSuratFields(
  suratId: string,
  patch: Record<string, string | null>,
): Promise<boolean> {
  if (Object.keys(patch).length === 0) return true
  try {
    const client = getLibsql()
    const cols = Object.keys(patch)
    const setClause = cols.map((c) => `"${c}" = ?`).join(', ')
    const args = cols.map((c) => bind(patch[c] ?? null))
    args.push(bind(suratId))
    await client.execute({
      sql: `UPDATE surat SET ${setClause}, "updatedAt" = CURRENT_TIMESTAMP WHERE id = ?`,
      args,
    })
    return true
  } catch (error) {
    console.error('[DRIVE HELPERS] updateSuratFields error:', error)
    return false
  }
}

/**
 * Update a `program_kegiatan` row with the given patch.
 */
export async function updateKegiatanFields(
  kegiatanId: string,
  patch: Record<string, string | null>,
): Promise<boolean> {
  if (Object.keys(patch).length === 0) return true
  try {
    const client = getLibsql()
    const cols = Object.keys(patch)
    const setClause = cols.map((c) => `"${c}" = ?`).join(', ')
    const args = cols.map((c) => bind(patch[c] ?? null))
    args.push(bind(kegiatanId))
    await client.execute({
      sql: `UPDATE program_kegiatan SET ${setClause}, "updatedAt" = CURRENT_TIMESTAMP WHERE id = ?`,
      args,
    })
    return true
  } catch (error) {
    console.error('[DRIVE HELPERS] updateKegiatanFields error:', error)
    return false
  }
}

/**
 * Update a `projects` row with the given patch.
 */
export async function updateProjectFields(
  projectId: string,
  patch: Record<string, string | null>,
): Promise<boolean> {
  if (Object.keys(patch).length === 0) return true
  try {
    const client = getLibsql()
    const cols = Object.keys(patch)
    const setClause = cols.map((c) => `"${c}" = ?`).join(', ')
    const args = cols.map((c) => bind(patch[c] ?? null))
    args.push(bind(projectId))
    await client.execute({
      sql: `UPDATE projects SET ${setClause}, "updatedAt" = CURRENT_TIMESTAMP WHERE id = ?`,
      args,
    })
    return true
  } catch (error) {
    console.error('[DRIVE HELPERS] updateProjectFields error:', error)
    return false
  }
}
