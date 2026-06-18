'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useAppStore, STAGES, ROLE_CONFIG, getRoleDisplayName } from '@/lib/store'
import { FileUpload } from '@/components/pushakin/file-upload'
import { 
  ArrowLeft, 
  Edit, 
  Trash2, 
  CheckCircle2, 
  Clock, 
  Lock, 
  Folder, 
  Users,
  ChevronRight,
  Download,
  UploadCloud,
  Link as LinkIcon,
  AlertCircle,
  ShieldAlert,
  PlayCircle,
  FileVideo,
  FileImage,
  FileText,
  FileAudio,
  Save,
  Plus,
  X,
  Globe,
  ExternalLink,
  Paperclip,
  File,
  Loader2,
  Zap,
  SkipForward,
  Rocket,
  RotateCcw,
  PenTool,
  Copy,
  Check
} from 'lucide-react'
import { useState, useMemo, useCallback } from 'react'
import { cn } from '@/lib/utils'
import type { Task, DriveFolder } from '@/lib/store'

const ICON_MAP: Record<string, React.ElementType> = {
  'FileText': FileText,
  'FileImage': FileImage,
  'FileVideo': FileVideo,
  'FileAudio': FileAudio,
  'PlayCircle': PlayCircle,
  'AlertCircle': AlertCircle,
  'Link': LinkIcon,
  'PenTool': PenTool
}

// Platform options for publishers
const PUBLISH_PLATFORMS = [
  { id: 'website', label: 'Website Resmi', icon: '🌐' },
  { id: 'instagram', label: 'Instagram', icon: '📱' },
  { id: 'facebook', label: 'Facebook', icon: '📘' },
  { id: 'twitter', label: 'Twitter / X', icon: '🐦' },
  { id: 'youtube', label: 'YouTube', icon: '▶️' },
  { id: 'tiktok', label: 'TikTok', icon: '🎵' },
  { id: 'linkedin', label: 'LinkedIn', icon: '💼' },
  { id: 'newsletter', label: 'Newsletter', icon: '📧' },
  { id: 'portal', label: 'Portal Berita', icon: '📰' },
  { id: 'other', label: 'Lainnya', icon: '🔗' },
]

interface PublishLink {
  id: string
  platform: string
  url: string
}

