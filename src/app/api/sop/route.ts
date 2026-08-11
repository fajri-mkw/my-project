import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'
import { withEdgeCache, invalidateCache } from '@/lib/edge-cache'
import {
  getLibsql,
  toBool,
  bind,
  genId,
  nowMs,
  toDateISO,
  type InValue,
} from '@/lib/libsql-client'

// ============================================================================
// SOP / Pengumuman / Panduan CRUD route.
//
// Rewritten to use @libsql/client directly (bypasses Prisma CPU overhead) —
// same pattern as src/app/api/maintenance/route.ts and src/app/api/users/route.ts.
// The Prisma import (`db` + `ensureDbConnection`) caused Cloudflare Workers
// Error 1102 (Worker exceeded resource limits) on cold starts because loading
// Prisma's WASM module + running ensureSchemaSync() burned too much CPU on the
// Workers free plan (10ms CPU limit).
//
// RESPONSE SHAPE: Matches the original Prisma `findMany({ include: author })`
// shape exactly so the frontend (AnnouncementView) doesn't need to change:
//   {
//     id, title, content, type, displayMode, files (string|null),
//     slideshowSpeed, published, order, authorId, createdAt, updatedAt,
//     author: { id, name, email, role }
//   }
// ============================================================================

interface SOPAuthorDTO {
  id: string
  name: string
  email: string
  role: string
}

interface SOPDTO {
  id: string
  title: string
  content: string
  type: string
  displayMode: string
  files: string | null
  slideshowSpeed: number
  published: boolean
  order: number
  authorId: string
  createdAt: string
  updatedAt: string
  author: SOPAuthorDTO
}

// Build the SELECT clause for sops + LEFT JOIN users. Use DISTINCT aliases
// (a.* for author columns) so libsql's row objects have predictable keys.
// NOTE: `order` is a reserved word in SQLite — escape it with backticks.
const SOP_SELECT = `
  s.id              AS id,
  s.title           AS title,
  s.content         AS content,
  s.type            AS type,
  s.displayMode     AS displayMode,
  s.files           AS files,
  s.slideshowSpeed  AS slideshowSpeed,
  s.published       AS published,
  s.\`order\`        AS \`order\`,
  s.authorId        AS authorId,
  s.createdAt       AS createdAt,
  s.updatedAt       AS updatedAt,
  u.id              AS a_id,
  u.name            AS a_name,
  u.email           AS a_email,
  u.role            AS a_role
`

// Map a joined row to the DTO the frontend expects. `authorId` in the DTO
// comes from the SOP row (s.authorId), not from the joined user row — they
// would only differ if FK integrity were broken, but we always read the SOP.
function mapSopWithAuthor(r: Record<string, unknown>): SOPDTO {
  return {
    id: String(r.id ?? ''),
    title: String(r.title ?? ''),
    content: String(r.content ?? ''),
    type: String(r.type ?? 'SOP'),
    displayMode: String(r.displayMode ?? 'text'),
    files:
      r.files === null || r.files === undefined ? null : String(r.files),
    slideshowSpeed: Number(r.slideshowSpeed ?? 5000),
    published: toBool(r.published),
    order: Number(r.order ?? 0),
    authorId: String(r.authorId ?? ''),
    createdAt: toDateISO(r.createdAt),
    updatedAt: toDateISO(r.updatedAt),
    author: {
      id: String(r.authorId ?? ''), // mirror Prisma: author.id === authorId
      name: String(r.a_name ?? ''),
      email: String(r.a_email ?? ''),
      role: String(r.a_role ?? 'Reporter'),
    },
  }
}

const VALID_TYPES = ['SOP', 'Pengumuman', 'Panduan'] as const
const VALID_DISPLAY_MODES = ['text', 'static', 'slideshow', 'pdf'] as const

const SOP_FROM_CLAUSE = `FROM sops s LEFT JOIN users u ON u.id = s.authorId`

