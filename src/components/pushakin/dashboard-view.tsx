'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useAppStore, STAGES, getRoleDisplayName } from '@/lib/store'
import { 
  Plus, 
  LayoutGrid, 
  List, 
  FolderKanban, 
  Trash2,
  CheckCircle2,
  XCircle,
  MapPin,
  Clock,
  User,
  Mail,
  AlertTriangle,
  Zap,
  Rocket,
  ArrowRight,
  Users,
  UserCheck,
  CircleCheckBig,
  CircleDot,
  Filter
} from 'lucide-react'
import { useState, useMemo } from 'react'
import { cn } from '@/lib/utils'

// Stage gradient colors - Purple, Blue, Orange theme
const STAGE_GRADIENTS: Record<number, { from: string; to: string; border: string; text: string; bg: string; dot: string }> = {
  1: { from: 'from-violet-100', to: 'to-violet-50', border: 'border-violet-300', text: 'text-violet-700', bg: 'bg-violet-600', dot: 'bg-violet-500' },
  2: { from: 'from-orange-100', to: 'to-orange-50', border: 'border-orange-300', text: 'text-orange-700', bg: 'bg-orange-500', dot: 'bg-orange-500' },
  3: { from: 'from-blue-100', to: 'to-blue-50', border: 'border-blue-300', text: 'text-blue-700', bg: 'bg-blue-600', dot: 'bg-blue-500' },
  4: { from: 'from-purple-100', to: 'to-purple-50', border: 'border-purple-300', text: 'text-purple-700', bg: 'bg-purple-600', dot: 'bg-purple-500' },
  5: { from: 'from-green-100', to: 'to-green-50', border: 'border-green-300', text: 'text-green-700', bg: 'bg-green-600', dot: 'bg-green-500' },
  6: { from: 'from-emerald-100', to: 'to-emerald-50', border: 'border-emerald-300', text: 'text-emerald-700', bg: 'bg-emerald-600', dot: 'bg-emerald-500' },
}

const DEFAULT_STAGE_GRADIENT = { from: 'from-slate-100', to: 'to-slate-50', border: 'border-slate-300', text: 'text-slate-700', bg: 'bg-slate-600', dot: 'bg-slate-500' }

function getStageGradient(stage: number) {
  return STAGE_GRADIENTS[stage] || DEFAULT_STAGE_GRADIENT
}

