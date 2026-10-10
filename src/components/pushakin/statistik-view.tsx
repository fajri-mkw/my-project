'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useAppStore, getRoleDisplayName } from '@/lib/store'
import { cn } from '@/lib/utils'
import { BarChart3, TrendingUp, Clock, AlertTriangle, CheckCircle2, Users, Layers, Zap, Activity, Loader2 } from 'lucide-react'

interface UserStat {
  id: string
  name: string
  role: string
  totalTasks: number
  completedTasks: number
  pendingTasks: number
  completionRate: number
  totalRevisions: number
  taskWithRevisions: number
  avgRevisions: number
  taskNoRevision: number
  noRevisionRate: number
  avgDuration: { value: number; unit: string; ms: number } | null
  fastestDuration: { value: number; unit: string; ms: number } | null
  slowestDuration: { value: number; unit: string; ms: number } | null
}

interface StageStat {
  stage: number
  stageName: string
  totalTasks: number
  completedTasks: number
  pendingTasks: number
  completionRate: number
  totalRevisions: number
  avgDurationHours: number
  avgDurationDays: number
}

interface RoleStat {
  role: string
  totalTasks: number
  completedTasks: number
  pendingTasks: number
  completionRate: number
  totalRevisions: number
  avgRevisions: number
  uniqueUsers: number
}

interface TeamStat {
  totalProjects: number
  completedProjects: number
  activeProjects: number
  completionRate: number
  stuckProjects: number
  stuckRate: number
  fastTrackProjects: number
  fastTrackRate: number
  totalTasks: number
  completedTasks: number
  pendingTasks: number
  totalRevisions: number
  avgTeamSize: number
}

interface StatistikData {
  perUser: UserStat[]
  perStage: StageStat[]
  perRole: RoleStat[]
  team: TeamStat
  workflow: {
    stageDistribution: Array<{ stage: number; stageName: string; count: number }>
    activityDistribution: Array<{ name: string; count: number }>
  }
}

const STAGE_COLORS = ['#3B82F6', '#F97316', '#16A34A', '#8B5CF6', '#D4AF37']

