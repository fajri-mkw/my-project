'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import { useAppStore, ROLES, getRoleDisplayName } from '@/lib/store'
import { 
  Save, 
  CheckCircle2, 
  UploadCloud,
  KeyRound,
  Eye,
  EyeOff,
  Loader2,
  Shield,
  XCircle,
  Bell,
  MessageCircle,
  Mail,
  Info
} from 'lucide-react'
import { useState, useRef } from 'react'
import { toast } from 'sonner'

export function ProfileView() {
  const { currentUser, setCurrentUser, updateUser, showAlert } = useAppStore()
  const [profileData, setProfileData] = useState(currentUser)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Password change state
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  })

  // Notification preferences state
  const [notifPrefs, setNotifPrefs] = useState({
    notifWaEnabled: true,
    notifEmailEnabled: true
  })
  const [isSavingNotifPrefs, setIsSavingNotifPrefs] = useState(false)
  const [notifPrefsSuccess, setNotifPrefsSuccess] = useState(false)
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [isChangingPassword, setIsChangingPassword] = useState(false)
  const [passwordSuccess, setPasswordSuccess] = useState(false)

  if (!profileData) return null

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const response = await fetch('/api/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profileData)
      })
      
      if (response.ok) {
        setCurrentUser(profileData)
        updateUser(profileData)
        setSaveSuccess(true)
        setTimeout(() => setSaveSuccess(false), 3000)
      } else {
        showAlert('Gagal menyimpan profil')
      }
    } catch {
      showAlert('Terjadi kesalahan')
    }
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onloadend = () => {
        setProfileData({ ...profileData, avatar: reader.result as string })
      }
      reader.readAsDataURL(file)
    }
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // Validation
    if (!passwordData.currentPassword || !passwordData.newPassword || !passwordData.confirmPassword) {
      toast.error('Semua field password harus diisi')
      return
    }

    if (passwordData.newPassword.length < 8) {
      toast.error('Password baru minimal 8 karakter')
      return
    }

    if (!/[a-zA-Z]/.test(passwordData.newPassword) || !/[0-9]/.test(passwordData.newPassword)) {
      toast.error('Password baru harus kombinasi huruf dan angka')
      return
    }

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast.error('Konfirmasi password tidak cocok')
      return
    }

    if (passwordData.currentPassword === passwordData.newPassword) {
      toast.error('Password baru harus berbeda dari password saat ini')
      return
    }

    setIsChangingPassword(true)

    try {
      const response = await fetch('/api/users/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: profileData.id,
          currentPassword: passwordData.currentPassword,
          newPassword: passwordData.newPassword
        })
      })

      const text = await response.text()
      const data = text ? JSON.parse(text) : {}

      if (response.ok) {
        toast.success('Password berhasil diubah!')
        setPasswordData({
          currentPassword: '',
          newPassword: '',
          confirmPassword: ''
        })
        setPasswordSuccess(true)
        setTimeout(() => setPasswordSuccess(false), 3000)
      } else {
        toast.error(data.error || 'Gagal mengubah password')
      }
    } catch {
      toast.error('Terjadi kesalahan')
    } finally {
      setIsChangingPassword(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Profile Card */}
      <Card className="overflow-hidden">
        {/* Header with Avatar */}
        <CardHeader className="bg-stone-50 border-b border-stone-100 p-4 sm:p-8">
          <div className="flex flex-col md:flex-row items-center gap-6">
            <div
              className="relative group cursor-pointer shrink-0"
              onClick={() => fileInputRef.current?.click()}
            >
              <Avatar className="h-24 w-24 border-4 border-white shadow-md group-hover:opacity-75 transition-opacity">
                <AvatarImage src={profileData.avatar || ''} alt={profileData.name} />
                <AvatarFallback>{profileData.name.charAt(0)}</AvatarFallback>
              </Avatar>
              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-stone-900/40 opacity-0 group-hover:opacity-100 transition-opacity">
                <UploadCloud className="w-8 h-8 text-white" />
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageUpload}
              />
            </div>
            <div className="text-center md:text-left flex-1">
              <h2 className="text-2xl font-bold text-stone-900">{profileData.name}</h2>
              <p className="text-violet-600 font-medium">{getRoleDisplayName(profileData.role)}</p>
              <p className="text-sm text-stone-500 mt-1">{profileData.email}</p>
            </div>
          </div>
        </CardHeader>

        {/* Form */}
        <CardContent className="p-4 sm:p-6 lg:p-8">
          <form onSubmit={handleSaveProfile} className="space-y-6">
            {saveSuccess && (
              <div className="bg-green-50 text-green-700 p-4 rounded-xl text-sm font-medium border border-green-200 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5" />
                <span>Profil berhasil diperbarui!</span>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label htmlFor="name">Nama Lengkap</Label>
                <Input
                  id="name"
                  required
                  value={profileData.name}
                  onChange={e => setProfileData({...profileData, name: e.target.value})}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="role">Peran (Role)</Label>
                <Select
                  value={profileData.role}
                  onValueChange={(value) => setProfileData({...profileData, role: value as typeof profileData.role})}
                  disabled={currentUser?.role !== 'Admin'}
                >
                  <SelectTrigger id="role" className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map(r => (
                      <SelectItem key={r} value={r}>{getRoleDisplayName(r)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={profileData.email}
                  onChange={e => setProfileData({...profileData, email: e.target.value})}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="whatsapp">No. WhatsApp</Label>
                <Input
                  id="whatsapp"
                  value={profileData.whatsapp}
                  onChange={e => setProfileData({...profileData, whatsapp: e.target.value})}
                  className="mt-1"
                />
              </div>
            </div>

            <div className="pt-6 border-t border-stone-100 flex justify-end">
              <Button type="submit" className="gap-2 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 shadow-md shadow-violet-500/20">
                <Save className="w-4 h-4" />
                <span>Simpan Perubahan</span>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Password Change Card */}
      <Card className="overflow-hidden">
        <CardHeader className="bg-stone-50 border-b border-stone-100 p-4 sm:p-6">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-amber-100 to-orange-100 p-2 rounded-xl text-amber-600">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <CardTitle className="text-lg text-stone-800">Keamanan Akun</CardTitle>
              <p className="text-sm text-stone-500">Ubah password untuk keamanan akun Anda</p>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-4 sm:p-6">
          <form onSubmit={handleChangePassword} className="space-y-5">
            {/* Start Password Card content */}
            {passwordSuccess && (
              <div className="bg-green-50 text-green-700 p-4 rounded-xl text-sm font-medium border border-green-200 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5" />
                <span>Password berhasil diubah!</span>
              </div>
            )}

            {/* Current Password */}
            <div>
              <Label htmlFor="currentPassword">Password Saat Ini</Label>
              <div className="relative mt-1">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                <Input
                  id="currentPassword"
                  type={showCurrentPassword ? 'text' : 'password'}
                  value={passwordData.currentPassword}
                  onChange={e => setPasswordData({...passwordData, currentPassword: e.target.value})}
                  placeholder="Masukkan password saat ini"
                  className="pl-10 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
                >
                  {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <Separator className="my-4" />

            {/* New Password */}
            <div>
              <Label htmlFor="newPassword">Password Baru</Label>
              <div className="relative mt-1">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                <Input
                  id="newPassword"
                  type={showNewPassword ? 'text' : 'password'}
                  value={passwordData.newPassword}
                  onChange={e => setPasswordData({...passwordData, newPassword: e.target.value})}
                  placeholder="Min. 8 karakter, kombinasi huruf & angka"
                  className="pl-10 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
                >
                  {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {passwordData.newPassword && (
                <div className="mt-1.5 space-y-0.5">
                  {passwordData.newPassword.length < 8 && (
                    <p className="text-xs text-red-500 flex items-center gap-1"><XCircle className="w-3 h-3" /> Minimal 8 karakter</p>
                  )}
                  {passwordData.newPassword.length >= 8 && (
                    <p className="text-xs text-green-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Minimal 8 karakter</p>
                  )}
                  {!/[a-zA-Z]/.test(passwordData.newPassword) && (
                    <p className="text-xs text-red-500 flex items-center gap-1"><XCircle className="w-3 h-3" /> Mengandung huruf</p>
                  )}
                  {/[a-zA-Z]/.test(passwordData.newPassword) && (
                    <p className="text-xs text-green-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Mengandung huruf</p>
                  )}
                  {!/[0-9]/.test(passwordData.newPassword) && (
                    <p className="text-xs text-red-500 flex items-center gap-1"><XCircle className="w-3 h-3" /> Mengandung angka</p>
                  )}
                  {/[0-9]/.test(passwordData.newPassword) && (
                    <p className="text-xs text-green-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Mengandung angka</p>
                  )}
                </div>
              )}
            </div>
            <div>
              <Label htmlFor="confirmPassword">Konfirmasi Password Baru</Label>
              <div className="relative mt-1">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={passwordData.confirmPassword}
                  onChange={e => setPasswordData({...passwordData, confirmPassword: e.target.value})}
                  placeholder="Konfirmasi password baru"
                  className="pl-10 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {passwordData.confirmPassword && passwordData.newPassword !== passwordData.confirmPassword && (
                <p className="text-xs text-red-500 mt-1">Password tidak cocok</p>
              )}
              {passwordData.confirmPassword && passwordData.newPassword === passwordData.confirmPassword && (
                <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Password cocok
                </p>
              )}
            </div>

            <div className="pt-4 border-t border-stone-100 flex justify-end">
              <Button 
                type="submit" 
                disabled={isChangingPassword}
                className="gap-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 shadow-md"
              >
                {isChangingPassword ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Menyimpan...</span>
                  </>
                ) : (
                  <>
                    <KeyRound className="w-4 h-4" />
                    <span>Ubah Password</span>
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      {/* Notification Preferences Card */}
      <Card className="overflow-hidden">
        <CardHeader className="bg-stone-50 border-b border-stone-100 p-4 sm:p-6">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-violet-100 to-purple-100 p-2 rounded-xl text-violet-600">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <CardTitle className="text-lg text-stone-800">Preferensi Notifikasi</CardTitle>
              <p className="text-sm text-stone-500">Konfigurasi aktif/non-aktif notifikasi yang Anda terima</p>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-4 sm:p-6 space-y-4">
          {notifPrefsSuccess && (
            <div className="bg-green-50 text-green-700 p-4 rounded-xl text-sm font-medium border border-green-200 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5" />
              <span>Preferensi notifikasi berhasil diperbarui!</span>
            </div>
          )}

          {/* WhatsApp toggle */}
          <div className="flex items-center justify-between gap-3 p-3 sm:p-4 rounded-xl bg-stone-50">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 bg-green-100 rounded-lg">
                <MessageCircle className="w-4 h-4 text-green-600" />
              </div>
              <div className="min-w-0">
                <Label className="text-base font-semibold">Terima Notifikasi WhatsApp</Label>
                <p className="text-sm text-stone-500 mt-0.5">Kirim notifikasi ke nomor WhatsApp Anda</p>
              </div>
            </div>
            <Switch
              checked={notifPrefs.notifWaEnabled}
              onCheckedChange={(checked) =>
                setNotifPrefs(prev => ({ ...prev, notifWaEnabled: checked }))
              }
            />
          </div>

          {/* Email toggle */}
          <div className="flex items-center justify-between gap-3 p-3 sm:p-4 rounded-xl bg-stone-50">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 bg-sky-100 rounded-lg">
                <Mail className="w-4 h-4 text-sky-600" />
              </div>
              <div className="min-w-0">
                <Label className="text-base font-semibold">Terima Notifikasi Email</Label>
                <p className="text-sm text-stone-500 mt-0.5">Kirim notifikasi ke alamat email Anda</p>
              </div>
            </div>
            <Switch
              checked={notifPrefs.notifEmailEnabled}
              onCheckedChange={(checked) =>
                setNotifPrefs(prev => ({ ...prev, notifEmailEnabled: checked }))
              }
            />
          </div>

          {/* Info */}
          <div className="flex items-start gap-2 p-3 bg-violet-50 rounded-lg text-sm text-violet-800">
            <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>Notifikasi hanya dikirim jika diaktifkan oleh Super Admin di halaman Pengaturan. Pastikan nomor WhatsApp dan email Anda sudah benar di profil.</span>
          </div>

          {/* Save Button */}
          <div className="pt-4 border-t border-stone-100 flex justify-end">
            <Button
              onClick={async () => {
                setIsSavingNotifPrefs(true)
                try {
                  const response = await fetch('/api/user-notif-prefs', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      userId: profileData.id,
                      notifWaEnabled: notifPrefs.notifWaEnabled,
                      notifEmailEnabled: notifPrefs.notifEmailEnabled
                    })
                  })
                  if (response.ok) {
                    setNotifPrefsSuccess(true)
                    setTimeout(() => setNotifPrefsSuccess(false), 3000)
                  } else {
                    showAlert('Gagal menyimpan preferensi notifikasi')
                  }
                } catch {
                  showAlert('Terjadi kesalahan')
                } finally {
                  setIsSavingNotifPrefs(false)
                }
              }}
              disabled={isSavingNotifPrefs}
              className="gap-2 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 shadow-md shadow-violet-500/20"
            >
              {isSavingNotifPrefs ? (
                <><Loader2 className="w-4 h-4 animate-spin" /><span>Menyimpan...</span></>
              ) : (
                <><Save className="w-4 h-4" /><span>Simpan Preferensi</span></>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}