export function DashboardView() {
  const { currentUser, projects, users, setActiveView, setSelectedProjectId, deleteProject, forceCompleteProject, showAlert, showConfirm, suratList, permohonanList } = useAppStore()
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid')
  const [projectFilter, setProjectFilter] = useState<'all' | 'mine' | 'completed'>('all')
  const [taskStatusFilter, setTaskStatusFilter] = useState<'all' | 'pending' | 'completed'>('all')
  
  const canManageProject = currentUser ? ['Manager', 'Admin'].includes(currentUser.role) : false
  const isSuperAdmin = currentUser?.role === 'Admin'
  const isManager = currentUser?.role === 'Manager'

  // Count pending forwarded permohonan/surat for Manager
  const pendingForwardedCount = isManager
    ? suratList.filter(s => s.managerId === currentUser.id && s.status === 'diteruskan' && s.kategori === 'Permohonan').length
      + permohonanList.filter(p => p.status === 'forwarded' && p.managerId === currentUser.id).length
    : 0
  
  // Compute "my projects" count for the filter badge
  const myProjectsCount = currentUser
    ? projects.filter(p => 
        p.tasks.some(t => t.assignedTo === currentUser.id) || 
        p.managerId === currentUser.id
      ).length
    : 0

  // Compute completed projects count
  const completedProjectsCount = projects.filter(p => p.currentStage === 6).length

  // Compute my pending/completed task counts for the task status filter
  const myPendingCount = useMemo(() => {
    if (!currentUser) return 0
    return projects.filter(p => 
      p.tasks.some(t => t.assignedTo === currentUser.id && t.status !== 'completed')
    ).length
  }, [currentUser, projects])

  const myCompletedCount = useMemo(() => {
    if (!currentUser) return 0
    return projects.filter(p => 
      p.tasks.some(t => t.assignedTo === currentUser.id && t.status === 'completed') &&
      !p.tasks.some(t => t.assignedTo === currentUser.id && t.status !== 'completed')
    ).length
  }, [currentUser, projects])

  // Filter projects based on selected filter
  const visibleProjects = useMemo(() => {
    let filtered: typeof projects
    if (projectFilter === 'mine' && currentUser) {
      filtered = projects.filter(p => 
        p.tasks.some(t => t.assignedTo === currentUser.id) || 
        p.managerId === currentUser.id
      )
      // Apply task status sub-filter when in "mine" mode
      if (taskStatusFilter === 'pending') {
        filtered = filtered.filter(p => 
          p.tasks.some(t => t.assignedTo === currentUser.id && t.status !== 'completed')
        )
      } else if (taskStatusFilter === 'completed') {
        filtered = filtered.filter(p => 
          p.tasks.some(t => t.assignedTo === currentUser.id && t.status === 'completed') &&
          !p.tasks.some(t => t.assignedTo === currentUser.id && t.status !== 'completed')
        )
      }
    } else if (projectFilter === 'completed') {
      filtered = projects.filter(p => p.currentStage === 6)
    } else {
      filtered = projects
    }
    return filtered
  }, [projectFilter, taskStatusFilter, currentUser, projects])

  const handleDeleteProject = (projectId: string) => {
    showConfirm(
      'Peringatan: Yakin ingin menghapus proyek ini secara permanen? Aksi ini tidak dapat dibatalkan.',
      async () => {
        try {
          await fetch(`/api/projects?id=${projectId}`, { method: 'DELETE' })
          deleteProject(projectId)
        } catch {
          showAlert('Gagal menghapus proyek')
        }
      }
    )
  }

  const handleForceComplete = (projectId: string, projectTitle: string) => {
    showConfirm(
      `Peringatan: Paksa selesaikan proyek "${projectTitle}"? Semua tugas akan ditandai selesai dan proyek berpindah ke tahap Selesai. Aksi ini tidak dapat dibatalkan.`,
      async () => {
        try {
          const response = await fetch('/api/projects', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: projectId, action: 'force-complete' })
          })
          if (response.ok) {
            forceCompleteProject(projectId)
            showAlert('Proyek berhasil dipaksa selesai (Force Complete)')
          } else {
            const errorData = await response.json().catch(() => ({}))
            showAlert(`Gagal: ${errorData.error || 'Terjadi kesalahan'}`)
          }
        } catch {
          showAlert('Gagal memaksa selesaikan proyek')
        }
      }
    )
  }

  // Calculate task progress for a project
  const getTaskProgress = (project: typeof projects[0]) => {
    const totalTasks = project.tasks.length
    const completedTasks = project.tasks.filter(t => t.status === 'completed').length
    const percentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
    
    // Progress per stage
    const stageProgress: Record<number, { total: number; completed: number }> = {}
    for (let stage = 1; stage <= 5; stage++) {
      const stageTasks = project.tasks.filter(t => t.stage === stage)
      stageProgress[stage] = {
        total: stageTasks.length,
        completed: stageTasks.filter(t => t.status === 'completed').length
      }
    }
    
    // Team members per stage
    const teamByStage: Record<number, Array<{ userId: string | null; name: string; role: string; status: string }>> = {}
    for (let stage = 1; stage <= 5; stage++) {
      teamByStage[stage] = project.tasks
        .filter(t => t.stage === stage)
        .map(t => ({
          userId: t.assignedTo,
          name: getUserName(t.assignedTo),
          role: t.title,
          status: t.status
        }))
    }
    
    return { totalTasks, completedTasks, percentage, stageProgress, teamByStage }
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

  return (
    <div className="space-y-4">
      {/* Manager Pending Permohonan Banner */}
      {isManager && pendingForwardedCount > 0 && (
        <Card className="border-2 border-blue-200 bg-gradient-to-r from-blue-50 to-sky-50">
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="bg-blue-100 p-2 rounded-xl">
                  <Mail className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                    <h3 className="font-semibold text-stone-800">
                      Anda memiliki {pendingForwardedCount} permohonan yang menunggu ditinjau
                    </h3>
                  </div>
                  <p className="text-sm text-stone-500">Permohonan dari Administrator yang perlu ditindaklanjuti</p>
                </div>
              </div>
              <Button
                onClick={() => setActiveView('inbox')}
                className="gap-2 bg-blue-600 hover:bg-blue-700 shrink-0"
              >
                <span>Buka Inbox</span>
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          {/* View Mode Toggle */}
          <div className="flex items-center gap-0.5 bg-white p-1 rounded-xl border border-slate-200 shadow-sm">
            <Button
              variant={viewMode === 'grid' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('grid')}
              className={cn("gap-2", viewMode === 'grid' && "bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700")}
            >
              <LayoutGrid className="w-4 h-4" />
              <span className="hidden sm:inline">Alur Kerja</span>
            </Button>
            <Button
              variant={viewMode === 'table' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('table')}
              className={cn("gap-2", viewMode === 'table' && "bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700")}
            >
              <List className="w-4 h-4" />
              <span className="hidden sm:inline">Tabel</span>
            </Button>
          </div>

          {/* Project Filter Toggle */}
          <div className="flex items-center gap-0.5 bg-white p-1 rounded-xl border border-slate-200 shadow-sm">
            <Button
              variant={projectFilter === 'all' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => { setProjectFilter('all'); setTaskStatusFilter('all'); }}
              className={cn("gap-1.5", projectFilter === 'all' && "bg-gradient-to-r from-slate-700 to-slate-800 hover:from-slate-800 hover:to-slate-900")}
            >
              <Users className="w-4 h-4" />
              <span className="hidden sm:inline">Semua</span>
            </Button>
            <Button
              variant={projectFilter === 'mine' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => { setProjectFilter('mine'); }}
              className={cn("gap-1.5", projectFilter === 'mine' && "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700")}
            >
              <UserCheck className="w-4 h-4" />
              <span className="hidden sm:inline">Tugas Saya</span>
              <span className={cn(
                "text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center",
                projectFilter === 'mine' ? "bg-white/25 text-white" : "bg-emerald-100 text-emerald-700"
              )}>
                {myProjectsCount}
              </span>
            </Button>
            <Button
              variant={projectFilter === 'completed' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => { setProjectFilter('completed'); setTaskStatusFilter('all'); }}
              className={cn("gap-1.5", projectFilter === 'completed' && "bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700")}
            >
              <CircleCheckBig className="w-4 h-4" />
              <span className="hidden sm:inline">Selesai</span>
              <span className={cn(
                "text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center",
                projectFilter === 'completed' ? "bg-white/25 text-white" : "bg-green-100 text-green-700"
              )}>
                {completedProjectsCount}
              </span>
            </Button>
          </div>

          {/* Task Status Sub-Filter — only visible when "Tugas Saya" is selected */}
          {projectFilter === 'mine' && (
            <div className="flex items-center gap-0.5 bg-white p-1 rounded-xl border border-slate-200 shadow-sm">
              <Button
                variant={taskStatusFilter === 'all' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setTaskStatusFilter('all')}
                className={cn("gap-1.5 text-xs", taskStatusFilter === 'all' && "bg-gradient-to-r from-slate-600 to-slate-700 hover:from-slate-700 hover:to-slate-800")}
              >
                <Filter className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Semua</span>
                <span className={cn(
                  "text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center",
                  taskStatusFilter === 'all' ? "bg-white/25 text-white" : "bg-slate-100 text-slate-600"
                )}>
                  {myProjectsCount}
                </span>
              </Button>
              <Button
                variant={taskStatusFilter === 'pending' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setTaskStatusFilter('pending')}
                className={cn("gap-1.5 text-xs", taskStatusFilter === 'pending' && "bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600")}
              >
                <Clock className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Belum</span>
                <span className={cn(
                  "text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center",
                  taskStatusFilter === 'pending' ? "bg-white/25 text-white" : "bg-amber-100 text-amber-700"
                )}>
                  {myPendingCount}
                </span>
              </Button>
              <Button
                variant={taskStatusFilter === 'completed' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setTaskStatusFilter('completed')}
                className={cn("gap-1.5 text-xs", taskStatusFilter === 'completed' && "bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600")}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Selesai</span>
                <span className={cn(
                  "text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center",
                  taskStatusFilter === 'completed' ? "bg-white/25 text-white" : "bg-green-100 text-green-700"
                )}>
                  {myCompletedCount}
                </span>
              </Button>
            </div>
          )}
        </div>

        {canManageProject && (
          <Button
            onClick={() => setActiveView('create')}
            className="gap-2 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 shadow-md shadow-violet-500/20"
          >
            <Plus className="w-4 h-4" />
            <span>Tugas Baru</span>
          </Button>
        )}
      </div>

      {/* Content */}
      {visibleProjects.length === 0 ? (
        <Card className="p-12 text-center">
          <CardContent className="pt-6">
            <FolderKanban className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-slate-800 mb-2">
              {projectFilter === 'mine' && taskStatusFilter === 'pending'
                ? 'Tidak ada tugas yang belum dikerjakan'
                : projectFilter === 'mine' && taskStatusFilter === 'completed'
                ? 'Tidak ada tugas yang sudah selesai'
                : projectFilter === 'mine'
                ? 'Tidak ada tugas untuk Anda'
                : projectFilter === 'completed'
                ? 'Belum ada proyek selesai'
                : 'Belum ada proyek'}
            </h3>
            <p className="text-slate-500">
              {projectFilter === 'mine' && taskStatusFilter === 'pending'
                ? 'Semua tugas Anda sudah selesai dikerjakan. Bagus!'
                : projectFilter === 'mine' && taskStatusFilter === 'completed'
                ? 'Belum ada tugas yang selesai Anda kerjakan.'
                : projectFilter === 'mine'
                ? 'Saat ini tidak ada proyek yang ditugaskan kepada Anda. Coba lihat semua proyek.'
                : projectFilter === 'completed'
                ? 'Belum ada proyek yang telah selesai semua tahapannya.'
                : canManageProject
                  ? 'Mulai dengan membuat proyek perencanaan baru.'
                  : 'Belum ada tugas yang ditugaskan kepada Anda.'}
            </p>
            {projectFilter === 'mine' && taskStatusFilter !== 'all' && (
              <Button
                variant="outline"
                size="sm"
                className="mt-4 gap-2"
                onClick={() => setTaskStatusFilter('all')}
              >
                <Filter className="w-4 h-4" />
                Lihat Semua Tugas Saya
              </Button>
            )}
            {(projectFilter === 'mine' && taskStatusFilter === 'all' || projectFilter === 'completed') && (
              <Button
                variant="outline"
                size="sm"
                className="mt-4 gap-2"
                onClick={() => { setProjectFilter('all'); setTaskStatusFilter('all'); }}
              >
                <Users className="w-4 h-4" />
                Lihat Semua Proyek
              </Button>
            )}
          </CardContent>
        </Card>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 gap-4">
          {visibleProjects.map((project) => {
            const { totalTasks, completedTasks, percentage, stageProgress, teamByStage } = getTaskProgress(project)
            
            return (
              <Card 
                key={project.id} 
                className="group hover:shadow-lg transition-all cursor-pointer relative overflow-hidden"
                onClick={() => { setSelectedProjectId(project.id); setActiveView('project_detail'); }}
              >
                {canManageProject && (
                  <div className="absolute top-3 right-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all z-10">
                    {isSuperAdmin && project.currentStage !== 6 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="bg-white/80 backdrop-blur-sm text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 h-7 w-7"
                        title="Paksa Selesaikan (Super Admin)"
                        onClick={(e) => { e.stopPropagation(); handleForceComplete(project.id, project.title); }}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="bg-white/80 backdrop-blur-sm text-slate-400 hover:text-red-600 hover:bg-red-50 h-7 w-7"
                      onClick={(e) => { e.stopPropagation(); handleDeleteProject(project.id); }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                )}
                
                <CardContent className="p-0">
                  {/* Project Header */}
                  <div className="bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 px-4 py-3 text-white">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-bold text-lg truncate">{project.title}</h3>
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
                              {project.executionTime}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0 ml-3">
                        <div className="text-2xl font-bold">{percentage}%</div>
                        <div className="text-xs text-slate-400">{completedTasks}/{totalTasks} tugas</div>
                      </div>
                    </div>
                  </div>

                  {/* Step Flow Progress with Worker Names Aligned Below */}
                  <div className="bg-slate-50 px-4 py-4 border-b border-slate-200">
                    <div className="flex items-start justify-between">
                      {[1, 2, 3, 4, 5].map((stage, idx) => {
                        const gradient = getStageGradient(stage)
                        const isCompleted = stage < project.currentStage
                        const isCurrent = stage === project.currentStage
                        const isPending = stage > project.currentStage
                        const progress = stageProgress[stage]
                        const stagePercent = progress.total > 0 
                          ? Math.round((progress.completed / progress.total) * 100) 
                          : 0
                        const members = teamByStage[stage]
                        
                        return (
                          <div key={stage} className="flex items-start flex-1">
                            {/* Step Column */}
                            <div className="flex flex-col items-center flex-1 min-w-0">
                              {/* Circle */}
                              <div className={cn(
                                "w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-all border-2 shrink-0",
                                isCompleted ? "bg-green-500 border-green-500 text-white" :
                                isCurrent ? cn(gradient.bg, "border-white shadow-lg text-white") :
                                "bg-white border-slate-300 text-slate-400"
                              )}>
                                {isCompleted ? (
                                  <CheckCircle2 className="w-5 h-5" />
                                ) : (
                                  stage
                                )}
                              </div>
                              {/* Stage Label */}
                              <div className="mt-1.5 text-center">
                                <div className={cn(
                                  "text-[11px] font-semibold leading-tight",
                                  isCompleted ? "text-green-600" :
                                  isCurrent ? gradient.text :
                                  "text-slate-400"
                                )}>
                                  {STAGES[stage]}
                                </div>
                                <div className={cn(
                                  "text-[10px] font-bold mt-0.5",
                                  isCompleted ? "text-green-500" :
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

                                        {/* Status dot */}
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
                                isCompleted ? "bg-green-500" :
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
                </CardContent>
              </Card>
            )
          })}
        </div>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="font-semibold text-xs whitespace-nowrap">Judul Kegiatan</TableHead>
                <TableHead className="font-semibold text-xs whitespace-nowrap">Pemohon</TableHead>
                <TableHead className="font-semibold text-xs whitespace-nowrap">Tempat</TableHead>
                <TableHead className="font-semibold text-xs whitespace-nowrap">Waktu</TableHead>
                <TableHead className="font-semibold text-xs whitespace-nowrap">Tahap</TableHead>
                <TableHead className="font-semibold text-xs whitespace-nowrap">Progress</TableHead>
                <TableHead className="font-semibold text-center text-xs whitespace-nowrap">T1</TableHead>
                <TableHead className="font-semibold text-center text-xs whitespace-nowrap">T2</TableHead>
                <TableHead className="font-semibold text-center text-xs whitespace-nowrap">T3</TableHead>
                <TableHead className="font-semibold text-center text-xs whitespace-nowrap">T4</TableHead>
                {canManageProject && <TableHead className="font-semibold text-right text-xs whitespace-nowrap">Aksi</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleProjects.map((project) => {
                const { percentage, stageProgress } = getTaskProgress(project)
                const currentGradient = getStageGradient(project.currentStage)
                
                return (
                  <TableRow
                    key={project.id}
                    className="cursor-pointer hover:bg-slate-50/50 group"
                    onClick={() => { setSelectedProjectId(project.id); setActiveView('project_detail'); }}
                  >
                    <TableCell>
                      <div className="font-semibold text-slate-800 group-hover:text-slate-600 text-sm">
                        {project.title}
                      </div>
                      <div className="text-xs text-slate-400 font-mono">ID: {project.id.slice(0, 8)}...</div>
                    </TableCell>
                    <TableCell className="text-sm text-slate-600">{project.requesterUnit}</TableCell>
                    <TableCell className="text-sm text-slate-600">{project.location || '-'}</TableCell>
                    <TableCell className="text-sm text-slate-600">{project.executionTime || '-'}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {project.isFastTrack && (
                          <Badge className="bg-amber-500 text-white text-[10px] px-1.5 py-0 border-0">
                            <Zap className="h-2.5 w-2.5 mr-0.5" />FT
                          </Badge>
                        )}
                        {project.isFastProduction && (
                          <Badge className="bg-teal-500 text-white text-[10px] px-1.5 py-0 border-0">
                            <Rocket className="h-2.5 w-2.5 mr-0.5" />FP
                          </Badge>
                        )}
                        <Badge className={cn("text-xs", currentGradient.bg, "text-white border-0")}>
                          T{project.currentStage}: {STAGES[project.currentStage]}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Progress value={percentage} className="h-1.5 w-16" />
                        <span className="text-xs font-bold text-slate-700">{percentage}%</span>
                      </div>
                    </TableCell>
                    {[1, 2, 3, 4, 5].map((stage) => {
                      const progress = stageProgress[stage]
                      const stagePercent = progress.total > 0 
                        ? Math.round((progress.completed / progress.total) * 100) 
                        : 0
                      const gradient = getStageGradient(stage)
                      const isCompleted = stage < project.currentStage
                      const isCurrent = stage === project.currentStage
                      
                      return (
                        <TableCell key={stage} className="text-center">
                          <div className={cn(
                            "inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold",
                            isCompleted ? "bg-green-100 text-green-700" :
                            isCurrent ? cn(gradient.from, gradient.text) :
                            "bg-slate-100 text-slate-500"
                          )}>
                            {stagePercent}%
                          </div>
                        </TableCell>
                      )
                    })}
                    {canManageProject && (
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {isSuperAdmin && project.currentStage !== 6 && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 opacity-0 group-hover:opacity-100 h-7 w-7"
                              title="Paksa Selesaikan (Super Admin)"
                              onClick={(e) => { e.stopPropagation(); handleForceComplete(project.id, project.title); }}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-slate-400 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 h-7 w-7"
                            onClick={(e) => { e.stopPropagation(); handleDeleteProject(project.id); }}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          </div>
        </Card>
      )}
    </div>
  )
}
