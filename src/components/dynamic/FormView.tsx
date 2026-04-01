import { useState } from 'react'
import { Save, X } from 'lucide-react'
import type { LayoutField } from '../../types'

interface FormViewProps {
  fields: LayoutField[]
  source?: { table: string; type?: string; tags?: string[] }
  initialData?: any
  onAction?: (action: string, data: any) => void
  onCancel?: () => void
}

function getNestedValue(obj: any, key: string): any {
  if (!obj || !key) return undefined
  return key.split('.').reduce((v, k) => v?.[k], obj)
}

function setNestedValue(obj: Record<string, any>, key: string, value: any): Record<string, any> {
  const result = { ...obj }
  const parts = key.split('.')
  if (parts.length === 1) {
    result[key] = value
  } else {
    const [first, ...rest] = parts
    result[first] = setNestedValue(result[first] || {}, rest.join('.'), value)
  }
  return result
}

export default function FormView({ fields, source, initialData, onAction, onCancel }: FormViewProps) {
  const [formData, setFormData] = useState<Record<string, any>>(() => {
    if (!initialData) return {}
    const data: Record<string, any> = {}
    for (const field of fields) {
      const val = getNestedValue(initialData, field.key)
      if (val !== undefined && val !== null) {
        data[field.key] = val
      } else if (field.defaultValue !== undefined) {
        data[field.key] = field.defaultValue
      }
    }
    return data
  })

  const handleChange = (key: string, value: any) => {
    setFormData(prev => setNestedValue(prev, key, value))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // Build the output data
    const output: Record<string, any> = { ...formData }
    if (source?.table) output._table = source.table
    if (source?.type) output._type = source.type
    if (source?.tags) output._tags = source.tags
    if (initialData?.id) output._id = initialData.id
    onAction?.(initialData ? 'update' : 'create', output)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {fields.map(field => (
        <div key={field.key}>
          <label className="block text-[10px] font-medium text-text3 mb-1">
            {field.label}
            {field.required && <span className="text-red ml-0.5">*</span>}
          </label>

          {field.type === 'textarea' ? (
            <textarea
              value={formData[field.key] || ''}
              onChange={e => handleChange(field.key, e.target.value)}
              placeholder={field.placeholder}
              required={field.required}
              rows={3}
              className="w-full px-3 py-2 text-xs bg-bg2 border border-border rounded-lg text-text placeholder:text-text3 focus:outline-none focus:border-gold/40 resize-none"
            />
          ) : field.type === 'select' ? (
            <select
              value={formData[field.key] || ''}
              onChange={e => handleChange(field.key, e.target.value)}
              required={field.required}
              className="w-full px-3 py-2 text-xs bg-bg2 border border-border rounded-lg text-text focus:outline-none focus:border-gold/40"
            >
              <option value="">Seleziona...</option>
              {field.options?.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          ) : (
            <input
              type={field.type === 'currency' || field.type === 'number' ? 'number' : field.type || 'text'}
              value={formData[field.key] ?? ''}
              onChange={e => handleChange(field.key, field.type === 'number' || field.type === 'currency' ? Number(e.target.value) : e.target.value)}
              placeholder={field.placeholder}
              required={field.required}
              step={field.type === 'currency' ? '0.01' : undefined}
              className="w-full px-3 py-2 text-xs bg-bg2 border border-border rounded-lg text-text placeholder:text-text3 focus:outline-none focus:border-gold/40"
            />
          )}
        </div>
      ))}

      <div className="flex items-center gap-2 pt-2">
        <button type="submit" className="flex items-center gap-1.5 px-4 py-2 text-xs bg-gold hover:bg-gold-l text-white rounded-lg">
          <Save size={14} />
          {initialData ? 'Salva' : 'Crea'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="flex items-center gap-1.5 px-4 py-2 text-xs text-text3 hover:text-text">
            <X size={14} /> Annulla
          </button>
        )}
      </div>
    </form>
  )
}
