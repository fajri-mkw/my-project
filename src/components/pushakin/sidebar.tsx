'use client'

import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useAppStore } from '@/lib/store'
import {
  UserCircle,
  Users,
  LogOut,
  PlayCircle,
  BarChart2,
  FileText,
  LayoutDashboard,
  Settings,
  Inbox,
  Megaphone,
  ShieldAlert,
  ArrowLeftRight,
  ClipboardList,
  ExternalLink,
  Package,
  X,
  Link2
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { getRoleDisplayName } from '@/lib/store'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

// ============================================================================
// Types
// ============================================================================
interface ExternalLinkItem {
  id: string
  label: string
  url: string
  icon: string | null
  description: string | null
  isActive: boolean
  order: number
}

// Map a stored icon name (Lucide) to a rendered icon component.
// Falls back to a generic external-link / link icon when name is unknown.
function renderExternalIcon(iconName: string | null) {
  if (!iconName) return <ExternalLink className="w-5 h-5" />
  // We currently only support a small curated set of icons to keep the
  // client bundle small. Unknown names fall back to ExternalLink.
  switch (iconName.toLowerCase()) {
    case 'image':
    case 'photo':
    case 'gallery':
      return <ExternalLink className="w-5 h-5" />
    case 'link':
    case 'link2':
      return <Link2 className="w-5 h-5" />
    case 'external':
    case 'externallink':
    default:
      return <ExternalLink className="w-5 h-5" />
  }
}

interface SidebarProps {
  isOpen?: boolean
  onNavigate?: (view: string) => void
  onClose?: () => void
}

// Build a shareable URL for a given view (enables right-click "Open in new tab")
function viewUrl(viewId: string): string {
  return `/?view=${viewId}`
}

export function Sidebar({ isOpen = false, onNavigate, onClose }: SidebarProps) {
  const { currentUser, activeView, setActiveView, setCurrentUser, projects, suratTugas, isImpersonating, originalUser, stopImpersonate } = useAppStore()
  const router = useRouter()
  const completedCount = projects.filter(p => p.currentStage === 5).length
  // For non-manager/admin users, the "Laporan Kegiatan" badge shows the count
  // of completed projects they personally worked on (not all completed projects).
  // Manager/Admin still sees the total completed count (matches their ReportsView).
  const isManagerOrAdmin = currentUser && ['Manager', 'Admin'].includes(currentUser.role)
  const myCompletedCount = isManagerOrAdmin
    ? completedCount
    : projects.filter(p =>
        p.currentStage === 5 &&
        currentUser &&
        (p.tasks.some(t => t.assignedTo === currentUser.id) || p.managerId === currentUser.id)
      ).length
  const unreadSuratCount = currentUser ? suratTugas.filter(s => s.userId === currentUser.id && !s.read).length : 0

  // External links shown to all users (only active ones from the API)
  const [externalLinks, setExternalLinks] = useState<ExternalLinkItem[]>([])
  const [isLoadingLinks, setIsLoadingLinks] = useState(true)

  // Fetch active external links on mount and whenever the user changes.
  // This is intentionally a separate fetch (not in the store) because the
  // list is read-only for non-admin users and changes rarely.
  useEffect(() => {
    if (!currentUser) return
    let cancelled = false
    setIsLoadingLinks(true)
    fetch('/api/external-links')
      .then(r => r.ok ? r.json() : { links: [] })
      .then(data => {
        if (!cancelled) setExternalLinks(Array.isArray(data.links) ? data.links : [])
      })
      .catch(() => {
        if (!cancelled) setExternalLinks([])
      })
      .finally(() => {
        if (!cancelled) setIsLoadingLinks(false)
      })
    return () => { cancelled = true }
  }, [currentUser])

  if (!currentUser) return null

  // Menu visibility based on user role - Super Admin (Admin) gets full access
  const effectiveRole = currentUser.role
  const canManageUsers = !isImpersonating && currentUser.role === 'Admin'
  // Reports tab is visible to ALL users:
  //   - Manager/Admin → full ReportsView (all users, Excel + PDF)
  //   - Other roles   → UserReportsView (own tasks only, PDF only)
  // This lets team members download their own activity reports without
  // needing the manager to export for them.
  const canViewReports = true
  const showPermohonan = ['Administrator', 'Admin'].includes(effectiveRole)
  const showKegiatan = ['Manager', 'Admin'].includes(effectiveRole)
  const canManageContent = ['Manager', 'Admin'].includes(effectiveRole)
  const showReviewerSettings = effectiveRole === 'Reviewer'

  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'overview', label: 'Statistik & Progress', icon: BarChart2 },
    ...(showPermohonan ? [{ id: 'surat', label: 'Manajemen Surat', icon: Inbox }] : []),
    ...(showKegiatan ? [{ id: 'kegiatan', label: 'Program Kegiatan', icon: ClipboardList }] : []),
    { id: 'inbox', label: 'Inbox', icon: Inbox, badge: unreadSuratCount > 0 ? unreadSuratCount : undefined },
    ...(canManageContent ? [{ id: 'announcements', label: 'Manajemen Konten', icon: Megaphone }] : []),
    ...(canViewReports ? [{ id: 'reports', label: 'Laporan Kegiatan', icon: FileText, badge: myCompletedCount > 0 ? myCompletedCount : undefined }] : []),
    { id: 'profile', label: 'Profil Saya', icon: UserCircle },
    ...(['Admin', 'Administrator', 'Manager'].includes(currentUser?.role || '') ? [{ id: 'inventory', label: 'Manajemen Inventaris', icon: Package }] : []),
    ...(canManageUsers ? [{ id: 'users', label: 'Manajemen User', icon: Users }] : []),
    ...(canManageUsers || showReviewerSettings ? [{ id: 'settings', label: 'Pengaturan', icon: Settings }] : []),
  ]

  // SPA click handler — only intercepts plain left-clicks.
  // Right-click / middle-click / Ctrl+click / Cmd+click fall through to the
  // browser, which opens the real href in a new tab/window as users expect.
  const handleMenuClick = (e: React.MouseEvent<HTMLAnchorElement>, viewId: string) => {
    // Let the browser handle modifier keys and non-primary buttons (new tab, new window, context menu)
    if (
      e.button !== 0 ||           // not a primary (left) click
      e.metaKey || e.ctrlKey ||   // Cmd/Ctrl+click = open in new tab
      e.shiftKey ||               // Shift+click = open in new window
      e.altKey                    // Alt+click = download
    ) {
      return // browser will follow the href naturally
    }
    e.preventDefault()
    setActiveView(viewId as 'dashboard' | 'overview' | 'reports' | 'profile' | 'users' | 'settings' | 'inbox' | 'announcements' | 'permohonan' | 'surat' | 'kegiatan' | 'inventory')
    // Keep URL in sync (so address bar reflects current view)
    router.push(viewUrl(viewId), { scroll: false })
    onNavigate?.(viewId)
  }

  const handleLogout = () => {
    localStorage.removeItem('adminMaintenanceAccess')
    setCurrentUser(null)
    setActiveView('login')
  }

  // External links are always opened in a NEW TAB — these are third-party apps
  // (galleries, photo editors, etc.) and should NOT replace the SPA.
  const handleExternalClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // Always let the browser handle: anchor has target="_blank" so it opens in
    // a new tab regardless. We only need to close the mobile sidebar.
    onClose?.()
  }

  return (
    <aside className={cn(
      "w-64 bg-gradient-to-b text-stone-300 flex flex-col h-full rounded-r-3xl shadow-xl z-40 print:hidden shrink-0 transition-transform duration-300 ease-in-out",
      isImpersonating ? 'from-amber-950 via-amber-950 to-slate-900' : 'from-slate-900 via-blue-950 to-slate-900',
      // Mobile: fixed overlay, slide in/out
      "fixed md:sticky md:top-0 md:h-screen",
      isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
    )}>
      {/* Logo */}
      <div className="p-6 flex items-center space-x-3 text-stone-50 shrink-0">
        <div className="bg-gradient-to-br from-violet-600 to-purple-700 p-2 rounded-xl shadow-lg shadow-violet-900/30">
          <PlayCircle className="w-6 h-6 text-white" />
        </div>
        <span className="text-xl font-bold tracking-tight">Pushakin Flows</span>
        {/* Close button on mobile */}
        <button
          onClick={onClose}
          className="ml-auto md:hidden p-1 rounded-lg hover:bg-white/10 text-stone-400 hover:text-white transition-colors"
          aria-label="Tutup menu"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Navigation */}
      <div className="flex-1 px-4 py-2 overflow-y-auto">
        <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2 px-2">
          Menu Utama
        </div>
        <nav className="space-y-1">
          {menuItems.map((item) => {
            const Icon = item.icon
            const isActive = activeView === item.id
            return (
              <Button
                key={item.id}
                variant="ghost"
                asChild
                className={cn(
                  "w-full justify-start gap-3 px-4 py-3 rounded-xl transition-all",
                  isActive
                    ? "bg-gradient-to-r from-violet-600 to-purple-700 text-white shadow-md shadow-violet-900/30 hover:from-violet-600 hover:to-purple-700 hover:text-white"
                    : "hover:bg-slate-800/80 hover:text-stone-100"
                )}
              >
                <a
                  href={viewUrl(item.id)}
                  onClick={(e) => handleMenuClick(e, item.id)}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <Icon className="w-5 h-5" />
                  <span className="font-medium">{item.label}</span>
                  {item.badge && (
                    <span className="ml-auto bg-orange-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm">
                      {item.badge}
                    </span>
                  )}
                </a>
              </Button>
            )
          })}
        </nav>

        {/* External App Links section — visible to all logged-in users */}
        {/* Only render the section header & list when there's at least one link */}
        {/* (while loading, we hide the section to avoid flicker on first paint) */}
        {!isLoadingLinks && externalLinks.length > 0 && (
          <>
            <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider mt-6 mb-2 px-2">
              Aplikasi Eksternal
            </div>
            <nav className="space-y-1">
              {externalLinks.map((link) => (
                <Button
                  key={link.id}
                  variant="ghost"
                  asChild
                  className="w-full justify-start gap-3 px-4 py-3 rounded-xl transition-all hover:bg-slate-800/80 hover:text-stone-100 text-stone-300 group"
                  title={link.description || link.url}
                >
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={handleExternalClick}
                    aria-label={`Buka ${link.label} di tab baru`}
                  >
                    {renderExternalIcon(link.icon)}
                    <span className="font-medium truncate flex-1 text-left">{link.label}</span>
                    {/* External-link badge — appears on hover to indicate new tab */}
                    <ExternalLink className="w-3.5 h-3.5 text-stone-500 opacity-60 group-hover:opacity-100" />
                  </a>
                </Button>
              ))}
            </nav>
          </>
        )}
      </div>

      {/* User Info & Logout */}
      <div className="p-4 border-t border-slate-700/50 shrink-0">
        {/* Impersonation Info */}
        {isImpersonating && originalUser && (
          <div className="mb-3 p-2.5 bg-amber-900/40 rounded-xl border border-amber-700/50 space-y-2">
            <div className="flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">Mode Impersonasi</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <ArrowLeftRight className="w-3 h-3 text-amber-500" />
              <span className="text-amber-200 truncate">{originalUser.name}</span>
              <span className="text-amber-500">→</span>
              <span className="text-amber-100 truncate font-semibold">{currentUser.name}</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-amber-300 hover:text-amber-200 hover:bg-amber-800/40 text-xs gap-1.5 mt-1"
              onClick={stopImpersonate}
            >
              <LogOut className="w-3 h-3" />
              Kembali ke Super Admin
            </Button>
          </div>
        )}
        <div className="flex items-center space-x-3 mb-4 p-2 bg-slate-800/50 rounded-xl border border-slate-700/50">
          <Avatar className={`h-10 w-10 border-2 ${isImpersonating ? 'border-amber-500' : 'border-violet-500'}`}>
            <AvatarImage src={currentUser.avatar} alt={currentUser.name} />
            <AvatarFallback>{currentUser.name.charAt(0)}</AvatarFallback>
          </Avatar>
          <div className="overflow-hidden flex-1">
            <div className="text-sm font-semibold text-stone-100 truncate">{currentUser.name}</div>
            <div className={`text-xs truncate ${isImpersonating ? 'text-amber-400' : currentUser.role === 'Admin' ? 'text-red-400' : currentUser.role === 'ContentCreator' ? 'text-cyan-400' : 'text-orange-400'}`}>{getRoleDisplayName(currentUser.role)}</div>
          </div>
        </div>

        <Button
          variant="ghost"
          className="w-full justify-between text-red-400 hover:text-red-300 hover:bg-red-900/30 bg-slate-800/50"
          onClick={handleLogout}
        >
          <span>Keluar (Logout)</span>
          <LogOut className="w-4 h-4" />
        </Button>
      </div>
    </aside>
  )
}
