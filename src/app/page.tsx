'use client'

import { Suspense, useEffect, useState, useCallback, useRef } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useAppStore, type User } from '@/lib/store'
import { Sidebar } from '@/components/pushakin/sidebar'
import { Topbar } from '@/components/pushakin/topbar'
import { DialogModal } from '@/components/pushakin/dialog-modal'
import { Settings, Wrench, Clock, AlertTriangle, Shield } from 'lucide-react'

// Dynamic imports - only load when needed, reducing initial bundle from ~5MB to ~500KB
const LoginView = dynamic(() => import('@/components/pushakin/login-view').then(m => ({ default: m.LoginView })), { ssr: false })
const DashboardView = dynamic(() => import('@/components/pushakin/dashboard-view').then(m => ({ default: m.DashboardView })), { ssr: false })
const CreateProjectView = dynamic(() => import('@/components/pushakin/create-project-view').then(m => ({ default: m.CreateProjectView })), { ssr: false })
const ProjectDetailView = dynamic(() => import('@/components/pushakin/project-detail-view').then(m => ({ default: m.ProjectDetailView })), { ssr: false })
const OverviewView = dynamic(() => import('@/components/pushakin/overview-view').then(m => ({ default: m.OverviewView })), { ssr: false })
const ReportsView = dynamic(() => import('@/components/pushakin/reports-view').then(m => ({ default: m.ReportsView })), { ssr: false })
const UserManagementView = dynamic(() => import('@/components/pushakin/user-management-view').then(m => ({ default: m.UserManagementView })), { ssr: false })
const ProfileView = dynamic(() => import('@/components/pushakin/profile-view').then(m => ({ default: m.ProfileView })), { ssr: false })
const SettingsView = dynamic(() => import('@/components/pushakin/settings-view').then(m => ({ default: m.SettingsView })), { ssr: false })
const InboxView = dynamic(() => import('@/components/pushakin/inbox-view').then(m => ({ default: m.InboxView })), { ssr: false })
const AnnouncementView = dynamic(() => import('@/components/pushakin/announcement-view').then(m => ({ default: m.AnnouncementView })), { ssr: false })
const PermohonanView = dynamic(() => import('@/components/pushakin/permohonan-view').then(m => ({ default: m.PermohonanView })), { ssr: false })
const SuratManagementView = dynamic(() => import('@/components/pushakin/surat-management-view').then(m => ({ default: m.SuratManagementView })), { ssr: false })
const ProgramKegiatanView = dynamic(() => import('@/components/pushakin/program-kegiatan-view').then(m => ({ default: m.ProgramKegiatanView })), { ssr: false })
const PublicTrackerView = dynamic(() => import('@/components/pushakin/public-tracker-view').then(m => ({ default: m.PublicTrackerView })), { ssr: false })

function LoadingSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 via-blue-50 to-violet-100">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-violet-600 mx-auto mb-4" />
        <p className="text-slate-600">Memuat Pushakin Flows...</p>
      </div>
    </div>
  )
}

// Lightweight inline loading for view transitions
function ViewLoading() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-600" />
    </div>
  )
}

interface MaintenanceData {
  maintenance: boolean
  message: string | null
}

