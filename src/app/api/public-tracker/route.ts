import { NextRequest, NextResponse } from 'next/server'
import {
  getLibsql,
  toDateISO,
  bind,
  parseJSON,
  executeWhereIn,
} from '@/lib/libsql-client'

// ============================================================================
// GET - Public tracker: all projects with tasks + assignees + managers.
//
// REWRITTEN from Prisma to @libsql/client directly (2026-08-17).
//
// ROOT CAUSE of "Internal server error" on ?public=tracker:
//   The previous version used `import { db, ensureDbConnection } from '@/lib/db'`
//   (Prisma). On Cloudflare Workers free plan, Prisma's WASM engine +
//   `db.project.findMany({ include: { tasks: { include: { assignee } }, manager } })`
//   generates nested-relation SQL + heavy client-side mapping that exceeds the
//   10ms CPU limit (and/or hits a WASM runtime error), causing a 500.
//
//   This is the SAME class of bug that was already fixed in:
//     - /api/surat/route.ts (surat list)
//     - /api/projects/route.ts (projects list)
//     - /api/users/route.ts
//     - /api/maintenance/route.ts
//   The public-tracker route was missed during that migration.
//
// FIX: 3 flat SQL queries (projects, tasks, users) joined in JS — bypasses
//   Prisma's nested-relation SQL generation + type-mapping CPU overhead.
//   Network I/O (waiting for D1) is free on Workers; only CPU counts.
//
// RESPONSE SHAPE (unchanged — matches the original Prisma response exactly
//   so the frontend `PublicTrackerView` needs zero changes):
//   {
//     projects: PublicProject[],   // with nested tasks[].assignee + manager
//     stats: { total, completed, active },
//     filter: string,
//     lastUpdated: ISO string
//   }
// ============================================================================

/** Convert a nullable SQLite cell to string | null. */
function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v)
  return s === '' ? null : s
}

