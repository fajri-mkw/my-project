import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'
import { sendTaskAssignmentNotification } from '@/lib/notification-service'
import { withEdgeCache, invalidateCache } from '@/lib/edge-cache'
import {
  getLibsql,
  toBool,
  toDateISO,
  parseJSON,
  bind,
  genId,
  nowMs,
  executeWhereIn,
  type InStatement,
} from '@/lib/libsql-client'

// ============================================================================
// ROLE_DISPLAY_NAMES + getRoleDisplayName are inlined here (instead of imported
// from @/lib/store) because @/lib/store imports zustand + zustand/middleware
// at module-load time. On Cloudflare Workers, dragging zustand into a server
// route adds unnecessary module-load CPU. This route is hit on every project
// list/refetch, so keeping it lean matters.
// ============================================================================
const ROLE_DISPLAY_NAMES: Record<string, string> = {
  'Admin': 'Super Admin',
  'Administrator': 'Administrator',
  'Manager': 'Manager',
  'Reporter': 'Reporter',
  'ContentCreator': 'Content Creator',
  'PhotographerVideographerAudio': 'Photographer, Videographer, dan Audio',
  'EditorVideo': 'Editor (Video)',
  'EditorWebArticle': 'Editor (Web Article/Author)',
  'EditorFoto': 'Editor (Foto)',
  'EditorTemplateSosialMedia': 'Editor (Template Sosial Media)',
  'GraphicDesigner': 'Graphic Designer',
  'StreamingOperator': 'Streaming Operator',
  'PodcastOperator': 'Podcast Operator',
  'Reviewer': 'Reviewer',
  'PublisherWeb': 'Publisher Web',
  'PublisherSocialMedia': 'Publisher Social Media',
}
function getRoleDisplayName(role: string): string {
  return ROLE_DISPLAY_NAMES[role] || role
}

// ============================================================================
// ROLE_CANONICAL_STAGE — inline copy of ROLE_CONFIG[role].stage from @/lib/store.
// Used to clamp task.stage saat create project, agar tidak pernah ada task dengan
// stage yang tidak sesuai perannya (defensive against client-side bugs / corrupt
// payloads). Lihat fix V10 migration di src/lib/db-sync.ts untuk konteks lengkap.
// ============================================================================
const ROLE_CANONICAL_STAGE: Record<string, number> = {
  'Reporter': 1,
  'ContentCreator': 1,
  'PhotographerVideographerAudio': 1,
  'GraphicDesigner': 1,
  'EditorVideo': 2,
  'EditorWebArticle': 2,
  'EditorFoto': 2,
  'EditorTemplateSosialMedia': 2,
  'StreamingOperator': 2,
  'PodcastOperator': 2,
  'Reviewer': 3,
  'PublisherWeb': 4,
  'PublisherSocialMedia': 4,
}