function MaintenanceView({ message, onAdminLogin }: { message: string | null; onAdminLogin: (user: any) => void }) {
  const [showAdmin, setShowAdmin] = useState(false)
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleAdminLogin = async () => {
    setError('')
    setIsLoading(true)

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: adminEmail, password: adminPassword })
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Login gagal')
        setIsLoading(false)
        return
      }

      // Check if user is admin
      if (data.user?.role !== 'Admin') {
        setError('Hanya Super Admin yang dapat mengakses saat maintenance')
        setIsLoading(false)
        return
      }

      // Pass user data to parent — no page reload, Zustand handles state
      onAdminLogin(data.user)
    } catch (err) {
      console.error('Admin login error:', err)
      setError('Terjadi kesalahan saat login')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-4">
      <div className="max-w-md w-full">
        <div className="bg-white/10 backdrop-blur-xl rounded-3xl p-8 text-center border border-white/20 shadow-2xl">
          {/* Icon */}
          <div className="w-20 h-20 bg-amber-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Wrench className="w-10 h-10 text-amber-400 animate-pulse" />
          </div>

          {/* Title */}
          <h1 className="text-2xl font-bold text-white mb-2">
            Sedang Dalam Maintenance
          </h1>
          <p className="text-white/60 mb-4">
            {message || 'Pushakin Flows sedang diperbarui untuk meningkatkan layanan.'}
          </p>

          {/* Info */}
          <div className="bg-white/5 rounded-xl p-4 mb-6 text-left space-y-3">
            <div className="flex items-center gap-3 text-white/80">
              <Clock className="w-5 h-5 text-amber-400" />
              <span className="text-sm">Estimasi: Beberapa menit</span>
            </div>
            <div className="flex items-center gap-3 text-white/80">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
              <span className="text-sm">Silakan coba beberapa saat lagi</span>
            </div>
          </div>

          {/* Admin Access Toggle */}
          <button
            onClick={() => setShowAdmin(!showAdmin)}
            className="text-white/40 hover:text-white/60 text-xs flex items-center gap-1 mx-auto mb-4"
          >
            <Settings className="w-3 h-3" />
            <span>Akses Admin</span>
          </button>

          {/* Admin Login Form */}
          {showAdmin && (
            <div className="bg-white/5 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-center gap-2 text-violet-300 text-sm mb-2">
                <Shield className="w-4 h-4" />
                <span>Login Admin untuk Mengakses</span>
              </div>
              <input
                type="email"
                value={adminEmail}
                onChange={(e) => { setAdminEmail(e.target.value); setError('') }}
                placeholder="Email Admin"
                className="w-full px-4 py-2 rounded-lg bg-white/10 border border-white/20 text-white placeholder-white/40 text-sm"
              />
              <input
                type="password"
                value={adminPassword}
                onChange={(e) => { setAdminPassword(e.target.value); setError('') }}
                placeholder="Password"
                className="w-full px-4 py-2 rounded-lg bg-white/10 border border-white/20 text-white placeholder-white/40 text-sm"
              />
              {error && <p className="text-red-400 text-xs">{error}</p>}
              <button
                onClick={handleAdminLogin}
                disabled={isLoading || !adminEmail || !adminPassword}
                className="w-full py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-violet-600/50 text-white rounded-lg text-sm font-medium transition-colors"
              >
                {isLoading ? 'Memproses...' : 'Login Admin'}
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-white/30 text-xs mt-6">
          Tim Pusat Hubungan Masyarakat dan Keterbukaan Informasi
        </p>
      </div>
    </div>
  )
}

function AppContent() {
  const currentUser = useAppStore(state => state.currentUser)
  const activeView = useAppStore(state => state.activeView)
  const isImpersonating = useAppStore(state => state.isImpersonating)
  const setUsers = useAppStore(state => state.setUsers)
  const setProjects = useAppStore(state => state.setProjects)
  const setNotifications = useAppStore(state => state.setNotifications)
  const setSuratTugas = useAppStore(state => state.setSuratTugas)
  const setPermohonanList = useAppStore(state => state.setPermohonanList)
  const setCurrentUser = useAppStore(state => state.setCurrentUser)
  const setSuratList = useAppStore(state => state.setSuratList)
  const setKegiatanList = useAppStore(state => state.setKegiatanList)
  const setActiveView = useAppStore(state => state.setActiveView)

  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const isPublicView = searchParams.get('public') === 'tracker'

  // Valid app views that can be addressed via ?view=xxx
  // (excludes 'login', 'create', 'project_detail' which are reached via in-app actions)
  const validUrlViews = [
    'dashboard', 'overview', 'surat', 'kegiatan', 'inbox',
    'announcements', 'reports', 'profile', 'users', 'settings'
  ] as const

  const [isLoading, setIsLoading] = useState(true)
  const [isHydrating, setIsHydrating] = useState(true)
  const [isSeeding, setIsSeeding] = useState(false)
  const [seedError, setSeedError] = useState<string | undefined>()
  const [users, setUsersState] = useState<User[]>([])
  const [maintenanceData, setMaintenanceData] = useState<MaintenanceData | null>(null)
  const [adminMaintenanceAccess, setAdminMaintenanceAccess] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Track if we've already fetched role-specific data for this user
  const lastFetchedUserId = useRef<string | null>(null)

  // Global fetch interceptor — adds X-User-Id header to all API requests
  useEffect(() => {
    const originalFetch = window.fetch
    window.fetch = async function(input, init) {
      const user = useAppStore.getState().currentUser
      if (user) {
        const headers = new Headers(init?.headers)
        if (!headers.has('X-User-Id')) {
          headers.set('X-User-Id', user.id)
        }
        if (!headers.has('X-User-Role')) {
          headers.set('X-User-Role', user.role)
        }
        return originalFetch.call(this, input, { ...init, headers })
      }
      return originalFetch.call(this, input, init)
    }
    return () => {
      window.fetch = originalFetch
    }
  }, [])

  // Wait for Zustand persist hydration before rendering
  // This prevents flash of login page when auth state is being restored from localStorage
  useEffect(() => {
    const checkHydrated = () => {
      if (useAppStore.persist.hasHydrated()) {
        setIsHydrating(false)
      }
    }
    // Check immediately (might already be hydrated)
    checkHydrated()
    // Also listen for hydration completion
    const unsub = useAppStore.persist.onFinishHydration(() => {
      setIsHydrating(false)
    })
    return unsub
  }, [])

  // Always clear stale adminMaintenanceAccess on app load (security)
  useEffect(() => {
    localStorage.removeItem('adminMaintenanceAccess')
    setAdminMaintenanceAccess(false)
  }, [])

  // === URL <-> activeView sync (enables right-click "Open in new tab") ===
  // Direction 1: URL ?view=xxx -> store (on load / back-forward / new tab)
  useEffect(() => {
    const urlView = searchParams.get('view')
    if (!urlView) return
    if ((validUrlViews as readonly string[]).includes(urlView)) {
      const current = useAppStore.getState().activeView
      if (current !== urlView) {
        setActiveView(urlView as typeof current)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // Direction 2: store activeView -> URL (so the address bar reflects the view,
  // enabling shareable URLs and correct behavior on refresh / new tab)
  useEffect(() => {
    if (!currentUser) return
    const current = activeView
    const urlView = searchParams.get('view')
    // Only sync URL-addressable views to the URL
    if ((validUrlViews as readonly string[]).includes(current)) {
      if (urlView !== current) {
        const params = new URLSearchParams(searchParams.toString())
        params.set('view', current)
        router.replace(`${pathname}?${params.toString()}`, { scroll: false })
      }
    } else if (urlView) {
      // Non-addressable view (create/project_detail/login): drop the ?view param
      const params = new URLSearchParams(searchParams.toString())
      params.delete('view')
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, currentUser])

  // Fetch maintenance status (consolidated with longer interval)
  const fetchMaintenanceStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/maintenance')
      if (res.ok) {
        const data = await res.json()
        setMaintenanceData(data)

        // When maintenance is OFF, clear stale adminMaintenanceAccess
        if (!data.maintenance && localStorage.getItem('adminMaintenanceAccess') === 'true') {
          localStorage.removeItem('adminMaintenanceAccess')
          setAdminMaintenanceAccess(false)
        }
      }
    } catch (error) {
      console.error('Failed to fetch maintenance status:', error)
    }
  }, [])

  // Fetch initial data in parallel
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [usersRes, projectsRes, maintenanceRes] = await Promise.all([
          fetch('/api/users'),
          fetch('/api/projects'),
          fetch('/api/maintenance')
        ])

        if (usersRes.ok) {
          const usersData = await usersRes.json()
          setUsersState(usersData)
          setUsers(usersData)
        }

        if (projectsRes.ok) {
          const projectsData = await projectsRes.json()
          setProjects(projectsData)
        }

        if (maintenanceRes.ok) {
          const data = await maintenanceRes.json()
          setMaintenanceData(data)
        } else {
          setMaintenanceData({ maintenance: false, message: null })
        }

        setIsLoading(false)
      } catch (error) {
        console.error('Failed to fetch data:', error)
        setMaintenanceData({ maintenance: false, message: null })
        setIsLoading(false)
      }
    }

    fetchData()
  }, [setUsers, setProjects])

  // Poll maintenance status every 30 seconds (reduced from 5s)
  useEffect(() => {
    const pollInterval = setInterval(fetchMaintenanceStatus, 30000)
    return () => clearInterval(pollInterval)
  }, [fetchMaintenanceStatus])

  // Consolidated data fetch for role-specific data - runs once when user logs in
  // ALL fetches run in PARALLEL for maximum speed (was sequential before)
  useEffect(() => {
    if (!currentUser) return
    
    // Skip if we already fetched for this user (prevents duplicate fetches on re-renders)
    const userId = currentUser.id + (isImpersonating ? '-impersonating' : '')
    if (lastFetchedUserId.current === userId) return
    lastFetchedUserId.current = userId

    const fetchRoleData = async () => {
      // Build all fetch promises in parallel — much faster than sequential await
      const fetchPromises: Promise<void>[] = []

      // Fetch notifications for all logged-in users
      fetchPromises.push(
        fetch(`/api/notifications?userId=${currentUser.id}`)
          .then(res => res.ok ? res.json() : null)
          .then(data => { if (data) setNotifications(data) })
          .catch(error => console.error('Failed to fetch notifications:', error))
      )

      // Fetch surat tugas for all logged-in users
      fetchPromises.push(
        fetch(`/api/surat-tugas?userId=${currentUser.id}`)
          .then(res => res.ok ? res.json() : null)
          .then(data => { if (data) setSuratTugas(data) })
          .catch(error => console.error('Failed to fetch surat tugas:', error))
      )

      // Role-specific fetches (Administrator, Manager, Admin)
      if (['Administrator', 'Manager', 'Admin'].includes(currentUser.role)) {
        const role = currentUser.role
        const params = new URLSearchParams({ userId: currentUser.id, userRole: role })

        // Fetch permohonan
        fetchPromises.push(
          fetch(`/api/permohonan?${params}`)
            .then(res => res.ok ? res.json() : null)
            .then(data => { if (data) setPermohonanList(data) })
            .catch(error => console.error('Failed to fetch permohonan:', error))
        )

        // Fetch surat
        fetchPromises.push(
          fetch(`/api/surat?${params}`)
            .then(res => res.ok ? res.json() : null)
            .then(data => { if (data) setSuratList(data) })
            .catch(error => console.error('Failed to fetch surat:', error))
        )
      }

      // Fetch program kegiatan for Manager/Admin only
      if (['Manager', 'Admin'].includes(currentUser.role)) {
        const role = currentUser.role
        const params = new URLSearchParams({ userId: currentUser.id, userRole: role })
        fetchPromises.push(
          fetch(`/api/program-kegiatan?${params}`)
            .then(res => res.ok ? res.json() : null)
            .then(data => { if (data) setKegiatanList(data) })
            .catch(error => console.error('Failed to fetch program kegiatan:', error))
        )
      }

      // Execute ALL fetches in parallel — reduces total wait time from sum to max
      await Promise.all(fetchPromises)
    }

    fetchRoleData()

    // Single consolidated polling interval (60s instead of 5 separate 30s intervals)
    const pollInterval = setInterval(fetchRoleData, 60000)
    return () => clearInterval(pollInterval)
  }, [currentUser, isImpersonating, setNotifications, setSuratTugas, setPermohonanList, setSuratList, setKegiatanList])

  // Handle database seeding
  const handleSeed = async () => {
    setIsSeeding(true)
    setSeedError(undefined)
    try {
      const res = await fetch('/api/seed')
      const data = await res.json()

      if (!res.ok || !data.success) {
        setSeedError(data.details || data.error || 'Terjadi kesalahan')
        return
      }

      // Refetch users
      const usersRes = await fetch('/api/users')
      if (usersRes.ok) {
        const usersData = await usersRes.json()
        setUsersState(usersData)
        setUsers(usersData)
      }
    } catch (error) {
      console.error('Seed failed:', error)
      setSeedError('Tidak dapat terhubung ke server. Pastikan DATABASE_URL sudah dikonfigurasi.')
    } finally {
      setIsSeeding(false)
    }
  }

  // Clear params and go to app
  const handleBackFromPublic = () => {
    window.location.href = window.location.pathname
  }

  // Handle admin login from maintenance view
  const handleAdminLogin = (user: any) => {
    setCurrentUser(user)
    setAdminMaintenanceAccess(true)
  }

  // Public share view - No authentication required
  if (isPublicView) {
    return <PublicTrackerView onBack={handleBackFromPublic} />
  }

  // Still loading (data fetch or hydration)
  if (isLoading || maintenanceData === null || isHydrating) {
    return <LoadingSpinner />
  }

  // Maintenance mode - only allow Admin
  if (maintenanceData.maintenance) {
    if (currentUser?.role === 'Admin') {
      // Admin can access, show main app with maintenance banner
    } else {
      return (
        <MaintenanceView
          message={maintenanceData.message}
          onAdminLogin={handleAdminLogin}
        />
      )
    }
  }

  // Login view
  if (activeView === 'login' || !currentUser) {
    return (
      <>
        <LoginView onSeed={handleSeed} isSeeding={isSeeding} seedError={seedError} />
        <DialogModal />
      </>
    )
  }

  // Close sidebar when navigating on mobile
  const handleNavClick = (view: string) => {
    setActiveView(view as 'dashboard')
    setSidebarOpen(false)
  }

  // Render active view — NOT wrapped in useMemo because:
  // 1. Dynamic imports already handle lazy loading
  // 2. useMemo wrapping JSX with component instances causes React error #310
  //    ("Cannot update a component while rendering a different component")
  const renderActiveView = () => {
    switch (activeView) {
      case 'dashboard': return <DashboardView />
      case 'overview': return <OverviewView />
      case 'inbox': return <InboxView />
      case 'create': return <CreateProjectView />
      case 'project_detail': return <ProjectDetailView />
      case 'users': return <UserManagementView />
      case 'reports': return <ReportsView />
      case 'profile': return <ProfileView />
      case 'settings': return <SettingsView />
      case 'announcements': return <AnnouncementView />
      case 'permohonan': return <PermohonanView />
      case 'surat': return <SuratManagementView />
      case 'kegiatan': return <ProgramKegiatanView />
      default: return <DashboardView />
    }
  }

  // Main application
  return (
    <div className="flex h-screen bg-gradient-to-br from-slate-100 via-blue-50 to-violet-50 font-sans selection:bg-violet-200 overflow-hidden">
      {/* Maintenance Banner for Admin */}
      {maintenanceData.maintenance && currentUser?.role === 'Admin' && (
        <div className="fixed top-0 left-0 right-0 bg-amber-500 text-amber-900 text-center py-2 text-sm font-medium z-50 flex items-center justify-center gap-2">
          <Wrench className="w-4 h-4" />
          <span>Mode Maintenance Aktif - Hanya Super Admin yang dapat mengakses</span>
        </div>
      )}

      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <Sidebar isOpen={sidebarOpen} onNavigate={handleNavClick} onClose={() => setSidebarOpen(false)} />

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Topbar */}
        <Topbar onToggleSidebar={() => setSidebarOpen(true)} />

        {/* Main Content Area - Scrollable */}
        <main className={`flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 ${maintenanceData.maintenance ? 'mt-10' : ''}`}>
          <Suspense fallback={<ViewLoading />}>
            {renderActiveView()}
          </Suspense>
        </main>
      </div>

      {/* Global Dialog */}
      <DialogModal />
    </div>
  )
}

export default function Home() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <AppContent />
    </Suspense>
  )
}