export async function GET(request: NextRequest) {
  try {
    const client = getLibsql()
    const { searchParams } = new URL(request.url)
    const timeFilter = searchParams.get('filter') || 'all'

    // Calculate date range based on filter (epoch-ms, matches Prisma's SQLite
    // DateTime storage as INTEGER).
    const now = new Date()
    let dateFilterMs: number | null = null

    switch (timeFilter) {
      case 'day':
        dateFilterMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
        break
      case 'week':
        dateFilterMs = now.getTime() - 7 * 24 * 60 * 60 * 1000
        break
      case 'month':
        dateFilterMs = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
        break
      case 'year':
        dateFilterMs = new Date(now.getFullYear(), 0, 1).getTime()
        break
      default:
        dateFilterMs = null
        // 'all' and 'active' → no date filter (active is filtered client-side
        // by currentStage < 5, see public-tracker-view.tsx line ~349).
    }

    // 1) Fetch projects (newest-modified first — harmonized with Dashboard &
    //    Statistik views so the public tracker shows the same order).
    const projectsRes = dateFilterMs !== null
      ? await client.execute({
          sql: `SELECT id, title, description, requesterUnit, location, executionTime,
                       picName, picWhatsApp, currentStage, publicToken,
                       managerId, createdAt, updatedAt
                FROM projects
                WHERE createdAt >= ?
                ORDER BY updatedAt DESC, createdAt DESC`,
          args: [bind(dateFilterMs)],
        })
      : await client.execute({
          sql: `SELECT id, title, description, requesterUnit, location, executionTime,
                       picName, picWhatsApp, currentStage, publicToken,
                       managerId, createdAt, updatedAt
                FROM projects
                ORDER BY updatedAt DESC, createdAt DESC`,
          args: [],
        })

    const projectIds: string[] = projectsRes.rows.map((r) => String((r as Record<string, unknown>).id))

    // 2) Fetch tasks for all projects (chunked via executeWhereIn to respect
    //    D1's 100-SQL-variable hard limit).
    let tasksByProject = new Map<string, Array<Record<string, unknown>>>()
    if (projectIds.length > 0) {
      const tasksRes = await executeWhereIn(
        client,
        `SELECT id, role, stage, status, data, assignedTo, projectId
         FROM tasks
         WHERE projectId IN (__IN_PLACE__)`,
        projectIds,
      )
      for (const row of tasksRes.rows) {
        const r = row as Record<string, unknown>
        const pid = String(r.projectId)
        if (!tasksByProject.has(pid)) tasksByProject.set(pid, [])
        tasksByProject.get(pid)!.push(r)
      }
    }

    // 3) Fetch all referenced users (assignees + managers) in ONE query.
    //    Collect unique user IDs from task.assignedTo and project.managerId.
    const userIdSet = new Set<string>()
    for (const p of projectsRes.rows) {
      const pr = p as Record<string, unknown>
      const mgrId = strOrNull(pr.managerId)
      if (mgrId) userIdSet.add(mgrId)
    }
    for (const taskList of tasksByProject.values()) {
      for (const t of taskList) {
        const assigneeId = strOrNull(t.assignedTo)
        if (assigneeId) userIdSet.add(assigneeId)
      }
    }
    const userIds = Array.from(userIdSet)

    const usersById = new Map<string, { id: string; name: string; avatar: string | null; role: string }>()
    if (userIds.length > 0) {
      const usersRes = await executeWhereIn(
        client,
        `SELECT id, name, avatar, role
         FROM users
         WHERE id IN (__IN_PLACE__)`,
        userIds,
      )
      for (const row of usersRes.rows) {
        const r = row as Record<string, unknown>
        const uid = String(r.id)
        usersById.set(uid, {
          id: uid,
          name: String(r.name ?? ''),
          avatar: strOrNull(r.avatar),
          role: String(r.role ?? 'Reporter'),
        })
      }
    }

    // 4) Assemble the response — nested structure matching the original
    //    Prisma `include` shape exactly.
    const projects = projectsRes.rows.map((p) => {
      const pr = p as Record<string, unknown>
      const pid = String(pr.id)
      const rawTasks = tasksByProject.get(pid) || []
      const managerId = strOrNull(pr.managerId)
      const manager = (managerId && usersById.get(managerId)) || {
        id: managerId || '',
        name: 'Manager tidak ditemukan',
        avatar: null,
      }

      const tasks = rawTasks.map((t) => {
        const assigneeId = strOrNull(t.assignedTo)
        const assignee = (assigneeId && usersById.get(assigneeId)) || {
          id: assigneeId || '',
          name: 'Petugas tidak ditemukan',
          avatar: null,
          role: 'Reporter',
        }
        return {
          id: String(t.id ?? ''),
          role: String(t.role ?? ''),
          stage: Number(t.stage ?? 0),
          status: String(t.status ?? 'pending'),
          // `data` is returned as a raw string (matching the original Prisma
          // behavior and the PublicTask interface). Frontend parses it if needed.
          data: strOrNull(t.data),
          assignee,
        }
      })

      return {
        id: pid,
        title: String(pr.title ?? ''),
        description: String(pr.description ?? ''),
        requesterUnit: String(pr.requesterUnit ?? ''),
        location: strOrNull(pr.location),
        executionTime: strOrNull(pr.executionTime),
        picName: strOrNull(pr.picName),
        picWhatsApp: strOrNull(pr.picWhatsApp),
        currentStage: Number(pr.currentStage ?? 1),
        publicToken: strOrNull(pr.publicToken),
        createdAt: toDateISO(pr.createdAt),
        updatedAt: toDateISO(pr.updatedAt),
        tasks,
        manager,
      }
    })

    // 5) Calculate statistics (matches original: completed = currentStage === 5)
    const totalProjects = projects.length
    const completedProjects = projects.filter((p) => p.currentStage === 5).length
    const activeProjects = totalProjects - completedProjects

    return NextResponse.json({
      projects,
      stats: {
        total: totalProjects,
        completed: completedProjects,
        active: activeProjects,
      },
      filter: timeFilter,
      lastUpdated: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Error fetching public tracker:', error)
    const details = error instanceof Error
      ? { message: error.message, name: error.name, stack: error.stack?.split('\n').slice(0, 5).join(' | ') }
      : { message: String(error) }
    return NextResponse.json(
      { error: 'Internal server error', details },
      { status: 500 },
    )
  }
}
