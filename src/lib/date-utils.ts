/**
 * Shared Indonesian date formatting utilities.
 *
 * Used across the Dashboard, Statistik & Progress (overview), and the public
 * Tracker so every surface shows the exact same, harmonized date string:
 *
 *   "Senin, 22 Juni 2026 08.30"
 *
 * Keeping this in one place guarantees the three views stay "senada, seirama,
 * dan selaras" (in tune, in rhythm, and in harmony) as requested.
 */

// Indonesian day & month names for localized date formatting.
export const HARI_INDONESIA = [
  'Minggu',
  'Senin',
  'Selasa',
  'Rabu',
  'Kamis',
  'Jumat',
  'Sabtu',
]

export const BULAN_INDONESIA = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
]

/**
 * Format a date string (ISO or datetime-local input value like
 * "2026-06-23T08:30") into the Indonesian long form:
 *   "Senin, 22 Juni 2026 08.30"
 *
 * Returns the original string unchanged if parsing fails (e.g. empty
 * or already-humanized values) so we never show "Invalid Date" to users.
 */
export function formatTanggalIndonesia(
  raw: string | null | undefined,
): string {
  if (!raw || typeof raw !== 'string') return ''
  // Already-formatted strings — skip re-formatting to avoid double-wrapping.
  if (/^(Senin|Selasa|Rabu|Kamis|Jumat|Sabtu|Minggu),/.test(raw)) return raw

  // Normalize: datetime-local inputs ("2026-06-23T08:30") are valid for
  // `new Date()` in modern browsers. Add a timezone-safe fallback by
  // treating it as local time (no 'Z' suffix → local parse).
  const d = new Date(raw)
  if (isNaN(d.getTime())) return raw

  const hari = HARI_INDONESIA[d.getDay()]
  const tanggal = d.getDate()
  const bulan = BULAN_INDONESIA[d.getMonth()]
  const tahun = d.getFullYear()
  const jam = String(d.getHours()).padStart(2, '0')
  const menit = String(d.getMinutes()).padStart(2, '0')

  return `${hari}, ${tanggal} ${bulan} ${tahun} ${jam}.${menit}`
}

/**
 * Stable comparator that sorts projects by most-recently-modified first
 * (updatedAt DESC, with createdAt DESC as a fallback).
 *
 * Mirrors the API's `ORDER BY updatedAt DESC, createdAt DESC` so the
 * client-side store keeps newly created/updated projects on top even when
 * items are appended via addProject/updateProject.
 */
export function sortByRecent<T extends { updatedAt?: string; createdAt?: string }>(
  a: T,
  b: T,
): number {
  const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime()
  const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime()
  return bTime - aTime
}

// ---------------------------------------------------------------------------
// User-selectable sort comparators (Task ID 14)
//
// The dashboard now exposes a "Urutkan" dropdown so users can pick how the
// project list is ordered. These four comparators cover every combination of:
//
//   sortField:  'modified'    → tanggal modifikasi (updatedAt + createdAt fallback)
//               'execution'   → tanggal pelaksanaan (executionTime)
//   sortOrder:  'desc'        → terbaru → terlama
//               'asc'         → terlama → terbaru
//
// All comparators are NULL-safe: items with a missing date field are pushed
// to the end of the list regardless of sort direction (they sort as 0 epoch
// → earliest possible time → last in DESC, first in ASC). This matches what
// users expect — a project with no execution time shouldn't appear above
// projects that DO have a real execution time when sorting newest-first.
//
// Ties are broken by updatedAt DESC (so projects with the same executionTime
// are still stably ordered by recent activity).
// ---------------------------------------------------------------------------

/**
 * Sort by date modified (updatedAt), newest first.
 */
export function sortByModifiedDesc<
  T extends { updatedAt?: string; createdAt?: string },
>(a: T, b: T): number {
  const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime()
  const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime()
  return bTime - aTime
}

/**
 * Sort by date modified (updatedAt), oldest first.
 */
export function sortByModifiedAsc<
  T extends { updatedAt?: string; createdAt?: string },
>(a: T, b: T): number {
  const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime()
  const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime()
  return aTime - bTime
}

/**
 * Sort by execution time (tanggal pelaksanaan), newest first.
 * Ties broken by updatedAt DESC.
 */
export function sortByExecutionDesc<
  T extends { executionTime?: string | null; updatedAt?: string; createdAt?: string },
>(a: T, b: T): number {
  const aExec = a.executionTime ? new Date(a.executionTime).getTime() : 0
  const bExec = b.executionTime ? new Date(b.executionTime).getTime() : 0
  if (aExec !== bExec) return bExec - aExec
  // Tie-breaker: most recently modified first
  const aMod = new Date(a.updatedAt || a.createdAt || 0).getTime()
  const bMod = new Date(b.updatedAt || b.createdAt || 0).getTime()
  return bMod - aMod
}

/**
 * Sort by execution time (tanggal pelaksanaan), oldest first.
 * Ties broken by updatedAt DESC.
 * Projects with no executionTime are pushed to the END (treated as far future
 * so they sort last in ascending order).
 */
export function sortByExecutionAsc<
  T extends { executionTime?: string | null; updatedAt?: string; createdAt?: string },
>(a: T, b: T): number {
  const aExec = a.executionTime ? new Date(a.executionTime).getTime() : Number.MAX_SAFE_INTEGER
  const bExec = b.executionTime ? new Date(b.executionTime).getTime() : Number.MAX_SAFE_INTEGER
  if (aExec !== bExec) return aExec - bExec
  // Tie-breaker: most recently modified first
  const aMod = new Date(a.updatedAt || a.createdAt || 0).getTime()
  const bMod = new Date(b.updatedAt || b.createdAt || 0).getTime()
  return bMod - aMod
}

/**
 * Type describing the user-selectable sort options exposed in the UI.
 */
export type ProjectSortField = 'modified' | 'execution'
export type ProjectSortOrder = 'desc' | 'asc'

/**
 * Return the right comparator function for a given sort field + order.
 * Falls back to sortByRecent (modified DESC) for unknown combinations.
 */
export function getProjectSortComparator(
  field: ProjectSortField,
  order: ProjectSortOrder,
): <T extends { executionTime?: string | null; updatedAt?: string; createdAt?: string }>(a: T, b: T) => number {
  if (field === 'execution' && order === 'asc') return sortByExecutionAsc
  if (field === 'execution' && order === 'desc') return sortByExecutionDesc
  if (field === 'modified' && order === 'asc') return sortByModifiedAsc
  return sortByModifiedDesc // default: modified DESC
}
