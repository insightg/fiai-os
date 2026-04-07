import { useEffect, lazy, Suspense } from 'react'
import { X, ArrowLeft } from 'lucide-react'

const LazyDynamicPanel = lazy(() => import('../dynamic/DynamicPanel'))

interface ArtifactOverlayProps {
  view: {
    id: string
    label: string
    layout: Record<string, unknown>
  }
  agentName?: string
  agentColor?: string
  onClose: () => void
}

export default function ArtifactOverlay({ view, agentName, agentColor, onClose }: ArtifactOverlayProps) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-bg2 rounded-xl shadow-2xl w-[85vw] h-[85vh] flex flex-col overflow-hidden border border-border">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-bg">
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="flex items-center gap-1.5 text-text3 hover:text-text text-sm transition-colors"
            >
              <ArrowLeft size={16} />
              <span>Torna alla chat</span>
            </button>
            <div className="w-px h-4 bg-border" />
            {agentColor && (
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: agentColor }} />
            )}
            <span className="text-sm font-medium text-text">
              {view.label}
            </span>
            {agentName && (
              <span className="text-xs text-text3">— {agentName}</span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-bg3 text-text3 hover:text-text transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <Suspense fallback={
            <div className="flex items-center justify-center h-full text-text3">
              Caricamento...
            </div>
          }>
            <LazyDynamicPanel layout={view.layout as any} />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
