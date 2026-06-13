'use client'

import { Badge } from '@/components/ui/badge'
import { useAppStore, STAGES } from '@/lib/store'
import { 
  CheckCircle2,
  Clock,
  XCircle,
  TrendingUp,
  FolderKanban,
  RefreshCw,
  LayoutGrid,
  ChevronDown,
  Menu,
  X
} from 'lucide-react'
import { useState, useEffect, useCallback, useRef } from 'react'
import { cn } from '@/lib/utils'

interface PublicTask {
  id: string
  role: string
  stage: number
  status: string
  data: string | null
  assignee: {
    id: string
    name: string
    avatar: string | null
    role: string
  }
}

interface PublicProject {
  id: string
  title: string
  description: string
  requesterUnit: string
  location: string | null
  executionTime: string | null
  picName: string | null
  picWhatsApp: string | null
  currentStage: number
  publicToken: string | null
  createdAt: string
  tasks: PublicTask[]
  manager: {
    id: string
    name: string
    avatar: string | null
  }
}

interface PublicTrackerViewProps {
  onBack: () => void
}

const FILTER_OPTIONS = [
  { id: 'all', label: 'Semua' },
  { id: 'active', label: 'Berjalan' },
  { id: 'day', label: 'Hari Ini' },
  { id: 'week', label: 'Minggu Ini' },
  { id: 'month', label: 'Bulan Ini' },
  { id: 'year', label: 'Tahun Ini' }
]

// Mobile shows subset; full list available via scroll or drawer
const MOBILE_FILTER_KEYS = ['all', 'active', 'day']

const STAGE_COLORS: Record<number, { bg: string; border: string; text: string }> = {
  1: { bg: 'bg-violet-600', border: 'border-violet-400', text: 'text-violet-400' },
  2: { bg: 'bg-orange-500', border: 'border-orange-400', text: 'text-orange-400' },
  3: { bg: 'bg-blue-600', border: 'border-blue-400', text: 'text-blue-400' },
  4: { bg: 'bg-purple-600', border: 'border-purple-400', text: 'text-purple-400' },
  5: { bg: 'bg-teal-600', border: 'border-teal-400', text: 'text-teal-400' },
  6: { bg: 'bg-emerald-600', border: 'border-emerald-400', text: 'text-emerald-400' },
}

const DEFAULT_STAGE_COLOR = { bg: 'bg-slate-600', border: 'border-slate-400', text: 'text-slate-400' }

function getStageColors(stage: number) {
  return STAGE_COLORS[stage] || DEFAULT_STAGE_COLOR
}

const AUTO_REFRESH_INTERVAL = 30 * 60 * 1000 // 30 minutes
const AUTO_PLAY_INTERVAL = 8000 // 8 seconds between pages

const GRID_OPTIONS = [
  { id: '1x1', cols: 1, rows: 1, label: '1 × 1', count: 1 },
  { id: '2x1', cols: 2, rows: 1, label: '2 × 1', count: 2 },
  { id: '2x2', cols: 2, rows: 2, label: '2 × 2', count: 4 },
  { id: '3x2', cols: 3, rows: 2, label: '3 × 2', count: 6 },
  { id: '2x3', cols: 2, rows: 3, label: '2 × 3', count: 6 },
  { id: '4x2', cols: 4, rows: 2, label: '4 × 2', count: 8 },
  { id: '3x3', cols: 3, rows: 3, label: '3 × 3', count: 9 },
  { id: '4x3', cols: 4, rows: 3, label: '4 × 3', count: 12 },
  { id: '2x4', cols: 2, rows: 4, label: '2 × 4', count: 8 },
  { id: '5x2', cols: 5, rows: 2, label: '5 × 2', count: 10 },
  { id: '4x4', cols: 4, rows: 4, label: '4 × 4', count: 16 },
]

/**
 * Returns the best default grid layout id for the given viewport width.
 * Mobile (<640px): 1x1   Small tablet (640-768px): 2x1
 * Tablet (768-1024px): 2x2   Laptop+ (1024px+): 4x2
 */
function getAutoGridLayout(width: number): string {
  if (width < 640) return '1x1'
  if (width < 768) return '2x1'
  if (width < 1024) return '2x2'
  return '4x2'
}

