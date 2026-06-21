import { db, ensureDbConnection } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { invalidateCache } from '@/lib/edge-cache'

// One-time restore endpoint: restores lost surat records that were not
// migrated to Turso during the Cloudflare Workers migration.
// Admin-only. Idempotent (uses upsert — safe to re-run).

// The 4 surat records recovered from local SQLite (db/custom.db).
// All referenced projects & users verified to exist in production Turso.
const LOST_SURAT_RECORDS = [
  {
    id: 'cmnzmg1210002ia04i5evwekl',
    nomorSurat: 'B-075/Un.14/V.2/PP.06/04/2026',
    jenisSurat: 'Surat Masuk',
    kategori: 'Permohonan',
    tanggalSurat: new Date(1776038400000),
    pengirim: null,
    penerima: null,
    perihal: 'Undangan Sosialisasi dan penandatangan SPK Penelitian Litapdimas tahun 2026',
    deskripsi: null,
    status: 'selesai',
    catatan: null,
    documents: '[]',
    driveFolderId: null,
    driveFolderLink: null,
    location: null,
    executionTime: null,
    picName: null,
    picWhatsApp: null,
    administratorId: 'cmns1gyyo000dl40437riwp5y',
    managerId: 'cmns1gp450001l4048a80ygbs',
    projectId: 'PRJ-139916',
    createdAt: new Date(1776231619417),
    updatedAt: new Date(1776232191777),
  },
  {
    id: 'cmo0ptvuf0000l1047li2gnnj',
    nomorSurat: 'B-075/Un.14/III.4/PP.09/04/2026',
    jenisSurat: 'Surat Masuk',
    kategori: 'Permohonan',
    tanggalSurat: new Date(1776124800000),
    pengirim: 'FDIK',
    penerima: null,
    perihal: 'Mohon Live streaming dan meliput acara',
    deskripsi: null,
    status: 'selesai',
    catatan: null,
    documents: '[{"id":"DOC-1776297791494-o2qf827nt2","name":"Surat_FDIK_Mohon Live streaming dan meliput acara.pdf","originalName":"FDIK - MOHON MELIPUTT HUMAS.pdf","mimeType":"application/pdf","size":236601,"driveFileId":"1M1JD0GKNY-doxGllbV2qayc-mEJuJrDM","webViewLink":"https://drive.google.com/file/d/1M1JD0GKNY-doxGllbV2qayc-mEJuJrDM/view?usp=drivesdk","downloadUrl":"https://drive.google.com/uc?export=download&id=1M1JD0GKNY-doxGllbV2qayc-mEJuJrDM","uploadedAt":"2026-04-16T00:03:11.494Z"}]',
    driveFolderId: '1PQz72IId6pVgh87y0kX7uBIflMT-Ki4d',
    driveFolderLink: 'https://drive.google.com/drive/folders/1PQz72IId6pVgh87y0kX7uBIflMT-Ki4d',
    location: 'Auditorium Mastur Jashri',
    executionTime: '2026-04-16T08:00',
    picName: 'Rahmi',
    picWhatsApp: '082357290563',
    administratorId: 'cmns1gyyo000dl40437riwp5y',
    managerId: 'cmns1gp450001l4048a80ygbs',
    projectId: 'PRJ-399428',
    createdAt: new Date(1776297770872),
    updatedAt: new Date(1776316461403),
  },
  {
    id: 'cmo0pyjyg0000jp04526ch8nf',
    nomorSurat: 'B-340/Un.14/III.3/PP.09/04/2026',
    jenisSurat: 'Surat Masuk',
    kategori: 'Permohonan',
    tanggalSurat: new Date(1775520000000),
    pengirim: 'FUH',
    penerima: null,
    perihal: 'Mohon Liputan',
    deskripsi: 'mohon liputan acara yudisium',
    status: 'selesai',
    catatan: null,
    documents: '[{"id":"DOC-1776298003428-jtwg913ekz","name":"Surat_FUH_Mohon Liputan.pdf","originalName":"FUH-UNDANGAN LIPUTAN HUMAS.pdf","mimeType":"application/pdf","size":565827,"driveFileId":"198W6WP_X-15_JtJ2s0LxXWMQRaT2S0Ok","webViewLink":"https://drive.google.com/file/d/198W6WP_X-15_JtJ2s0LxXWMQRaT2S0Ok/view?usp=drivesdk","downloadUrl":"https://drive.google.com/uc?export=download&id=198W6WP_X-15_JtJ2s0Ok","uploadedAt":"2026-04-16T00:06:43.428Z"}]',
    driveFolderId: '1gnhiMzv0-qJ9mJiUrR5WFWF3b0deYbYj',
    driveFolderLink: 'https://drive.google.com/drive/folders/1gnhiMzv0-qJ9mJiUrR5WFWF3b0deYbYj',
    location: 'Auditorium Mastur Jashri',
    executionTime: '2026-04-20T08:05',
    picName: 'Nurul',
    picWhatsApp: '087515958807',
    administratorId: 'cmns1gyyo000dl40437riwp5y',
    managerId: 'cmns1gp450001l4048a80ygbs',
    projectId: 'PRJ-716418',
    createdAt: new Date(1776297988745),
    updatedAt: new Date(1776316780042),
  },
  {
    id: 'cmo13gr0v0000js04q5xtrsky',
    nomorSurat: 'B-765/Un.14/I.1/HM.03/04/2026',
    jenisSurat: 'Surat Masuk',
    kategori: 'Permohonan',
    tanggalSurat: new Date(1776297600000),
    pengirim: 'Bagian Umum',
    penerima: null,
    perihal: 'Apel Kesadaran Nasional',
    deskripsi: 'Apel',
    status: 'selesai',
    catatan: null,
    documents: '[]',
    driveFolderId: null,
    driveFolderLink: null,
    location: 'Halaman Gedung PSB',
    executionTime: '2026-04-17T14:23',
    picName: null,
    picWhatsApp: null,
    administratorId: 'cmns1gyyo000dl40437riwp5y',
    managerId: 'cmns1gp450001l4048a80ygbs',
    projectId: 'PRJ-431165',
    createdAt: new Date(1776320672719),
    updatedAt: new Date(1776321499743),
  },
]

