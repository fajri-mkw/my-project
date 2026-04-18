'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAppStore, STAGES, type Surat, getRoleDisplayName } from '@/lib/store'
import { 
  Inbox, 
  Clock, 
  MapPin, 
  User, 
  Building2,
  Calendar,
  Phone,
  Loader2,
  ExternalLink,
  Mail,
  CheckCircle2,
  XCircle,
  FileText,
  Eye,
  ArrowRight,
  Paperclip,
  ClipboardList,
  MailCheck,
  Maximize2,
  Minimize2
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'

interface ActivityDetail {
  id: string
  projectId: string
  userId: string
  role: string
  stage: number
  status: string
  read: boolean
  createdAt: string
  project?: {
    id: string
    title: string
    description?: string
    requesterUnit?: string
    location?: string
    executionTime?: string
    picName?: string
    picWhatsApp?: string
    activityTypes?: string[]
    outputNeeds?: string[]
    manager?: {
      id: string
      name: string
      email: string
    }
  }
}

export function InboxView() {
  const { currentUser, setActiveView, setSelectedProjectId, markSuratRead, suratList, permohonanList, showAlert, setPreFillFromPermohonan, setPreFillFromSurat, updateSurat, updatePermohonan } = useAppStore()
  const [activityList, setActivityList] = useState<ActivityDetail[]>([])
  const [selectedActivity, setSelectedActivity] = useState<ActivityDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [selectedSurat, setSelectedSurat] = useState<Surat | null>(null)
  const [selectedSuratType, setSelectedSuratType] = useState<'surat' | 'permohonan'>('surat')
  const [isSuratDetailOpen, setIsSuratDetailOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [activeTab, setActiveTab] = useState('permohonan')
  const [isDetailMaximized, setIsDetailMaximized] = useState(false)

  const isManager = currentUser?.role === 'Manager'
  const isAdmin = currentUser?.role === 'Admin'
  const canManageInbox = isManager || isAdmin

  // Forwarded surat (for Manager & Admin)
  const forwardedSurat = canManageInbox
    ? suratList.filter(s => s.managerId === currentUser.id && ['diteruskan', 'diproses'].includes(s.status) && s.kategori === 'Permohonan')
    : []
  // Also include existing forwarded permohonan
  const forwardedPermohonan = canManageInbox
    ? permohonanList.filter(p => p.status === 'forwarded' && p.managerId === currentUser.id)
    : []

  // Combined forwarded items for Manager & Admin
  const allForwardedItems = canManageInbox
    ? [...forwardedSurat.map(s => ({ type: 'surat' as const, data: s })), ...forwardedPermohonan.map(p => ({ type: 'permohonan' as const, data: p }))]
    : []

  const unreadPermohonan = allForwardedItems.length
  const unreadActivities = activityList.filter(a => !a.read).length

  // Auto-switch tab: if no permohonan but has activities, show activities
  useEffect(() => {
    if (canManageInbox && allForwardedItems.length === 0 && activityList.length > 0) {
      setActiveTab('tugas')
    }
  }, [canManageInbox, allForwardedItems.length, activityList.length])

  useEffect(() => {
    const fetchActivities = async () => {
      if (!currentUser) return
      try {
        const response = await fetch(`/api/surat-tugas?userId=${currentUser.id}`)
        if (response.ok) {
          const data = await response.json()
          setActivityList(data)
        }
      } catch (error) {
        console.error('Failed to fetch activities:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchActivities()
  }, [currentUser])

  const handleViewActivity = async (activity: ActivityDetail) => {
    try {
      const response = await fetch(`/api/surat-tugas?id=${activity.id}`)
      if (response.ok) {
        const detail = await response.json()
        setSelectedActivity(detail)
        
        // Mark as read
        if (!activity.read) {
          await fetch('/api/surat-tugas', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: activity.id, read: true })
          })
          markSuratRead(activity.id)
        }
      }
    } catch (error) {
      console.error('Failed to fetch activity detail:', error)
    }
  }

  const handleGoToProject = (projectId: string) => {
    setSelectedProjectId(projectId)
    setActiveView('project_detail')
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString('id-ID', { 
      day: 'numeric', 
      month: 'long', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const handleAcceptSurat = (surat: Surat) => {
    setIsSaving(true)
    fetch('/api/surat', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: surat.id, status: 'diproses' })
    }).then(res => {
      if (res.ok) return res.json().then(data => updateSurat(data))
    }).catch(() => {}).finally(() => {
      setIsSaving(false)
    })
    setPreFillFromSurat(surat)
    setActiveView('create')
  }

  const handleAcceptPermohonan = (permohonan: any) => {
    setPreFillFromPermohonan(permohonan)
    setActiveView('create')
  }

  const handleReject = () => {
    if (!selectedSurat) return
    if (selectedSuratType === 'surat') {
      handleRejectSurat()
    } else {
      handleRejectPermohonan()
    }
  }

  const handleRejectSurat = () => {
    if (!selectedSurat) return
    setIsSaving(true)
    fetch('/api/surat', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: selectedSurat.id, status: 'ditolak', catatan: rejectReason })
    }).then(res => {
      if (res.ok) return res.json().then(data => { updateSurat(data); setIsRejectDialogOpen(false); setRejectReason(''); setSelectedSurat(null); showAlert('Surat ditolak') })
      else return res.json().then(err => showAlert(err.error || 'Gagal'))
    }).catch(() => showAlert('Terjadi kesalahan')).finally(() => setIsSaving(false))
  }

  const handleRejectPermohonan = () => {
    if (!selectedSurat) return
    setIsSaving(true)
    fetch('/api/permohonan', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: (selectedSurat as any).id, status: 'rejected', adminNote: rejectReason, managerId: currentUser?.id })
    }).then(res => {
      if (res.ok) return res.json().then(data => { updatePermohonan(data); setIsRejectDialogOpen(false); setRejectReason(''); setSelectedSurat(null); showAlert('Permohonan ditolak') })
      else return res.json().then(err => showAlert(err.error || 'Gagal'))
    }).catch(() => showAlert('Terjadi kesalahan')).finally(() => setIsSaving(false))
  }

  const formatDateTime = (dateString: string) => {
    if (!dateString) return '-'
    const d = new Date(dateString)
    return d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
  }

  if (loading) {
    return (
      <Card className="max-w-4xl mx-auto">
        <CardContent className="p-12 text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-emerald-600" />
          <p className="mt-4 text-stone-500">Memuat inbox...</p>
        </CardContent>
      </Card>
    )
  }

  // Non-manager/admin: show only activity list (original behavior)
  if (!canManageInbox) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-violet-500 to-purple-600 p-3 rounded-xl shadow-lg">
              <Inbox className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-stone-800">Inbox</h1>
              <p className="text-sm text-stone-500">Daftar kegiatan yang ditugaskan</p>
            </div>
          </div>
          {unreadActivities > 0 && (
            <Badge variant="outline" className="text-sm px-3 py-1">
              {unreadActivities} Belum Dibaca
            </Badge>
          )}
        </div>

        {activityList.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <Inbox className="w-12 h-12 mx-auto text-stone-300" />
              <p className="mt-4 text-stone-500">Belum ada kegiatan</p>
              <p className="text-sm text-stone-400 mt-1">Kegiatan akan muncul ketika Anda ditugaskan dalam proyek</p>
            </CardContent>
          </Card>
        ) : (
          <ScrollArea className="h-[calc(100vh-220px)]">
            <div className="space-y-3 pr-4">
              {activityList.map((activity) => (
                <Card 
                  key={activity.id} 
                  className={cn(
                    "cursor-pointer transition-all hover:shadow-md",
                    !activity.read ? "border-l-4 border-l-violet-500 bg-violet-50/30" : "bg-white"
                  )}
                  onClick={() => handleViewActivity(activity)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          {!activity.read && (
                            <span className="w-2 h-2 bg-violet-500 rounded-full animate-pulse" />
                          )}
                          <Badge variant="outline" className="text-xs">
                            Tahap {activity.stage}
                          </Badge>
                        </div>
                        <h3 className="font-semibold text-stone-800">{activity.project?.title || 'Proyek'}</h3>
                        <div className="flex items-center gap-4 mt-2 text-sm text-stone-500">
                          <span className="flex items-center gap-1">
                            <User className="w-3.5 h-3.5" />
                            {getRoleDisplayName(activity.role)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />
                            {formatDate(activity.createdAt)}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={activity.status === 'active' ? 'default' : 'secondary'}>
                          {activity.status === 'active' ? 'Aktif' : activity.status === 'completed' ? 'Selesai' : 'Dibatalkan'}
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        )}

        {/* Activity Detail Dialog */}
        <Dialog open={!!selectedActivity} onOpenChange={() => setSelectedActivity(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto mx-4 sm:mx-0 sm:max-w-2xl">
            {selectedActivity && (
              <>
                <DialogHeader>
                  <DialogTitle className="text-xl">Detail Kegiatan</DialogTitle>
                </DialogHeader>
                <div className="space-y-6 mt-4">
                  <div className="bg-stone-50 rounded-xl p-4">
                    <h4 className="font-bold text-lg text-stone-800 mb-3">
                      {selectedActivity.project?.title}
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="flex items-start gap-2">
                        <Building2 className="w-4 h-4 text-stone-400 mt-0.5" />
                        <div>
                          <p className="text-xs text-stone-500">Unit Pemohon</p>
                          <p className="text-sm font-medium">{selectedActivity.project?.requesterUnit || '-'}</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <MapPin className="w-4 h-4 text-stone-400 mt-0.5" />
                        <div>
                          <p className="text-xs text-stone-500">Lokasi</p>
                          <p className="text-sm font-medium">{selectedActivity.project?.location || '-'}</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <Calendar className="w-4 h-4 text-stone-400 mt-0.5" />
                        <div>
                          <p className="text-xs text-stone-500">Waktu Pelaksanaan</p>
                          <p className="text-sm font-medium">{selectedActivity.project?.executionTime || '-'}</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <User className="w-4 h-4 text-stone-400 mt-0.5" />
                        <div>
                          <p className="text-xs text-stone-500">PIC Lokasi</p>
                          <p className="text-sm font-medium">{selectedActivity.project?.picName || '-'}</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <Phone className="w-4 h-4 text-stone-400 mt-0.5" />
                        <div>
                          <p className="text-xs text-stone-500">WhatsApp PIC</p>
                          <p className="text-sm font-medium">{selectedActivity.project?.picWhatsApp || '-'}</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <User className="w-4 h-4 text-stone-400 mt-0.5" />
                        <div>
                          <p className="text-xs text-stone-500">Manager Proyek</p>
                          <p className="text-sm font-medium">{selectedActivity.project?.manager?.name || '-'}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="bg-violet-50 rounded-xl p-4">
                    <h5 className="text-sm font-bold text-violet-800 mb-3">Detail Penugasan</h5>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-violet-600">Peran</p>
                        <p className="text-sm font-semibold text-violet-900">{getRoleDisplayName(selectedActivity.role)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-violet-600">Tahap</p>
                        <p className="text-sm font-semibold text-violet-900">Tahap {selectedActivity.stage}: {STAGES[selectedActivity.stage]}</p>
                      </div>
                    </div>
                    {selectedActivity.project?.activityTypes && selectedActivity.project.activityTypes.length > 0 && (
                      <div className="mt-4">
                        <p className="text-xs text-violet-600 mb-1">Jenis Kegiatan</p>
                        <div className="flex flex-wrap gap-1">
                          {selectedActivity.project.activityTypes.map((type, i) => (
                            <Badge key={i} variant="outline" className="text-xs">{type}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {selectedActivity.project?.outputNeeds && selectedActivity.project.outputNeeds.length > 0 && (
                      <div className="mt-3">
                        <p className="text-xs text-violet-600 mb-1">Kebutuhan Output</p>
                        <div className="flex flex-wrap gap-1">
                          {selectedActivity.project.outputNeeds.map((need, i) => (
                            <Badge key={i} variant="outline" className="text-xs">{need}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  {selectedActivity.project?.description && (
                    <div>
                      <h5 className="text-sm font-bold text-stone-700 mb-2">Deskripsi & Instruksi</h5>
                      <div className="bg-white border border-stone-200 rounded-lg p-4 text-sm text-stone-600 whitespace-pre-wrap">
                        {selectedActivity.project.description}
                      </div>
                    </div>
                  )}
                  <Separator />
                  <div className="flex justify-end">
                    <Button className="gap-2 bg-violet-600 hover:bg-violet-700" onClick={() => handleGoToProject(selectedActivity.projectId)}>
                      <ExternalLink className="w-4 h-4" />
                      <span>Buka Proyek</span>
                    </Button>
                  </div>
                  <p className="text-xs text-center text-stone-400">
                    Kegiatan ditugaskan pada {formatDate(selectedActivity.createdAt)}
                  </p>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  // Manager view: Tabbed layout
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-br from-emerald-500 to-green-600 p-3 rounded-xl shadow-lg">
            <Inbox className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-stone-800">Inbox Manager</h1>
            <p className="text-sm text-stone-500">Permohonan masuk & tugas proyek</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {unreadPermohonan > 0 && (
            <Badge className="text-xs bg-blue-50 text-blue-700 border border-blue-200">
              <Mail className="w-3 h-3 mr-1" />
              {unreadPermohonan} Permohonan
            </Badge>
          )}
          {unreadActivities > 0 && (
            <Badge className="text-xs bg-violet-50 text-violet-700 border border-violet-200">
              <ClipboardList className="w-3 h-3 mr-1" />
              {unreadActivities} Tugas Baru
            </Badge>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-stone-100 p-1 w-full sm:w-auto">
          <TabsTrigger value="permohonan" className="gap-2 data-[state=active]:bg-emerald-600 data-[state=active]:text-white flex-1 sm:flex-initial">
            <MailCheck className="w-4 h-4" />
            <span>Permohonan Masuk</span>
            {unreadPermohonan > 0 && (
              <Badge className="text-[10px] px-1.5 py-0 data-[state=active]:bg-white/20 bg-emerald-100 text-emerald-700">
                {unreadPermohonan}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="tugas" className="gap-2 data-[state=active]:bg-violet-600 data-[state=active]:text-white flex-1 sm:flex-initial">
            <ClipboardList className="w-4 h-4" />
            <span>Tugas Proyek</span>
            {unreadActivities > 0 && (
              <Badge className="text-[10px] px-1.5 py-0 data-[state=active]:bg-white/20 bg-violet-100 text-violet-700">
                {unreadActivities}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Permohonan Masuk */}
        <TabsContent value="permohonan" className="mt-4">
          {allForwardedItems.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="p-12 text-center">
                <div className="w-16 h-16 rounded-full bg-emerald-50 mx-auto mb-4 flex items-center justify-center">
                  <MailCheck className="w-8 h-8 text-emerald-300" />
                </div>
                <h3 className="text-lg font-semibold text-stone-800">Tidak ada permohonan masuk</h3>
                <p className="text-stone-500 mt-1 text-sm">
                  Permohonan dari Administrator akan muncul di sini saat diteruskan kepada Anda
                </p>
              </CardContent>
            </Card>
          ) : (
            <ScrollArea className="h-[calc(100vh-300px)]">
              <div className="space-y-3 pr-4">
                {allForwardedItems.map((item) => {
                  if (item.type === 'surat') {
                    const s = item.data as Surat
                    const isDiproses = s.status === 'diproses'
                    const docsCount = s.documents && Array.isArray(s.documents) ? s.documents.filter((d: any) => d.webViewLink).length : 0
                    return (
                      <Card key={`surat-${s.id}`} className={cn(
                        "border-l-4 transition-all hover:shadow-md",
                        isDiproses ? "border-l-amber-400 bg-amber-50/20" : "border-l-blue-400 bg-blue-50/20"
                      )}>
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <span className="text-xs font-mono text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded">{s.nomorSurat}</span>
                                <Badge className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200">Permohonan</Badge>
                                {isDiproses ? (
                                  <Badge className="text-xs bg-amber-50 text-amber-700 border border-amber-200">Sedang Diproses</Badge>
                                ) : (
                                  <Badge className="text-xs bg-blue-50 text-blue-700 border border-blue-200">Menunggu Review</Badge>
                                )}
                                {docsCount > 0 && (
                                  <Badge className="text-xs bg-violet-50 text-violet-700 border border-violet-200 gap-1">
                                    <Paperclip className="w-3 h-3" />
                                    {docsCount} Dokumen
                                  </Badge>
                                )}
                              </div>
                              <h3 className="font-semibold text-stone-800">{s.perihal}</h3>
                              {s.pengirim && (
                                <p className="text-xs text-stone-500 mt-1">dari {s.pengirim}</p>
                              )}
                              {(s.location || s.executionTime || s.picName || s.picWhatsApp) && (
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-stone-500">
                                  {s.location && (
                                    <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{s.location}</span>
                                  )}
                                  {s.executionTime && (
                                    <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{new Date(s.executionTime).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}</span>
                                  )}
                                  {s.picName && (
                                    <span className="flex items-center gap-1"><User className="w-3 h-3" />PIC: {s.picName}</span>
                                  )}
                                  {s.picWhatsApp && (
                                    <span className="flex items-center gap-1">
                                      <Phone className="w-3 h-3" />
                                      <a href={`https://wa.me/${s.picWhatsApp.replace(/^0/, '62')}`} target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:text-emerald-700 hover:underline">{s.picWhatsApp}</a>
                                    </span>
                                  )}
                                </div>
                              )}
                              {s.deskripsi && (
                                <p className="text-xs text-stone-600 mt-1 line-clamp-1">{s.deskripsi}</p>
                              )}
                              {/* Quick document links */}
                              {docsCount > 0 && (
                                <div className="flex flex-wrap items-center gap-2 mt-2">
                                  {s.documents && Array.isArray(s.documents) && s.documents.filter((d: any) => d.webViewLink).map((doc: any, i: number) => (
                                    <a key={doc.id || i} href={doc.downloadUrl || doc.webViewLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-violet-600 bg-violet-50 border border-violet-200 px-2 py-1 rounded-md hover:bg-violet-100 transition-colors font-medium">
                                      <FileText className="w-3 h-3" />
                                      {doc.name?.length > 25 ? doc.name.substring(0, 25) + '...' : doc.name}
                                    </a>
                                  ))}
                                </div>
                              )}
                              <div className="flex items-center gap-1 mt-1.5 text-[10px] text-stone-400">
                                <Clock className="w-3 h-3" />
                                {formatDateTime(s.createdAt)}
                              </div>
                            </div>
                            <div className="flex flex-col gap-1.5 shrink-0">
                              <Button variant="ghost" size="sm" onClick={() => { setSelectedSurat(s); setSelectedSuratType('surat'); setIsSuratDetailOpen(true) }} className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 gap-1 text-xs">
                                <Eye className="w-3.5 h-3.5" />
                                Detail
                              </Button>
                              {isDiproses ? (
                                <Button variant="ghost" size="sm" onClick={() => { setPreFillFromSurat(s); setActiveView('create') }} className="text-violet-600 hover:text-violet-700 hover:bg-violet-50 gap-1 text-xs">
                                  <ArrowRight className="w-3.5 h-3.5" />
                                  ke Proyek
                                </Button>
                              ) : (
                                <>
                                  <Button variant="ghost" size="sm" onClick={() => handleAcceptSurat(s)} className="text-green-600 hover:text-green-700 hover:bg-green-50 gap-1 text-xs">
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    Terima
                                  </Button>
                                  <Button variant="ghost" size="sm" onClick={() => { setSelectedSurat(s); setSelectedSuratType('surat'); setRejectReason(''); setIsRejectDialogOpen(true) }} className="text-red-500 hover:text-red-600 hover:bg-red-50 gap-1 text-xs">
                                    <XCircle className="w-3.5 h-3.5" />
                                    Tolak
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  } else {
                    // Old permohonan type
                    const p = item.data as any
                    return (
                      <Card key={`permohonan-${p.id}`} className="border-l-4 border-l-blue-400 transition-all hover:shadow-md bg-blue-50/20">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200">Permohonan</Badge>
                                <Badge className="text-xs bg-blue-50 text-blue-700 border border-blue-200">Menunggu Review</Badge>
                              </div>
                              <h3 className="font-semibold text-stone-800">{p.title}</h3>
                              <p className="text-xs text-stone-500 mt-1">dari {p.requesterUnit}</p>
                              <div className="flex items-center gap-1 mt-1.5 text-[10px] text-stone-400">
                                <Clock className="w-3 h-3" />
                                {formatDateTime(p.createdAt)}
                              </div>
                            </div>
                            <div className="flex flex-col gap-1.5 shrink-0">
                              <Button variant="ghost" size="sm" onClick={() => handleAcceptPermohonan(p)} className="text-green-600 hover:text-green-700 hover:bg-green-50 gap-1 text-xs">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Terima
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => { setSelectedSurat(p); setSelectedSuratType('permohonan'); setRejectReason(''); setIsRejectDialogOpen(true) }} className="text-red-500 hover:text-red-600 hover:bg-red-50 gap-1 text-xs">
                                <XCircle className="w-3.5 h-3.5" />
                                Tolak
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  }
                })}
              </div>
            </ScrollArea>
          )}
        </TabsContent>

        {/* Tab 2: Tugas Proyek */}
        <TabsContent value="tugas" className="mt-4">
          {activityList.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="p-12 text-center">
                <div className="w-16 h-16 rounded-full bg-violet-50 mx-auto mb-4 flex items-center justify-center">
                  <ClipboardList className="w-8 h-8 text-violet-300" />
                </div>
                <h3 className="text-lg font-semibold text-stone-800">Belum ada tugas proyek</h3>
                <p className="text-stone-500 mt-1 text-sm">
                  Tugas akan muncul setelah Anda menerima permohonan dan proyek dibuat
                </p>
              </CardContent>
            </Card>
          ) : (
            <ScrollArea className="h-[calc(100vh-300px)]">
              <div className="space-y-3 pr-4">
                {activityList.map((activity) => (
                  <Card 
                    key={activity.id} 
                    className={cn(
                      "cursor-pointer transition-all hover:shadow-md",
                      !activity.read ? "border-l-4 border-l-violet-500 bg-violet-50/30" : "bg-white"
                    )}
                    onClick={() => handleViewActivity(activity)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            {!activity.read && (
                              <span className="w-2 h-2 bg-violet-500 rounded-full animate-pulse" />
                            )}
                            <Badge variant="outline" className="text-xs">
                              Tahap {activity.stage}
                            </Badge>
                          </div>
                          <h3 className="font-semibold text-stone-800">{activity.project?.title || 'Proyek'}</h3>
                          <div className="flex items-center gap-4 mt-2 text-sm text-stone-500">
                            <span className="flex items-center gap-1">
                              <User className="w-3.5 h-3.5" />
                              {getRoleDisplayName(activity.role)}
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5" />
                              {formatDate(activity.createdAt)}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={activity.status === 'active' ? 'default' : 'secondary'}>
                            {activity.status === 'active' ? 'Aktif' : activity.status === 'completed' ? 'Selesai' : 'Dibatalkan'}
                          </Badge>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          )}
        </TabsContent>
      </Tabs>

      {/* Activity Detail Dialog */}
      <Dialog open={!!selectedActivity} onOpenChange={() => setSelectedActivity(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto mx-4 sm:mx-0 sm:max-w-2xl">
          {selectedActivity && (
            <>
              <DialogHeader>
                <DialogTitle className="text-xl">Detail Kegiatan</DialogTitle>
              </DialogHeader>
              <div className="space-y-6 mt-4">
                <div className="bg-stone-50 rounded-xl p-4">
                  <h4 className="font-bold text-lg text-stone-800 mb-3">{selectedActivity.project?.title}</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex items-start gap-2">
                      <Building2 className="w-4 h-4 text-stone-400 mt-0.5" />
                      <div>
                        <p className="text-xs text-stone-500">Unit Pemohon</p>
                        <p className="text-sm font-medium">{selectedActivity.project?.requesterUnit || '-'}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <MapPin className="w-4 h-4 text-stone-400 mt-0.5" />
                      <div>
                        <p className="text-xs text-stone-500">Lokasi</p>
                        <p className="text-sm font-medium">{selectedActivity.project?.location || '-'}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Calendar className="w-4 h-4 text-stone-400 mt-0.5" />
                      <div>
                        <p className="text-xs text-stone-500">Waktu Pelaksanaan</p>
                        <p className="text-sm font-medium">{selectedActivity.project?.executionTime || '-'}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <User className="w-4 h-4 text-stone-400 mt-0.5" />
                      <div>
                        <p className="text-xs text-stone-500">PIC Lokasi</p>
                        <p className="text-sm font-medium">{selectedActivity.project?.picName || '-'}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Phone className="w-4 h-4 text-stone-400 mt-0.5" />
                      <div>
                        <p className="text-xs text-stone-500">WhatsApp PIC</p>
                        <p className="text-sm font-medium">{selectedActivity.project?.picWhatsApp || '-'}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <User className="w-4 h-4 text-stone-400 mt-0.5" />
                      <div>
                        <p className="text-xs text-stone-500">Manager Proyek</p>
                        <p className="text-sm font-medium">{selectedActivity.project?.manager?.name || '-'}</p>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="bg-violet-50 rounded-xl p-4">
                  <h5 className="text-sm font-bold text-violet-800 mb-3">Detail Penugasan</h5>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-violet-600">Peran</p>
                      <p className="text-sm font-semibold text-violet-900">{getRoleDisplayName(selectedActivity.role)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-violet-600">Tahap</p>
                      <p className="text-sm font-semibold text-violet-900">Tahap {selectedActivity.stage}: {STAGES[selectedActivity.stage]}</p>
                    </div>
                  </div>
                  {selectedActivity.project?.activityTypes && selectedActivity.project.activityTypes.length > 0 && (
                    <div className="mt-4">
                      <p className="text-xs text-violet-600 mb-1">Jenis Kegiatan</p>
                      <div className="flex flex-wrap gap-1">
                        {selectedActivity.project.activityTypes.map((type, i) => (
                          <Badge key={i} variant="outline" className="text-xs">{type}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {selectedActivity.project?.outputNeeds && selectedActivity.project.outputNeeds.length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs text-violet-600 mb-1">Kebutuhan Output</p>
                      <div className="flex flex-wrap gap-1">
                        {selectedActivity.project.outputNeeds.map((need, i) => (
                          <Badge key={i} variant="outline" className="text-xs">{need}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {selectedActivity.project?.description && (
                  <div>
                    <h5 className="text-sm font-bold text-stone-700 mb-2">Deskripsi & Instruksi</h5>
                    <div className="bg-white border border-stone-200 rounded-lg p-4 text-sm text-stone-600 whitespace-pre-wrap">{selectedActivity.project.description}</div>
                  </div>
                )}
                <Separator />
                <div className="flex justify-end">
                  <Button className="gap-2 bg-violet-600 hover:bg-violet-700" onClick={() => handleGoToProject(selectedActivity.projectId)}>
                    <ExternalLink className="w-4 h-4" />
                    <span>Buka Proyek</span>
                  </Button>
                </div>
                <p className="text-xs text-center text-stone-400">Kegiatan ditugaskan pada {formatDate(selectedActivity.createdAt)}</p>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Surat Detail Dialog - Responsive Modal with Fullscreen Toggle */}
      <Dialog open={isSuratDetailOpen} onOpenChange={(open) => { if (!open) setIsDetailMaximized(false); setIsSuratDetailOpen(open); }}>
        <DialogContent
          showCloseButton={!isDetailMaximized}
          className={cn(
            "transition-all duration-300",
            isDetailMaximized
              ? "!fixed !inset-0 !z-[100] !translate-x-0 !translate-y-0 !w-full !h-full !max-w-full !rounded-none !border-0 p-0 overflow-hidden"
              : "max-w-2xl sm:max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
          )}
        >
          {/* Sticky Header */}
          <div className={cn(
            "flex items-center gap-3 p-4 sm:p-6 pb-3 sm:pb-4",
            !isDetailMaximized && "border-b bg-background/95 backdrop-blur-sm"
          )}>
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-base sm:text-xl truncate">Detail Surat Permohonan</DialogTitle>
              <DialogDescription className="text-xs sm:text-sm mt-0.5">Detail permohonan yang diteruskan oleh Administrator</DialogDescription>
            </div>
            <button
              type="button"
              onClick={() => setIsDetailMaximized(!isDetailMaximized)}
              className="shrink-0 p-1.5 rounded-md border bg-white hover:bg-stone-100 transition-colors"
              title={isDetailMaximized ? 'Kecilkan' : 'Maksimalkan'}
              aria-label={isDetailMaximized ? 'Kecilkan' : 'Maksimalkan'}
            >
              {isDetailMaximized ? <Minimize2 className="w-4 h-4 text-stone-500" /> : <Maximize2 className="w-4 h-4 text-stone-500" />}
            </button>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-6 pb-4 sm:pb-6">
            {selectedSurat && 'nomorSurat' in selectedSurat && (
              <div className="space-y-4 sm:space-y-5">
                {/* Info Grid - Nomor, Kategori, Status */}
                <div className="bg-stone-50 rounded-xl p-3 sm:p-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                    <div className="flex items-start gap-2">
                      <FileText className="w-4 h-4 text-stone-400 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs text-stone-500">Nomor Surat</p>
                        <p className="text-sm font-medium font-mono break-all">{selectedSurat.nomorSurat}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Mail className="w-4 h-4 text-stone-400 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs text-stone-500">Kategori</p>
                        <p className="text-sm font-medium">{selectedSurat.kategori}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Clock className="w-4 h-4 text-stone-400 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs text-stone-500">Status</p>
                        <Badge className={cn("text-xs mt-0.5 border", selectedSurat.status === 'diproses' ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-blue-50 text-blue-700 border-blue-200")}>
                          {selectedSurat.status === 'diproses' ? 'Sedang Diproses' : 'Menunggu Review'}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Perihal */}
                <div>
                  <h5 className="text-sm font-bold text-stone-700 mb-2">Perihal</h5>
                  <div className="bg-white border border-stone-200 rounded-lg p-3 sm:p-4">
                    <p className="text-sm font-semibold text-stone-800 break-words">{selectedSurat.perihal}</p>
                  </div>
                </div>

                {/* Pengirim & Tanggal */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <div className="bg-white border border-stone-200 rounded-lg p-3 sm:p-4">
                    <div className="flex items-start gap-2">
                      <User className="w-4 h-4 text-stone-400 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs text-stone-500">Pengirim</p>
                        <p className="text-sm font-medium break-words">{selectedSurat.pengirim || '-'}</p>
                      </div>
                    </div>
                  </div>
                  <div className="bg-white border border-stone-200 rounded-lg p-3 sm:p-4">
                    <div className="flex items-start gap-2">
                      <Calendar className="w-4 h-4 text-stone-400 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs text-stone-500">Tanggal Surat</p>
                        <p className="text-sm font-medium">{selectedSurat.tanggalSurat ? formatDateTime(selectedSurat.tanggalSurat) : '-'}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Detail Permohonan Produksi */}
                {'location' in selectedSurat && (selectedSurat.location || selectedSurat.executionTime || selectedSurat.picName || selectedSurat.picWhatsApp) && (
                  <div className="bg-emerald-50/60 rounded-xl p-3 sm:p-4 border border-emerald-200">
                    <p className="text-xs font-bold text-emerald-800 uppercase tracking-wider mb-3">Detail Permohonan Produksi</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                      {selectedSurat.location && (
                        <div className="bg-white border border-emerald-100 rounded-lg p-3">
                          <div className="flex items-start gap-2">
                            <MapPin className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                            <div className="min-w-0">
                              <p className="text-xs text-stone-500">Tempat / Lokasi</p>
                              <p className="text-sm font-medium break-words">{selectedSurat.location}</p>
                            </div>
                          </div>
                        </div>
                      )}
                      {selectedSurat.executionTime && (
                        <div className="bg-white border border-emerald-100 rounded-lg p-3">
                          <div className="flex items-start gap-2">
                            <Calendar className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                            <div className="min-w-0">
                              <p className="text-xs text-stone-500">Waktu Pelaksanaan</p>
                              <p className="text-sm font-medium">{new Date(selectedSurat.executionTime).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}</p>
                            </div>
                          </div>
                        </div>
                      )}
                      {selectedSurat.picName && (
                        <div className="bg-white border border-emerald-100 rounded-lg p-3">
                          <div className="flex items-start gap-2">
                            <User className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                            <div className="min-w-0">
                              <p className="text-xs text-stone-500">Nama PIC</p>
                              <p className="text-sm font-medium break-words">{selectedSurat.picName}</p>
                            </div>
                          </div>
                        </div>
                      )}
                      {selectedSurat.picWhatsApp && (
                        <div className="bg-white border border-emerald-100 rounded-lg p-3">
                          <div className="flex items-start gap-2">
                            <Phone className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                            <div className="min-w-0">
                              <p className="text-xs text-stone-500">No. WhatsApp PIC</p>
                              <a href={`https://wa.me/${selectedSurat.picWhatsApp.replace(/^0/, '62')}`} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-emerald-600 hover:text-emerald-700 hover:underline">{selectedSurat.picWhatsApp}</a>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Deskripsi */}
                {selectedSurat.deskripsi && (
                  <div>
                    <h5 className="text-sm font-bold text-stone-700 mb-2">Deskripsi</h5>
                    <div className="bg-white border border-stone-200 rounded-lg p-3 sm:p-4 text-sm text-stone-600 whitespace-pre-wrap break-words">{selectedSurat.deskripsi}</div>
                  </div>
                )}

                {/* Dokumen Terlampir */}
                {selectedSurat.documents && Array.isArray(selectedSurat.documents) && selectedSurat.documents.filter((d: any) => d.webViewLink || d.driveFileId).length > 0 && (
                  <div>
                    <h5 className="text-sm font-bold text-stone-700 mb-2 flex items-center gap-2">
                      <Paperclip className="w-4 h-4 text-violet-500" />
                      Dokumen Terlampir ({selectedSurat.documents.filter((d: any) => d.webViewLink || d.driveFileId).length})
                    </h5>
                    <div className="space-y-2">
                      {selectedSurat.documents.filter((d: any) => d.webViewLink || d.driveFileId).map((doc: any, i: number) => (
                        <a key={doc.id || i} href={doc.downloadUrl || doc.webViewLink || '#'} target="_blank" rel="noopener noreferrer"
                          className={cn("flex items-center gap-3 p-3 bg-white border rounded-lg hover:shadow-sm transition-colors",
                            doc.webViewLink ? "border-stone-200 hover:border-violet-300 hover:bg-violet-50/30" : "border-stone-100 opacity-50 cursor-not-allowed"
                          )}
                        >
                          <FileText className="w-4 h-4 text-violet-500 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-stone-700 truncate">{doc.name}</p>
                            {doc.originalName && doc.originalName !== doc.name && (
                              <p className="text-[10px] text-stone-400 truncate">File asli: {doc.originalName}</p>
                            )}
                          </div>
                          {doc.webViewLink && <ExternalLink className="w-3.5 h-3.5 text-stone-400 shrink-0" />}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Sticky Footer with Action Buttons */}
          {selectedSurat && 'nomorSurat' in selectedSurat && (
            <div className={cn(
              "border-t bg-background/95 backdrop-blur-sm px-4 sm:px-6 py-3 sm:py-4",
              "flex flex-col sm:flex-row justify-end gap-2 sm:gap-3"
            )}>
              {selectedSurat.status !== 'diproses' && (
                <>
                  <Button variant="outline" className="w-full sm:w-auto gap-2 text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 justify-center"
                    onClick={() => { setIsSuratDetailOpen(false); setRejectReason(''); setIsRejectDialogOpen(true) }}>
                    <XCircle className="w-4 h-4" />
                    Tolak
                  </Button>
                  <Button className="w-full sm:w-auto gap-2 bg-green-600 hover:bg-green-700 text-white justify-center"
                    onClick={() => { setIsSuratDetailOpen(false); handleAcceptSurat(selectedSurat as Surat) }}>
                    <CheckCircle2 className="w-4 h-4" />
                    Terima & Buat Proyek
                  </Button>
                </>
              )}
              {selectedSurat.status === 'diproses' && (
                <Button className="w-full sm:w-auto gap-2 bg-violet-600 hover:bg-violet-700 text-white justify-center"
                  onClick={() => { setIsSuratDetailOpen(false); setPreFillFromSurat(selectedSurat as Surat); setActiveView('create') }}>
                  <ArrowRight className="w-4 h-4" />
                  Lanjut ke Proyek
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={isRejectDialogOpen} onOpenChange={setIsRejectDialogOpen}>
        <DialogContent className="max-w-md mx-4 sm:mx-0">
          <DialogHeader>
            <DialogTitle>Tolak Permohonan</DialogTitle>
            <DialogDescription>Berikan alasan penolakan untuk dikirim ke Administrator</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="rejectReason">Alasan Penolakan</Label>
              <Textarea
                id="rejectReason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Tulis alasan penolakan..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setIsRejectDialogOpen(false); setRejectReason('') }}>Batal</Button>
            <Button variant="destructive" onClick={handleReject} disabled={isSaving || !rejectReason.trim()}>
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
              Tolak
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
