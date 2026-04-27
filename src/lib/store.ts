import { create } from 'zustand'

// Types — uses DB values, NOT display names
export type Role = 
  | 'Admin' 
  | 'Administrator'
  | 'Manager' 
  | 'Reporter' 
  | 'PhotographerAudio' 
  | 'VideographerAudio'
  | 'EditorMedia' 
  | 'EditorWebSocialMedia' 
  | 'GraphicDesigner'
  | 'StreamingOperator' 
  | 'PodcastOperator' 
  | 'Reviewer' 
  | 'PublisherWeb' 
  | 'PublisherSocialMedia'

// Display names for UI — maps DB values to human-readable names
export const ROLE_DISPLAY_NAMES: Record<string, string> = {
  'Admin': 'Super Admin',
  'Administrator': 'Administrator',
  'Manager': 'Manager',
  'Reporter': 'Reporter',
  'PhotographerAudio': 'Photographer & Audio',
  'VideographerAudio': 'Videographer & Audio',
  'EditorMedia': 'Editor (Media)',
  'EditorWebSocialMedia': 'Editor (Web Article & Social Media)',
  'GraphicDesigner': 'Graphic Designer',
  'StreamingOperator': 'Streaming Operator',
  'PodcastOperator': 'Podcast Operator',
  'Reviewer': 'Reviewer',
  'PublisherWeb': 'Publisher Web',
  'PublisherSocialMedia': 'Publisher Social Media'
}

// Utility: get display name for a role
export function getRoleDisplayName(role: string): string {
  return ROLE_DISPLAY_NAMES[role] || role
}

export interface User {
  id: string
  name: string
  email: string
  whatsapp: string
  avatar: string
  role: Role
}

export interface PublishLink {
  id: string
  platform: string
  url: string
}

export interface TaskData {
  link?: string
  notes?: string
  publishLinks?: PublishLink[]
  fastTracked?: boolean
}

export interface Task {
  id: string
  role: string
  stage: number
  status: 'pending' | 'completed'
  assignedTo: string | null
  data: TaskData
  revisionCount?: number
}

export interface DriveFolder {
  id: string
  folderId: string
  name: string
  desc: string
  color: string
  bg: string
  border: string
  link: string
  assignedRoles: string[]
  assignedUsers: { userId: string; userName: string; download: boolean; upload: boolean }[]
  parentFolderId?: string | null
}

export interface Project {
  id: string
  title: string
  description: string
  requesterUnit: string
  location: string
  executionTime: string
  picName: string
  picWhatsApp: string
  activityTypes: string[]
  customActivity: string
  outputNeeds: string[]
  customOutput: string
  currentStage: number
  isFastTrack: boolean
  isFastProduction: boolean
  managerId: string
  createdAt: string
  documents?: Array<{
    id: string
    name: string
    mimeType: string
    size: number
    driveFileId: string
    webViewLink: string
    uploadedAt: string
  }>
  driveFolders: DriveFolder[]
  tasks: Task[]
}

export interface Notification {
  id: string
  userId: string
  message: string
  projectId: string
  targetView: string
  read: boolean
  createdAt: Date
}

export interface Permohonan {
  id: string
  title: string
  description: string
  requesterUnit: string
  location: string
  executionTime: string
  picName: string
  picWhatsApp: string
  activityTypes: string[]
  customActivity: string
  outputNeeds: string[]
  customOutput: string
  status: 'pending' | 'forwarded' | 'rejected' | 'completed'
  adminNote: string
  documents: any[]
  administratorId: string
  managerId: string | null
  projectId: string | null
  createdAt: string
  updatedAt: string
}

export interface Surat {
  id: string
  nomorSurat: string
  jenisSurat: 'Surat Masuk' | 'Surat Keluar'
  kategori: string
  tanggalSurat: string | null
  pengirim: string | null
  penerima: string | null
  perihal: string
  deskripsi: string | null
  status: 'diterima' | 'diproses' | 'diteruskan' | 'selesai' | 'ditolak' | 'arsip'
  catatan: string | null
  documents: any[]
  driveFolderId: string | null
  driveFolderLink: string | null
  location: string | null
  executionTime: string | null
  picName: string | null
  picWhatsApp: string | null
  administratorId: string | null
  managerId: string | null
  projectId: string | null
  createdAt: string
  updatedAt: string
}

export const SURAT_KATEGORI_OPTIONS = [
  'Permohonan',
  'Undangan',
  'Pemberitahuan',
  'Laporan',
  'Surat Keputusan',
  'Lainnya'
]

