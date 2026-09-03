import { NextRequest, NextResponse } from 'next/server'
import { withEdgeCache, invalidateCache, deferToBackground } from '@/lib/edge-cache'
import {
  getLibsql,
  bind,
  nowMs,
  genId,
  type InValue,
} from '@/lib/libsql-client'

// ============================================================================
// MANAJEMEN INVENTARIS HUMAS — Super Admin only.
// ============================================================================

const INVENTORY_COLUMNS = `id, kodeBarang, namaBarang, kategori, jumlahTotal,
  jumlahTersedia, jumlahDipinjam, jumlahDibagikan, lokasi, pengguna, penanggungJawab,
  sumberPengadaan, tahunPengadaan, status,
  kondisiCatatan, imageFileId, imageUrl, catatan, createdBy, createdAt, updatedAt`

function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null
  return String(v)
}

function mapInventory(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ''),
    kodeBarang: String(row.kodeBarang ?? ''),
    namaBarang: String(row.namaBarang ?? ''),
    kategori: String(row.kategori ?? ''),
    jumlahTotal: Number(row.jumlahTotal ?? 0),
    jumlahTersedia: Number(row.jumlahTersedia ?? 0),
    jumlahDipinjam: Number(row.jumlahDipinjam ?? 0),
    jumlahDibagikan: Number(row.jumlahDibagikan ?? 0),
    lokasi: strOrNull(row.lokasi),
    pengguna: strOrNull(row.pengguna),
    penanggungJawab: strOrNull(row.penanggungJawab),
    sumberPengadaan: strOrNull(row.sumberPengadaan),
    tahunPengadaan: row.tahunPengadaan != null ? Number(row.tahunPengadaan) : null,
    status: String(row.status ?? 'baik'),
    kondisiCatatan: strOrNull(row.kondisiCatatan),
    imageFileId: strOrNull(row.imageFileId),
    imageUrl: strOrNull(row.imageUrl),
    catatan: strOrNull(row.catatan),
    createdBy: strOrNull(row.createdBy),
    createdAt: String(row.createdAt ?? ''),
    updatedAt: String(row.updatedAt ?? ''),
  }
}

// GET /api/inventory — list all inventory items. Edge-cached 60s.
export const GET = withEdgeCache(async (request: NextRequest) => {
  const userRole = request.headers.get('X-User-Role')
  if (!['Admin', 'Administrator', 'Manager'].includes(userRole || '')) {
    return NextResponse.json(
      { error: 'Hanya Super Admin yang dapat mengakses inventaris' },
      { status: 403 },
    )
  }

  try {
    const url = new URL(request.url)
    const kategori = url.searchParams.get('kategori')
    const status = url.searchParams.get('status')
    const search = url.searchParams.get('search')

    const conditions: string[] = []
    const args: InValue[] = []
    if (kategori) {
      conditions.push('kategori = ?')
      args.push(bind(kategori))
    }
    if (status) {
      conditions.push('status = ?')
      args.push(bind(status))
    }
    if (search) {
      conditions.push('(namaBarang LIKE ? OR kodeBarang LIKE ?)')
      args.push(bind(`%${search}%`), bind(`%${search}%`))
    }
    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const client = getLibsql()
    const result = await client.execute({
      sql: `SELECT ${INVENTORY_COLUMNS} FROM inventory ${whereSql} ORDER BY createdAt DESC LIMIT 500`,
      args,
    })

    const transformed = result.rows.map((r) =>
      mapInventory(r as Record<string, unknown>),
    )
    return NextResponse.json(transformed)
  } catch (error) {
    console.error('[INVENTORY GET] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch inventory', inventory: [] },
      { status: 500 },
    )
  }
}, { ttl: 60 })

