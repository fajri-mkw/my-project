import { NextRequest, NextResponse } from 'next/server'
import { getLibsql, bind } from '@/lib/libsql-client'
import { invalidateCache, deferToBackground } from '@/lib/edge-cache'

// ============================================================================
// POST /api/lihum/publish — Publikasikan folder 3 (PUBLIC/UMUM) project ke galeri LIHUM
//
// Membuat gallery baru di LIHUM (https://lihum.synclicen.workers.dev) yang
// menampilkan foto dari folder 3 (PUBLIC/UMUM) project Pushakin Flows.
//
// PENTING: HANYA folder 3 (PUBLIC/UMUM) yang dipublikasikan ke LIHUM.
// Folder 4 (PRIVATE/RAHASIA) TIDAK PERNAK di-share ke LIHUM — itu tujuan
// folder tersebut: foto rahasia yang hanya simpan di Drive, tidak untuk publik.
//
// Petugas Tahap 1 bertanggung jawab memfilter foto saat upload:
//   - Foto yang BOLEH dibagi publik → upload ke folder 3 (PUBLIC/UMUM)
//   - Foto yang TIDAK boleh dibagi → upload ke folder 4 (PRIVATE/RAHASIA)
//
// Manager klik "Publikasikan ke LIHUM" → gallery otomatis dibuat dari folder 3.
// Foto di folder 4 tetap aman di Drive, tidak pernah tampil di LIHUM.
//
// FLOW:
// 1. Manager klik "Publikasikan ke LIHUM" di project detail
// 2. Frontend POST /api/lihum/publish { projectId }
// 3. Backend cari folder 3 (folderId='public') di drive_folders table
// 4. Backend POST ke LIHUM API /api/projects dengan:
//    - name = project.title
//    - driveFolderUrl = folder 3 (PUBLIC/UMUM) webViewLink
//    - visibility = "public" (selalu — folder 4 tidak pernah dikirim)
// 5. Backend simpan lihumGalleryId di projects table untuk tracking
// 6. Return lihumGalleryId + share URL ke frontend
//
// AUTH KE LIHUM:
// LIHUM pakai header "x-user-email" — email harus terdaftar sebagai admin/
// manager di Account table LIHUM. Kita pakai email manager yang sedang login
// (dari X-User-Id → cari email di users table). Kalau email manager belum
// terdaftar di LIHUM, return error yang jelas.
//
// LIMIT SAFETY:
// - 1 HTTP request ke LIHUM API (subrequest rendah — aman dari Error 1102)
// - 1 DB query untuk cari folder 3 (PUBLIC)
// - 1 DB query untuk update lihumGalleryId
// - Total: ~3 subrequests, jauh di bawah 50 limit
// ============================================================================

interface DriveFolderRow {
  folderId: string
  link: string | null
  name: string
}

interface UserRow {
  email: string
  name: string
  role: string
}

interface LihumCreateResponse {
  id?: string
  error?: string
  warning?: string
}

const LIHUM_BASE = 'https://lihum.synclicen.workers.dev'

