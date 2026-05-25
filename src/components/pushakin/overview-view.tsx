'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { useAppStore, STAGES, getRoleDisplayName } from '@/lib/store'
import { 
  Calendar, 
  Share2, 
  TrendingUp, 
  Clock, 
  CheckCircle2,
  XCircle,
  FolderKanban,
  Loader2
} from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'

const FILTER_OPTIONS = [
  { id: 'all', label: 'Semua Waktu' },
  { id: 'day', label: 'Hari Ini' },
  { id: 'week', label: 'Minggu Ini' },
  { id: 'month', label: 'Bulan Ini' },
  { id: 'year', label: 'Tahun Ini' }
]

// Stage gradient colors - Purple, Blue, Orange theme
const STAGE_GRADIENTS: Record<number, { from: string; to: string; border: string; text: string; bg: string }> = {
  1: { from: 'from-violet-100', to: 'to-violet-50', border: 'border-violet-300', text: 'text-violet-700', bg: 'bg-violet-600' },
  2: { from: 'from-orange-100', to: 'to-orange-50', border: 'border-orange-300', text: 'text-orange-700', bg: 'bg-orange-500' },
  3: { from: 'from-blue-100', to: 'to-blue-50', border: 'border-blue-300', text: 'text-blue-700', bg: 'bg-blue-600' },
  4: { from: 'from-purple-100', to: 'to-purple-50', border: 'border-purple-300', text: 'text-purple-700', bg: 'bg-purple-600' },
}

