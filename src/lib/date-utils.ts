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