export async function POST(request: NextRequest) {
  // Admin-only
  const userRole = request.headers.get('X-User-Role')
  if (userRole !== 'Admin') {
    return NextResponse.json({ error: 'Hanya Super Admin yang dapat menjalankan restore' }, { status: 403 })
  }

  try {
    const isConnected = await ensureDbConnection()
    if (!isConnected) {
      return NextResponse.json({ error: 'Database connection failed' }, { status: 500 })
    }

    // Check current count
    const beforeCount = await db.surat.count()

    let restored = 0
    let skipped = 0
    const errors: string[] = []

    for (const record of LOST_SURAT_RECORDS) {
      try {
        // Check if record already exists (by id or nomorSurat)
        const existing = await db.surat.findFirst({
          where: {
            OR: [
              { id: record.id },
              { nomorSurat: record.nomorSurat },
            ],
          },
        })
        if (existing) {
          skipped++
          continue
        }
        await db.surat.create({ data: record })
        restored++
      } catch (e) {
        errors.push(`${record.nomorSurat}: ${e instanceof Error ? e.message : 'Unknown error'}`)
      }
    }

    const afterCount = await db.surat.count()

    // Invalidate surat cache so the frontend sees restored data immediately
    await invalidateCache('/api/surat')

    return NextResponse.json({
      success: true,
      beforeCount,
      restored,
      skipped,
      afterCount,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (error) {
    console.error('Restore surat error:', error)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: 'Failed to restore surat', details: msg }, { status: 500 })
  }
}
