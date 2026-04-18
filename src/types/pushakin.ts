// ============================================================
// Pushakin Flows — Type Definitions
// ============================================================

export type UserRole =
  | 'MANAGER'
  | 'REPORTER'
  | 'FOTOGRAFER'
  | 'EDITOR'
  | 'PUBLISHER_WEB'
  | 'PUBLISHER_SOCIAL_MEDIA'

export type PermohonanStatus =
  | 'DRAFT'
  | 'IN_PROGRESS'
  | 'PUBLISHING'
  | 'COMPLETED'
  | 'REJECTED'

export type StepStatus = 'PENDING' | 'SKIPPED' | 'IN_PROGRESS' | 'COMPLETED'

export const ROLE_LABELS: Record<UserRole, string> = {
  MANAGER: 'Manager',
  REPORTER: 'Reporter',
  FOTOGRAFER: 'Fotografer',
  EDITOR: 'Editor',
  PUBLISHER_WEB: 'Publisher Web',
  PUBLISHER_SOCIAL_MEDIA: 'Publisher Social Media',
}

export const STATUS_LABELS: Record<PermohonanStatus, string> = {
  DRAFT: 'Draft',
  IN_PROGRESS: 'Berlangsung',
  PUBLISHING: 'Dipublikasi',
  COMPLETED: 'Selesai',
  REJECTED: 'Ditolak',
}

export const STEP_STATUS_LABELS: Record<StepStatus, string> = {
  PENDING: 'Menunggu',
  SKIPPED: 'Dilewati',
  IN_PROGRESS: 'Berlangsung',
  COMPLETED: 'Selesai',
}

export const STATUS_COLORS: Record<PermohonanStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-700 border-gray-200',
  IN_PROGRESS: 'bg-amber-50 text-amber-700 border-amber-200',
  PUBLISHING: 'bg-sky-50 text-sky-700 border-sky-200',
  COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-red-50 text-red-700 border-red-200',
}

export const STEP_STATUS_COLORS: Record<StepStatus, string> = {
  PENDING: 'bg-gray-100 text-gray-600 border-gray-200',
  SKIPPED: 'bg-purple-50 text-purple-600 border-purple-200',
  IN_PROGRESS: 'bg-amber-50 text-amber-600 border-amber-200',
  COMPLETED: 'bg-emerald-50 text-emerald-600 border-emerald-200',
}

export interface PermohonanUser {
  id: string
  name: string
  email: string
  role: string
}

export interface Permohonan {
  id: string
  judul: string
  deskripsi: string | null
  fastTrack: boolean
  status: string
  managerId: string
  reporterId: string | null
  fotograferId: string | null
  editorId: string | null
  publisherWebId: string | null
  publisherSocialId: string | null
  reporterStatus: string
  fotograferStatus: string
  editorStatus: string
  publisherWebStatus: string
  publisherSocialStatus: string
  kontenBerita: string | null
  fotoUrls: string | null
  editedContent: string | null
  linkPublikasiWeb: string | null
  linkPublikasiSocial: string | null
  reporterCompletedAt: string | null
  fotograferCompletedAt: string | null
  editorCompletedAt: string | null
  publisherWebCompletedAt: string | null
  publisherSocialCompletedAt: string | null
  createdAt: string
  updatedAt: string
  manager: PermohonanUser
  reporter: PermohonanUser | null
  fotografer: PermohonanUser | null
  editor: PermohonanUser | null
  publisherWeb: PermohonanUser | null
  publisherSocial: PermohonanUser | null
}

export interface RekapitulasiItem {
  id: string
  permohonanId: string
  judul: string
  isFastTrack: boolean
  tanggalSelesai: string | null
  linkWeb: string | null
  linkSocial: string | null
  namaPublisherWeb: string | null
  namaPublisherSocial: string | null
  createdAt: string
}

export interface CreatePermohonanPayload {
  judul: string
  deskripsi?: string
  fastTrack: boolean
  managerId: string
  reporterId?: string
  fotograferId?: string
  editorId?: string
  publisherWebId?: string
  publisherSocialId?: string
}

export interface CompleteStepPayload {
  step: 'reporter' | 'fotografer' | 'editor' | 'publisherWeb' | 'publisherSocial'
  content?: string
  linkPublikasiWeb?: string
  linkPublikasiSocial?: string
}

// Workflow step definitions
export interface WorkflowStep {
  key: string
  label: string
  role: UserRole
  statusField: keyof Pick<Permohonan, 'reporterStatus' | 'fotograferStatus' | 'editorStatus' | 'publisherWebStatus' | 'publisherSocialStatus'>
  userField: keyof Pick<Permohonan, 'reporterId' | 'fotograferId' | 'editorId' | 'publisherWebId' | 'publisherSocialId'>
  completedAtField: keyof Pick<Permohonan, 'reporterCompletedAt' | 'fotograferCompletedAt' | 'editorCompletedAt' | 'publisherWebCompletedAt' | 'publisherSocialCompletedAt'>
  isSkippedInFastTrack: boolean
}

export const WORKFLOW_STEPS: WorkflowStep[] = [
  {
    key: 'reporter',
    label: 'Reporter',
    role: 'REPORTER',
    statusField: 'reporterStatus',
    userField: 'reporterId',
    completedAtField: 'reporterCompletedAt',
    isSkippedInFastTrack: true,
  },
  {
    key: 'fotografer',
    label: 'Fotografer',
    role: 'FOTOGRAFER',
    statusField: 'fotograferStatus',
    userField: 'fotograferId',
    completedAtField: 'fotograferCompletedAt',
    isSkippedInFastTrack: true,
  },
  {
    key: 'editor',
    label: 'Editor',
    role: 'EDITOR',
    statusField: 'editorStatus',
    userField: 'editorId',
    completedAtField: 'editorCompletedAt',
    isSkippedInFastTrack: true,
  },
  {
    key: 'publisherWeb',
    label: 'Publisher Web',
    role: 'PUBLISHER_WEB',
    statusField: 'publisherWebStatus',
    userField: 'publisherWebId',
    completedAtField: 'publisherWebCompletedAt',
    isSkippedInFastTrack: false,
  },
  {
    key: 'publisherSocial',
    label: 'Publisher Social Media',
    role: 'PUBLISHER_SOCIAL_MEDIA',
    statusField: 'publisherSocialStatus',
    userField: 'publisherSocialId',
    completedAtField: 'publisherSocialCompletedAt',
    isSkippedInFastTrack: false,
  },
]
