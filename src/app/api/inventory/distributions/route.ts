import { NextRequest, NextResponse } from 'next/server'
import { withEdgeCache, invalidateCache, deferToBackground } from '@/lib/edge-cache'
import { getLibsql, bind, nowMs, genId, type InValue } from '@/lib/libsql-client'

// GET /api/inventory/distributions — list (edge-cached 30s)
export const GET = withEdgeCache(async (request: NextRequest) => {
  const userRole = request.headers.get('X-User-Role')
  if (!['Admin', 'Administrator', 'Manager'].includes(userRole || '')) return NextResponse.json({ error: 'Hanya Super Admin' }, { status: 403 })
  try {
    const client = getLibsql()
    const result = await client.execute({
      sql: `SELECT d.id, d.inventoryId, d.penerimaName, d.penerimaUnit,
              d.jumlahDibagikan, d.tanggalBagi, d.keperluan, d.catatan,
              d.distribusiById, d.createdAt,
              i.kodeBarang, i.namaBarang, i.kategori
            FROM inventory_distributions d
            JOIN inventory i ON d.inventoryId = i.id
            ORDER BY d.createdAt DESC LIMIT 200`,
      args: [],
    })
    const dists = result.rows.map(r => {
      const row = r as Record<string, unknown>
      return {
        id: String(row.id), inventoryId: String(row.inventoryId),
        penerimaName: String(row.penerimaName ?? ''), penerimaUnit: strOrNull(row.penerimaUnit),
        jumlahDibagikan: Number(row.jumlahDibagikan ?? 1),
        tanggalBagi: String(row.tanggalBagi ?? ''), keperluan: strOrNull(row.keperluan),
        catatan: strOrNull(row.catatan), distribusiById: strOrNull(row.distribusiById),
        createdAt: String(row.createdAt ?? ''),
        kodeBarang: String(row.kodeBarang ?? ''), namaBarang: String(row.namaBarang ?? ''),
        kategori: String(row.kategori ?? ''),
      }
    })
    return NextResponse.json(dists)
  } catch (error) {
    console.error('[DISTRIBUTIONS GET] Error:', error)
    return NextResponse.json([])
  }
}, { ttl: 30 })

// POST /api/inventory/distributions — create distribution (deduct stock immediately)
export async function POST(request: NextRequest) {
  const userRole = request.headers.get('X-User-Role')
  if (!['Admin', 'Administrator', 'Manager'].includes(userRole || '')) return NextResponse.json({ error: 'Hanya Super Admin' }, { status: 403 })
  try {
    const body = await request.json()
    const { inventoryId, penerimaName, penerimaUnit, jumlahDibagikan, keperluan, catatan, distribusiById } = body as Record<string, string | undefined>

    if (!inventoryId || !penerimaName) return NextResponse.json({ error: 'inventoryId dan penerimaName wajib diisi' }, { status: 400 })
    const jumlah = Number(jumlahDibagikan ?? 1)
    if (isNaN(jumlah) || jumlah < 1) return NextResponse.json({ error: 'jumlahDibagikan harus >= 1' }, { status: 400 })

    const client = getLibsql()
    const itemRes = await client.execute({ sql: `SELECT id, namaBarang, kodeBarang, jumlahTersedia, jumlahTotal FROM inventory WHERE id = ?`, args: [bind(inventoryId)] })
    if (itemRes.rows.length === 0) return NextResponse.json({ error: 'Barang tidak ditemukan' }, { status: 404 })
    const item = itemRes.rows[0] as Record<string, unknown>
    const tersedia = Number(item.jumlahTersedia ?? 0)
    if (tersedia < jumlah) return NextResponse.json({ error: `Stok tidak cukup. Tersedia: ${tersedia}` }, { status: 400 })

    const ts = nowMs()
    const distId = genId()

    // Deduct stock: tersedia berkurang, dibagikan bertambah, total berkurang
    await client.execute({
      sql: `UPDATE inventory SET jumlahTersedia = jumlahTersedia - ?, jumlahDibagikan = jumlahDibagikan + ?, jumlahTotal = jumlahTotal - ?, updatedAt = ? WHERE id = ?`,
      args: [bind(jumlah), bind(jumlah), bind(jumlah), bind(ts), bind(inventoryId)],
    })

    await client.execute({
      sql: `INSERT INTO inventory_distributions (id, inventoryId, penerimaName, penerimaUnit, jumlahDibagikan, tanggalBagi, keperluan, catatan, distribusiById, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [bind(distId), bind(inventoryId), bind(penerimaName), bind(penerimaUnit || null), bind(jumlah), bind(ts), bind(keperluan || null), bind(catatan || null), bind(distribusiById || null), bind(ts)],
    })

    try { await client.execute({
      sql: `INSERT INTO inventory_history (id, inventoryId, jenisTransaksi, tanggalTransaksi, pelakuName, keterangan, jumlah, distributionId) VALUES (?, ?, 'bagi', ?, ?, ?, ?, ?)`,
      args: [bind(genId()), bind(inventoryId), bind(ts), bind('Super Admin'), bind(`Dibagikan ke ${penerimaName}${penerimaUnit ? ' (' + penerimaUnit + ')' : ''}: ${item.namaBarang} (${item.kodeBarang}), ${jumlah} unit`), bind(jumlah), bind(distId)],
    }) } catch {}

    deferToBackground(invalidateCache('/api/inventory/distributions'))
    deferToBackground(invalidateCache('/api/inventory'))
    deferToBackground(invalidateCache('/api/inventory/history'))
    return NextResponse.json({ success: true, message: `Barang "${item.namaBarang}" dibagikan ke ${penerimaName}` })
  } catch (error) {
    console.error('[DISTRIBUTIONS POST] Error:', error)
    return NextResponse.json({ error: 'Gagal membuat pembagian' }, { status: 500 })
  }
}

function strOrNull(v: unknown): string | null { if (v === null || v === undefined) return null; return String(v) }
