import { useState, useMemo } from 'react'
import { Search, Plus, Pencil, Trash2, ChevronUp, ChevronDown } from 'lucide-react'
import type { LayoutColumn, LayoutField } from '../../types'
import FormView from './FormView'

interface ListViewProps {
  columns: LayoutColumn[]
  data: any[]
  actions?: string[]
  createForm?: { fields: LayoutField[] }
  source?: { table: string; type?: string; tags?: string[] }
  onAction?: (action: string, data?: any) => void
}

function getNestedValue(obj: any, key: string): any {
  if (!obj || !key) return null
  const parts = key.split('.')
  let val = obj
  for (const p of parts) {
    val = val?.[p]
    if (val === undefined || val === null) return null
  }
  return val
}

function formatCell(value: any, type?: string): string {
  if (value === null || value === undefined) return '—'
  switch (type) {
    case 'currency': return `€ ${Number(value).toLocaleString('it-IT', { minimumFractionDigits: 2 })}`
    case 'date': return new Date(value).toLocaleDateString('it-IT')
    case 'number': return Number(value).toLocaleString('it-IT')
    case 'percent': return `${Number(value).toFixed(1)}%`
    case 'tags': return Array.isArray(value) ? value.join(', ') : String(value)
    default: return String(value)
  }
}

export default function ListView({ columns, data, actions, createForm, source, onAction }: ListViewProps) {
  const [search, setSearch] = useState('')
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortAsc, setSortAsc] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<any>(null)

  const filtered = useMemo(() => {
    let items = data
    if (search) {
      const q = search.toLowerCase()
      items = items.filter(row =>
        columns.some(col => {
          const val = getNestedValue(row, col.key)
          return val && String(val).toLowerCase().includes(q)
        })
      )
    }
    if (sortCol) {
      items = [...items].sort((a, b) => {
        const va = getNestedValue(a, sortCol) ?? ''
        const vb = getNestedValue(b, sortCol) ?? ''
        const cmp = String(va).localeCompare(String(vb), 'it', { numeric: true })
        return sortAsc ? cmp : -cmp
      })
    }
    return items
  }, [data, search, sortCol, sortAsc, columns])

  const toggleSort = (key: string) => {
    if (sortCol === key) setSortAsc(!sortAsc)
    else { setSortCol(key); setSortAsc(true) }
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-2.5 text-text3" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Cerca..."
            className="w-full pl-8 pr-3 py-2 text-xs bg-bg3 border border-border rounded-lg text-text placeholder:text-text3 focus:outline-none focus:border-gold/40"
          />
        </div>
        {actions?.includes('create') && createForm && (
          <button
            onClick={() => { setEditItem(null); setShowForm(true) }}
            className="flex items-center gap-1 px-3 py-2 text-xs bg-gold hover:bg-gold-l text-white rounded-lg"
          >
            <Plus size={14} /> Nuovo
          </button>
        )}
      </div>

      {/* Form modal */}
      {showForm && createForm && (
        <div className="bg-bg3 border border-border rounded-lg p-4">
          <FormView
            fields={createForm.fields}
            source={source}
            initialData={editItem}
            onAction={(action, formData) => {
              setShowForm(false)
              setEditItem(null)
              onAction?.(editItem ? 'update' : 'create', formData)
            }}
            onCancel={() => { setShowForm(false); setEditItem(null) }}
          />
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-bg3">
              {columns.map(col => (
                <th
                  key={col.key}
                  onClick={() => toggleSort(col.key)}
                  className="px-3 py-2.5 text-left font-medium text-text3 cursor-pointer hover:text-text select-none"
                  style={col.width ? { width: col.width } : undefined}
                >
                  <span className="flex items-center gap-1">
                    {col.label}
                    {sortCol === col.key && (sortAsc ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                  </span>
                </th>
              ))}
              {(actions?.includes('edit') || actions?.includes('delete')) && (
                <th className="px-3 py-2.5 w-20" />
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={columns.length + 1} className="px-3 py-8 text-center text-text3">Nessun risultato</td></tr>
            ) : (
              filtered.map((row, i) => (
                <tr key={row.id || i} className="border-t border-border hover:bg-bg3/50 transition-colors">
                  {columns.map(col => (
                    <td key={col.key} className="px-3 py-2.5 text-text">
                      {col.type === 'badge' ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-gold/10 text-gold">
                          {getNestedValue(row, col.key)}
                        </span>
                      ) : col.type === 'tags' ? (
                        <div className="flex gap-1 flex-wrap">
                          {(Array.isArray(getNestedValue(row, col.key)) ? getNestedValue(row, col.key) : []).map((t: string) => (
                            <span key={t} className="px-1.5 py-0.5 rounded text-[10px] bg-bg3 text-text2">{t}</span>
                          ))}
                        </div>
                      ) : (
                        formatCell(getNestedValue(row, col.key), col.type)
                      )}
                    </td>
                  ))}
                  {(actions?.includes('edit') || actions?.includes('delete')) && (
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1">
                        {actions?.includes('edit') && createForm && (
                          <button
                            onClick={() => { setEditItem(row); setShowForm(true) }}
                            className="p-1 rounded hover:bg-bg3 text-text3 hover:text-text"
                          >
                            <Pencil size={12} />
                          </button>
                        )}
                        {actions?.includes('delete') && (
                          <button
                            onClick={() => onAction?.('delete', row)}
                            className="p-1 rounded hover:bg-red/10 text-text3 hover:text-red"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="text-[10px] text-text3 text-right">{filtered.length} risultati</div>
    </div>
  )
}
