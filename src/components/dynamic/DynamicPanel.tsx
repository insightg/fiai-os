import { useEffect, useState, useCallback } from 'react'
import { X, Loader2 } from 'lucide-react'
import type { LayoutDescriptor } from '../../types'
import { useEntityStore } from '../../store/entityStore'
import { useAuthStore } from '../../store/authStore'
import ListView from './ListView'
import KanbanView from './KanbanView'
import DetailView from './DetailView'
import FormView from './FormView'
import ChartView from './ChartView'

interface DynamicPanelProps {
  layout: LayoutDescriptor
  onClose?: () => void
  onAction?: (action: string, data?: any) => void
}

export default function DynamicPanel({ layout, onClose, onAction }: DynamicPanelProps) {
  const [data, setData] = useState<any[]>(layout.data || [])
  const [loading, setLoading] = useState(!layout.data)
  const { profile } = useAuthStore()
  const entityStore = useEntityStore()

  const loadData = useCallback(async () => {
    if (layout.data || !layout.source || !profile?.azienda_id) return
    setLoading(true)
    try {
      const { table, type, tags, filters } = layout.source

      // Everything uses entity table now (names merged into entity)
      if (table === 'names' || table === 'entity') {
        await entityStore.fetch(profile.azienda_id, type)
        let result = entityStore.entities
        if (type) result = result.filter(e => e.type === type)
        if (filters?.stato) result = result.filter(e => e.stato === filters.stato)
        if (filters?.name_id) result = result.filter(e => e.name_id === filters.name_id)
        setData(result)
      }
    } finally {
      setLoading(false)
    }
  }, [layout.source, profile?.azienda_id])

  useEffect(() => { loadData() }, [loadData])

  const handleAction = useCallback(async (action: string, actionData?: any) => {
    if (onAction) {
      onAction(action, actionData)
      return
    }
    // Default: reload data after mutations
    if (['create', 'update', 'delete'].includes(action)) {
      await loadData()
    }
  }, [onAction, loadData])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-gold" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-text">{layout.title}</h2>
        {onClose && (
          <button onClick={onClose} className="p-1 rounded hover:bg-bg3 text-text3 hover:text-text">
            <X size={16} />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {layout.view === 'list' && (
          <ListView
            columns={layout.columns || []}
            data={data}
            actions={layout.actions}
            createForm={layout.createForm}
            source={layout.source}
            onAction={handleAction}
          />
        )}
        {layout.view === 'kanban' && (
          <KanbanView
            config={layout.kanban!}
            data={data}
            actions={layout.actions}
            source={layout.source}
            onAction={handleAction}
          />
        )}
        {layout.view === 'detail' && (
          <DetailView
            sections={layout.sections || []}
            tabs={layout.tabs}
            data={data[0]}
            actions={layout.actions}
            onAction={handleAction}
          />
        )}
        {layout.view === 'form' && (
          <FormView
            fields={layout.fields || []}
            source={layout.source}
            onAction={handleAction}
          />
        )}
        {layout.view === 'chart' && layout.chart && (
          <ChartView config={layout.chart} title={layout.title} />
        )}
      </div>
    </div>
  )
}
