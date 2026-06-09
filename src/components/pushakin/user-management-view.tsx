'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { useAppStore, ROLES, getRoleDisplayName, ROLE_DISPLAY_NAMES } from '@/lib/store'
import { 
  Plus, 
  Edit, 
  Trash2, 
  Search, 
  UploadCloud,
  Users,
  UserCheck,
  LogIn,
  KeyRound,
  Eye,
  EyeOff
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useState, useRef } from 'react'
import type { User } from '@/lib/store'

export function UserManagementView() {
  const { users, currentUser, showAlert, showConfirm, updateUser, addUser, deleteUser, startImpersonate } = useAppStore()
  const [searchTerm, setSearchTerm] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [formData, setFormData] = useState<Partial<User>>({
    id: '',
    name: '',
    role: ROLES[0],
    avatar: '',
    email: '',
    whatsapp: ''
  })
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Reset password state
  const [isResetModalOpen, setIsResetModalOpen] = useState(false)
  const [resetTargetUser, setResetTargetUser] = useState<User | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [isResetting, setIsResetting] = useState(false)

  const filteredUsers = users.filter(u => 
    u.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    u.role.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const handleOpenAdd = () => {
    setFormData({
      id: '',
      name: '',
      role: ROLES[0],
      avatar: `https://i.pravatar.cc/150?u=${Date.now()}`,
      email: '',
      whatsapp: ''
    })
    setEditMode(false)
    setIsModalOpen(true)
  }

  const handleOpenEdit = (user: User) => {
    setFormData(user)
    setEditMode(true)
    setIsModalOpen(true)
  }

  const handleImpersonate = (user: User) => {
    showConfirm(
      `Anda akan masuk sebagai "${user.name}" (${getRoleDisplayName(user.role)}). Semua aksi yang Anda lakukan akan menggunakan identitas pengguna ini. Lanjutkan?`,
      () => {
        startImpersonate(user)
      }
    )
  }

  const handleDelete = (userId: string, userName: string) => {
    showConfirm(`Yakin ingin menghapus pengguna: ${userName}?`, async () => {
      try {
        await fetch(`/api/users?id=${userId}`, { method: 'DELETE' })
        deleteUser(userId)
      } catch {
        showAlert('Gagal menghapus pengguna')
      }
    })
  }

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      // Don't send the fake client-side id when creating new user
      const payload = editMode ? formData : {
        name: formData.name,
        email: formData.email,
        whatsapp: formData.whatsapp,
        avatar: formData.avatar,
        role: formData.role
      }

      if (editMode && formData.id) {
        const response = await fetch('/api/users', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
        if (response.ok) {
          const text = await response.text()
          if (text) {
            const user = JSON.parse(text)
            updateUser(user as User)
          }
        } else {
          const err = await response.json().catch(() => ({}))
          showAlert(err.error || 'Gagal menyimpan pengguna')
          return
        }
      } else {
        const response = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
        if (response.ok) {
          const text = await response.text()
          if (text) {
            const user = JSON.parse(text)
            addUser(user as User)
          }
        } else {
          const err = await response.json().catch(() => ({}))
          showAlert(err.error || 'Gagal menyimpan pengguna')
          return
        }
      }
      setIsModalOpen(false)
    } catch {
      showAlert('Gagal menyimpan pengguna')
    }
  }

  const handleOpenResetPassword = (user: User) => {
    setResetTargetUser(user)
    setNewPassword('')
    setConfirmPassword('')
    setShowNewPassword(false)
    setShowConfirmPassword(false)
    setIsResetModalOpen(true)
  }

  const handleResetPassword = async () => {
    if (!resetTargetUser) return

    if (newPassword.length < 8) {
      showAlert('Password baru minimal 8 karakter')
      return
    }

    if (!/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      showAlert('Password baru harus kombinasi huruf dan angka')
      return
    }

    if (newPassword !== confirmPassword) {
      showAlert('Konfirmasi password tidak cocok')
      return
    }

    setIsResetting(true)
    try {
      const response = await fetch('/api/users/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminUserId: currentUser?.id,
          targetUserId: resetTargetUser.id,
          newPassword
        })
      })

      if (response.ok) {
        const data = await response.json()
        showAlert(data.message || `Password ${resetTargetUser.name} berhasil direset`)
        setIsResetModalOpen(false)
        setResetTargetUser(null)
      } else {
        const err = await response.json().catch(() => ({}))
        showAlert(err.error || 'Gagal mereset password')
      }
    } catch {
      showAlert('Gagal mereset password. Silakan coba lagi.')
    } finally {
      setIsResetting(false)
    }
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onloadend = () => {
        setFormData({ ...formData, avatar: reader.result as string })
      }
      reader.readAsDataURL(file)
    }
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <Card>
        <CardContent className="p-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400" />
            <Input
              placeholder="Cari nama atau peran..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 bg-stone-50"
            />
          </div>
          <Button onClick={handleOpenAdd} className="gap-2 bg-indigo-600 hover:bg-indigo-700">
            <Plus className="w-5 h-5" />
            <span>Tambah User Baru</span>
          </Button>
        </CardContent>
      </Card>

      {/* Users Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-stone-50">
              <TableHead className="font-semibold whitespace-nowrap">Profil Pengguna</TableHead>
              <TableHead className="font-semibold whitespace-nowrap">Kontak</TableHead>
              <TableHead className="font-semibold whitespace-nowrap">Peran (Role)</TableHead>
              <TableHead className="font-semibold whitespace-nowrap">Status</TableHead>
              <TableHead className="font-semibold text-right whitespace-nowrap">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredUsers.map((user) => (
              <TableRow key={user.id} className="hover:bg-stone-50/50">
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10 border border-stone-200">
                      <AvatarImage src={user.avatar} alt={user.name} />
                      <AvatarFallback>{user.name.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="font-semibold text-stone-800">{user.name}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="text-sm text-stone-700">{user.email}</div>
                  <div className="text-xs text-stone-500">{user.whatsapp}</div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-100">
                    {getRoleDisplayName(user.role)}
                  </Badge>
                </TableCell>
                <TableCell>
                  {user.role === 'Admin' ? (
                    <Badge className="bg-red-50 text-red-700 border-red-200">Super Admin</Badge>
                  ) : user.role === 'Administrator' ? (
                    <Badge className="bg-amber-50 text-amber-700 border-amber-200">Administrator</Badge>
                  ) : user.role === 'Manager' ? (
                    <Badge className="bg-blue-50 text-blue-700 border-blue-200">Manager</Badge>
                  ) : user.role === 'ContentCreator' ? (
                    <Badge className="bg-cyan-50 text-cyan-700 border-cyan-200">Content Creator</Badge>
                  ) : (
                    <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200">Staff</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    {/* Login As / Impersonate - Admin only, cannot impersonate self */}
                    {currentUser?.role === 'Admin' && user.id !== currentUser?.id && user.role !== 'Admin' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleImpersonate(user)}
                        className="text-violet-600 hover:text-violet-700 hover:bg-violet-50 gap-1.5 text-xs"
                      >
                        <LogIn className="w-3.5 h-3.5" />
                        <span>Login Sebagai</span>
                      </Button>
                    )}
                    {/* Reset Password - Super Admin only, cannot reset self */}
                    {currentUser?.role === 'Admin' && user.id !== currentUser?.id && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleOpenResetPassword(user)}
                        className="text-amber-600 hover:text-amber-700 hover:bg-amber-50 gap-1.5 text-xs"
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                        <span>Reset Password</span>
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleOpenEdit(user)}
                      className="text-stone-400 hover:text-indigo-600 hover:bg-indigo-50"
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(user.id, user.name)}
                      disabled={user.id === currentUser?.id}
                      className={cn(
                        user.id === currentUser?.id
                          ? "text-stone-300 cursor-not-allowed"
                          : "text-stone-400 hover:text-red-600 hover:bg-red-50"
                      )}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
        {filteredUsers.length === 0 && (
          <div className="p-8 text-center text-stone-500">
            Tidak ada pengguna yang ditemukan.
          </div>
        )}
      </Card>

      {/* Add/Edit Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto mx-4 sm:mx-0 sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editMode ? 'Edit Pengguna' : 'Tambah Pengguna Baru'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveUser} className="space-y-4">
            {/* Avatar Upload */}
            <div className="flex flex-col items-center justify-center mb-6">
              <div
                className="relative group cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <Avatar className="h-24 w-24 border-4 border-stone-100 shadow-sm group-hover:opacity-80 transition-all">
                  <AvatarImage src={formData.avatar || ''} />
                  <AvatarFallback>{formData.name?.charAt(0) || '?'}</AvatarFallback>
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
              <p className="text-xs text-stone-500 mt-2 font-medium">
                Klik foto untuk mengunggah
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Nama Lengkap</Label>
                <Input
                  required
                  value={formData.name || ''}
                  onChange={e => setFormData({...formData, name: e.target.value})}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Peran Sistem (Role)</Label>
                <Select
                  value={formData.role}
                  onValueChange={(value) => setFormData({...formData, role: value as User['role']})}
                >
                  <SelectTrigger className="mt-1">
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
                <Label>Email *</Label>
                <Input
                  type="email"
                  required
                  placeholder="email@contoh.com"
                  value={formData.email || ''}
                  onChange={e => setFormData({...formData, email: e.target.value})}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>No WhatsApp</Label>
                <Input
                  value={formData.whatsapp || ''}
                  onChange={e => setFormData({...formData, whatsapp: e.target.value})}
                  className="mt-1"
                />
              </div>
            </div>

            <DialogFooter className="pt-6 mt-4 border-t">
              <Button type="button" variant="ghost" onClick={() => setIsModalOpen(false)}>
                Batal
              </Button>
              <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700">
                Simpan Data
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Reset Password Modal */}
      <Dialog open={isResetModalOpen} onOpenChange={setIsResetModalOpen}>
        <DialogContent className="max-w-md mx-4 sm:mx-0 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-amber-600" />
              Reset Password
            </DialogTitle>
          </DialogHeader>
          {resetTargetUser && (
            <div className="space-y-4">
              {/* Target user info */}
              <div className="flex items-center gap-3 p-3 bg-stone-50 rounded-lg border">
                <Avatar className="h-10 w-10 border border-stone-200">
                  <AvatarImage src={resetTargetUser.avatar} alt={resetTargetUser.name} />
                  <AvatarFallback>{resetTargetUser.name.charAt(0)}</AvatarFallback>
                </Avatar>
                <div>
                  <div className="font-semibold text-stone-800">{resetTargetUser.name}</div>
                  <div className="text-xs text-stone-500">{resetTargetUser.email} · {getRoleDisplayName(resetTargetUser.role)}</div>
                </div>
              </div>

              <p className="text-sm text-stone-600">
                Masukkan password baru untuk pengguna ini. Password akan langsung berubah tanpa perlu konfirmasi dari pengguna.
              </p>

              {/* New Password */}
              <div>
                <Label>Password Baru</Label>
                <div className="relative mt-1">
                  <Input
                    type={showNewPassword ? 'text' : 'password'}
                    placeholder="Minimal 8 karakter (huruf + angka)"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
                  >
                    {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Confirm Password */}
              <div>
                <Label>Konfirmasi Password</Label>
                <div className="relative mt-1">
                  <Input
                    type={showConfirmPassword ? 'text' : 'password'}
                    placeholder="Ulangi password baru"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {confirmPassword && newPassword !== confirmPassword && (
                  <p className="text-xs text-red-500 mt-1">Password tidak cocok</p>
                )}
              </div>

              {/* Password requirements hint */}
              <div className="text-xs text-stone-500 space-y-1 bg-amber-50 p-3 rounded-lg border border-amber-100">
                <p className="font-medium text-amber-700">Persyaratan password:</p>
                <ul className="space-y-0.5 ml-3">
                  <li className={newPassword.length >= 8 ? 'text-emerald-600' : ''}>• Minimal 8 karakter</li>
                  <li className={/[a-zA-Z]/.test(newPassword) && newPassword.length > 0 ? 'text-emerald-600' : ''}>• Mengandung huruf</li>
                  <li className={/[0-9]/.test(newPassword) && newPassword.length > 0 ? 'text-emerald-600' : ''}>• Mengandung angka</li>
                </ul>
              </div>
            </div>
          )}
          <DialogFooter className="pt-4 border-t">
            <Button 
              type="button" 
              variant="ghost" 
              onClick={() => setIsResetModalOpen(false)}
              disabled={isResetting}
            >
              Batal
            </Button>
            <Button
              type="button"
              onClick={handleResetPassword}
              disabled={isResetting || !newPassword || !confirmPassword || newPassword !== confirmPassword}
              className="bg-amber-600 hover:bg-amber-700 gap-2"
            >
              {isResetting ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Mereset...
                </>
              ) : (
                <>
                  <KeyRound className="w-4 h-4" />
                  Reset Password
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