export async function POST(request: NextRequest) {
  const userRole = request.headers.get('X-User-Role')
  if (!['Admin', 'Administrator', 'Manager'].includes(userRole || '')) {
    return NextResponse.json({ error: 'Hanya Manager/Admin yang dapat mempublikasikan ke LIHUM' }, { status: 403 })
  }

  try {
    const body = await request.json()
    const { projectId } = body as { projectId?: string }

    if (!projectId) {
      return NextResponse.json({ error: 'projectId wajib diisi' }, { status: 400 })
    }

    const client = getLibsql()

    // 1. Cari user email yang sedang login (untuk auth ke LIHUM via x-user-email)
    const userId = request.headers.get('X-User-Id')
    if (!userId) {
      return NextResponse.json({ error: 'User ID tidak ditemukan di header' }, { status: 400 })
    }

    const userRes = await client.execute({
      sql: `SELECT email, name, role FROM users WHERE id = ? LIMIT 1`,
      args: [bind(userId)],
    })
    if (userRes.rows.length === 0) {
      return NextResponse.json({ error: 'User tidak ditemukan' }, { status: 404 })
    }
    const user = userRes.rows[0] as unknown as UserRow
    const userEmail = String(user.email || '')

    if (!userEmail) {
      return NextResponse.json({
        error: 'Email user tidak ditemukan. Hubungi Super Admin untuk set email di profil Anda.',
      }, { status: 400 })
    }

    // 2. Cari project + folder PUBLIC di drive_folders
    const projectRes = await client.execute({
      sql: `SELECT p.id, p.title, p.description, p.executionTime, p.lihumGalleryId
            FROM projects p WHERE p.id = ? LIMIT 1`,
      args: [bind(projectId)],
    })
    if (projectRes.rows.length === 0) {
      return NextResponse.json({ error: 'Project tidak ditemukan' }, { status: 404 })
    }

    const project = projectRes.rows[0] as Record<string, unknown>
    const existingLihumId = String(project.lihumGalleryId || '')

    // Jika sudah pernah publish ke LIHUM, return info yang ada (idempotent)
    if (existingLihumId) {
      return NextResponse.json({
        success: true,
        lihumGalleryId: existingLihumId,
        lihumUrl: `${LIHUM_BASE}/?gallery=${existingLihumId}`,
        message: 'Project sudah pernah dipublikasikan ke LIHUM',
        alreadyPublished: true,
      })
    }

    // 3. Cari folder PUBLIC di drive_folders project ini
    const folderRes = await client.execute({
      sql: `SELECT folderId, link, name FROM drive_folders
            WHERE projectId = ? AND folderId = 'public' AND parentFolderId IS NULL
            LIMIT 1`,
      args: [bind(projectId)],
    })

    let publicFolder: DriveFolderRow | null = null
    if (folderRes.rows.length > 0) {
      const row = folderRes.rows[0] as Record<string, unknown>
      publicFolder = {
        folderId: String(row.folderId || ''),
        link: (row.link as string) || null,
        name: String(row.name || ''),
      }
    }

    if (!publicFolder || !publicFolder.link) {
      return NextResponse.json({
        error: 'Folder PUBLIC tidak ditemukan untuk project ini. Pastikan folder PUBLIC/UMUM sudah dibuat saat inisiasi proyek.',
      }, { status: 400 })
    }

    // 4. Convert link Drive ke format folder URL untuk LIHUM
    // publicFolder.link biasanya format: https://drive.google.com/file/d/XXX/view
    // atau https://drive.google.com/drive/folders/XXX
    // LIHUM butuh: https://drive.google.com/drive/folders/XXX
    let driveFolderUrl = publicFolder.link
    // Extract folder ID dari berbagai format URL Drive
    const folderIdMatch = driveFolderUrl.match(/\/folders\/([^?/]+)/) || driveFolderUrl.match(/\/file\/d\/([^?/]+)/) || driveFolderUrl.match(/[?&]id=([^&]+)/)
    if (folderIdMatch) {
      driveFolderUrl = `https://drive.google.com/drive/folders/${folderIdMatch[1]}`
    }

    // 5. POST ke LIHUM API untuk buat gallery baru
    const lihumResponse = await fetch(`${LIHUM_BASE}/api/projects`, {
      method: 'POST',
      headers: {
        'x-user-email': userEmail,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: String(project.title || 'Untitled'),
        description: String(project.description || ''),
        driveFolderUrl,
        displayMode: 'all',
        // Selalu 'public' — gallery LIHUM hanya untuk folder 3 (PUBLIC/UMUM).
        // Folder 4 (PRIVATE/RAHASIA) tidak pernah di-share ke LIHUM.
        visibility: 'public',
      }),
    })

    if (!lihumResponse.ok) {
      const errData = await lihumResponse.json().catch(() => ({})) as LihumCreateResponse
      const errMsg = errData.error || `HTTP ${lihumResponse.status}`
      // Jika error karena email belum terdaftar di LIHUM, beri panduan jelas
      if (errMsg.includes('Akses ditolak') || errMsg.includes('Admin Utama')) {
        return NextResponse.json({
          error: `Email Anda (${userEmail}) belum terdaftar sebagai pengelola di LIHUM. Hubungi pemilik LIHUM (synclicen@gmail.com) untuk mendaftarkan email Anda sebagai manager.`,
        }, { status: 403 })
      }
      return NextResponse.json({
        error: `Gagal membuat gallery di LIHUM: ${errMsg}`,
      }, { status: 502 })
    }

    const lihumData = await lihumResponse.json() as LihumCreateResponse
    const lihumGalleryId = lihumData.id

    if (!lihumGalleryId) {
      return NextResponse.json({
        error: 'LIHUM tidak mengembalikan gallery ID. Coba lagi.',
      }, { status: 502 })
    }

    // 6. Simpan lihumGalleryId di projects table
    try {
      await client.execute({
        sql: `UPDATE projects SET lihumGalleryId = ?, updatedAt = ? WHERE id = ?`,
        args: [bind(lihumGalleryId), bind(Date.now()), bind(projectId)],
      })
    } catch (updateErr) {
      // Kalau kolom lihumGalleryId belum ada, return success tapi sarankan jalankan migration
      console.error('[LIHUM PUBLISH] Failed to save lihumGalleryId:', updateErr)
      return NextResponse.json({
        success: true,
        lihumGalleryId,
        lihumUrl: `${LIHUM_BASE}/?gallery=${lihumGalleryId}`,
        warning: 'Gallery berhasil dibuat di LIHUM, tapi gagal simpan ID ke database. Jalankan /api/migrate-lihum-field untuk menambah kolom lihumGalleryId.',
      })
    }

    // Invalidate cache supaya next GET /api/projects bawa lihumGalleryId baru
    deferToBackground(invalidateCache('/api/projects'))

    return NextResponse.json({
      success: true,
      lihumGalleryId,
      lihumUrl: `${LIHUM_BASE}/?gallery=${lihumGalleryId}`,
      warning: lihumData.warning,
      message: 'Gallery berhasil dibuat di LIHUM. Link siap dibagikan atau di-embed.',
    })
  } catch (error) {
    console.error('[LIHUM PUBLISH] Error:', error)
    return NextResponse.json({
      error: 'Gagal mempublikasikan ke LIHUM',
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 })
  }
}

