import { useState, useEffect } from 'react'
import type { LayoutColumn } from '../../types'
import { useEntityStore } from '../../store/entityStore'

interface DetailSection {
  title: string
  fields: { key: string; label: string; type?: string }[]
}

interface DetailTab {
  id: string
  label: string
  source: { table: string; type?: string; filters?: Record<string, unknown> }
  columns?: LayoutColumn[]
}

interface DetailViewProps {
  sections: DetailSection[]
  tabs?: DetailTab[]
  data: any
  actions?: string[]
  onAction?: (action: string, data?: any) => void
}

function getVal(obj: any, key: string): any {
  if (!obj || !key) return null
  return key.split('.').reduce((v, k) => v?.[k], obj)
}

function formatField(value: any, type?: string): string {
  if (value === null || value === undefined) return '—'
  switch (type) {
    case 'currency': return `€ ${Number(value).toLocaleString('it-IT', { minimumFractionDigits: 2 })}`
    case 'date': return new Date(value).toLocaleDateString('it-IT')
    case 'number': return Number(value).toLocaleString('it-IT')
    default: return String(value)
  }
}

export default function DetailView({ sections, tabs, data, actions, onAction }: DetailViewProps) {
  const [activeTab, setActiveTab] = useState(tabs?.[0]?.id || '')
  const [tabData, setTabData] = useState<Record<string, any[]>>({})
  const entityStore = useEntityStore()

  useEffect(() => {
    if (!tabs || !data?.id) return
    tabs.forEach(async (tab) => {
      if (tab.source.table === 'entity' && tab.source.filters?.parent_id === '{{id}}') {
        const children = await entityStore.fetchChildren(data.id)
        const filtered = tab.source.type ? children.filter(c => c.type === tab.source.type) : children
        setTabData(prev => ({ ...prev, [tab.id]: filtered }))
      }
    })
  }, [tabs, data?.id])

  if (!data) {
    return <div className="text-xs text-text3 text-center py-8">Nessun dato</div>
  }

  return (
    <div className="space-y-4">
      {/* Sections */}
      {sections.map((section, i) => (
        <div key={i} className="bg-bg3 rounded-lg p-4">
          <h3 className="text-xs font-semibold text-text mb-3">{section.title}</h3>
          <div className="grid grid-cols-2 gap-3">
            {section.fields.map(field => (
              <div key={field.key}>
                <dt className="text-[10px] text-text3">{field.label}</dt>
                <dd className="text-xs text-text mt-0.5">
                  {field.type === 'badge' ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-gold/10 text-gold">
                      {getVal(data, field.key) || '—'}
                    </span>
                  ) : (
                    formatField(getVal(data, field.key), field.type)
                  )}
                </dd>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Tabs */}
      {tabs && tabs.length > 0 && (
        <div>
          <div className="flex border-b border-border">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-2 text-xs transition-colors ${
                  activeTab === tab.id ? 'text-gold border-b-2 border-gold' : 'text-text3 hover:text-text'
                }`}
              >
                {tab.label}
                {tabData[tab.id] && (
                  <span className="ml-1 text-[10px] text-text3">({tabData[tab.id].length})</span>
                )}
              </button>
            ))}
          </div>
          <div className="mt-3">
            {tabs.map(tab => {
              if (tab.id !== activeTab || !tab.columns) return null
              const rows = tabData[tab.id] || []
              return (
                <table key={tab.id} className="w-full text-xs">
                  <thead>
                    <tr className="bg-bg3">
                      {tab.columns.map(col => (
                        <th key={col.key} className="px-3 py-2 text-left font-medium text-text3">{col.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr><td colSpan={tab.columns.length} className="px-3 py-4 text-center text-text3">Nessun elemento</td></tr>
                    ) : rows.map((row: any, j: number) => (
                      <tr key={row.id || j} className="border-t border-border">
                        {tab.columns!.map(col => (
                          <td key={col.key} className="px-3 py-2 text-text">
                            {formatField(getVal(row, col.key), col.type)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            })}
          </div>
        </div>
      )}

      {/* Actions */}
      {actions && actions.length > 0 && (
        <div className="flex gap-2 pt-2">
          {actions.includes('edit') && (
            <button onClick={() => onAction?.('edit', data)} className="px-3 py-1.5 text-xs bg-gold hover:bg-gold-l text-white rounded-lg">
              Modifica
            </button>
          )}
          {actions.includes('delete') && (
            <button onClick={() => onAction?.('delete', data)} className="px-3 py-1.5 text-xs bg-red/10 hover:bg-red/20 text-red rounded-lg">
              Elimina
            </button>
          )}
        </div>
      )}
    </div>
  )
}
