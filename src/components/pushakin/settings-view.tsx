'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { useAppStore } from '@/lib/store'
import {
  Settings as SettingsIcon,
  Folder,
  Key,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  AlertCircle,
  HardDrive,
  Wrench,
  Shield,
  Bell,
  Eye,
  EyeOff,
  Send,
  Mail,
  MessageCircle
} from 'lucide-react'
import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { ExternalLinksManager } from './external-links-manager'

interface SettingsData {
  driveAutoCreate: boolean
  driveParentFolderId: string
  driveSharedDriveId: string
  hasServiceAccountKey: boolean
  driveApiKey: string
  maintenanceMode: boolean
  maintenanceMessage: string
}

export function SettingsView() {
  const { currentUser, showAlert, updateUser } = useAppStore()
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isSavingMaintenance, setIsSavingMaintenance] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<'unknown' | 'connected' | 'disconnected'>('unknown')

  // Track which fields the user has explicitly modified ("dirty" fields).
  // Only dirty fields are sent in handleSave — this prevents accidentally
  // wiping Drive credentials (Shared Drive ID, Service Account Key) when
  // the form failed to load current values from the API (e.g. cold-start 5xx
  // on Cloudflare Workers free plan). Previously, handleSave ALWAYS sent
  // driveParentFolderId & driveSharedDriveId, so an empty form submission
  // would overwrite the DB with null — making Drive "deactivate itself".
  const [dirtyFields, setDirtyFields] = useState<Set<string>>(new Set())
  const markDirty = (field: string) => {
    setDirtyFields(prev => {
      if (prev.has(field)) return prev
      const next = new Set(prev)
      next.add(field)
      return next
    })
  }

  const [settings, setSettings] = useState<SettingsData>({
    driveAutoCreate: false,
    driveParentFolderId: '',
    driveSharedDriveId: '',
    hasServiceAccountKey: false,
    driveApiKey: '',
    maintenanceMode: false,
    maintenanceMessage: ''
  })
  const [serviceAccountKey, setServiceAccountKey] = useState('')

  // Notification settings state
  const [notifSettings, setNotifSettings] = useState({
    notifWaEnabled: false,
    hasNotifWaToken: false,
    notifWaTokenMasked: '',
    notifWaDeviceId: '',
    notifWaSenderNumber: '',
    notifEmailEnabled: false,
    hasNotifEmailPass: false,
    notifEmailPassMasked: '',
    notifEmailHost: '',
    notifEmailPort: 587,
    notifEmailUser: '',
    notifEmailFromName: ''
  })
  const [notifWaToken, setNotifWaToken] = useState('')
  const [notifEmailPass, setNotifEmailPass] = useState('')
  const [showWaToken, setShowWaToken] = useState(false)
  const [showEmailPass, setShowEmailPass] = useState(false)
  const [isSavingNotif, setIsSavingNotif] = useState(false)
  const [isTestingNotif, setIsTestingNotif] = useState(false)
  const [testResult, setTestResult] = useState<{waSuccess?: boolean; emailSuccess?: boolean; waError?: string; emailError?: string} | null>(null)

  // Reviewer auto-approve state
  const [autoApprove, setAutoApprove] = useState(false)
  const [isSavingAutoApprove, setIsSavingAutoApprove] = useState(false)

  // Load reviewer settings
  useEffect(() => {
    if (currentUser?.role === 'Reviewer') {
      setAutoApprove(currentUser.autoApproveReview || false)
    }
  }, [currentUser])

  // Load settings
  useEffect(() => {
    const loadSettings = async () => {
      try {
        setLoadError(null)
        const [settingsRes, notifRes] = await Promise.all([
          fetch('/api/settings'),
          fetch('/api/notification-settings')
        ])
        // If the settings GET failed (e.g. cold-start 5xx on Workers free plan),
        // we must NOT render the editable form — otherwise the default empty
        // state would be saved on "Save", wiping the real DB values.
        if (!settingsRes.ok) {
          setLoadError(`Gagal memuat pengaturan (HTTP ${settingsRes.status}). Klik "Coba Lagi" untuk memuat ulang. Jangan menyimpan form dalam keadaan kosong — data Drive yang tersimpan bisa terhapus.`)
          setIsLoading(false)
          return
        }
        const data = await settingsRes.json()
        setSettings({
          driveAutoCreate: data.driveAutoCreate || false,
          driveParentFolderId: data.driveParentFolderId || '',
          driveSharedDriveId: data.driveSharedDriveId || '',
          hasServiceAccountKey: data.hasServiceAccountKey || false,
          driveApiKey: data.driveApiKey || '',
          maintenanceMode: data.maintenanceMode || false,
          maintenanceMessage: data.maintenanceMessage || ''
        })
        // Reset dirty tracking — form now matches DB, nothing is modified yet.
        setDirtyFields(new Set())
        if (notifRes.ok) {
          const notifData = await notifRes.json()
          setNotifSettings({
            notifWaEnabled: notifData.notifWaEnabled || false,
            hasNotifWaToken: notifData.hasNotifWaToken || false,
            notifWaTokenMasked: notifData.notifWaTokenMasked || '',
            notifWaDeviceId: notifData.notifWaDeviceId || '',
            notifWaSenderNumber: notifData.notifWaSenderNumber || '',
            notifEmailEnabled: notifData.notifEmailEnabled || false,
            hasNotifEmailPass: notifData.hasNotifEmailPass || false,
            notifEmailPassMasked: notifData.notifEmailPassMasked || '',
            notifEmailHost: notifData.notifEmailHost || '',
            notifEmailPort: notifData.notifEmailPort || 587,
            notifEmailUser: notifData.notifEmailUser || '',
            notifEmailFromName: notifData.notifEmailFromName || ''
          })
        }
      } catch (error) {
        console.error('Failed to load settings:', error)
        setLoadError('Gagal memuat pengaturan karena kesalahan jaringan. Klik "Coba Lagi" untuk memuat ulang.')
      } finally {
        setIsLoading(false)
      }
    }
    loadSettings()
  }, [])

  // Test connection
  const testConnection = async () => {
    setIsTesting(true)
    try {
      const response = await fetch('/api/drive')
      const data = await response.json()
      setConnectionStatus(data.connected ? 'connected' : 'disconnected')
      if (!data.connected) {
        showAlert(data.message || 'Koneksi gagal')
      }
    } catch {
      setConnectionStatus('disconnected')
    } finally {
      setIsTesting(false)
    }
  }

  // Toggle driveAutoCreate and auto-save
  // This only sends { driveAutoCreate } — it does NOT touch any other field,
  // so it cannot wipe Shared Drive ID / Service Account Key. Safe to auto-save.
  const handleToggleAutoCreate = async (checked: boolean) => {
    setSettings(prev => ({ ...prev, driveAutoCreate: checked }))
    markDirty('driveAutoCreate')
    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driveAutoCreate: checked })
      })
      if (!response.ok) {
        setSettings(prev => ({ ...prev, driveAutoCreate: !checked }))
        showAlert('Gagal mengubah pengaturan auto-create')
      }
    } catch {
      setSettings(prev => ({ ...prev, driveAutoCreate: !checked }))
      showAlert('Terjadi kesalahan saat mengubah pengaturan')
    }
  }

  // Save settings
  // IMPORTANT: Only send fields the user explicitly modified (dirty fields).
  // This prevents wiping Drive credentials (Shared Drive ID, Parent Folder ID)
  // when the form was loaded but the user didn't change those fields —
  // previously, handleSave always sent driveParentFolderId & driveSharedDriveId
  // (even empty strings from a failed load), which the backend converted to
  // null, destroying the stored values. Now, unmodified fields are omitted
  // entirely so the backend leaves them untouched.
  const handleSave = async () => {
    setIsSaving(true)
    try {
      const updateData: Record<string, unknown> = {}

      // Only include a field if the user actually modified it.
      // This is the key fix: unmodified fields are NOT sent, so the backend
      // cannot accidentally overwrite them with empty values.
      if (dirtyFields.has('driveAutoCreate')) {
        updateData.driveAutoCreate = settings.driveAutoCreate
      }
      if (dirtyFields.has('driveParentFolderId')) {
        updateData.driveParentFolderId = settings.driveParentFolderId
      }
      if (dirtyFields.has('driveSharedDriveId')) {
        updateData.driveSharedDriveId = settings.driveSharedDriveId
      }

      // Service account key: only sent when the user types a new one.
      // (Textarea is always empty on load — we never pre-fill secrets.)
      if (serviceAccountKey.trim()) {
        updateData.driveServiceAccountKey = serviceAccountKey
      }

      if (Object.keys(updateData).length === 0) {
        showAlert('Tidak ada perubahan untuk disimpan.')
        return
      }

      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData)
      })

      if (response.ok) {
        const data = await response.json()
        setSettings(prev => ({
          ...prev,
          driveAutoCreate: data.driveAutoCreate,
          driveParentFolderId: data.driveParentFolderId,
          driveSharedDriveId: data.driveSharedDriveId,
          hasServiceAccountKey: data.hasServiceAccountKey
        }))
        setServiceAccountKey('')
        setDirtyFields(new Set())
        showAlert('Pengaturan berhasil disimpan!')
      } else {
        const errData = await response.json().catch(() => ({}))
        showAlert(errData?.error || 'Gagal menyimpan pengaturan')
      }
    } catch {
      showAlert('Terjadi kesalahan saat menyimpan')
    } finally {
      setIsSaving(false)
    }
  }

  // Save maintenance settings
  const handleSaveMaintenance = async () => {
    setIsSavingMaintenance(true)
    try {
      const response = await fetch('/api/maintenance', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maintenanceMode: settings.maintenanceMode,
          maintenanceMessage: settings.maintenanceMessage,
          userId: currentUser?.id
        })
      })

      if (response.ok) {
        const data = await response.json()
        setSettings(prev => ({
          ...prev,
          maintenanceMode: data.maintenance,
          maintenanceMessage: data.message || ''
        }))
        showAlert(settings.maintenanceMode
          ? 'Mode maintenance diaktifkan! User lain tidak dapat mengakses.'
          : 'Mode maintenance dinonaktifkan! User lain dapat mengakses kembali.'
        )
      } else {
        const data = await response.json()
        showAlert(data.error || 'Gagal menyimpan pengaturan maintenance')
      }
    } catch {
      showAlert('Terjadi kesalahan saat menyimpan')
    } finally {
      setIsSavingMaintenance(false)
    }
  }

  // Reviewer-specific settings view
  if (currentUser?.role === 'Reviewer') {
    const handleToggleAutoApprove = async (checked: boolean) => {
      setIsSavingAutoApprove(true)
      try {
        const response = await fetch('/api/users/reviewer-settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUser.id, autoApproveReview: checked })
        })
        if (response.ok) {
          setAutoApprove(checked)
          // Update the store's currentUser
          if (currentUser) {
            updateUser({ ...currentUser, autoApproveReview: checked })
          }
          showAlert(checked
            ? 'Auto-Approve diaktifkan! Review Anda akan otomatis disetujui pada SEMUA proyek (mode biasa maupun Fast Production) saat proyek mencapai tahap Review.'
            : 'Auto-Approve dinonaktifkan. Anda harus melakukan review secara manual.'
          )
        } else {
          showAlert('Gagal mengubah pengaturan auto-approve')
        }
      } catch {
        showAlert('Terjadi kesalahan saat mengubah pengaturan')
      } finally {
        setIsSavingAutoApprove(false)
      }
    }

    return (
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <SettingsIcon className="w-6 h-6 text-stone-600" />
          <div>
            <h1 className="text-2xl font-bold text-stone-800">Pengaturan Reviewer</h1>
            <p className="text-stone-500 text-sm">Konfigurasi otomatisasi proses review</p>
          </div>
        </div>

        {/* Auto-Approve Card */}
        <Card className={cn(
          "border-2 transition-all",
          autoApprove
            ? "bg-green-50/50 border-green-300"
            : "bg-white border-stone-200"
        )}>
          <CardHeader className="border-b border-stone-100">
            <div className="flex items-center gap-3">
              <div className={cn(
                "p-2 rounded-lg",
                autoApprove ? "bg-green-100" : "bg-amber-50"
              )}>
                <CheckCircle2 className={cn(
                  "w-5 h-5",
                  autoApprove ? "text-green-600" : "text-amber-600"
                )} />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-lg">Auto-Approve Review</CardTitle>
                  {autoApprove && (
                    <span className="px-2 py-0.5 bg-green-500 text-white text-xs rounded-full font-medium">
                      AKTIF
                    </span>
                  )}
                </div>
                <CardDescription>
                  Otomatis menyetujui review Anda pada setiap proyek saat mencapai tahap Review
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            {/* Info box */}
            <div className={cn(
              "p-4 rounded-xl text-sm",
              autoApprove
                ? "bg-green-50 text-green-800"
                : "bg-amber-50 text-amber-800"
            )}>
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">
                    {autoApprove ? "✅ Auto-Approve Aktif" : "ℹ️ Tentang Auto-Approve"}
                  </p>
                  <p className="mt-1">
                    {autoApprove
                      ? "Pada SEMUA proyek (mode biasa maupun Fast Production), saat proyek mencapai tahap Review (tahap 3), tugas review Anda akan otomatis disetujui tanpa perlu menekan tombol \"Teruskan File\". Jika semua reviewer telah menyelesaikan review (auto atau manual), proyek akan otomatis berpindah ke tahap berikutnya."
                      : "Saat diaktifkan, tugas review Anda akan otomatis disetujui pada setiap proyek yang mencapai tahap Review (tahap 3). Berlaku untuk mode biasa maupun Fast Production. Reviewer lain yang belum mengaktifkan fitur ini tetap harus melakukan review secara manual."
                    }
                  </p>
                </div>
              </div>
            </div>

            {/* Toggle */}
            <div className="flex items-center justify-between gap-3 p-3 sm:p-4 rounded-xl bg-stone-50">
              <div className="min-w-0">
                <Label className="text-base font-semibold">Aktifkan Auto-Approve</Label>
                <p className="text-sm text-stone-500 mt-1">
                  Lewati tahap review secara otomatis
                </p>
              </div>
              <Switch
                checked={autoApprove}
                onCheckedChange={handleToggleAutoApprove}
                disabled={isSavingAutoApprove}
              />
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (currentUser?.role !== 'Admin') {
    return (
      <Card className="max-w-2xl mx-auto">
        <CardContent className="p-8 text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-stone-800">Akses Ditolak</h2>
          <p className="text-stone-500 mt-2">Hanya Super Admin dan Reviewer yang dapat mengakses pengaturan.</p>
        </CardContent>
      </Card>
    )
  }

  if (isLoading) {
    return (
      <Card className="max-w-4xl mx-auto">
        <CardContent className="p-8 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-600 mx-auto" />
          <p className="text-stone-500 mt-4">Memuat pengaturan...</p>
        </CardContent>
      </Card>
    )
  }

  // Load-error guard: if GET /api/settings failed, show an error + retry
  // instead of the editable form. This is the PRIMARY fix for the "Drive
  // auto-create deactivates itself" bug — previously, a failed load left the
  // form in its default empty state, and clicking "Save" would overwrite the
  // real DB values (Shared Drive ID, etc.) with empty strings → null.
  if (loadError) {
    return (
      <Card className="max-w-4xl mx-auto">
        <CardContent className="p-8 text-center space-y-4">
          <AlertCircle className="w-12 h-12 text-amber-500 mx-auto" />
          <h2 className="text-lg font-semibold text-stone-800">Gagal Memuat Pengaturan</h2>
          <p className="text-stone-600 text-sm max-w-md mx-auto whitespace-pre-line">{loadError}</p>
          <Button
            onClick={() => {
              setIsLoading(true)
              setLoadError(null)
              // Re-trigger the load effect by toggling a state the effect depends on.
              // Since the effect has [] deps, we reload the page section via location.reload()
              // to keep it simple and reliable.
              if (typeof window !== 'undefined') window.location.reload()
            }}
            className="gap-2"
          >
            <Loader2 className="w-4 h-4" />
            Coba Lagi
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <SettingsIcon className="w-6 h-6 text-stone-600" />
        <div>
          <h1 className="text-2xl font-bold text-stone-800">Pengaturan</h1>
          <p className="text-stone-500 text-sm">Konfigurasi sistem Pushakin Flows</p>
        </div>
      </div>

      {/* Maintenance Mode Card - Admin Only */}
      <Card className={cn(
        "border-2 transition-all",
        settings.maintenanceMode
          ? "bg-red-50 border-red-300"
          : "bg-white border-stone-200"
      )}>
        <CardHeader className="border-b border-stone-100">
          <div className="flex items-center gap-3">
            <div className={cn(
              "p-2 rounded-lg",
              settings.maintenanceMode ? "bg-red-100" : "bg-amber-50"
            )}>
              <Wrench className={cn(
                "w-5 h-5",
                settings.maintenanceMode ? "text-red-600" : "text-amber-600"
              )} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <CardTitle className="text-lg">Mode Maintenance</CardTitle>
                {settings.maintenanceMode && (
                  <span className="px-2 py-0.5 bg-red-500 text-white text-xs rounded-full font-medium animate-pulse">
                    AKTIF
                  </span>
                )}
              </div>
              <CardDescription>
                Aktifkan untuk membatasi akses hanya untuk Super Admin
              </CardDescription>
            </div>
            <Shield className="w-5 h-5 text-violet-500" />
          </div>
        </CardHeader>

        <CardContent className="p-6 space-y-4">
          {/* Warning */}
          <div className={cn(
            "p-4 rounded-xl text-sm",
            settings.maintenanceMode
              ? "bg-red-100 text-red-800"
              : "bg-amber-50 text-amber-800"
          )}>
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">
                  {settings.maintenanceMode
                    ? "⚠️ Mode Maintenance Sedang Aktif"
                    : "ℹ️ Tentang Mode Maintenance"
                  }
                </p>
                <p className="mt-1">
                  {settings.maintenanceMode
                    ? "Semua user selain Super Admin akan melihat halaman maintenance dan tidak dapat mengakses aplikasi."
                    : "Saat diaktifkan, hanya Super Admin yang dapat mengakses aplikasi. User lain akan melihat halaman maintenance."
                  }
                </p>
              </div>
            </div>
          </div>

          {/* Enable Toggle */}
          <div className="flex items-center justify-between gap-3 p-3 sm:p-4 rounded-xl bg-stone-50">
            <div className="min-w-0">
              <Label className="text-base font-semibold">Aktifkan Maintenance</Label>
              <p className="text-sm text-stone-500 mt-1">
                Non-Admin tidak dapat mengakses aplikasi
              </p>
            </div>
            <Switch
              checked={settings.maintenanceMode}
              onCheckedChange={(checked) =>
                setSettings(prev => ({ ...prev, maintenanceMode: checked }))
              }
            />
          </div>

          {/* Maintenance Message */}
          <div className="space-y-2">
            <Label htmlFor="maintenanceMessage">Pesan Maintenance (Opsional)</Label>
            <Textarea
              id="maintenanceMessage"
              value={settings.maintenanceMessage}
              onChange={(e) =>
                setSettings(prev => ({ ...prev, maintenanceMessage: e.target.value }))
              }
              placeholder="Contoh: Sedang melakukan update sistem. Estimasi selesai pukul 14:00 WIB."
              rows={3}
            />
            <p className="text-xs text-stone-500">
              Pesan ini akan ditampilkan kepada user selama maintenance.
            </p>
          </div>

          {/* Save Button */}
          <div className="flex justify-end pt-2">
            <Button
              onClick={handleSaveMaintenance}
              disabled={isSavingMaintenance}
              className={cn(
                settings.maintenanceMode
                  ? "bg-red-600 hover:bg-red-700"
                  : "bg-indigo-600 hover:bg-indigo-700"
              )}
            >
              {isSavingMaintenance ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  <span>Menyimpan...</span>
                </>
              ) : (
                settings.maintenanceMode ? 'Simpan (Maintenance Aktif)' : 'Simpan Pengaturan'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Notification Settings Card - WA & Email */}
      <Card>
        <CardHeader className="border-b border-stone-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-violet-100 to-purple-100 rounded-lg">
              <Bell className="w-5 h-5 text-violet-600" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-lg">Notifikasi WhatsApp & Email</CardTitle>
              <CardDescription>
                Kirim notifikasi otomatis saat proyek dibuat, stage berlanjut, atau review
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-6 space-y-6">
          {/* WhatsApp Section */}
          <div className={cn(
            "space-y-4 p-4 rounded-xl border-2 transition-all",
            notifSettings.notifWaEnabled
              ? "bg-green-50 border-green-300"
              : "bg-stone-50 border-transparent"
          )}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <MessageCircle className="w-5 h-5 text-green-600" />
                <div>
                  <Label className="text-base font-semibold text-green-900">WhatsApp</Label>
                  <p className="text-sm text-stone-500">Notifikasi via Fonnte API</p>
                </div>
              </div>
              <Switch
                checked={notifSettings.notifWaEnabled}
                onCheckedChange={(checked) =>
                  setNotifSettings(prev => ({ ...prev, notifWaEnabled: checked }))
                }
              />
            </div>

            {notifSettings.notifWaEnabled && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="notifWaToken">API Token Fonnte</Label>
                  <div className="relative">
                    <Input
                      id="notifWaToken"
                      type={showWaToken ? 'text' : 'password'}
                      value={notifWaToken}
                      onChange={(e) => setNotifWaToken(e.target.value)}
                      placeholder={notifSettings.hasNotifWaToken
                        ? `Token tersimpan: ${notifSettings.notifWaTokenMasked}`
                        : 'Masukkan API token Fonnte'
                      }
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowWaToken(!showWaToken)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
                    >
                      {showWaToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="notifWaDeviceId">Device ID (Opsional)</Label>
                  <Input
                    id="notifWaDeviceId"
                    value={notifSettings.notifWaDeviceId}
                    onChange={(e) =>
                      setNotifSettings(prev => ({ ...prev, notifWaDeviceId: e.target.value }))
                    }
                    placeholder="Fonnte device ID"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="notifWaSenderNumber">Nomor Pengirim WA (Opsional)</Label>
                  <Input
                    id="notifWaSenderNumber"
                    value={notifSettings.notifWaSenderNumber}
                    onChange={(e) =>
                      setNotifSettings(prev => ({ ...prev, notifWaSenderNumber: e.target.value }))
                    }
                    placeholder="628xxxxxxxxxx (untuk test kirim)"
                  />\n                </div>

                <div className="flex items-start gap-2 p-3 bg-green-100 rounded-lg text-sm text-green-800">
                  <ExternalLink className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>Dapatkan token di <a href="https://fonnte.com" target="_blank" rel="noopener noreferrer" className="underline font-semibold">fonnte.com</a></span>
                </div>
              </div>
            )}
          </div>

          {/* Email Section */}
          <div className={cn(
            "space-y-4 p-4 rounded-xl border-2 transition-all",
            notifSettings.notifEmailEnabled
              ? "bg-sky-50 border-sky-300"
              : "bg-stone-50 border-transparent"
          )}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Mail className="w-5 h-5 text-sky-600" />
                <div>
                  <Label className="text-base font-semibold text-sky-900">Email</Label>
                  <p className="text-sm text-stone-500">Notifikasi via SMTP</p>
                </div>
              </div>
              <Switch
                checked={notifSettings.notifEmailEnabled}
                onCheckedChange={(checked) =>
                  setNotifSettings(prev => ({ ...prev, notifEmailEnabled: checked }))
                }
              />
            </div>

            {notifSettings.notifEmailEnabled && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="notifEmailHost">SMTP Host</Label>
                    <Input
                      id="notifEmailHost"
                      value={notifSettings.notifEmailHost}
                      onChange={(e) =>
                        setNotifSettings(prev => ({ ...prev, notifEmailHost: e.target.value }))
                      }
                      placeholder="smtp.gmail.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="notifEmailPort">SMTP Port</Label>
                    <Input
                      id="notifEmailPort"
                      type="number"
                      value={notifSettings.notifEmailPort}
                      onChange={(e) =>
                        setNotifSettings(prev => ({ ...prev, notifEmailPort: parseInt(e.target.value) || 587 }))
                      }
                      placeholder="587"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="notifEmailUser">Email User</Label>
                  <Input
                    id="notifEmailUser"
                    type="email"
                    value={notifSettings.notifEmailUser}
                    onChange={(e) =>
                      setNotifSettings(prev => ({ ...prev, notifEmailUser: e.target.value }))
                    }
                    placeholder="email@gmail.com"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="notifEmailPass">Email Password / App Password</Label>
                  <div className="relative">
                    <Input
                      id="notifEmailPass"
                      type={showEmailPass ? 'text' : 'password'}
                      value={notifEmailPass}
                      onChange={(e) => setNotifEmailPass(e.target.value)}
                      placeholder={notifSettings.hasNotifEmailPass
                        ? `Password tersimpan: ${notifSettings.notifEmailPassMasked}`
                        : 'Masukkan password atau app password'
                      }
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowEmailPass(!showEmailPass)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
                    >
                      {showEmailPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="notifEmailFromName">Nama Pengirim</Label>
                  <Input
                    id="notifEmailFromName"
                    value={notifSettings.notifEmailFromName}
                    onChange={(e) =>
                      setNotifSettings(prev => ({ ...prev, notifEmailFromName: e.target.value }))
                    }
                    placeholder="Pushakin Flows"
                  />
                </div>

                <div className="flex items-start gap-2 p-3 bg-sky-100 rounded-lg text-sm text-sky-800">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>Untuk Gmail, gunakan <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" className="underline font-semibold">App Password</a> (myaccount.google.com/apppasswords)</span>
                </div>
              </div>
            )}
          </div>

          {/* Test result display */}
          {testResult && (
            <div className="space-y-2 p-4 rounded-xl bg-stone-50 border border-stone-200">
              <p className="text-sm font-semibold text-stone-700">Hasil Test Notifikasi:</p>
              {testResult.waSuccess !== undefined && (
                <p className="text-sm flex items-center gap-2">
                  {testResult.waSuccess ? (
                    <><CheckCircle2 className="w-4 h-4 text-green-600" /><span className="text-green-700">WhatsApp: Terkirim</span></>
                  ) : (
                    <><XCircle className="w-4 h-4 text-red-500" /><span className="text-red-600">WhatsApp: {testResult.waError || 'Gagal'}</span></>
                  )}
                </p>
              )}
              {testResult.emailSuccess !== undefined && (
                <p className="text-sm flex items-center gap-2">
                  {testResult.emailSuccess ? (
                    <><CheckCircle2 className="w-4 h-4 text-green-600" /><span className="text-green-700">Email: Terkirim</span></>
                  ) : (
                    <><XCircle className="w-4 h-4 text-red-500" /><span className="text-red-600">Email: {testResult.emailError || 'Gagal'}</span></>
                  )}
                </p>
              )}
            </div>
          )}

          {/* Save & Test Buttons */}
          <div className="flex flex-col sm:flex-row justify-end gap-3 pt-4 border-t border-stone-100">
            <Button
              onClick={async () => {
                setIsTestingNotif(true)
                setTestResult(null)
                try {
                  const response = await fetch('/api/notification-settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ adminUserId: currentUser?.id })
                  })
                  if (response.ok) {
                    setTestResult(await response.json())
                  } else {
                    showAlert('Gagal mengirim test notifikasi')
                  }
                } catch {
                  showAlert('Terjadi kesalahan saat test notifikasi')
                } finally {
                  setIsTestingNotif(false)
                }
              }}
              disabled={isTestingNotif}
              variant="outline"
              className="gap-2"
            >
              {isTestingNotif ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              Test Kirim
            </Button>
            <Button
              onClick={async () => {
                setIsSavingNotif(true)
                try {
                  const updateData: Record<string, any> = {
                    notifWaEnabled: notifSettings.notifWaEnabled,
                    notifWaDeviceId: notifSettings.notifWaDeviceId,
                    notifWaSenderNumber: notifSettings.notifWaSenderNumber,
                    notifEmailEnabled: notifSettings.notifEmailEnabled,
                    notifEmailHost: notifSettings.notifEmailHost,
                    notifEmailPort: notifSettings.notifEmailPort,
                    notifEmailUser: notifSettings.notifEmailUser,
                    notifEmailFromName: notifSettings.notifEmailFromName
                  }
                  if (notifWaToken.trim()) updateData.notifWaToken = notifWaToken
                  if (notifEmailPass.trim()) updateData.notifEmailPass = notifEmailPass

                  const response = await fetch('/api/notification-settings', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(updateData)
                  })
                  if (response.ok) {
                    const data = await response.json()
                    setNotifSettings({
                      notifWaEnabled: data.notifWaEnabled,
                      hasNotifWaToken: data.hasNotifWaToken,
                      notifWaTokenMasked: data.notifWaTokenMasked || '',
                      notifWaDeviceId: data.notifWaDeviceId || '',
                      notifWaSenderNumber: data.notifWaSenderNumber || '',
                      notifEmailEnabled: data.notifEmailEnabled,
                      hasNotifEmailPass: data.hasNotifEmailPass,
                      notifEmailPassMasked: data.notifEmailPassMasked || '',
                      notifEmailHost: data.notifEmailHost || '',
                      notifEmailPort: data.notifEmailPort || 587,
                      notifEmailUser: data.notifEmailUser || '',
                      notifEmailFromName: data.notifEmailFromName || ''
                    })
                    setNotifWaToken('')
                    setNotifEmailPass('')
                    setTestResult(null)
                    showAlert('Pengaturan notifikasi berhasil disimpan!')
                  } else {
                    showAlert('Gagal menyimpan pengaturan notifikasi')
                  }
                } catch {
                  showAlert('Terjadi kesalahan saat menyimpan')
                } finally {
                  setIsSavingNotif(false)
                }
              }}
              disabled={isSavingNotif}
              className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 gap-2"
            >
              {isSavingNotif ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              Simpan Pengaturan Notifikasi
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* External App Links Manager — Super Admin only */}
      <ExternalLinksManager />

      {/* Shared Drive Notice */}
      <Card className="bg-amber-50 border-amber-200">
        <CardContent className="p-5">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-800">
              <p className="font-semibold">⚠️ Penting: Gunakan Shared Drive (Drive Bersama)</p>
              <p className="mt-1">
                Service Account tidak memiliki kuota penyimpanan sendiri. Anda <strong>HARUS</strong> menggunakan Shared Drive untuk upload file.
              </p>
              <ol className="mt-2 space-y-1 list-decimal list-inside">
                <li>Buat Shared Drive di Google Drive (klik "Shared Drives" → "New")</li>
                <li>Tambahkan email Service Account sebagai member dengan akses "Content manager"</li>
                <li>Masukkan Shared Drive ID di field di bawah</li>
              </ol>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Google Drive Integration */}
      <Card>
        <CardHeader className="border-b border-stone-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-50 rounded-lg">
                <Folder className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <CardTitle className="text-lg">Integrasi Google Drive</CardTitle>
                <CardDescription>
                  Otomatis membuat folder proyek di Google Drive
                </CardDescription>
              </div>
            </div>

            {/* Connection Status */}
            <div className="flex items-center gap-3">
              {connectionStatus !== 'unknown' && (
                <div className={cn(
                  "flex items-center gap-1.5 text-sm",
                  connectionStatus === 'connected' ? "text-green-600" : "text-red-500"
                )}>
                  {connectionStatus === 'connected' ? (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Terhubung</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="w-4 h-4" />
                      <span>Tidak Terhubung</span>
                    </>
                  )}
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={testConnection}
                disabled={isTesting || !settings.hasServiceAccountKey}
              >
                {isTesting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  'Test Koneksi'
                )}
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-6 space-y-6">
          {/* Enable Toggle */}
          <div className={cn(
            "flex items-center justify-between gap-3 p-3 sm:p-4 rounded-xl border-2 transition-all",
            settings.driveAutoCreate
              ? "bg-green-50 border-green-300"
              : "bg-stone-50 border-transparent"
          )}>
            <div className="min-w-0">
              <Label className="text-base font-semibold">Aktifkan Auto-Create Folder</Label>
              <p className="text-sm text-stone-500 mt-1">
                Saat proyek baru dibuat, folder akan otomatis dibuat di Google Drive
              </p>
              {settings.driveAutoCreate && (
                <p className="text-sm text-green-600 font-medium mt-2">
                  ✓ Google Drive Auto-Create AKTIF
                </p>
              )}
            </div>
            <Switch
              checked={settings.driveAutoCreate}
              onCheckedChange={handleToggleAutoCreate}
            />
          </div>

          {/* Warning when required config is missing */}
          {settings.driveAutoCreate && !settings.hasServiceAccountKey && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-sm">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Service Account diperlukan</p>
                  <p className="mt-1">
                    Auto-Create sudah diaktifkan, tetapi Anda perlu mengunggah Google Service Account Key agar folder bisa dibuat otomatis.
                  </p>
                </div>
              </div>
            </div>
          )}

          {settings.driveAutoCreate && settings.hasServiceAccountKey && !settings.driveSharedDriveId && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-sm">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Shared Drive ID diperlukan</p>
                  <p className="mt-1">
                    Auto-Create sudah diaktifkan, tetapi folder tidak dapat dibuat tanpa Shared Drive ID. Masukkan ID di bawah.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Shared Drive ID - IMPORTANT */}
          <div className="space-y-2 p-4 bg-indigo-50 rounded-xl border border-indigo-200">
            <div className="flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-indigo-600" />
              <Label htmlFor="sharedDrive" className="font-semibold text-indigo-900">
                Shared Drive ID (WAJIB)
              </Label>
            </div>
            <Input
              id="sharedDrive"
              value={settings.driveSharedDriveId}
              onChange={(e) => {
                setSettings(prev => ({ ...prev, driveSharedDriveId: e.target.value }))
                markDirty('driveSharedDriveId')
              }}
              placeholder="Contoh: 0AEd3EhGff9SaUk9PVA"
              className="bg-white"
            />
            <p className="text-xs text-indigo-700">
              <strong>Cara mendapatkan Shared Drive ID:</strong> Buka Shared Drive di Google Drive,
              lihat URL: <code className="bg-white px-1 rounded">drive.google.com/drive/folders/[SHARED_DRIVE_ID]</code>
            </p>
          </div>

          {/* Parent Folder ID */}
          <div className="space-y-2">
            <Label htmlFor="parentFolder">Parent Folder ID (Opsional)</Label>
            <div className="flex gap-2">
              <Input
                id="parentFolder"
                value={settings.driveParentFolderId}
                onChange={(e) => {
                  setSettings(prev => ({ ...prev, driveParentFolderId: e.target.value }))
                  markDirty('driveParentFolderId')
                }}
                placeholder="Contoh: 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OEgvA"
                className="flex-1"
              />
              {settings.driveParentFolderId && (
                <Button
                  variant="ghost"
                  size="icon"
                  asChild
                >
                  <a
                    href={`https://drive.google.com/drive/folders/${settings.driveParentFolderId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </Button>
              )}
            </div>
            <p className="text-xs text-stone-500">
              ID folder induk di dalam Shared Drive tempat folder proyek akan dibuat. Kosongkan untuk membuat di root Shared Drive.
            </p>
          </div>

          {/* Service Account Key */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Key className="w-4 h-4 text-stone-500" />
              <Label>Google Service Account Key (JSON)</Label>
            </div>

            {settings.hasServiceAccountKey && (
              <div className="flex items-center gap-2 text-sm text-green-600">
                <CheckCircle2 className="w-4 h-4" />
                <span>Service Account sudah dikonfigurasi</span>
              </div>
            )}

            <Textarea
              value={serviceAccountKey}
              onChange={(e) => setServiceAccountKey(e.target.value)}
              placeholder={settings.hasServiceAccountKey
                ? "Masukkan key baru untuk mengganti key yang ada..."
                : 'Paste isi file JSON Service Account di sini...'
              }
              rows={6}
              className="font-mono text-xs"
            />
          </div>

          {/* Save Button */}
          <div className="flex flex-col sm:flex-row justify-between gap-3 pt-4 border-t border-stone-100">
            {/* Explicit "Disconnect Drive" — uses forceClear:true so the backend
                allows clearing the protected fields. This is the ONLY way to
                intentionally remove the Service Account Key / Shared Drive ID. */}
            {(settings.hasServiceAccountKey || settings.driveSharedDriveId) && (
              <Button
                onClick={async () => {
                  if (!confirm(
                    'Yakin ingin MEMUTUSKAN koneksi Google Drive?\n\n' +
                    'Semua data Drive (Service Account Key, Shared Drive ID, Parent Folder ID) akan dihapus.\n' +
                    'Proyek baru TIDAK dapat dibuat sampai Drive dikonfigurasi ulang.\n\n' +
                    'Lanjutkan?'
                  )) return
                  setIsSaving(true)
                  try {
                    const response = await fetch('/api/settings', {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        driveServiceAccountKey: '',
                        driveSharedDriveId: '',
                        driveParentFolderId: '',
                        driveAutoCreate: false,
                        forceClear: true
                      })
                    })
                    if (response.ok) {
                      const data = await response.json()
                      setSettings(prev => ({
                        ...prev,
                        driveAutoCreate: data.driveAutoCreate,
                        driveParentFolderId: data.driveParentFolderId,
                        driveSharedDriveId: data.driveSharedDriveId,
                        hasServiceAccountKey: data.hasServiceAccountKey
                      }))
                      setServiceAccountKey('')
                      setDirtyFields(new Set())
                      showAlert('Koneksi Google Drive berhasil diputus.')
                    } else {
                      showAlert('Gagal memutuskan koneksi Drive')
                    }
                  } catch {
                    showAlert('Terjadi kesalahan saat memutuskan koneksi')
                  } finally {
                    setIsSaving(false)
                  }
                }}
                disabled={isSaving}
                variant="outline"
                className="gap-2 text-red-600 border-red-300 hover:bg-red-50"
              >
                <XCircle className="w-4 h-4" />
                Putuskan Koneksi Drive
              </Button>
            )}
            <Button
              onClick={handleSave}
              disabled={isSaving}
              className="bg-indigo-600 hover:bg-indigo-700 sm:ml-auto"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  <span>Menyimpan...</span>
                </>
              ) : (
                'Simpan Pengaturan'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Instructions Card */}
      <Card className="bg-gradient-to-br from-indigo-50 to-purple-50 border-indigo-100">
        <CardHeader>
          <CardTitle className="text-lg text-indigo-900">Petunjuk Setup Lengkap</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-indigo-800 space-y-4">
          <div>
            <h4 className="font-semibold mb-2">Langkah 1: Buat Service Account</h4>
            <p>Buat di Google Cloud Console → IAM & Admin → Service Accounts. Buat key JSON dan simpan.</p>
          </div>
          <div>
            <h4 className="font-semibold mb-2">Langkah 2: Aktifkan Google Drive API</h4>
            <p>Di Google Cloud Console, buka Library dan aktifkan "Google Drive API".</p>
          </div>
          <div>
            <h4 className="font-semibold mb-2">Langkah 3: Buat Shared Drive</h4>
            <p>Buka Google Drive → "Shared Drives" → "New". Beri nama misalnya "Pushakin Projects".</p>
          </div>
          <div>
            <h4 className="font-semibold mb-2">Langkah 4: Tambahkan Service Account ke Shared Drive</h4>
            <p>
              Klik kanan Shared Drive → "Add members" → Masukkan email Service Account
              (format: <code className="bg-white px-1 rounded">nama@project-id.iam.gserviceaccount.com</code>)
              dengan akses "Content manager".
            </p>
          </div>
          <div>
            <h4 className="font-semibold mb-2">Langkah 5: Masukkan Konfigurasi</h4>
            <p>Copy Shared Drive ID dari URL dan paste ke field di atas, lalu simpan.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