// ============================================================================
// GET /api/lihum/publish?projectId=XXX — cek status publikasi LIHUM project
// ============================================================================
export async function GET(request: NextRequest) {
  const userRole = request.headers.get('X-User-Role')
  if (!['Admin', 'Administrator', 'Manager'].includes(userRole || '')) {
    return NextResponse.json({ error: 'Hanya Manager/Admin' }, { status: 403 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get('projectId')
    if (!projectId) return NextResponse.json({ error: 'projectId wajib diisi' }, { status: 400 })

    const client = getLibsql()
    const res = await client.execute({
      sql: `SELECT lihumGalleryId FROM projects WHERE id = ? LIMIT 1`,
      args: [bind(projectId)],
    })

    if (res.rows.length === 0) {
      return NextResponse.json({ error: 'Project tidak ditemukan' }, { status: 404 })
    }

    const lihumGalleryId = String((res.rows[0] as Record<string, unknown>).lihumGalleryId || '')

    return NextResponse.json({
      published: !!lihumGalleryId,
      lihumGalleryId: lihumGalleryId || null,
      lihumUrl: lihumGalleryId ? `${LIHUM_BASE}/?gallery=${lihumGalleryId}` : null,
    })
  } catch (error) {
    return NextResponse.json({ error: 'Gagal cek status LIHUM' }, { status: 500 })
  }
}
