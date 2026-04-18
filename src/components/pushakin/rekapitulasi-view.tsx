'use client'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Zap, Globe, Share2, ExternalLink, ClipboardList, Clock, CheckCircle2 } from 'lucide-react'
import { format } from 'date-fns'
import { id as localeId } from 'date-fns/locale'
import type { RekapitulasiItem } from '@/types/pushakin'

interface RekapitulasiViewProps {
  items: RekapitulasiItem[]
}

export function RekapitulasiView({ items }: RekapitulasiViewProps) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <ClipboardList className="h-12 w-12 mb-3 opacity-30" />
        <p className="text-sm">Belum ada rekapitulasi</p>
        <p className="text-xs mt-1">Rekapitulasi akan muncul setelah publisher menyelesaikan tugas</p>
      </div>
    )
  }

  const fastTrackCount = items.filter((i) => i.isFastTrack).length
  const normalCount = items.filter((i) => !i.isFastTrack).length

  return (
    <div className="space-y-4">
      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-lg bg-emerald-100 p-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{items.length}</p>
              <p className="text-xs text-muted-foreground">Total Rekapitulasi</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-lg bg-amber-100 p-2">
              <Zap className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{fastTrackCount}</p>
              <p className="text-xs text-muted-foreground">Fast Track</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-lg bg-sky-100 p-2">
              <Clock className="h-5 w-5 text-sky-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{normalCount}</p>
              <p className="text-xs text-muted-foreground">Normal Flow</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Daftar Rekapitulasi</CardTitle>
          <CardDescription>Riwayat pemberitaan yang telah selesai diproses</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="max-h-[calc(100vh-420px)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]">No</TableHead>
                  <TableHead>Judul</TableHead>
                  <TableHead className="w-[100px]">Tipe</TableHead>
                  <TableHead className="w-[140px]">Publisher Web</TableHead>
                  <TableHead className="w-[140px]">Publisher Social</TableHead>
                  <TableHead className="w-[100px]">Link Web</TableHead>
                  <TableHead className="w-[100px]">Link Social</TableHead>
                  <TableHead className="w-[130px]">Tanggal Selesai</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item, idx) => (
                  <TableRow key={item.id}>
                    <TableCell className="text-xs text-muted-foreground">{idx + 1}</TableCell>
                    <TableCell>
                      <p className="text-sm font-medium truncate max-w-[200px]" title={item.judul}>
                        {item.judul}
                      </p>
                    </TableCell>
                    <TableCell>
                      {item.isFastTrack ? (
                        <Badge className="bg-amber-500 text-white text-[10px] px-1.5 py-0">
                          <Zap className="h-2.5 w-2.5 mr-0.5" />
                          Fast Track
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          Normal
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{item.namaPublisherWeb || '—'}</TableCell>
                    <TableCell className="text-xs">{item.namaPublisherSocial || '—'}</TableCell>
                    <TableCell>
                      {item.linkWeb ? (
                        <a
                          href={item.linkWeb}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-emerald-600 hover:underline"
                        >
                          <Globe className="h-3 w-3" />
                          <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {item.linkSocial ? (
                        <a
                          href={item.linkSocial}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-pink-600 hover:underline"
                        >
                          <Share2 className="h-3 w-3" />
                          <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {item.tanggalSelesai
                        ? format(new Date(item.tanggalSelesai), 'dd MMM yyyy', { locale: localeId })
                        : '—'
                      }
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  )
}