export function StatistikView() {
  const { showAlert } = useAppStore()
  const [data, setData] = useState<StatistikData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [activeSection, setActiveSection] = useState<'team' | 'user' | 'stage' | 'role' | 'workflow'>('team')

  const fetchStatistik = useCallback(async () => {
    setIsLoading(true)
    try {
      const r = await fetch('/api/statistik')
      if (r.ok) setData(await r.json())
      else showAlert('Gagal memuat statistik')
    } catch { showAlert('Gagal memuat statistik') } finally { setIsLoading(false) }
  }, [showAlert])

  useEffect(() => { fetchStatistik() }, [fetchStatistik])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
      </div>
    )
  }

  if (!data) return <div className="p-8 text-center text-stone-400">Tidak ada data</div>

  const sectionTabs = [
    { id: 'team' as const, label: 'Tim', icon: Users },
    { id: 'user' as const, label: 'Per User', icon: BarChart3 },
    { id: 'stage' as const, label: 'Per Tahap', icon: Layers },
    { id: 'role' as const, label: 'Per Role', icon: Activity },
    { id: 'workflow' as const, label: 'Workflow', icon: Zap },
  ]

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-stone-800 flex items-center gap-2">
          <BarChart3 className="w-6 h-6 text-indigo-600" /> Statistik Evaluasi Tim
        </h1>
        <p className="text-sm text-stone-500 mt-1">Dashboard efektivitas & efisiensi untuk evaluasi semua peran</p>
      </div>

      {/* Section Tabs */}
      <div className="flex gap-2 flex-wrap">
        {sectionTabs.map(tab => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSection(tab.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                activeSection === tab.id
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white border border-stone-200 text-stone-600 hover:bg-stone-50'
              )}
            >
              <Icon className="w-4 h-4" /> {tab.label}
            </button>
          )
        })}
      </div>

      {/* === SECTION: TIM === */}
      {activeSection === 'team' && (
        <div className="space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard icon={TrendingUp} label="Total Proyek" value={data.team.totalProjects} color="indigo" />
            <StatCard icon={CheckCircle2} label="Selesai" value={data.team.completedProjects} suffix={`(${data.team.completionRate}%)`} color="green" />
            <StatCard icon={Clock} label="Aktif" value={data.team.activeProjects} color="orange" />
            <StatCard icon={AlertTriangle} label="Stuck (>7 hari)" value={data.team.stuckProjects} suffix={`(${data.team.stuckRate}%)`} color="red" />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard icon={Zap} label="Fast Track" value={data.team.fastTrackProjects} suffix={`(${data.team.fastTrackRate}%)`} color="amber" />
            <StatCard icon={BarChart3} label="Total Tugas" value={data.team.totalTasks} color="blue" />
            <StatCard icon={CheckCircle2} label="Tugas Selesai" value={data.team.completedTasks} color="green" />
            <StatCard icon={Users} label="Avg Tim/Proyek" value={data.team.avgTeamSize} color="purple" />
          </div>

          {/* Completion Rate Bar */}
          <Card>
            <CardContent className="p-6">
              <h3 className="font-bold text-stone-800 mb-4">Tingkat Penyelesaian Tim</h3>
              <div className="space-y-3">
                <ProgressBar label="Proyek Selesai" value={data.team.completionRate} color="bg-green-500" />
                <ProgressBar label="Tugas Selesai" value={data.team.totalTasks > 0 ? Math.round((data.team.completedTasks / data.team.totalTasks) * 100) : 0} color="bg-blue-500" />
                <ProgressBar label="Stuck Rate" value={data.team.stuckRate} color="bg-red-500" />
                <ProgressBar label="Fast Track Rate" value={data.team.fastTrackRate} color="bg-amber-500" />
              </div>
              <div className="mt-4 pt-4 border-t border-stone-100 flex items-center gap-4 text-sm">
                <span className="text-stone-500">Total Revisi: <b className="text-stone-800">{data.team.totalRevisions}</b></span>
                <span className="text-stone-500">Tugas Pending: <b className="text-orange-600">{data.team.pendingTasks}</b></span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* === SECTION: PER USER === */}
      {activeSection === 'user' && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-stone-50 sticky top-0">
                  <tr className="border-b border-stone-200">
                    <th className="text-left p-3 font-semibold">Nama</th>
                    <th className="text-left p-3 font-semibold hidden md:table-cell">Role</th>
                    <th className="text-center p-3 font-semibold">Total</th>
                    <th className="text-center p-3 font-semibold">Selesai</th>
                    <th className="text-center p-3 font-semibold">Pending</th>
                    <th className="text-center p-3 font-semibold">Completion Rate</th>
                    <th className="text-center p-3 font-semibold hidden md:table-cell">Revisi</th>
                    <th className="text-center p-3 font-semibold hidden md:table-cell">No Revisi</th>
                    <th className="text-center p-3 font-semibold hidden lg:table-cell">Avg Revisi</th>
                    <th className="text-center p-3 font-semibold hidden md:table-cell">⏱ Avg Durasi</th>
                    <th className="text-center p-3 font-semibold hidden lg:table-cell">⚡ Tercepat</th>
                    <th className="text-center p-3 font-semibold hidden lg:table-cell">🐢 Terlama</th>
                  </tr>
                </thead>
                <tbody>
                  {data.perUser.map(u => (
                    <tr key={u.id} className="border-b border-stone-100 hover:bg-stone-50">
                      <td className="p-3 font-medium">{u.name}</td>
                      <td className="p-3 hidden md:table-cell"><Badge variant="outline" className="text-xs">{getRoleDisplayName(u.role)}</Badge></td>
                      <td className="p-3 text-center font-semibold">{u.totalTasks}</td>
                      <td className="p-3 text-center text-green-600 font-semibold">{u.completedTasks}</td>
                      <td className="p-3 text-center text-orange-600">{u.pendingTasks}</td>
                      <td className="p-3 text-center">
                        <div className="flex items-center gap-2 justify-center">
                          <div className="w-16 h-2 bg-stone-100 rounded-full overflow-hidden">
                            <div className={cn('h-full rounded-full', u.completionRate >= 80 ? 'bg-green-500' : u.completionRate >= 50 ? 'bg-orange-500' : 'bg-red-500')} style={{ width: `${u.completionRate}%` }} />
                          </div>
                          <span className="text-xs font-medium">{u.completionRate}%</span>
                        </div>
                      </td>
                      <td className="p-3 text-center hidden md:table-cell">{u.totalRevisions > 0 ? <span className="text-red-600">{u.totalRevisions}</span> : '—'}</td>
                      <td className="p-3 text-center hidden md:table-cell">{u.taskNoRevision > 0 ? <span className="text-green-600">{u.noRevisionRate}%</span> : '—'}</td>
                      <td className="p-3 text-center hidden lg:table-cell">{u.avgRevisions > 0 ? u.avgRevisions : '—'}</td>
                      <td className="p-3 text-center hidden md:table-cell">
                        {u.avgDuration ? <span className={cn('font-medium', u.avgDuration.ms < 3600000 ? 'text-green-600' : u.avgDuration.ms < 86400000 ? 'text-orange-600' : 'text-red-600')}>{u.avgDuration.value} {u.avgDuration.unit}</span> : '—'}
                      </td>
                      <td className="p-3 text-center hidden lg:table-cell">
                        {u.fastestDuration ? <span className="text-green-600 font-medium">{u.fastestDuration.value} {u.fastestDuration.unit}</span> : '—'}
                      </td>
                      <td className="p-3 text-center hidden lg:table-cell">
                        {u.slowestDuration ? <span className={cn('font-medium', u.slowestDuration.ms > 86400000 ? 'text-red-600' : 'text-orange-600')}>{u.slowestDuration.value} {u.slowestDuration.unit}</span> : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* === SECTION: PER TAHAP === */}
      {activeSection === 'stage' && (
        <div className="space-y-4">
          {data.perStage.map((s, idx) => (
            <Card key={s.stage}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold" style={{ background: STAGE_COLORS[idx % STAGE_COLORS.length] }}>
                      {s.stage}
                    </div>
                    <div>
                      <h3 className="font-bold text-stone-800">{s.stageName}</h3>
                      <p className="text-xs text-stone-500">{s.completedTasks}/{s.totalTasks} tugas selesai ({s.completionRate}%)</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-stone-800">⏱ {s.avgDurationDays > 0 ? `${s.avgDurationDays} hari` : s.avgDurationHours > 0 ? `${s.avgDurationHours} jam` : '—'}</p>
                    <p className="text-xs text-stone-500">Rata-rata durasi</p>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2 text-xs">
                  <div className="text-center p-2 bg-blue-50 rounded-lg">
                    <p className="font-bold text-blue-700 text-lg">{s.totalTasks}</p>
                    <p className="text-stone-500">Total</p>
                  </div>
                  <div className="text-center p-2 bg-green-50 rounded-lg">
                    <p className="font-bold text-green-700 text-lg">{s.completedTasks}</p>
                    <p className="text-stone-500">Selesai</p>
                  </div>
                  <div className="text-center p-2 bg-orange-50 rounded-lg">
                    <p className="font-bold text-orange-700 text-lg">{s.pendingTasks}</p>
                    <p className="text-stone-500">Pending</p>
                  </div>
                  <div className="text-center p-2 bg-red-50 rounded-lg">
                    <p className="font-bold text-red-700 text-lg">{s.totalRevisions}</p>
                    <p className="text-stone-500">Revisi</p>
                  </div>
                </div>
                <div className="mt-3">
                  <ProgressBar label="Completion Rate" value={s.completionRate} color={s.completionRate >= 80 ? 'bg-green-500' : s.completionRate >= 50 ? 'bg-orange-500' : 'bg-red-500'} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* === SECTION: PER ROLE === */}
      {activeSection === 'role' && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-stone-50 sticky top-0">
                  <tr className="border-b border-stone-200">
                    <th className="text-left p-3 font-semibold">Role</th>
                    <th className="text-center p-3 font-semibold">Total</th>
                    <th className="text-center p-3 font-semibold">Selesai</th>
                    <th className="text-center p-3 font-semibold">Pending</th>
                    <th className="text-center p-3 font-semibold">Completion</th>
                    <th className="text-center p-3 font-semibold hidden md:table-cell">Revisi</th>
                    <th className="text-center p-3 font-semibold hidden md:table-cell">Avg Revisi</th>
                    <th className="text-center p-3 font-semibold hidden lg:table-cell">Petugas</th>
                  </tr>
                </thead>
                <tbody>
                  {data.perRole.map(r => (
                    <tr key={r.role} className="border-b border-stone-100 hover:bg-stone-50">
                      <td className="p-3 font-medium">{getRoleDisplayName(r.role)}</td>
                      <td className="p-3 text-center font-semibold">{r.totalTasks}</td>
                      <td className="p-3 text-center text-green-600 font-semibold">{r.completedTasks}</td>
                      <td className="p-3 text-center text-orange-600">{r.pendingTasks}</td>
                      <td className="p-3 text-center">
                        <div className="flex items-center gap-2 justify-center">
                          <div className="w-16 h-2 bg-stone-100 rounded-full overflow-hidden">
                            <div className={cn('h-full rounded-full', r.completionRate >= 80 ? 'bg-green-500' : r.completionRate >= 50 ? 'bg-orange-500' : 'bg-red-500')} style={{ width: `${r.completionRate}%` }} />
                          </div>
                          <span className="text-xs font-medium">{r.completionRate}%</span>
                        </div>
                      </td>
                      <td className="p-3 text-center hidden md:table-cell">{r.totalRevisions > 0 ? <span className="text-red-600">{r.totalRevisions}</span> : '—'}</td>
                      <td className="p-3 text-center hidden md:table-cell">{r.avgRevisions > 0 ? r.avgRevisions : '—'}</td>
                      <td className="p-3 text-center hidden lg:table-cell">{r.uniqueUsers}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* === SECTION: WORKFLOW === */}
      {activeSection === 'workflow' && (
        <div className="space-y-6">
          {/* Stage Distribution */}
          <Card>
            <CardContent className="p-6">
              <h3 className="font-bold text-stone-800 mb-4 flex items-center gap-2"><Layers className="w-5 h-5 text-indigo-500" /> Distribusi Proyek per Tahap</h3>
              <div className="space-y-3">
                {data.workflow.stageDistribution.map((s, idx) => {
                  const maxCount = Math.max(...data.workflow.stageDistribution.map(d => d.count), 1)
                  return (
                    <div key={s.stage} className="flex items-center gap-3">
                      <span className="text-sm font-medium text-stone-600 w-32 truncate">{s.stageName}</span>
                      <div className="flex-1 h-6 bg-stone-100 rounded-lg overflow-hidden">
                        <div className="h-full rounded-lg flex items-center justify-end pr-2 text-xs text-white font-bold" style={{ width: `${(s.count / maxCount) * 100}%`, background: STAGE_COLORS[idx % STAGE_COLORS.length], minWidth: '30px' }}>
                          {s.count}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          {/* Activity Distribution */}
          <Card>
            <CardContent className="p-6">
              <h3 className="font-bold text-stone-800 mb-4 flex items-center gap-2"><Activity className="w-5 h-5 text-indigo-500" /> Distribusi Jenis Kegiatan</h3>
              {data.workflow.activityDistribution.length === 0 ? (
                <p className="text-sm text-stone-400 text-center py-4">Belum ada data</p>
              ) : (
                <div className="space-y-2">
                  {data.workflow.activityDistribution.map(a => {
                    const maxCount = Math.max(...data.workflow.activityDistribution.map(d => d.count), 1)
                    return (
                      <div key={a.name} className="flex items-center gap-3">
                        <span className="text-sm font-medium text-stone-600 w-32 truncate">{a.name}</span>
                        <div className="flex-1 h-6 bg-stone-100 rounded-lg overflow-hidden">
                          <div className="h-full bg-indigo-500 rounded-lg flex items-center justify-end pr-2 text-xs text-white font-bold" style={{ width: `${(a.count / maxCount) * 100}%`, minWidth: '30px' }}>
                            {a.count}
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
      )}
    </div>
  )
}

function StatCard({ icon: Icon, label, value, suffix, color }: { icon: React.ComponentType<{ className?: string }>, label: string, value: number, suffix?: string, color: string }) {
  const colors: Record<string, string> = {
    indigo: 'bg-indigo-50 text-indigo-700',
    green: 'bg-green-50 text-green-700',
    orange: 'bg-orange-50 text-orange-700',
    red: 'bg-red-50 text-red-700',
    amber: 'bg-amber-50 text-amber-700',
    blue: 'bg-blue-50 text-blue-700',
    purple: 'bg-purple-50 text-purple-700',
  }
  return (
    <Card>
      <CardContent className="p-4">
        <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center mb-2', colors[color])}>
          <Icon className="w-5 h-5" />
        </div>
        <p className="text-2xl font-bold text-stone-800">{value}{suffix && <span className="text-sm font-normal text-stone-500 ml-1">{suffix}</span>}</p>
        <p className="text-xs text-stone-500 mt-1">{label}</p>
      </CardContent>
    </Card>
  )
}

function ProgressBar({ label, value, color }: { label: string, value: number, color: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-stone-600 w-32">{label}</span>
      <div className="flex-1 h-3 bg-stone-100 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${value}%` }} />
      </div>
      <span className="text-sm font-bold text-stone-800 w-10 text-right">{value}%</span>
    </div>
  )
}
