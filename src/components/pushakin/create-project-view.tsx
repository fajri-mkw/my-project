'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { useAppStore, ROLES, ROLE_CONFIG, FOLDER_OPTIONS, STAGES, getRoleDisplayName } from '@/lib/store'
import { 
  Rocket, 
  Users, 
  Folder, 
  Loader2,
  FileText,
  Upload,
  X,
  File,
  Paperclip,
  ExternalLink,
  Zap,
  AlertTriangle,
  SkipForward
} from 'lucide-react'
import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'

const OPSI_KEGIATAN = ['Peliputan', 'Pemberitaan', 'Live Streaming', 'Podcast', 'Desain', 'Lainnya']
const OPSI_OUTPUT = ['Teks', 'Foto', 'Video', 'Audio', 'Streaming', 'Desain', 'Podcast', 'Lainnya']

export function CreateProjectView() {
  const { currentUser, users, showAlert, setActiveView, addProject, addNotification, addSuratTugas, isCreatingProject, setIsCreatingProject, preFillFromSurat, setPreFillFromSurat, preFillFromPermohonan, setPreFillFromPermohonan } = useAppStore()
  
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [unit, setUnit] = useState('')
  const [tempat, setTempat] = useState('')
  const [waktu, setWaktu] = useState('')
  const [picName, setPicName] = useState('')
  const [picWhatsApp, setPicWhatsApp] = useState('')
  const [selectedRoles, setSelectedRoles] = useState<Record<string, boolean>>({})
  const [selectedFolders, setSelectedFolders] = useState(['raw', 'revised', 'final'])
  const [folderRoles, setFolderRoles] = useState<Record<string, string[]>>({})
  const [jenisKegiatan, setJenisKegiatan] = useState<string[]>([])
  const [kebutuhanOutput, setKebutuhanOutput] = useState<string[]>([])
  const [kegiatanLainnya, setKegiatanLainnya] = useState('')
  const [outputLainnya, setOutputLainnya] = useState('')
  const [driveAutoCreate, setDriveAutoCreate] = useState(false)
  const [driveCreatingStatus, setDriveCreatingStatus] = useState<string | null>(null)
  const [isFastTrack, setIsFastTrack] = useState(false)

  // Track source for post-creation linking
  const [preFillSource, setPreFillSource] = useState<{ type: 'surat' | 'permohonan'; id: string } | null>(null)

  // Pre-fill form from surat when redirected from inbox
  useEffect(() => {
    if (preFillFromSurat) {
      setTitle(preFillFromSurat.perihal || '')
      setDesc(preFillFromSurat.deskripsi || '')
      setUnit(preFillFromSurat.pengirim || '')
      // Use executionTime if available (from permohonan produksi detail), fallback to tanggalSurat
      setWaktu(preFillFromSurat.executionTime || preFillFromSurat.tanggalSurat || '')
      // Pre-fill permohonan produksi fields from surat
      setTempat(preFillFromSurat.location || '')
      setPicName(preFillFromSurat.picName || '')
      setPicWhatsApp(preFillFromSurat.picWhatsApp || '')
      setPreFillSource({ type: 'surat', id: preFillFromSurat.id })
      // Clear the pre-fill reference so it doesn't re-trigger
      setPreFillFromSurat(null)
    }
  }, [preFillFromSurat, setPreFillFromSurat])

  // Pre-fill form from permohonan when redirected from inbox/permohonan list
  useEffect(() => {
    if (preFillFromPermohonan) {
      setTitle(preFillFromPermohonan.title || '')
      setDesc(preFillFromPermohonan.description || '')
      setUnit(preFillFromPermohonan.requesterUnit || '')
      // Use executionTime from permohonan
      setWaktu(preFillFromPermohonan.executionTime || '')
      setTempat(preFillFromPermohonan.location || '')
      setPicName(preFillFromPermohonan.picName || '')
      setPicWhatsApp(preFillFromPermohonan.picWhatsApp || '')
      setPreFillSource({ type: 'permohonan', id: preFillFromPermohonan.id })
      // Pre-fill activity types
      if (preFillFromPermohonan.activityTypes && preFillFromPermohonan.activityTypes.length > 0) {
        setJenisKegiatan(preFillFromPermohonan.activityTypes)
      }
      // Pre-fill output needs
      if (preFillFromPermohonan.outputNeeds && preFillFromPermohonan.outputNeeds.length > 0) {
        setKebutuhanOutput(preFillFromPermohonan.outputNeeds)
      }
      // Clear the pre-fill reference
      setPreFillFromPermohonan(null)
    }
  }, [preFillFromPermohonan, setPreFillFromPermohonan])

  // Supporting documents state
  const [supportDocs, setSupportDocs] = useState<Array<{
    id: string
    name: string
    mimeType: string
    size: number
    driveFileId: string
    webViewLink: string
    uploadedAt: string
    file?: File
    uploading?: boolean
  }>>([])
  const [isUploadingDoc, setIsUploadingDoc] = useState(false)

  // Handle supporting document upload (before project creation)
  const handleDocSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    const newDocs = Array.from(files).map(file => ({
      id: `LOCAL-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: file.name,
      mimeType: file.type,
      size: file.size,
      driveFileId: '',
      webViewLink: '',
      uploadedAt: new Date().toISOString(),
      file,
      uploading: false,
    }))

    setSupportDocs(prev => [...prev, ...newDocs])
    e.target.value = '' // Reset input so same file can be selected again
  }

  const removeDoc = (docId: string) => {
    setSupportDocs(prev => prev.filter(d => d.id !== docId))
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  // Upload docs to Drive after project is created
  const uploadDocsToProject = async (projectId: string) => {
    if (supportDocs.length === 0) return

    const docsToUpload = supportDocs.filter(d => d.file)
    if (docsToUpload.length === 0) return

    for (const doc of docsToUpload) {
      setSupportDocs(prev => prev.map(d => d.id === doc.id ? { ...d, uploading: true } : d))

      try {
        const formData = new FormData()
        formData.append('file', doc.file!)
        formData.append('projectId', projectId)
        formData.append('label', 'Dokumen Pendukung')

        const res = await fetch('/api/projects/upload-document', {
          method: 'POST',
          body: formData,
        })

        if (res.ok) {
          const data = await res.json()
          if (data.success) {
            setSupportDocs(prev => prev.map(d =>
              d.id === doc.id
                ? { ...d, driveFileId: data.document.driveFileId, webViewLink: data.document.webViewLink, uploading: false }
                : d
            ))
          }
        }
      } catch (err) {
        console.error('[DOC UPLOAD] Failed:', err)
        setSupportDocs(prev => prev.map(d => d.id === doc.id ? { ...d, uploading: false } : d))
      }
    }
  }

  const toggleItem = (setter: typeof setJenisKegiatan, currentItems: string[], item: string) => {
    if (currentItems.includes(item)) {
      setter(currentItems.filter(i => i !== item))
    } else {
      setter([...currentItems, item])
    }
  }

  const toggleFolder = (folderId: string) => {
    if (selectedFolders.includes(folderId)) {
      setSelectedFolders(selectedFolders.filter(id => id !== folderId))
    } else {
      setSelectedFolders([...selectedFolders, folderId])
    }
  }

  const toggleRoleForFolder = (folderId: string, role: string) => {
    setFolderRoles(prev => {
      const currentRoles = prev[folderId] || []
      if (currentRoles.includes(role)) {
        return { ...prev, [folderId]: currentRoles.filter(r => r !== role) }
      } else {
        return { ...prev, [folderId]: [...currentRoles, role] }
      }
    })
  }

  // Fetch Drive settings on mount
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await fetch('/api/settings')
        if (response.ok) {
          const data = await response.json()
          setDriveAutoCreate(data.driveAutoCreate)
        }
      } catch (error) {
        console.error('Failed to fetch settings:', error)
      }
    }
    fetchSettings()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const rolesToAssign = Object.keys(selectedRoles).filter(k => selectedRoles[k])
    // Fast Track: only Publisher roles are required
    if (isFastTrack) {
      const hasPublisher = rolesToAssign.some(r => r === 'PublisherWeb' || r === 'PublisherSocialMedia')
      if (!hasPublisher) {
        showAlert('Fast Track: Pilih minimal satu Publisher (Web atau Social Media).')
        return
      }
    } else if (rolesToAssign.length === 0) {
      showAlert('Pilih minimal satu peran/petugas untuk proyek ini.')
      return
    }

    setIsCreatingProject(true)

    try {
      const tasks = rolesToAssign.map(role => {
        const config = ROLE_CONFIG[role]
        const assignedUser = users.find(u => u.role === role)
        return {
          role,
          stage: config?.stage || 1,
          assignedTo: assignedUser?.id || ''
        }
      })

      // Generate folder data - either real or mock
      let generatedFolders: Array<{
        folderId: string
        name: string
        desc: string
        color: string
        bg: string
        border: string
        link: string
        assignedRoles: string[]
        assignedUsers?: { userId: string; userName: string; download: boolean; upload: boolean }[]
        parentFolderId?: string
      }> = []

      if (driveAutoCreate) {
        // Try to create real Google Drive folders
        setDriveCreatingStatus('Membuat folder di Google Drive...')
        try {
          // Prepare assignedUsers for ALL stages subfolder creation
          const assignedUsersData = tasks.map(t => {
            const user = users.find(u => u.id === t.assignedTo)
            return {
              role: t.role,
              userName: user?.name || 'Unknown',
              userId: t.assignedTo,
              stage: t.stage
            }
          }).filter(u => u.userId) // Only include if user is assigned

          // Filter folderUserAccess: only include users whose role is in folderRoles for each folder
          const filteredFolderUserAccess: Record<string, Record<string, {download: boolean; upload: boolean}>> = {}
          Object.keys(folderUserAccess).forEach(fId => {
            const allowedRoles = folderRoles[fId] || []
            filteredFolderUserAccess[fId] = {}
            Object.entries(folderUserAccess[fId]).forEach(([userId, access]) => {
              const user = users.find(u => u.id === userId)
              if (user && allowedRoles.includes(user.role)) {
                filteredFolderUserAccess[fId][userId] = access
              }
            })
          })

          const driveResponse = await fetch('/api/drive', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectTitle: title,
              folderTypes: selectedFolders,
              assignedUsers: assignedUsersData,
              folderUserAccess: filteredFolderUserAccess
            })
          })
          
          if (driveResponse.ok) {
            const driveData = await driveResponse.json()
            if (driveData.success) {
              // Map real Google Drive folders
              generatedFolders = driveData.folders.map((f: { folderId: string; name: string; webViewLink: string }) => {
                const optionInfo = FOLDER_OPTIONS.find(opt => opt.id === f.folderId)
                const assignedToFolder = (folderRoles[f.folderId] || []).filter((r: string) => rolesToAssign.includes(r))
                // Check if this is a subfolder (folderId contains dashes like 'raw-reporter-userId')
                const isSub = f.folderId.includes('-') && !['raw', 'revised', 'final', 'desain', 'lainnya'].includes(f.folderId)
                
                if (isSub) {
                  // Parse subfolder: extract parentType, role, userId from folderId
                  const parentType = ['raw', 'revised', 'final', 'desain', 'lainnya'].find(t => f.folderId.startsWith(t + '-')) || ''
                  const remaining = f.folderId.substring(parentType.length + 1)
                  const secondDash = remaining.indexOf('-')
                  const subRole = secondDash > 0 ? remaining.substring(0, secondDash) : remaining
                  const subUserId = secondDash > 0 ? remaining.substring(secondDash + 1) : ''
                  
                  // Find the user for this subfolder
                  const matchedUser = users.find(u => u.id === subUserId)
                  const parentAccess = folderUserAccess[parentType] || {}
                  
                  return {
                    folderId: f.folderId,
                    name: f.name,
                    desc: `Subfolder untuk ${matchedUser?.name || subRole}`,
                    color: 'text-stone-500',
                    bg: 'bg-stone-50',
                    border: 'border-stone-200',
                    link: f.webViewLink,
                    assignedRoles: matchedUser ? [matchedUser.role] : assignedToFolder,
                    assignedUsers: matchedUser ? [{
                      userId: matchedUser.id,
                      userName: matchedUser.name,
                      download: parentAccess[matchedUser.id]?.download ?? true,
                      upload: parentAccess[matchedUser.id]?.upload ?? true
                    }] : [],
                    parentFolderId: parentType
                  }
                }
                
                // Parent folder
                return {
                  folderId: f.folderId,
                  name: f.name,
                  desc: optionInfo?.desc || '',
                  color: optionInfo?.color || 'text-stone-600',
                  bg: optionInfo?.bg || 'bg-stone-100',
                  border: optionInfo?.border || 'border-stone-200',
                  link: f.webViewLink,
                  assignedRoles: assignedToFolder,
                  assignedUsers: Object.entries(folderUserAccess[f.folderId] || {}).map(([userId, access]) => {
                    const u = users.find(usr => usr.id === userId)
                    return { userId, userName: u?.name || '', download: access.download, upload: access.upload }
                  })
                }
              })
              console.log('[DRIVE] Created folders:', driveData.mainFolder)
            } else {
              // Fallback to mock
              console.log('[DRIVE] Auto-create failed, using mock folders')
              generatedFolders = createMockFolders(selectedFolders, rolesToAssign, tasks)
            }
          } else {
            // Fallback to mock
            console.log('[DRIVE] API error, using mock folders')
            generatedFolders = createMockFolders(selectedFolders, rolesToAssign, tasks)
          }
        } catch (driveError) {
          console.error('[DRIVE] Error:', driveError)
          generatedFolders = createMockFolders(selectedFolders, rolesToAssign, tasks)
        }
      } else {
        // Use mock folders
        generatedFolders = createMockFolders(selectedFolders, rolesToAssign, tasks)
      }

      setDriveCreatingStatus(null)

      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description: desc,
          requesterUnit: unit,
          location: tempat,
          executionTime: waktu,
          picName,
          picWhatsApp,
          activityTypes: jenisKegiatan,
          customActivity: jenisKegiatan.includes('Lainnya') ? kegiatanLainnya : '',
          outputNeeds: kebutuhanOutput,
          customOutput: kebutuhanOutput.includes('Lainnya') ? outputLainnya : '',
          managerId: currentUser?.id,
          tasks,
          driveFolders: generatedFolders,
          isFastTrack,
          ...(preFillFromSurat ? { suratId: preFillFromSurat.id } : {})
        })
      })

      if (response.ok) {
        const project = await response.json()
        addProject(project)
        
        // Add in-app notifications for stage 1 tasks
        project.tasks.filter((t: { stage: number }) => t.stage === 1).forEach((t: { assignedTo: string }) => {
          addNotification({
            id: Date.now().toString() + Math.random(),
            userId: t.assignedTo,
            message: `Tugas baru dialokasikan untuk proyek ${title}`,
            projectId: project.id,
            targetView: 'project_detail',
            read: false,
            createdAt: new Date()
          })
        })

        // Create task assignment for all assigned users
        for (const t of project.tasks) {
          try {
            const suratResponse = await fetch('/api/surat-tugas', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                projectId: project.id,
                userId: t.assignedTo,
                role: t.role,
                stage: t.stage
              })
            })
            
            if (suratResponse.ok) {
              const suratData = await suratResponse.json()
              addSuratTugas(suratData)
              console.log(`[SURAT TUGAS] Created for user ${t.assignedTo}, role: ${t.role}`)
            }
          } catch (suratError) {
            console.error(`[SURAT TUGAS] Failed to create for ${t.assignedTo}:`, suratError)
          }
        }

        // Update surat/permohonan with projectId if forwarded from Administrator
        if (preFillSource) {
          if (preFillSource.type === 'surat') {
            // Transfer surat documents/drive link to project documents for Tahap 0
            const suratDocsForProject: Array<{id: string; name: string; webViewLink?: string; uploadedAt: string; label?: string}> = []
            
            // Add surat uploaded documents as project documents (only actually uploaded ones)
            if (preFillFromSurat && preFillFromSurat.documents && preFillFromSurat.documents.length > 0) {
              preFillFromSurat.documents
                .filter((doc: any) => doc.webViewLink || doc.driveFileId)
                .forEach((doc: any) => {
                  suratDocsForProject.push({
                    id: `surat-doc-${doc.id || Date.now()}`,
                    name: doc.name || 'Dokumen Surat',
                    webViewLink: doc.downloadUrl || doc.webViewLink || doc.data || undefined,
                    uploadedAt: doc.uploadedAt || new Date().toISOString(),
                    label: 'Surat Permohonan (Auto-link Tahap 0)',
                  })
                })
            }
            
            // Update surat status and projectId
            fetch('/api/surat', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: preFillSource.id, status: 'selesai', projectId: project.id })
            }).then(() => {
              // After surat is updated, add surat docs to project documents if any
              if (suratDocsForProject.length > 0) {
                const existingDocs = project.documents || []
                const mergedDocs = [...suratDocsForProject, ...existingDocs]
                fetch('/api/projects', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ id: project.id, documents: mergedDocs })
                }).then(res => {
                  if (res.ok) {
                    return res.json().then(updated => {
                      addProject(updated)
                    })
                  }
                }).catch(err => console.error('Failed to transfer surat docs to project:', err))
              }
              setPreFillFromSurat(null)
            }).catch(err => console.error('Failed to update surat:', err))
          } else if (preFillSource.type === 'permohonan') {
            // Update permohonan status and projectId
            fetch('/api/permohonan', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: preFillSource.id, status: 'completed', projectId: project.id })
            }).then(() => {
              setPreFillFromPermohonan(null)
            }).catch(err => console.error('Failed to update permohonan:', err))
          }
          setPreFillSource(null)
        }

        setActiveView('dashboard')
        
        // Upload supporting documents to Google Drive in background
        uploadDocsToProject(project.id)
      } else {
        showAlert('Gagal membuat proyek. Silakan coba lagi.')
      }
    } catch {
      showAlert('Terjadi kesalahan. Silakan coba lagi.')
    } finally {
      setIsCreatingProject(false)
    setDriveCreatingStatus(null)
    }
  }

  // Helper function to create mock folders driven by UL checkbox (folderUserAccess)
  const createMockFolders = (folderIds: string[], rolesToAssign: string[], tasksData: Array<{ role: string; assignedTo: string; stage: number }>) => {
    const folders: Array<{
      folderId: string
      name: string
      desc: string
      color: string
      bg: string
      border: string
      link: string
      assignedRoles: string[]
      assignedUsers?: { userId: string; userName: string; download: boolean; upload: boolean }[]
      parentFolderId?: string
    }> = []

    // Helper: build assignedUsers array from folderUserAccess state — ONLY for roles in folderRoles
    const buildAssignedUsers = (fId: string) => {
      const allowedRoles = folderRoles[fId] || []
      return Object.entries(folderUserAccess[fId] || {})
        .filter(([userId]) => {
          const u = users.find(usr => usr.id === userId)
          return u && allowedRoles.includes(u.role)
        })
        .map(([userId, access]) => {
          const u = users.find(usr => usr.id === userId)
          return { userId, userName: u?.name || '', download: access.download, upload: access.upload }
        })
    }

    // Helper to generate user subfolders ONLY for users with UL checked AND role in folderRoles
    const generateSubfoldersForUpload = (parentFolderId: string) => {
      const folderAccess = folderUserAccess[parentFolderId] || {}
      const allowedRoles = folderRoles[parentFolderId] || []
      // Find users who have upload:true AND their role is assigned to this folder
      const usersWithUpload = Object.entries(folderAccess)
        .filter(([userId, access]) => {
          if (!access.upload) return false
          const user = users.find(u => u.id === userId)
          return user && allowedRoles.includes(user.role)
        })
        .map(([userId]) => userId)

      let idx = 0
      for (const userId of usersWithUpload) {
        const assignedUser = users.find(u => u.id === userId)
        if (!assignedUser) continue

        const task = tasksData.find(t => t.assignedTo === userId)
        const roleName = task?.role || assignedUser.role
        
        const nameParts = assignedUser.name.split(' ')
        const userCode = nameParts.length >= 2 
          ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
          : assignedUser.name.substring(0, 2).toUpperCase()
      
        const subfolderName = `${userCode}_${assignedUser.name.replace(/\s+/g, '_')}_${roleName.replace(/\s*&\s*/g, '_')}`
        
        folders.push({
          folderId: `${parentFolderId}-${roleName.toLowerCase().replace(/\s*&\s*/g, '-')}-${idx}`,
          name: subfolderName,
          desc: `Subfolder untuk ${assignedUser.name} (${roleName})`,
          color: 'text-stone-500',
          bg: 'bg-stone-50',
          border: 'border-stone-200',
          link: `https://drive.google.com/drive/folders/mock-${parentFolderId}-${roleName.toLowerCase().replace(/\s*&\s*/g, '-')}-${idx}-${Date.now()}`,
          assignedRoles: [roleName],
          assignedUsers: [{
            userId: assignedUser.id,
            userName: assignedUser.name,
            download: folderAccess[assignedUser.id]?.download ?? true,
            upload: folderAccess[assignedUser.id]?.upload ?? true
          }],
          parentFolderId: parentFolderId
        })
        idx++
      }
    }

    folderIds.forEach(folderId => {
      const optionInfo = FOLDER_OPTIONS.find(opt => opt.id === folderId)
      const assignedToFolder = (folderRoles[folderId] || []).filter(r => rolesToAssign.includes(r))
      const nowTs = Date.now()
      
      // Create parent folder
      folders.push({
        folderId,
        name: optionInfo?.name || `Folder ${folderId}`,
        desc: optionInfo?.desc || '',
        color: optionInfo?.color || 'text-stone-600',
        bg: optionInfo?.bg || 'bg-stone-100',
        border: optionInfo?.border || 'border-stone-200',
        link: `https://drive.google.com/drive/folders/mock-${folderId}-${nowTs}`,
        assignedRoles: assignedToFolder,
        assignedUsers: buildAssignedUsers(folderId)
      })

      // Create subfolders for ALL users with UL checked in this folder
      generateSubfoldersForUpload(folderId)
    })
    
    return folders
  }

  const activeRolesForAssignment = Object.keys(selectedRoles).filter(k => selectedRoles[k])

  // Template feature for project description
  const [showTemplatePanel, setShowTemplatePanel] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [templates, setTemplates] = useState<Array<{id: string; name: string; content: string}>>([])

  useEffect(() => {
    const saved = localStorage.getItem('pushakin_desc_templates')
    if (saved) {
      try { setTemplates(JSON.parse(saved)) } catch {}
    }
  }, [])

  const saveTemplate = () => {
    if (!templateName.trim() || !desc.trim()) {
      showAlert('Nama template dan isi deskripsi tidak boleh kosong.')
      return
    }
    const newTemplate = { id: `tpl-${Date.now()}`, name: templateName.trim(), content: desc }
    const updated = [...templates, newTemplate]
    setTemplates(updated)
    localStorage.setItem('pushakin_desc_templates', JSON.stringify(updated))
    setTemplateName('')
    setShowTemplatePanel(false)
    showAlert('Template berhasil disimpan!')
  }

  const deleteTemplate = (id: string) => {
    const updated = templates.filter(t => t.id !== id)
    setTemplates(updated)
    localStorage.setItem('pushakin_desc_templates', JSON.stringify(updated))
  }

  const applyTemplate = (content: string) => {
    setDesc(content)
    setShowTemplatePanel(false)
  }

  // Folder user access: track download/upload per folder per user
  const [folderUserAccess, setFolderUserAccess] = useState<Record<string, Record<string, {download: boolean; upload: boolean}>>>({})

  const toggleFolderUserAccess = (folderId: string, userId: string, field: 'download' | 'upload') => {
    setFolderUserAccess(prev => {
      const folderAccess = { ...prev[folderId] }
      const userAccess = { ...(folderAccess[userId] || { download: true, upload: true }) }
      userAccess[field] = !userAccess[field]
      folderAccess[userId] = userAccess
      return { ...prev, [folderId]: folderAccess }
    })
  }

  // Initialize default access: ONLY for roles explicitly assigned via folderRoles toggle button
  // Preserve existing customizations, clean up removed roles/folders
  useEffect(() => {
    setFolderUserAccess(prev => {
      const updated = { ...prev }

      selectedFolders.forEach(folderId => {
        if (!updated[folderId]) {
          updated[folderId] = {} // New folder — start fresh
        }

        // ONLY initialize for roles that are explicitly in folderRoles[folderId]
        const assignedRolesForFolder = folderRoles[folderId] || []
        assignedRolesForFolder.forEach(role => {
          const matchedUsers = users.filter(u => u.role === role)
          matchedUsers.forEach(user => {
            // Only set default if this user doesn't already have an entry for this folder
            if (!updated[folderId][user.id]) {
              updated[folderId][user.id] = { download: true, upload: true }
            }
          })
        })

        // Remove entries for roles that are NO LONGER in folderRoles for this folder
        Object.keys(updated[folderId] || {}).forEach(userId => {
          const user = users.find(u => u.id === userId)
          if (!user || !assignedRolesForFolder.includes(user.role)) {
            delete updated[folderId][userId]
          }
        })
      })

      // Remove entries for folders that are no longer selected
      Object.keys(updated).forEach(folderId => {
        if (!selectedFolders.includes(folderId)) {
          delete updated[folderId]
        }
      })

      // Remove entries for roles that are no longer in the team assignment
      const assignedUserIds = new Set<string>()
      activeRolesForAssignment.forEach(role => {
        users.filter(u => u.role === role).forEach(u => assignedUserIds.add(u.id))
      })
      Object.keys(updated).forEach(folderId => {
        Object.keys(updated[folderId]).forEach(userId => {
          if (!assignedUserIds.has(userId)) {
            delete updated[folderId][userId]
          }
        })
      })

      return updated
    })
  }, [selectedFolders, activeRolesForAssignment.length, users.length, JSON.stringify(folderRoles)]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card className="max-w-4xl mx-auto overflow-hidden">
      <CardHeader className="bg-stone-50/50 border-b border-stone-100">
        <CardTitle>Form Perencanaan Proyek</CardTitle>
        <p className="text-sm text-stone-500">Tahap 0 - Input detail dan tugaskan tim</p>
      </CardHeader>
      <CardContent className="p-4 sm:p-6 lg:p-8">
        <form onSubmit={handleSubmit} className="space-y-6 sm:space-y-8">

          {/* ⚡ Fast Track Toggle — Manager Only */}
          <div className={`rounded-xl border-2 p-4 transition-all duration-300 ${
            isFastTrack
              ? 'border-amber-400 bg-amber-50/70 shadow-inner'
              : 'border-dashed border-stone-200 bg-stone-50/50'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`rounded-lg p-2 transition-colors ${
                  isFastTrack ? 'bg-amber-400 text-white' : 'bg-stone-200 text-stone-500'
                }`}>
                  <Zap className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-semibold text-sm flex items-center gap-2">
                    Fast Track
                    {isFastTrack && (
                      <Badge className="bg-amber-500 text-white text-[10px] px-1.5 py-0">
                        AKTIF
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-stone-500 mt-0.5">
                    {isFastTrack
                      ? 'Lewati Produksi, Pasca Produksi & Review — langsung ke Publisher'
                      : 'Aktifkan untuk melewati alur produksi dan langsung ke Publisher'
                    }
                  </p>
                </div>
              </div>
              <Switch
                checked={isFastTrack}
                onCheckedChange={setIsFastTrack}
                aria-label="Toggle Fast Track"
              />
            </div>
            {isFastTrack && (
              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-2 text-xs text-amber-700">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>Tahap Produksi (1), Pasca Produksi (2), dan Review (3) akan otomatis dilewati. Publisher langsung mengerjakan.</span>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {[1, 2, 3].map(stage => (
                    <Badge key={stage} variant="outline" className="bg-purple-50 text-purple-600 border-purple-200 text-[10px] line-through decoration-purple-400">
                      <SkipForward className="h-2.5 w-2.5 mr-0.5" />
                      {STAGES[stage]}
                    </Badge>
                  ))}
                  <Badge variant="outline" className="bg-emerald-50 text-emerald-600 border-emerald-200 text-[10px]">
                    → {STAGES[4]}
                  </Badge>
                </div>
              </div>
            )}
          </div>

          {/* Basic Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="md:col-span-2">
              <Label htmlFor="title">Judul Proyek / Liputan</Label>
              <Input
                id="title"
                required
                value={title}
                onChange={e => setTitle(e.target.value)}
                
                className="mt-1"
              />
            </div>

            <div className="md:col-span-2 border-t border-stone-100 pt-6 mt-2">
              <h3 className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-4">
                Informasi Tambahan Logistik
              </h3>
            </div>
            
            <div className="md:col-span-2">
              <Label htmlFor="unit">Unit Pemohon</Label>
              <Input
                id="unit"
                required
                value={unit}
                onChange={e => setUnit(e.target.value)}
                
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="tempat">Tempat / Lokasi</Label>
              <Input
                id="tempat"
                required
                value={tempat}
                onChange={e => setTempat(e.target.value)}
                
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="waktu">Waktu Pelaksanaan</Label>
              <Input
                id="waktu"
                required
                type="datetime-local"
                value={waktu}
                onChange={e => setWaktu(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="picName">Nama PIC</Label>
              <Input
                id="picName"
                required
                value={picName}
                onChange={e => setPicName(e.target.value)}
                
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="picWhatsApp">No. WhatsApp PIC</Label>
              <Input
                id="picWhatsApp"
                required
                value={picWhatsApp}
                onChange={e => setPicWhatsApp(e.target.value)}
                
                className="mt-1"
              />
            </div>

            {/* Activity Types */}
            <div className="md:col-span-2 border-t border-stone-100 pt-6 mt-2">
              <h3 className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-4">
                Detail Kebutuhan & Output
              </h3>
            </div>

            <div>
              <Label className="text-xs font-bold text-stone-500 uppercase tracking-wider">
                Jenis Kegiatan
              </Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {OPSI_KEGIATAN.map(kegiatan => (
                  <Button
                    key={kegiatan}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => toggleItem(setJenisKegiatan, jenisKegiatan, kegiatan)}
                    className={cn(
                      "transition-colors",
                      jenisKegiatan.includes(kegiatan) 
                        ? "bg-indigo-50 border-indigo-500 text-indigo-700" 
                        : "bg-white border-stone-200 text-stone-600"
                    )}
                  >
                    {kegiatan}
                  </Button>
                ))}
              </div>
              {jenisKegiatan.includes('Lainnya') && (
                <Input
                  
                  value={kegiatanLainnya}
                  onChange={e => setKegiatanLainnya(e.target.value)}
                  className="mt-3"
                  required
                />
              )}
            </div>

            <div>
              <Label className="text-xs font-bold text-stone-500 uppercase tracking-wider">
                Kebutuhan Output
              </Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {OPSI_OUTPUT.map(output => (
                  <Button
                    key={output}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => toggleItem(setKebutuhanOutput, kebutuhanOutput, output)}
                    className={cn(
                      "transition-colors",
                      kebutuhanOutput.includes(output) 
                        ? "bg-indigo-50 border-indigo-500 text-indigo-700" 
                        : "bg-white border-stone-200 text-stone-600"
                    )}
                  >
                    {output}
                  </Button>
                ))}
              </div>
              {kebutuhanOutput.includes('Lainnya') && (
                <Input
                  
                  value={outputLainnya}
                  onChange={e => setOutputLainnya(e.target.value)}
                  className="mt-3"
                  required
                />
              )}
            </div>

            <div className="md:col-span-2">
              <div className="flex items-center justify-between mb-2">
                <Label htmlFor="desc">Detail & Instruksi Permohonan</Label>
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" size="sm" className="text-xs gap-1 text-indigo-600 hover:text-indigo-800" onClick={() => setShowTemplatePanel(!showTemplatePanel)}>
                    <FileText className="w-3 h-3" />
                    {showTemplatePanel ? 'Tutup Template' : 'Template'}
                  </Button>
                  {desc.trim() && (
                    <Button type="button" variant="ghost" size="sm" className="text-xs gap-1 text-green-600 hover:text-green-800" onClick={saveTemplate}>
                      <span>💾</span> Simpan Template
                    </Button>
                  )}
                </div>
              </div>
              {showTemplatePanel && (
                <div className="mb-3">
                  {templates.length > 0 && (
                    <div className="space-y-2 mb-3">
                      <p className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">Template Tersimpan:</p>
                      {templates.map(tpl => (
                        <div key={tpl.id} className="flex items-center justify-between gap-2 p-2.5 bg-white rounded-lg border border-stone-200">
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold text-stone-700 truncate">{tpl.name}</div>
                            <div className="text-[10px] text-stone-400 truncate mt-0.5">{tpl.content.substring(0, 80)}...</div>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[10px] text-indigo-600 hover:bg-indigo-50" onClick={() => applyTemplate(tpl.content)}>Pakai</Button>
                            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[10px] text-red-500 hover:bg-red-50" onClick={() => deleteTemplate(tpl.id)}>Hapus</Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Input
                      placeholder="Nama template..."
                      value={templateName}
                      onChange={e => setTemplateName(e.target.value)}
                      className="h-8 text-xs"
                    />
                    <Button type="button" size="sm" className="h-8 text-xs bg-indigo-600 hover:bg-indigo-700" onClick={saveTemplate}>
                      Simpan Template Baru
                    </Button>
                  </div>
                </div>
              )}
              <Textarea
                id="desc"
                required
                rows={5}
                value={desc}
                onChange={e => setDesc(e.target.value)}
                
                className="mt-1"
              />
            </div>
          </div>

          {/* Surat Referensi dari Administrator — Auto-linked for Manager */}
          {preFillFromSurat && (
          <div className="bg-emerald-50/40 border border-emerald-100 rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4 text-emerald-900">
              <Paperclip className="w-5 h-5" />
              <div className="font-bold flex items-center gap-2">
                <span>Dokumen Pendukung (Surat Permohonan)</span>
                <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">ARSIP</span>
              </div>
            </div>
            
            <div className="ml-8 space-y-3">
              <div className="bg-white rounded-xl border border-emerald-100 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-mono font-bold text-stone-500 bg-stone-100 px-2 py-0.5 rounded">
                    {preFillFromSurat.nomorSurat}
                  </span>
                  <Badge className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200">
                    {preFillFromSurat.kategori}
                  </Badge>
                </div>
                <h4 className="font-semibold text-stone-800">{preFillFromSurat.perihal}</h4>
                {preFillFromSurat.pengirim && (
                  <p className="text-sm text-stone-500 mt-1">Pengirim: {preFillFromSurat.pengirim}</p>
                )}
                {preFillFromSurat.tanggalSurat && (
                  <p className="text-sm text-stone-500">Tanggal: {new Date(preFillFromSurat.tanggalSurat).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                )}
              </div>

              {/* Documents from surat */}
              {preFillFromSurat.documents && preFillFromSurat.documents.filter((d: any) => d.webViewLink || d.driveFileId).length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-bold text-emerald-600/70 uppercase tracking-wider">Lampiran Surat:</p>
                  {preFillFromSurat.documents.filter((d: any) => d.webViewLink || d.driveFileId).map((doc: any) => (
                    <div key={doc.id} className="flex items-center gap-2 px-3 py-2 bg-white rounded-lg border border-emerald-100">
                      <File className="w-4 h-4 text-emerald-500" />
                      <span className="text-sm text-stone-700">{doc.name}</span>
                    </div>
                  ))}
                </div>
              )}
              
              <p className="text-xs text-stone-400">📌 Link surat ini akan otomatis tercatat sebagai bukti pada laporan kegiatan Tahap 0.</p>
            </div>
          </div>
          )}

          {/* Supporting Documents Upload — Admin (Super Admin) only, when no surat linked */}
          {currentUser?.role === 'Admin' && !preFillFromSurat && (
          <div className="bg-emerald-50/40 border border-emerald-100 rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4 text-emerald-900">
              <Paperclip className="w-5 h-5" />
              <div className="font-bold flex items-center gap-2">
                <span>Dokumen Pendukung (Surat Permohonan)</span>
                <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">ARSIP</span>
              </div>
            </div>
            <p className="text-sm text-emerald-700/80 mb-4 ml-8">
              Unggah surat permohonan atau dokumen dari pemohon sebagai arsip dan bukti pelaporan.
            </p>
            
            {/* Upload Area */}
            <div className="ml-8">
              <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-emerald-200 rounded-xl cursor-pointer hover:bg-emerald-50/50 hover:border-emerald-400 transition-all group">
                <input
                  type="file"
                  className="hidden"
                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.bmp,.tiff,.webp"
                  multiple
                  onChange={handleDocSelect}
                />
                <Upload className="w-8 h-8 text-emerald-400 group-hover:text-emerald-600 transition-colors mb-2" />
                <div className="text-sm font-medium text-emerald-600 group-hover:text-emerald-700">Klik untuk unggah dokumen</div>
                <div className="text-[10px] text-emerald-400 mt-1">PDF, Word, Gambar — Maksimal beberapa file sekaligus</div>
              </label>
            </div>

            {/* Document List */}
            {supportDocs.length > 0 && (
              <div className="mt-4 ml-8 space-y-2">
                <p className="text-[10px] font-bold text-emerald-600/70 uppercase tracking-wider mb-2">
                  Dokumen Terpilih ({supportDocs.length}):
                </p>
                {supportDocs.map(doc => (
                  <div key={doc.id} className="flex items-center gap-3 p-3 bg-white rounded-xl border border-emerald-100">
                    <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                      <File className="w-5 h-5 text-emerald-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-stone-800 truncate">{doc.name}</p>
                      <p className="text-[10px] text-stone-400">{formatFileSize(doc.size)} — {new Date(doc.uploadedAt).toLocaleString('id-ID')}</p>
                    </div>
                    {doc.uploading && (
                      <Loader2 className="w-4 h-4 text-emerald-500 animate-spin shrink-0" />
                    )}
                    {!doc.uploading && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeDoc(doc.id)}
                        className="text-red-400 hover:text-red-600 hover:bg-red-50 h-8 w-8 p-0 shrink-0"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          )}

          {/* Team Assignment */}
          <div>
            <div className="flex items-center gap-2 mb-4 border-b border-stone-200 pb-2">
              <Users className="w-5 h-5 text-indigo-600" />
              <h3 className="text-sm font-semibold text-stone-800">
                {isFastTrack ? 'Penugasan Publisher (Fast Track)' : 'Pembagian Tim & Penugasan'}
              </h3>
              {isFastTrack && (
                <Badge className="bg-amber-500 text-white text-[10px] px-1.5 py-0 ml-1">
                  <Zap className="h-2.5 w-2.5 mr-0.5" />FAST TRACK
                </Badge>
              )}
            </div>
            {isFastTrack && (
              <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700 flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span>Pilih Publisher yang akan langsung mengerjakan tugas. Tahap lain akan otomatis dilewati.</span>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[1, 2, 3, 4].map(stage => {
                const rolesInStage = Object.keys(ROLE_CONFIG).filter(r => ROLE_CONFIG[r].stage === stage)
                if (rolesInStage.length === 0) return null
                
                // Fast Track: only show stage 4 (Publisher)
                if (isFastTrack && stage !== 4) {
                  return (
                    <div key={stage} className="bg-stone-50/30 p-5 rounded-2xl border border-stone-200/30 opacity-50">
                      <h4 className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-3 border-b border-stone-200 pb-2 line-through decoration-purple-400">
                        <SkipForward className="h-3 w-3 inline mr-1" />
                        Tahap {stage}: {STAGES[stage]}
                      </h4>
                      <div className="flex items-center gap-2 text-[10px] text-purple-500">
                        <SkipForward className="h-3 w-3" />
                        <span>Dilewati (Fast Track)</span>
                      </div>
                    </div>
                  )
                }
                
                return (
                  <div key={stage} className={`p-5 rounded-2xl border ${
                    isFastTrack && stage === 4 
                      ? 'bg-amber-50/60 border-amber-300' 
                      : 'bg-stone-50/60 border-stone-200/60'
                  }`}>
                    <h4 className={`text-xs font-bold uppercase tracking-wider mb-4 border-b pb-2 ${
                      isFastTrack && stage === 4 ? 'text-amber-700 border-amber-200' : 'text-stone-600 border-stone-200'
                    }`}>
                      {isFastTrack && stage === 4 && <Zap className="h-3 w-3 inline mr-1" />}
                      Tahap {stage}: {STAGES[stage]}
                    </h4>
                    <div className="space-y-3">
                      {rolesInStage.map(role => (
                        <label key={role} className="flex items-start gap-3 p-2 rounded-lg hover:bg-white cursor-pointer transition-all group">
                          <Checkbox
                            checked={selectedRoles[role] || false}
                            onCheckedChange={(checked) => 
                              setSelectedRoles({...selectedRoles, [role]: !!checked})
                            }
                          />
                          <div>
                            <div className="text-sm font-bold text-stone-700 group-hover:text-indigo-700 transition-colors">
                              {getRoleDisplayName(role)}
                            </div>
                            <div className="flex items-center gap-1 text-[10px] text-stone-400 mt-0.5">
                              <Folder className="w-3 h-3" /> <span>Drive</span>
                              <span className="mx-1">•</span>
                              <Users className="w-3 h-3" /> <span>Auto-Assign</span>
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Folder Selection */}
          <div className="bg-indigo-50/40 border border-indigo-100 rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4 text-indigo-900">
              <Checkbox checked={driveAutoCreate} disabled />
              <div className="font-bold flex items-center gap-2">
                <Folder className="w-5 h-5" />
                <span>Otomatis Generate Folder Workspace (Google Drive)</span>
                {driveAutoCreate ? (
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">AKTIF</span>
                ) : (
                  <span className="text-xs bg-stone-200 text-stone-600 px-2 py-0.5 rounded-full">MOCK MODE</span>
                )}
              </div>
            </div>
            {!driveAutoCreate && (
              <p className="text-sm text-amber-700 mb-4 ml-8">
                ⚠️ Mode mock aktif. Folder tidak akan dibuat di Google Drive sebenarnya. 
                <span className="font-medium"> Aktifkan di menu Pengaturan.</span>
              </p>
            )}
            <p className="text-sm text-indigo-700/80 mb-4 ml-8">
              Pilih struktur folder dan tentukan user mana saja yang memiliki akses:
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 ml-8">
              {FOLDER_OPTIONS.map(folder => {
                const isSelected = selectedFolders.includes(folder.id)
                return (
                  <div
                    key={folder.id}
                    className={cn(
                      "flex flex-col p-4 rounded-xl border-2 transition-all",
                      isSelected 
                        ? "bg-white border-indigo-500 shadow-sm" 
                        : "bg-stone-50/50 border-transparent hover:border-indigo-200"
                    )}
                  >
                    <label className="flex items-start gap-3 cursor-pointer w-full">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleFolder(folder.id)}
                      />
                      <div className="flex-1">
                        <div className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">
                          {folder.title}
                        </div>
                        <div className="text-sm font-bold text-stone-800">{folder.name}</div>
                        <div className="text-xs text-stone-500 mt-1">{folder.desc}</div>
                      </div>
                    </label>

                    {isSelected && activeRolesForAssignment.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-stone-100 w-full ml-7 pl-0.5">
                        <p className="text-[10px] font-bold text-indigo-600/70 mb-2 uppercase tracking-wider">
                          Akses Untuk:
                        </p>
                        <div className="space-y-2">
                          {activeRolesForAssignment.map(role => {
                            const isRoleAssigned = (folderRoles[folder.id] || []).includes(role)
                            const assignedUser = users.find(u => u.role === role)
                            if (!assignedUser) return null
                            const access = folderUserAccess[folder.id]?.[assignedUser.id] || { download: true, upload: true }
                            return (
                              <div key={role} className="flex items-center justify-between gap-2 p-2 bg-stone-50 rounded-lg">
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className={cn(
                                      "h-auto px-2 py-1 text-[10px] shrink-0",
                                      isRoleAssigned
                                        ? "bg-indigo-600 text-white shadow-sm"
                                        : "bg-stone-100 text-stone-500 border border-stone-200"
                                    )}
                                    onClick={(e) => { e.preventDefault(); toggleRoleForFolder(folder.id, role); }}
                                  >
                                    {role}
                                  </Button>
                                  <span className="text-[10px] text-stone-400 truncate">{assignedUser.name}</span>
                                </div>
                                {isRoleAssigned && (
                                  <div className="flex items-center gap-3 shrink-0">
                                    <label className="flex items-center gap-1 cursor-pointer select-none">
                                      <Checkbox
                                        checked={access.download}
                                        onCheckedChange={() => toggleFolderUserAccess(folder.id, assignedUser.id, 'download')}
                                        className="h-3.5 w-3.5"
                                      />
                                      <span className="text-[10px] font-semibold text-stone-500">DL</span>
                                    </label>
                                    <label className="flex items-center gap-1 cursor-pointer select-none">
                                      <Checkbox
                                        checked={access.upload}
                                        onCheckedChange={() => toggleFolderUserAccess(folder.id, assignedUser.id, 'upload')}
                                        className="h-3.5 w-3.5"
                                      />
                                      <span className="text-[10px] font-semibold text-stone-500">UL</span>
                                    </label>
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Submit */}
          <div className="flex flex-col sm:flex-row items-center justify-end gap-4 pt-6 mt-4 border-t border-stone-200">
            <div className="flex gap-4 w-full sm:w-auto">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setActiveView('dashboard')}
                disabled={isCreatingProject}
                className="flex-1 sm:flex-none"
              >
                Batal
              </Button>
              <Button
                type="submit"
                disabled={isCreatingProject}
                className="flex-1 sm:flex-none bg-indigo-600 hover:bg-indigo-700 gap-2"
              >
                {isCreatingProject ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{driveCreatingStatus || 'Menginisiasi Proyek...'}</span>
                  </>
                ) : (
                  <>
                    <Rocket className="w-4 h-4" />
                    <span>Inisiasi Proyek</span>
                    {driveAutoCreate && (
                      <span className="text-xs opacity-75">(Google Drive Aktif)</span>
                    )}
                  </>
                )}
              </Button>
            </div>
          </div>
          <p className="text-xs text-center text-stone-400 mt-2">
            Detail kegiatan akan muncul di inbox setiap anggota tim yang ditugaskan
          </p>
        </form>
      </CardContent>
    </Card>
  )
}
