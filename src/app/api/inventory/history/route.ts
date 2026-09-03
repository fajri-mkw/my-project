import { NextRequest, NextResponse } from 'next/server'
import { withEdgeCache, invalidateCache, deferToBackground } from '@/lib/edge-cache'
import { getLibsql, bind, type InValue } from '@/lib/libsql-client'

// GET /api/inventory/history — list all history with filters (edge-cached 30s)
export const GET = withEdgeCache(async (request: NextRequest) => {
  const userRole = request.headers.get('X-User-Role')
  if (!['Admin', 'Administrator', 'Manager'].includes(userRole || '')) return NextResponse.json({ error: 'Hanya Super Admin' }, { status: 403 })
  try {
    const url = new URL(request.url)
    const jenisTransaksi = url.searchParams.get('jenisTransaksi')
    const inventoryId = url.searchParams.get('inventoryId')
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 200), 500)

    const conditions: string[] = []
    const args: InValue[] = []
    if (jenisTransaksi) { conditions.push('h.jenisTransaksi = ?'); args.push(bind(jenisTransaksi)) }
    if (inventoryId) { conditions.push('h.inventoryId = ?'); args.push(bind(inventoryId)) }
    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const client = getLibsql()
    const result = await client.execute({
      sql: `SELECT h.id, h.inventoryId, h.jenisTransaksi, h.tanggalTransaksi,
              h.pelakuId, h.pelakuName, h.keterangan, h.jumlah,
              h.loanId, h.distributionId, h.returnId,
              i.kodeBarang, i.namaBarang, i.kategori
            FROM inventory_history h
            JOIN inventory i ON h.inventoryId = i.id
            ${whereSql}
            ORDER BY h.tanggalTransaksi DESC LIMIT ?`,
      args: [...args, bind(limit)],
    })
    const histories = result.rows.map(r => {
      const row = r as Record<string, unknown>
      return {
        id: String(row.id), inventoryId: String(row.inventoryId),
        jenisTransaksi: String(row.jenisTransaksi ?? ''),
        tanggalTransaksi: String(row.tanggalTransaksi ?? ''),
        pelakuId: strOrNull(row.pelakuId), pelakuName: strOrNull(row.pelakuName),
        keterangan: strOrNull(row.keterangan), jumlah: row.jumlah != null ? Number(row.jumlah) : null,
        loanId: strOrNull(row.loanId), distributionId: strOrNull(row.distributionId),
        returnId: strOrNull(row.returnId),
        kodeBarang: String(row.kodeBarang ?? ''), namaBarang: String(row.namaBarang ?? ''),
        kategori: String(row.kategori ?? ''),
      }
    })
    return NextResponse.json(histories)
  } catch (error) {
    console.error('[HISTORY GET] Error:', error)
    return NextResponse.json([])
  }
}, { ttl: 30 })

function strOrNull(v: unknown): string | null { if (v === null || v === undefined) return null; return String(v) }

// DELETE /api/inventory/history?ids=id1,id2,id3 — hapus multiple history entries
export async function DELETE(request: NextRequest) {
  const userRole = request.headers.get('X-User-Role')
  if (!['Admin', 'Administrator', 'Manager'].includes(userRole || '')) return NextResponse.json({ error: 'Hanya Super Admin' }, { status: 403 })

  try {
    const { searchParams } = new URL(request.url)
    const idsParam = searchParams.get('ids')
    if (!idsParam) return NextResponse.json({ error: 'ids wajib diisi' }, { status: 400 })

    const ids = idsParam.split(',').filter(Boolean)
    if (ids.length === 0) return NextResponse.json({ error: 'ids tidak boleh kosong' }, { status: 400 })

    const client = getLibsql()
    // Delete each history entry
    for (const id of ids) {
      try {
        await client.execute({ sql: `DELETE FROM inventory_history WHERE id = ?`, args: [bind(id)] })
      } catch (err) {
        console.error(`[HISTORY DELETE] Failed to delete ${id}:`, err)
      }
    }

    deferToBackground(invalidateCache('/api/inventory/history'))
    return NextResponse.json({ success: true, message: `${ids.length} history berhasil dihapus` })
  } catch (error) {
    console.error('[HISTORY DELETE] Error:', error)
    return NextResponse.json({ error: 'Gagal menghapus history' }, { status: 500 })
  }
}