// ----------------------------------------------------------------------------
// GET - Fetch all SOPs/Pengumuman/Panduan (with optional filters).
// Edge-cached for 300s (5 min) — SOPs rarely change.
// ----------------------------------------------------------------------------
export const GET = withEdgeCache(async (request: NextRequest) => {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') // SOP, Pengumuman, Panduan
    const published = searchParams.get('published')

    const conditions: string[] = []
    const args: InValue[] = []

    if (type && VALID_TYPES.includes(type as (typeof VALID_TYPES)[number])) {
      conditions.push('s.type = ?')
      args.push(bind(type))
    }
    if (published === 'true') {
      conditions.push('s.published = 1')
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const client = getLibsql()
    const result = await client.execute({
      sql: `SELECT ${SOP_SELECT} ${SOP_FROM_CLAUSE} ${whereClause}
            ORDER BY s.\`order\` ASC, s.createdAt DESC`,
      args: args.map((a) => bind(a)),
    })

    const sops = result.rows.map((row) =>
      mapSopWithAuthor(row as Record<string, unknown>),
    )

    return NextResponse.json(sops)
  } catch (error) {
    console.error('Error fetching SOPs:', error)
    return NextResponse.json(
      { error: 'Gagal mengambil data' },
      { status: 500 },
    )
  }
}, { ttl: 300 })