export function ProjectDetailView() {
  const {
    currentUser, projects, selectedProjectId, users,
    setActiveView, setSelectedProjectId, deleteProject,
    completeTask, reviseTask, rejectReview, showAlert, showConfirm,
    updateProject, isEditProjectModalOpen, setIsEditProjectModalOpen,
    editProjectData, setEditProjectData,
    isImpersonating, originalUser, addNotification, addSuratTugas
  } = useAppStore()

  const project = projects.find(p => p.id === selectedProjectId)
  
  const [isEditDriveOpen, setIsEditDriveOpen] = useState(false)
  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [driveForm, setDriveForm] = useState<Record<string, string>>({})
  const [folderUserAccess, setFolderUserAccess] = useState<Record<string, { userId: string; userName: string; download: boolean; upload: boolean }[]>>({})
  const [taskInputs, setTaskInputs] = useState<Record<string, string>>({})
  const [taskVerified, setTaskVerified] = useState<Record<string, boolean>>({})
  const [isUploadingDetailDoc, setIsUploadingDetailDoc] = useState(false)
  const [revisionTaskId, setRevisionTaskId] = useState<string | null>(null)
  
  // State for multiple publish links per task
  const [taskPublishLinks, setTaskPublishLinks] = useState<Record<string, PublishLink[]>>({})

  // Calculate initial task inputs using useMemo
  const initialTaskState = useMemo(() => {
    if (!project) return { inputs: {}, verified: {}, publishLinks: {} }
    const inputs: Record<string, string> = {}
    const verified: Record<string, boolean> = {}
    const publishLinks: Record<string, PublishLink[]> = {}
    
    project.tasks.forEach(t => {
      inputs[t.id] = t.data?.link || ''
      verified[t.id] = false
      
      // Initialize publish links from existing data
      if (t.data?.publishLinks && Array.isArray(t.data.publishLinks)) {
        publishLinks[t.id] = t.data.publishLinks
      } else {
        publishLinks[t.id] = []
      }
    })
    return { inputs, verified, publishLinks }
  }, [project])

  // Use initial values directly
  const currentTaskInputs = Object.keys(taskInputs).length === 0 ? initialTaskState.inputs : taskInputs
  const currentTaskVerified = Object.keys(taskVerified).length === 0 ? initialTaskState.verified : taskVerified
  const currentTaskPublishLinks = Object.keys(taskPublishLinks).length === 0 ? initialTaskState.publishLinks : taskPublishLinks

  if (!project) return null

  const isManagerOrAdmin = currentUser ? ['Manager', 'Admin'].includes(currentUser.role) : false
  const isAdministratorOrAdmin = currentUser ? ['Administrator', 'Admin'].includes(currentUser.role) : false
  // Super Admin retains full power even when impersonating a worker
  const isAdminImpersonating = isImpersonating && originalUser?.role === 'Admin'
  const canManageProject = isManagerOrAdmin || isAdminImpersonating
  // Also grant admin-level access when Super Admin is impersonating
  const effectiveIsManagerOrAdmin = isManagerOrAdmin || isAdminImpersonating
  const effectiveIsAdministratorOrAdmin = isAdministratorOrAdmin || isAdminImpersonating

  const [copiedInfo, setCopiedInfo] = useState(false)

  const formatDateTime = (dateString: string) => {
    if (!dateString) return '-'
    const d = new Date(dateString)
    return d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
  }

  const handleCopyProjectInfo = useCallback(() => {
    const workerOutputsMap: Record<string, string[]> = project.workerOutputs || {}
    const workerCustomMap: Record<string, string> = project.workerCustomOutput || {}

    const stageLabels: Record<number, string> = {
      1: 'Tahap 1 — Produksi',
      2: 'Tahap 2 — Pasca Produksi',
      3: 'Tahap 3 — Review',
      4: 'Tahap 4 — Finalisasi',
      5: 'Tahap 5 — Publikasi',
    }

    let workerText = ''
    for (const stage of [1, 2, 3, 4, 5]) {
      const stageTasks = project.tasks.filter(t => t.stage === stage)
      if (stageTasks.length === 0) continue
      workerText += `\n📋 ${stageLabels[stage]}\n`
      stageTasks.forEach(t => {
        const userName = getUserDetails(t.assignedTo).name || 'Unknown'
        const outputs = workerOutputsMap[t.assignedTo || ''] || []
        const customOutput = workerCustomMap[t.assignedTo || ''] || ''
        const outputStr = outputs.length > 0
          ? outputs.map(o => o === 'Lainnya' && customOutput ? `Lainnya (${customOutput})` : o).join(', ')
          : '-'
        workerText += `  • ${userName} (${getRoleDisplayName(t.role)}): ${outputStr}\n`
      })
    }

    const activityTypes = (project.activityTypes || []).map(k =>
      k === 'Lainnya' && project.customActivity ? `Lainnya (${project.customActivity})` : k
    ).join(', ')

    const outputNeeds = (project.outputNeeds || []).map(o =>
      o === 'Lainnya' && project.customOutput ? `Lainnya (${project.customOutput})` : o
    ).join(', ')

    const text = `📌 *${project.title}*

📍 Tempat/Lokasi: ${project.location || '-'}
🕒 Pelaksanaan: ${formatDateTime(project.executionTime)}
👤 PIC: ${project.picName || '-'}
📱 WhatsApp PIC: ${project.picWhatsApp || '-'}
🎯 Tahap: ${STAGES[project.currentStage] || '-'}${project.currentStage === 6 ? ' ✅' : ''}

📝 Jenis Kegiatan: ${activityTypes || '-'}
📦 Kebutuhan Output: ${outputNeeds || '-'}

📋 Detail & Instruksi:
${project.description || '-'}
${workerText}\n—
Pushakin Flows — Sistem Manajemen Produksi`

    navigator.clipboard.writeText(text).then(() => {
      setCopiedInfo(true)
      setTimeout(() => setCopiedInfo(false), 2000)
    }).catch(() => {
      const textarea = document.createElement('textarea')
      textarea.value = text
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopiedInfo(true)
      setTimeout(() => setCopiedInfo(false), 2000)
    })
  }, [project, formatDateTime])

  const getUserDetails = (userId: string | null) => {
    const user = users.find(u => u.id === userId)
    return user ? { name: user.name, avatar: user.avatar } : { name: '', avatar: '' }
  }

  const handleOpenEditDrive = () => {
    const formState: Record<string, string> = {}
    const accessState: Record<string, { userId: string; userName: string; download: boolean; upload: boolean }[]> = {}
    project.driveFolders.forEach(f => {
      formState[f.id] = f.link
      // Initialize from existing assignedUsers data
      if (f.assignedUsers && Array.isArray(f.assignedUsers)) {
        accessState[f.id] = f.assignedUsers.map(u => ({
          userId: u.userId,
          userName: u.userName,
          download: u.download,
          upload: u.upload
        }))
      } else {
        accessState[f.id] = []
      }
    })
    setDriveForm(formState)
    setFolderUserAccess(accessState)
    setIsEditDriveOpen(true)
  }

  const toggleFolderUserAccess = (folderId: string, userId: string, userName: string, field: 'download' | 'upload') => {
    setFolderUserAccess(prev => {
      const current = prev[folderId] || []
      const existing = current.find(u => u.userId === userId)
      if (existing) {
        return { ...prev, [folderId]: current.map(u => u.userId === userId ? { ...u, [field]: !u[field] } : u) }
      } else {
        return { ...prev, [folderId]: [...current, { userId, userName, download: field === 'download', upload: field === 'upload' }] }
      }
    })
  }

  const handleSaveDriveLinks = async (e: React.FormEvent) => {
    e.preventDefault()
    // Get unique team members from tasks
    const teamMembers = Array.from(
      new Map(project.tasks.map(t => [t.assignedTo, t])).values()
    ).filter(t => t.assignedTo)

    const folders = project.driveFolders.map(f => {
      const accessList = folderUserAccess[f.id] || []
      // Build assignedUsers: include all team members that have any access checked
      const assignedUsers = teamMembers
        .filter(t => t.assignedTo)
        .map(t => {
          const existing = accessList.find(u => u.userId === t.assignedTo)
          return {
            userId: t.assignedTo!,
            userName: getUserDetails(t.assignedTo!).name,
            download: existing?.download || false,
            upload: existing?.upload || false
          }
        })
        .filter(u => u.download || u.upload)
      
      return {
        id: f.id,
        link: driveForm[f.id] || f.link,
        assignedUsers
      }
    })
    
    try {
      await fetch('/api/drive-folders', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, folders })
      })
      
      const updatedFolders = project.driveFolders.map(f => {
        const savedFolder = folders.find(sf => sf.id === f.id)
        return {
          ...f,
          link: driveForm[f.id] || f.link,
          assignedUsers: savedFolder?.assignedUsers || []
        }
      })
      updateProject({ ...project, driveFolders: updatedFolders })
      setIsEditDriveOpen(false)
    } catch {
      showAlert('Gagal menyimpan tautan drive')
    }
  }

  const handleDeleteProject = () => {
    showConfirm(
      'Peringatan: Yakin ingin menghapus proyek ini secara permanen? Aksi ini tidak dapat dibatalkan.',
      async () => {
        try {
          await fetch(`/api/projects?id=${project.id}`, { method: 'DELETE' })
          deleteProject(project.id)
        } catch {
          showAlert('Gagal menghapus proyek')
        }
      }
    )
  }

  const handleTaskComplete = async (taskId: string, taskData: { link?: string; publishLinks?: PublishLink[] }) => {
    try {
      const isSuperAdmin = currentUser?.role === 'Admin' || (isImpersonating && originalUser?.role === 'Admin')
      const response = await fetch('/api/tasks', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          taskId,
          taskData,
          isRevision: revisionTaskId === taskId,
          isAdminOverride: isSuperAdmin
        })
      })
      
      if (response.ok) {
        const result = await response.json()
        // Use API's authoritative projectState to sync store — prevents desync
        const projectState = result.projectState || undefined
        
        if (revisionTaskId === taskId) {
          reviseTask(project.id, taskId, taskData)
          setRevisionTaskId(null)
        } else {
          completeTask(project.id, taskId, taskData, projectState)
        }
        
        // If stage advanced, sync notifications and surat tugas for next stage workers
        if (result.stageAdvanced && result.nextStageTasks && result.nextStageTasks.length > 0) {
          const stageName = STAGES[result.newStage as keyof typeof STAGES] || `Tahap ${result.newStage}`
          for (const nextTask of result.nextStageTasks) {
            // Add notification to Zustand store (server already created DB record)
            addNotification({
              id: `server-${project.id}-${nextTask.assignedTo}-${result.newStage}`,
              userId: nextTask.assignedTo,
              message: `Proyek ${project.title} maju ke ${stageName}. Giliran Anda!`,
              projectId: project.id,
              targetView: 'project_detail',
              read: false,
              createdAt: new Date()
            })
            
            // Add surat tugas to Zustand store (server already created DB record)
            addSuratTugas({
              id: `surat-${project.id}-${nextTask.assignedTo}-${result.newStage}`,
              nomorSurat: `ST/AUTO/${result.newStage}/${Date.now()}`,
              projectId: project.id,
              userId: nextTask.assignedTo,
              role: nextTask.role,
              stage: nextTask.stage,
              status: 'active',
              read: false,
              createdAt: new Date().toISOString(),
              project: {
                id: project.id,
                title: project.title,
                manager: users.find(u => u.id === project.managerId) || null
              }
            })
          }
        }
      } else {
        const errorData = await response.json().catch(() => ({}))
        const errorMsg = errorData.error || 'Gagal menyelesaikan tugas'
        showAlert(`Gagal menyelesaikan tugas: ${errorMsg}`)
      }
    } catch {
      showAlert('Terjadi kesalahan')
    }
  }

  const handleReviewReject = async () => {
    // Buka dialog input alasan terlebih dahulu
    setIsRejectDialogOpen(true)
    setRejectReason('')
  }

  const handleConfirmReject = async () => {
    try {
      const response = await fetch('/api/tasks', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          isReviewReject: true,
          rejectReason: rejectReason.trim()
        })
      })
      
      if (response.ok) {
        rejectReview(project.id)
        setIsRejectDialogOpen(false)
        setRejectReason('')
      } else {
        showAlert('Gagal menolak review')
      }
    } catch {
      showAlert('Terjadi kesalahan')
    }
  }

  const handleSaveEditedProject = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editProjectData) return
    
    try {
      await fetch('/api/projects', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editProjectData)
      })
      updateProject(editProjectData)
      setIsEditProjectModalOpen(false)
    } catch {
      showAlert('Gagal menyimpan perubahan')
    }
  }

  // Upload document from project detail view (Manager only)
  const handleDocUploadFromDetail = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    setIsUploadingDetailDoc(true)

    for (const file of Array.from(files)) {
      try {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('projectId', project.id)
        formData.append('label', 'Dokumen Pendukung')

        const res = await fetch('/api/projects/upload-document', {
          method: 'POST',
          body: formData,
        })

        if (res.ok) {
          const data = await res.json()
          if (data.success && data.document) {
            const updatedDocs = [...(project.documents || []), data.document]
            updateProject({ ...project, documents: updatedDocs })
          }
        } else {
          showAlert('Gagal mengunggah: ' + file.name)
        }
      } catch (err) {
        console.error('[DOC UPLOAD DETAIL] Failed:', err)
        showAlert('Terjadi kesalahan saat mengunggah dokumen.')
      }
    }

    setIsUploadingDetailDoc(false)
    e.target.value = '' // Reset input so same file can be selected again
  }

  // Delete document from project detail view (Manager only)
  const handleDeleteDocument = async (documentId: string) => {
    showConfirm('Yakin ingin menghapus dokumen ini?', async () => {
      try {
        const res = await fetch(`/api/projects/upload-document?projectId=${project.id}&documentId=${documentId}`, {
          method: 'DELETE',
        })

        if (res.ok) {
          const updatedDocs = (project.documents || []).filter(d => d.id !== documentId)
          updateProject({ ...project, documents: updatedDocs })
        } else {
          showAlert('Gagal menghapus dokumen.')
        }
      } catch {
        showAlert('Terjadi kesalahan saat menghapus dokumen.')
      }
    })
  }

  // Normalize drive folders: ensure output subfolders (Foto/, Video/) have correct
  // assignedUsers. This fixes projects created before the output-subfolder fix where
  // assignedUsers was empty, causing uploads to go to the parent user subfolder (HS_...)
  // instead of the specific output folder.
  const normalizedDriveFolders = project.driveFolders.map(folder => {
    if (folder.folderId.includes('-output-') && (!folder.assignedUsers || folder.assignedUsers.length === 0)) {
      const outputPrefix = folder.folderId.substring(0, folder.folderId.indexOf('-output-'))
      // Inherit assignedUsers from the parent user subfolder (HS_...)
      const parentSub = project.driveFolders.find(f => f.folderId === outputPrefix)
      if (parentSub?.assignedUsers && parentSub.assignedUsers.length > 0) {
        return {
          ...folder,
          assignedRoles: parentSub.assignedRoles?.length ? parentSub.assignedRoles : folder.assignedRoles,
          assignedUsers: parentSub.assignedUsers.map(au => ({
            ...au,
            upload: true, // output subfolders are always upload destinations for the owner
            download: true, // owner can also download what they uploaded
          })),
          parentFolderId: outputPrefix,
        }
      }
    }
    return folder
  })

  const visibleFolders = normalizedDriveFolders.filter(folder => {
    // Super Admin & Manager: full access to ALL folders (Mode Override / Bypass Tahap)
    // — no need for DL/UL checkboxes to be assigned to themselves
    if (canManageProject) return true

    // All other users: only show folders assigned by Manager
    const myId = currentUser?.id || ''
    const myRole = currentUser?.role || ''
    // Detect subfolders (parentFolderId or folderId pattern)
    const isSub = folder.parentFolderId ||
      (folder.folderId.includes('-') && ['raw', 'revised', 'final', 'desain', 'lainnya'].some(b => folder.folderId.startsWith(b + '-')))
    if (isSub) {
      // Check assignedUsers first (most precise) — match by userId
      if (folder.assignedUsers?.some((au: any) => au.userId === myId)) return true
      // Then check assignedRoles
      if (!folder.assignedRoles || folder.assignedRoles.length === 0) return true
      return folder.assignedRoles.includes(myRole)
    }
    // For parent folders:
    // 1. Check assignedUsers with download:true or upload:true (manager DL/UL checkboxes)
    if (folder.assignedUsers?.some((au: any) => au.userId === myId && (au.download || au.upload))) return true
    // 2. Check assignedRoles
    if (folder.assignedRoles?.includes(myRole)) return true
    // 3. No restrictions = visible to all
    if (!folder.assignedRoles || folder.assignedRoles.length === 0) {
      // Still respect assignedUsers — if there ARE assignedUsers but none match, hide
      if (folder.assignedUsers && folder.assignedUsers.length > 0) {
        return folder.assignedUsers.some((au: any) => au.userId === myId)
      }
      return true
    }
    return false
  })

  // Separate parent folders and subfolders (including nested output subfolders)
  const parentFolders = visibleFolders.filter(f => !f.parentFolderId && !(['raw', 'revised', 'final', 'desain', 'lainnya'].some(b => f.folderId.startsWith(b + '-') && f.folderId.includes('-'))))
  const subfolders = visibleFolders.filter(f => f.parentFolderId || (f.folderId.includes('-') && ['raw', 'revised', 'final', 'desain', 'lainnya'].some(b => f.folderId.startsWith(b + '-'))))
  
  // Get direct child subfolders for a given parent ID (supports 3-level hierarchy)
  const getSubfolders = (parentId: string) => {
    return subfolders.filter(s => {
      // Direct parent match (most reliable)
      if (s.parentFolderId === parentId) return true
      // Legacy: folderId prefix match for top-level folders like "raw"
      if (!s.parentFolderId && s.folderId.startsWith(parentId + '-') && !s.folderId.includes('-output-')) return true
      return false
    })
  }
  
  // Check if a subfolder has nested output subfolders inside it
  const getOutputSubfolders = (userSubfolderId: string) => {
    return subfolders.filter(s => s.parentFolderId === userSubfolderId && s.folderId.includes('-output-'))
  }

  const visibleTasks = project.tasks.filter(t => 
    effectiveIsManagerOrAdmin ? true : t.assignedTo === currentUser?.id
  )

  // Add/Remove publish link handlers
  const addPublishLink = (taskId: string) => {
    const newLink: PublishLink = {
      id: `link-${Date.now()}`,
      platform: 'website',
      url: ''
    }
    setTaskPublishLinks(prev => ({
      ...prev,
      [taskId]: [...(prev[taskId] || []), newLink]
    }))
  }

  const removePublishLink = (taskId: string, linkId: string) => {
    setTaskPublishLinks(prev => ({
      ...prev,
      [taskId]: (prev[taskId] || []).filter(l => l.id !== linkId)
    }))
  }

  const updatePublishLink = (taskId: string, linkId: string, field: 'platform' | 'url', value: string) => {
    setTaskPublishLinks(prev => ({
      ...prev,
      [taskId]: (prev[taskId] || []).map(l => 
        l.id === linkId ? { ...l, [field]: value } : l
      )
    }))
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header Actions */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <Button
          variant="ghost"
          onClick={() => setActiveView('dashboard')}
          className="text-stone-500 hover:text-indigo-600 gap-1"
        >
          <ArrowLeft className="w-4 h-4 rotate-180" />
          <span>Kembali ke Dashboard</span>
        </Button>
        
        {canManageProject && (
          <div className="flex gap-2 sm:gap-3">
            <Button
              variant="outline"
              onClick={() => { setEditProjectData(project); setIsEditProjectModalOpen(true); }}
              className="gap-2"
            >
              <Edit className="w-4 h-4" />
              <span className="hidden sm:inline">Edit Proyek</span>
            </Button>
            <Button
              variant="outline"
              onClick={handleDeleteProject}
              className="gap-2 text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
            >
              <Trash2 className="w-4 h-4" />
              <span className="hidden sm:inline">Hapus Proyek</span>
            </Button>
          </div>
        )}
      </div>

      {/* Project Header */}
      <Card>
        <CardContent className="p-4 sm:p-6 lg:p-8">
          <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4">
            <div className="min-w-0">
              <h2 className="text-2xl sm:text-3xl font-bold text-stone-900 mb-2 break-words">{project.title}</h2>
              <div className="flex flex-wrap items-center gap-2 text-sm text-stone-500">
                <Badge variant="outline" className="font-mono text-xs">{project.id}</Badge>
                <span>•</span>
                <span>Pemohon: <strong className="text-stone-700">{project.requesterUnit}</strong></span>
              </div>
            </div>
            <div className="bg-white px-5 py-3 rounded-2xl border border-stone-200 shadow-sm text-center md:text-right shrink-0">
              <span className="text-[10px] uppercase tracking-wider text-stone-400 font-bold block mb-1">
                Status Saat Ini
              </span>
              <span className="font-bold text-lg text-indigo-700">
                Tahap {project.currentStage}: {STAGES[project.currentStage]}
              </span>
              {project.isFastTrack && (
                <Badge className="bg-amber-500 text-white text-[10px] px-2 py-0.5 ml-2 border-0">
                  <Zap className="h-3 w-3 mr-1" />FAST TRACK
                </Badge>
              )}
              {project.isFastProduction && (
                <Badge className="bg-teal-500 text-white text-[10px] px-2 py-0.5 ml-2 border-0">
                  <Rocket className="h-3 w-3 mr-1" />FAST PRODUCTION
                </Badge>
              )}
            </div>
          </div>

          {/* Timeline */}
          <div className="mt-8">
            <h3 className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              Alur Kerja (Timeline)
              {project.isFastProduction && (
                <Badge className="bg-teal-500 text-white text-[9px] px-1.5 py-0 border-0">
                  <Rocket className="h-2.5 w-2.5 mr-0.5" />FAST PRODUCTION
                </Badge>
              )}
            </h3>
            <div className="hidden sm:flex items-center justify-between w-full relative">
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-1 bg-stone-100 rounded-full z-0" />
              {project.isFastProduction ? (
                <div 
                  className="absolute left-0 top-1/2 -translate-y-1/2 h-1 bg-teal-500 rounded-full z-0 transition-all duration-500" 
                  style={{ width: '100%' }}
                />
              ) : (
                <div 
                  className="absolute left-0 top-1/2 -translate-y-1/2 h-1 bg-indigo-500 rounded-full z-0 transition-all duration-500" 
                  style={{ width: `${((project.currentStage - 1) / 5) * 100}%` }}
                />
              )}
              
              {[1, 2, 3, 4, 5, 6].map((stageNum) => {
                const isCompleted = stageNum < project.currentStage
                const isCurrent = stageNum === project.currentStage
                const isFastTracked = project.isFastTrack && stageNum >= 1 && stageNum <= 4
                const isFastProduction = project.isFastProduction && stageNum >= 1 && stageNum <= 5
                // Fast Production: stage 3 (Review) is auto-approved
                const isFPAutoApproved = project.isFastProduction && stageNum === 3
                
                // Fast Production: stages 1-5 are all "active" (teal), stage 3 is auto-approved, stage 6 is pending until all done
                const isFPActive = isFastProduction && !isCompleted && !isFPAutoApproved
                
                return (
                  <div key={stageNum} className="relative z-10 flex flex-col items-center">
                    <div className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm border-4 transition-all",
                      isFPAutoApproved
                        ? "bg-emerald-500 border-emerald-500 text-white"
                        : isFastProduction && isCompleted
                          ? "bg-teal-600 border-teal-600 text-white"
                          : isFPActive
                            ? "bg-white border-teal-500 text-teal-600 shadow-md ring-4 ring-teal-50"
                            : isFastTracked && isCompleted
                              ? "bg-purple-500 border-purple-500 text-white"
                              : isCompleted 
                                ? "bg-indigo-600 border-indigo-600 text-white" 
                                : isCurrent 
                                  ? "bg-white border-indigo-500 text-indigo-600 shadow-md ring-4 ring-indigo-50" 
                                  : "bg-stone-50 border-stone-200 text-stone-400"
                    )}>
                      {isFPAutoApproved ? <CheckCircle2 className="w-4 h-4" /> : isFastProduction && isCompleted ? <CheckCircle2 className="w-4 h-4" /> : isFastTracked && isCompleted ? <SkipForward className="w-4 h-4" /> : isCompleted ? <CheckCircle2 className="w-4 h-4" /> : stageNum}
                    </div>
                    <span className={cn(
                      "absolute top-10 text-[10px] font-bold uppercase tracking-wider w-24 text-center",
                      isFPAutoApproved
                        ? "text-emerald-700"
                        : isFastProduction && isCompleted 
                          ? "text-teal-700" 
                          : isFPActive 
                            ? "text-teal-600" 
                            : isFastTracked && isCompleted 
                              ? "text-purple-600" 
                              : isCurrent 
                                ? "text-indigo-700" 
                                : isCompleted 
                                  ? "text-stone-700" 
                                  : "text-stone-400"
                    )}>
                      {STAGES[stageNum]}
                      {isFPAutoApproved && <span className="block text-emerald-400 text-[8px]">auto-approve</span>}
                      {isFastProduction && isFPActive && <span className="block text-teal-400 text-[8px]">aktif</span>}
                      {isFastTracked && isCompleted && <span className="block text-purple-400 text-[8px]">skipped</span>}
                    </span>
                  </div>
                )
              })}
            </div>
            <div className="h-6" />
          </div>

          {/* Team Progress — aligned with timeline stages */}
          <div className="pt-6 border-t border-stone-100">
            <h3 className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Users className="w-4 h-4" />
              <span>Progres Tim</span>
              {project.isFastProduction && (
                <Badge className="bg-teal-500 text-white text-[9px] px-1.5 py-0 border-0">
                  <Rocket className="h-2.5 w-2.5 mr-0.5" />PARALEL
                </Badge>
              )}
            </h3>
            {/* Desktop: horizontal columns aligned with timeline stages */}
            <div className="hidden sm:grid sm:grid-cols-6 gap-3">
              {[1, 2, 3, 4, 5, 6].map(stageNum => {
                const stageTasks = project.tasks.filter(t => t.stage === stageNum)
                const isCompleted = stageNum < project.currentStage
                const isCurrent = stageNum === project.currentStage
                const isFPAutoApproved = project.isFastProduction && stageNum === 3
                const isFPActive = project.isFastProduction && stageNum >= 1 && stageNum <= 5 && !isCompleted && !isFPAutoApproved
                
                return (
                  <div key={stageNum} className="flex flex-col gap-2">
                    {/* Stage header */}
                    <div className={cn(
                      "text-center text-[10px] font-bold uppercase tracking-wider pb-2 border-b",
                      isFPAutoApproved
                        ? "text-emerald-600 border-emerald-200"
                        : isFPActive
                          ? "text-teal-600 border-teal-200"
                          : isCompleted
                            ? "text-stone-500 border-stone-200"
                            : isCurrent
                              ? "text-indigo-600 border-indigo-200"
                              : "text-stone-300 border-stone-100"
                    )}>
                      {STAGES[stageNum]}
                      {isFPAutoApproved && <span className="block text-emerald-400 text-[8px]">auto-approve</span>}
                    </div>
                    {/* Team members in this stage */}
                    {stageTasks.length === 0 ? (
                      <div className="text-[9px] text-stone-300 italic text-center py-2">—</div>
                    ) : (
                      stageTasks.map(task => {
                        const user = getUserDetails(task.assignedTo)
                        const taskCompleted = task.status === 'completed'
                        const taskCurrent = project.isFastProduction ? true : task.stage === project.currentStage
                        
                        return (
                          <div
                            key={task.id}
                            className={cn(
                              "flex items-center p-2 rounded-lg border transition-all",
                              taskCompleted
                                ? project.isFastProduction
                                  ? "bg-teal-50/50 border-teal-100"
                                  : "bg-green-50/50 border-green-100"
                                : taskCurrent
                                  ? project.isFastProduction
                                    ? "bg-white border-teal-200 shadow-sm"
                                    : "bg-white border-indigo-200 shadow-sm"
                                  : "bg-stone-50/50 border-stone-200 opacity-70"
                            )}
                          >
                            <Avatar className="h-7 w-7 border border-white shadow-sm shrink-0">
                              <AvatarImage src={user.avatar} />
                              <AvatarFallback className="text-[9px]">{user.name?.charAt(0) || '?'}</AvatarFallback>
                            </Avatar>
                            <div className="ml-1.5 flex-1 overflow-hidden min-w-0">
                              <p className="text-[10px] font-bold text-stone-800 truncate leading-tight" title={user.name}>
                                {user.name || '—'}
                              </p>
                              <p className="text-[8px] font-medium text-stone-400 truncate leading-tight" title={getRoleDisplayName(task.role)}>
                                {getRoleDisplayName(task.role)}
                              </p>
                            </div>
                            <div className="ml-1 shrink-0 relative">
                              {taskCompleted ? (
                                <div className={cn(
                                  "p-1 rounded-md relative",
                                  project.isFastProduction ? "bg-teal-100 text-teal-600" : "bg-green-100 text-green-600"
                                )} title={task.revisionCount && task.revisionCount > 0 ? `Selesai (Revisi ${task.revisionCount}x)` : "Selesai"}>
                                  <CheckCircle2 className="w-3 h-3" />
                                  {task.revisionCount && task.revisionCount > 0 && (
                                    <span className="absolute -top-1 -right-1 bg-amber-400 text-white text-[7px] font-bold rounded-full w-3 h-3 flex items-center justify-center">
                                      {task.revisionCount}
                                    </span>
                                  )}
                                </div>
                              ) : taskCurrent ? (
                                <div className={cn(
                                  "p-1 rounded-md",
                                  project.isFastProduction ? "bg-teal-100 text-teal-600" : "bg-orange-100 text-orange-600"
                                )} title="Dikerjakan">
                                  <Clock className={cn("w-3 h-3", project.isFastProduction ? "" : "animate-pulse")} />
                                </div>
                              ) : (
                                <div className="bg-stone-200 text-stone-400 p-1 rounded-md" title="Terkunci">
                                  <Lock className="w-3 h-3" />
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                )
              })}
            </div>
            {/* Mobile: vertical list grouped by stage */}
            <div className="sm:hidden space-y-4">
              {[1, 2, 3, 4, 5, 6].map(stageNum => {
                const stageTasks = project.tasks.filter(t => t.stage === stageNum)
                const isCompleted = stageNum < project.currentStage
                const isCurrent = stageNum === project.currentStage
                const isFPAutoApproved = project.isFastProduction && stageNum === 3
                const isFPActive = project.isFastProduction && stageNum >= 1 && stageNum <= 5 && !isCompleted && !isFPAutoApproved
                
                if (stageTasks.length === 0) return null
                
                return (
                  <div key={stageNum}>
                    <div className={cn(
                      "text-[10px] font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5",
                      isFPAutoApproved
                        ? "text-emerald-600"
                        : isFPActive
                          ? "text-teal-600"
                          : isCompleted
                            ? "text-stone-500"
                            : isCurrent
                              ? "text-indigo-600"
                              : "text-stone-300"
                    )}>
                      <span className={cn(
                        "w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold",
                        isFPAutoApproved
                          ? "bg-emerald-500 text-white"
                          : isFPActive
                            ? "bg-teal-500 text-white"
                            : isCompleted
                              ? "bg-indigo-600 text-white"
                              : isCurrent
                                ? "bg-white border-2 border-indigo-500 text-indigo-600"
                                : "bg-stone-100 text-stone-400"
                      )}>
                        {isFPAutoApproved ? '✓' : isCompleted && !isFPActive ? '✓' : stageNum}
                      </span>
                      {STAGES[stageNum]}
                      {isFPAutoApproved && <span className="text-emerald-400 text-[8px] ml-1">auto-approve</span>}
                    </div>
                    <div className="space-y-2 ml-6">
                      {stageTasks.map(task => {
                        const user = getUserDetails(task.assignedTo)
                        const taskCompleted = task.status === 'completed'
                        const taskCurrent = project.isFastProduction ? true : task.stage === project.currentStage
                        
                        return (
                          <div
                            key={task.id}
                            className={cn(
                              "flex items-center p-3 rounded-xl border transition-all",
                              taskCompleted
                                ? project.isFastProduction
                                  ? "bg-teal-50/50 border-teal-100"
                                  : "bg-green-50/50 border-green-100"
                                : taskCurrent
                                  ? project.isFastProduction
                                    ? "bg-white border-teal-200 shadow-sm"
                                    : "bg-white border-indigo-200 shadow-sm"
                                  : "bg-stone-50/50 border-stone-200 opacity-70"
                            )}
                          >
                            <Avatar className="h-10 w-10 border-2 border-white shadow-sm">
                              <AvatarImage src={user.avatar} />
                              <AvatarFallback>{user.name?.charAt(0) || '?'}</AvatarFallback>
                            </Avatar>
                            <div className="ml-3 flex-1 overflow-hidden">
                              <p className="text-xs font-bold text-stone-800 truncate" title={user.name}>
                                {user.name || 'Menunggu Assign'}
                              </p>
                              <p className="text-[10px] font-medium text-stone-500 truncate" title={getRoleDisplayName(task.role)}>
                                {getRoleDisplayName(task.role)}
                              </p>
                            </div>
                            <div className="ml-2 relative">
                              {taskCompleted ? (
                                <div className={cn(
                                  "p-1.5 rounded-lg relative",
                                  project.isFastProduction ? "bg-teal-100 text-teal-600" : "bg-green-100 text-green-600"
                                )} title={task.revisionCount && task.revisionCount > 0 ? `Selesai (Revisi ${task.revisionCount}x)` : "Selesai"}>
                                  <CheckCircle2 className="w-4 h-4" />
                                  {task.revisionCount && task.revisionCount > 0 && (
                                    <span className="absolute -top-1 -right-1 bg-amber-400 text-white text-[8px] font-bold rounded-full w-3.5 h-3.5 flex items-center justify-center">
                                      {task.revisionCount}
                                    </span>
                                  )}
                                </div>
                              ) : taskCurrent ? (
                                <div className={cn(
                                  "p-1.5 rounded-lg",
                                  project.isFastProduction ? "bg-teal-100 text-teal-600" : "bg-orange-100 text-orange-600"
                                )} title="Sedang Dikerjakan">
                                  <Clock className={cn("w-4 h-4", project.isFastProduction ? "" : "animate-pulse")} />
                                </div>
                              ) : (
                                <div className="bg-stone-200 text-stone-400 p-1.5 rounded-lg" title="Terkunci">
                                  <Lock className="w-4 h-4" />
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Workspace Drive Aktif — only for Manager / Super Admin.
              Petugas (workers) access their folders via the "Tugas Anda" section below. */}
          {canManageProject && (
            <div className="pt-6 border-t border-stone-100 mt-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-2">
                <h3 className="text-xs font-bold text-stone-400 uppercase tracking-wider flex items-center gap-2">
                  <Folder className="w-4 h-4" />
                  <span>Workspace Drive Aktif</span>
                </h3>
                {canManageProject && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleOpenEditDrive}
                    className="gap-2 text-amber-600 border-amber-200 hover:bg-amber-50"
                  >
                    <Edit className="w-3 h-3" />
                    <span>Koreksi Folder</span>
                  </Button>
                )}
              </div>
              {project.driveFolders.length === 0 ? (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
                  <Folder className="w-8 h-8 text-amber-300 mx-auto mb-2" />
                  <p className="text-sm font-medium text-amber-700">Belum ada folder workspace</p>
                  <p className="text-xs text-amber-500 mt-1">Klik <strong>Koreksi Folder</strong> untuk menambahkan folder drive ke proyek ini.</p>
                </div>
              ) : visibleFolders.length === 0 ? (
                <div className="bg-stone-50 border border-stone-200 rounded-xl p-4 text-center">
                  <Folder className="w-8 h-8 text-stone-300 mx-auto mb-2" />
                  <p className="text-sm font-medium text-stone-500">Tidak ada folder yang ditugaskan untuk Anda</p>
                  <p className="text-xs text-stone-400 mt-1">Folder workspace hanya terlihat jika ditugaskan oleh Manajer.</p>
                </div>
              ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {parentFolders.map((folder) => {
                  const folderSubfolders = getSubfolders(folder.folderId)
                  return (
                    <div
                      key={folder.id}
                      className="flex flex-col bg-white p-3.5 rounded-2xl border border-stone-100"
                    >
                      <div className="flex items-center gap-3 mb-2">
                        <div className={cn("p-2.5 rounded-xl", folder.bg || 'bg-stone-100', folder.color || 'text-stone-600')}>
                          <Folder className="w-5 h-5" />
                        </div>
                        <div className="flex-1 overflow-hidden">
                          <div className="font-bold text-stone-800 text-xs truncate">
                            {folder.name ? folder.name.split(' (')[0] : 'Folder'}
                          </div>
                          <p className="text-[9px] text-stone-400 mt-0.5 truncate">{folder.desc}</p>
                        </div>
                      </div>
                      
                      {/* Show subfolders if any */}
                      {folderSubfolders.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-stone-50">
                          <div className="text-[9px] font-bold text-stone-500 uppercase tracking-wider mb-2">
                            Subfolder ({folderSubfolders.length})
                          </div>
                          <div className="space-y-1.5 max-h-40 overflow-y-auto">
                            {folderSubfolders.map(sub => {
                              // Check if this user subfolder has output-type subfolders inside it
                              const outputSubfolders = getOutputSubfolders(sub.folderId)
                              return (
                                <div key={sub.id} className="flex flex-col bg-stone-50 rounded-lg border border-stone-100 overflow-hidden">
                                  <div className="flex items-center gap-2 p-2">
                                    <div className="p-1.5 rounded-md bg-white border border-stone-200">
                                      <Folder className="w-3 h-3 text-stone-500" />
                                    </div>
                                    <div className="flex-1 overflow-hidden">
                                      <div className="text-[10px] font-medium text-stone-700 truncate" title={sub.name}>
                                        {sub.name}
                                      </div>
                                      {sub.assignedRoles && sub.assignedRoles.length > 0 && (
                                        <div className="text-[8px] text-stone-400 truncate">
                                          {sub.assignedRoles.join(', ')}
                                        </div>
                                      )}
                                    </div>
                                    <div className="p-1 text-stone-300" title="Upload melalui Tugas Anda di bawah">
                                      <Lock className="w-3 h-3" />
                                    </div>
                                  </div>
                                  {/* Show output-type subfolders inside user folder */}
                                  {outputSubfolders.length > 0 && (
                                    <div className="px-2 pb-2 pt-1 border-t border-stone-100/50">
                                      <div className="text-[8px] font-bold text-stone-400 uppercase tracking-wider mb-1">
                                        Output ({outputSubfolders.length})
                                      </div>
                                      <div className="flex flex-wrap gap-1">
                                        {outputSubfolders.map(outSub => (
                                          <span key={outSub.id} className="inline-flex items-center gap-0.5 text-[8px] bg-white text-stone-600 px-1.5 py-0.5 rounded border border-stone-200 font-medium" title={outSub.name}>
                                            <Folder className="w-2.5 h-2.5 text-stone-400" />
                                            {outSub.name}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                      
                      {/* Show assigned roles if no subfolders */}
                      {folderSubfolders.length === 0 && (
                        <div className="mt-auto pt-2 border-t border-stone-50">
                          {folder.assignedRoles && folder.assignedRoles.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {folder.assignedRoles.map(r => (
                                <span key={r} className="text-[8px] bg-stone-50 text-stone-600 px-1.5 py-0.5 rounded border border-stone-100 font-medium">
                                  {r}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[9px] text-stone-400 italic">Akses Global (Semua Tim)</span>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Project Details */}
      <Card>
        <CardContent className="p-6">
          <h3 className="text-sm font-bold text-stone-800 mb-4 flex items-center gap-2">
            <Folder className="w-4 h-4 text-stone-500" />
            <span>Detail Informasi Proyek</span>
            <button
              type="button"
              onClick={handleCopyProjectInfo}
              className="ml-auto flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-stone-200 bg-white hover:bg-stone-50 text-stone-600 hover:text-stone-800 transition-all active:scale-95"
              title="Salin info proyek untuk dibagikan"
            >
              {copiedInfo ? (
                <>
                  <Check className="w-3.5 h-3.5 text-green-600" />
                  <span className="text-green-600">Tersalin!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Salin Info</span>
                </>
              )}
            </button>
          </h3>
          <div className="flex flex-wrap gap-4 text-sm bg-white p-4 rounded-xl border border-stone-100 mb-6">
            <div className="flex flex-col min-w-[120px] max-w-[200px]">
              <span className="text-stone-400 text-[10px] uppercase tracking-wider font-bold mb-1">
                Tempat/Lokasi
              </span>
              <span className="font-medium text-stone-800 truncate" title={project.location || '-'}>
                {project.location || '-'}
              </span>
            </div>
            <div className="w-px h-8 bg-stone-100 hidden md:block" />
            <div className="flex flex-col min-w-[120px]">
              <span className="text-stone-400 text-[10px] uppercase tracking-wider font-bold mb-1">
                Pelaksanaan
              </span>
              <span className="font-medium text-stone-800">{formatDateTime(project.executionTime)}</span>
            </div>
            <div className="w-px h-8 bg-stone-100 hidden md:block" />
            <div className="flex flex-col min-w-[120px]">
              <span className="text-stone-400 text-[10px] uppercase tracking-wider font-bold mb-1">
                Nama PIC
              </span>
              <span className="font-medium text-stone-800 truncate">{project.picName || '-'}</span>
            </div>
            <div className="w-px h-8 bg-stone-100 hidden md:block" />
            <div className="flex flex-col min-w-[120px]">
              <span className="text-stone-400 text-[10px] uppercase tracking-wider font-bold mb-1">
                WhatsApp PIC
              </span>
              <span className="font-bold text-indigo-600">{project.picWhatsApp || '-'}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-1 space-y-4">
              {project.activityTypes && project.activityTypes.length > 0 && (
                <div>
                  <span className="text-stone-400 text-[10px] uppercase tracking-wider font-bold block mb-2">
                    Jenis Kegiatan
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {project.activityTypes.map(k => (
                      <Badge key={k} variant="outline" className="text-[10px] font-bold">
                        {k === 'Lainnya' && project.customActivity ? `Lainnya (${project.customActivity})` : k}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {project.outputNeeds && project.outputNeeds.length > 0 && (
                <div>
                  <span className="text-stone-400 text-[10px] uppercase tracking-wider font-bold block mb-2">
                    Kebutuhan Output
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {project.outputNeeds.map(o => (
                      <Badge key={o} variant="outline" className="text-[10px] font-bold">
                        {o === 'Lainnya' && project.customOutput ? `Lainnya (${project.customOutput})` : o}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="md:col-span-2">
              <span className="text-stone-400 text-[10px] uppercase tracking-wider font-bold block mb-2">
                Detail & Instruksi Permohonan
              </span>
              <p className="text-stone-700 bg-white p-4 rounded-xl border border-stone-100 whitespace-pre-line leading-relaxed text-sm">
                {project.description}
              </p>
            </div>
          </div>

          {/* Petugas & Kebutuhan Output — Grouped by Stage */}
          {(() => {
            const workerOutputsMap: Record<string, string[]> = project.workerOutputs || {}
            const workerCustomMap: Record<string, string> = project.workerCustomOutput || {}
            
            // Build a structured list: group tasks by stage, then show each worker + their outputs
            const stagesToShow = [1, 2, 3, 4, 5]
            const stageConfig: Record<number, { label: string; color: string; bg: string; border: string }> = {
              1: { label: 'Tahap 1 — Produksi', color: 'text-violet-700', bg: 'bg-violet-50', border: 'border-violet-200' },
              2: { label: 'Tahap 2 — Pasca Produksi', color: 'text-orange-700', bg: 'bg-orange-50', border: 'border-orange-200' },
              3: { label: 'Tahap 3 — Review', color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200' },
              4: { label: 'Tahap 4 — Finalisasi', color: 'text-cyan-700', bg: 'bg-cyan-50', border: 'border-cyan-200' },
              5: { label: 'Tahap 5 — Publikasi', color: 'text-green-700', bg: 'bg-green-50', border: 'border-green-200' },
            }
            
            // Group tasks by stage
            const tasksByStage = new Map<number, Array<{ task: Task; userName: string; outputs: string[]; customOutput: string }>>()
            for (const stage of stagesToShow) {
              const stageTasks = project.tasks.filter(t => t.stage === stage)
              if (stageTasks.length === 0) continue
              
              const entries = stageTasks.map(t => {
                const userDetails = getUserDetails(t.assignedTo)
                const assigneeId = t.assignedTo || ''
                const outputs = workerOutputsMap[assigneeId] || []
                const customOutput = workerCustomMap[assigneeId] || ''
                return { task: t, userName: userDetails.name || 'Unknown', outputs, customOutput }
              })
              tasksByStage.set(stage, entries)
            }
            
            // Check if there's any data to show
            const hasWorkerData = tasksByStage.size > 0 && (
              Object.keys(workerOutputsMap).length > 0 || 
              Array.from(tasksByStage.values()).some(entries => entries.length > 0)
            )
            
            if (!hasWorkerData) return null
            
            // Count totals
            const totalWorkers = project.tasks.filter(t => t.stage >= 1 && t.stage <= 5).length
            const totalWithOutputs = Object.keys(workerOutputsMap).filter(uid => 
              workerOutputsMap[uid] && workerOutputsMap[uid].length > 0
            ).length
            
            return (
              <div className="mt-6 pt-6 border-t border-stone-100">
                <div className="flex items-center gap-2 mb-4">
                  <Users className="w-4 h-4 text-violet-600" />
                  <span className="text-sm font-bold text-stone-800">Petugas & Kebutuhan Output</span>
                  <Badge variant="outline" className="text-[9px] font-bold text-violet-600 border-violet-200 bg-violet-50">
                    {totalWorkers} Petugas{totalWithOutputs > 0 ? ` · ${totalWithOutputs} dengan output` : ''}
                  </Badge>
                </div>
                <p className="text-[11px] text-stone-400 mb-4">
                  Rangkuman penugasan petugas per tahap beserta kebutuhan output yang ditentukan manajer.
                </p>
                
                <div className="space-y-3">
                  {Array.from(tasksByStage.entries()).map(([stage, entries]) => {
                    const config = stageConfig[stage] || stageConfig[1]
                    return (
                      <div key={stage} className={`rounded-xl border ${config.border} overflow-hidden`}>
                        {/* Stage header */}
                        <div className={`px-4 py-2 ${config.bg} border-b ${config.border}`}>
                          <div className="flex items-center justify-between">
                            <span className={`text-[10px] font-bold uppercase tracking-wider ${config.color}`}>
                              {config.label}
                            </span>
                            <Badge variant="outline" className={`text-[9px] ${config.color} ${config.border} ${config.bg}`}>
                              {entries.length} petugas
                            </Badge>
                          </div>
                        </div>
                        
                        {/* Workers list */}
                        <div className="divide-y divide-stone-50">
                          {entries.map(({ task, userName, outputs, customOutput }) => (
                            <div key={task.id} className="flex items-start gap-3 px-4 py-2.5">
                              {/* Avatar */}
                              <div className={`w-7 h-7 rounded-full ${config.bg} ${config.color} flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5`}>
                                {userName.charAt(0).toUpperCase()}
                              </div>
                              
                              {/* Name + Role */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-semibold text-stone-800 truncate">{userName}</span>
                                  <span className="text-[9px] font-medium text-stone-400">
                                    {getRoleDisplayName(task.role)}
                                  </span>
                                  {task.status === 'completed' && (
                                    <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />
                                  )}
                                </div>
                                
                                {/* Output badges */}
                                {outputs.length > 0 ? (
                                  <div className="flex flex-wrap gap-1 mt-1.5">
                                    {outputs.map(output => {
                                      const displayOutput = output === 'Lainnya' && customOutput 
                                        ? `Lainnya (${customOutput})` 
                                        : output
                                      return (
                                        <Badge 
                                          key={output} 
                                          variant="secondary" 
                                          className={`text-[9px] font-medium ${config.bg} ${config.color} border ${config.border} pr-1.5`}
                                        >
                                          {displayOutput}
                                        </Badge>
                                      )
                                    })}
                                  </div>
                                ) : (
                                  <span className="text-[10px] text-stone-300 italic mt-1 block">
                                    Belum ada output ditentukan
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}
        </CardContent>
      </Card>

      {/* Dokumen Pendukung — hanya Administrator & Super Admin */}
      {effectiveIsAdministratorOrAdmin && (
        <Card className="overflow-hidden border-stone-200">
          {/* Header — visible to all */}
          {project.documents && project.documents.length > 0 && (
            <div className="px-6 py-4 bg-emerald-50/50 border-b border-emerald-100">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Paperclip className="w-5 h-5 text-emerald-600" />
                  <h3 className="text-sm font-bold text-emerald-900">Dokumen Pendukung</h3>
                  <Badge className="bg-emerald-100 text-emerald-700 text-xs border-emerald-200">
                    {project.documents.length} Dokumen
                  </Badge>
                </div>
                {/* Manager identity — visible to all */}
                <div className="flex items-center gap-2">
                  <Avatar className="h-6 w-6 border border-emerald-200">
                    <AvatarImage src={getUserDetails(project.managerId).avatar} />
                    <AvatarFallback className="text-[10px] bg-emerald-100 text-emerald-700">
                      {getUserDetails(project.managerId).name?.charAt(0) || 'M'}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-xs text-emerald-700 font-medium">
                    {getUserDetails(project.managerId).name || 'Manager'}
                  </span>
                </div>
              </div>
              <p className="text-[11px] text-emerald-600/70 mt-1.5 ml-8">
                Dokumen pendukung (surat permohonan, berkas pelengkap) — diunggah oleh Administrator.
              </p>
            </div>
          )}

          <CardContent className="p-4">
            {/* Upload area — Administrator & Super Admin only */}
            {effectiveIsAdministratorOrAdmin && (
              <div className="mb-4">
                <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-emerald-200 rounded-xl cursor-pointer hover:bg-emerald-50/50 hover:border-emerald-400 transition-all group">
                  <input
                    type="file"
                    className="hidden"
                    accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.bmp,.tiff,.webp"
                    multiple
                    onChange={handleDocUploadFromDetail}
                  />
                  <UploadCloud className="w-6 h-6 text-emerald-400 group-hover:text-emerald-600 transition-colors mb-1" />
                  <div className="text-xs font-medium text-emerald-600 group-hover:text-emerald-700">
                    {project.documents?.length > 0 ? 'Tambah Dokumen Lagi' : 'Unggah Dokumen Pendukung'}
                  </div>
                  <div className="text-[10px] text-emerald-400 mt-0.5">PDF, Word, Gambar</div>
                </label>
              </div>
            )}

            {/* Document list */}
            {project.documents && project.documents.length > 0 ? (
              <div className="space-y-2">
                {project.documents.map((doc) => (
                  <div key={doc.id} className="flex items-center gap-3 p-3 rounded-xl border border-stone-100 bg-white hover:bg-stone-50/50 transition-colors">
                    <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                      <File className="w-5 h-5 text-emerald-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-stone-800 truncate">{doc.name}</p>
                      <div className="flex items-center gap-2 text-[10px] text-stone-400 mt-0.5">
                        <span>{doc.size ? (doc.size < 1024 * 1024 ? (doc.size / 1024).toFixed(1) + ' KB' : (doc.size / (1024 * 1024)).toFixed(1) + ' MB') : ''}</span>
                        {doc.uploadedAt && (
                          <>
                            <span>•</span>
                            <span>{new Date(doc.uploadedAt).toLocaleString('id-ID')}</span>
                          </>
                        )}
                      </div>
                    </div>
                    {doc.webViewLink && (
                      <a
                        href={doc.downloadUrl || doc.webViewLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors shrink-0"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Lihat
                      </a>
                    )}
                    {/* Delete button — Administrator & Super Admin only */}
                    {effectiveIsAdministratorOrAdmin && (
                      <button
                        type="button"
                        onClick={() => handleDeleteDocument(doc.id)}
                        className="p-1.5 text-stone-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors shrink-0"
                        title="Hapus dokumen"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : effectiveIsAdministratorOrAdmin ? null : (
              <p className="text-sm text-stone-400 italic text-center py-4">Belum ada dokumen pendukung.</p>
            )}

            {/* Upload progress indicator */}
            {isUploadingDetailDoc && (
              <div className="mt-3 flex items-center gap-2 text-xs text-emerald-600 bg-emerald-50 p-2.5 rounded-lg">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Mengunggah dokumen...</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tasks */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-stone-800 px-2">
          {effectiveIsManagerOrAdmin ? 'Semua Tugas Proyek' : 'Tugas Anda'}
        </h3>
        {visibleTasks.map(task => {
          const isCurrentStage = project.isFastProduction ? true : task.stage === project.currentStage
          const config = ROLE_CONFIG[task.role]
          const Icon = config ? ICON_MAP[config.icon] : AlertCircle
          
          const isAssignedToMe = task.assignedTo === currentUser?.id
          // Super Admin (Admin role): can act on ANY task regardless of stage
          const isSuperAdmin = currentUser?.role === 'Admin'
          const canActOnTask = project.isFastProduction 
            ? (isAssignedToMe || canManageProject) 
            : (isCurrentStage || isSuperAdmin) && (isAssignedToMe || canManageProject)
          // Super Admin / Manager: can act as "my active task" on any pending task (override mode)
          const isMyActiveTask = project.isFastProduction 
            ? (isAssignedToMe || canManageProject) && task.status === 'pending'
            : (isCurrentStage || isSuperAdmin) && (isAssignedToMe || canManageProject) && task.status === 'pending'

          return (
            <TaskCard
              key={task.id}
              task={task}
              project={project}
              config={config}
              Icon={Icon}
              isCurrentStage={isCurrentStage}
              isAssignedToMe={isAssignedToMe}
              canActOnTask={canActOnTask}
              isMyActiveTask={isMyActiveTask}
              canManageProject={canManageProject}
              currentUser={currentUser}
              inputValue={currentTaskInputs[task.id] || ''}
              setInputValue={(v) => setTaskInputs(prev => ({ ...prev, [task.id]: v }))}
              isVerified={currentTaskVerified[task.id] || false}
              setIsVerified={(v) => setTaskVerified(prev => ({ ...prev, [task.id]: v }))}
              onComplete={handleTaskComplete}
              onReject={handleReviewReject}
              onRevision={(taskId) => {
                setRevisionTaskId(taskId)
                setTaskInputs(prev => ({ ...prev, [taskId]: '' }))
                setTaskPublishLinks(prev => ({ ...prev, [taskId]: [] }))
              }}
              onCancelRevision={() => setRevisionTaskId(null)}
              isRevising={revisionTaskId === task.id}
              visibleFolders={visibleFolders}
              publishLinks={currentTaskPublishLinks[task.id] || []}
              onAddPublishLink={() => addPublishLink(task.id)}
              onRemovePublishLink={(linkId) => removePublishLink(task.id, linkId)}
              onUpdatePublishLink={(linkId, field, value) => updatePublishLink(task.id, linkId, field, value)}
              onFileUploaded={(file) => {
                // Auto-fill link field with uploaded file link
                if (file.webViewLink) {
                  // For tasks needing single link
                  setTaskInputs(prev => ({ ...prev, [task.id]: file.webViewLink }))
                  // For publisher tasks, also add to publishLinks
                  if (config?.type === 'download_link') {
                    const newLink: PublishLink = {
                      id: `link-${Date.now()}`,
                      platform: 'other',
                      url: file.webViewLink
                    }
                    setTaskPublishLinks(prev => ({
                      ...prev,
                      [task.id]: [...(prev[task.id] || []), newLink]
                    }))
                  }
                }
              }}
            />
          )
        })}
      </div>

      {/* Edit Project Modal */}
      <Dialog open={isEditProjectModalOpen} onOpenChange={setIsEditProjectModalOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto mx-4 sm:mx-0 sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit Proyek ({getRoleDisplayName(currentUser?.role || '')} Control)</DialogTitle>
          </DialogHeader>
          {editProjectData && (
            <form onSubmit={handleSaveEditedProject} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <Label>Judul Proyek / Liputan</Label>
                  <Input
                    required
                    value={editProjectData.title}
                    onChange={e => setEditProjectData({...editProjectData, title: e.target.value})}
                    className="mt-1"
                  />
                </div>
                <div className="md:col-span-2">
                  <Label>Unit Pemohon</Label>
                  <Input
                    required
                    value={editProjectData.requesterUnit}
                    onChange={e => setEditProjectData({...editProjectData, requesterUnit: e.target.value})}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Tempat / Lokasi</Label>
                  <Input
                    required
                    value={editProjectData.location || ''}
                    onChange={e => setEditProjectData({...editProjectData, location: e.target.value})}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Waktu Pelaksanaan</Label>
                  <Input
                    required
                    type="datetime-local"
                    value={editProjectData.executionTime || ''}
                    onChange={e => setEditProjectData({...editProjectData, executionTime: e.target.value})}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Nama PIC</Label>
                  <Input
                    required
                    value={editProjectData.picName || ''}
                    onChange={e => setEditProjectData({...editProjectData, picName: e.target.value})}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>No. WhatsApp PIC</Label>
                  <Input
                    required
                    value={editProjectData.picWhatsApp || ''}
                    onChange={e => setEditProjectData({...editProjectData, picWhatsApp: e.target.value})}
                    className="mt-1"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setIsEditProjectModalOpen(false)}>
                  Batal
                </Button>
                <Button type="submit">Simpan Perubahan</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Reject Review Dialog — input alasan penolakan */}
      <Dialog open={isRejectDialogOpen} onOpenChange={setIsRejectDialogOpen}>
        <DialogContent className="max-w-lg mx-4 sm:mx-0">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertCircle className="w-5 h-5" />
              Tolak (Kembalikan ke Editor)
            </DialogTitle>
            <DialogDescription>
              Tugas akan dikembalikan ke tahap Pasca Produksi. Tuliskan alasan penolakan agar tim editor memahami apa yang perlu diperbaiki.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-sm font-bold text-stone-700 mb-2 block">
                Alasan Penolakan <span className="text-red-500">*</span>
              </Label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Contoh: Durasi video terlalu pendek, transisi kurang halus, mohon sesuaikan dengan brief..."
                className="w-full min-h-[120px] rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-800 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-300 resize-y"
                autoFocus
              />
              <p className="text-[10px] text-stone-400 mt-1">
                Alasan ini akan dikirim ke tim editor melalui notifikasi.
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => setIsRejectDialogOpen(false)}>
              Batal
            </Button>
            <Button
              type="button"
              onClick={handleConfirmReject}
              disabled={!rejectReason.trim()}
              className="bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <X className="w-4 h-4 mr-1" />
              Tolak & Kembalikan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Drive Modal */}
      <Dialog open={isEditDriveOpen} onOpenChange={setIsEditDriveOpen}>
        <DialogContent className="max-w-2xl w-[calc(100%-1rem)] sm:w-full max-h-[90dvh] flex flex-col overflow-hidden p-0 gap-0">
          <DialogHeader className="px-4 sm:px-6 pt-5 sm:pt-6 pb-3 flex-shrink-0">
            <DialogTitle className="text-base sm:text-lg">Manajemen Workspace Drive</DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              Kelola tautan folder dan akses upload/download per petugas untuk proyek ini.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveDriveLinks} className="flex flex-col flex-1 min-h-0">
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar px-4 sm:px-6">
              <div className="pb-4">
              {project.driveFolders.length === 0 ? (
                <div className="py-8 text-center">
                  <Folder className="w-10 h-10 text-amber-300 mx-auto mb-3" />
                  <p className="text-sm font-medium text-stone-600">Proyek ini belum memiliki folder workspace</p>
                  <p className="text-xs text-stone-400 mt-1">Folder biasanya dibuat otomatis saat pembuatan proyek. Jika folder tidak terbuat, pastikan Google Drive API sudah dikonfigurasi di Pengaturan, atau buat folder secara manual dan tambahkan link-nya.</p>
                </div>
              ) : (
              <>
              {project.driveFolders.map((folder) => {
                const folderAccess = folderUserAccess[folder.id] || []
                const teamMembers = Array.from(
                  new Map(
                    project.tasks
                      .filter(t => t.assignedTo)
                      .map(t => [t.assignedTo, t])
                  ).values()
                )
                const hasUsersWithAccess = teamMembers.some(t => {
                  const acc = folderAccess.find(u => u.userId === t.assignedTo)
                  return acc && (acc.download || acc.upload)
                })

                return (
                  <div key={folder.id} className="mb-4 p-3 sm:p-4 rounded-xl border border-stone-100 bg-stone-50/40">
                    {/* Folder header */}
                    <div className="flex items-center gap-2 mb-3">
                      <div className={cn("p-1.5 rounded-lg", folder.bg || 'bg-stone-100', folder.color || 'text-stone-600')}>
                        <Folder className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                      </div>
                      <span className="font-bold text-xs sm:text-sm text-stone-800 truncate" title={folder.name}>{folder.name}</span>
                    </div>

                    <Tabs defaultValue="link" className="w-full">
                      <TabsList className="mb-2 h-8">
                        <TabsTrigger value="link" className="text-[10px] sm:text-xs gap-1 px-2 sm:px-3 h-7">
                          <LinkIcon className="w-3 h-3" />
                          Link Folder
                        </TabsTrigger>
                        <TabsTrigger value="access" className="text-[10px] sm:text-xs gap-1 px-2 sm:px-3 h-7">
                          <Users className="w-3 h-3" />
                          Akses
                          {hasUsersWithAccess && (
                            <span className="ml-0.5 bg-emerald-500 text-white text-[9px] font-bold rounded-full w-4 h-4 inline-flex items-center justify-center">
                              {teamMembers.filter(t => {
                                const acc = folderAccess.find(u => u.userId === t.assignedTo)
                                return acc && (acc.download || acc.upload)
                              }).length}
                            </span>
                          )}
                        </TabsTrigger>
                      </TabsList>

                      {/* Tab: Link Folder */}
                      <TabsContent value="link" className="mt-0">
                        <Input
                          required
                          type="url"
                          value={driveForm[folder.id] || ''}
                          onChange={e => setDriveForm({...driveForm, [folder.id]: e.target.value})}
                          className={cn("text-xs sm:text-sm", folder.bg?.replace('50', '50/30'))}
                          placeholder="https://drive.google.com/drive/folders/..."
                        />
                      </TabsContent>

                      {/* Tab: Akses Petugas */}
                      <TabsContent value="access" className="mt-0">
                        {teamMembers.length === 0 ? (
                          <p className="text-xs text-stone-400 italic py-3 text-center">
                            Belum ada petugas yang ditugaskan pada proyek ini
                          </p>
                        ) : (
                          <div className="space-y-0 min-w-0">
                            {/* Table header */}
                            <div className="grid grid-cols-[1fr_36px_36px] sm:grid-cols-[1fr_44px_44px] gap-1 sm:gap-2 px-2 sm:px-3 py-1.5 text-[9px] sm:text-[10px] font-bold text-stone-400 uppercase tracking-wider border-b border-stone-100">
                              <span>Petugas</span>
                              <span className="text-center" title="Download">DL</span>
                              <span className="text-center" title="Upload">UL</span>
                            </div>
                            {/* Native scroll container — avoids Radix ScrollArea reserving
                                scrollbar width which clipped the UL (Upload) checkbox column. */}
                            <div className="max-h-36 sm:max-h-48 overflow-y-auto overflow-x-hidden pr-1 -mr-1 custom-scrollbar">
                              {teamMembers.map(task => {
                                const userId = task.assignedTo!
                                const userName = getUserDetails(userId).name
                                const userAccess = folderAccess.find(u => u.userId === userId)
                                const dl = userAccess?.download || false
                                const ul = userAccess?.upload || false

                                return (
                                  <div
                                    key={userId}
                                    className={cn(
                                      "grid grid-cols-[1fr_36px_36px] sm:grid-cols-[1fr_44px_44px] gap-1 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 items-center text-sm border-b border-stone-50 last:border-b-0 hover:bg-white/60 transition-colors min-w-0",
                                      (dl || ul) && "bg-emerald-50/30"
                                    )}
                                  >
                                    <span className="truncate text-[11px] sm:text-xs font-medium text-stone-700" title={userName}>
                                      {userName}
                                    </span>
                                    <div className="flex justify-center">
                                      <Checkbox
                                        checked={dl}
                                        onCheckedChange={() => toggleFolderUserAccess(folder.id, userId, userName, 'download')}
                                        className="data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-500"
                                      />
                                    </div>
                                    <div className="flex justify-center">
                                      <Checkbox
                                        checked={ul}
                                        onCheckedChange={() => toggleFolderUserAccess(folder.id, userId, userName, 'upload')}
                                        className="data-[state=checked]:bg-amber-500 data-[state=checked]:border-amber-500"
                                      />
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                            {!hasUsersWithAccess && (
                              <p className="text-[9px] sm:text-[10px] text-stone-400 italic text-center py-1.5 sm:py-2">
                                Belum ada petugas ditambahkan — centang DL/UL untuk memberi akses
                              </p>
                            )}
                          </div>
                        )}
                      </TabsContent>
                    </Tabs>
                  </div>
                )
              })}
              </>
              )}
              </div>
            </div>
            <DialogFooter className="flex-shrink-0 px-4 sm:px-6 py-3 sm:py-4 border-t border-stone-100 bg-white gap-2">
              <Button type="button" variant="ghost" onClick={() => setIsEditDriveOpen(false)} className="text-xs sm:text-sm">
                Batal
              </Button>
              <Button type="submit" className="gap-2 text-xs sm:text-sm">
                <Save className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                <span>Simpan Perubahan</span>
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Task Card Component
interface TaskCardProps {
  task: Task
  project: { id: string; title: string; currentStage: number; isFastProduction: boolean; executionTime?: string; driveFolders: DriveFolder[] }
  config: { stage: number; type: string; icon: string } | undefined
  Icon: React.ElementType
  isCurrentStage: boolean
  isAssignedToMe: boolean
  canActOnTask: boolean
  isMyActiveTask: boolean
  canManageProject: boolean
  currentUser: { id: string; name: string; role: string } | null
  inputValue: string
  setInputValue: (v: string) => void
  isVerified: boolean
  setIsVerified: (v: boolean) => void
  onComplete: (taskId: string, taskData: { link?: string; notes?: string; publishLinks?: PublishLink[] }) => void
  onReject: () => void
  onRevision: (taskId: string) => void
  onCancelRevision: () => void
  isRevising: boolean
  visibleFolders: DriveFolder[]
  publishLinks: PublishLink[]
  onAddPublishLink: () => void
  onRemovePublishLink: (linkId: string) => void
  onUpdatePublishLink: (linkId: string, field: 'platform' | 'url', value: string) => void
  onFileUploaded: (file: { name: string; webViewLink: string }) => void
}

function TaskCard({
  task, project, config, Icon, isCurrentStage, isAssignedToMe, canActOnTask,
  isMyActiveTask, canManageProject, currentUser, inputValue, setInputValue,
  isVerified, setIsVerified, onComplete, onReject, onRevision, onCancelRevision, isRevising,
  visibleFolders, publishLinks, onAddPublishLink, onRemovePublishLink, onUpdatePublishLink, onFileUploaded
}: TaskCardProps) {
  if (!config) return null

  const needsLink = ['paste_streaming', 'paste_youtube', 'download_link'].includes(config.type)
  const isReview = config.type === 'review'
  const isPublisherTask = config.type === 'download_link'
  // Super Admin / Manager: show both download AND upload sections for full override access
  const showDownloadSection = canManageProject || ['download_upload', 'download_link', 'review', 'paste_streaming', 'paste_youtube'].includes(config.type)
  const showUploadSection = canManageProject || ['upload', 'download_upload', 'review'].includes(config.type)
  
  // Akses folder sepenuhnya dikontrol oleh centang DL/UL dari Manager
  // Manager centang DL → user bisa download (buka) folder tersebut
  // Manager centang UL → user bisa upload ke folder tersebut
  // Tidak ada hardcode tahap — semua bergantung pada checkbox manager
  // Super Admin & Manager: akses penuh ke SEMUA folder (Mode Override / Bypass Tahap)
  // — tidak perlu centang DL/UL untuk diri sendiri

  // Shared helper: apakah folder ini adalah subfolder (bukan parent folder utama)
  const isSub = (f: DriveFolder) => {
    if (f.parentFolderId) return true
    if (['raw', 'revised', 'final', 'desain', 'lainnya'].includes(f.folderId)) return false
    if (f.folderId.includes('-') && ['raw', 'revised', 'final', 'desain', 'lainnya'].some(b => f.folderId.startsWith(b + '-'))) return true
    if (/^[A-Z]{2}_/.test(f.name)) return true
    return false
  }

  // Helper: format folder label for display. For output subfolders (Foto/, Video/),
  // append the worker's name so users can distinguish multiple output folders.
  // e.g. "Foto" → "Foto — Haitami"
  const formatFolderLabel = (f: DriveFolder): string => {
    const baseName = f.name.split(' (')[0]
    if (isOutputSubfolder(f)) {
      const workerName = f.assignedUsers?.[0]?.userName
      if (workerName) {
        // Use just the first name for brevity in button labels
        const firstName = workerName.split(' ')[0]
        return `${baseName} — ${firstName}`
      }
    }
    return baseName
  }

  // Shared helper: check if folder is a user-named subfolder (contains a user assignment)
  const isUserSubfolder = (f: DriveFolder) => {
    if (!f.parentFolderId) return false
    // User subfolders have a parentFolderId that matches a top-level folder (raw, revised, etc.)
    // and their folderId does NOT contain '-output-'
    return !f.folderId.includes('-output-')
  }

  // Shared helper: check if folder is an output-type subfolder inside a user subfolder
  const isOutputSubfolder = (f: DriveFolder) => {
    return f.parentFolderId && f.folderId.includes('-output-')
  }

  // Download: tampilkan PARENT FOLDER yang manager centang DL untuk user ini
  // Serta OUTPUT SUBFOLDERS (Foto/, Video/) dari folder parent yang user punya akses DL,
  // agar petugas tahap berikutnya bisa langsung membuka folder output yang dibutuhkan.
  // Super Admin & Manager: akses penuh ke semua parent folder (Mode Override)
  const getDownloadFolders = () => {
    const myId = currentUser?.id || ''

    // Super Admin / Manager override — full access to all parent folders + output subfolders
    if (canManageProject) {
      return visibleFolders.filter(f => !isUserSubfolder(f))
    }

    // 1. Parent folders where manager centang DL for this user
    const myParentFolders = visibleFolders.filter(f => {
      if (isSub(f)) return false
      return f.assignedUsers?.some((au: any) => au.userId === myId && au.download) || false
    })

    // 2. Output subfolders (Foto/, Video/) inside parent folders where user has DL
    //    This lets Tahap 2 editors directly open a worker's Foto/ folder without
    //    navigating through the HS_ user subfolder in Google Drive.
    const myParentFolderIds = new Set(myParentFolders.map(f => f.folderId))
    const accessibleOutputSubs = visibleFolders.filter(f => {
      if (!isOutputSubfolder(f)) return false
      // The output subfolder's parent is a user subfolder (HS_...).
      // Find the top-level parent (raw/revised/etc.) that the user subfolder belongs to.
      const userSub = visibleFolders.find(us => us.folderId === f.parentFolderId)
      const topLevelParentId = userSub?.parentFolderId
      if (topLevelParentId && myParentFolderIds.has(topLevelParentId)) {
        return true
      }
      // Fallback: check by folderId prefix (legacy)
      const parentType = ['raw', 'revised', 'final', 'desain', 'lainnya'].find(t => f.folderId.startsWith(t + '-'))
      return parentType && myParentFolderIds.has(parentType)
    })

    return [...myParentFolders, ...accessibleOutputSubs]
  }

  // Upload: tampilkan OUTPUT SUBFOLDERS milik user (Foto/, Video/, dll.)
  // Jika tidak ada output subfolder, tampilkan user subfolder
  // Jika tidak ada user subfolder, fallback ke parent folder yang manager centang UL
  // Super Admin & Manager: akses penuh ke semua parent folder (Mode Override)
  const getUploadFolders = () => {
    const myUserId = currentUser?.id || ''

    // Super Admin / Manager override — full access to all parent folders as upload destinations
    if (canManageProject) {
      return visibleFolders.filter(f => !isSub(f))
    }

    // 1. Cari output subfolders (Foto/, Video/, dll.) milik user ini
    const myOutputSubs = visibleFolders.filter(f => {
      if (!isOutputSubfolder(f)) return false
      // Match by assignedUsers userId with upload
      if (f.assignedUsers?.some((au: any) => au.userId === myUserId && au.upload)) return true
      return false
    })

    // If we have output subfolders, use those as upload destinations
    // This ensures workers upload to the correct output-type folder
    if (myOutputSubs.length > 0) {
      return myOutputSubs
    }

    // 2. Cari user-named subfolder milik user ini (fallback jika tidak ada output subfolders)
    const mySubfolders = visibleFolders.filter(f => {
      if (!isUserSubfolder(f)) return false
      // Match by assignedUsers userId with upload
      if (f.assignedUsers?.some((au: any) => au.userId === myUserId && au.upload)) return true
      return false
    })

    if (mySubfolders.length > 0) {
      return mySubfolders
    }

    // 3. Fallback: HANYA parent folder yang manager centang UL untuk user ini
    return visibleFolders.filter(f => {
      if (isSub(f)) return false
      // Hanya centang UL dari manager yang menentukan
      return f.assignedUsers?.some((au: any) => au.userId === myUserId && au.upload) || false
    })
  }

  const handleComplete = () => {
    if (isPublisherTask) {
      // For publisher tasks, send publishLinks array
      onComplete(task.id, { publishLinks })
    } else {
      // For other tasks, send single link
      onComplete(task.id, { link: inputValue })
    }
  }

  const isValid = () => {
    if (isPublisherTask) {
      return publishLinks.length > 0 && publishLinks.every(l => l.url.trim() !== '')
    }
    if (needsLink) {
      return inputValue.trim() !== ''
    }
    return true
  }

  return (
    <Card className={cn(
      "transition-all relative overflow-hidden",
      isMyActiveTask 
        ? "border-2 border-indigo-500 shadow-xl ring-4 ring-indigo-50/50" 
        : canActOnTask && task.status === 'pending' 
          ? "border-indigo-300 shadow-md ring-1 ring-indigo-50" 
          : "border-stone-200 opacity-80"
    )}>
      {isMyActiveTask && (
        <div className="absolute top-0 right-0 bg-indigo-600 text-white text-[10px] font-bold px-4 py-1.5 rounded-bl-xl uppercase tracking-wider shadow-sm">
          Tugas Anda Saat Ini
        </div>
      )}

      <CardContent className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={cn(
              "p-3 rounded-2xl",
              isCurrentStage ? "bg-indigo-100 text-indigo-600" : "bg-stone-100 text-stone-500"
            )}>
              <Icon className="w-6 h-6" />
            </div>
            <div>
              <h4 className="font-bold text-stone-800 text-lg flex items-center gap-2">
                {task.role}
                {task.data?.fastTracked && (
                  <Badge className="bg-purple-100 text-purple-600 border-purple-200 text-[9px] px-1.5 py-0">
                    <SkipForward className="h-2.5 w-2.5 mr-0.5" />FAST TRACK
                  </Badge>
                )}
                {task.data?.autoApproved && (
                  <Badge className="bg-teal-100 text-teal-600 border-teal-200 text-[9px] px-1.5 py-0">
                    <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />AUTO-APPROVE
                  </Badge>
                )}
              </h4>
              <div className="text-xs font-medium text-stone-500 mt-0.5">
                Tahap {task.stage}: {STAGES[task.stage]}
              </div>
              {task.data?.fastTracked && (
                <div className="flex items-center gap-1 text-[10px] text-purple-500 mt-1">
                  <Zap className="h-3 w-3" />
                  <span>Dilewati (Fast Track) — tugas otomatis selesai</span>
                </div>
              )}
              {task.data?.autoApproved && (
                <div className="flex items-center gap-1 text-[10px] text-teal-500 mt-1">
                  <CheckCircle2 className="h-3 w-3" />
                  <span>Auto-Approve — review otomatis disetujui (Fast Production)</span>
                </div>
              )}
              {canManageProject && !isAssignedToMe && task.status === 'pending' && (
                <div className="flex items-center gap-1 text-[10px] text-red-500 mt-1.5 font-bold uppercase tracking-wider bg-red-50 px-2 py-0.5 rounded-md">
                  <ShieldAlert className="w-3 h-3" />
                  <span>Mode Override {getRoleDisplayName(currentUser?.role || '')}{!isCurrentStage ? ' (Bypass Tahap)' : ''}</span>
                </div>
              )}
            </div>
          </div>
          <Badge
            variant={task.status === 'completed' ? 'default' : 'outline'}
            className={cn(
              "text-xs font-bold uppercase tracking-wider",
              task.status === 'completed' 
                ? "bg-green-100 text-green-700 border-green-200" 
                : isCurrentStage 
                  ? "bg-orange-100 text-orange-700 border-orange-200" 
                  : "bg-stone-100 text-stone-500 border-stone-200"
            )}
          >
            {task.status === 'completed' ? (
              <span className="flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Selesai</span>
            ) : (
              isCurrentStage ? 'Menunggu Aksi' : 'Terkunci'
            )}
          </Badge>
        </div>

        {(canActOnTask || task.status === 'completed' || isRevising) && (
          <div className="mt-6 pt-6 border-t border-stone-100">
            {task.status === 'completed' && !isRevising ? (
              <div className="bg-stone-50 p-4 rounded-xl text-sm text-stone-700 border border-stone-200">
                <strong className="block mb-1.5 text-stone-900 text-xs uppercase tracking-wider">
                  Bukti / Link Hasil Kerja:
                </strong>
                
                {/* Show publish links if available */}
                {task.data?.publishLinks && task.data.publishLinks.length > 0 ? (
                  <div className="space-y-2">
                    {task.data.publishLinks.map((pl, idx) => (
                      <div key={pl.id || idx} className="flex items-center gap-2 bg-white p-2 rounded-lg border border-stone-100">
                        <span className="text-lg" title={PUBLISH_PLATFORMS.find(p => p.id === pl.platform)?.label}>
                          {PUBLISH_PLATFORMS.find(p => p.id === pl.platform)?.icon || '🔗'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <span className="text-[10px] font-bold text-stone-500 uppercase">
                            {PUBLISH_PLATFORMS.find(p => p.id === pl.platform)?.label || pl.platform}
                          </span>
                          <a
                            href={pl.url}
                            target="_blank"
                            rel="noreferrer"
                            className="block text-indigo-600 hover:text-indigo-800 hover:underline break-all text-sm"
                          >
                            {pl.url}
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : task.data?.link ? (
                  <a
                    href={task.data.link}
                    target="_blank"
                    rel="noreferrer"
                    className="text-indigo-600 hover:text-indigo-800 hover:underline break-all font-medium flex items-center gap-2"
                  >
                    <LinkIcon className="w-4 h-4" />
                    <span>{task.data.link}</span>
                  </a>
                ) : (
                  <span className="text-stone-500 italic">
                    Diselesaikan tanpa tautan spesifik (Telah diunggah ke Drive / Diteruskan).
                  </span>
                )}
                {task.data?.notes && (
                  <p className="mt-2 text-stone-600 text-xs bg-white p-2 rounded-md border border-stone-100">
                    Catatan: {task.data.notes}
                  </p>
                )}
                {/* Revisi button for Fast Production projects */}
                {project.isFastProduction && isAssignedToMe && !isRevising && (
                  <div className="mt-3 flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onRevision(task.id)}
                      className="gap-1.5 text-teal-700 border-teal-300 hover:bg-teal-50 hover:border-teal-400"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Revisi</span>
                    </Button>
                    {task.revisionCount && task.revisionCount > 0 && (
                      <Badge className="bg-amber-100 text-amber-700 text-[9px] border-amber-200 border">
                        Revisi {task.revisionCount}x
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <>
                {/* Download Section */}
                {showDownloadSection && (
                  <div className="mb-4 bg-indigo-50/50 p-5 rounded-2xl border border-indigo-100">
                    <div className="flex items-center gap-2 mb-3">
                      <Download className="w-5 h-5 text-indigo-600" />
                      <h5 className="text-sm font-bold text-stone-800">Unduh Berkas (Download)</h5>
                    </div>
                    <p className="text-xs text-stone-600 mb-4 leading-relaxed">
                      {"Akses folder di bawah ini untuk mengambil/mengunduh berkas yang tersedia untuk Anda sesuai izin dari Manager."}
                    </p>
                    <div className="flex flex-wrap gap-3">
                      {getDownloadFolders().length === 0 ? (
                        <span className="text-xs text-red-500 font-medium italic">
                          Anda tidak memiliki akses ke folder yang sesuai untuk tahapan ini.
                        </span>
                      ) : (
                        getDownloadFolders().map(folder => (
                          <Button
                            key={`dl-${folder.id}`}
                            variant="outline"
                            asChild
                            className="gap-2"
                          >
                            <a href={folder.link} target="_blank" rel="noreferrer">
                              <Folder className="w-4 h-4" />
                              <span>Buka {formatFolderLabel(folder)}</span>
                            </a>
                          </Button>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {/* Upload Section */}
                {showUploadSection && (
                  <div className="mb-4 bg-stone-50 p-5 rounded-2xl border border-stone-200">
                    <div className="flex items-center gap-2 mb-3">
                      <UploadCloud className="w-5 h-5 text-indigo-600" />
                      <h5 className="text-sm font-bold text-stone-800">Unggah Hasil Kerja</h5>
                    </div>
                    <p className="text-xs text-stone-600 mb-4 leading-relaxed">
                      {isReview
                        ? "Jika ada revisi yang Anda lakukan sendiri, silakan unggah file langsung dari komputer Anda."
                        : "Unggah hasil pekerjaan Anda langsung dari komputer. File akan otomatis tersimpan di Google Drive."}
                    </p>
                    
                    {getUploadFolders().length === 0 ? (
                      <span className="text-xs text-red-500 font-medium italic">
                        Anda tidak memiliki akses ke folder yang sesuai untuk tahapan ini.
                      </span>
                    ) : (
                      <div className="space-y-4">
                        {/* Direct File Upload */}
                        {getUploadFolders().map(folder => (
                          <div key={`upload-${folder.id}`} className="bg-white p-4 rounded-xl border border-stone-200">
                            <div className="flex items-center justify-between mb-3">
                              <span className="text-sm font-semibold text-stone-700">
                                📁 {formatFolderLabel(folder)}
                              </span>
                              <a
                                href={folder.link}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1"
                              >
                                <Folder className="w-3 h-3" />
                                Buka di Drive
                              </a>
                            </div>
                            <FileUpload
                              folderLink={folder.link || ''}
                              projectId={project.id}
                              projectTitle={project.title}
                              executionTime={project.executionTime}
                              uploaderName={currentUser?.name}
                              onUploadComplete={(file) => {
                                console.log('[UPLOAD] File uploaded:', file.name)
                                // Auto-fill link field with uploaded file link
                                if (file.webViewLink) {
                                  onFileUploaded(file)
                                }
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Publisher Multiple Links Section */}
                {isPublisherTask && (
                  <div className="mb-4 bg-gradient-to-br from-green-50 to-emerald-50 p-5 rounded-2xl border border-green-200">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Globe className="w-5 h-5 text-green-600" />
                        <h5 className="text-sm font-bold text-stone-800">Pelaporan Tautan Hasil Publish</h5>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={onAddPublishLink}
                        className="gap-1 text-green-700 border-green-300 hover:bg-green-100"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Tambah Link</span>
                      </Button>
                    </div>
                    <p className="text-xs text-stone-600 mb-4 leading-relaxed">
                      Tambahkan semua tautan hasil publikasi. Pilih platform dan tempelkan URL untuk setiap tautan.
                    </p>

                    <div className="space-y-3">
                      {publishLinks.length === 0 ? (
                        <div className="text-center py-6 text-stone-500 bg-white/50 rounded-xl border border-dashed border-green-300">
                          <Globe className="w-8 h-8 mx-auto mb-2 opacity-50" />
                          <p className="text-sm">Belum ada tautan ditambahkan</p>
                          <p className="text-xs">Klik tombol "Tambah Link" di atas untuk menambahkan tautan hasil publish</p>
                        </div>
                      ) : (
                        publishLinks.map((link, index) => (
                          <div key={link.id} className="bg-white p-4 rounded-xl border border-stone-200 shadow-sm">
                            <div className="flex items-center justify-between mb-3">
                              <span className="text-xs font-bold text-stone-500 uppercase tracking-wider">
                                Tautan #{index + 1}
                              </span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => onRemovePublishLink(link.id)}
                                className="h-7 w-7 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                              >
                                <X className="w-4 h-4" />
                              </Button>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                              <div className="md:col-span-1">
                                <Label className="text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1 block">
                                  Platform
                                </Label>
                                <Select
                                  value={link.platform}
                                  onValueChange={(v) => onUpdatePublishLink(link.id, 'platform', v)}
                                >
                                  <SelectTrigger className="bg-stone-50">
                                    <SelectValue placeholder="Pilih Platform" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {PUBLISH_PLATFORMS.map(platform => (
                                      <SelectItem key={platform.id} value={platform.id}>
                                        <span className="flex items-center gap-2">
                                          <span>{platform.icon}</span>
                                          <span>{platform.label}</span>
                                        </span>
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="md:col-span-3">
                                <Label className="text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1 block">
                                  URL Tautan
                                </Label>
                                <Input
                                  type="url"
                                  value={link.url}
                                  onChange={(e) => onUpdatePublishLink(link.id, 'url', e.target.value)}
                                  placeholder="https://..."
                                  className="bg-stone-50"
                                />
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {/* Single Link Input Section (non-publisher) */}
                {needsLink && !isPublisherTask && (
                  <div className="mb-4 bg-stone-50 p-5 rounded-2xl border border-stone-200">
                    <div className="flex items-center gap-2 mb-3">
                      <LinkIcon className="w-5 h-5 text-indigo-600" />
                      <h5 className="text-sm font-bold text-stone-800">
                        {config.type === 'paste_streaming' 
                          ? 'Pelaporan Tautan Live Streaming' 
                          : config.type === 'paste_youtube' 
                            ? 'Pelaporan Tautan YouTube/Podcast' 
                            : 'Pelaporan Tautan Hasil Publish'}
                      </h5>
                    </div>
                    <p className="text-xs text-stone-600 mb-4 leading-relaxed">
                      Tempelkan tautan (URL) hasil akhir di bawah ini. Tautan wajib diisi sebagai bukti penyelesaian tugas.
                    </p>
                    <Label className="text-xs font-bold text-stone-500 uppercase tracking-wider mb-2">
                      Tautan URL (Wajib)
                    </Label>
                    <Input
                      type="url"
                      value={inputValue}
                      onChange={e => setInputValue(e.target.value)}
                      placeholder="https://..."
                      className="mt-1"
                    />
                  </div>
                )}

                {/* Review Section */}
                {isReview && (
                  <div className="p-5 bg-orange-50 border border-orange-200 rounded-2xl text-sm text-orange-800 mb-4">
                    <h5 className="font-bold mb-2 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4" />
                      <span>Tindakan Quality Control (QC)</span>
                    </h5>
                    Periksa hasil kerja tim editor di folder Drive yang telah disediakan. Jika sudah sesuai, klik tombol 
                    <strong> "Teruskan File (Approve)"</strong> di bawah agar file lolos ke tahap Finalization (pembuatan template media sosial). 
                    Jika belum, Anda dapat mengklik <strong>"Tolak (Revisi)"</strong>.
                  </div>
                )}
              </>
            )}

            {/* Action Buttons */}
            {(task.status === 'pending' || isRevising) && (
              <div className={cn(
                "flex flex-col sm:flex-row items-start sm:items-center justify-between p-5 rounded-2xl border",
                isRevising 
                  ? "bg-teal-50/50 border-teal-200"
                  : !isAssignedToMe ? "bg-red-50/50 border-red-200" : "bg-indigo-50/50 border-indigo-200"
              )}>
                {isRevising ? (
                  <>
                    <label className="flex items-center gap-3 cursor-pointer mb-4 sm:mb-0 group">
                      <Checkbox
                        checked={isVerified}
                        onCheckedChange={(checked) => setIsVerified(!!checked)}
                      />
                      <div className="flex flex-col">
                        <span className={cn(
                          "text-sm font-bold transition-colors",
                          isVerified ? "text-teal-800" : "text-stone-700 group-hover:text-teal-600"
                        )}>
                          Verifikasi Revisi
                        </span>
                        <span className="text-[10px] text-stone-500 font-medium">
                          Saya menyatakan hasil revisi telah selesai.
                        </span>
                      </div>
                    </label>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setInputValue(task.data?.link || '')
                          onCancelRevision()
                        }}
                        className="border-stone-300 text-stone-600 hover:bg-stone-50"
                      >
                        Batal
                      </Button>
                      <Button
                        disabled={!isVerified || !isValid()}
                        onClick={handleComplete}
                        className={cn(
                          "gap-2",
                          isVerified && isValid()
                            ? "bg-teal-600 hover:bg-teal-700 ring-2 ring-teal-200 ring-offset-2"
                            : "bg-stone-200 text-stone-400 cursor-not-allowed shadow-none"
                        )}
                      >
                        <RotateCcw className="w-4 h-4" />
                        <span>Kirim Revisi</span>
                      </Button>
                    </div>
                  </>
                ) : !isReview ? (
                  <>
                    <label className="flex items-center gap-3 cursor-pointer mb-4 sm:mb-0 group">
                      <Checkbox
                        checked={isVerified}
                        onCheckedChange={(checked) => setIsVerified(!!checked)}
                      />
                      <div className="flex flex-col">
                        <span className={cn(
                          "text-sm font-bold transition-colors",
                          isVerified ? "text-indigo-800" : "text-stone-700 group-hover:text-indigo-600"
                        )}>
                          {canManageProject && !isAssignedToMe 
                            ? 'Peringatan: Paksa Selesaikan (Override)' 
                            : "Verifikasi Serah Terima"}
                        </span>
                        <span className="text-[10px] text-stone-500 font-medium">
                          Saya menyatakan tugas ini telah selesai.
                        </span>
                      </div>
                    </label>
                    <Button
                      disabled={!isVerified || !isValid()}
                      onClick={handleComplete}
                      className={cn(
                        "gap-2",
                        isVerified && isValid()
                          ? canManageProject && !isAssignedToMe
                            ? "bg-red-600 hover:bg-red-700 ring-2 ring-red-200 ring-offset-2"
                            : "bg-indigo-600 hover:bg-indigo-700 ring-2 ring-indigo-200 ring-offset-2"
                          : "bg-stone-200 text-stone-400 cursor-not-allowed shadow-none"
                      )}
                    >
                      <span>{canManageProject && !isAssignedToMe ? 'Force Complete' : 'Selesaikan & Serahkan'}</span>
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </>
                ) : (
                  <div className="flex w-full justify-end gap-4">
                    <Button
                      variant="outline"
                      onClick={onReject}
                      className="border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300"
                    >
                      Tolak (Revisi)
                    </Button>
                    <Button
                      onClick={() => onComplete(task.id, { notes: 'File diteruskan tanpa perubahan (Approved)' })}
                      className="bg-green-600 hover:bg-green-700 ring-2 ring-green-200 ring-offset-2"
                    >
                      Teruskan File (Approve)
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
