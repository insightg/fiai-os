import { Suspense, lazy } from 'react'
import type { LayoutDescriptor } from '../../types'

const LazyDynamicPanel = lazy(() => import('./DynamicPanel'))

interface DashboardViewProps {
  panels: LayoutDescriptor[]
  columns?: number
}

export default function DashboardView({ panels, columns = 2 }: DashboardViewProps) {
  const gridCols = columns === 1 ? 'grid-cols-1' : columns === 3 ? 'grid-cols-1 md:grid-cols-3' : 'grid-cols-1 md:grid-cols-2'

  return (
    <div className={`grid ${gridCols} gap-4`}>
      {panels.map((panel, i) => (
        <div key={i} className="bg-bg2 border border-border rounded-xl overflow-hidden min-h-[300px]">
          <Suspense fallback={<div className="p-4 text-text3 text-sm">Caricamento...</div>}>
            <LazyDynamicPanel layout={panel} />
          </Suspense>
        </div>
      ))}
    </div>
  )
}
