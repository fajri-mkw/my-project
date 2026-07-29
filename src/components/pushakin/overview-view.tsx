'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useAppStore, STAGES, ROLE_CONFIG, getRoleDisplayName } from '@/lib/store'
import {
  Calendar,
  Share2,
  TrendingUp,
  Clock,
  CheckCircle2,
  FolderKanban,
  Loader2,
  User,
  MapPin,
  Copy,
  Check,
  MessageCircle,
  Search,
  X
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useState, useMemo, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { formatTanggalIndonesia, sortByRecent } from '@/lib/date-utils'

const FILTER_OPTIONS = [
  { id: 'all', label: 'Semua Waktu' },
  { id: 'day', label: 'Hari Ini' },
  { id: 'week', label: 'Minggu Ini' },
  { id: 'month', label: 'Bulan Ini' },
  { id: 'year', label: 'Tahun Ini' }
]

// Human-readable label for each filter id (used in the WA digest header)
const FILTER_LABELS: Record<string, string> = {
  all: 'Semua Waktu',
  day: 'Hari Ini',
  week: 'Minggu Ini',
  month: 'Bulan Ini',
  year: 'Tahun Ini'
}

// Stage gradient colors - Purple, Blue, Orange theme
const STAGE_GRADIENTS: Record<number, { from: string; to: string; border: string; text: string; bg: string }> = {
  1: { from: 'from-violet-100', to: 'to-violet-50', border: 'border-violet-300', text: 'text-violet-700', bg: 'bg-violet-600' },
  2: { from: 'from-orange-100', to: 'to-orange-50', border: 'border-orange-300', text: 'text-orange-700', bg: 'bg-orange-500' },
  3: { from: 'from-blue-100', to: 'to-blue-50', border: 'border-blue-300', text: 'text-blue-700', bg: 'bg-blue-600' },
  4: { from: 'from-green-100', to: 'to-green-50', border: 'border-green-300', text: 'text-green-700', bg: 'bg-green-600' },
  5: { from: 'from-emerald-100', to: 'to-emerald-50', border: 'border-emerald-300', text: 'text-emerald-700', bg: 'bg-emerald-600' },
}

const DEFAULT_STAGE_GRADIENT = { from: 'from-slate-100', to: 'to-slate-50', border: 'border-slate-300', text: 'text-slate-700', bg: 'bg-slate-600' }

function getStageGradient(stage: number) {
  return STAGE_GRADIENTS[stage] || DEFAULT_STAGE_GRADIENT
}

export function OverviewView() {
  const { currentUser, projects, users, showAlert } = useAppStore()
  const [timeFilter, setTimeFilter] = useState('all')
  const [isGenerating, setIsGenerating] = useState(false)
  const [copiedDigest, setCopiedDigest] = useState(false)
  const [copiedProjectId, setCopiedProjectId] = useState<string | null>(null)
  // Search query for finding projects by name/keyword (manager-friendly filter).
  // Applied AFTER the time filter, scoped to the "Detail Progress Berjalan" list.
  const [searchQuery, setSearchQuery] = useState('')

  // === Manager-only feature gate ===
  // The "Salin Reminder WA" (Copy WA Reminder) feature is exclusive to
  // Manager and Admin (Super Admin) roles — they are the ones who need to
  // remind staff via WhatsApp groups. Regular staff (Reporter, Photographer,
  // Editor, etc.) do not see these buttons.
  const isManager = currentUser ? ['Manager', 'Admin'].includes(currentUser.role) : false

  // Time-based filter for the "Statistik & Progress" list.
  //
  // IMPORTANT: we filter by the project's SCHEDULED execution date
  // (`p.executionTime`), NOT by `p.createdAt` (when the project record was
  // created in the system). The cards in this view display `executionTime`
  // (e.g. "Kamis, 30 Juli 2026 08.00"), so the time chips ("Hari Ini",
  // "Minggu Ini", …) must match the same field the user sees.
  //
  // Previously this used `createdAt`, which meant a project scheduled for
  // today but created days ago would NOT appear under "Hari Ini" — even
  // though its card showed today's date. The week filter "accidentally"
  // surfaced it because `createdAt` was within the last 7 days.
  //
  // `executionTime` can legitimately be in the future (an upcoming
  // activity), so "Minggu Ini" / "Bulan Ini" use calendar-window logic
  // (current week / current month) rather than a rolling "X days back"
  // window — otherwise every future event would match the old
  // `(now - d) <= 7` check.
  //
  // Falls back to `createdAt` when `executionTime` is empty/missing so
  // projects without a scheduled time are not silently hidden.
  const isDateInRange = (dateString: string, filter: string) => {
    if (filter === 'all') return true
    if (!dateString) return false
    const d = new Date(dateString)
    if (isNaN(d.getTime())) return false
    const now = new Date()

    if (filter === 'day') {
      // Same calendar day (Y/M/D) in local time.
      return d.toDateString() === now.toDateString()
    }
    if (filter === 'week') {
      // Current calendar week (Monday → Sunday) in local time.
      // Includes future events scheduled later this week, and excludes
      // events from adjacent weeks.
      const dayOfWeek = now.getDay() // 0 = Sunday, 1 = Monday, …, 6 = Saturday
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
      const startOfWeek = new Date(now)
      startOfWeek.setHours(0, 0, 0, 0)
      startOfWeek.setDate(now.getDate() + mondayOffset)
      const endOfWeek = new Date(startOfWeek)
      endOfWeek.setDate(startOfWeek.getDate() + 7) // start of next Monday
      return d >= startOfWeek && d < endOfWeek
    }
    if (filter === 'month') {
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
    }
    if (filter === 'year') {
      return d.getFullYear() === now.getFullYear()
    }
    return true
  }

  // All users see the same real-time project statistics
  const visibleProjects = projects

  // Sort by most-recently-modified first (updatedAt DESC, createdAt DESC fallback)
  const targetProjects = useMemo(
    () =>
      visibleProjects
        .filter(p => isDateInRange(p.executionTime || p.createdAt, timeFilter))
        .sort(sortByRecent),
    [visibleProjects, timeFilter],
  )

  // === Project search ===
  // Filters the time-filtered list by user-typed keyword. Matches across
  // multiple fields so managers can find a project by name, requester,
  // location, PIC, activity types, or even assigned staff names — covers
  // the common case where a manager remembers *who* worked on a project
  // but not its exact title. Case-insensitive, ignores leading/trailing
  // whitespace. Empty query returns the full list unchanged.
  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return targetProjects

    return targetProjects.filter(p => {
      // Build the haystack of searchable text fields
      const haystackParts: string[] = [
        p.title,
        p.description,
        p.requesterUnit,
        p.location,
        p.picName,
        ...(p.activityTypes || []),
        ...(p.outputNeeds || []),
      ]

      // Include assigned staff names (managers often search by who's on it)
      for (const t of p.tasks || []) {
        if (t.assignedTo) {
          const u = users.find(uu => uu.id === t.assignedTo)
          if (u?.name) haystackParts.push(u.name)
        }
        if (t.role) haystackParts.push(t.role)
      }

      const haystack = haystackParts.filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(q)
    })
  }, [targetProjects, searchQuery, users])

  // Aggregate metrics reflect the broader time filter (not the search box)
  // so managers always see the overall workload picture for the period,
  // while the list below drills down to matching projects.
  const totalProjects = targetProjects.length
  const completedCount = targetProjects.filter(p => p.currentStage === 5).length
  const activeCount = totalProjects - completedCount

  const handleSharePublic = async () => {
    setIsGenerating(true)
    try {
      // Generate public tracker link
      const publicLink = `${window.location.origin}?public=tracker`
      await navigator.clipboard.writeText(publicLink)
      showAlert(`Tautan pantauan publik berhasil disalin ke clipboard!\n\nAnda dapat membagikan tautan ini ke semua petugas untuk melihat progress bersama.\n\nLink: ${publicLink}`)
    } catch (error) {
      console.error('Share error:', error)
      showAlert('Gagal membuat tautan publik')
    } finally {
      setIsGenerating(false)
    }
  }

  // Get user name by ID
  const getUserName = (userId: string | null) => {
    if (!userId) return 'Unassigned'
    const user = users.find(u => u.id === userId)
    return user?.name || 'Unknown'
  }

  // Get user avatar by ID
  const getUserAvatar = (userId: string | null) => {
    if (!userId) return null
    const user = users.find(u => u.id === userId)
    return user?.avatar
  }

  // Calculate task progress for a project
  const getTaskProgress = (project: typeof projects[0]) => {
    const totalTasks = project.tasks.length
    const completedTasks = project.tasks.filter(t => t.status === 'completed').length
    const percentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0

    // Progress per stage
    const stageProgress: Record<number, { total: number; completed: number }> = {}
    for (let stage = 1; stage <= 4; stage++) {
      // Defensive: gunakan stage kanonik dari ROLE_CONFIG (bukan t.stage mentah).
      const stageTasks = project.tasks.filter(t => (ROLE_CONFIG[t.role]?.stage ?? t.stage) === stage)
      stageProgress[stage] = {
        total: stageTasks.length,
        completed: stageTasks.filter(t => t.status === 'completed').length
      }
    }

    // Team members per stage
    const teamByStage: Record<number, Array<{ userId: string | null; name: string; role: string; status: string }>> = {}
    for (let stage = 1; stage <= 4; stage++) {
      teamByStage[stage] = project.tasks
        .filter(t => (ROLE_CONFIG[t.role]?.stage ?? t.stage) === stage)
        .map(t => ({
          userId: t.assignedTo,
          name: getUserName(t.assignedTo),
          role: getRoleDisplayName(t.role),
          status: t.status
        }))
    }

    return { totalTasks, completedTasks, percentage, stageProgress, teamByStage }
  }

  // === Clipboard helper with fallback ===
  // Uses navigator.clipboard.writeText when available (HTTPS / secure context),
  // falls back to a hidden textarea + document.execCommand('copy') for older
  // browsers or non-secure contexts (e.g. HTTP dev).
  const copyToClipboard = useCallback(async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      try {
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(textarea)
        return ok
      } catch {
        return false
      }
    }
  }, [])

  // ============================================================================
  // handleCopyDigest — Manager-only feature
  // Generates a WhatsApp-friendly digest of all INCOMPLETE projects within
  // the selected time period, listing which staff haven't completed their
  // tasks. Designed to be brief so managers can paste it into WA groups
  // every 2 days (or any cadence) to remind staff.
  //
  // Format:
  //   📢 REMINDER PROGRESS PROYEK
  //   Periode: Minggu Ini | 9 Jul 2026
  //   📊 Total: 7 proyek aktif, 0 selesai
  //
  //   ⏳ BELUM SELESAI (7):
  //   1. Workshop Visi, Misi FEBI
  //      Tahap: Produksi (1/3) — Belum: Achmad Magfur (Reporter), Jamal (Foto)
  //   2. ...
  // ============================================================================
  const handleCopyDigest = useCallback(async () => {
    // Only incomplete projects (currentStage !== 5)
    const incompleteProjects = targetProjects.filter(p => p.currentStage !== 5)

    if (incompleteProjects.length === 0) {
      showAlert('Semua proyek pada periode ini sudah selesai. Tidak ada yang perlu diingatkan. 🎉')
      return
    }

    const todayStr = new Date().toLocaleDateString('id-ID', {
      day: 'numeric', month: 'short', year: 'numeric'
    })

    const lines: string[] = []
    lines.push('📢 *REMINDER PROGRESS PROYEK*')
    lines.push(`Periode: ${FILTER_LABELS[timeFilter] || 'Semua Waktu'} | ${todayStr}`)
    lines.push(`📊 Total: ${totalProjects} proyek (${activeCount} aktif, ${completedCount} selesai)`)
    lines.push('')
    lines.push(`⏳ *BELUM SELESAI (${incompleteProjects.length}):*`)
    lines.push('')

    incompleteProjects.forEach((project, idx) => {
      const { completedTasks, totalTasks } = getTaskProgress(project)
      const stageName = STAGES[project.currentStage] || 'Produksi'

      // Collect pending (not-yet-completed) staff — only those whose task
      // is at or before the current stage (staff ahead of the current stage
      // are legitimately waiting, not "late").
      const pendingStaff = project.tasks.filter(t =>
        t.status !== 'completed' && t.stage <= project.currentStage
      )

      lines.push(`${idx + 1}. *${project.title}*`)
      if (project.executionTime) {
        lines.push(`   🕒 ${formatTanggalIndonesia(project.executionTime)}`)
      }
      lines.push(`   🎯 Tahap: ${stageName} (${completedTasks}/${totalTasks} selesai)`)

      if (pendingStaff.length > 0) {
        // Group by user to avoid duplicate names (a user may have multiple tasks)
        const staffSummary = pendingStaff.map(t => {
          const name = getUserName(t.assignedTo)
          const role = getRoleDisplayName(t.role)
          return `${name} (${role})`
        })
        lines.push(`   ⏰ Belum selesai: ${staffSummary.join(', ')}`)
      } else {
        lines.push(`   ⏰ Menunggu perpindahan tahap`)
      }
      lines.push('')
    })

    lines.push('Mohon segera kerjakan tugas masing-masing. Agar petugas lain dapat melanjutkan dan menyelesaikan proyek. Terima kasih 🙏')
    lines.push('—')
    lines.push('Pushakin Flows — Sistem Manajemen Produksi')

    const text = lines.join('\n')
    const ok = await copyToClipboard(text)

    if (ok) {
      setCopiedDigest(true)
      setTimeout(() => setCopiedDigest(false), 2000)
      showAlert(`✅ Reminder WA berhasil disalin!\n\n${incompleteProjects.length} proyek belum selesai. Tempel ke grup WA untuk mengingatkan petugas.`)
    } else {
      showAlert('Gagal menyalin ke clipboard. Coba lagi.')
    }
  }, [targetProjects, timeFilter, totalProjects, activeCount, completedCount, copyToClipboard, showAlert])

  // ============================================================================
  // handleCopyProjectReminder — Manager-only feature
  // Generates a WhatsApp-friendly reminder for a SINGLE project, listing
  // the specific staff who haven't completed their tasks. Useful when a
  // manager wants to remind just one project's team.
  // ============================================================================
  const handleCopyProjectReminder = useCallback(async (project: typeof projects[0]) => {
    const { completedTasks, totalTasks, percentage } = getTaskProgress(project)
    const stageName = STAGES[project.currentStage] || 'Produksi'
    const todayStr = new Date().toLocaleDateString('id-ID', {
      day: 'numeric', month: 'short', year: 'numeric'
    })

    // All pending staff (at or before current stage)
    const pendingStaff = project.tasks.filter(t =>
      t.status !== 'completed' && t.stage <= project.currentStage
    )

    const lines: string[] = []
    lines.push('📢 *REMINDER PROYEK*')
    lines.push(`📌 *${project.title}*`)
    if (project.location) {
      lines.push(`📍 ${project.location}`)
    }
    if (project.executionTime) {
      lines.push(`🕒 ${formatTanggalIndonesia(project.executionTime)}`)
    }
    lines.push(`🎯 Tahap: ${stageName} (${completedTasks}/${totalTasks} selesai — ${percentage}%)`)
    lines.push('')

    if (pendingStaff.length > 0) {
      lines.push('⏰ *Petugas yang belum menyelesaikan tugas:*')
      // Group by user (a user may have multiple roles)
      const byUser = new Map<string, string[]>()
      for (const t of pendingStaff) {
        const name = getUserName(t.assignedTo)
        const role = getRoleDisplayName(t.role)
        if (!byUser.has(name)) byUser.set(name, [])
        byUser.get(name)!.push(role)
      }
      byUser.forEach((roles, name) => {
        lines.push(`• ${name} — ${roles.join(', ')}`)
      })
    } else {
      lines.push('✅ Semua petugas di tahap ini sudah selesai. Menunggu perpindahan tahap.')
    }

    lines.push('')
    lines.push('Mohon segera kerjakan tugas masing-masing. Agar petugas lain dapat melanjutkan dan menyelesaikan proyek. Terima kasih 🙏')
    lines.push('—')
    lines.push('Pushakin Flows — Sistem Manajemen Produksi')

    const text = lines.join('\n')
    const ok = await copyToClipboard(text)

    if (ok) {
      setCopiedProjectId(project.id)
      setTimeout(() => setCopiedProjectId(null), 2000)
    } else {
      showAlert('Gagal menyalin ke clipboard. Coba lagi.')
    }
  }, [copyToClipboard, showAlert])

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header & Filter Controls */}
      <Card>
        <CardContent className="p-4 sm:p-6 flex flex-col md:flex-row md:flex-wrap justify-between items-start md:items-center gap-4">
          <div className="flex items-center w-full md:w-auto overflow-x-auto pb-2 md:pb-0 gap-2">
            <div className="bg-gradient-to-br from-violet-100 to-purple-100 p-2 rounded-xl text-violet-600 mr-2 shrink-0">
              <Calendar className="w-5 h-5" />
            </div>
            {FILTER_OPTIONS.map(opt => (
              <Button
                key={opt.id}
                variant={timeFilter === opt.id ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTimeFilter(opt.id)}
                className={cn(
                  "whitespace-nowrap",
                  timeFilter === opt.id && "bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700"
                )}
              >
                {opt.label}
              </Button>
            ))}
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {/* === Manager-only: Salin Reminder WA === */}
            {/* Generates a WhatsApp-friendly digest of incomplete projects +
                pending staff for the selected time period. Lets managers
                paste it into WA groups to remind staff every few days. */}
            {isManager && (
              <Button
                onClick={handleCopyDigest}
                className="gap-2 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white"
                title="Salin rangkuman progress proyek untuk dibagikan ke grup WA"
              >
                {copiedDigest ? (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Tersalin!</span>
                  </>
                ) : (
                  <>
                    <MessageCircle className="w-4 h-4" />
                    <span className="hidden sm:inline">Salin Reminder WA</span>
                    <span className="sm:hidden">Reminder WA</span>
                  </>
                )}
              </Button>
            )}

            <Button
              onClick={handleSharePublic}
              disabled={isGenerating}
              className="gap-2 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white"
            >
              {isGenerating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Share2 className="w-4 h-4" />
              )}
              <span className="hidden sm:inline">Bagikan ke Publik</span>
              <span className="sm:hidden">Publik</span>
            </Button>
          </div>

          {/* === Project search ===
              Placed below the time filter chips so managers can quickly
              locate a specific project by name, requester, location, PIC,
              activity type, or assigned staff. Wraps to its own line on
              mobile. The clear button (X) resets the query in one tap. */}
          <div className="w-full md:basis-full relative mt-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <Input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Cari project: nama, peminjam, lokasi, PIC, petugas, atau jenis aktivitas..."
              className="pl-9 pr-9 h-10 w-full bg-white border-slate-200 focus-visible:border-violet-400 focus-visible:ring-violet-200"
              aria-label="Cari project"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors p-1 rounded-md hover:bg-slate-100"
                aria-label="Hapus pencarian"
                title="Hapus pencarian"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white relative overflow-hidden">
          <CardContent className="p-5">
            <div className="absolute top-0 right-0 p-4 opacity-20">
              <TrendingUp className="w-20 h-20" />
            </div>
            <p className="text-slate-300 text-xs font-bold uppercase tracking-widest mb-1 relative z-10">
              Total Proyek
            </p>
            <h3 className="text-4xl font-extrabold relative z-10">{totalProjects}</h3>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-500 to-orange-600 text-white relative overflow-hidden">
          <CardContent className="p-5">
            <div className="absolute top-0 right-0 p-4 opacity-20">
              <Clock className="w-20 h-20" />
            </div>
            <p className="text-orange-100 text-xs font-bold uppercase tracking-widest mb-1 relative z-10">
              Sedang Berjalan
            </p>
            <h3 className="text-4xl font-extrabold relative z-10">{activeCount}</h3>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-violet-600 to-purple-700 text-white relative overflow-hidden">
          <CardContent className="p-5">
            <div className="absolute top-0 right-0 p-4 opacity-20">
              <CheckCircle2 className="w-20 h-20" />
            </div>
            <p className="text-violet-100 text-xs font-bold uppercase tracking-widest mb-1 relative z-10">
              Telah Selesai
            </p>
            <h3 className="text-4xl font-extrabold relative z-10">{completedCount}</h3>
          </CardContent>
        </Card>
      </div>

      {/* Project List with Workflow */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <FolderKanban className="w-5 h-5 text-violet-600" />
            <span>Detail Progress Berjalan</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {targetProjects.length === 0 ? (
            <div className="text-center py-12 text-slate-500 bg-slate-50 rounded-2xl border border-slate-100 border-dashed">
              <FolderKanban className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p>Tidak ada proyek yang sesuai dengan filter waktu terpilih.</p>
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="text-center py-12 text-slate-500 bg-slate-50 rounded-2xl border border-slate-100 border-dashed">
              <Search className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="font-medium text-slate-600">Tidak ada project yang cocok dengan “{searchQuery}”.</p>
              <p className="text-sm mt-1">Coba kata kunci lain atau
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="ml-1 text-violet-600 hover:text-violet-700 underline font-medium"
                >hapus pencarian</button>.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Result count hint — shows how many projects match the search */}
              {searchQuery.trim() && (
                <div className="text-xs text-slate-500 flex items-center gap-1.5">
                  <Search className="w-3.5 h-3.5" />
                  Menampilkan <span className="font-semibold text-slate-700">{filteredProjects.length}</span> dari {targetProjects.length} project untuk “<span className="font-semibold text-slate-700">{searchQuery.trim()}</span>”
                </div>
              )}
              {filteredProjects.map(project => {
                const { percentage, completedTasks, totalTasks, stageProgress, teamByStage } = getTaskProgress(project)
                const isCompleted = project.currentStage === 5

                return (
                  <div
                    key={project.id}
                    onClick={() => {
                      useAppStore.getState().setSelectedProjectId(project.id)
                      useAppStore.getState().setActiveView('project_detail')
                    }}
                    className="group cursor-pointer block bg-white rounded-2xl border border-slate-200 hover:border-violet-300 hover:shadow-lg transition-all overflow-hidden"
                  >
                    {/* Project Header */}
                    <div className="bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 px-4 py-3 text-white">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] font-mono text-slate-400 font-bold">
                              {project.id.slice(0, 8)}...
                            </span>
                            <Badge
                              className={cn(
                                "text-[10px] font-bold uppercase tracking-wider",
                                isCompleted
                                  ? "bg-green-500 text-white border-0"
                                  : "bg-orange-500 text-white border-0"
                              )}
                            >
                              {isCompleted ? 'Selesai' : 'Aktif'}
                            </Badge>
                          </div>
                          <h4 className="font-bold text-lg truncate">{project.title}</h4>
                          {/* Metadata row — harmonized with Dashboard: requester, location, waktu */}
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                            <span className="text-xs text-slate-400 flex items-center gap-1">
                              <User className="w-3 h-3" />
                              {project.requesterUnit}
                            </span>
                            {project.location && (
                              <span className="text-xs text-slate-400 flex items-center gap-1">
                                <MapPin className="w-3 h-3" />
                                {project.location}
                              </span>
                            )}
                            {project.executionTime && (
                              <span className="text-xs text-slate-400 flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {formatTanggalIndonesia(project.executionTime)}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 ml-3">
                          {/* === Manager-only: Per-project Salin Info WA === */}
                          {/* Stops click propagation so it doesn't navigate to
                              project detail — only copies the reminder text. */}
                          {isManager && !isCompleted && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleCopyProjectReminder(project)
                              }}
                              className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white border border-white/20 hover:border-white/40 transition-all active:scale-95"
                              title="Salin reminder proyek ini untuk WA"
                            >
                              {copiedProjectId === project.id ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-green-400" />
                                  <span className="text-green-400">Tersalin!</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5" />
                                  <span className="hidden sm:inline">Salin Info</span>
                                </>
                              )}
                            </button>
                          )}
                          <div className="text-right">
                            <div className="text-3xl font-bold">{percentage}%</div>
                            <div className="text-xs text-slate-400">{completedTasks}/{totalTasks} tugas</div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Step Flow Progress with Worker Names Aligned Below */}
                    <div className="bg-slate-50 px-4 py-4 border-b border-slate-200">
                      <div className="flex items-start justify-between">
                        {[1, 2, 3, 4].map((stage, idx) => {
                          const gradient = getStageGradient(stage)
                          const progress = stageProgress[stage] || { total: 0, completed: 0 }
                          const stagePercent = progress.total > 0
                            ? Math.round((progress.completed / progress.total) * 100)
                            : 0
                          // "Completed" = ALL tasks done (not just stage < currentStage)
                          const isStageCompleted = progress.total > 0 && progress.completed === progress.total
                          const isInProgress = !isStageCompleted && progress.completed > 0 && progress.completed < progress.total
                          const isCurrent = stage === project.currentStage && !isStageCompleted
                          const isPending = stage > project.currentStage && !isInProgress
                          const members = teamByStage[stage] || []

                          return (
                            <div key={stage} className="flex items-start flex-1">
                              {/* Step Column */}
                              <div className="flex flex-col items-center flex-1 min-w-0">
                                {/* Circle */}
                                <div className={cn(
                                  "w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-all border-2 shrink-0",
                                  isStageCompleted ? "bg-green-500 border-green-500 text-white" :
                                  isInProgress ? "bg-amber-500 border-amber-500 text-white shadow-md" :
                                  isCurrent ? cn(gradient.bg, "border-white shadow-lg text-white") :
                                  "bg-white border-slate-300 text-slate-400"
                                )}>
                                  {isStageCompleted ? (
                                    <CheckCircle2 className="w-5 h-5" />
                                  ) : isInProgress ? (
                                    <Clock className="w-5 h-5" />
                                  ) : (
                                    stage
                                  )}
                                </div>
                                {/* Stage Label */}
                                <div className="mt-1.5 text-center">
                                  <div className={cn(
                                    "text-[11px] font-semibold leading-tight",
                                    isStageCompleted ? "text-green-600" :
                                    isInProgress ? "text-amber-600" :
                                    isCurrent ? gradient.text :
                                    "text-slate-400"
                                  )}>
                                    {STAGES[stage]}
                                  </div>
                                  <div className={cn(
                                    "text-[10px] font-bold mt-0.5",
                                    isStageCompleted ? "text-green-500" :
                                    isInProgress ? "text-amber-500" :
                                    isCurrent ? gradient.text :
                                    "text-slate-400"
                                  )}>
                                    {stagePercent}%
                                  </div>
                                </div>

                                {/* Worker Names Aligned Below Stage */}
                                <div className="mt-2 w-full space-y-1">
                                  {members.length === 0 ? (
                                    <div className={cn(
                                      "text-[10px] text-center py-1",
                                      isPending ? "text-slate-300" : "text-slate-400"
                                    )}>
                                      —
                                    </div>
                                  ) : (
                                    members.map((member, midx) => {
                                      const avatar = getUserAvatar(member.userId)
                                      const isTaskCompleted = member.status === 'completed'
                                      const isLocked = isPending

                                      return (
                                        <div
                                          key={midx}
                                          className={cn(
                                            "flex items-center gap-1.5 px-1.5 py-1 rounded-md transition-all",
                                            isTaskCompleted ? "bg-green-50" :
                                            isLocked ? "bg-slate-100/50" :
                                            "bg-white border border-slate-200 shadow-sm"
                                          )}
                                        >
                                          {/* Mini Avatar */}
                                          {avatar ? (
                                            <img
                                              src={avatar}
                                              alt={member.name}
                                              className="w-5 h-5 rounded-full object-cover border border-white shrink-0"
                                            />
                                          ) : (
                                            <div className={cn(
                                              "w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0",
                                              isTaskCompleted ? "bg-green-500" :
                                              isLocked ? "bg-slate-300" :
                                              gradient.bg
                                            )}>
                                              {member.name.charAt(0).toUpperCase()}
                                            </div>
                                          )}

                                          {/* Name */}
                                          <span className={cn(
                                            "text-[10px] font-medium truncate leading-tight",
                                            isTaskCompleted ? "text-green-700" :
                                            isLocked ? "text-slate-400" :
                                            "text-stone-700"
                                          )}>
                                            {member.name}
                                          </span>

                                          {/* Status icon */}
                                          <span className="ml-auto shrink-0">
                                            {isTaskCompleted ? (
                                              <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                                            ) : isLocked ? null : (
                                              <Clock className="w-3 h-3 text-amber-500" />
                                            )}
                                          </span>
                                        </div>
                                      )
                                    })
                                  )}
                                </div>
                              </div>

                              {/* Connector Line */}
                              {idx < 4 && (
                                <div className={cn(
                                  "flex-1 h-0.5 mt-5 mx-1 rounded-full shrink-0",
                                  isStageCompleted ? "bg-green-500" :
                                  isCurrent ? "bg-slate-300" :
                                  "bg-slate-200"
                                )}></div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    {/* Quick Stats Footer */}
                    <div className="px-4 py-3 flex items-center gap-4 text-xs text-slate-500">
                      <span className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                        Selesai
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-amber-500" />
                        Dalam Proses
                      </span>
                      <span className="ml-auto font-medium text-slate-400">
                        {completedTasks}/{totalTasks} tugas selesai
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
