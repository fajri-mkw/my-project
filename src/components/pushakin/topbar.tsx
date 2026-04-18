'use client'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useAppStore, getRoleDisplayName } from '@/lib/store'
import { Bell, LogOut, ShieldAlert, Menu } from 'lucide-react'
import { useMemo } from 'react'

interface TopbarProps {
  onToggleSidebar?: () => void
}

export function Topbar({ onToggleSidebar }: TopbarProps) {
  const { activeView, currentUser, notifications, markNotifRead, setSelectedProjectId, setActiveView, isImpersonating, originalUser, stopImpersonate } = useAppStore()

  const myNotifications = useMemo(() => 
    notifications.filter(n => n.userId === currentUser?.id),
    [notifications, currentUser?.id]
  )
  const unreadCount = useMemo(() => 
    myNotifications.filter(n => !n.read).length,
    [myNotifications]
  )

  const viewTitles: Record<string, string> = {
    'dashboard': 'Project Dashboard',
    'create': 'Buat Proyek Baru',
    'overview': 'Statistik & Progress',
    'users': 'Manajemen Pengguna',
    'reports': 'Rekap Laporan Kegiatan',
    'profile': 'Profil Saya',
    'settings': 'Pengaturan',
    'project_detail': 'Detail Proyek'
  }

  const handleNotificationClick = (notif: typeof notifications[0]) => {
    markNotifRead(notif.id)
    if (notif.projectId) {
      setSelectedProjectId(notif.projectId)
    }
    setActiveView((notif.targetView || 'project_detail') as 'dashboard' | 'project_detail' | 'reports')
  }

  return (
    <header className={`bg-gradient-to-r from-slate-50 via-white to-violet-50/30 border-b border-slate-200 flex flex-col z-10 print:hidden ${isImpersonating ? 'h-28' : 'h-auto sm:h-20'}`}>
      {/* Impersonation Banner */}
      {isImpersonating && originalUser && (
        <div className="bg-amber-500 text-white px-4 sm:px-8 py-2 flex flex-col sm:flex-row items-start sm:items-center justify-between w-full gap-2">
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-5 h-5 animate-pulse shrink-0" />
            <span className="text-sm font-semibold">
              Mode Impersonasi — Anda sedang masuk sebagai{' '}
              <span className="bg-amber-600/50 px-2 py-0.5 rounded font-bold">{currentUser?.name}</span>
              <span className="text-amber-100 ml-2">({getRoleDisplayName(currentUser?.role || '')})</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-amber-100 text-xs">Kembali ke:</span>
            <span className="text-xs font-semibold bg-amber-600/50 px-2 py-0.5 rounded">{originalUser.name} (Super Admin)</span>
            <Button
              size="sm"
              variant="outline"
              onClick={stopImpersonate}
              className="bg-white/20 border-amber-300 text-white hover:bg-white/30 hover:text-white gap-1.5 text-xs ml-2"
            >
              <LogOut className="w-3.5 h-3.5" />
              Keluar
            </Button>
          </div>
        </div>
      )}
      {/* Normal topbar content */}
      <div className="flex items-center justify-between px-4 sm:px-8 py-3 sm:py-0 flex-1">
        <div className="flex items-center gap-3 min-w-0">
          {/* Mobile hamburger menu */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden shrink-0"
            onClick={onToggleSidebar}
            aria-label="Buka menu"
          >
            <Menu className="w-5 h-5 text-slate-600" />
          </Button>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-2xl font-bold text-slate-900 capitalize truncate">
              {viewTitles[activeView] || 'Project Dashboard'}
            </h1>
            <div className="hidden sm:flex items-center gap-2">
              <span className="text-sm font-semibold text-violet-600">Sistem Manajemen Produksi</span>
              <span className="text-slate-300">|</span>
              <span className="text-xs text-slate-500">Tim Pusat Hubungan Masyarakat dan Keterbukaan Informasi</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-4 shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="relative rounded-full hover:border-violet-300 hover:bg-violet-50">
                <Bell className="w-5 h-5 text-slate-600" />
                {unreadCount > 0 && (
                  <span className="absolute top-0 right-0 w-3 h-3 bg-orange-500 rounded-full border-2 border-white animate-pulse" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 sm:w-80">
              <DropdownMenuLabel className="flex items-center justify-between">
                <span>Notifikasi</span>
                {unreadCount > 0 && (
                  <Badge className="bg-orange-100 text-orange-700 text-xs">
                    {unreadCount} Baru
                  </Badge>
                )}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <ScrollArea className="h-72 sm:h-80">
                {myNotifications.length === 0 ? (
                  <div className="p-6 text-center text-sm text-slate-500">
                    Tidak ada notifikasi
                  </div>
                ) : (
                  myNotifications.map((notif) => (
                    <DropdownMenuItem
                      key={notif.id}
                      className={`p-3 sm:p-4 cursor-pointer border-b border-slate-50 ${
                        notif.read ? 'bg-white' : 'bg-violet-50/50'
                      }`}
                      onClick={() => handleNotificationClick(notif)}
                    >
                      <div className="flex items-start gap-2">
                        {!notif.read && (
                          <div className="w-2 h-2 bg-violet-500 rounded-full mt-1.5 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-slate-800 line-clamp-2">{notif.message}</p>
                          <p className="text-xs text-slate-400 mt-1">Klik untuk melihat detail</p>
                        </div>
                      </div>
                    </DropdownMenuItem>
                  ))
                )}
              </ScrollArea>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}