export const SURAT_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  diterima: { label: 'Diterima', color: 'text-sky-700', bg: 'bg-sky-50', border: 'border-sky-200' },
  diproses: { label: 'Diproses', color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200' },
  diteruskan: { label: 'Diteruskan', color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200' },
  selesai: { label: 'Selesai', color: 'text-green-700', bg: 'bg-green-50', border: 'border-green-200' },
  ditolak: { label: 'Ditolak', color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200' },
  arsip: { label: 'Arsip', color: 'text-stone-600', bg: 'bg-stone-100', border: 'border-stone-300' },
}

export interface ProgramKegiatan {
  id: string
  nomorKegiatan: string
  jenisKegiatan: string
  kategori: string
  tanggalKegiatan: string | null
  penyelenggara: string | null
  perihal: string
  deskripsi: string | null
  status: string
  catatan: string | null
  documents: any[]
  driveFolderId: string | null
  driveFolderLink: string | null
  location: string | null
  executionTime: string | null
  picName: string | null
  picWhatsApp: string | null
  managerId: string | null
  projectId: string | null
  createdAt: string
  updatedAt: string
}

export const KEGIATAN_KATEGORI_OPTIONS = [
  'Umum',
  'Sosialisasi',
  'Pelatihan',
  'Produksi',
  'Kunjungan',
  'Lainnya'
]

export const KEGIATAN_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  direncanakan: { label: 'Direncanakan', color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200' },
  berlangsung: { label: 'Berlangsung', color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200' },
  selesai: { label: 'Selesai', color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
  ditolak: { label: 'Ditolak', color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200' },
  arsip: { label: 'Arsip', color: 'text-stone-500', bg: 'bg-stone-50', border: 'border-stone-200' },
}

export interface ProgramKegiatan {
  id: string
  nomorKegiatan: string
  jenisKegiatan: string
  kategori: string
  tanggalKegiatan: string | null
  penyelenggara: string | null
  perihal: string
  deskripsi: string | null
  status: string
  catatan: string | null
  documents: any[]
  driveFolderId: string | null
  driveFolderLink: string | null
  location: string | null
  executionTime: string | null
  picName: string | null
  picWhatsApp: string | null
  managerId: string | null
  projectId: string | null
  createdAt: string
  updatedAt: string
}

export interface SuratTugas {
  id: string
  nomorSurat: string
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
  user?: {
    id: string
    name: string
    email: string
    role: string
  }
}

export type ViewType = 
  | 'login' 
  | 'dashboard' 
  | 'create' 
  | 'project_detail' 
  | 'users' 
  | 'reports' 
  | 'profile' 
  | 'overview'
  | 'settings'
  | 'inbox'
  | 'announcements'
  | 'permohonan'
  | 'kegiatan'

export interface DialogState {
  isOpen: boolean
  type: 'alert' | 'confirm'
  message: string
  onConfirm: (() => void) | null
}

// Constants
export const STAGES: Record<number, string> = {
  0: 'Perencanaan',
  1: 'Produksi',
  2: 'Pasca Produksi',
  3: 'Review',
  4: 'Publikasi',
  5: 'Selesai'
}

export const ROLES: Role[] = [
  'Admin', 'Administrator', 'Manager', 'Reporter', 'PhotographerAudio', 'VideographerAudio',
  'EditorMedia', 'EditorWebSocialMedia', 'GraphicDesigner',
  'StreamingOperator', 'PodcastOperator', 'Reviewer', 'PublisherWeb', 'PublisherSocialMedia'
]

export const ROLE_CONFIG: Record<string, { stage: number; type: string; icon: string }> = {
  'Reporter': { stage: 1, type: 'upload', icon: 'FileText' },
  'PhotographerAudio': { stage: 1, type: 'upload', icon: 'FileImage' },
  'VideographerAudio': { stage: 1, type: 'upload', icon: 'FileVideo' },
  'GraphicDesigner': { stage: 1, type: 'upload', icon: 'FileImage' },
  
  'EditorMedia': { stage: 2, type: 'download_upload', icon: 'FileVideo' },
  'EditorWebSocialMedia': { stage: 2, type: 'download_upload', icon: 'FileText' },
  'StreamingOperator': { stage: 2, type: 'paste_streaming', icon: 'PlayCircle' },
  'PodcastOperator': { stage: 2, type: 'paste_youtube', icon: 'FileAudio' },
  
  'Reviewer': { stage: 3, type: 'review', icon: 'AlertCircle' },
  
  'PublisherWeb': { stage: 4, type: 'download_link', icon: 'Link' },
  'PublisherSocialMedia': { stage: 4, type: 'download_link', icon: 'Link' },
}

export const FOLDER_OPTIONS = [
  { id: 'raw', title: '1. FOLDER', name: 'RAW FOLDER (Hasil Mentah)', desc: 'Untuk upload mentahan: Reporter, Fotografer, Videografer, Desain Grafis.', color: 'text-stone-600', bg: 'bg-stone-100', border: 'border-stone-200' },
  { id: 'revised', title: '2. FOLDER', name: 'REVISED FOLDER (Draft & Editing)', desc: 'Untuk Editor, Reviewer, dan Publisher. Direview oleh QC.', color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200' },
  { id: 'final', title: '3. FOLDER', name: 'FINAL PRODUCT (Siap Publish)', desc: 'Hasil akhir yang siap didownload Publisher Web/Sosmed.', color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200' },
  { id: 'desain', title: '4. FOLDER', name: 'DESAIN FOLDER (Aset Visual)', desc: 'Khusus untuk penyimpanan file project desain.', color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' },
  { id: 'lainnya', title: '5. FOLDER', name: 'LAINNYA (Folder Tambahan)', desc: 'Folder kustom tambahan untuk keperluan logistik.', color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200' }
]

// Store Interface
interface AppState {
  // Data
  users: User[]
  currentUser: User | null
  originalUser: User | null  // Admin user before impersonation
  projects: Project[]
  notifications: Notification[]
  suratTugas: SuratTugas[]
  permohonanList: Permohonan[]
  preFillFromPermohonan: Permohonan | null
  preFillFromSurat: Surat | null
  suratList: Surat[]
  kegiatanList: ProgramKegiatan[]
  
  // UI State
  activeView: ViewType
  selectedProjectId: string | null
  isCreatingProject: boolean
  isEditProjectModalOpen: boolean
  editProjectData: Project | null
  
  // Dialog
  dialog: DialogState
  
  // Impersonation
  isImpersonating: boolean
  
  // Actions - Users
  setUsers: (users: User[]) => void
  setCurrentUser: (user: User | null) => void
  updateUser: (user: User) => void
  addUser: (user: User) => void
  deleteUser: (userId: string) => void
  startImpersonate: (targetUser: User) => void
  stopImpersonate: () => void
  
  // Actions - Projects
  setProjects: (projects: Project[]) => void
  addProject: (project: Project) => void
  updateProject: (project: Project) => void
  deleteProject: (projectId: string) => void
  
  // Actions - Tasks
  completeTask: (projectId: string, taskId: string, taskData: TaskData) => void
  reviseTask: (projectId: string, taskId: string, taskData: TaskData) => void
  rejectReview: (projectId: string) => void
  
  // Actions - Notifications
  addNotification: (notification: Notification) => void
  markNotifRead: (id: string) => void
  setNotifications: (notifications: Notification[]) => void
  
  // Actions - Surat Tugas
  setSuratTugas: (suratTugas: SuratTugas[]) => void
  addSuratTugas: (surat: SuratTugas) => void
  markSuratRead: (id: string) => void

  // Actions - Permohonan
  setPermohonanList: (list: Permohonan[]) => void
  addPermohonan: (item: Permohonan) => void
  updatePermohonan: (item: Permohonan) => void
  deletePermohonan: (id: string) => void
  setPreFillFromPermohonan: (item: Permohonan | null) => void
  setPreFillFromSurat: (item: Surat | null) => void

  // Actions - Program Kegiatan
  setKegiatanList: (list: ProgramKegiatan[]) => void
  addKegiatan: (kegiatan: ProgramKegiatan) => void
  updateKegiatan: (kegiatan: ProgramKegiatan) => void
  deleteKegiatan: (id: string) => void

  // Actions - Surat
  setSuratList: (list: Surat[]) => void
  addSurat: (item: Surat) => void
  updateSurat: (item: Surat) => void
  deleteSurat: (id: string) => void
  
  // Actions - UI
  setActiveView: (view: ViewType) => void
  setSelectedProjectId: (id: string | null) => void
  setIsCreatingProject: (value: boolean) => void
  setIsEditProjectModalOpen: (value: boolean) => void
  setEditProjectData: (data: Project | null) => void
  
  // Actions - Dialog
  showAlert: (message: string) => void
  showConfirm: (message: string, onConfirm: () => void) => void
  closeDialog: () => void
  
  // Derived
  getMyNotifications: () => Notification[]
  getUnreadCount: () => number
  getVisibleProjects: () => Project[]
  getCompletedProjects: () => Project[]
  getMySuratTugas: () => SuratTugas[]
  getUnreadSuratCount: () => number
}

export const useAppStore = create<AppState>((set, get) => ({
  // Initial State
  users: [],
  currentUser: null,
  originalUser: null,
  projects: [],
  notifications: [],
  suratTugas: [],
  permohonanList: [],
  preFillFromPermohonan: null,
  preFillFromSurat: null,
  suratList: [],
  kegiatanList: [],
  
  activeView: 'login',
  selectedProjectId: null,
  isCreatingProject: false,
  isEditProjectModalOpen: false,
  editProjectData: null,
  
  dialog: { isOpen: false, type: 'alert', message: '', onConfirm: null },
  
  // Impersonation
  isImpersonating: false,
  
  // User Actions
  setUsers: (users) => set({ users }),
  setCurrentUser: (user) => set({ currentUser: user, activeView: user ? 'dashboard' : 'login' }),
  updateUser: (user) => set((state) => {
    const updatedUsers = state.users.map(u => u.id === user.id ? user : u)
    const updatedCurrentUser = state.currentUser?.id === user.id ? user : state.currentUser
    return { users: updatedUsers, currentUser: updatedCurrentUser }
  }),
  addUser: (user) => set((state) => ({ users: [user, ...state.users] })),
  deleteUser: (userId) => set((state) => ({ users: state.users.filter(u => u.id !== userId) })),
  
  // Impersonation Actions
  startImpersonate: (targetUser) => set((state) => ({
    originalUser: state.currentUser,
    currentUser: targetUser,
    isImpersonating: true,
    activeView: 'dashboard' as ViewType,
    selectedProjectId: null
  })),
  stopImpersonate: () => set((state) => ({
    currentUser: state.originalUser,
    originalUser: null,
    isImpersonating: false,
    activeView: 'users' as ViewType,
    selectedProjectId: null
  })),
  
  // Project Actions
  setProjects: (projects) => set({ projects }),
  addProject: (project) => set((state) => ({ projects: [...state.projects, project] })),
  updateProject: (project) => set((state) => ({
    projects: state.projects.map(p => p.id === project.id ? project : p)
  })),
  deleteProject: (projectId) => set((state) => {
    const newSelectedId = state.selectedProjectId === projectId ? null : state.selectedProjectId
    const newActiveView = state.selectedProjectId === projectId ? 'dashboard' : state.activeView
    return { 
      projects: state.projects.filter(p => p.id !== projectId),
      selectedProjectId: newSelectedId,
      activeView: newActiveView
    }
  }),
  
  // Task Actions
  completeTask: (projectId, taskId, taskData) => set((state) => {
    const updatedProjects = state.projects.map(p => {
      if (p.id !== projectId) return p
      
      let updatedTasks = p.tasks.map(t => 
        t.id === taskId ? { ...t, status: 'completed' as const, data: taskData } : t
      )
      
      // For Fast Production: no stage gating, all tasks can be done in parallel
      if (p.isFastProduction) {
        const allDone = updatedTasks.every(t => t.status === 'completed')
        if (allDone) {
          return { ...p, tasks: updatedTasks, currentStage: 5 }
        }
        // Keep currentStage at the lowest stage that still has pending tasks
        const pendingStages = updatedTasks.filter(t => t.status === 'pending').map(t => t.stage)
        const minPending = pendingStages.length > 0 ? Math.min(...pendingStages) : p.currentStage
        return { ...p, tasks: updatedTasks, currentStage: minPending }
      }
      
      const currentStageTasks = updatedTasks.filter(t => t.stage === p.currentStage)
      const allCurrentDone = currentStageTasks.length > 0 && currentStageTasks.every(t => t.status === 'completed')
      
      let nextStage = p.currentStage
      if (allCurrentDone) {
        nextStage = p.currentStage + 1
        // Fast Track: skip stages 1-3, jump directly to stage 4 (Publikasi)
        if (p.isFastTrack && nextStage < 4) {
          nextStage = 4
          // Auto-complete all tasks in skipped stages
          updatedTasks = updatedTasks.map(t => {
            if (t.stage >= 1 && t.stage <= 3 && t.status === 'pending') {
              return { ...t, status: 'completed' as const, data: { fastTracked: true } }
            }
            return t
          })
        }
      }
      
      return { ...p, tasks: updatedTasks, currentStage: nextStage }
    })
    
    return { projects: updatedProjects }
  }),
  
  reviseTask: (projectId, taskId, taskData) => set((state) => {
    const updatedProjects = state.projects.map(p => {
      if (p.id !== projectId) return p
      const updatedTasks = p.tasks.map(t =>
        t.id === taskId
          ? { ...t, status: 'completed' as const, data: taskData, revisionCount: (t.revisionCount || 0) + 1 }
          : t
      )
      return { ...p, tasks: updatedTasks }
    })
    return { projects: updatedProjects }
  }),
  
  rejectReview: (projectId) => set((state) => {
    const updatedProjects = state.projects.map(p => {
      if (p.id !== projectId) return p
      
      const updatedTasks = p.tasks.map(t => {
        if (t.stage === 2 || t.stage === 3) return { ...t, status: 'pending' as const, data: {} }
        return t
      })
      
      return { ...p, tasks: updatedTasks, currentStage: 2 }
    })
    
    return { projects: updatedProjects }
  }),
  
  // Notification Actions
  addNotification: (notification) => set((state) => ({
    notifications: [notification, ...state.notifications]
  })),
  markNotifRead: (id) => set((state) => ({
    notifications: state.notifications.map(n => n.id === id ? { ...n, read: true } : n)
  })),
  setNotifications: (notifications) => set({ notifications }),
  
  // Surat Tugas Actions
  setSuratTugas: (suratTugas) => set({ suratTugas }),
  addSuratTugas: (surat) => set((state) => ({
    suratTugas: [surat, ...state.suratTugas]
  })),
  markSuratRead: (id) => set((state) => ({
    suratTugas: state.suratTugas.map(s => s.id === id ? { ...s, read: true } : s)
  })),

  // Permohonan Actions
  setPermohonanList: (list) => set({ permohonanList: list }),
  addPermohonan: (item) => set((state) => ({ permohonanList: [item, ...state.permohonanList] })),
  updatePermohonan: (item) => set((state) => ({
    permohonanList: state.permohonanList.map(p => p.id === item.id ? item : p)
  })),
  deletePermohonan: (id) => set((state) => ({
    permohonanList: state.permohonanList.filter(p => p.id !== id)
  })),
  setPreFillFromPermohonan: (item) => set({ preFillFromPermohonan: item }),
  setPreFillFromSurat: (item) => set({ preFillFromSurat: item }),

  // Surat Actions
  setSuratList: (list) => set({ suratList: list }),
  addSurat: (item) => set((state) => ({ suratList: [item, ...state.suratList] })),
  updateSurat: (item) => set((state) => ({
    suratList: state.suratList.map(s => s.id === item.id ? item : s)
  })),
  deleteSurat: (id) => set((state) => ({
    suratList: state.suratList.filter(s => s.id !== id)
  })),

  // Program Kegiatan Actions
  setKegiatanList: (list) => set({ kegiatanList: list }),
  addKegiatan: (kegiatan) => set((state) => ({ kegiatanList: [kegiatan, ...state.kegiatanList] })),
  updateKegiatan: (kegiatan) => set((state) => ({
    kegiatanList: state.kegiatanList.map(k => k.id === kegiatan.id ? kegiatan : k)
  })),
  deleteKegiatan: (id) => set((state) => ({
    kegiatanList: state.kegiatanList.filter(k => k.id !== id)
  })),

  // UI Actions
  setActiveView: (view) => set({ activeView: view }),
  setSelectedProjectId: (id) => set({ selectedProjectId: id }),
  setIsCreatingProject: (value) => set({ isCreatingProject: value }),
  setIsEditProjectModalOpen: (value) => set({ isEditProjectModalOpen: value }),
  setEditProjectData: (data) => set({ editProjectData: data }),
  
  // Dialog Actions
  showAlert: (message) => set({ dialog: { isOpen: true, type: 'alert', message, onConfirm: null } }),
  showConfirm: (message, onConfirm) => set({ dialog: { isOpen: true, type: 'confirm', message, onConfirm } }),
  closeDialog: () => set({ dialog: { isOpen: false, type: 'alert', message: '', onConfirm: null } }),
  
  // Derived Getters
  getMyNotifications: () => {
    const state = get()
    return state.currentUser ? state.notifications.filter(n => n.userId === state.currentUser!.id) : []
  },
  getUnreadCount: () => {
    const state = get()
    return state.currentUser ? state.notifications.filter(n => n.userId === state.currentUser!.id && !n.read).length : 0
  },
  getVisibleProjects: () => {
    const state = get()
    if (!state.currentUser) return []
    // All users see the same real-time project data
    return state.projects
  },
  getCompletedProjects: () => {
    const state = get()
    return state.projects.filter(p => p.currentStage === 5)
  },
  getMySuratTugas: () => {
    const state = get()
    return state.currentUser ? state.suratTugas.filter(s => s.userId === state.currentUser!.id) : []
  },
  getUnreadSuratCount: () => {
    const state = get()
    return state.currentUser ? state.suratTugas.filter(s => s.userId === state.currentUser!.id && !s.read).length : 0
  }
}))