// ----------------------------------------------------------------------------
// POST - Create a new SOP/Pengumuman/Panduan.
// Body shape (matches frontend AnnouncementView):
//   { title, content, type?, displayMode?, files?, slideshowSpeed?,
//     published?, order?, authorId }
// ----------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const body = await request.json()
    const {
      title,
      content,
      type = 'SOP',
      displayMode = 'text',
      files,
      slideshowSpeed = 5000,
      published = false,
      order = 0,
      authorId,
    } = body as {
      title?: string
      content?: string
      type?: string
      displayMode?: string
      files?: unknown
      slideshowSpeed?: number
      published?: boolean
      order?: number
      authorId?: string
    }

    if (!title || !content || !authorId) {
      return NextResponse.json(
        { error: 'Judul, konten, dan author wajib diisi' },
        { status: 400 },
      )
    }

    const safeType = VALID_TYPES.includes(type as (typeof VALID_TYPES)[number])
      ? type
      : 'SOP'
    const safeDisplayMode = VALID_DISPLAY_MODES.includes(
      displayMode as (typeof VALID_DISPLAY_MODES)[number],
    )
      ? displayMode
      : 'text'
    const safeFiles =
      files !== undefined && files !== null
        ? JSON.stringify(files)
        : null

    const id = genId()
    const ts = nowMs()

    const client = getLibsql()
    await client.execute({
      sql: `INSERT INTO sops
            (id, title, content, type, displayMode, files, slideshowSpeed,
             published, \`order\`, authorId, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        bind(id),
        bind(title),
        bind(content),
        bind(safeType),
        bind(safeDisplayMode),
        bind(safeFiles),
        bind(Number(slideshowSpeed) || 5000),
        bind(published ? 1 : 0),
        bind(Number(order) || 0),
        bind(authorId),
        bind(ts),
        bind(ts),
      ],
    })

    // Re-fetch the row + its author to mirror Prisma's `create({ include: author })`.
    const selRes = await client.execute({
      sql: `SELECT ${SOP_SELECT} ${SOP_FROM_CLAUSE} WHERE s.id = ? LIMIT 1`,
      args: [bind(id)],
    })
    if (selRes.rows.length === 0) {
      // Insert succeeded but row not found — extremely unlikely. Return a
      // minimal object built from the request to avoid breaking the caller.
      return NextResponse.json({
        id,
        title,
        content,
        type: safeType,
        displayMode: safeDisplayMode,
        files: safeFiles,
        slideshowSpeed: Number(slideshowSpeed) || 5000,
        published: !!published,
        order: Number(order) || 0,
        authorId,
        createdAt: new Date(ts).toISOString(),
        updatedAt: new Date(ts).toISOString(),
        author: { id: authorId, name: '', email: '', role: 'Reporter' },
      })
    }

    await invalidateCache('/api/sop')
    return NextResponse.json(
      mapSopWithAuthor(selRes.rows[0] as Record<string, unknown>),
    )
  } catch (error) {
    console.error('Error creating SOP:', error)
    return NextResponse.json(
      { error: 'Gagal membuat data' },
      { status: 500 },
    )
  }
}

// ----------------------------------------------------------------------------
// PUT - Update an existing SOP/Pengumuman/Panduan.
// Body shape: { id, ...fieldsToUpdate }
// ----------------------------------------------------------------------------
export async function PUT(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const body = await request.json()
    const { id, ...data } = body as {
      id?: string
      title?: string
      content?: string
      type?: string
      displayMode?: string
      files?: unknown
      slideshowSpeed?: number
      published?: boolean
      order?: number
    }

    if (!id) {
      return NextResponse.json(
        { error: 'ID wajib diisi' },
        { status: 400 },
      )
    }

    const sets: string[] = []
    const args: InValue[] = []

    if (data.title) {
      sets.push('title = ?')
      args.push(bind(data.title))
    }
    if (data.content) {
      sets.push('content = ?')
      args.push(bind(data.content))
    }
    if (
      data.type &&
      VALID_TYPES.includes(data.type as (typeof VALID_TYPES)[number])
    ) {
      sets.push('type = ?')
      args.push(bind(data.type))
    }
    if (
      data.displayMode &&
      VALID_DISPLAY_MODES.includes(
        data.displayMode as (typeof VALID_DISPLAY_MODES)[number],
      )
    ) {
      sets.push('displayMode = ?')
      args.push(bind(data.displayMode))
    }
    if (data.files !== undefined) {
      sets.push('files = ?')
      args.push(
        bind(data.files !== null ? JSON.stringify(data.files) : null),
      )
    }
    if (data.slideshowSpeed !== undefined) {
      sets.push('slideshowSpeed = ?')
      args.push(bind(Number(data.slideshowSpeed) || 5000))
    }
    if (data.published !== undefined) {
      sets.push('published = ?')
      args.push(bind(data.published ? 1 : 0))
    }
    if (data.order !== undefined) {
      sets.push('`order` = ?')
      args.push(bind(Number(data.order) || 0))
    }

    const client = getLibsql()

    if (sets.length === 0) {
      // Nothing to update — still re-fetch and return so the caller gets a
      // consistent response shape (matching the original Prisma behavior).
      const existing = await client.execute({
        sql: `SELECT ${SOP_SELECT} ${SOP_FROM_CLAUSE} WHERE s.id = ? LIMIT 1`,
        args: [bind(id)],
      })
      if (existing.rows.length === 0) {
        return NextResponse.json(
          { error: 'Data tidak ditemukan' },
          { status: 404 },
        )
      }
      return NextResponse.json(
        mapSopWithAuthor(existing.rows[0] as Record<string, unknown>),
      )
    }

    sets.push('updatedAt = ?')
    args.push(bind(nowMs()))
    args.push(bind(id))

    await client.execute({
      sql: `UPDATE sops SET ${sets.join(', ')} WHERE id = ?`,
      args,
    })

    // Re-fetch with author — mirrors Prisma's `update({ include: author })`.
    const selRes = await client.execute({
      sql: `SELECT ${SOP_SELECT} ${SOP_FROM_CLAUSE} WHERE s.id = ? LIMIT 1`,
      args: [bind(id)],
    })
    if (selRes.rows.length === 0) {
      return NextResponse.json(
        { error: 'Data tidak ditemukan' },
        { status: 404 },
      )
    }

    await invalidateCache('/api/sop')
    return NextResponse.json(
      mapSopWithAuthor(selRes.rows[0] as Record<string, unknown>),
    )
  } catch (error) {
    console.error('Error updating SOP:', error)
    return NextResponse.json(
      { error: 'Gagal mengupdate data' },
      { status: 500 },
    )
  }
}

// ----------------------------------------------------------------------------
// DELETE - Delete an SOP/Pengumuman/Panduan by id (query param).
// ----------------------------------------------------------------------------
export async function DELETE(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { error: 'ID wajib diisi' },
        { status: 400 },
      )
    }

    const client = getLibsql()
    await client.execute({
      sql: `DELETE FROM sops WHERE id = ?`,
      args: [bind(id)],
    })

    await invalidateCache('/api/sop')
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting SOP:', error)
    return NextResponse.json(
      { error: 'Gagal menghapus data' },
      { status: 500 },
    )
  }
}
