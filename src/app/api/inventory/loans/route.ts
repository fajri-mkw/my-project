import { NextRequest, NextResponse } from 'next/server'
import { withEdgeCache, invalidateCache, deferToBackground } from '@/lib/edge-cache'
import { getLibsql, bind, nowMs, genId, type InValue } from '@/lib/libsql-client'

// GET /api/inventory/loans — list all loans (edge-cached 30s)
export const GET = withEdgeCache(async (request: NextRequest) => {
  const userRole = request.headers.get('X-User-Role')
  if (userRole !== 'Admin') {
    return NextResponse.json({ error: 'Hanya Super Admin' }, { status: 403 })
  }
  try {
    const url = new URL(request.url)
    const status = url.searchParams.get('status')
    const conditions: string[] = []
    const args: InValue[] = []
    if (status) { conditions.push('l.status = ?'); args.push(bind(status)) }
    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const client = getLibsql()
    const result = await client.execute({
      sql: `SELECT l.id, l.inventoryId, l.peminjamName, l.peminjamId,
              l.tanggalPinjam, l.tanggalKembaliRencana, l.tanggalKembaliAktual,
              l.jumlahDipinjam, l.status, l.keperluan, l.catatan,
              l.approverId, l.approvedAt, l.rejectedReason, l.createdAt,
              i.kodeBarang, i.namaBarang, i.kategori
            FROM inventory_loans l
            JOIN inventory i ON l.inventoryId = i.id
            ${whereSql}
            ORDER BY l.createdAt DESC LIMIT 200`,
      args,
    })
    const loans = result.rows.map(r => {
      const row = r as Record<string, unknown>
      return {
        id: String(row.id), inventoryId: String(row.inventoryId),
        peminjamName: String(row.peminjamName), peminjamId: strOrNull(row.peminjamId),
        tanggalPinjam: String(row.tanggalPinjam ?? ''),
        tanggalKembaliRencana: strOrNull(row.tanggalKembaliRencana),
        tanggalKembaliAktual: strOrNull(row.tanggalKembaliAktual),
        jumlahDipinjam: Number(row.jumlahDipinjam ?? 1), status: String(row.status ?? 'pending'),
        keperluan: strOrNull(row.keperluan), catatan: strOrNull(row.catatan),
        approverId: strOrNull(row.approverId), approvedAt: strOrNull(row.approvedAt),
        rejectedReason: strOrNull(row.rejectedReason), createdAt: String(row.createdAt ?? ''),
        kodeBarang: String(row.kodeBarang ?? ''), namaBarang: String(row.namaBarang ?? ''),
        kategori: String(row.kategori ?? ''),
      }
    })
    return NextResponse.json(loans)
  } catch (error) {
    console.error('[LOANS GET] Error:', error)
    return NextResponse.json([])
  }
}, { ttl: 30 })

