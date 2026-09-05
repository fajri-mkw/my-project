import { NextRequest, NextResponse } from 'next/server'
import { withEdgeCache, invalidateCache, deferToBackground } from '@/lib/edge-cache'
import { getLibsql, bind, nowMs, genId, type InValue } from '@/lib/libsql-client'

function strOrNull(v: unknown): string | null { if (v === null || v === undefined) return null; return String(v) }

// GET /api/inventory/loans — list all loans, grouped by loanGroupId
export const GET = withEdgeCache(async (request: NextRequest) => {
  const userRole = request.headers.get('X-User-Role')
  if (!['Admin', 'Administrator', 'Manager'].includes(userRole || '')) return NextResponse.json({ error: 'Hanya Super Admin' }, { status: 403 })
  try {
    const url = new URL(request.url)
    const status = url.searchParams.get('status')
    const conditions: string[] = []
    const args: InValue[] = []
    if (status) { conditions.push('l.status = ?'); args.push(bind(status)) }
    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const client = getLibsql()
    const result = await client.execute({
      sql: `SELECT l.id, l.inventoryId, l.peminjamName, l.peminjamId, l.peminjamUnit, l.peminjamPhone,
              l.peminjamPhotoUrl, l.peminjamPhotoFileId,
              l.loanGroupId, l.tanggalPinjam, l.tanggalKembaliRencana, l.tanggalKembaliAktual,
              l.jumlahDipinjam, l.status, l.keperluan, l.catatan,
              l.approverId, l.approvedAt, l.rejectedReason, l.createdAt,
              i.kodeBarang, i.namaBarang, i.kategori
            FROM inventory_loans l
            JOIN inventory i ON l.inventoryId = i.id
            ${whereSql}
            ORDER BY l.createdAt DESC LIMIT 300`,
      args,
    })
    // Group by loanGroupId (or individual loan if no group)
    const loans = result.rows.map(r => {
      const row = r as Record<string, unknown>
      return {
        id: String(row.id), inventoryId: String(row.inventoryId),
        peminjamName: String(row.peminjamName), peminjamId: strOrNull(row.peminjamId),
        peminjamUnit: strOrNull(row.peminjamUnit), peminjamPhone: strOrNull(row.peminjamPhone),
        peminjamPhotoUrl: strOrNull(row.peminjamPhotoUrl), peminjamPhotoFileId: strOrNull(row.peminjamPhotoFileId),
        loanGroupId: strOrNull(row.loanGroupId),
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

// POST /api/inventory/loans — create loan request (supports multi-item)
// Body: { items: [{inventoryId, jumlahDipinjam}], peminjamName, peminjamUnit, peminjamPhone, tanggalKembaliRencana, keperluan, catatan }
export async function POST(request: NextRequest) {
  const userRole = request.headers.get('X-User-Role')
  if (!['Admin', 'Administrator', 'Manager'].includes(userRole || '')) return NextResponse.json({ error: 'Hanya Super Admin' }, { status: 403 })
  try {
    const body = await request.json()
    const { items, peminjamName, peminjamUnit, peminjamPhone, peminjamId,
            peminjamPhotoUrl, peminjamPhotoFileId,
            tanggalKembaliRencana, keperluan, catatan } = body as {
      items?: Array<{ inventoryId: string; jumlahDipinjam: number }>
      peminjamName?: string; peminjamUnit?: string; peminjamPhone?: string
      peminjamPhotoUrl?: string; peminjamPhotoFileId?: string
      peminjamId?: string; tanggalKembaliRencana?: string; keperluan?: string; catatan?: string
    }

    // Debug log — confirm what photo data is received from frontend
    console.log('[LOANS POST] Photo data received:', {
      hasPhotoUrl: !!peminjamPhotoUrl,
      hasPhotoFileId: !!peminjamPhotoFileId,
      photoUrlLen: peminjamPhotoUrl?.length || 0,
      photoFileIdPreview: peminjamPhotoFileId ? peminjamPhotoFileId.substring(0, 30) : '(empty)',
      peminjamName,
      bodyKeys: Object.keys(body),
    })

    // Support both multi-item (items[]) and single-item (inventoryId + jumlahDipinjam) for backward compat
    let loanItems: Array<{ inventoryId: string; jumlahDipinjam: number }>
    if (items && Array.isArray(items) && items.length > 0) {
      loanItems = items
    } else {
      // Legacy single-item mode
      const { inventoryId, jumlahDipinjam } = body as Record<string, string | undefined>
      if (!inventoryId) return NextResponse.json({ error: 'items atau inventoryId wajib diisi' }, { status: 400 })
      loanItems = [{ inventoryId, jumlahDipinjam: Number(jumlahDipinjam ?? 1) }]
    }

    if (!peminjamName) return NextResponse.json({ error: 'peminjamName wajib diisi' }, { status: 400 })
    if (loanItems.length === 0) return NextResponse.json({ error: 'Minimal 1 barang dipinjam' }, { status: 400 })

    const client = getLibsql()
    const ts = nowMs()
    const tanggalRencana = tanggalKembaliRencana ? new Date(tanggalKembaliRencana).getTime() : null
    // Generate shared loanGroupId for all items in this loan request
    const loanGroupId = `LG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const loanIds: string[] = []

    // Validate stock for all items first (before any insert)
    const validations = []
    for (const item of loanItems) {
      const jml = Number(item.jumlahDipinjam) || 1
      if (jml < 1) return NextResponse.json({ error: 'Jumlah pinjam harus >= 1' }, { status: 400 })
      const itemRes = await client.execute({
        sql: `SELECT id, namaBarang, kodeBarang, jumlahTersedia FROM inventory WHERE id = ?`,
        args: [bind(item.inventoryId)],
      })
      if (itemRes.rows.length === 0) return NextResponse.json({ error: `Barang tidak ditemukan: ${item.inventoryId}` }, { status: 404 })
      const inv = itemRes.rows[0] as Record<string, unknown>
      const tersedia = Number(inv.jumlahTersedia ?? 0)
      if (tersedia < jml) return NextResponse.json({ error: `Stok "${inv.namaBarang}" tidak cukup. Tersedia: ${tersedia}, diminta: ${jml}` }, { status: 400 })
      validations.push({ item, jml, inv })
    }

    // All validations passed — create loan records
    for (const { item, jml, inv } of validations) {
      const loanId = genId()
      loanIds.push(loanId)
      await client.execute({
        sql: `INSERT INTO inventory_loans
              (id, inventoryId, peminjamId, peminjamName, peminjamUnit, peminjamPhone,
               peminjamPhotoUrl, peminjamPhotoFileId,
               loanGroupId, tanggalPinjam, tanggalKembaliRencana, jumlahDipinjam,
               status, keperluan, catatan, createdAt, updatedAt)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
        args: [
          bind(loanId), bind(item.inventoryId), bind(peminjamId || null),
          bind(peminjamName), bind(peminjamUnit || null), bind(peminjamPhone || null),
          bind(peminjamPhotoUrl || null), bind(peminjamPhotoFileId || null),
          bind(loanGroupId), bind(ts), bind(tanggalRencana), bind(jml),
          bind(keperluan || null), bind(catatan || null), bind(ts), bind(ts),
        ],
      })
      // History per item
      try { await client.execute({
        sql: `INSERT INTO inventory_history (id, inventoryId, jenisTransaksi, tanggalTransaksi, pelakuName, keterangan, jumlah, loanId)
              VALUES (?, ?, 'pinjam', ?, ?, ?, ?, ?)`,
        args: [bind(genId()), bind(item.inventoryId), bind(ts), bind(peminjamName),
               bind(`Pinjam: ${inv.namaBarang} (${inv.kodeBarang}), ${jml} unit — menunggu approval`), bind(jml), bind(loanId)],
      }) } catch {}
    }

    deferToBackground(invalidateCache('/api/inventory/loans'))
    return NextResponse.json({
      success: true, loanGroupId, loanIds,
      message: `Permintaan peminjaman ${loanItems.length} barang dibuat. Menunggu persetujuan.`,
    })
  } catch (error) {
    console.error('[LOANS POST] Error:', error)
    return NextResponse.json({ error: 'Gagal membuat permintaan pinjam' }, { status: 500 })
  }
}

// PUT /api/inventory/loans — approve / reject / return
// When action=approve/reject, apply to ALL loans in the same loanGroupId
// When action=return, apply to single loan (per-item return)
export async function PUT(request: NextRequest) {
  const userRole = request.headers.get('X-User-Role')
  if (!['Admin', 'Administrator', 'Manager'].includes(userRole || '')) return NextResponse.json({ error: 'Hanya Super Admin' }, { status: 403 })
  try {
    const body = await request.json()
    const { loanId, action, rejectedReason, kondisi, catatanReturn, approverId } = body as Record<string, string | undefined>
    if (!loanId || !action) return NextResponse.json({ error: 'loanId dan action wajib diisi' }, { status: 400 })

    const client = getLibsql()
    // Fetch the loan
    const loanRes = await client.execute({
      sql: `SELECT l.*, i.namaBarang, i.kodeBarang FROM inventory_loans l JOIN inventory i ON l.inventoryId = i.id WHERE l.id = ?`,
      args: [bind(loanId)],
    })
    if (loanRes.rows.length === 0) return NextResponse.json({ error: 'Peminjaman tidak ditemukan' }, { status: 404 })
    const loan = loanRes.rows[0] as Record<string, unknown>
    const loanGroupId = strOrNull(loan.loanGroupId)
    const ts = nowMs()

    if (action === 'approve' || action === 'reject') {
      // Apply to ALL loans in the same group
      let groupLoansRes
      if (loanGroupId) {
        groupLoansRes = await client.execute({
          sql: `SELECT l.id, l.inventoryId, l.jumlahDipinjam, l.status, i.namaBarang, i.kodeBarang
                FROM inventory_loans l JOIN inventory i ON l.inventoryId = i.id
                WHERE l.loanGroupId = ?`,
          args: [bind(loanGroupId)],
        })
      } else {
        groupLoansRes = loanRes
      }

      for (const row of groupLoansRes.rows) {
        const r = row as Record<string, unknown>
        const lId = String(r.id)
        const invId = String(r.inventoryId)
        const jml = Number(r.jumlahDipinjam ?? 1)
        const lStatus = String(r.status)

        if (action === 'approve') {
          if (lStatus !== 'pending') continue
          // Check + deduct stock
          const itemRes = await client.execute({ sql: `SELECT jumlahTersedia FROM inventory WHERE id = ?`, args: [bind(invId)] })
          const tersedia = Number((itemRes.rows[0] as Record<string, unknown>).jumlahTersedia ?? 0)
          if (tersedia < jml) { console.warn(`[LOANS PUT] Skip approve ${lId}: stok ${tersedia} < ${jml}`); continue }
          await client.execute({ sql: `UPDATE inventory SET jumlahTersedia = jumlahTersedia - ?, jumlahDipinjam = jumlahDipinjam + ?, updatedAt = ? WHERE id = ?`, args: [bind(jml), bind(jml), bind(ts), bind(invId)] })
          await client.execute({ sql: `UPDATE inventory_loans SET status = 'active', approverId = ?, approvedAt = ?, updatedAt = ? WHERE id = ?`, args: [bind(approverId || null), bind(ts), bind(ts), bind(lId)] })
          try { await client.execute({ sql: `INSERT INTO inventory_history (id, inventoryId, jenisTransaksi, tanggalTransaksi, pelakuName, keterangan, jumlah, loanId) VALUES (?, ?, 'approval', ?, ?, ?, ?, ?)`, args: [bind(genId()), bind(invId), bind(ts), bind('Super Admin'), bind(`Disetujui: ${r.namaBarang}, ${jml} unit`), bind(jml), bind(lId)] }) } catch {}
        } else if (action === 'reject') {
          if (lStatus !== 'pending') continue
          await client.execute({ sql: `UPDATE inventory_loans SET status = 'rejected', rejectedReason = ?, updatedAt = ? WHERE id = ?`, args: [bind(rejectedReason || null), bind(ts), bind(lId)] })
          try { await client.execute({ sql: `INSERT INTO inventory_history (id, inventoryId, jenisTransaksi, tanggalTransaksi, pelakuName, keterangan, jumlah, loanId) VALUES (?, ?, 'reject', ?, ?, ?, ?, ?)`, args: [bind(genId()), bind(invId), bind(ts), bind('Super Admin'), bind(`Ditolak: ${r.namaBarang} — ${rejectedReason || ''}`), bind(jml), bind(lId)] }) } catch {}
        }
      }
    } else if (action === 'return') {
      // Single item return
      const loanStatus = String(loan.status)
      const invId = String(loan.inventoryId)
      const jml = Number(loan.jumlahDipinjam ?? 1)
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

// DELETE /api/inventory/loans?id=... — hapus data peminjaman
// Hanya untuk status returned/rejected/pending (active/overdue tidak bisa
// dihapus karena barang masih di peminjam — harus dikembalikan dulu).
// Jika status adalah 'active', kembalikan stok dulu sebelum hapus.
export async function DELETE(request: NextRequest) {
  const userRole = request.headers.get('X-User-Role')
  if (!['Admin', 'Administrator', 'Manager'].includes(userRole || '')) return NextResponse.json({ error: 'Hanya Super Admin' }, { status: 403 })

  try {
    const { searchParams } = new URL(request.url)
    const loanId = searchParams.get('id')
    if (!loanId) return NextResponse.json({ error: 'id wajib diisi' }, { status: 400 })

    const client = getLibsql()
    const loanRes = await client.execute({
      sql: `SELECT l.id, l.inventoryId, l.jumlahDipinjam, l.status, i.namaBarang
            FROM inventory_loans l JOIN inventory i ON l.inventoryId = i.id WHERE l.id = ?`,
      args: [bind(loanId)],
    })
    if (loanRes.rows.length === 0) return NextResponse.json({ error: 'Peminjaman tidak ditemukan' }, { status: 404 })

    const loan = loanRes.rows[0] as Record<string, unknown>
    const loanStatus = String(loan.status)
    const invId = String(loan.inventoryId)
    const jml = Number(loan.jumlahDipinjam ?? 1)
    const ts = nowMs()

    // Kalau status active/overdue, kembalikan stok dulu (barang masih dipinjam)
    if (loanStatus === 'active' || loanStatus === 'overdue') {
      await client.execute({
        sql: `UPDATE inventory SET jumlahTersedia = jumlahTersedia + ?, jumlahDipinjam = jumlahDipinjam - ?, updatedAt = ? WHERE id = ?`,
        args: [bind(jml), bind(jml), bind(ts), bind(invId)],
      })
    }

    // Hapus return record (jika ada), lalu loan record
    try { await client.execute({ sql: `DELETE FROM inventory_returns WHERE loanId = ?`, args: [bind(loanId)] }) } catch {}
    await client.execute({ sql: `DELETE FROM inventory_loans WHERE id = ?`, args: [bind(loanId)] })

    deferToBackground(invalidateCache('/api/inventory/loans'))
    deferToBackground(invalidateCache('/api/inventory'))
    deferToBackground(invalidateCache('/api/inventory/history'))

    return NextResponse.json({ success: true, message: 'Peminjaman berhasil dihapus' })
  } catch (error) {
    console.error('[LOANS DELETE] Error:', error)
    return NextResponse.json({ error: 'Gagal menghapus peminjaman' }, { status: 500 })
  }
}
