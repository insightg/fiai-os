import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { PanelRightClose, PanelRightOpen, Maximize2, Bot } from 'lucide-react'
import { getAuthToken } from '../../lib/supabase'

const LazyDynamicPanel = lazy(() => import('../dynamic/DynamicPanel'))

interface AgentView {
  id: string
  label: string
  icon: string
  trigger: string
  layout: Record<string, unknown>
}

interface ContextPanelProps {
  agentDomain: string | null
  agentName: string | null
  agentColor: string | null
  toolCalls: Record<string, unknown>[]
  onExpand?: (view: AgentView) => void
}

export default function ContextPanel({ agentDomain, agentName, agentColor, toolCalls, onExpand }: ContextPanelProps) {
  const [open, setOpen] = useState(true)
  const [views, setViews] = useState<AgentView[]>([])
  const [activeViewId, setActiveViewId] = useState<string | null>(null)
  const [lastDomain, setLastDomain] = useState<string | null>(null)

  // Load views when agent changes
  useEffect(() => {
    if (!agentDomain || agentDomain === lastDomain) return
    setLastDomain(agentDomain)

    const token = getAuthToken()
    fetch(`/api/chat/agent-views/${agentDomain}`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    })
      .then(r => r.json())
      .then(data => {
        const agentViews = data.views || []
        setViews(agentViews)
        // Auto-select first 'auto' trigger view
        const autoView = agentViews.find((v: AgentView) => v.trigger === 'auto')
        if (autoView) setActiveViewId(autoView.id)
      })
      .catch(() => setViews([]))
  }, [agentDomain, lastDomain])

  // Match tool triggers
  useEffect(() => {
    if (!toolCalls.length || !views.length) return

    for (const tc of toolCalls) {
      const toolName = (tc as any).tool as string
      const result = (tc as any).result

      for (const view of views) {
        // on_tool:retrieve
        if (view.trigger === `on_tool:${toolName}`) {
          setActiveViewId(view.id)
          return
        }
        // on_get_tree
        if (view.trigger === 'on_get_tree' && toolName === 'get_tree') {
          setActiveViewId(view.id)
          return
        }
        // on_find:cliente (check tags in results)
        if (view.trigger.startsWith('on_find:') && (toolName === 'find' || toolName === 'search')) {
          const tag = view.trigger.replace('on_find:', '')
          if (Array.isArray(result)) {
            const hasMatch = result.some((r: any) => {
              const tags = typeof r.tags === 'string' ? JSON.parse(r.tags) : (r.tags || [])
              return tags.includes(tag) || r.type === tag
            })
            if (hasMatch) {
              setActiveViewId(view.id)
              return
            }
          }
        }
      }
    }
  }, [toolCalls, views])

  const activeView = views.find(v => v.id === activeViewId)

  // Inject tool result data into view layout
  const getViewLayout = useCallback(() => {
    if (!activeView) return null
    const layout = { ...activeView.layout } as any

    // Find the best matching tool call for this view's data
    for (const tc of [...toolCalls].reverse()) {
      const toolName = (tc as any).tool as string
      const result = (tc as any).result

      // Array results (find, search, list_*) → inject as data
      if (Array.isArray(result) && result.length > 0) {
        layout.data = result
        delete layout.source  // don't fetch from store, we have the data
        break
      }

      // get_tree result → inject record + children for detail view
      if (toolName === 'get_tree' && result?.record) {
        layout.data = [result.record]
        if (result.children) {
          layout.children = result.children
        }
        delete layout.source
        break
      }

      // Object result with output (execute_code) → skip
      if (result?.output) continue

      // Single object result → wrap in array
      if (result && typeof result === 'object' && !result.errore && !result.successo) {
        layout.data = [result]
        delete layout.source
        break
      }
    }

    return layout
  }, [activeView, toolCalls])

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center justify-center w-10 h-full border-l border-border bg-bg2 hover:bg-bg3 transition-colors"
        title="Apri pannello"
      >
        <PanelRightOpen size={16} className="text-text3" />
      </button>
    )
  }

  return (
    <div className="w-[380px] min-w-[380px] border-l border-border bg-bg2 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-bg">
        <div className="flex items-center gap-2">
          {agentColor && (
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: agentColor }} />
          )}
          <span className="text-xs font-medium text-text2 truncate">
            {agentName || 'Pannello'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {activeView && onExpand && (
            <button
              onClick={() => onExpand(activeView)}
              className="p-1 rounded hover:bg-bg3 text-text3 hover:text-text"
              title="Espandi"
            >
              <Maximize2 size={14} />
            </button>
          )}
          <button
            onClick={() => setOpen(false)}
            className="p-1 rounded hover:bg-bg3 text-text3 hover:text-text"
            title="Chiudi pannello"
          >
            <PanelRightClose size={14} />
          </button>
        </div>
      </div>

      {/* View tabs */}
      {views.length > 1 && (
        <div className="flex gap-1 px-2 py-1.5 border-b border-border overflow-x-auto">
          {views.filter(v => v.trigger !== 'manual' || v.id === activeViewId).map(v => (
            <button
              key={v.id}
              onClick={() => setActiveViewId(v.id)}
              className={`px-2 py-1 text-[11px] rounded-md whitespace-nowrap transition-colors ${
                v.id === activeViewId
                  ? 'bg-gold/10 text-gold font-medium'
                  : 'text-text3 hover:text-text2 hover:bg-bg3'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {activeView ? (
          <Suspense fallback={<div className="text-text3 text-xs">Caricamento...</div>}>
            <LazyDynamicPanel layout={getViewLayout()} />
          </Suspense>
        ) : views.length === 0 && agentDomain ? (
          <div className="flex flex-col items-center justify-center h-full text-text3">
            <Bot size={32} className="mb-2 opacity-30" />
            <p className="text-xs">Interagisci con {agentName || 'l\'agente'}</p>
            <p className="text-[10px] mt-1">Le viste appariranno qui</p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-text3">
            <Bot size={32} className="mb-2 opacity-30" />
            <p className="text-xs">Scrivi un messaggio per iniziare</p>
          </div>
        )}
      </div>
    </div>
  )
}