// ============================================================================
// GET all projects with relations (tasks + driveFolders)
// Rewritten to use @libsql/client directly (bypasses Prisma CPU overhead).
// Edge-cached for 60s to reduce CPU usage on Workers free plan.
//
// Optimization vs. original: 3 flat queries (projects, tasks, drive_folders)
// joined in JS — avoids Prisma's nested-relation SQL generation + mapping CPU.
// ============================================================================
// NOTE: includeQuery: false — the projects API returns ALL projects
// (filtering by userId/role happens client-side). Using a single cache
// key (no query params) means invalidateCache('/api/projects') actually
// busts the cache. With includeQuery: true (default), each user gets
// their own cache entry and invalidateCache only deletes the base key
// (which is never used) — stale data persists for 60s.
export const GET = withEdgeCache(async (request: NextRequest) => {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock

  try {
    const client = getLibsql()
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const role = searchParams.get('role')

    // 1) Fetch all projects (newest modified first — most recently updated
    //    projects surface to the top so workers always see active work first)
    const projectsRes = await client.execute({
      sql: `SELECT id, title, description, requesterUnit, location, executionTime,
                   picName, picWhatsApp, activityTypes, customActivity,
                   outputNeeds, customOutput, workerOutputs, workerCustomOutput,
                   currentStage, isFastTrack, isFastProduction,
                   enableFotoEditor, enableTemplateEditor, managerId,
                   documents, createdAt, updatedAt
            FROM projects
            ORDER BY updatedAt DESC, createdAt DESC`,
      args: [],
    })

    const projectIds = projectsRes.rows.map((r) => String(r.id))

    // 2) Fetch tasks + drive_folders only if there are projects
    let tasksByProject = new Map<string, any[]>()
    let foldersByProject = new Map<string, any[]>()

    if (projectIds.length > 0) {
      // Use executeWhereIn to automatically chunk projectIds into batches
      // of 80 (D1 hard limit is 100 SQL variables per query). Without
      // chunking, a deployment with 100+ projects would 500 with
      // "D1_ERROR: too many SQL variables". This was the root cause of
      // the "manajer gagal menambahkan petugas" bug (Task 21).
      const tasksRes = await executeWhereIn(
        client,
        `SELECT id, role, stage, status, assignedTo, data, revisionCount, projectId
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

      const foldersRes = await executeWhereIn(
        client,
        `SELECT id, folderId, name, description, link, assignedRoles,
                 color, bgColor, borderColor, assignedUsers, parentFolderId, projectId
               FROM drive_folders
               WHERE projectId IN (__IN_PLACE__)`,
        projectIds,
      )
      for (const row of foldersRes.rows) {
        const r = row as Record<string, unknown>
        const pid = String(r.projectId)
        if (!foldersByProject.has(pid)) foldersByProject.set(pid, [])
        foldersByProject.get(pid)!.push(r)
      }
    }

    // 3) Transform to frontend format
    const transformedProjects = projectsRes.rows.map((p) => {
      const pid = String(p.id)
      const tasks = tasksByProject.get(pid) || []
      const driveFolders = foldersByProject.get(pid) || []

      return {
        id: pid,
        title: String(p.title ?? ''),
        description: String(p.description ?? ''),
        requesterUnit: String(p.requesterUnit ?? ''),
        documents: parseJSON(p.documents, []),
        location: String(p.location ?? ''),
        executionTime: String(p.executionTime ?? ''),
        picName: String(p.picName ?? ''),
        picWhatsApp: String(p.picWhatsApp ?? ''),
        activityTypes: parseJSON(p.activityTypes, []),
        customActivity: String(p.customActivity ?? ''),
        outputNeeds: parseJSON(p.outputNeeds, []),
        customOutput: String(p.customOutput ?? ''),
        workerOutputs: parseJSON(p.workerOutputs, {}),
        workerCustomOutput: parseJSON(p.workerCustomOutput, {}),
        currentStage: Number(p.currentStage ?? 1),
        isFastTrack: toBool(p.isFastTrack),
        isFastProduction: toBool(p.isFastProduction),
        enableFotoEditor: p.enableFotoEditor === undefined ? true : toBool(p.enableFotoEditor),
        enableTemplateEditor: p.enableTemplateEditor === undefined ? true : toBool(p.enableTemplateEditor),
        managerId: String(p.managerId ?? ''),
        createdAt: toDateISO(p.createdAt),
        updatedAt: toDateISO(p.updatedAt),
        tasks: tasks.map((t) => ({
          id: String(t.id ?? ''),
          role: String(t.role ?? ''),
          stage: Number(t.stage ?? 0),
          status: String(t.status ?? 'pending'),
          assignedTo: String(t.assignedTo ?? ''),
          data: t.data ? parseJSON(t.data, {}) : {},
          revisionCount: Number(t.revisionCount ?? 0),
        })),
        driveFolders: driveFolders.map((f) => ({
          id: String(f.id ?? ''),
          folderId: String(f.folderId ?? ''),
          name: String(f.name ?? ''),
          desc: String(f.description ?? ''),
          color: String(f.color ?? ''),
          bg: String(f.bgColor ?? ''),
          border: String(f.borderColor ?? ''),
          link: String(f.link ?? ''),
          assignedRoles: parseJSON(f.assignedRoles, []),
          assignedUsers: parseJSON(f.assignedUsers, []),
          parentFolderId: f.parentFolderId === null ? null : String(f.parentFolderId),
        })),
      }
    })

    // 4) Filter projects based on user role (non-Admin/Manager only see projects
    //    where they have an assigned task)
    let filteredProjects = transformedProjects
    if (userId && role && !['Admin', 'Manager'].includes(role)) {
      filteredProjects = transformedProjects.filter((p) =>
        p.tasks.some((t) => t.assignedTo === userId),
      )
    }

    return NextResponse.json(filteredProjects, {
      // Browser must NOT cache this response — the edge cache (15s TTL) is the
      // single source of truth. A browser max-age would create a SECOND stale
      // layer on top of the edge cache, causing "status lambat update" even
      // after the edge cache is invalidated. no-store forces the browser to
      // always revalidate against the edge, which returns fresh data once
      // invalidated.
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    console.error('Get projects error:', error)
    const errDetails = error instanceof Error
      ? { message: error.message, stack: error.stack?.split('\n').slice(0, 5).join(' | '), name: error.name }
      : { message: String(error) }
    return NextResponse.json(
      { error: 'Failed to fetch projects', details: errDetails },
      { status: 500 },
    )
  }
}, { ttl: 15, includeQuery: false })

// ============================================================================
// POST create project — batch transaction (project + tasks + drive_folders + notifications)
// ============================================================================
export async function POST(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock

  try {
    const client = getLibsql()
    const body = await request.json()
    const {
      title,
      description,
      requesterUnit,
      location,
      executionTime,
      picName,
      picWhatsApp,
      activityTypes,
      customActivity,
      outputNeeds,
      customOutput,
      workerOutputs,
      workerCustomOutput,
      managerId,
      tasks,
      driveFolders,
      isFastTrack,
      isFastProduction,
      enableFotoEditor = true,
      enableTemplateEditor = true,
    } = body

    const projectId = `PRJ-${Date.now().toString().slice(-6)}`
    const activeStage = isFastTrack ? 4 : 1
    const ts = nowMs()

    // --- Filter tasks based on feature flags (inisiasi manager) ---
    // Jika enableFotoEditor=false, task EditorFoto tidak dibuat.
    // Jika enableTemplateEditor=false, task EditorTemplateSosialMedia tidak dibuat.
    // Ini memungkinkan manager memilih hanya salah satu (atau keduanya, atau tidak sama sekali).
    const filteredTasks = (tasks || []).filter((t: { role: string; stage: number; assignedTo: string }) => {
      if (t.role === 'EditorFoto' && !enableFotoEditor) return false
      if (t.role === 'EditorTemplateSosialMedia' && !enableTemplateEditor) return false
      return true
    })

    // --- Build task records in JS (mirrors original Prisma nested-create logic) ---
    const taskRecords = filteredTasks.map(
      (t: { role: string; stage: number; assignedTo: string }) => {
        // Defensive: clamp stage ke nilai kanonik sesuai ROLE_CANONICAL_STAGE.
        // Ini mencegah task.stage terkorupsi dari payload client yang salah,
        // yang sebelumnya menyebabkan bug "Reviewer muncul di tahap Publikasi"
        // (lihat V10 migration di src/lib/db-sync.ts).
        const canonicalStage = ROLE_CANONICAL_STAGE[t.role] ?? t.stage
        let status: 'pending' | 'completed' = 'pending'
        let data = '{}'
        if (isFastTrack && canonicalStage < 4) {
          // Fast Track: auto-complete stages 1-3
          status = 'completed'
          data = JSON.stringify({ fastTracked: true })
        } else if (isFastProduction && canonicalStage === 3) {
          // Fast Production: auto-approve reviewer tasks (stage 3)
          status = 'completed'
          data = JSON.stringify({ autoApproved: true })
        }
        return {
          id: genId(),
          role: t.role,
          stage: canonicalStage,
          status,
          assignedTo: t.assignedTo,
          data,
          revisionCount: 0,
          projectId,
          createdAt: ts,
          updatedAt: ts,
        }
      },
    )

    // --- Build drive_folder records ---
    const folderRecords = (driveFolders || []).map(
      (f: {
        folderId: string
        name: string
        desc: string
        color: string
        bg: string
        border: string
        link: string
        assignedRoles: string[]
        assignedUsers?: any[]
        parentFolderId?: string
      }) => ({
        id: genId(),
        folderId: f.folderId,
        name: f.name,
        description: f.desc,
        color: f.color,
        bgColor: f.bg,
        borderColor: f.border,
        link: f.link,
        assignedRoles: JSON.stringify(f.assignedRoles),
        assignedUsers: f.assignedUsers ? JSON.stringify(f.assignedUsers) : null,
        parentFolderId: f.parentFolderId || null,
        projectId,
      }),
    )

    // --- Build notification records (in-app notifications) ---
    interface NotifRec {
      id: string
      userId: string
      message: string
      projectId: string
      targetView: string
      read: number
      createdAt: number
    }
    const notifRecords: NotifRec[] = []

    // Active stage pending tasks → "Tugas baru dialokasikan"
    for (const t of taskRecords.filter(
      (t) => t.stage === activeStage && t.status === 'pending',
    )) {
      notifRecords.push({
        id: genId(),
        userId: t.assignedTo,
        message: `Tugas baru dialokasikan untuk proyek ${title}`,
        projectId,
        targetView: 'project_detail',
        read: 0,
        createdAt: ts,
      })
    }

    // Fast Production: notify auto-approved reviewers
    if (isFastProduction) {
      for (const t of taskRecords.filter(
        (t) => t.stage === 3 && t.status === 'completed',
      )) {
        notifRecords.push({
          id: genId(),
          userId: t.assignedTo,
          message: `Proyek "${title}" menggunakan mode Fast Production. Tahap review telah di-auto-approve otomatis.`,
          projectId,
          targetView: 'project_detail',
          read: 0,
          createdAt: ts,
        })
      }
      // Fast Production: notify all pending tasks across all stages
      for (const t of taskRecords.filter((t) => t.status === 'pending')) {
        notifRecords.push({
          id: genId(),
          userId: t.assignedTo,
          message: `Tugas baru dialokasikan untuk proyek ${title} (Fast Production)`,
          projectId,
          targetView: 'project_detail',
          read: 0,
          createdAt: ts,
        })
      }
    }

    // --- Build batch statements (single transaction) ---
    const stmts: InStatement[] = []

    // Project insert
    stmts.push({
      sql: `INSERT INTO projects
            (id, title, description, requesterUnit, location, executionTime,
             picName, picWhatsApp, activityTypes, customActivity, outputNeeds,
             customOutput, workerOutputs, workerCustomOutput, currentStage,
             isFastTrack, isFastProduction,
             enableFotoEditor, enableTemplateEditor,
             managerId, documents, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)`,
      args: [
        projectId,
        title,
        description,
        requesterUnit,
        bind(location),
        bind(executionTime),
        bind(picName),
        bind(picWhatsApp),
        JSON.stringify(activityTypes),
        bind(customActivity),
        JSON.stringify(outputNeeds),
        bind(customOutput),
        JSON.stringify(workerOutputs || {}),
        JSON.stringify(workerCustomOutput || {}),
        isFastTrack ? 4 : 1, // currentStage
        isFastTrack ? 1 : 0,
        isFastProduction ? 1 : 0,
        enableFotoEditor ? 1 : 0,
        enableTemplateEditor ? 1 : 0,
        managerId,
        ts,
        ts,
      ],
    })

    // Task inserts
    for (const t of taskRecords) {
      stmts.push({
        sql: `INSERT INTO tasks
              (id, role, stage, status, data, assignedTo, projectId,
               revisionCount, createdAt, updatedAt)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          t.id,
          t.role,
          t.stage,
          t.status,
          t.data,
          t.assignedTo,
          t.projectId,
          t.revisionCount,
          t.createdAt,
          t.updatedAt,
        ],
      })
    }

    // Drive folder inserts
    for (const f of folderRecords) {
      stmts.push({
        sql: `INSERT INTO drive_folders
              (id, folderId, name, description, link, assignedRoles,
               color, bgColor, borderColor, assignedUsers, projectId, parentFolderId)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          f.id,
          f.folderId,
          f.name,
          bind(f.description),
          bind(f.link),
          bind(f.assignedRoles),
          bind(f.color),
          bind(f.bgColor),
          bind(f.borderColor),
          bind(f.assignedUsers),
          f.projectId,
          bind(f.parentFolderId),
        ],
      })
    }

    // Notification inserts
    for (const n of notifRecords) {
      stmts.push({
        sql: `INSERT INTO notifications
              (id, message, projectId, targetView, read, userId, createdAt)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          n.id,
          n.message,
          n.projectId,
          n.targetView,
          n.read,
          n.userId,
          n.createdAt,
        ],
      })
    }

    // Execute batch as a single write transaction — atomic (all-or-nothing),
    // matching the original Prisma nested create.
    await client.batch(stmts, 'write')

    // --- Send external notifications (WhatsApp/Email) — best-effort ---
    try {
      const settingsRes = await client.execute({
        sql: `SELECT notifWaEnabled, notifWaToken, notifWaDeviceId, notifWaSenderNumber,
                     notifEmailEnabled, notifEmailHost, notifEmailPort, notifEmailUser,
                     notifEmailPass, notifEmailFromName
              FROM settings WHERE id = 'main'`,
        args: [],
      })
      const s = settingsRes.rows[0]
      const notifEnabled = toBool(s?.notifWaEnabled) || toBool(s?.notifEmailEnabled)

      if (notifEnabled) {
        const activeTaskUserIds = [
          ...new Set(
            taskRecords
              .filter((t) => t.status === 'pending')
              .map((t) => String(t.assignedTo)),
          ),
        ] as string[]

        if (activeTaskUserIds.length > 0) {
          // Use executeWhereIn for D1 100-vars limit safety.
          const usersRes = await executeWhereIn(
            client,
            `SELECT id, name, email, whatsapp, notifWaEnabled, notifEmailEnabled
                  FROM users WHERE id IN (__IN_PLACE__)`,
            activeTaskUserIds,
          )
          const managerRes = await client.execute({
            sql: `SELECT name FROM users WHERE id = ?`,
            args: [managerId],
          })
          const managerName = String(managerRes.rows[0]?.name ?? 'Manager')

          const notifSettings = {
            notifWaEnabled: toBool(s?.notifWaEnabled),
            notifWaToken: (s?.notifWaToken as string | null) ?? null,
            notifWaDeviceId: (s?.notifWaDeviceId as string | null) ?? null,
            notifWaSenderNumber: (s?.notifWaSenderNumber as string | null) ?? null,
            notifEmailEnabled: toBool(s?.notifEmailEnabled),
            notifEmailHost: (s?.notifEmailHost as string | null) ?? null,
            notifEmailPort: s?.notifEmailPort !== null && s?.notifEmailPort !== undefined
              ? Number(s.notifEmailPort)
              : null,
            notifEmailUser: (s?.notifEmailUser as string | null) ?? null,
            notifEmailPass: (s?.notifEmailPass as string | null) ?? null,
            notifEmailFromName: (s?.notifEmailFromName as string | null) ?? null,
          }

          for (const user of usersRes.rows) {
            const userTasks = taskRecords.filter((t) => t.assignedTo === user.id)
            const userRole = userTasks.length > 0 ? userTasks[0].role : ''
            await sendTaskAssignmentNotification(
              {
                email: String(user.email ?? ''),
                whatsapp: user.whatsapp ? String(user.whatsapp) : null,
                notifWaEnabled: toBool(user.notifWaEnabled),
                notifEmailEnabled: toBool(user.notifEmailEnabled),
                name: String(user.name ?? ''),
              },
              notifSettings,
              {
                projectTitle: title,
                managerName,
                requesterUnit,
                role: getRoleDisplayName(userRole),
              },
            )
          }
        }
      }
    } catch (err) {
      console.error('Failed to send external notifications:', err)
    }

    await invalidateCache('/api/projects')

    // --- Build response (matches original Prisma create result shape) ---
    return NextResponse.json({
      id: projectId,
      title,
      description,
      requesterUnit,
      documents: [], // newly created — always empty
      location: location || '',
      executionTime: executionTime || '',
      picName: picName || '',
      picWhatsApp: picWhatsApp || '',
      activityTypes: activityTypes || [],
      customActivity: customActivity || '',
      outputNeeds: outputNeeds || [],
      customOutput: customOutput || '',
      currentStage: isFastTrack ? 4 : 1,
      isFastTrack: isFastTrack || false,
      isFastProduction: isFastProduction || false,
      enableFotoEditor: enableFotoEditor !== false,
      enableTemplateEditor: enableTemplateEditor !== false,
      managerId,
      createdAt: new Date(ts).toISOString(),
      tasks: taskRecords.map((t) => ({
        id: t.id,
        role: t.role,
        stage: t.stage,
        status: t.status,
        assignedTo: t.assignedTo,
        data:
          t.status === 'completed' && isFastTrack && t.stage < 4
            ? { fastTracked: true }
            : t.data
              ? parseJSON(t.data, {})
              : {},
        revisionCount: t.revisionCount || 0,
      })),
      driveFolders: folderRecords.map((f) => ({
        id: f.id,
        folderId: f.folderId,
        name: f.name,
        desc: f.description || '',
        color: f.color || '',
        bg: f.bgColor || '',
        border: f.borderColor || '',
        link: f.link || '',
        assignedRoles: parseJSON(f.assignedRoles, []),
        assignedUsers: parseJSON(f.assignedUsers, []),
        parentFolderId: f.parentFolderId || null,
      })),
    })
  } catch (error) {
    console.error('Create project error:', error)
    return NextResponse.json(
      { error: 'Failed to create project' },
      { status: 500 },
    )
  }
}

