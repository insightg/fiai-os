import { useState, type FormEvent } from 'react'
import { Input, Select, Textarea } from './ui/Form'
import Button from './ui/Button'

export interface FormField {
  name: string
  label: string
  type: 'text' | 'number' | 'email' | 'date' | 'select' | 'textarea'
  options?: { value: string; label: string }[]
  required?: boolean
}

interface InlineCrudFormProps {
  fields: FormField[]
  data: Record<string, any>
  onSubmit: (data: Record<string, any>) => void
  onCancel: () => void
  submitLabel?: string
}

export default function InlineCrudForm({ fields, data, onSubmit, onCancel, submitLabel = 'Salva' }: InlineCrudFormProps) {
  const [formData, setFormData] = useState<Record<string, any>>(() => {
    const initial: Record<string, any> = {}
    for (const f of fields) {
      initial[f.name] = data[f.name] ?? ''
    }
    return initial
  })

  const handleChange = (name: string, value: any) => {
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    // Strip empty strings to avoid overwriting with blanks
    const cleaned: Record<string, any> = {}
    for (const [k, v] of Object.entries(formData)) {
      if (v !== '') cleaned[k] = v
    }
    onSubmit(cleaned)
  }

  return (
    <form onSubmit={handleSubmit} className="bg-bg3 border border-border rounded-xl p-3 mt-2 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {fields.map(f => {
          if (f.type === 'select' && f.options) {
            return (
              <Select
                key={f.name}
                label={f.label}
                options={[{ value: '', label: '-- Seleziona --' }, ...f.options]}
                value={formData[f.name] ?? ''}
                onChange={e => handleChange(f.name, e.target.value)}
                required={f.required}
                className="!text-xs !py-1.5 !px-2"
              />
            )
          }
          if (f.type === 'textarea') {
            return (
              <div key={f.name} className="col-span-2">
                <Textarea
                  label={f.label}
                  value={formData[f.name] ?? ''}
                  onChange={e => handleChange(f.name, e.target.value)}
                  required={f.required}
                  className="!text-xs !py-1.5 !px-2 !min-h-[50px]"
                />
              </div>
            )
          }
          return (
            <Input
              key={f.name}
              label={f.label}
              type={f.type}
              value={formData[f.name] ?? ''}
              onChange={e => handleChange(f.name, f.type === 'number' ? Number(e.target.value) : e.target.value)}
              required={f.required}
              className="!text-xs !py-1.5 !px-2"
            />
          )
        })}
      </div>
      <div className="flex gap-2 justify-end pt-1">
        <Button type="button" size="sm" onClick={onCancel}>Annulla</Button>
        <Button type="submit" variant="primary" size="sm">{submitLabel}</Button>
      </div>
    </form>
  )
}
