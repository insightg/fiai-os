import { useMemo } from 'react'

interface KanbanConfig {
  groupBy: string
  groups: { value: string; label: string; color: string }[]
  cardTitle: string
  cardSubtitle?: string
  cardValue?: string
}

interface KanbanViewProps {
  config: KanbanConfig
  data: any[]
  actions?: string[]
  source?: { table: string; type?: string; tags?: string[] }
  onAction?: (action: string, data?: any) => void
}

function getVal(obj: any, key: string): any {
  if (!obj || !key) return null
  return key.split('.').reduce((v, k) => v?.[k], obj)
}

export default function KanbanView({ config, data, actions, onAction }: KanbanViewProps) {
  const grouped = useMemo(() => {
    const map: Record<string, any[]> = {}
    for (const g of config.groups) map[g.value] = []
    for (const item of data) {
      const key = getVal(item, config.groupBy) || ''
      if (map[key]) map[key].push(item)
      else {
        // Unknown group — add to first column
        const first = config.groups[0]?.value
        if (first && map[first]) map[first].push(item)
      }
    }
    return map
  }, [data, config])

  return (
    <div className="flex gap-3 overflow-x-auto pb-2 min-h-[300px]">
      {config.groups.map(group => (
        <div key={group.value} className="flex-shrink-0 w-56 bg-bg3 rounded-lg">
          {/* Column header */}
          <div className="px-3 py-2 flex items-center justify-between border-b border-border">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: group.color }} />
              <span className="text-xs font-medium text-text">{group.label}</span>
            </div>
            <span className="text-[10px] text-text3 bg-bg2 px-1.5 py-0.5 rounded-full">
              {grouped[group.value]?.length || 0}
            </span>
          </div>

          {/* Cards */}
          <div className="p-2 space-y-2 max-h-[60vh] overflow-y-auto">
            {(grouped[group.value] || []).map((item: any) => (
              <div
                key={item.id}
                className="bg-bg2 rounded-lg p-3 border border-border hover:border-gold/30 cursor-pointer transition-colors"
                onClick={() => onAction?.('detail', item)}
              >
                <p className="text-xs font-medium text-text truncate">
                  {getVal(item, config.cardTitle) || '—'}
                </p>
                {config.cardSubtitle && (
                  <p className="text-[10px] text-text3 mt-0.5 truncate">
                    {getVal(item, config.cardSubtitle) || ''}
                  </p>
                )}
                {config.cardValue && (
                  <p className="text-[11px] font-semibold text-gold mt-1">
                    {(() => {
                      const v = getVal(item, config.cardValue)
                      return v ? `€ ${Number(v).toLocaleString('it-IT')}` : ''
                    })()}
                  </p>
                )}
              </div>
            ))}
            {(grouped[group.value] || []).length === 0 && (
              <div className="text-[10px] text-text3 text-center py-4">Vuoto</div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