export function PublicTrackerView({ onBack }: PublicTrackerViewProps) {
  const { showAlert } = useAppStore()
  const [projects, setProjects] = useState<PublicProject[]>([])
  const [allProjects, setAllProjects] = useState<PublicProject[]>([])
  const [stats, setStats] = useState({ total: 0, completed: 0, active: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [timeFilter, setTimeFilter] = useState('active')
  const [currentPage, setCurrentPage] = useState(0)
  const [currentTime, setCurrentTime] = useState(new Date())
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [gridLayout, setGridLayout] = useState('4x2')
  const [showGridMenu, setShowGridMenu] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [autoGridLayout, setAutoGridLayout] = useState(false)
  const gridMenuRef = useRef<HTMLDivElement>(null)
  const filterScrollRef = useRef<HTMLDivElement>(null)

  const currentGrid = GRID_OPTIONS.find(g => g.id === gridLayout) || GRID_OPTIONS[5]
  const PROJECTS_PER_PAGE = currentGrid.count

  // ── Auto-detect screen size and set grid layout ──────────────────────
  useEffect(() => {
    const determineLayout = () => {
      const w = window.innerWidth
      const autoId = getAutoGridLayout(w)
      setAutoGridLayout(true)
      setGridLayout(autoId)
    }

    // Set on mount
    determineLayout()

    // Listen for resize with debounce
    let timeout: ReturnType<typeof setTimeout>
    const onResize = () => {
      clearTimeout(timeout)
      timeout = setTimeout(determineLayout, 200)
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      clearTimeout(timeout)
    }
  }, [])

  // Close grid menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (gridMenuRef.current && !gridMenuRef.current.contains(e.target as Node)) {
        setShowGridMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const fetchProjects = useCallback(async (filter: string, silent = false) => {
    if (!silent) setLoading(true)
    else setIsRefreshing(true)
    try {
      const response = await fetch(`/api/public-tracker?filter=${filter}`)
      const data = await response.json()
      
      if (!response.ok) {
        setError(data.error || 'Failed to load data')
        return
      }
      
      setStats(data.stats)
      setAllProjects(data.projects)
      setLastUpdated(new Date())
      setCurrentPage(0)
    } catch (err) {
      if (!silent) setError('Failed to load projects')
    } finally {
      setLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  // Filter projects based on client-side filter
  useEffect(() => {
    let filtered = allProjects
    if (timeFilter === 'active') {
      filtered = allProjects.filter(p => p.currentStage < 6)
    }
    setProjects(filtered)
    setCurrentPage(0)
  }, [allProjects, timeFilter])

  // Initial fetch
  useEffect(() => {
    fetchProjects('all')
  }, [fetchProjects])

  // Auto-refresh every 30 minutes
  useEffect(() => {
    const timer = setInterval(() => {
      fetchProjects('all', true)
    }, AUTO_REFRESH_INTERVAL)
    return () => clearInterval(timer)
  }, [fetchProjects])

  // Update time every second
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // Reset page when grid layout changes
  useEffect(() => {
    setCurrentPage(0)
  }, [gridLayout])

  // Auto pagination (skip on mobile when user is likely scrolling)
  useEffect(() => {
    if (projects.length <= PROJECTS_PER_PAGE) return
    if (currentGrid.cols <= 2 && currentGrid.rows <= 1) return // skip on 1x1 and 2x1
    
    const totalPages = Math.ceil(projects.length / PROJECTS_PER_PAGE)
    const timer = setInterval(() => {
      setCurrentPage(prev => (prev + 1) % totalPages)
    }, AUTO_PLAY_INTERVAL)
    
    return () => clearInterval(timer)
  }, [projects.length, PROJECTS_PER_PAGE, currentGrid.cols, currentGrid.rows])

  const getTaskProgress = (project: PublicProject) => {
    const totalTasks = project.tasks.length
    const completedTasks = project.tasks.filter(t => t.status === 'completed').length
    const percentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
    
    const stageProgress: Record<number, { total: number; completed: number }> = {}
    for (let stage = 1; stage <= 5; stage++) {
      const stageTasks = project.tasks.filter(t => t.stage === stage)
      stageProgress[stage] = {
        total: stageTasks.length,
        completed: stageTasks.filter(t => t.status === 'completed').length
      }
    }
    
    const teamByStage: Record<number, Array<{ name: string; status: string; avatar: string | null }>> = {}
    for (let stage = 1; stage <= 5; stage++) {
      teamByStage[stage] = project.tasks
        .filter(t => t.stage === stage)
        .map(t => ({
          name: t.assignee.name,
          status: t.status,
          avatar: t.assignee.avatar
        }))
    }
    
    return { percentage, stageProgress, teamByStage }
  }

  const currentProjects = projects.slice(
    currentPage * PROJECTS_PER_PAGE,
    (currentPage + 1) * PROJECTS_PER_PAGE
  )

  const totalPages = Math.ceil(projects.length / PROJECTS_PER_PAGE)

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  }

  const formatLastUpdated = (date: Date) => {
    return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
  }

  const handleGridSelect = (id: string) => {
    setGridLayout(id)
    setAutoGridLayout(false)
    setShowGridMenu(false)
    setMobileMenuOpen(false)
  }

  // ── Loading / Error states ──────────────────────────────────────────
  if (loading) {
    return (
      <div className="fixed inset-0 bg-slate-900 flex items-center justify-center">
        <div className="text-center text-white">
          <div className="w-16 h-16 border-4 border-violet-400 border-t-violet-600 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-xl">Memuat data...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="fixed inset-0 bg-slate-900 flex items-center justify-center p-4">
        <div className="text-center text-white">
          <XCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <p className="text-xl mb-4">{error}</p>
          <button 
            onClick={onBack} 
            className="text-violet-400 hover:text-violet-300 min-h-[44px] min-w-[44px] inline-flex items-center justify-center px-6 rounded-lg border border-violet-500/50"
          >
            Kembali ke Aplikasi
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-slate-900 overflow-hidden">
      <div className="w-full h-full flex flex-col">
        
        {/* ═══════════════════════════════════════════════════════════════
            HEADER — Mobile: stacked | Tablet+: single row
        ═══════════════════════════════════════════════════════════════ */}
        <header className="bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 border-b border-slate-700 shrink-0">
          {/* Mobile header — stacked vertically */}
          <div className="flex flex-col sm:hidden">
            {/* Row 1: Logo + title + hamburger */}
            <div className="flex items-center justify-between px-3 py-2.5">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <div className="bg-gradient-to-br from-violet-500 to-purple-600 p-2 rounded-lg shrink-0">
                  <FolderKanban className="w-5 h-5 text-white" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-base font-bold text-white tracking-wide leading-tight truncate">PUSHAKIN FLOWS</h1>
                  <span className="text-[11px] font-semibold text-violet-400">Sistem Manajemen Produksi</span>
                </div>
              </div>
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                aria-label="Menu"
              >
                {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            </div>

            {/* Row 2: Clock */}
            <div className="text-center pb-2">
              <div className="text-xl font-bold text-white font-mono tracking-wider leading-tight">
                {formatTime(currentTime)}
              </div>
              <div className="text-[11px] text-slate-400 leading-tight mt-0.5">
                {formatDate(currentTime)}
              </div>
            </div>

            {/* Mobile menu drawer */}
            {mobileMenuOpen && (
              <div className="border-t border-slate-700 bg-slate-800/95 backdrop-blur px-3 py-3 space-y-3">
                {/* Filter pills — mobile (scrollable row) */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none" ref={filterScrollRef}>
                  {FILTER_OPTIONS.map(opt => (
                    <button
                      key={opt.id}
                      onClick={() => { setTimeFilter(opt.id); setMobileMenuOpen(false) }}
                      className={cn(
                        "px-3 py-2 text-xs font-medium rounded-lg whitespace-nowrap transition-all min-h-[36px]",
                        timeFilter === opt.id 
                          ? "bg-gradient-to-r from-violet-600 to-purple-600 text-white shadow-lg" 
                          : "text-slate-400 hover:text-white bg-slate-700/50"
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* Grid selector — mobile */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 font-medium shrink-0">Grid:</span>
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
                    {GRID_OPTIONS.filter(g => g.cols <= 2 && g.rows <= 2 || g.cols * g.rows <= 6).map(opt => (
                      <button
                        key={opt.id}
                        onClick={() => handleGridSelect(opt.id)}
                        className={cn(
                          "px-2.5 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap transition-all min-h-[36px]",
                          gridLayout === opt.id
                            ? "bg-violet-600/20 text-violet-400 border border-violet-500/50"
                            : "text-slate-400 hover:text-white border border-slate-600"
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Refresh button — mobile */}
                <button
                  onClick={() => { fetchProjects('all', true); setMobileMenuOpen(false) }}
                  className={cn(
                    "flex items-center justify-center gap-2 w-full py-2.5 rounded-lg text-sm font-medium transition-all min-h-[44px]",
                    isRefreshing
                      ? "bg-violet-600/20 text-violet-400 border border-violet-500/50"
                      : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                  )}
                >
                  <RefreshCw className={cn("w-4 h-4", isRefreshing && "animate-spin")} />
                  Refresh Data
                </button>
              </div>
            )}
          </div>

          {/* Desktop header — single row */}
          <div className="hidden sm:flex items-center justify-between px-4 py-2 lg:py-1.5 xl:py-2 h-auto">
            {/* Left: Logo + title */}
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="bg-gradient-to-br from-violet-500 to-purple-600 p-1.5 rounded-lg shrink-0">
                <FolderKanban className="w-5 h-5 text-white" />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg font-bold text-white tracking-wide leading-tight">PUSHAKIN FLOWS</h1>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-semibold text-violet-400">Sistem Manajemen Produksi</span>
                  <span className="text-slate-500 text-[10px]">|</span>
                  <span className="text-[9px] text-slate-400 hidden lg:inline">Tim Pusat Hubungan Masyarakat dan Keterbukaan Informasi</span>
                </div>
              </div>
            </div>
            
            {/* Center: Time */}
            <div className="text-center shrink-0">
              <div className="text-xl lg:text-2xl font-bold text-white font-mono tracking-wider leading-tight">
                {formatTime(currentTime)}
              </div>
              <div className="text-[10px] lg:text-[11px] text-slate-400 leading-tight">
                {formatDate(currentTime)}
              </div>
            </div>

            {/* Right: Grid Layout + Filter + Refresh */}
            <div className="flex items-center gap-1.5 lg:gap-2 shrink-0">
              {/* Grid Layout Selector */}
              <div className="relative" ref={gridMenuRef}>
                <button 
                  onClick={() => setShowGridMenu(!showGridMenu)}
                  className="flex items-center gap-1 px-2 py-1.5 text-[10px] font-medium rounded-lg border border-slate-600 text-slate-400 hover:text-white hover:border-slate-500 transition-all min-h-[36px]"
                  title="Atur tata letak grid"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  <span>{currentGrid.label}</span>
                  <ChevronDown className={cn("w-3 h-3 transition-transform", showGridMenu && "rotate-180")} />
                </button>
                {showGridMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowGridMenu(false)} />
                    <div className="absolute right-0 top-full mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-50 py-1 min-w-[120px]">
                      <div className="px-2 py-1 text-[9px] font-semibold text-slate-500 uppercase tracking-wider">Tata Letak Layar</div>
                      {GRID_OPTIONS.map(opt => (
                        <button
                          key={opt.id}
                          onClick={() => handleGridSelect(opt.id)}
                          className={cn(
                            "w-full px-2.5 py-1.5 text-[10px] font-medium flex items-center justify-between hover:bg-slate-700 transition-colors min-h-[36px]",
                            gridLayout === opt.id ? "text-violet-400 bg-violet-500/10" : "text-slate-300"
                          )}
                        >
                          <span>{opt.label}</span>
                          <span className="text-[9px] text-slate-500">{opt.count} proyek</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <button 
                onClick={() => fetchProjects('all', true)}
                className={cn(
                  "p-1.5 rounded-lg transition-all border min-h-[36px] min-w-[36px] flex items-center justify-center",
                  isRefreshing 
                    ? "border-violet-500 text-violet-400" 
                    : "border-slate-600 text-slate-400 hover:text-white hover:border-slate-500"
                )}
                title="Refresh data"
              >
                <RefreshCw className={cn("w-4 h-4", isRefreshing && "animate-spin")} />
              </button>
              {/* Filter pills — desktop (scrollable on medium screens) */}
              <div className="flex items-center gap-0.5 bg-slate-800 rounded-lg p-0.5 overflow-x-auto max-w-[340px] lg:max-w-none scrollbar-none">
                {FILTER_OPTIONS.map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => setTimeFilter(opt.id)}
                    className={cn(
                      "px-2 py-1 text-[10px] font-medium rounded transition-all whitespace-nowrap min-h-[32px] flex items-center",
                      timeFilter === opt.id 
                        ? "bg-gradient-to-r from-violet-600 to-purple-600 text-white" 
                        : "text-slate-400 hover:text-white"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </header>

        {/* ═══════════════════════════════════════════════════════════════
            MAIN CONTENT
        ═══════════════════════════════════════════════════════════════ */}
        <div className="flex-1 p-2 sm:p-3 lg:p-4 flex flex-col gap-2 sm:gap-2.5 lg:gap-3 overflow-hidden">
          
          {/* ── Stats Row ───────────────────────────────────────────── */}
          {/* Mobile: vertical stack */}
          <div className="sm:hidden flex flex-col gap-2 shrink-0">
            <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-lg p-3 border border-slate-700 flex items-center gap-3">
              <div className="p-2 bg-blue-500/20 rounded-lg shrink-0">
                <TrendingUp className="w-6 h-6 text-blue-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-white leading-tight">{stats.total}</div>
                <div className="text-xs text-slate-400 uppercase tracking-wider">Total Proyek</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-gradient-to-br from-orange-600 to-orange-700 rounded-lg p-3 border border-orange-500/30 flex items-center gap-2.5">
                <div className="p-1.5 bg-white/20 rounded-lg shrink-0">
                  <Clock className="w-5 h-5 text-white" />
                </div>
                <div>
                  <div className="text-xl font-bold text-white leading-tight">{stats.active}</div>
                  <div className="text-[10px] text-orange-100 uppercase tracking-wider leading-tight">Berjalan</div>
                </div>
              </div>
              <div className="bg-gradient-to-br from-violet-600 to-purple-700 rounded-lg p-3 border border-violet-500/30 flex items-center gap-2.5">
                <div className="p-1.5 bg-white/20 rounded-lg shrink-0">
                  <CheckCircle2 className="w-5 h-5 text-white" />
                </div>
                <div>
                  <div className="text-xl font-bold text-white leading-tight">{stats.completed}</div>
                  <div className="text-[10px] text-violet-100 uppercase tracking-wider leading-tight">Selesai</div>
                </div>
              </div>
            </div>
          </div>

          {/* Tablet+: 3-column grid */}
          <div className="hidden sm:grid sm:grid-cols-3 gap-3 shrink-0">
            {/* Total */}
            <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-lg p-3 border border-slate-700 flex items-center gap-3">
              <div className="p-2 bg-blue-500/20 rounded-lg shrink-0">
                <TrendingUp className="w-6 h-6 text-blue-400" />
              </div>
              <div>
                <div className="text-2xl lg:text-3xl font-bold text-white leading-tight">{stats.total}</div>
                <div className="text-[11px] text-slate-400 uppercase tracking-wider">Total Proyek</div>
              </div>
            </div>
            {/* Active */}
            <div className="bg-gradient-to-br from-orange-600 to-orange-700 rounded-lg p-3 border border-orange-500/30 flex items-center gap-3">
              <div className="p-2 bg-white/20 rounded-lg shrink-0">
                <Clock className="w-6 h-6 text-white" />
              </div>
              <div>
                <div className="text-2xl lg:text-3xl font-bold text-white leading-tight">{stats.active}</div>
                <div className="text-[11px] text-orange-100 uppercase tracking-wider">Sedang Berjalan</div>
              </div>
            </div>
            {/* Completed */}
            <div className="bg-gradient-to-br from-violet-600 to-purple-700 rounded-lg p-3 border border-violet-500/30 flex items-center gap-3">
              <div className="p-2 bg-white/20 rounded-lg shrink-0">
                <CheckCircle2 className="w-6 h-6 text-white" />
              </div>
              <div>
                <div className="text-2xl lg:text-3xl font-bold text-white leading-tight">{stats.completed}</div>
                <div className="text-[11px] text-violet-100 uppercase tracking-wider">Telah Selesai</div>
              </div>
            </div>
          </div>

          {/* ── Projects Grid ───────────────────────────────────────── */}
          <div className="flex-1 flex flex-col gap-2 overflow-hidden">
            {projects.length === 0 ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center text-slate-500">
                  <FolderKanban className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p className="text-base">Tidak ada proyek untuk ditampilkan</p>
                </div>
              </div>
            ) : (
              <>
                {/* Project Cards — Dynamic grid */}
                <div 
                  className="flex-1 grid gap-2 sm:gap-2.5 lg:gap-3"
                  style={{ 
                    gridTemplateColumns: `repeat(${currentGrid.cols}, 1fr)`,
                    gridTemplateRows: currentGrid.rows > 1 ? `repeat(${currentGrid.rows}, 1fr)` : undefined
                  }}
                >
                  {/* Filler cards */}
                  {currentProjects.length < currentGrid.count &&
                    Array.from({ length: currentGrid.count - currentProjects.length }, (_, i) => (
                      <div key={`empty-${i}`} className="rounded-lg border border-dashed border-slate-700/50 bg-slate-800/30" />
                    ))}
                  {currentProjects.map(project => {
                    const { percentage, stageProgress, teamByStage } = getTaskProgress(project)
                    const isCompleted = project.currentStage === 6
                    const currentStage = Math.min(project.currentStage, 5)

                    return (
                      <div
                        key={project.id}
                        className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden flex flex-col min-h-0"
                      >
                        {/* Project Header */}
                        <div className="bg-gradient-to-r from-slate-900/80 via-blue-950/50 to-slate-900/80 px-2 sm:px-2.5 py-1.5 sm:py-2 flex items-center justify-between shrink-0 border-b border-slate-700/50">
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            <Badge className={cn(
                              "shrink-0 text-[9px] sm:text-[8px] font-bold uppercase px-1.5 py-0",
                              isCompleted ? "bg-green-500/90" : "bg-orange-500/90"
                            )}>
                              {isCompleted ? 'Selesai' : 'Aktif'}
                            </Badge>
                            <h3 className="text-xs sm:text-[11px] font-bold text-white truncate leading-tight">{project.title}</h3>
                          </div>
                          <div className={cn(
                            "text-base sm:text-sm font-bold shrink-0 ml-1.5",
                            isCompleted ? "text-green-400" : percentage === 100 ? "text-green-400" : "text-white"
                          )}>{percentage}%</div>
                        </div>

                        {/* ── Unified Pipeline + Workers ────────────────── */}
                        <div className="flex-1 px-2 sm:px-2.5 py-1.5 sm:py-2 overflow-hidden flex flex-col">
                          {/* Mobile: vertical stage list with workers */}
                          <div className="flex flex-col gap-1.5 sm:hidden overflow-y-auto flex-1">
                            {[1, 2, 3, 4, 5].map((stage) => {
                              const colors = getStageColors(stage)
                              const isStageCompleted = stage < project.currentStage
                              const isCurrent = stage === project.currentStage
                              const isPending = stage > project.currentStage
                              const progress = stageProgress[stage]
                              const stagePercent = progress.total > 0 
                                ? Math.round((progress.completed / progress.total) * 100) 
                                : 0
                              const members = teamByStage[stage]
                              
                              return (
                                <div 
                                  key={stage}
                                  className={cn(
                                    "flex items-start gap-2 rounded-lg px-2 py-1.5 border shrink-0",
                                    isStageCompleted ? "bg-green-900/20 border-green-800/50" :
                                    isCurrent ? cn(colors.bg, "/20 border", colors.border, "/40") :
                                    "bg-slate-800/50 border-slate-700/30"
                                  )}
                                >
                                  {/* Circle */}
                                  <div className={cn(
                                    "w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold border shrink-0",
                                    isStageCompleted ? "bg-green-500 border-green-400 text-white" :
                                    isCurrent ? cn(colors.bg, "border-white/40 text-white shadow-md") :
                                    "bg-slate-800 border-slate-700 text-slate-500"
                                  )}>
                                    {isStageCompleted ? <CheckCircle2 className="w-4 h-4" /> : stage}
                                  </div>
                                  {/* Stage Info + Workers */}
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between">
                                      <span className={cn(
                                        "text-[11px] font-semibold truncate",
                                        isStageCompleted ? "text-green-400" : isCurrent ? "text-white" : "text-slate-500"
                                      )}>
                                        {STAGES[stage]}
                                      </span>
                                      <span className={cn(
                                        "text-[10px] font-bold ml-1 shrink-0",
                                        isStageCompleted ? "text-green-400" : isCurrent ? "text-white" : "text-slate-600"
                                      )}>
                                        {stagePercent}%
                                      </span>
                                    </div>
                                    {/* Workers */}
                                    <div className="mt-1 space-y-0.5">
                                      {members.length === 0 ? (
                                        <div className="text-[10px] text-slate-600 py-0.5">—</div>
                                      ) : (
                                        members.slice(0, 3).map((member, midx) => {
                                          const isTaskCompleted = member.status === 'completed'
                                          return (
                                            <div key={midx} className="flex items-center gap-1.5 min-h-[22px]">
                                              {/* Mini Avatar */}
                                              {member.avatar ? (
                                                <img 
                                                  src={member.avatar} 
                                                  alt={member.name}
                                                  className="w-4 h-4 rounded-full object-cover border border-white/20 shrink-0" 
                                                />
                                              ) : (
                                                <div className={cn(
                                                  "w-4 h-4 rounded-full flex items-center justify-center text-[7px] font-bold text-white shrink-0",
                                                  isTaskCompleted ? "bg-green-500" : isPending ? "bg-slate-700" : colors.bg
                                                )}>
                                                  {member.name.charAt(0)}
                                                </div>
                                              )}
                                              <span className={cn(
                                                "text-[10px] truncate flex-1",
                                                isTaskCompleted ? "text-green-300" : isPending ? "text-slate-500" : "text-slate-300"
                                              )}>
                                                {member.name.split(' ').slice(0, 2).join(' ')}
                                              </span>
                                              {isTaskCompleted ? (
                                                <CheckCircle2 className="w-3 h-3 text-green-400 shrink-0" />
                                              ) : !isPending ? (
                                                <Clock className="w-3 h-3 text-amber-400 shrink-0" />
                                              ) : null}
                                            </div>
                                          )
                                        })
                                      )}
                                      {members.length > 3 && (
                                        <div className="text-[9px] text-slate-500 text-center">+{members.length - 3} lainnya</div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )
                            })}
                          </div>

                          {/* Desktop/Tablet: horizontal pipeline with workers below each stage */}
                          <div className="hidden sm:flex items-start justify-between gap-0 flex-1 min-h-0">
                            {[1, 2, 3, 4, 5].map((stage, idx) => {
                              const colors = getStageColors(stage)
                              const isStageCompleted = stage < project.currentStage
                              const isCurrent = stage === project.currentStage
                              const isPending = stage > project.currentStage
                              const progress = stageProgress[stage]
                              const stagePercent = progress.total > 0 
                                ? Math.round((progress.completed / progress.total) * 100) 
                                : 0
                              const members = teamByStage[stage]
                              
                              return (
                                <div key={stage} className="flex items-start flex-1 min-w-0">
                                  {/* Stage Column */}
                                  <div className="flex flex-col items-center flex-1 min-w-0">
                                    {/* Circle */}
                                    <div className={cn(
                                      "w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold border shrink-0",
                                      isStageCompleted ? "bg-green-500 border-green-400 text-white" :
                                      isCurrent ? cn(colors.bg, "border-white/40 text-white shadow-md") :
                                      "bg-slate-800 border-slate-700 text-slate-500"
                                    )}>
                                      {isStageCompleted ? <CheckCircle2 className="w-3 h-3" /> : stage}
                                    </div>
                                    {/* Stage Label */}
                                    <div className="mt-0.5 text-center">
                                      <div className={cn(
                                        "text-[7px] lg:text-[8px] font-semibold leading-tight truncate max-w-[60px] lg:max-w-[80px]",
                                        isStageCompleted ? "text-green-400" : isCurrent ? "text-white" : "text-slate-500"
                                      )}>
                                        {STAGES[stage]}
                                      </div>
                                      <div className={cn(
                                        "text-[8px] lg:text-[9px] font-bold leading-tight",
                                        isStageCompleted ? "text-green-400" : isCurrent ? "text-white" : "text-slate-600"
                                      )}>
                                        {stagePercent}%
                                      </div>
                                    </div>
                                    
                                    {/* Workers Aligned Below Stage */}
                                    <div className="mt-1 w-full space-y-px overflow-hidden">
                                      {members.length === 0 ? (
                                        <div className="text-[7px] text-slate-600 text-center py-0.5">—</div>
                                      ) : (
                                        members.slice(0, 3).map((member, midx) => {
                                          const isTaskCompleted = member.status === 'completed'
                                          return (
                                            <div 
                                              key={midx}
                                              className={cn(
                                                "flex items-center gap-0.5 px-1 py-px rounded leading-tight",
                                                isTaskCompleted ? "bg-green-900/30" :
                                                isPending ? "bg-slate-800/50" :
                                                "bg-slate-700/30"
                                              )}
                                            >
                                              {/* Mini Avatar */}
                                              {member.avatar ? (
                                                <img 
                                                  src={member.avatar} 
                                                  alt={member.name}
                                                  className="w-3 h-3 rounded-full object-cover border border-white/20 shrink-0" 
                                                />
                                              ) : (
                                                <div className={cn(
                                                  "w-3 h-3 rounded-full flex items-center justify-center text-[6px] font-bold text-white shrink-0",
                                                  isTaskCompleted ? "bg-green-500" : isPending ? "bg-slate-700" : colors.bg
                                                )}>
                                                  {member.name.charAt(0)}
                                                </div>
                                              )}
                                              <span className={cn(
                                                "text-[7px] lg:text-[8px] truncate flex-1",
                                                isTaskCompleted ? "text-green-300" : isPending ? "text-slate-500" : "text-slate-300"
                                              )}>
                                                {member.name.split(' ').slice(0, 2).join(' ')}
                                              </span>
                                              {isTaskCompleted ? (
                                                <CheckCircle2 className="w-2.5 h-2.5 text-green-400 shrink-0" />
                                              ) : !isPending ? (
                                                <Clock className="w-2.5 h-2.5 text-amber-400 shrink-0" />
                                              ) : null}
                                            </div>
                                          )
                                        })
                                      )}
                                      {members.length > 3 && (
                                        <div className="text-[6px] text-slate-500 text-center">+{members.length - 3}</div>
                                      )}
                                    </div>
                                  </div>
                                  
                                  {/* Connector Line */}
                                  {idx < 4 && (
                                    <div className={cn(
                                      "flex-1 h-[2px] mt-2.5 mx-0.5 rounded-full shrink-0",
                                      isStageCompleted ? "bg-green-500" :
                                      isCurrent ? "bg-slate-600" :
                                      "bg-slate-700"
                                    )}></div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Page Indicator */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-1.5 sm:gap-2 py-1 sm:py-0.5 shrink-0">
                    {Array.from({ length: totalPages }, (_, i) => (
                      <button
                        key={i}
                        onClick={() => setCurrentPage(i)}
                        className={cn(
                          "rounded-full transition-all min-h-[28px] min-w-[28px] sm:min-h-[12px] sm:min-w-[12px]",
                          currentPage === i 
                            ? "bg-violet-500 w-7 sm:w-5 h-[6px] sm:h-[6px]" 
                            : "bg-slate-600 w-3 h-[6px] sm:w-2 sm:h-[6px] hover:bg-slate-500"
                        )}
                        aria-label={`Page ${i + 1}`}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════
            FOOTER — Mobile: stacked | Desktop: single row
        ═══════════════════════════════════════════════════════════════ */}
        <footer className="bg-slate-900 border-t border-slate-800 px-3 sm:px-4 py-2 shrink-0">
          {/* Mobile: stacked */}
          <div className="flex flex-col items-center gap-1 text-center sm:hidden">
            <span className="text-[11px] text-slate-500">
              Mode Tampilan Publik &bull; Pushakin Flows
            </span>
            <div className="flex items-center gap-2 text-[11px] text-slate-500">
              {lastUpdated && (
                <span className="flex items-center gap-1">
                  <span className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    isRefreshing ? "bg-violet-400 animate-pulse" : "bg-green-500"
                  )}></span>
                  Update: {formatLastUpdated(lastUpdated)}
                </span>
              )}
            </div>
            <div className="text-[11px] text-slate-500">
              {projects.length > PROJECTS_PER_PAGE && (
                <span>Halaman {currentPage + 1}/{totalPages} &bull; </span>
              )}
              {currentProjects.length}/{projects.length} proyek
            </div>
          </div>

          {/* Desktop: single row */}
          <div className="hidden sm:flex items-center justify-between">
            <div className="flex items-center gap-3 text-[10px] text-slate-500">
              <span>Mode Tampilan Publik &bull; Pushakin Flows</span>
              {lastUpdated && (
                <span className="flex items-center gap-1">
                  <span className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    isRefreshing ? "bg-violet-400 animate-pulse" : "bg-green-500"
                  )}></span>
                  Update terakhir: {formatLastUpdated(lastUpdated)}
                </span>
              )}
            </div>
            <div className="text-[10px] text-slate-500">
              {projects.length > PROJECTS_PER_PAGE && (
                <span>Halaman {currentPage + 1} dari {totalPages} &bull; </span>
              )}
              Menampilkan {currentProjects.length} dari {projects.length} proyek
            </div>
          </div>
        </footer>
      </div>
    </div>
  )
}
