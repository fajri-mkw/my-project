import { NextRequest, NextResponse } from 'next/server'
import { getLibsql, bind, toBool, parseJSON } from '@/lib/libsql-client'

// ============================================================================
// GET /api/statistik — Dashboard evaluasi efektivitas & efisiensi tim
// Akses: Admin + Manager only
//
// Mengembalikan 5 section:
// 1. Statistik per User (produktivitas, kualitas, beban kerja)
// 2. Statistik per Tahap (distribusi, bottleneck, durasi)
// 3. Statistik per Role (produktivitas, revisi, beban kerja)
// 4. Statistik Tim (throughput, completion rate, stuck rate)
// 5. Statistik Workflow (stage distribution, fast track rate)
// ============================================================================

export async function GET(request: NextRequest) {
  const userRole = request.headers.get('X-User-Role')
  if (!['Admin', 'Manager'].includes(userRole || '')) {
    return NextResponse.json({ error: 'Hanya Admin dan Manager' }, { status: 403 })
  }

  try {
    const client = getLibsql()

    // === 1. STATISTIK PER USER (dengan durasi AKTIF — adil per tahap) ===
    // Durasi dihitung dari: saat tugas menjadi AKTIF sampai petugas menyelesaikan.
    //
    // Cara menentukan "saat tugas menjadi aktif":
    // - Tahap 1: dari project.executionTime (waktu pelaksanaan yang diinput Manager)
    //   Bukan project.createdAt — karena manager bisa inisiasi proyek seminggu sebelum acara
    // - Tahap 2+: dari MAX(updatedAt) task selesai di tahap sebelumnya
    //
    // Jadi durasi aktif = task.updatedAt - "waktu mulai aktif"
    // Fallback: kalau executionTime kosong, pakai project.createdAt
    const userStatsRes = await client.execute({
      sql: `WITH task_durations AS (
              SELECT
                t.id, t.assignedTo, t.stage, t.status, t.revisionCount,
                t.createdAt, t.updatedAt,
                t.projectId,
                -- Waktu mulai aktif:
                -- Tahap 1 = project.executionTime (waktu pelaksanaan)
                --   Fallback: project.createdAt kalau executionTime kosong
                -- Tahap 2+ = MAX(updatedAt) dari task selesai di tahap sebelumnya
                CASE
                  WHEN t.stage = 1 THEN
                    CASE
                      -- executionTime adalah ISO string (datetime-local format: 2026-10-07T08:00)
                      WHEN p.executionTime IS NOT NULL AND p.executionTime != '' THEN
                        (julianday(p.executionTime) - julianday('1970-01-01')) * 86400000
                      -- Fallback: project.createdAt (bisa epoch ms atau ISO)
                      WHEN CAST(p.createdAt AS REAL) > 1000000000000 THEN CAST(p.createdAt AS REAL)
                      ELSE (julianday(p.createdAt) - julianday('1970-01-01')) * 86400000
                    END
                  ELSE (
                    SELECT MAX(
                      CASE
                        WHEN CAST(t2.updatedAt AS REAL) > 1000000000000 THEN CAST(t2.updatedAt AS REAL)
                        ELSE (julianday(t2.updatedAt) - julianday('1970-01-01')) * 86400000
                      END
                    )
                    FROM tasks t2
                    WHERE t2.projectId = t.projectId
                      AND t2.stage = t.stage - 1
                      AND t2.status = 'completed'
                  )
                END as activatedAt,
                -- Waktu selesai
                CASE
                  WHEN CAST(t.updatedAt AS REAL) > 1000000000000 THEN CAST(t.updatedAt AS REAL)
                  ELSE (julianday(t.updatedAt) - julianday('1970-01-01')) * 86400000
                END as completedAt,
                -- Durasi aktif = completedAt - activatedAt (bisa negatif = 0)
                MAX(0, CASE
                  WHEN CAST(t.updatedAt AS REAL) > 1000000000000 THEN CAST(t.updatedAt AS REAL)
                  ELSE (julianday(t.updatedAt) - julianday('1970-01-01')) * 86400000
                END
                -
                CASE
                  WHEN t.stage = 1 THEN
                    CASE
                      WHEN p.executionTime IS NOT NULL AND p.executionTime != '' THEN
                        (julianday(p.executionTime) - julianday('1970-01-01')) * 86400000
                      WHEN CAST(p.createdAt AS REAL) > 1000000000000 THEN CAST(p.createdAt AS REAL)
                      ELSE (julianday(p.createdAt) - julianday('1970-01-01')) * 86400000
                    END
                  ELSE (
                    SELECT MAX(
                      CASE
                        WHEN CAST(t2.updatedAt AS REAL) > 1000000000000 THEN CAST(t2.updatedAt AS REAL)
                        ELSE (julianday(t2.updatedAt) - julianday('1970-01-01')) * 86400000
                      END
                    )
                    FROM tasks t2
                    WHERE t2.projectId = t.projectId
                      AND t2.stage = t.stage - 1
                      AND t2.status = 'completed'
                  )
                END
                ) as durationMs
              FROM tasks t
              JOIN projects p ON p.id = t.projectId
              WHERE t.status = 'completed'
            )
            SELECT
              u.id, u.name, u.role,
              COUNT(t.id) as totalTasks,
              SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completedTasks,
              SUM(CASE WHEN t.status = 'pending' THEN 1 ELSE 0 END) as pendingTasks,
              SUM(CASE WHEN t.revisionCount > 0 THEN 1 ELSE 0 END) as taskWithRevisions,
              SUM(t.revisionCount) as totalRevisions,
              AVG(CASE WHEN t.status = 'completed' THEN t.revisionCount ELSE NULL END) as avgRevisions,
              SUM(CASE WHEN t.status = 'completed' AND t.revisionCount = 0 THEN 1 ELSE 0 END) as taskNoRevision,
              AVG(td.durationMs) as avgDurationMs,
              MIN(td.durationMs) as fastestDurationMs,
              MAX(td.durationMs) as slowestDurationMs
            FROM users u
            LEFT JOIN tasks t ON t.assignedTo = u.id
            LEFT JOIN task_durations td ON td.id = t.id
            WHERE u.role NOT IN ('Admin', 'Administrator', 'Manager')
            GROUP BY u.id, u.name, u.role
            ORDER BY completedTasks DESC`,
      args: [],
    })

    const perUser = userStatsRes.rows.map(r => {
      const row = r as Record<string, unknown>
      const total = Number(row.totalTasks || 0)
      const completed = Number(row.completedTasks || 0)
      const pending = Number(row.pendingTasks || 0)
      const avgMs = Number(row.avgDurationMs || 0)
      const fastestMs = Number(row.fastestDurationMs || 0)
      const slowestMs = Number(row.slowestDurationMs || 0)
      // Format durasi ke jam/hari
      const msToReadable = (ms: number) => {
        if (ms <= 0) return null
        const hours = ms / 3600000
        const days = ms / 86400000
        if (days >= 1) return { value: Math.round(days * 10) / 10, unit: 'hari' as const, ms }
        if (hours >= 1) return { value: Math.round(hours * 10) / 10, unit: 'jam' as const, ms }
        const minutes = ms / 60000
        return { value: Math.round(minutes), unit: 'menit' as const, ms }
      }
      return {
        id: String(row.id),
        name: String(row.name || ''),
        role: String(row.role || ''),
        totalTasks: total,
        completedTasks: completed,
        pendingTasks: pending,
        completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
        totalRevisions: Number(row.totalRevisions || 0),
        taskWithRevisions: Number(row.taskWithRevisions || 0),
        avgRevisions: completed > 0 ? Math.round(Number(row.avgRevisions || 0) * 10) / 10 : 0,
        taskNoRevision: Number(row.taskNoRevision || 0),
        noRevisionRate: completed > 0 ? Math.round((Number(row.taskNoRevision || 0) / completed) * 100) : 0,
        avgDuration: avgMs > 0 ? msToReadable(avgMs) : null,
        fastestDuration: fastestMs > 0 ? msToReadable(fastestMs) : null,
        slowestDuration: slowestMs > 0 ? msToReadable(slowestMs) : null,
      }
    })

    // === 2. STATISTIK PER TAHAP (dengan durasi AKTIF — adil) ===
    const stageStatsRes = await client.execute({
      sql: `WITH task_durations AS (
              SELECT
                t.id, t.stage, t.status, t.revisionCount,
                t.projectId,
                MAX(0, CASE
                  WHEN CAST(t.updatedAt AS REAL) > 1000000000000 THEN CAST(t.updatedAt AS REAL)
                  ELSE (julianday(t.updatedAt) - julianday('1970-01-01')) * 86400000
                END
                -
                CASE
                  WHEN t.stage = 1 THEN
                    CASE
                      -- Tahap 1 mulai dari executionTime (waktu pelaksanaan)
                      WHEN p.executionTime IS NOT NULL AND p.executionTime != '' THEN
                        (julianday(p.executionTime) - julianday('1970-01-01')) * 86400000
                      -- Fallback: project.createdAt
                      WHEN CAST(p.createdAt AS REAL) > 1000000000000 THEN CAST(p.createdAt AS REAL)
                      ELSE (julianday(p.createdAt) - julianday('1970-01-01')) * 86400000
                    END
                  ELSE (
                    SELECT MAX(
                      CASE
                        WHEN CAST(t2.updatedAt AS REAL) > 1000000000000 THEN CAST(t2.updatedAt AS REAL)
                        ELSE (julianday(t2.updatedAt) - julianday('1970-01-01')) * 86400000
                      END
                    )
                    FROM tasks t2
                    WHERE t2.projectId = t.projectId
                      AND t2.stage = t.stage - 1
                      AND t2.status = 'completed'
                  )
                END
                ) as durationMs
              FROM tasks t
              JOIN projects p ON p.id = t.projectId
              WHERE t.status = 'completed'
            )
            SELECT
              t.stage,
              COUNT(*) as totalTasks,
              SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completedTasks,
              SUM(CASE WHEN t.status = 'pending' THEN 1 ELSE 0 END) as pendingTasks,
              SUM(t.revisionCount) as totalRevisions,
              AVG(td.durationMs) as avgDurationMs
            FROM tasks t
            LEFT JOIN task_durations td ON td.id = t.id
            GROUP BY t.stage
            ORDER BY t.stage`,
      args: [],
    })

    const perStage = stageStatsRes.rows.map(r => {
      const row = r as Record<string, unknown>
      const total = Number(row.totalTasks || 0)
      const completed = Number(row.completedTasks || 0)
      const avgMs = Number(row.avgDurationMs || 0)
      return {
        stage: Number(row.stage || 0),
        stageName: ['', 'Produksi', 'Pasca Produksi', 'Review', 'Publikasi', 'Selesai'][Number(row.stage || 0)] || `Tahap ${row.stage}`,
        totalTasks: total,
        completedTasks: completed,
        pendingTasks: Number(row.pendingTasks || 0),
        completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
        totalRevisions: Number(row.totalRevisions || 0),
        avgDurationHours: avgMs > 0 ? Math.round((avgMs / 3600000) * 10) / 10 : 0,
        avgDurationDays: avgMs > 0 ? Math.round((avgMs / 86400000) * 10) / 10 : 0,
      }
    })

    // === 3. STATISTIK PER ROLE ===
    const roleStatsRes = await client.execute({
      sql: `SELECT
              t.role,
              COUNT(*) as totalTasks,
              SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completedTasks,
              SUM(CASE WHEN t.status = 'pending' THEN 1 ELSE 0 END) as pendingTasks,
              SUM(t.revisionCount) as totalRevisions,
              AVG(CASE WHEN t.status = 'completed' AND t.revisionCount > 0 THEN t.revisionCount ELSE NULL END) as avgRevisions,
              COUNT(DISTINCT t.assignedTo) as uniqueUsers
            FROM tasks t
            GROUP BY t.role
            ORDER BY completedTasks DESC`,
      args: [],
    })

    const perRole = roleStatsRes.rows.map(r => {
      const row = r as Record<string, unknown>
      const total = Number(row.totalTasks || 0)
      const completed = Number(row.completedTasks || 0)
      return {
        role: String(row.role || ''),
        totalTasks: total,
        completedTasks: completed,
        pendingTasks: Number(row.pendingTasks || 0),
        completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
        totalRevisions: Number(row.totalRevisions || 0),
        avgRevisions: completed > 0 ? Math.round(Number(row.avgRevisions || 0) * 10) / 10 : 0,
        uniqueUsers: Number(row.uniqueUsers || 0),
      }
    })

    // === 4. STATISTIK TIM (KOLEKTIF) ===
    const totalProjectsRes = await client.execute({
      sql: `SELECT
              COUNT(*) as totalProjects,
              SUM(CASE WHEN currentStage = 5 THEN 1 ELSE 0 END) as completedProjects,
              SUM(CASE WHEN currentStage < 5 THEN 1 ELSE 0 END) as activeProjects,
              SUM(CASE WHEN isFastTrack = 1 THEN 1 ELSE 0 END) as fastTrackProjects,
              SUM(CASE WHEN isFastProduction = 1 THEN 1 ELSE 0 END) as fastProductionProjects
            FROM projects`,
      args: [],
    })
    const teamRow = totalProjectsRes.rows[0] as Record<string, unknown>
    const totalProjects = Number(teamRow.totalProjects || 0)
    const completedProjects = Number(teamRow.completedProjects || 0)
    const activeProjects = Number(teamRow.activeProjects || 0)
    const fastTrackProjects = Number(teamRow.fastTrackProjects || 0)

    // Stuck projects: updatedAt < 7 hari yang lalu dan currentStage < 5
    const sevenDaysAgo = Date.now() - 7 * 86400000
    const stuckRes = await client.execute({
      sql: `SELECT COUNT(*) as cnt FROM projects WHERE currentStage < 5 AND CAST(updatedAt AS REAL) < ?`,
      args: [bind(sevenDaysAgo)],
    })
    const stuckProjects = Number((stuckRes.rows[0] as Record<string, unknown>).cnt || 0)

    // Total tasks & revisions
    const taskTotalsRes = await client.execute({
      sql: `SELECT
              COUNT(*) as totalTasks,
              SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completedTasks,
              SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pendingTasks,
              SUM(revisionCount) as totalRevisions
            FROM tasks`,
      args: [],
    })
    const taskRow = taskTotalsRes.rows[0] as Record<string, unknown>

    // Avg team per project
    const avgTeamRes = await client.execute({
      sql: `SELECT AVG(cnt) as avgTeam FROM (
              SELECT projectId, COUNT(DISTINCT assignedTo) as cnt FROM tasks GROUP BY projectId
            )`,
      args: [],
    })
    const avgTeamSize = Math.round(Number((avgTeamRes.rows[0] as Record<string, unknown>).avgTeam || 0) * 10) / 10

    const team = {
      totalProjects,
      completedProjects,
      activeProjects,
      completionRate: totalProjects > 0 ? Math.round((completedProjects / totalProjects) * 100) : 0,
      stuckProjects,
      stuckRate: totalProjects > 0 ? Math.round((stuckProjects / totalProjects) * 100) : 0,
      fastTrackProjects,
      fastTrackRate: totalProjects > 0 ? Math.round((fastTrackProjects / totalProjects) * 100) : 0,
      totalTasks: Number(taskRow.totalTasks || 0),
      completedTasks: Number(taskRow.completedTasks || 0),
      pendingTasks: Number(taskRow.pendingTasks || 0),
      totalRevisions: Number(taskRow.totalRevisions || 0),
      avgTeamSize,
    }

    // === 5. STATISTIK WORKFLOW (Stage Distribution) ===
    const stageDistRes = await client.execute({
      sql: `SELECT currentStage, COUNT(*) as cnt FROM projects GROUP BY currentStage ORDER BY currentStage`,
      args: [],
    })
    const stageDistribution = stageDistRes.rows.map(r => {
      const row = r as Record<string, unknown>
      return {
        stage: Number(row.currentStage || 0),
        stageName: ['', 'Produksi', 'Pasca Produksi', 'Review', 'Publikasi', 'Selesai'][Number(row.currentStage || 0)] || `Tahap ${row.currentStage}`,
        count: Number(row.cnt || 0),
      }
    })

    // Activity types distribution
    const activityRes = await client.execute({
      sql: `SELECT activityTypes FROM projects WHERE activityTypes IS NOT NULL`,
      args: [],
    })
    const activityCount: Record<string, number> = {}
    for (const row of activityRes.rows) {
      const types = parseJSON((row as Record<string, unknown>).activityTypes, []) as string[]
      for (const t of types) {
        activityCount[t] = (activityCount[t] || 0) + 1
      }
    }
    const activityDistribution = Object.entries(activityCount)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)

    const workflow = {
      stageDistribution,
      activityDistribution,
    }

    return NextResponse.json({
      perUser,
      perStage,
      perRole,
      team,
      workflow,
    })
  } catch (error) {
    console.error('[STATISTIK] Error:', error)
    return NextResponse.json({ error: 'Gagal memuat statistik' }, { status: 500 })
  }
}
