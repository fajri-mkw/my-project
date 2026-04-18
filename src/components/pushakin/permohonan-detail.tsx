'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  Zap,
  CheckCircle2,
  Clock,
  SkipForward,
  Circle,
  Loader2,
  Globe,
  Share2,
  FileText,
  Camera,
  PenLine,
  Send,
} from 'lucide-react'
import type { Permohonan, StepStatus } from '@/types/pushakin'
import {
  STATUS_LABELS,
  STATUS_COLORS,
  STEP_STATUS_LABELS,
  STEP_STATUS_COLORS,
  WORKFLOW_STEPS,
  ROLE_LABELS,
} from '@/types/pushakin'
import { format } from 'date-fns'
import { id as localeId } from 'date-fns/locale'

interface PermohonanDetailProps {
  item: Permohonan | null
  open: boolean
  onClose: () => void
  onCompleteStep: (permohonanId: string, data: Record<string, unknown>) => Promise<void>
}

const STEP_ICONS: Record<string, React.ReactNode> = {
  reporter: <FileText className="h-4 w-4" />,
  fotografer: <Camera className="h-4 w-4" />,
  editor: <PenLine className="h-4 w-4" />,
  publisherWeb: <Globe className="h-4 w-4" />,
  publisherSocial: <Share2 className="h-4 w-4" />,
}

function StepStatusIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case 'COMPLETED':
      return <CheckCircle2 className="h-5 w-5 text-emerald-500" />
    case 'IN_PROGRESS':
      return <Clock className="h-5 w-5 text-amber-500 animate-pulse" />
    case 'SKIPPED':
      return <SkipForward className="h-5 w-5 text-purple-400" />
    default:
      return <Circle className="h-5 w-5 text-gray-300" />
  }
}

