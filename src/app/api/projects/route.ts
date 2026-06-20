import { NextRequest, NextResponse } from 'next/server'
import { checkMaintenanceMode } from '@/lib/maintenance-check'
import { sendTaskAssignmentNotification } from '@/lib/notification-service'
import { getRoleDisplayName } from '@/lib/store'
import { withEdgeCache, invalidateCache } from '@/lib/edge-cache'
import {
  getLibsql,
  toBool,
  toDateISO,
  parseJSON,
  bind,
  genId,
  nowMs,
  type InStatement,
} from '@/lib/libsql-client'

// ============================================================================
// GET all projects with relations (tasks + driveFolders)
// Rewritten to use @libsql/client directly (bypasses Prisma CPU overhead).
// Edge-cached for 60s to reduce CPU usage on Workers free plan.
//
// Optimization vs. original: 3 flat queries (projects, tasks, drive_folders)
// joined in JS — avoids Prisma's nested-relation SQL generation + mapping CPU.
// ============================================================================
export const GET = withEdgeCache(async (request: NextRequest) => {
  const maintenanceBlock = await checkMaintenanceMode(request)
  if (maintenanceBlock) return maintenanceBlock

  try {
    const client = getLibsql()
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const role = searchParams.get('role')

    // 1) Fetch all projects (newest first)
    const projectsRes = await client.execute({
      sql: `SELECT id, title, description, requesterUnit, location, executionTime,
                   picName, picWhatsApp, activityTypes, customActivity,
                   outputNeeds, customOutput, workerOutputs, workerCustomOutput,
                   currentStage, isFastTrack, isFastProduction, managerId,
                   documents, createdAt
            FROM projects
            ORDER BY createdAt DESC`,
      args: [],
    })

    const projectIds = projectsRes.rows.map((r) => String(r.id))

    // 2) Fetch tasks + drive_folders only if there are projects
    let tasksByProject = new Map<string, any[]>()
    let foldersByProject = new Map<string, any[]>()

    if (projectIds.length > 0) {
      const placeholders = projectIds.map(() => '?').join(',')

      const tasksRes = await client.execute({
        sql: `SELECT id, role, stage, status, assignedTo, data, revisionCount, projectId
              FROM tasks
              WHERE projectId IN (${placeholders})`,
        args: projectIds,
      })
      for (const row of tasksRes.rows) {
        const pid = String(row.projectId)
        if (!tasksByProject.has(pid)) tasksByProject.set(pid, [])
        tasksByProject.get(pid)!.push(row)
      }

      const foldersRes = await client.execute({
        sql: `SELECT id, folderId, name, description, link, assignedRoles,
                     color, bgColor, borderColor, assignedUsers, parentFolderId, projectId
              FROM drive_folders
              WHERE projectId IN (${placeholders})`,
        args: projectIds,
      })
      for (const row of foldersRes.rows) {
        const pid = String(row.projectId)
        if (!foldersByProject.has(pid)) foldersByProject.set(pid, [])
        foldersByProject.get(pid)!.push(row)
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
        managerId: String(p.managerId ?? ''),
        createdAt: toDateISO(p.createdAt),
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
      headers: { 'Cache-Control': 'private, max-age=10, stale-while-revalidate=30' },
    })
  } catch (error) {
    console.error('Get projects error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch projects' },
      { status: 500 },
    )
  }
}, { ttl: 60 })

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
    } = body

    const projectId = `PRJ-${Date.now().toString().slice(-6)}`
    const activeStage = isFastTrack ? 4 : 1
    const ts = nowMs()

    // --- Build task records in JS (mirrors original Prisma nested-create logic) ---
    const taskRecords = (tasks || []).map(
      (t: { role: string; stage: number; assignedTo: string }) => {
        let status: 'pending' | 'completed' = 'pending'
        let data = '{}'
        if (isFastTrack && t.stage < 4) {
          // Fast Track: auto-complete stages 1-3
          status = 'completed'
          data = JSON.stringify({ fastTracked: true })
        } else if (isFastProduction && t.stage === 3) {
          // Fast Production: auto-approve reviewer tasks (stage 3)
          status = 'completed'
          data = JSON.stringify({ autoApproved: true })
        }
        return {
          id: genId(),
          role: t.role,
          stage: t.stage,
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
             isFastTrack, isFastProduction, managerId, documents, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)`,
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
          const placeholders = activeTaskUserIds.map(() => '?').join(',')
          const usersRes = await client.execute({
            sql: `SELECT id, name, email, whatsapp, notifWaEnabled, notifEmailEnabled
                  FROM users WHERE id IN (${placeholders})`,
            args: activeTaskUserIds,
          })
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

      const tasksRes = await client.execute({
        sql: `SELECT id, status FROM tasks WHERE projectId = ?`,
        args: [id],
      })
      const pendingTaskIds = tasksRes.rows
        .filter((t) => String(t.status) !== 'completed')
        .map((t) => String(t.id))

      const ts = nowMs()
      const stmts: InStatement[] = []

      // Complete all pending tasks
      for (const taskId of pendingTaskIds) {
        stmts.push({
          sql: `UPDATE tasks SET status = 'completed',
                  data = ?, updatedAt = ? WHERE id = ?`,
          args: [
            JSON.stringify({ forceCompleted: true, completedBy: 'Super Admin' }),
            ts,
            taskId,
          ],
        })
      }

      // Set project to stage 5 (completed)
      stmts.push({
        sql: `UPDATE projects SET currentStage = 5, updatedAt = ? WHERE id = ?`,
        args: [ts, id],
      })

      // Notify the manager
      stmts.push({
        sql: `INSERT INTO notifications
              (id, message, projectId, targetView, read, userId, createdAt)
              VALUES (?, ?, ?, 'project_detail', 0, ?, ?)`,
        args: [
          genId(),
          `Proyek "${project.title}" telah dipaksa selesai (Force Complete) oleh Super Admin.`,
          id,
          String(project.managerId),
          ts,
        ],
      })

      await client.batch(stmts, 'write')

      await invalidateCache('/api/projects')
      return NextResponse.json({
        success: true,
        action: 'force-complete',
        newStage: 5,
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
                   isFastTrack, isFastProduction, managerId, publicToken, documents,
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