// POST /api/inventory — create new inventory item.
export async function POST(request: NextRequest) {
  const userRole = request.headers.get('X-User-Role')
  if (!['Admin', 'Administrator', 'Manager'].includes(userRole || '')) {
    return NextResponse.json(
      { error: 'Hanya Super Admin yang dapat menambah inventaris' },
      { status: 403 },
    )
  }

  try {
    const body = await request.json()
    const {
      kodeBarang, namaBarang, kategori, jumlahTotal, lokasi, pengguna,
      penanggungJawab, sumberPengadaan, tahunPengadaan, status,
      kondisiCatatan, imageFileId, imageUrl, catatan, createdBy,
    } = body as Record<string, string | undefined>

    if (!kodeBarang || !namaBarang || !kategori) {
      return NextResponse.json(
        { error: 'kodeBarang, namaBarang, dan kategori wajib diisi' },
        { status: 400 },
      )
    }

    const total = Number(jumlahTotal ?? 0)
    if (isNaN(total) || total < 0) {
      return NextResponse.json(
        { error: 'jumlahTotal harus angka >= 0' },
        { status: 400 },
      )
    }

    const client = getLibsql()
    const itemId = genId()
    const ts = nowMs()
    const itemStatus = status || 'baik'

    const dupRes = await client.execute({
      sql: `SELECT id FROM inventory WHERE kodeBarang = ? LIMIT 1`,
      args: [bind(kodeBarang)],
    })
    if (dupRes.rows.length > 0) {
      return NextResponse.json(
        { error: `Kode barang "${kodeBarang}" sudah dipakai` },
        { status: 400 },
      )
    }

    await client.execute({
      sql: `INSERT INTO inventory
            (id, kodeBarang, namaBarang, kategori, jumlahTotal, jumlahTersedia,
             jumlahDipinjam, jumlahDibagikan, lokasi, pengguna, penanggungJawab,
             sumberPengadaan, tahunPengadaan, status, kondisiCatatan,
             imageFileId, imageUrl, catatan, createdBy, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        bind(itemId), bind(kodeBarang), bind(namaBarang), bind(kategori),
        bind(total), bind(total),
        bind(lokasi || null), bind(pengguna || null), bind(penanggungJawab || null),
        bind(sumberPengadaan || null), bind(tahunPengadaan != null ? Number(tahunPengadaan) : null),
        bind(itemStatus), bind(kondisiCatatan || null),
        bind(imageFileId || null), bind(imageUrl || null), bind(catatan || null),
        bind(createdBy || null), bind(ts), bind(ts),
      ],
    })

    try {
      await client.execute({
        sql: `INSERT INTO inventory_history
              (id, inventoryId, jenisTransaksi, tanggalTransaksi, pelakuId, pelakuName,
               keterangan, jumlah)
              VALUES (?, ?, 'masuk', ?, ?, ?, ?, ?)`,
        args: [
          bind(genId()), bind(itemId), bind(ts),
          bind(createdBy || null), bind('Super Admin'),
          bind(`Barang masuk: ${namaBarang} (${kodeBarang}), jumlah ${total}`),
          bind(total),
        ],
      })
    } catch (histErr) {
      console.error('[INVENTORY POST] history insert failed:', histErr)
    }

    deferToBackground(invalidateCache('/api/inventory'))

    return NextResponse.json({
      success: true,
      item: {
        id: itemId, kodeBarang, namaBarang, kategori,
        jumlahTotal: total, jumlahTersedia: total,
        jumlahDipinjam: 0, jumlahDibagikan: 0,
        lokasi: lokasi || null, pengguna: pengguna || null,
        penanggungJawab: penanggungJawab || null, sumberPengadaan: sumberPengadaan || null,
        tahunPengadaan: tahunPengadaan != null ? Number(tahunPengadaan) : null,
        status: itemStatus,
        kondisiCatatan: kondisiCatatan || null,
        imageFileId: imageFileId || null, imageUrl: imageUrl || null,
        catatan: catatan || null, createdBy: createdBy || null,
        createdAt: ts, updatedAt: ts,
      },
      message: `Barang "${namaBarang}" berhasil ditambahkan`,
    })
  } catch (error) {
    console.error('[INVENTORY POST] Error:', error)
    return NextResponse.json(
      { error: 'Failed to create inventory item' },
      { status: 500 },
    )
  }
}

// PUT /api/inventory — update item.
export async function PUT(request: NextRequest) {
  const userRole = request.headers.get('X-User-Role')
  if (!['Admin', 'Administrator', 'Manager'].includes(userRole || '')) {
    return NextResponse.json(
      { error: 'Hanya Super Admin yang dapat mengubah inventaris' },
      { status: 403 },
    )
  }

  try {
    const body = await request.json()
    // id bisa dikirim via query string (?id=xxx) atau body JSON.
    // UI mengirim via query string, jadi baca dari URL dulu, fallback ke body.
    const urlId = new URL(request.url).searchParams.get('id')
    const {
      id: bodyId, kodeBarang, namaBarang, kategori, jumlahTotal, lokasi, pengguna,
      penanggungJawab, sumberPengadaan, tahunPengadaan, status,
      kondisiCatatan, imageFileId, imageUrl, catatan,
    } = body as Record<string, string | undefined>
    const id = urlId || bodyId

    if (!id) {
      return NextResponse.json(
        { error: 'id wajib diisi' },
        { status: 400 },
      )
    }

    const client = getLibsql()

    const existingRes = await client.execute({
      sql: `SELECT ${INVENTORY_COLUMNS} FROM inventory WHERE id = ? LIMIT 1`,
      args: [bind(id)],
    })
    if (existingRes.rows.length === 0) {
      return NextResponse.json(
        { error: 'Barang tidak ditemukan' },
        { status: 404 },
      )
    }
    const existing = mapInventory(existingRes.rows[0] as Record<string, unknown>)

    if (kodeBarang && kodeBarang !== existing.kodeBarang) {
      const dupRes = await client.execute({
        sql: `SELECT id FROM inventory WHERE kodeBarang = ? AND id != ? LIMIT 1`,
        args: [bind(kodeBarang), bind(id)],
      })
      if (dupRes.rows.length > 0) {
        return NextResponse.json(
          { error: `Kode barang "${kodeBarang}" sudah dipakai barang lain` },
          { status: 400 },
        )
      }
    }

    const sets: string[] = []
    const args: InValue[] = []
    if (kodeBarang !== undefined) { sets.push('kodeBarang = ?'); args.push(bind(kodeBarang)) }
    if (namaBarang !== undefined) { sets.push('namaBarang = ?'); args.push(bind(namaBarang)) }
    if (kategori !== undefined) { sets.push('kategori = ?'); args.push(bind(kategori)) }
    if (lokasi !== undefined) { sets.push('lokasi = ?'); args.push(bind(lokasi || null)) }
    if (pengguna !== undefined) { sets.push('pengguna = ?'); args.push(bind(pengguna || null)) }
    if (penanggungJawab !== undefined) { sets.push('penanggungJawab = ?'); args.push(bind(penanggungJawab || null)) }
    if (sumberPengadaan !== undefined) { sets.push('sumberPengadaan = ?'); args.push(bind(sumberPengadaan || null)) }
    if (tahunPengadaan !== undefined) { sets.push('tahunPengadaan = ?'); args.push(bind(tahunPengadaan ? Number(tahunPengadaan) : null)) }
    if (status !== undefined) { sets.push('status = ?'); args.push(bind(status)) }
    if (kondisiCatatan !== undefined) { sets.push('kondisiCatatan = ?'); args.push(bind(kondisiCatatan || null)) }
    if (imageFileId !== undefined) { sets.push('imageFileId = ?'); args.push(bind(imageFileId || null)) }
    if (imageUrl !== undefined) { sets.push('imageUrl = ?'); args.push(bind(imageUrl || null)) }
    if (catatan !== undefined) { sets.push('catatan = ?'); args.push(bind(catatan || null)) }

    let deltaTersedia = 0
    if (jumlahTotal !== undefined) {
      const newTotal = Number(jumlahTotal)
      if (!isNaN(newTotal) && newTotal >= 0) {
        const oldTotal = existing.jumlahTotal
        deltaTersedia = newTotal - oldTotal
        const newTersedia = Math.max(0, existing.jumlahTersedia + deltaTersedia)
        sets.push('jumlahTotal = ?', 'jumlahTersedia = ?')
        args.push(bind(newTotal), bind(newTersedia))
      }
    }

    if (sets.length === 0) {
      return NextResponse.json({ success: true, message: 'Tidak ada perubahan' })
    }

    sets.push('updatedAt = ?')
    args.push(bind(nowMs()))
    args.push(bind(id))

    await client.execute({
      sql: `UPDATE inventory SET ${sets.join(', ')} WHERE id = ?`,
      args,
    })

    try {
      const changes: string[] = []
      if (kodeBarang && kodeBarang !== existing.kodeBarang) changes.push(`kode: ${existing.kodeBarang} → ${kodeBarang}`)
      if (namaBarang && namaBarang !== existing.namaBarang) changes.push(`nama: ${existing.namaBarang} → ${namaBarang}`)
      if (jumlahTotal !== undefined && deltaTersedia !== 0) changes.push(`jumlahTotal: ${existing.jumlahTotal} → ${jumlahTotal}`)
      if (status && status !== existing.status) changes.push(`status: ${existing.status} → ${status}`)
      const keterangan = changes.length > 0
        ? `Edit: ${changes.join(', ')}`
        : 'Edit (no major changes)'

      await client.execute({
        sql: `INSERT INTO inventory_history
              (id, inventoryId, jenisTransaksi, tanggalTransaksi, pelakuName, keterangan, jumlah)
              VALUES (?, ?, 'edit', ?, ?, ?, ?)`,
        args: [
          bind(genId()), bind(id), bind(nowMs()),
          bind('Super Admin'), bind(keterangan), bind(deltaTersedia || null),
        ],
      })
    } catch (histErr) {
      console.error('[INVENTORY PUT] history insert failed:', histErr)
    }

    deferToBackground(invalidateCache('/api/inventory'))

    return NextResponse.json({
      success: true,
      message: `Barang "${namaBarang || existing.namaBarang}" berhasil diupdate`,
    })
  } catch (error) {
    console.error('[INVENTORY PUT] Error:', error)
    return NextResponse.json(
      { error: 'Failed to update inventory item' },
      { status: 500 },
    )
  }
}

// DELETE /api/inventory?id=...
export async function DELETE(request: NextRequest) {
  const userRole = request.headers.get('X-User-Role')
  if (!['Admin', 'Administrator', 'Manager'].includes(userRole || '')) {
    return NextResponse.json(
      { error: 'Hanya Super Admin yang dapat menghapus inventaris' },
      { status: 403 },
    )
  }

  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) {
      return NextResponse.json(
        { error: 'id wajib diisi (via ?id=...)' },
        { status: 400 },
      )
    }

    const client = getLibsql()

    const existingRes = await client.execute({
      sql: `SELECT kodeBarang, namaBarang, jumlahTotal FROM inventory WHERE id = ? LIMIT 1`,
      args: [bind(id)],
    })
    if (existingRes.rows.length === 0) {
      return NextResponse.json(
        { error: 'Barang tidak ditemukan' },
        { status: 404 },
      )
    }
    const existing = existingRes.rows[0] as Record<string, unknown>
    console.warn(`[INVENTORY DELETE] Item deleted: ${String(existing.kodeBarang)} - ${String(existing.namaBarang)}`)

    await client.execute({
      sql: `DELETE FROM inventory WHERE id = ?`,
      args: [bind(id)],
    })

    deferToBackground(invalidateCache('/api/inventory'))

    return NextResponse.json({
      success: true,
      message: `Barang "${String(existing.namaBarang)}" berhasil dihapus`,
    })
  } catch (error) {
    console.error('[INVENTORY DELETE] Error:', error)
    return NextResponse.json(
      { error: 'Failed to delete inventory item' },
      { status: 500 },
    )
  }
}
