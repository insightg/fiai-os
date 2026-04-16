import { useEffect, useState, useCallback, lazy, Suspense } from 'react'
import { X, Loader2 } from 'lucide-react'
import type { LayoutDescriptor } from '../../types'
import { useEntityStore } from '../../store/entityStore'
import { useAuthStore } from '../../store/authStore'
import { getAuthToken } from '../../lib/supabase'
import ListView from './ListView'
import KanbanView from './KanbanView'
import DetailView from './DetailView'
import FormView from './FormView'
import ChartView from './ChartView'
import CalendarView from './CalendarView'

// Lazy load heavy components
const MapView = lazy(() => import('./MapView'))
const DashboardView = lazy(() => import('./DashboardView'))
const DocumentManager = lazy(() => import('./DocumentManager'))

interface DynamicPanelProps {
  layout: LayoutDescriptor
  onClose?: () => void
  onAction?: (action: string, data?: any) => void
}

export default function DynamicPanel({ layout, onClose, onAction }: DynamicPanelProps) {
  const [data, setData] = useState<any[]>(layout.data as any[] || [])
  const [loading, setLoading] = useState(!layout.data)
  const { profile } = useAuthStore()
  const entityStore = useEntityStore()

  const loadData = useCallback(async () => {
    if (layout.data) return
    if (!layout.source) return
    setLoading(true)
    try {
      // Plugin tool data source
      if (layout.source.tool) {
        const token = getAuthToken()
        const params = { ...layout.source.toolParams }
        // Replace 'today' with actual date
        for (const [k, v] of Object.entries(params)) {
          if (v === 'today') params[k] = new Date().toISOString().split('T')[0]
        }
        const res = await fetch('/api/chat/tool-data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
          body: JSON.stringify({ tool: layout.source.tool, params }),
        })
        if (res.ok) {
          const result = await res.json()
          // Tool results can be array or object with data array
          setData(Array.isArray(result) ? result : result.viaggi || result.data || result.items || [result])
        }
      }
      // Entity table data source
      else if (layout.source.table && profile?.azienda_id) {
        const { type, filters } = layout.source
        await entityStore.fetch(profile.azienda_id, type)
        let result = entityStore.entities
        if (type) result = result.filter(e => e.type === type)
        if (filters?.stato) result = result.filter(e => e.stato === (filters as any).stato)
        if (filters?.name_id) result = result.filter(e => e.name_id === (filters as any).name_id)
        setData(result)
      }
    } catch (err) {
      console.error('DynamicPanel loadData error:', err)
    } finally {
      setLoading(false)
    }
  }, [layout.source, layout.data, profile?.azienda_id])

  useEffect(() => { loadData() }, [loadData])

  const handleAction = useCallback(async (action: string, actionData?: any) => {
    if (onAction) { onAction(action, actionData); return }
    if (['create', 'update', 'delete'].includes(action)) await loadData()
  }, [onAction, loadData])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[200px]">
        <Loader2 className="w-6 h-6 animate-spin text-gold" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      {layout.title && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-text">{layout.title}</h2>
          {onClose && (
            <button onClick={onClose} className="p-1 rounded hover:bg-bg3 text-text3 hover:text-text">
              <X size={16} />
            </button>
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {layout.view === 'list' && (
          <ListView columns={layout.columns || []} data={data} actions={layout.actions}
            createForm={layout.createForm} source={layout.source as any} onAction={handleAction} />
        )}
        {layout.view === 'kanban' && layout.kanban && (
          <KanbanView config={layout.kanban} data={data} actions={layout.actions}
            source={layout.source as any} onAction={handleAction} />
        )}
        {layout.view === 'detail' && (
          <DetailView sections={layout.sections || []} tabs={layout.tabs}
            data={data[0]} actions={layout.actions} onAction={handleAction} />
        )}
        {layout.view === 'form' && (
          <FormView fields={layout.fields || []} source={layout.source as any} onAction={handleAction} />
        )}
        {layout.view === 'chart' && layout.chart && (
          <ChartView config={layout.chart} title={layout.title} />
        )}
        {layout.view === 'calendar' && layout.calendar && (
          <CalendarView config={layout.calendar} data={data} />
        )}
        {layout.view === 'map' && layout.map && (
          <Suspense fallback={<div className="flex items-center justify-center h-full"><Loader2 className="w-6 h-6 animate-spin text-gold" /></div>}>
            <MapView config={layout.map} data={data} title={layout.title} />
          </Suspense>
        )}
        {layout.view === 'dashboard' && layout.panels && (
          <Suspense fallback={<div className="flex items-center justify-center h-full"><Loader2 className="w-6 h-6 animate-spin text-gold" /></div>}>
            <DashboardView panels={layout.panels} columns={layout.panelColumns} />
          </Suspense>
        )}
        {layout.view === 'documents' && (
          <Suspense fallback={<div className="flex items-center justify-center h-full"><Loader2 className="w-6 h-6 animate-spin text-gold" /></div>}>
            <DocumentManager />
          </Suspense>
        )}
      </div>
    </div>
  )
}