export function OverviewView() {
  const { currentUser, projects, users, showAlert } = useAppStore()
  const [timeFilter, setTimeFilter] = useState('all')
  const [isGenerating, setIsGenerating] = useState(false)

  const isDateInRange = (dateString: string, filter: string) => {
    if (filter === 'all') return true
    if (!dateString) return false
    const d = new Date(dateString)
    const now = new Date()
    
    if (filter === 'day') return d.toDateString() === now.toDateString()
    if (filter === 'week') return (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24) <= 7
    if (filter === 'month') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
    if (filter === 'year') return d.getFullYear() === now.getFullYear()
    return true
  }

  // All users see the same real-time project statistics
  const visibleProjects = projects

  const targetProjects = visibleProjects.filter(p => isDateInRange(p.createdAt, timeFilter))
  
  const totalProjects = targetProjects.length
  const completedCount = targetProjects.filter(p => p.currentStage === 6).length
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

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header & Filter Controls */}
      <Card>
        <CardContent className="p-4 sm:p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
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

          <Button
            onClick={handleSharePublic}
            disabled={isGenerating}
            className="gap-2 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white shrink-0"
          >
            {isGenerating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Share2 className="w-4 h-4" />
            )}
            <span>Bagikan ke Publik</span>
          </Button>
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
          ) : (
            <div className="space-y-4">
              {targetProjects.map(project => {
                const { percentage, stageProgress, teamByStage } = getTaskProgress(project)
                const isCompleted = project.currentStage === 6

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
                        <div>
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
                          <h4 className="font-bold text-lg">{project.title}</h4>
                          <p className="text-xs text-slate-400">{project.requesterUnit}</p>
                        </div>
                        <div className="text-right">
                          <div className="text-3xl font-bold">{percentage}%</div>
                        </div>
                      </div>
                    </div>

                    {/* Step Flow Progress */}
                    <div className="bg-slate-50 px-4 py-4 border-b border-slate-200">
                      <div className="flex items-center justify-between">
                        {[1, 2, 3, 4, 5].map((stage, idx) => {
                          const gradient = STAGE_GRADIENTS[stage]
                          const isStageCompleted = stage < project.currentStage
                          const isCurrent = stage === project.currentStage
                          const isPending = stage > project.currentStage
                          const progress = stageProgress[stage]
                          const stagePercent = progress.total > 0 
                            ? Math.round((progress.completed / progress.total) * 100) 
                            : 0
                          
                          return (
                            <div key={stage} className="flex items-center flex-1">
                              {/* Step Node */}
                              <div className="flex flex-col items-center">
                                {/* Circle */}
                                <div className={cn(
                                  "w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-all border-2",
                                  isStageCompleted ? "bg-green-500 border-green-500 text-white" :
                                  isCurrent ? cn(gradient.bg, "border-white shadow-lg text-white") :
                                  "bg-white border-slate-300 text-slate-400"
                                )}>
                                  {isStageCompleted ? (
                                    <CheckCircle2 className="w-5 h-5" />
                                  ) : (
                                    stage
                                  )}
                                </div>
                                {/* Label */}
                                <div className="mt-2 text-center">
                                  <div className={cn(
                                    "text-xs font-semibold",
                                    isStageCompleted ? "text-green-600" :
                                    isCurrent ? gradient.text :
                                    "text-slate-400"
                                  )}>
                                    {STAGES[stage]}
                                  </div>
                                  <div className={cn(
                                    "text-[10px] font-bold mt-0.5",
                                    isStageCompleted ? "text-green-500" :
                                    isCurrent ? gradient.text :
                                    "text-slate-400"
                                  )}>
                                    {stagePercent}%
                                  </div>
                                </div>
                              </div>
                              
                              {/* Connector Line */}
                              {idx < 3 && (
                                <div className={cn(
                                  "flex-1 h-0.5 mx-2 rounded-full",
                                  isStageCompleted ? "bg-green-500" :
                                  isCurrent ? "bg-gradient-to-r from-slate-300 to-slate-300" :
                                  "bg-slate-300"
                                )}></div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    {/* Team Members by Stage */}
                    <div className="p-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                        {[1, 2, 3, 4, 5].map((stage) => {
                          const members = teamByStage[stage]
                          const progress = stageProgress[stage]
                          const gradient = STAGE_GRADIENTS[stage]
                          const isStageCompleted = stage < project.currentStage
                          const isCurrent = stage === project.currentStage
                          const isPending = stage > project.currentStage
                          
                          return (
                            <div 
                              key={stage}
                              className={cn(
                                "rounded-xl border-2 overflow-hidden transition-all",
                                isStageCompleted ? "border-green-300 bg-gradient-to-b from-green-50 to-white" :
                                isCurrent ? cn("border-2", gradient.border, "bg-gradient-to-b", gradient.from, gradient.to) :
                                "border-slate-200 bg-gradient-to-b from-slate-50 to-white opacity-60"
                              )}
                            >
                              {/* Team Members Only - No Stage Header */}
                              <div className="p-2 space-y-1.5 min-h-[80px]">
                                {members.length === 0 ? (
                                  <div className="text-xs text-slate-400 text-center py-4">
                                    Tidak ada petugas
                                  </div>
                                ) : (
                                  members.map((member, idx) => {
                                    const avatar = getUserAvatar(member.userId)
                                    const isTaskCompleted = member.status === 'completed'
                                    const isTaskInProgress = member.status === 'in_progress'
                                    const isLocked = isPending
                                    
                                    return (
                                      <div 
                                        key={idx}
                                        className={cn(
                                          "flex items-center gap-2 px-2 py-1.5 rounded-lg transition-all",
                                          isTaskCompleted ? "bg-green-50" :
                                          isLocked ? "bg-slate-100" :
                                          "bg-white border border-slate-200"
                                        )}
                                      >
                                        {/* Avatar */}
                                        {avatar ? (
                                          <img 
                                            src={avatar} 
                                            alt={member.name}
                                            className="w-7 h-7 rounded-full object-cover border-2 border-white shadow-sm"
                                          />
                                        ) : (
                                          <div className={cn(
                                            "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white",
                                            isTaskCompleted ? "bg-green-500" :
                                            isTaskInProgress ? "bg-orange-500" :
                                            "bg-slate-400"
                                          )}>
                                            {member.name.charAt(0).toUpperCase()}
                                          </div>
                                        )}
                                        
                                        {/* Name & Role */}
                                        <div className="flex-1 min-w-0">
                                          <div className={cn(
                                            "text-xs font-semibold truncate",
                                            isTaskCompleted ? "text-green-700" :
                                            isLocked ? "text-slate-400" :
                                            "text-slate-700"
                                          )}>
                                            {member.name}
                                          </div>
                                          <div className="text-[10px] text-slate-500 truncate">
                                            {getRoleDisplayName(member.role)}
                                          </div>
                                        </div>
                                        
                                        {/* Status Icon */}
                                        <div className="shrink-0">
                                          {isTaskCompleted ? (
                                            <CheckCircle2 className="w-5 h-5 text-orange-500" />
                                          ) : (
                                            <XCircle className="w-5 h-5 text-violet-500" />
                                          )}
                                        </div>
                                      </div>
                                    )
                                  })
                                )}
                              </div>

                              {/* Stage Progress Bar */}
                              <div className="px-3 pb-2">
                                <Progress 
                                  value={progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0} 
                                  className={cn(
                                    "h-1.5",
                                    isStageCompleted ? "[&>div]:bg-green-500" :
                                    isCurrent ? `[&>div]:${gradient.bg}` :
                                    "[&>div]:bg-slate-400"
                                  )} 
                                />
                              </div>
                            </div>
                          )
                        })}
                      </div>
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
