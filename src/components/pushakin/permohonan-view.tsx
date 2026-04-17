'use client'

import { useState, useEffect, useCallback } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Plus,
  List,
  ClipboardList,
  Zap,
  RefreshCw,
  Loader2,
  LayoutDashboard,
  Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { PermohonanForm } from './permohonan-form'
import { PermohonanList } from './permohonan-list'
import { PermohonanDetail } from './permohonan-detail'
import { RekapitulasiView } from './rekapitulasi-view'
import type { Permohonan, RekapitulasiItem } from '@/types/pushakin'

export function PermohonanView() {
  const [activeTab, setActiveTab] = useState('list')
  const [showForm, setShowForm] = useState(false)
  const [permohonanList, setPermohonanList] = useState<Permohonan[]>([])
  const [rekapitulasiList, setRekapitulasiList] = useState<RekapitulasiItem[]>([])
  const [selectedItem, setSelectedItem] = useState<Permohonan | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [filterStatus, setFilterStatus] = useState('ALL')
  const [filterFastTrack, setFilterFastTrack] = useState('all')

  // ── Fetch permohonan list ──
  const fetchPermohonan = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/permohonan')
      if (res.ok) {
        const data = await res.json()
        setPermohonanList(data)
      }
    } catch (err) {
      console.error('Failed to fetch permohonan:', err)
      toast.error('Gagal memuat data permohonan')
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Fetch rekapitulasi ──
  const fetchRekapitulasi = useCallback(async () => {
    try {
      const res = await fetch('/api/rekapitulasi')
      if (res.ok) {
        const data = await res.json()
        setRekapitulasiList(data)
      }
    } catch (err) {
      console.error('Failed to fetch rekapitulasi:', err)
    }
  }, [])

  useEffect(() => {
    fetchPermohonan()
    fetchRekapitulasi()
  }, [fetchPermohonan, fetchRekapitulasi])

  // ── Create permohonan ──
  const handleCreate = async (data: Record<string, unknown>) => {
    const res = await fetch('/api/permohonan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })

    if (res.ok) {
      const newPermohonan = await res.json()
      setPermohonanList((prev) => [newPermohonan, ...prev])
      setShowForm(false)
      toast.success(
        data.fastTrack
          ? 'Permohonan Fast Track berhasil dibuat!'
          : 'Permohonan berhasil dibuat!',
        { description: newPermohonan.judul }
      )
    } else {
      const err = await res.json()
      toast.error(err.error || 'Gagal membuat permohonan')
    }
  }

  // ── Complete step ──
  const handleCompleteStep = async (permohonanId: string, data: Record<string, unknown>) => {
    const res = await fetch(`/api/permohonan/${permohonanId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })

    if (res.ok) {
      const updated = await res.json()
      setPermohonanList((prev) =>
        prev.map((p) => (p.id === updated.id ? updated : p))
      )
      setSelectedItem(updated)
      toast.success('Tugas berhasil diselesaikan!')

      // Refresh rekapitulasi if permohonan completed
      if (updated.status === 'COMPLETED') {
        fetchRekapitulasi()
        toast.success('Permohonan selesai! Hasil masuk ke Rekapitulasi.', {
          description: updated.judul,
        })
      }
    } else {
      const err = await res.json()
      toast.error(err.error || 'Gagal menyelesaikan tugas')
    }
  }

  const handleSelectItem = (item: Permohonan) => {
    setSelectedItem(item)
    setDetailOpen(true)
  }

  // Stats
  const totalPermohonan = permohonanList.length
  const fastTrackCount = permohonanList.filter((p) => p.fastTrack).length
  const inProgressCount = permohonanList.filter((p) => p.status === 'IN_PROGRESS' || p.status === 'PUBLISHING').length
  const completedCount = permohonanList.filter((p) => p.status === 'COMPLETED').length

  return (
    <div className="min-h-screen flex flex-col bg-gray-50/80">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-lg border-b shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 p-2 shadow-md">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">Pushakin Flows</h1>
              <p className="text-[10px] text-muted-foreground tracking-wide">MANAJEMEN PEMBERITAAN</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                fetchPermohonan()
                fetchRekapitulasi()
              }}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setShowForm(true)
                setActiveTab('list')
              }}
              className="bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white shadow-sm"
            >
              <Plus className="h-4 w-4 mr-1" />
              Buat Permohonan
            </Button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 py-6">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <Card className="bg-white shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-gray-100 p-2">
                <LayoutDashboard className="h-4 w-4 text-gray-600" />
              </div>
              <div>
                <p className="text-xl font-bold">{totalPermohonan}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-amber-100 p-2">
                <Zap className="h-4 w-4 text-amber-600" />
              </div>
              <div>
                <p className="text-xl font-bold">{fastTrackCount}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Fast Track</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-sky-100 p-2">
                <List className="h-4 w-4 text-sky-600" />
              </div>
              <div>
                <p className="text-xl font-bold">{inProgressCount}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Berlangsung</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-emerald-100 p-2">
                <ClipboardList className="h-4 w-4 text-emerald-600" />
              </div>
              <div>
                <p className="text-xl font-bold">{completedCount}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Selesai</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <TabsList className="bg-white shadow-sm">
              <TabsTrigger value="list" className="gap-1.5">
                <List className="h-4 w-4" />
                Permohonan
              </TabsTrigger>
              <TabsTrigger value="rekapitulasi" className="gap-1.5">
                <ClipboardList className="h-4 w-4" />
                Rekapitulasi
                {rekapitulasiList.length > 0 && (
                  <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0">
                    {rekapitulasiList.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            {activeTab === 'list' && !showForm && (
              <div className="flex items-center gap-2">
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="w-[130px] h-8 text-xs">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Semua Status</SelectItem>
                    <SelectItem value="DRAFT">Draft</SelectItem>
                    <SelectItem value="IN_PROGRESS">Berlangsung</SelectItem>
                    <SelectItem value="PUBLISHING">Publishing</SelectItem>
                    <SelectItem value="COMPLETED">Selesai</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={filterFastTrack} onValueChange={setFilterFastTrack}>
                  <SelectTrigger className="w-[130px] h-8 text-xs">
                    <SelectValue placeholder="Tipe" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Tipe</SelectItem>
                    <SelectItem value="true">Fast Track</SelectItem>
                    <SelectItem value="false">Normal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <TabsContent value="list" className="space-y-4">
            {showForm ? (
              <PermohonanForm
                onSubmit={handleCreate}
                onCancel={() => setShowForm(false)}
              />
            ) : (
              <>
                {loading ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <PermohonanList
                    items={permohonanList}
                    onSelect={handleSelectItem}
                    filterStatus={filterStatus}
                    filterFastTrack={filterFastTrack}
                  />
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="rekapitulasi">
            <RekapitulasiView items={rekapitulasiList} />
          </TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t mt-auto">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Pushakin Flows — Manajemen Permohonan Pemberitaan
          </p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Zap className="h-3 w-3 text-amber-500" />
            <span>Fast Track tersedia</span>
          </div>
        </div>
      </footer>

      {/* Detail dialog */}
      <PermohonanDetail
        item={selectedItem}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onCompleteStep={handleCompleteStep}
      />
    </div>
  )
}
