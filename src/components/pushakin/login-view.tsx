'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { useAppStore } from '@/lib/store'
import { PlayCircle, Mail, Lock, Loader2, Eye, EyeOff, AlertCircle, RefreshCw } from 'lucide-react'
import { useState, useEffect } from 'react'

interface LoginViewProps {
  onSeed: () => Promise<void>
  isSeeding: boolean
  seedError?: string
}

const REMEMBER_ME_KEY = 'pushakin_remembered_credentials'

export function LoginView({ onSeed, isSeeding, seedError }: LoginViewProps) {
  const setCurrentUser = useAppStore((state) => state.setCurrentUser)
  const showAlert = useAppStore((state) => state.showAlert)
  
  const [hasUsers, setHasUsers] = useState<boolean | null>(null)
  const [serverStatus, setServerStatus] = useState<'checking' | 'ok' | 'error'>('checking')
  const [dbError, setDbError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [mustChangePassword, setMustChangePassword] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loggedInUser, setLoggedInUser] = useState<{id: string, name: string} | null>(null)
  const [rememberMe, setRememberMe] = useState(false)

  // Load saved credentials on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(REMEMBER_ME_KEY)
      if (saved) {
        const credentials = JSON.parse(saved)
        setEmail(credentials.email || '')
        setPassword(credentials.password || '')
        setRememberMe(true)
      }
    } catch {
      // Ignore errors
    }
  }, [])

  // Check server health and users
  useEffect(() => {
    const checkServer = async () => {
      try {
        // First check if server is running
        const healthRes = await fetch('/api/health')
        if (!healthRes.ok) {
          setServerStatus('error')
          setDbError('Server tidak merespons')
          setHasUsers(false)
          return
        }

        const healthData = await healthRes.json()
        
        if (!healthData.hasDatabaseUrl) {
          setServerStatus('error')
          setDbError('DATABASE_URL belum dikonfigurasi di Vercel')
          setHasUsers(false)
          return
        }

        setServerStatus('ok')

        // Then check users — with timeout for slow connections
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 30000) // 30s timeout
        
        try {
          const usersRes = await fetch('/api/users', { signal: controller.signal })
          clearTimeout(timeoutId)
          
          if (!usersRes.ok) {
            const text = await usersRes.text()
            try {
              const errorData = JSON.parse(text)
              setDbError(errorData.error || 'Gagal mengambil data user')
            } catch {
              setDbError(`Server error: ${usersRes.status}`)
            }
            setHasUsers(false)
            return
          }

          const text = await usersRes.text()
          if (!text) {
            setDbError(null)
            setHasUsers(false)
            return
          }

          try {
            const users = JSON.parse(text)
            if (Array.isArray(users)) {
              setHasUsers(users.length > 0)
              setDbError(null)
            } else if (users.error) {
              setDbError(users.error)
              setHasUsers(false)
            } else {
              setHasUsers(false)
            }
          } catch {
            setDbError('Format data tidak valid')
            setHasUsers(false)
          }
        } catch (fetchErr: any) {
          clearTimeout(timeoutId)
          if (fetchErr?.name === 'AbortError') {
            setDbError('Server terlalu lama merespons. Coba refresh halaman.')
          } else {
            setDbError('Gagal mengambil data user')
          }
          setHasUsers(false)
        }
      } catch (err) {
        console.error('Check server error:', err)
        setServerStatus('error')
        setDbError('Tidak dapat terhubung ke server')
        setHasUsers(false)
      }
    }
    checkServer()
  }, [isSeeding])

  // Loading state
  if (serverStatus === 'checking' || hasUsers === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 via-blue-50 to-violet-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-violet-600 mx-auto mb-4" />
          <p className="text-slate-600">Memeriksa server...</p>
        </div>
      </div>
    )
  }

  // Server error or no users
  if (!hasUsers || serverStatus === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 via-blue-50 to-violet-100 p-4">
        <Card className="max-w-md w-full shadow-2xl border-0">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-purple-700 shadow-lg shadow-violet-500/30">
              <PlayCircle className="h-8 w-8 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-slate-800">Pushakin Flows</h1>
            <div className="mt-2">
              <p className="text-sm font-semibold text-violet-600">Sistem Manajemen Produksi</p>
              <p className="text-xs text-slate-500">Tim Pusat Hubungan Masyarakat dan Keterbukaan Informasi</p>
            </div>
          </CardHeader>
          <CardContent className="text-center">
            {dbError && (
              <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm text-left flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="text-left">
                  <p className="font-medium">Konfigurasi Diperlukan</p>
                  <p className="text-xs mt-1">{dbError}</p>
                  {dbError.includes('DATABASE_URL') && (
                    <p className="text-xs mt-2 text-amber-600">
                      1. Buka Vercel Dashboard → Settings → Environment Variables<br/>
                      2. Tambahkan DATABASE_URL dengan nilai dari Neon.tech<br/>
                      3. Redeploy aplikasi
                    </p>
                  )}
                </div>
              </div>
            )}
            {!dbError && (
              <p className="text-sm text-slate-600 mb-4">
                Database belum diinisialisasi. Klik tombol di bawah untuk membuat data demo.
              </p>
            )}
            {seedError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm text-left flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Gagal menginisialisasi database</p>
                  <p className="text-xs mt-1 text-red-600">{seedError}</p>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Button 
                onClick={onSeed} 
                disabled={isSeeding}
                className="w-full bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 shadow-md shadow-violet-500/20"
                size="lg"
              >
                {isSeeding ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Memproses...
                  </>
                ) : 'Inisialisasi Database Demo'}
              </Button>
              <Button 
                variant="outline"
                onClick={() => window.location.reload()} 
                className="w-full gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh Halaman
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })

      // Check content type first
      const contentType = response.headers.get('content-type')
      if (!contentType || !contentType.includes('application/json')) {
        setError('Server error. Silakan hubungi administrator.')
        setIsLoading(false)
        return
      }

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Login gagal. Silakan coba lagi.')
        setIsLoading(false)
        return
      }

      // Handle remember me
      if (rememberMe) {
        localStorage.setItem(REMEMBER_ME_KEY, JSON.stringify({ email, password }))
      } else {
        localStorage.removeItem(REMEMBER_ME_KEY)
      }

      if (data.mustChangePassword && data.user) {
        setMustChangePassword(true)
        setLoggedInUser(data.user)
        setIsLoading(false)
        return
      }

      if (data.user) {
        setCurrentUser(data.user)
        showAlert(`Selamat datang, ${data.user.name}!`)
      } else {
        setError('Data user tidak ditemukan')
      }
    } catch (err) {
      console.error('Login error:', err)
      setError('Terjadi kesalahan. Silakan coba lagi.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (newPassword.length < 8) {
      setError('Password baru minimal 8 karakter')
      return
    }

    if (!/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      setError('Password baru harus kombinasi huruf dan angka')
      return
    }

    if (newPassword !== confirmPassword) {
      setError('Konfirmasi password tidak cocok')
      return
    }

    setIsLoading(true)

    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          userId: loggedInUser?.id, 
          currentPassword: password, 
          newPassword 
        })
      })

      const contentType = response.headers.get('content-type')
      if (!contentType || !contentType.includes('application/json')) {
        setError('Server error. Silakan hubungi administrator.')
        setIsLoading(false)
        return
      }

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Gagal mengubah password. Silakan coba lagi.')
        setIsLoading(false)
        return
      }

      if (rememberMe) {
        localStorage.setItem(REMEMBER_ME_KEY, JSON.stringify({ email, password: newPassword }))
      }

      showAlert('Password berhasil diubah! Silakan login kembali.')
      setMustChangePassword(false)
      setLoggedInUser(null)
      setPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch {
      setError('Terjadi kesalahan. Silakan coba lagi.')
    } finally {
      setIsLoading(false)
    }
  }

  // Change password form
  if (mustChangePassword && loggedInUser) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 via-blue-50 to-violet-100 p-4">
        <Card className="max-w-md w-full shadow-2xl border-0">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-orange-600 shadow-lg shadow-orange-500/30">
              <Lock className="h-8 w-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-slate-800">Ganti Password</h1>
            <p className="text-slate-500 mt-2">
              Halo, <span className="font-semibold text-violet-600">{loggedInUser.name}</span>!
            </p>
            <p className="text-sm text-slate-600 mt-1">
              Anda login dengan password default. Silakan buat password baru.
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleChangePassword} className="space-y-4">
              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="newPassword">Password Baru</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    id="newPassword"
                    type={showPassword ? "text" : "password"}
                    placeholder="Min. 8 karakter, kombinasi huruf & angka"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="pl-10 pr-10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Konfirmasi Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    id="confirmPassword"
                    type={showPassword ? "text" : "password"}
                    placeholder="Ulangi password baru"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="pl-10"
                    required
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={isLoading}
                className="w-full bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 shadow-md shadow-violet-500/20"
                size="lg"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Menyimpan...
                  </>
                ) : (
                  'Simpan Password Baru'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Main login form
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 via-blue-50 to-violet-100 p-4">
      <Card className="max-w-md w-full shadow-2xl border-0">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-purple-700 shadow-lg shadow-violet-500/30">
            <PlayCircle className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-slate-800">Pushakin Flows</h1>
          <div className="mt-2">
            <p className="text-sm font-semibold text-violet-600">Sistem Manajemen Produksi</p>
            <p className="text-xs text-slate-500">Tim Pusat Hubungan Masyarakat dan Keterbukaan Informasi</p>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  id="email"
                  type="email"
                  placeholder="contoh@pushakin.local"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Masukkan password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 pr-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox 
                id="rememberMe" 
                checked={rememberMe} 
                onCheckedChange={(checked) => setRememberMe(checked as boolean)}
              />
              <Label 
                htmlFor="rememberMe" 
                className="text-sm text-slate-600 cursor-pointer select-none"
              >
                Ingat saya (simpan email & password)
              </Label>
            </div>

            <Button
              type="submit"
              disabled={isLoading}
              className="w-full bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 shadow-md shadow-violet-500/20"
              size="lg"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Masuk...
                </>
              ) : (
                'Masuk'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