// POST /api/inventory/loans — create new loan request (status='pending')
export async function POST(request: NextRequest) {
  const userRole = request.headers.get('X-User-Role')
  if (userRole !== 'Admin') {
    return NextResponse.json({ error: 'Hanya Super Admin' }, { status: 403 })
  }
  try {
    const body = await request.json()
    const { inventoryId, peminjamName, peminjamId, jumlahDipinjam,
            tanggalKembaliRencana, keperluan, catatan } = body as Record<string, string | undefined>

    if (!inventoryId || !peminjamName) {
      return NextResponse.json({ error: 'inventoryId dan peminjamName wajib diisi' }, { status: 400 })
    }
    const jumlah = Number(jumlahDipinjam ?? 1)
    if (isNaN(jumlah) || jumlah < 1) {
      return NextResponse.json({ error: 'jumlahDipinjam harus >= 1' }, { status: 400 })
    }

    const client = getLibsql()
    const itemRes = await client.execute({
      sql: `SELECT id, namaBarang, kodeBarang, jumlahTersedia FROM inventory WHERE id = ?`,
      args: [bind(inventoryId)],
    })
    if (itemRes.rows.length === 0) {
      return NextResponse.json({ error: 'Barang tidak ditemukan' }, { status: 404 })
    }
    const item = itemRes.rows[0] as Record<string, unknown>
    const tersedia = Number(item.jumlahTersedia ?? 0)
    if (tersedia < jumlah) {
      return NextResponse.json({ error: `Stok tidak cukup. Tersedia: ${tersedia}, diminta: ${jumlah}` }, { status: 400 })
    }

    const loanId = genId()
    const ts = nowMs()
    const tanggalRencana = tanggalKembaliRencana ? new Date(tanggalKembaliRencana).getTime() : null

    await client.execute({
      sql: `INSERT INTO inventory_loans
            (id, inventoryId, peminjamId, peminjamName, tanggalPinjam,
             tanggalKembaliRencana, jumlahDipinjam, status, keperluan, catatan, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
      args: [bind(loanId), bind(inventoryId), bind(peminjamId || null),
            bind(peminjamName), bind(ts), bind(tanggalRencana),
            bind(jumlah), bind(keperluan || null), bind(catatan || null),
            bind(ts), bind(ts)],
    })

    try { await client.execute({
      sql: `INSERT INTO inventory_history (id, inventoryId, jenisTransaksi, tanggalTransaksi, pelakuName, keterangan, jumlah, loanId)
            VALUES (?, ?, 'pinjam', ?, ?, ?, ?, ?)`,
      args: [bind(genId()), bind(inventoryId), bind(ts), bind(peminjamName),
             bind(`Permintaan pinjam: ${item.namaBarang} (${item.kodeBarang}), ${jumlah} unit — menunggu approval`),
             bind(jumlah), bind(loanId)],
    }) } catch {}

    deferToBackground(invalidateCache('/api/inventory/loans'))
    return NextResponse.json({ success: true, loanId, message: 'Permintaan peminjaman dibuat. Menunggu persetujuan.' })
  } catch (error) {
    console.error('[LOANS POST] Error:', error)
    return NextResponse.json({ error: 'Gagal membuat permintaan pinjam' }, { status: 500 })
  }
}

// PUT /api/inventory/loans — approve / reject / return
export async function PUT(request: NextRequest) {
  const userRole = request.headers.get('X-User-Role')
  if (userRole !== 'Admin') {
    return NextResponse.json({ error: 'Hanya Super Admin' }, { status: 403 })
  }
  try {
    const body = await request.json()
    const { loanId, action, rejectedReason, kondisi, catatanReturn, approverId } = body as Record<string, string | undefined>

    if (!loanId || !action) {
      return NextResponse.json({ error: 'loanId dan action wajib diisi' }, { status: 400 })
    }

    const client = getLibsql()
    const loanRes = await client.execute({
      sql: `SELECT l.*, i.namaBarang, i.kodeBarang FROM inventory_loans l JOIN inventory i ON l.inventoryId = i.id WHERE l.id = ?`,
      args: [bind(loanId)],
    })
    if (loanRes.rows.length === 0) {
      return NextResponse.json({ error: 'Peminjaman tidak ditemukan' }, { status: 404 })
    }
    const loan = loanRes.rows[0] as Record<string, unknown>
    const loanStatus = String(loan.status)
    const invId = String(loan.inventoryId)
    const jml = Number(loan.jumlahDipinjam ?? 1)
    const ts = nowMs()

    if (action === 'approve') {
      if (loanStatus !== 'pending') return NextResponse.json({ error: 'Hanya pending yang bisa di-approve' }, { status: 400 })
      const itemRes = await client.execute({ sql: `SELECT jumlahTersedia FROM inventory WHERE id = ?`, args: [bind(invId)] })
      const tersedia = Number((itemRes.rows[0] as Record<string, unknown>).jumlahTersedia ?? 0)
      if (tersedia < jml) return NextResponse.json({ error: `Stok tidak cukup. Tersedia: ${tersedia}` }, { status: 400 })
      await client.execute({ sql: `UPDATE inventory SET jumlahTersedia = jumlahTersedia - ?, jumlahDipinjam = jumlahDipinjam + ?, updatedAt = ? WHERE id = ?`, args: [bind(jml), bind(jml), bind(ts), bind(invId)] })
      await client.execute({ sql: `UPDATE inventory_loans SET status = 'active', approverId = ?, approvedAt = ?, updatedAt = ? WHERE id = ?`, args: [bind(approverId || null), bind(ts), bind(ts), bind(loanId)] })
      try { await client.execute({ sql: `INSERT INTO inventory_history (id, inventoryId, jenisTransaksi, tanggalTransaksi, pelakuName, keterangan, jumlah, loanId) VALUES (?, ?, 'approval', ?, ?, ?, ?, ?)`, args: [bind(genId()), bind(invId), bind(ts), bind('Super Admin'), bind(`Disetujui: ${loan.namaBarang}, ${jml} unit`), bind(jml), bind(loanId)] }) } catch {}

    } else if (action === 'reject') {
      if (loanStatus !== 'pending') return NextResponse.json({ error: 'Hanya pending yang bisa di-reject' }, { status: 400 })
      await client.execute({ sql: `UPDATE inventory_loans SET status = 'rejected', rejectedReason = ?, updatedAt = ? WHERE id = ?`, args: [bind(rejectedReason || null), bind(ts), bind(loanId)] })
      try { await client.execute({ sql: `INSERT INTO inventory_history (id, inventoryId, jenisTransaksi, tanggalTransaksi, pelakuName, keterangan, jumlah, loanId) VALUES (?, ?, 'reject', ?, ?, ?, ?, ?)`, args: [bind(genId()), bind(invId), bind(ts), bind('Super Admin'), bind(`Ditolak: ${loan.namaBarang} — ${rejectedReason || 'tanpa alasan'}`), bind(jml), bind(loanId)] }) } catch {}

    } else if (action === 'return') {
      if (loanStatus !== 'active' && loanStatus !== 'overdue') return NextResponse.json({ error: 'Hanya active/overdue yang bisa dikembalikan' }, { status: 400 })
      const returnId = genId()
      const kondisiStr = kondisi || 'baik'
      await client.execute({ sql: `INSERT INTO inventory_returns (id, loanId, tanggalKembali, kondisi, jumlahDikembalikan, catatan, receivedById, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, args: [bind(returnId), bind(loanId), bind(ts), bind(kondisiStr), bind(jml), bind(catatanReturn || null), bind(approverId || null), bind(ts)] })
      await client.execute({ sql: `UPDATE inventory_loans SET status = 'returned', tanggalKembaliAktual = ?, updatedAt = ? WHERE id = ?`, args: [bind(ts), bind(ts), bind(loanId)] })
      if (kondisiStr === 'hilang') {
        await client.execute({ sql: `UPDATE inventory SET jumlahDipinjam = jumlahDipinjam - ?, jumlahTotal = jumlahTotal - ?, status = 'hilang', updatedAt = ? WHERE id = ?`, args: [bind(jml), bind(jml), bind(ts), bind(invId)] })
      } else if (kondisiStr === 'rusak_berat') {
        await client.execute({ sql: `UPDATE inventory SET jumlahDipinjam = jumlahDipinjam - ?, status = CASE WHEN status = 'baik' THEN 'rusak' ELSE status END, updatedAt = ? WHERE id = ?`, args: [bind(jml), bind(ts), bind(invId)] })
      } else {
        await client.execute({ sql: `UPDATE inventory SET jumlahTersedia = jumlahTersedia + ?, jumlahDipinjam = jumlahDipinjam - ?, updatedAt = ? WHERE id = ?`, args: [bind(jml), bind(jml), bind(ts), bind(invId)] })
      }
      try { await client.execute({ sql: `INSERT INTO inventory_history (id, inventoryId, jenisTransaksi, tanggalTransaksi, pelakuName, keterangan, jumlah, loanId, returnId) VALUES (?, ?, 'kembali', ?, ?, ?, ?, ?, ?)`, args: [bind(genId()), bind(invId), bind(ts), bind('Super Admin'), bind(`Dikembalikan: ${loan.namaBarang}, kondisi: ${kondisiStr}${catatanReturn ? ' — ' + catatanReturn : ''}`), bind(jml), bind(loanId), bind(returnId)] }) } catch {}

    } else {
      return NextResponse.json({ error: 'action harus: approve | reject | return' }, { status: 400 })
    }

    deferToBackground(invalidateCache('/api/inventory/loans'))
    deferToBackground(invalidateCache('/api/inventory'))
    deferToBackground(invalidateCache('/api/inventory/history'))
    return NextResponse.json({ success: true, message: `Peminjaman ${action} berhasil` })
  } catch (error) {
    console.error('[LOANS PUT] Error:', error)
    return NextResponse.json({ error: 'Gagal memproses peminjaman' }, { status: 500 })
  }
}

function strOrNull(v: unknown): string | null { if (v === null || v === undefined) return null; return String(v) }