// ============================================================================
// PUT update project — supports force-complete (Admin) + normal field update
// ============================================================================
export async function PUT(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock

  try {
    const client = getLibsql()
    const body = await request.json()

    // --- Force complete: Super Admin only ---
    if (body.action === 'force-complete') {
      const requestUserRole = request.headers.get('X-User-Role')
      if (requestUserRole !== 'Admin') {
        return NextResponse.json(
          { error: 'Only Super Admin can force-complete projects' },
          { status: 403 },
        )
      }

      const { id } = body
      if (!id) {
        return NextResponse.json(
          { error: 'Project ID required' },
          { status: 400 },
        )
      }

      // Fetch project + its tasks
      const projRes = await client.execute({
        sql: `SELECT id, title, managerId FROM projects WHERE id = ?`,
        args: [id],
      })
      const project = projRes.rows[0]
      if (!project) {
        return NextResponse.json(
          { error: 'Project not found' },
          { status: 404 },
        )
      }

      // Fetch ALL tasks (need assignedTo + existing data to merge, not just id/status)
      const tasksRes = await client.execute({
        sql: `SELECT id, status, assignedTo, data FROM tasks WHERE projectId = ?`,
        args: [id],
      })
      const allTasks = tasksRes.rows
      const pendingTasks = allTasks.filter(
        (t) => String(t.status) !== 'completed',
      )

      const ts = nowMs()
      const stmts: InStatement[] = []

      // Complete all pending tasks — MERGE existing data instead of overwriting
      // (preserves publishLinks, uploaded file links, notes, etc.)
      for (const t of pendingTasks) {
        const existingData = t.data ? parseJSON(t.data, {}) : {}
        const mergedData = JSON.stringify({
          ...existingData,
          forceCompleted: true,
          completedBy: 'Super Admin',
          forceCompletedAt: ts,
        })
        stmts.push({
          sql: `UPDATE tasks SET status = 'completed',
                  data = ?, updatedAt = ? WHERE id = ?`,
          args: [mergedData, ts, String(t.id)],
        })
      }

      // Set project to stage 5 (completed)
      stmts.push({
        sql: `UPDATE projects SET currentStage = 5, updatedAt = ? WHERE id = ?`,
        args: [ts, id],
      })

      // Close all active surat_tugas for this project so they show "Selesai"
      // in every assignee's Inbox (not just "Aktif")
      stmts.push({
        sql: `UPDATE surat_tugas SET status = 'completed'
              WHERE projectId = ? AND status = 'active'`,
        args: [id],
      })

      // --- Notify ALL involved users (not just the manager) ---
      // Collect distinct userIds: every assignee + the manager. Deduplicate.
      const involvedUserIds = new Set<string>()
      for (const t of allTasks) {
        const uid = String(t.assignedTo ?? '')
        if (uid) involvedUserIds.add(uid)
      }
      involvedUserIds.add(String(project.managerId))

      const forceCompleteMsg = `Proyek "${project.title}" telah diselesaikan oleh Super Admin (Force Complete). Semua tugas ditandai selesai otomatis.`
      for (const uid of involvedUserIds) {
        stmts.push({
          sql: `INSERT INTO notifications
                (id, message, projectId, targetView, read, userId, createdAt)
                VALUES (?, ?, ?, 'project_detail', 0, ?, ?)`,
          args: [genId(), forceCompleteMsg, id, uid, ts],
        })
      }

      await client.batch(stmts, 'write')

      await invalidateCache('/api/projects')
      return NextResponse.json({
        success: true,
        action: 'force-complete',
        newStage: 5,
      })
    }

    // --- Regenerate Drive folders: Manager/Admin only ---
    // Deletes ALL existing drive_folder records for the project and inserts
    // the new real Google Drive folders passed from the client. Used by the
    // "Buat Ulang Folder Drive" button to fix projects that were created with
    // mock folders (because Drive wasn't connected or folder creation failed
    // at creation time) but Drive is now connected.
    if (body.action === 'regenerate-drive-folders') {
      const requestUserRole = request.headers.get('X-User-Role')
      if (requestUserRole !== 'Admin' && requestUserRole !== 'Manager') {
        return NextResponse.json(
          { error: 'Hanya Manager atau Admin yang dapat membuat ulang folder Drive' },
          { status: 403 },
        )
      }

      const { id, driveFolders: newFolders } = body as {
        id: string
        driveFolders: Array<{
          folderId: string
          name: string
          desc: string
          color: string
          bg: string
          border: string
          link: string
          assignedRoles: string[]
          assignedUsers?: any[]
          parentFolderId?: string | null
        }>
      }
      if (!id) {
        return NextResponse.json({ error: 'Project ID required' }, { status: 400 })
      }
      if (!Array.isArray(newFolders) || newFolders.length === 0) {
        return NextResponse.json(
          { error: 'Folder baru tidak boleh kosong' },
          { status: 400 },
        )
      }

      // Verify project exists
      const projRes = await client.execute({
        sql: `SELECT id, title FROM projects WHERE id = ?`,
        args: [id],
      })
      if (!projRes.rows[0]) {
        return NextResponse.json({ error: 'Proyek tidak ditemukan' }, { status: 404 })
      }

      const ts = nowMs()
      const stmts: InStatement[] = []

      // 1) Delete ALL existing drive_folder records for this project
      stmts.push({
        sql: `DELETE FROM drive_folders WHERE projectId = ?`,
        args: [id],
      })

      // 2) Insert new real Drive folder records
      for (const f of newFolders) {
        stmts.push({
          sql: `INSERT INTO drive_folders
                (id, folderId, name, description, link, assignedRoles,
                 color, bgColor, borderColor, assignedUsers, projectId, parentFolderId)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            genId(),
            f.folderId,
            f.name,
            bind(f.desc),
            bind(f.link),
            bind(JSON.stringify(f.assignedRoles || [])),
            bind(f.color),
            bind(f.bg),
            bind(f.border),
            bind(f.assignedUsers ? JSON.stringify(f.assignedUsers) : null),
            id,
            bind(f.parentFolderId || null),
          ],
        })
      }

      // 3) Bump project updatedAt so it surfaces to the top of the dashboard
      stmts.push({
        sql: `UPDATE projects SET updatedAt = ? WHERE id = ?`,
        args: [ts, id],
      })

      await client.batch(stmts, 'write')
      await invalidateCache('/api/projects')

      return NextResponse.json({
        success: true,
        action: 'regenerate-drive-folders',
        count: newFolders.length,
      })
    }

    // --- Normal update ---
    const { id, ...data } = body
    const ts = nowMs()

    await client.execute({
      sql: `UPDATE projects SET
              title = ?,
              description = ?,
              requesterUnit = ?,
              location = ?,
              executionTime = ?,
              picName = ?,
              picWhatsApp = ?,
              updatedAt = ?
            WHERE id = ?`,
      args: [
        bind(data.title),
        bind(data.description),
        bind(data.requesterUnit),
        bind(data.location),
        bind(data.executionTime),
        bind(data.picName),
        bind(data.picWhatsApp),
        ts,
        id,
      ],
    })

    await invalidateCache('/api/projects')

    // Return the updated project (matches original Prisma update result — full row)
    const res = await client.execute({
      sql: `SELECT id, title, description, requesterUnit, location, executionTime,
                   picName, picWhatsApp, activityTypes, customActivity, outputNeeds,
                   customOutput, workerOutputs, workerCustomOutput, currentStage,
                   isFastTrack, isFastProduction,
                   enableFotoEditor, enableTemplateEditor,
                   managerId, publicToken, documents,
                   createdAt, updatedAt
            FROM projects WHERE id = ?`,
      args: [id],
    })
    const p = res.rows[0]
    if (!p) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 },
      )
    }

    return NextResponse.json({
      id: String(p.id),
      title: String(p.title ?? ''),
      description: String(p.description ?? ''),
      requesterUnit: String(p.requesterUnit ?? ''),
      location: p.location === null ? null : String(p.location),
      executionTime: p.executionTime === null ? null : String(p.executionTime),
      picName: p.picName === null ? null : String(p.picName),
      picWhatsApp: p.picWhatsApp === null ? null : String(p.picWhatsApp),
      activityTypes: String(p.activityTypes ?? '[]'),
      customActivity: p.customActivity === null ? null : String(p.customActivity),
      outputNeeds: String(p.outputNeeds ?? '[]'),
      customOutput: p.customOutput === null ? null : String(p.customOutput),
      workerOutputs: String(p.workerOutputs ?? '{}'),
      workerCustomOutput: String(p.workerCustomOutput ?? '{}'),
      currentStage: Number(p.currentStage ?? 1),
      isFastTrack: toBool(p.isFastTrack),
      isFastProduction: toBool(p.isFastProduction),
      enableFotoEditor: p.enableFotoEditor === undefined ? true : toBool(p.enableFotoEditor),
      enableTemplateEditor: p.enableTemplateEditor === undefined ? true : toBool(p.enableTemplateEditor),
      managerId: String(p.managerId ?? ''),
      publicToken: p.publicToken === null ? null : String(p.publicToken),
      documents: String(p.documents ?? '[]'),
      createdAt: toDateISO(p.createdAt),
      updatedAt: toDateISO(p.updatedAt),
    })
  } catch (error) {
    console.error('Update project error:', error)
    return NextResponse.json(
      { error: 'Failed to update project' },
      { status: 500 },
    )
  }
}

// ============================================================================
// DELETE project — FK cascade (ON DELETE CASCADE) handles tasks, drive_folders,
// notifications (projectId SET NULL), and surat_tugas automatically.
// ============================================================================
export async function DELETE(request: NextRequest) {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock

  try {
    const client = getLibsql()
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { error: 'Project ID required' },
        { status: 400 },
      )
    }

    await client.execute({
      sql: `DELETE FROM projects WHERE id = ?`,
      args: [id],
    })

    await invalidateCache('/api/projects')
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete project error:', error)
    return NextResponse.json(
      { error: 'Failed to delete project' },
      { status: 500 },
    )
  }
}