function StepCompletionForm({
  step,
  onSubmit,
  loading,
}: {
  step: string
  onSubmit: (data: Record<string, unknown>) => void
  loading: boolean
}) {
  const [content, setContent] = useState('')
  const [link, setLink] = useState('')

  const handleSubmit = () => {
    const data: Record<string, unknown> = { step }
    if (step === 'reporter') data.content = content
    if (step === 'fotografer') data.content = content
    if (step === 'editor') data.content = content
    if (step === 'publisherWeb') data.linkPublikasiWeb = link
    if (step === 'publisherSocial') data.linkPublikasiSocial = link
    onSubmit(data)
  }

  if (step === 'publisherWeb' || step === 'publisherSocial') {
    return (
      <div className="space-y-3 pt-2">
        <div className="space-y-2">
          <Label className="text-xs">
            {step === 'publisherWeb' ? 'Link Publikasi Web' : 'Link Publikasi Social Media'}
          </Label>
          <Input
            placeholder={step === 'publisherWeb' ? 'https://pushakin.id/berita/...' : 'https://instagram.com/...'}
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
        </div>
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={loading}
          className={step === 'publisherWeb' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-pink-600 hover:bg-pink-700'}
        >
          {loading ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <Send className="mr-1 h-3 w-3" />
          )}
          Selesai Publikasi
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3 pt-2">
      <div className="space-y-2">
        <Label className="text-xs">Konten / Catatan</Label>
        <Textarea
          placeholder={step === 'reporter' ? 'Tulis berita...' : step === 'fotografer' ? 'Link foto...' : 'Hasil edit...'}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={3}
        />
      </div>
      <Button size="sm" onClick={handleSubmit} disabled={loading}>
        {loading ? (
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        ) : (
          <CheckCircle2 className="mr-1 h-3 w-3" />
        )}
        Selesaikan Tugas
      </Button>
    </div>
  )
}

export function PermohonanDetail({ item, open, onClose, onCompleteStep }: PermohonanDetailProps) {
  const [completingStep, setCompletingStep] = useState<string | null>(null)

  if (!item) return null

  const handleComplete = async (data: Record<string, unknown>) => {
    setCompletingStep(data.step as string)
    try {
      await onCompleteStep(item.id, data)
    } finally {
      setCompletingStep(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            {item.fastTrack && (
              <Badge className="bg-amber-500 text-white text-xs px-2">
                <Zap className="h-3 w-3 mr-1" />
                FAST TRACK
              </Badge>
            )}
            <span className="truncate">{item.judul}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Meta info */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={`${STATUS_COLORS[item.status as keyof typeof STATUS_COLORS]} text-xs`}>
              {STATUS_LABELS[item.status as keyof typeof STATUS_LABELS]}
            </Badge>
            <span className="text-xs text-muted-foreground">
              Oleh: {item.manager?.name}
            </span>
            <span className="text-xs text-muted-foreground">
              {format(new Date(item.createdAt), 'dd MMM yyyy, HH:mm', { locale: localeId })}
            </span>
          </div>

          {/* Description */}
          {item.deskripsi && (
            <p className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
              {item.deskripsi}
            </p>
          )}

          {/* Fast Track Notice */}
          {item.fastTrack && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 flex items-start gap-2">
              <Zap className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <div className="text-xs text-amber-700">
                <span className="font-medium">Fast Track Aktif</span> — Reporter, Fotografer, dan Editor dilewati. Langsung ke Publisher.
              </div>
            </div>
          )}

          <Separator />

          {/* Workflow Steps */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold">Alur Workflow</h4>
            <div className="space-y-2">
              {WORKFLOW_STEPS.map((step, idx) => {
                const status = item[step.statusField] as StepStatus
                const user = step.key === 'reporter' ? item.reporter
                  : step.key === 'fotografer' ? item.fotografer
                  : step.key === 'editor' ? item.editor
                  : step.key === 'publisherWeb' ? item.publisherWeb
                  : item.publisherSocial

                const isSkipped = status === 'SKIPPED'
                const isActive = status === 'IN_PROGRESS'
                const isCompleted = status === 'COMPLETED'
                const isPending = status === 'PENDING'

                // Don't show skipped steps in fast track with collapsed view
                if (isSkipped && item.fastTrack) {
                  return (
                    <div
                      key={step.key}
                      className="flex items-center gap-3 py-2 px-3 rounded-lg bg-purple-50/50 border border-purple-100 opacity-60"
                    >
                      <SkipForward className="h-4 w-4 text-purple-400" />
                      <div className="flex-1">
                        <span className="text-xs text-purple-600 line-through">{step.label}</span>
                      </div>
                      <Badge variant="outline" className="bg-purple-50 text-purple-500 border-purple-200 text-[10px]">
                        Dilewati
                      </Badge>
                    </div>
                  )
                }

                return (
                  <Card
                    key={step.key}
                    className={`border transition-all ${
                      isActive
                        ? 'border-amber-300 bg-amber-50/30 shadow-sm'
                        : isCompleted
                        ? 'border-emerald-200 bg-emerald-50/20'
                        : 'border-gray-100'
                    }`}
                  >
                    <CardContent className="p-3">
                      <div className="flex items-center gap-3">
                        <StepStatusIcon status={status} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{step.label}</span>
                            <Badge
                              variant="outline"
                              className={`${STEP_STATUS_COLORS[status]} text-[10px] px-1.5 py-0`}
                            >
                              {STEP_STATUS_LABELS[status]}
                            </Badge>
                          </div>
                          {user && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {user.name} ({ROLE_LABELS[user.role as keyof typeof ROLE_LABELS]})
                            </p>
                          )}
                          {isCompleted && step.completedAtField && (
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              Selesai: {format(new Date(item[step.completedAtField] as string), 'dd MMM yyyy, HH:mm', { locale: localeId })}
                            </p>
                          )}
                        </div>
                        <div className="text-muted-foreground">
                          {STEP_ICONS[step.key]}
                        </div>
                      </div>

                      {/* Completion form for active step */}
                      {isActive && (
                        <div className="mt-3 pl-8">
                          <StepCompletionForm
                            step={step.key}
                            onSubmit={handleComplete}
                            loading={completingStep === step.key}
                          />
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </div>

          {/* Published links */}
          {(item.linkPublikasiWeb || item.linkPublikasiSocial) && (
            <>
              <Separator />
              <div className="space-y-2">
                <h4 className="text-sm font-semibold">Link Publikasi</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {item.linkPublikasiWeb && (
                    <div className="flex items-center gap-2 text-xs bg-emerald-50 rounded-lg p-2">
                      <Globe className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      <a
                        href={item.linkPublikasiWeb}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-emerald-700 hover:underline truncate"
                      >
                        {item.linkPublikasiWeb}
                      </a>
                    </div>
                  )}
                  {item.linkPublikasiSocial && (
                    <div className="flex items-center gap-2 text-xs bg-pink-50 rounded-lg p-2">
                      <Share2 className="h-3.5 w-3.5 text-pink-600 shrink-0" />
                      <a
                        href={item.linkPublikasiSocial}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-pink-700 hover:underline truncate"
                      >
                        {item.linkPublikasiSocial}
                      </a>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
