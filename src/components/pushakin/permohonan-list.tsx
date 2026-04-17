'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Zap, Eye, Clock, CheckCircle2, AlertCircle, FileText } from 'lucide-react'
import { format } from 'date-fns'
import { id as localeId } from 'date-fns/locale'
import type { Permohonan, PermohonanStatus } from '@/types/pushakin'
import { STATUS_LABELS, STATUS_COLORS, STEP_STATUS_LABELS, STEP_STATUS_COLORS, WORKFLOW_STEPS } from '@/types/pushakin'

interface PermohonanListProps {
  items: Permohonan[]
  onSelect: (item: Permohonan) => void
  filterStatus?: string
  filterFastTrack?: string
}

function StatusBadge({ status }: { status: PermohonanStatus }) {
  return (
    <Badge variant="outline" className={`${STATUS_COLORS[status]} text-xs font-medium`}>
      {STATUS_LABELS[status]}
    </Badge>
  )
}

function StepBadge({ status }: { status: string }) {
  const s = status as keyof typeof STEP_STATUS_LABELS
  const label = STEP_STATUS_LABELS[s] || status
  const color = STEP_STATUS_COLORS[s] || 'bg-gray-100 text-gray-600 border-gray-200'
  return (
    <Badge variant="outline" className={`${color} text-[10px] px-1.5 py-0`}>
      {label}
    </Badge>
  )
}

function WorkflowProgress({ item }: { item: Permohonan }) {
  const visibleSteps = WORKFLOW_STEPS.filter((step) => {
    // In fast track, only show publishers
    if (item.fastTrack && step.isSkippedInFastTrack) return false
    return true
  })

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {visibleSteps.map((step, i) => {
        const status = item[step.statusField] as string
        const userName = step.key === 'reporter' ? item.reporter?.name
          : step.key === 'fotografer' ? item.fotografer?.name
          : step.key === 'editor' ? item.editor?.name
          : step.key === 'publisherWeb' ? item.publisherWeb?.name
          : item.publisherSocial?.name

        return (
          <div key={step.key} className="flex items-center gap-1">
            {i > 0 && (
              <div className="w-3 h-px bg-gray-300" />
            )}
            <div className="flex items-center gap-1 text-[10px]">
              {status === 'COMPLETED' ? (
                <CheckCircle2 className="h-3 w-3 text-emerald-500" />
              ) : status === 'SKIPPED' ? (
                <AlertCircle className="h-3 w-3 text-purple-400" />
              ) : status === 'IN_PROGRESS' ? (
                <Clock className="h-3 w-3 text-amber-500" />
              ) : (
                <div className="h-3 w-3 rounded-full border border-gray-300" />
              )}
              <span className="text-muted-foreground max-w-[80px] truncate" title={userName || step.label}>
                {userName || step.label}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function PermohonanList({ items, onSelect, filterStatus, filterFastTrack }: PermohonanListProps) {
  let filtered = items

  if (filterStatus && filterStatus !== 'ALL') {
    filtered = filtered.filter((i) => i.status === filterStatus)
  }

  if (filterFastTrack === 'true') {
    filtered = filtered.filter((i) => i.fastTrack)
  } else if (filterFastTrack === 'false') {
    filtered = filtered.filter((i) => !i.fastTrack)
  }

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <FileText className="h-12 w-12 mb-3 opacity-30" />
        <p className="text-sm">Belum ada permohonan</p>
      </div>
    )
  }

  return (
    <ScrollArea className="max-h-[calc(100vh-280px)]">
      <div className="space-y-3 pr-2">
        {filtered.map((item) => (
          <Card
            key={item.id}
            className="cursor-pointer hover:shadow-md transition-all duration-200 border hover:border-primary/30 group"
            onClick={() => onSelect(item)}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0 space-y-2">
                  {/* Title row */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-sm truncate max-w-[300px] sm:max-w-[400px]" title={item.judul}>
                      {item.judul}
                    </h3>
                    {item.fastTrack && (
                      <Badge className="bg-amber-500 text-white text-[10px] px-1.5 py-0 shrink-0">
                        <Zap className="h-3 w-3 mr-0.5" />
                        FAST TRACK
                      </Badge>
                    )}
                    <StatusBadge status={item.status as PermohonanStatus} />
                  </div>

                  {/* Description */}
                  {item.deskripsi && (
                    <p className="text-xs text-muted-foreground line-clamp-1">
                      {item.deskripsi}
                    </p>
                  )}

                  {/* Workflow progress */}
                  <WorkflowProgress item={item} />

                  {/* Meta info */}
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span>Oleh: {item.manager?.name}</span>
                    <span>•</span>
                    <span>
                      {format(new Date(item.createdAt), 'dd MMM yyyy, HH:mm', { locale: localeId })}
                    </span>
                  </div>
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Eye className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </ScrollArea>
  )
}
