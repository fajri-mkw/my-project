'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAppStore, ROLES, ROLE_CONFIG, FOLDER_OPTIONS, FOLDER_ACCESS_DEFAULTS, STAGES, getRoleDisplayName } from '@/lib/store'
import { 
  Rocket, 
  Users, 
  Folder, 
  Loader2,
  FileText,
  Upload,
  X,
  ChevronDown,
  Plus,
  File,
  Paperclip,
  ExternalLink,
  Zap,
  AlertTriangle,
  SkipForward,
  ClipboardList,
  CheckCircle2
} from 'lucide-react'
import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'

const OPSI_KEGIATAN = ['Peliputan', 'Pemberitaan', 'Live Streaming', 'Podcast', 'Desain', 'Lainnya']
const OPSI_OUTPUT = ['Foto', 'Video', 'Audio', 'Text (article)', 'Foto (edited)', 'Streaming', 'Podcast', 'Desain', 'Template Sosial Media', 'Video Panjang', 'Video Pendek', 'Publish Web', 'Publish Sosmed', 'Review', 'Lainnya']

export function CreateProjectView() {
  const { currentUser, users, showAlert, setActiveView, addProject, addNotification, addSuratTugas, isCreatingProject, setIsCreatingProject, preFillFromSurat, setPreFillFromSurat, preFillFromPermohonan, setPreFillFromPermohonan } = useAppStore()
  
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [unit, setUnit] = useState('')
  const [tempat, setTempat] = useState('')
  const [waktu, setWaktu] = useState('')
  const [picName, setPicName] = useState('')
  const [picWhatsApp, setPicWhatsApp] = useState('')
  const [selectedUsers, setSelectedUsers] = useState<Record<string, string[]>>({}) // role → list of selected user IDs
  const [selectedFolders, setSelectedFolders] = useState(['raw', 'revised'])
  const [folderRoles, setFolderRoles] = useState<Record<string, string[]>>({})
  // Track roles the manager explicitly removed from a folder, so the auto-assign
  // effect does not re-add them. Entries are `${folderId}:${role}` strings.
  const [manualRoleRemovals, setManualRoleRemovals] = useState<Set<string>>(new Set())
  const [jenisKegiatan, setJenisKegiatan] = useState<string[]>([])
  const [kebutuhanOutput, setKebutuhanOutput] = useState<string[]>([])
  const [kegiatanLainnya, setKegiatanLainnya] = useState('')
  const [outputLainnya, setOutputLainnya] = useState('')
  // Worker output assignment: userId → list of output types
  const [workerOutputs, setWorkerOutputs] = useState<Record<string, string[]>>({})
  const [workerCustomOutput, setWorkerCustomOutput] = useState<Record<string, string>>({})
  const [driveAutoCreate, setDriveAutoCreate] = useState(false)
  const [driveCreatingStatus, setDriveCreatingStatus] = useState<string | null>(null)
  const [isFastTrack, setIsFastTrack] = useState(false)
  const [isFastProduction, setIsFastProduction] = useState(false)

  // Custom folder state
  const [customFolders, setCustomFolders] = useState<Array<{id: string; name: string; desc: string}>>([])
  const [showNewFolderForm, setShowNewFolderForm] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [newFolderDesc, setNewFolderDesc] = useState('')

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

  // Worker output assignment helpers
  const addWorkerOutput = (userId: string, outputType: string) => {
    setWorkerOutputs(prev => {
      const current = prev[userId] || []
      if (current.includes(outputType)) return prev // already added
      return { ...prev, [userId]: [...current, outputType] }
    })
  }

  const removeWorkerOutput = (userId: string, outputType: string) => {
    setWorkerOutputs(prev => {
      const current = prev[userId] || []
      const updated = current.filter(o => o !== outputType)
      if (updated.length === 0) {
        const { [userId]: _, ...rest } = prev
        return rest
      }
      return { ...prev, [userId]: updated }
    })
    // Also clean up custom output if removing "Lainnya"
    if (outputType === 'Lainnya') {
      setWorkerCustomOutput(prev => {
        const { [userId]: _, ...rest } = prev
        return rest
      })
    }
  }

  // Clean up workerOutputs when users are deselected
  useEffect(() => {
    const selectedUserIds = new Set<string>()
    Object.values(selectedUsers).forEach(ids => ids.forEach(id => selectedUserIds.add(id)))
    
    setWorkerOutputs(prev => {
      const updated = { ...prev }
      let changed = false
      Object.keys(updated).forEach(userId => {
        if (!selectedUserIds.has(userId)) {
          delete updated[userId]
          changed = true
        }
      })
      return changed ? updated : prev
    })
    setWorkerCustomOutput(prev => {
      const updated = { ...prev }
      let changed = false
      Object.keys(updated).forEach(userId => {
        if (!selectedUserIds.has(userId)) {
          delete updated[userId]
          changed = true
        }
      })
      return changed ? updated : prev
    })
  }, [selectedUsers])

  const toggleFolder = (folderId: string) => {
    if (selectedFolders.includes(folderId)) {
      setSelectedFolders(selectedFolders.filter(id => id !== folderId))
    } else {
      setSelectedFolders([...selectedFolders, folderId])
    }
  }

  const addCustomFolder = () => {
    if (!newFolderName.trim()) {
      showAlert('Nama folder tidak boleh kosong.')
      return
    }
    const id = `custom-${Date.now()}`
    const newFolder = { id, name: newFolderName.trim(), desc: newFolderDesc.trim() }
    setCustomFolders(prev => [...prev, newFolder])
    setSelectedFolders(prev => [...prev, id])
    setNewFolderName('')
    setNewFolderDesc('')
    setShowNewFolderForm(false)
  }

  const removeCustomFolder = (folderId: string) => {
    setCustomFolders(prev => prev.filter(f => f.id !== folderId))
    setSelectedFolders(prev => prev.filter(id => id !== folderId))
    setFolderRoles(prev => {
      const updated = { ...prev }
      delete updated[folderId]
      return updated
    })
    setFolderUserAccess(prev => {
      const updated = { ...prev }
      delete updated[folderId]
      return updated
    })
  }

  const toggleRoleForFolder = (folderId: string, role: string) => {
    const key = `${folderId}:${role}`
    setFolderRoles(prev => {
      const currentRoles = prev[folderId] || []
      if (currentRoles.includes(role)) {
        // Manager explicitly removed this role — remember so auto-assign won't re-add it
        setManualRoleRemovals(s => { const n = new Set(s); n.add(key); return n })
        return { ...prev, [folderId]: currentRoles.filter(r => r !== role) }
      } else {
        // Manager explicitly added this role back — clear the manual-removal flag
        setManualRoleRemovals(s => { const n = new Set(s); n.delete(key); return n })
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
    const activeRoles = Object.keys(selectedUsers).filter(k => selectedUsers[k].length > 0)
    // Fast Track: only Publisher roles are required
    if (isFastTrack) {
      const hasPublisher = activeRoles.some(r => r === 'PublisherWeb' || r === 'PublisherSocialMedia')
      if (!hasPublisher) {
        showAlert('Fast Track: Pilih minimal satu Publisher (Web atau Social Media).')
        return
      }
    } else if (isFastProduction) {
      // Fast Production: at least 1 role required (same as normal mode)
      if (activeRoles.length === 0) {
        showAlert('Fast Production: Pilih minimal satu peran/petugas untuk proyek ini.')
        return
      }
    } else if (activeRoles.length === 0) {
      showAlert('Pilih minimal satu peran/petugas untuk proyek ini.')
      return
    }

    // Normal mode: require workers in every stage that has available users
    // This prevents workflow from getting stuck when a stage has no workers
    if (!isFastTrack && !isFastProduction) {
      const currentMissingStages = [1, 2, 3, 4, 5].filter(stage => {
        // Check if there are users available for this stage
        const rolesInStage = Object.keys(ROLE_CONFIG).filter(r => ROLE_CONFIG[r].stage === stage)
        const hasAvailableUsers = rolesInStage.some(role => users.filter(u => u.role === role).length > 0)
        // Check if any workers are assigned to this stage
        const hasAssignedWorkers = activeRoles.some(role => {
          const config = ROLE_CONFIG[role]
          return config?.stage === stage && (selectedUsers[role] || []).length > 0
        })
        return hasAvailableUsers && !hasAssignedWorkers
      })

      if (currentMissingStages.length > 0) {
        const stageNames = currentMissingStages.map(s => `Tahap ${s} (${STAGES[s]})`).join(', ')
        showAlert(`Wajib memilih petugas di setiap tahapan! Tahap yang belum memiliki petugas: ${stageNames}. Alur kerja akan terhambat jika ada tahapan tanpa petugas.`)
        return
      }
    }

    setIsCreatingProject(true)

    try {
      // Create one task per selected user per role
      const tasks: Array<{ role: string; stage: number; assignedTo: string }> = []
      activeRoles.forEach(role => {
        const config = ROLE_CONFIG[role]
        const userIds = selectedUsers[role] || []
        userIds.forEach(userId => {
          tasks.push({
            role,
            stage: config?.stage || 1,
            assignedTo: userId
          })
        })
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
              folderUserAccess: filteredFolderUserAccess,
              workerOutputs,
              workerCustomOutput
            })
          })
          
          if (driveResponse.ok) {
            const driveData = await driveResponse.json()
            if (driveData.success) {
              // Map real Google Drive folders
              generatedFolders = driveData.folders.map((f: { folderId: string; name: string; webViewLink: string }) => {
                const optionInfo = FOLDER_OPTIONS.find(opt => opt.id === f.folderId)
                const assignedToFolder = (folderRoles[f.folderId] || []).filter((r: string) => activeRoles.includes(r))
                // Check if this is a subfolder (folderId contains dashes like 'raw-reporter-userId')
                const isSub = f.folderId.includes('-') && !['raw', 'revised', 'final', 'desain', 'lainnya'].includes(f.folderId)
                
                if (isSub) {
                  // Check if this is a direct output subfolder for stage 1 workers (pattern: raw-output-userId-idx)
                  // This is the new flattened structure where output folders are direct children of RAW
                  const directOutputMatch = f.folderId.match(/^(raw|revised|final|desain|lainnya)-output-(.+)-(\d+)$/)
                  if (directOutputMatch) {
                    const parentType = directOutputMatch[1]
                    const outputUserId = directOutputMatch[2]
                    const matchedUser = users.find(u => u.id === outputUserId)
                    
                    return {
                      folderId: f.folderId,
                      name: f.name,
                      desc: `Output - ${matchedUser?.name || outputUserId}`,
                      color: 'text-stone-400',
                      bg: 'bg-stone-50/50',
                      border: 'border-stone-100',
                      link: f.webViewLink,
                      assignedRoles: matchedUser ? [matchedUser.role] : assignedToFolder,
                      assignedUsers: matchedUser ? [{
                        userId: matchedUser.id,
                        userName: matchedUser.name,
                        download: true,
                        upload: true
                      }] : [],
                      parentFolderId: parentType
                    }
                  }
                  
                  // Check if this is a nested output-type subfolder (pattern: raw-role-userId-output-idx)
                  const isOutputSub = f.folderId.includes('-output-')

                  if (isOutputSub) {
                    // Extract the parent user subfolder ID (everything before "-output-")
                    const outputPrefix = f.folderId.substring(0, f.folderId.indexOf('-output-'))
                    const parentType = ['raw', 'revised', 'final', 'desain', 'lainnya'].find(t => outputPrefix.startsWith(t + '-')) || ''

                    // Find the user who owns this output subfolder by matching userId at end of prefix.
                    // This ensures the output subfolder (Foto/, Video/) inherits the owning user's
                    // access so that getUploadFolders() can route uploads directly to it.
                    const matchedUser = users.find(u => outputPrefix.endsWith('-' + u.id))
                    const parentAccess = folderUserAccess[parentType] || {}

                    return {
                      folderId: f.folderId,
                      name: f.name,
                      desc: `Output ${f.name}${matchedUser ? ' - ' + matchedUser.name : ''}`,
                      color: 'text-stone-400',
                      bg: 'bg-stone-50/50',
                      border: 'border-stone-100',
                      link: f.webViewLink,
                      assignedRoles: matchedUser ? [matchedUser.role] : assignedToFolder,
                      assignedUsers: matchedUser ? [{
                        userId: matchedUser.id,
                        userName: matchedUser.name,
                        download: parentAccess[matchedUser.id]?.download ?? true,
                        upload: true // output subfolders are always upload destinations for the owner
                      }] : [],
                      parentFolderId: outputPrefix
                    }
                  }
                  
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
              generatedFolders = createMockFolders(selectedFolders, activeRoles, tasks)
            }
          } else {
            // Fallback to mock
            console.log('[DRIVE] API error, using mock folders')
            generatedFolders = createMockFolders(selectedFolders, activeRoles, tasks)
          }
        } catch (driveError) {
          console.error('[DRIVE] Error:', driveError)
          generatedFolders = createMockFolders(selectedFolders, activeRoles, tasks)
        }
      } else {
        // Use mock folders
        generatedFolders = createMockFolders(selectedFolders, activeRoles, tasks)
      }

      setDriveCreatingStatus(null)

      // Aggregate all output needs: from general checkbox + worker assignments
      const allOutputNeeds = new Set(kebutuhanOutput)
      Object.values(workerOutputs).forEach(outputs => {
        outputs.forEach(o => allOutputNeeds.add(o))
      })
      const aggregatedOutputNeeds = Array.from(allOutputNeeds)
      // Check if any worker has "Lainnya" custom output
      const hasCustomOutput = aggregatedOutputNeeds.includes('Lainnya')
      const customOutputText = hasCustomOutput
        ? [outputLainnya, ...Object.entries(workerCustomOutput).filter(([, v]) => v.trim()).map(([userId, v]) => {
            const user = users.find(u => u.id === userId)
            return user ? `${user.name}: ${v}` : v
          })].filter(Boolean).join('; ')
        : ''

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
          outputNeeds: aggregatedOutputNeeds,
          customOutput: customOutputText,
          workerOutputs,
          workerCustomOutput,
          managerId: currentUser?.id,
          tasks,
          driveFolders: generatedFolders,
          isFastTrack,
          isFastProduction,
          ...(preFillFromSurat ? { suratId: preFillFromSurat.id } : {})
        })
      })

      if (response.ok) {
        const project = await response.json()
        addProject(project)
        
        // Note: Server already creates DB notifications for active stage tasks (stage 1 or stage 5 for FastTrack).
        // We only need to sync them to the Zustand store from the server response.
        const activeStage = isFastTrack ? 5 : 1
        project.tasks
          .filter((t: { stage: number; status: string }) => t.stage === activeStage && t.status === 'pending')
          .forEach((t: { assignedTo: string }) => {
            addNotification({
              id: `server-${project.id}-${t.assignedTo}-${activeStage}`,
              userId: t.assignedTo,
              message: `Tugas baru dialokasikan untuk proyek ${title}`,
              projectId: project.id,
              targetView: 'project_detail',
              read: false,
              createdAt: new Date()
            })
          })

        // Create Surat Tugas only for tasks that are NOT auto-completed (i.e., pending tasks).
        // FastTrack auto-completes stages 1-4, so skip those.
        const tasksNeedingSurat = project.tasks.filter((t: { status: string }) => t.status !== 'completed')
        for (const t of tasksNeedingSurat) {
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
  const createMockFolders = (folderIds: string[], activeRoles: string[], tasksData: Array<{ role: string; assignedTo: string; stage: number }>) => {
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
    // Structure: Parent > AM_Ahmad_Reporter/ > Foto/, Video/, etc.
    // Output subfolders are always created inside user subfolder when workerOutputs are defined
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
        const userSubfolderId = `${parentFolderId}-${roleName.toLowerCase().replace(/\s*&\s*/g, '-')}-${userId}`

        // Always create user-named subfolder first
        folders.push({
          folderId: userSubfolderId,
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

        // Create output-type subfolders inside user's folder based on workerOutputs
        // This applies to ALL stages (including Fast Track) — not just stage 1
        if (workerOutputs[userId] && workerOutputs[userId].length > 0) {
          const userOutputs = workerOutputs[userId]
          let outputIdx = 0
          for (const outputType of userOutputs) {
            const outputName = outputType === 'Lainnya' && workerCustomOutput[userId]
              ? workerCustomOutput[userId]
              : outputType
            folders.push({
              folderId: `${userSubfolderId}-output-${outputIdx}`,
              name: outputName,
              desc: `Output ${outputName} - ${assignedUser.name}`,
              color: 'text-stone-400',
              bg: 'bg-stone-50/50',
              border: 'border-stone-100',
              link: `https://drive.google.com/drive/folders/mock-${userSubfolderId}-output-${outputIdx}-${Date.now()}`,
              assignedRoles: [roleName],
              assignedUsers: [{
                userId: assignedUser.id,
                userName: assignedUser.name,
                download: true,
                upload: true
              }],
              parentFolderId: userSubfolderId
            })
            outputIdx++
          }
        }

        idx++
      }
    }

    folderIds.forEach(folderId => {
      const isCustom = folderId.startsWith('custom-')
      const optionInfo = isCustom ? null : FOLDER_OPTIONS.find(opt => opt.id === folderId)
      const customInfo = isCustom ? customFolders.find(f => f.id === folderId) : null
      const assignedToFolder = (folderRoles[folderId] || []).filter(r => activeRoles.includes(r))
      const nowTs = Date.now()
      
      // Create parent folder
      folders.push({
        folderId,
        name: isCustom ? (customInfo?.name || `Folder ${folderId}`) : (optionInfo?.name || `Folder ${folderId}`),
        desc: isCustom ? (customInfo?.desc || '') : (optionInfo?.desc || ''),
        color: isCustom ? 'text-teal-600' : (optionInfo?.color || 'text-stone-600'),
        bg: isCustom ? 'bg-teal-50' : (optionInfo?.bg || 'bg-stone-100'),
        border: isCustom ? 'border-teal-200' : (optionInfo?.border || 'border-stone-200'),
        link: `https://drive.google.com/drive/folders/mock-${folderId}-${nowTs}`,
        assignedRoles: assignedToFolder,
        assignedUsers: buildAssignedUsers(folderId)
      })

      // Create subfolders for ALL users with UL checked in this folder
      generateSubfoldersForUpload(folderId)
    })
    
    return folders
  }

  const activeRolesForAssignment = Object.keys(selectedUsers).filter(k => selectedUsers[k].length > 0)

  // Compute which stages have available users (users in the system with roles for that stage)
  // and which stages currently have workers assigned
  const stagesWithAvailableUsers = new Set<number>()
  const stagesWithAssignedWorkers = new Set<number>()
  
  // Check which stages have users available in the system
  for (const role of Object.keys(ROLE_CONFIG)) {
    const stage = ROLE_CONFIG[role].stage
    const usersWithRole = users.filter(u => u.role === role)
    if (usersWithRole.length > 0) {
      stagesWithAvailableUsers.add(stage)
    }
  }
  
  // Check which stages currently have workers assigned
  activeRolesForAssignment.forEach(role => {
    const config = ROLE_CONFIG[role]
    if (config) {
      stagesWithAssignedWorkers.add(config.stage)
    }
  })
  
  // For normal (non-fast) mode: find stages that have available users but no assigned workers
  const missingStages = !isFastTrack && !isFastProduction
    ? [1, 2, 3, 4, 5].filter(stage => stagesWithAvailableUsers.has(stage) && !stagesWithAssignedWorkers.has(stage))
    : []

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
        // AND only for users that are explicitly selected for that role
        const assignedRolesForFolder = folderRoles[folderId] || []
        const folderDefaults = FOLDER_ACCESS_DEFAULTS[folderId] // undefined for non-workflow folders
        assignedRolesForFolder.forEach(role => {
          const selectedUserIds = selectedUsers[role] || []
          selectedUserIds.forEach(userId => {
            // Only set default if this user doesn't already have an entry for this folder
            if (!updated[folderId][userId]) {
              // For workflow folders (PRODUKSI / PASCA PRODUKSI), derive DL/UL from
              // the user's role stage using the stage-based access policy.
              const user = users.find(u => u.id === userId)
              const stage = user ? ROLE_CONFIG[user.role]?.stage : undefined
              const mapped = stage != null && folderDefaults ? folderDefaults[stage] : undefined
              updated[folderId][userId] = mapped
                ? { download: mapped.download, upload: mapped.upload }
                : { download: true, upload: true }
            }
          })
        })

        // Remove entries for users who are no longer selected for their role
        Object.keys(updated[folderId] || {}).forEach(userId => {
          const user = users.find(u => u.id === userId)
          if (!user) {
            delete updated[folderId][userId]
            return
          }
          // Keep if role is in folderRoles AND user is selected for that role
          if (!assignedRolesForFolder.includes(user.role) || !(selectedUsers[user.role] || []).includes(userId)) {
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

      // Remove entries for users that are no longer selected for any role
      const assignedUserIds = new Set<string>()
      Object.values(selectedUsers).forEach(userIds => {
        userIds.forEach(id => assignedUserIds.add(id))
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
  }, [selectedFolders, JSON.stringify(selectedUsers), users.length, JSON.stringify(folderRoles)]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-assign default folder access when a project is initiated.
  // For workflow folders (PRODUKSI / PASCA PRODUKSI) defined in FOLDER_ACCESS_DEFAULTS,
  // automatically add every role whose stage has an access policy — but only for roles
  // that currently have at least one selected user, and never re-add a role the manager
  // explicitly removed (tracked in manualRoleRemovals).
  useEffect(() => {
    setFolderRoles(prev => {
      const updated = { ...prev }
      let changed = false

      selectedFolders.forEach(folderId => {
        const defaults = FOLDER_ACCESS_DEFAULTS[folderId]
        if (!defaults) return // only PRODUKSI / PASCA PRODUKSI auto-assign roles

        const allowedStages = Object.keys(defaults).map(Number)
        const current = updated[folderId] || []

        // Determine which roles should be auto-added: roles whose stage is in the
        // policy AND that have at least one selected user AND that the manager has
        // not explicitly removed.
        const rolesToHave = ROLES.filter(role => {
          const stage = ROLE_CONFIG[role]?.stage
          if (stage == null || !allowedStages.includes(stage)) return false
          if ((selectedUsers[role] || []).length === 0) return false
          if (manualRoleRemovals.has(`${folderId}:${role}`)) return false
          return true
        }) as string[]

        const merged = Array.from(new Set([...current, ...rolesToHave]))
        if (merged.length !== current.length) {
          updated[folderId] = merged
          changed = true
        }
      })

      return changed ? updated : prev
    })
  }, [selectedFolders, JSON.stringify(selectedUsers), manualRoleRemovals]) // eslint-disable-line react-hooks/exhaustive-deps

  // Clean up manualRoleRemovals entries for folders that are no longer selected,
  // so re-selecting a folder starts with a clean auto-assign state.
  useEffect(() => {
    setManualRoleRemovals(prev => {
      if (prev.size === 0) return prev
      const next = new Set<string>()
      prev.forEach(key => {
        const [folderId] = key.split(':')
        if (selectedFolders.includes(folderId)) next.add(key)
      })
      return next.size === prev.size ? prev : next
    })
  }, [selectedFolders])

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
                      ? 'Lewati Produksi, Pasca Produksi, Review & Finalization — langsung ke Publisher'
                      : 'Aktifkan untuk melewati alur produksi dan langsung ke Publisher'
                    }
                  </p>
                </div>
              </div>
              <Switch
                checked={isFastTrack}
                onCheckedChange={(checked) => {
                  setIsFastTrack(checked)
                  if (checked) setIsFastProduction(false)
                }}
                aria-label="Toggle Fast Track"
              />
            </div>
            {isFastTrack && (
              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-2 text-xs text-amber-700">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>Tahap Produksi (1), Pasca Produksi (2), Review (3), dan Finalization (4) akan otomatis dilewati. Publisher langsung mengerjakan.</span>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {[1, 2, 3, 4].map(stage => (
                    <Badge key={stage} variant="outline" className="bg-purple-50 text-purple-600 border-purple-200 text-[10px] line-through decoration-purple-400">
                      <SkipForward className="h-2.5 w-2.5 mr-0.5" />
                      {STAGES[stage]}
                    </Badge>
                  ))}
                  <Badge variant="outline" className="bg-emerald-50 text-emerald-600 border-emerald-200 text-[10px]">
                    → {STAGES[5]}
                  </Badge>
                </div>
              </div>
            )}
          </div>

          {/* 🚀 Fast Production Toggle — All roles work simultaneously */}
          <div className={`rounded-xl border-2 p-4 transition-all duration-300 ${
            isFastProduction
              ? 'border-teal-400 bg-teal-50/70 shadow-inner'
              : 'border-dashed border-stone-200 bg-stone-50/50'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`rounded-lg p-2 transition-colors ${
                  isFastProduction ? 'bg-teal-500 text-white' : 'bg-stone-200 text-stone-500'
                }`}>
                  <Rocket className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-semibold text-sm flex items-center gap-2">
                    Fast Production
                    {isFastProduction && (
                      <Badge className="bg-teal-600 text-white text-[10px] px-1.5 py-0">
                        AKTIF
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-stone-500 mt-0.5">
                    {isFastProduction
                      ? 'Semua petugas bekerja bersamaan tanpa menunggu tahap sebelumnya'
                      : 'Aktifkan agar semua petugas bekerja secara paralel (non-sequensial)'
                    }
                  </p>
                </div>
              </div>
              <Switch
                checked={isFastProduction}
                onCheckedChange={(checked) => {
                  setIsFastProduction(checked)
                  if (checked) setIsFastTrack(false)
                }}
                aria-label="Toggle Fast Production"
              />
            </div>
            {isFastProduction && (
              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-2 text-xs text-teal-700">
                  <Rocket className="h-3.5 w-3.5 shrink-0" />
                  <span>Produksi tidak berurutan — semua petugas bisa bekerja dan mengunggah laporan secara fleksibel tanpa menunggu tahap sebelumnya. Petugas dapat melakukan revisi.</span>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {[1, 2, 3, 4, 5].map(stage => (
                    <Badge key={stage} variant="outline" className="bg-teal-50 text-teal-600 border-teal-200 text-[10px]">
                      {STAGES[stage]}
                    </Badge>
                  ))}
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
                {isFastTrack ? 'Penugasan Publisher (Fast Track)' : isFastProduction ? 'Penugasan Paralel (Fast Production)' : 'Pembagian Tim & Penugasan'}
              </h3>
              {isFastTrack && (
                <Badge className="bg-amber-500 text-white text-[10px] px-1.5 py-0 ml-1">
                  <Zap className="h-2.5 w-2.5 mr-0.5" />FAST TRACK
                </Badge>
              )}
              {isFastProduction && (
                <Badge className="bg-teal-600 text-white text-[10px] px-1.5 py-0 ml-1">
                  <Rocket className="h-2.5 w-2.5 mr-0.5" />FAST PRODUCTION
                </Badge>
              )}
              {!isFastTrack && !isFastProduction && (
                <Badge className="bg-stone-600 text-white text-[10px] px-1.5 py-0 ml-1">
                  ALUR SEKUENSIAL
                </Badge>
              )}
            </div>
            {!isFastTrack && !isFastProduction && (
              <div className="mb-4 p-3 rounded-lg bg-violet-50 border border-violet-200 text-xs text-violet-700 flex items-center gap-2">
                <ClipboardList className="h-3.5 w-3.5 shrink-0" />
                <span>Mode Alur Sekuensial: Setiap tahapan wajib memiliki petugas agar proyek dapat berjalan dari awal sampai akhir tanpa hambatan. Gunakan Fast Track atau Fast Production jika tidak memerlukan semua tahapan.</span>
              </div>
            )}
            {isFastTrack && (
              <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700 flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span>Pilih Publisher yang akan langsung mengerjakan tugas. Tahap lain akan otomatis dilewati.</span>
              </div>
            )}
            {isFastProduction && (
              <div className="mb-4 p-3 rounded-lg bg-teal-50 border border-teal-200 text-xs text-teal-700 flex items-center gap-2">
                <Rocket className="h-3.5 w-3.5 shrink-0" />
                <span>Semua petugas bisa bekerja bersamaan. Tidak ada tahap yang dilewati — semua peran tersedia untuk dipilih.</span>
              </div>
            )}
            {/* Normal mode: warning about missing stages */}
            {!isFastTrack && !isFastProduction && missingStages.length > 0 && (
              <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-300 text-xs text-red-700 flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold">Petugas wajib dipilih di setiap tahapan!</span>
                  <span className="block mt-1">Tahap tanpa petugas: {missingStages.map(s => `Tahap ${s} (${STAGES[s]})`).join(', ')}. Alur kerja akan terhambat jika ada tahapan tanpa petugas.</span>
                </div>
              </div>
            )}
            {!isFastTrack && !isFastProduction && missingStages.length === 0 && activeRolesForAssignment.length > 0 && (
              <div className="mb-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-700 flex items-center gap-2">
                <span className="text-emerald-500">✓</span>
                <span>Semua tahapan sudah memiliki petugas. Alur kerja dapat berjalan lancar dari awal sampai akhir.</span>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[1, 2, 3, 4, 5].map(stage => {
                const rolesInStage = Object.keys(ROLE_CONFIG).filter(r => ROLE_CONFIG[r].stage === stage)
                if (rolesInStage.length === 0) return null
                
                // Check if this stage has workers assigned (for normal mode validation)
                const hasWorkersInStage = rolesInStage.some(role => (selectedUsers[role] || []).length > 0)
                const hasAvailableUsersInStage = rolesInStage.some(role => users.filter(u => u.role === role).length > 0)
                const isStageMissing = !isFastTrack && !isFastProduction && hasAvailableUsersInStage && !hasWorkersInStage
                
                // Fast Track: only show stage 5 (Publisher)
                if (isFastTrack && stage !== 5) {
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
                  <div key={stage} className={`p-5 rounded-2xl border-2 ${
                    isStageMissing
                      ? 'bg-red-50/40 border-red-300 shadow-sm'
                      : isFastTrack && stage === 5 
                        ? 'bg-amber-50/60 border-amber-300' 
                        : isFastProduction
                          ? 'bg-teal-50/40 border-teal-300'
                          : 'bg-stone-50/60 border-stone-200/60'
                  }`}>
                    <h4 className={`text-xs font-bold uppercase tracking-wider mb-4 border-b pb-2 flex items-center gap-1.5 ${
                      isStageMissing
                        ? 'text-red-600 border-red-200'
                        : isFastTrack && stage === 5 ? 'text-amber-700 border-amber-200' : isFastProduction ? 'text-teal-700 border-teal-200' : 'text-stone-600 border-stone-200'
                    }`}>
                      {isStageMissing && <AlertTriangle className="h-3.5 w-3.5 text-red-500" />}
                      {isFastTrack && stage === 5 && <Zap className="h-3 w-3 inline mr-1" />}
                      {isFastProduction && <Rocket className="h-3 w-3 inline mr-1" />}
                      Tahap {stage}: {STAGES[stage]}
                      {isStageMissing && (
                        <Badge className="bg-red-500 text-white text-[9px] px-1.5 py-0 ml-auto">
                          WAJIB ISI
                        </Badge>
                      )}
                    </h4>
                    {isStageMissing && (
                      <div className="mb-3 p-2 rounded-lg bg-red-50 border border-red-200 text-[10px] text-red-600 flex items-center gap-1.5">
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        <span>Pilih minimal satu petugas di tahap ini agar alur kerja tidak terhambat</span>
                      </div>
                    )}
                    <div className="space-y-3">
                      {rolesInStage.map(role => {
                        const usersWithRole = users.filter(u => u.role === role)
                        const selectedForRole = selectedUsers[role] || []
                        const isRoleSelected = selectedForRole.length > 0
                        return (
                          <div key={role} className={`p-3 rounded-xl border transition-all ${isRoleSelected ? 'bg-white border-violet-300 shadow-sm' : 'bg-stone-50/50 border-stone-200/60'}`}>
                            <div className="flex items-center justify-between mb-2">
                              <div className="text-sm font-bold text-stone-700">
                                {getRoleDisplayName(role)}
                              </div>
                              {isRoleSelected && (
                                <Badge variant="default" className="bg-violet-600 text-[10px] px-1.5 py-0">
                                  {selectedForRole.length} petugas
                                </Badge>
                              )}
                            </div>
                            {usersWithRole.length === 0 ? (
                              <p className="text-xs text-stone-400 italic">Belum ada pengguna dengan peran ini</p>
                            ) : (
                              <div className="space-y-1.5">
                                {usersWithRole.map(user => {
                                  const isSelected = selectedForRole.includes(user.id)
                                  return (
                                    <label key={user.id} className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-stone-50 cursor-pointer transition-all">
                                      <Checkbox
                                        checked={isSelected}
                                        onCheckedChange={(checked) => {
                                          setSelectedUsers(prev => {
                                            const current = prev[role] || []
                                            if (checked) {
                                              return { ...prev, [role]: [...current, user.id] }
                                            } else {
                                              return { ...prev, [role]: current.filter(id => id !== user.id) }
                                            }
                                          })
                                        }}
                                      />
                                      <div className="flex items-center gap-2 flex-1 min-w-0">
                                        <div className="w-6 h-6 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center text-[10px] font-bold shrink-0">
                                          {user.name.charAt(0).toUpperCase()}
                                        </div>
                                        <span className="text-xs font-medium text-stone-700 truncate">{user.name}</span>
                                      </div>
                                    </label>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Penugasan Petugas & Kebutuhan Output — Moved after Team Assignment for better UX */}
          <div>
            <div className="flex items-center gap-2 mb-4 border-b border-stone-200 pb-2">
              <ClipboardList className="w-5 h-5 text-violet-600" />
              <h3 className="text-sm font-semibold text-stone-800">
                Penugasan Petugas & Kebutuhan Output
              </h3>
            </div>
            <p className="text-[11px] text-stone-400 mb-4">
              Centang petugas yang ditugaskan, lalu pilih kebutuhan output yang harus dikerjakan per petugas.
            </p>

            {/* Get all selected workers across all roles */}
            {(() => {
              const selectedWorkers = Object.entries(selectedUsers)
                .flatMap(([role, userIds]) => 
                  userIds.map(uid => {
                    const user = users.find(u => u.id === uid)
                    return user ? { userId: uid, name: user.name, role, avatar: user.avatar } : null
                  })
                )
                .filter(Boolean) as Array<{ userId: string; name: string; role: string; avatar: string }>

              if (selectedWorkers.length === 0) {
                return (
                  <div className="text-center py-8 bg-stone-50 rounded-xl border border-dashed border-stone-200">
                    <Users className="w-10 h-10 text-stone-300 mx-auto mb-3" />
                    <p className="text-sm text-stone-400">Pilih petugas di bagian Pembagian Tim & Penugasan terlebih dahulu</p>
                  </div>
                )
              }

              // Group by stage then by role for cleaner display
              const workersByStage = new Map<number, Map<string, typeof selectedWorkers>>()
              selectedWorkers.forEach(w => {
                const stageConfig = ROLE_CONFIG[w.role]
                const stage = stageConfig?.stage || 1
                if (!workersByStage.has(stage)) workersByStage.set(stage, new Map())
                const stageMap = workersByStage.get(stage)!
                const existing = stageMap.get(w.role) || []
                existing.push(w)
                stageMap.set(w.role, existing)
              })

              return (
                <div className="space-y-4">
                  {Array.from(workersByStage.entries()).sort(([a], [b]) => a - b).map(([stage, roleMap]) => (
                    <div key={stage} className="border border-stone-200 rounded-2xl overflow-hidden">
                      {/* Stage header */}
                      <div className="bg-gradient-to-r from-violet-50 to-purple-50 px-4 py-2.5 border-b border-violet-100">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold text-violet-600 uppercase tracking-wider">
                            Tahap {stage}: {STAGES[stage]}
                          </span>
                          <Badge variant="outline" className="text-[9px] text-violet-600 border-violet-200 bg-violet-50">
                            {Array.from(roleMap.values()).flat().length} petugas
                          </Badge>
                        </div>
                      </div>
                      
                      {/* Workers by role */}
                      <div className="divide-y divide-stone-100">
                        {Array.from(roleMap.entries()).map(([role, workers]) => (
                          <div key={role}>
                            {/* Role sub-header */}
                            <div className="bg-stone-50/80 px-4 py-1.5 border-b border-stone-100">
                              <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">
                                {getRoleDisplayName(role)}
                              </span>
                            </div>
                            <div className="divide-y divide-stone-50">
                              {workers.map(worker => {
                                const assignedOutputs = workerOutputs[worker.userId] || []
                                const isChecked = assignedOutputs.length > 0
                                const hasLainnya = assignedOutputs.includes('Lainnya')

                                return (
                                  <div key={worker.userId} className={`p-3 transition-all ${isChecked ? 'bg-violet-50/30' : 'bg-white'}`}>
                                    {/* Worker row: checkbox + name + dropdown */}
                                    <div className="flex items-center gap-3">
                                      <Checkbox
                                        checked={isChecked}
                                        onCheckedChange={(checked) => {
                                          if (!checked) {
                                            // Uncheck: remove all outputs for this worker
                                            setWorkerOutputs(prev => {
                                              const { [worker.userId]: _, ...rest } = prev
                                              return rest
                                            })
                                            setWorkerCustomOutput(prev => {
                                              const { [worker.userId]: _, ...rest } = prev
                                              return rest
                                            })
                                          }
                                        }}
                                      />
                                      <div className="flex items-center gap-2 flex-1 min-w-0">
                                        <div className="w-7 h-7 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center text-[11px] font-bold shrink-0">
                                          {worker.name.charAt(0).toUpperCase()}
                                        </div>
                                        <span className="text-xs font-semibold text-stone-700 truncate">{worker.name}</span>
                                      </div>
                                      {/* Add output dropdown */}
                                      <Select
                                        onValueChange={(value) => {
                                          addWorkerOutput(worker.userId, value)
                                        }}
                                      >
                                        <SelectTrigger className="w-[160px] h-8 text-xs">
                                          <SelectValue placeholder="+ Tambah output..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {OPSI_OUTPUT.filter(o => !assignedOutputs.includes(o)).map(output => (
                                            <SelectItem key={output} value={output} className="text-xs">
                                              {output}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </div>

                                    {/* Assigned output badges */}
                                    {assignedOutputs.length > 0 && (
                                      <div className="mt-2 ml-9 flex flex-wrap gap-1.5">
                                        {assignedOutputs.map(output => (
                                          <Badge
                                            key={output}
                                            variant="secondary"
                                            className="bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] pr-1 gap-1"
                                          >
                                            {output}
                                            <button
                                              type="button"
                                              onClick={() => removeWorkerOutput(worker.userId, output)}
                                              className="ml-0.5 hover:text-red-500 transition-colors"
                                            >
                                              <X className="w-3 h-3" />
                                            </button>
                                          </Badge>
                                        ))}
                                      </div>
                                    )}

                                    {/* Custom "Lainnya" input */}
                                    {hasLainnya && (
                                      <div className="mt-2 ml-9">
                                        <Input
                                          placeholder="Keterangan output lainnya..."
                                          value={workerCustomOutput[worker.userId] || ''}
                                          onChange={e => setWorkerCustomOutput(prev => ({ ...prev, [worker.userId]: e.target.value }))}
                                          className="h-7 text-xs"
                                        />
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}

                  {/* Summary of all output needs aggregated */}
                  {(() => {
                    const allOutputs = new Set<string>()
                    Object.values(workerOutputs).forEach(outputs => outputs.forEach(o => allOutputs.add(o)))
                    if (allOutputs.size === 0) return null
                    return (
                      <div className="p-4 bg-violet-50/50 border border-violet-100 rounded-2xl">
                        <p className="text-[10px] font-bold text-violet-600 uppercase tracking-wider mb-2">
                          Ringkasan Kebutuhan Output
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {Array.from(allOutputs).map(output => (
                            <Badge key={output} variant="outline" className="bg-white text-violet-700 border-violet-200 text-[10px]">
                              {output}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )
                  })()}
                </div>
              )
            })()}
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
            <p className="text-sm text-indigo-700/80 mb-2 ml-8">
              Pilih struktur folder dan tentukan user mana saja yang memiliki akses.
            </p>
            <p className="text-xs text-indigo-600/70 mb-4 ml-8">
              ✅ Folder <span className="font-semibold">PRODUKSI</span> &amp; <span className="font-semibold">PASCA PRODUKSI</span> sudah tercentang otomatis. Akses Download/Upload setiap petugas juga diisi otomatis sesuai tahapan kerjanya — Manager tetap dapat menyesuaikan manual.
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
                        {folder.accessHint && (
                          <div className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-full px-2 py-0.5">
                            <span aria-hidden>🔒</span>
                            <span>Akses otomatis: {folder.accessHint}</span>
                          </div>
                        )}
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
                            const roleUsers = (selectedUsers[role] || []).map(uid => users.find(u => u.id === uid)).filter(Boolean) as Array<{id: string; name: string}>
                            if (roleUsers.length === 0) return null
                            return (
                              <div key={role} className="space-y-1">
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
                                {roleUsers.map(user => {
                                  const access = folderUserAccess[folder.id]?.[user.id] || { download: true, upload: true }
                                  return (
                                    <div key={user.id} className="flex items-center justify-between gap-2 px-2 py-1 bg-stone-50 rounded-lg ml-2">
                                      <span className="text-[10px] text-stone-400 truncate">{user.name}</span>
                                      {isRoleAssigned && (
                                        <div className="flex items-center gap-3 shrink-0">
                                          <label className="flex items-center gap-1 cursor-pointer select-none">
                                            <Checkbox
                                              checked={access.download}
                                              onCheckedChange={() => toggleFolderUserAccess(folder.id, user.id, 'download')}
                                              className="h-3.5 w-3.5"
                                            />
                                            <span className="text-[10px] font-semibold text-stone-500">DL</span>
                                          </label>
                                          <label className="flex items-center gap-1 cursor-pointer select-none">
                                            <Checkbox
                                              checked={access.upload}
                                              onCheckedChange={() => toggleFolderUserAccess(folder.id, user.id, 'upload')}
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
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Custom Folders */}
            {customFolders.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 ml-8 mt-4">
                {customFolders.map(folder => {
                  const isSelected = selectedFolders.includes(folder.id)
                  return (
                    <div
                      key={folder.id}
                      className={cn(
                        "flex flex-col p-4 rounded-xl border-2 transition-all",
                        isSelected 
                          ? "bg-white border-teal-500 shadow-sm" 
                          : "bg-stone-50/50 border-transparent hover:border-teal-200"
                      )}
                    >
                      <div className="flex items-start gap-3 w-full">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleFolder(folder.id)}
                        />
                        <div className="flex-1">
                          <div className="text-[10px] font-bold text-teal-500 uppercase tracking-wider">
                            FOLDER KUSTOM
                          </div>
                          <div className="text-sm font-bold text-stone-800">{folder.name}</div>
                          {folder.desc && <div className="text-xs text-stone-500 mt-1">{folder.desc}</div>}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-stone-400 hover:text-red-500 shrink-0"
                          onClick={() => removeCustomFolder(folder.id)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>

                      {isSelected && activeRolesForAssignment.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-teal-100 w-full ml-7 pl-0.5">
                          <p className="text-[10px] font-bold text-teal-600/70 mb-2 uppercase tracking-wider">
                            Akses Untuk:
                          </p>
                          <div className="space-y-2">
                            {activeRolesForAssignment.map(role => {
                              const isRoleAssigned = (folderRoles[folder.id] || []).includes(role)
                              const roleUsers = (selectedUsers[role] || []).map(uid => users.find(u => u.id === uid)).filter(Boolean) as Array<{id: string; name: string}>
                              if (roleUsers.length === 0) return null
                              return (
                                <div key={role} className="space-y-1">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className={cn(
                                      "h-auto px-2 py-1 text-[10px] shrink-0",
                                      isRoleAssigned
                                        ? "bg-teal-600 text-white shadow-sm"
                                        : "bg-stone-100 text-stone-500 border border-stone-200"
                                    )}
                                    onClick={(e) => { e.preventDefault(); toggleRoleForFolder(folder.id, role); }}
                                  >
                                    {role}
                                  </Button>
                                  {roleUsers.map(user => {
                                    const access = folderUserAccess[folder.id]?.[user.id] || { download: true, upload: true }
                                    return (
                                      <div key={user.id} className="flex items-center justify-between gap-2 px-2 py-1 bg-stone-50 rounded-lg ml-2">
                                        <span className="text-[10px] text-stone-400 truncate">{user.name}</span>
                                        {isRoleAssigned && (
                                          <div className="flex items-center gap-3 shrink-0">
                                            <label className="flex items-center gap-1 cursor-pointer select-none">
                                              <Checkbox
                                                checked={access.download}
                                                onCheckedChange={() => toggleFolderUserAccess(folder.id, user.id, 'download')}
                                                className="h-3.5 w-3.5"
                                              />
                                              <span className="text-[10px] font-semibold text-stone-500">DL</span>
                                            </label>
                                            <label className="flex items-center gap-1 cursor-pointer select-none">
                                              <Checkbox
                                                checked={access.upload}
                                                onCheckedChange={() => toggleFolderUserAccess(folder.id, user.id, 'upload')}
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
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Create New Folder Button & Form */}
            <div className="ml-8 mt-4">
              {showNewFolderForm ? (
                <div className="p-4 rounded-xl border-2 border-dashed border-teal-300 bg-teal-50/30 space-y-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Folder className="w-4 h-4 text-teal-600" />
                    <span className="text-xs font-bold text-teal-700 uppercase tracking-wider">Folder Baru</span>
                  </div>
                  <Input
                    value={newFolderName}
                    onChange={e => setNewFolderName(e.target.value)}
                    placeholder="Nama folder kustom..."
                    className="text-sm"
                  />
                  <Input
                    value={newFolderDesc}
                    onChange={e => setNewFolderDesc(e.target.value)}
                    placeholder="Deskripsi folder..."
                    className="text-sm"
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className="bg-teal-600 hover:bg-teal-700 text-white text-xs"
                      onClick={addCustomFolder}
                    >
                      Tambah
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-xs text-stone-500"
                      onClick={() => {
                        setShowNewFolderForm(false)
                        setNewFolderName('')
                        setNewFolderDesc('')
                      }}
                    >
                      Batal
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-dashed border-teal-300 text-teal-600 hover:bg-teal-50 hover:text-teal-700 gap-1"
                  onClick={() => setShowNewFolderForm(true)}
                >
                  <span>+</span> Buat Folder Baru
                </Button>
              )}
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
