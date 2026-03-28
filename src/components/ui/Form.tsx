import { type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes, forwardRef } from 'react'
import clsx from 'clsx'

// ── Input ────────────────────────────────────────────────

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s/g, '-')
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-text2">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={clsx(
            'w-full px-3 py-2 rounded-lg bg-bg3 border text-text text-sm placeholder:text-text3',
            'focus:outline-none focus:ring-1 focus:ring-gold/50 focus:border-gold/50 transition-colors',
            error ? 'border-red/50' : 'border-border',
            className
          )}
          {...props}
        />
        {error && <p className="text-xs text-red">{error}</p>}
      </div>
    )
  }
)
Input.displayName = 'Input'

// ── Select ───────────────────────────────────────────────

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  options: { value: string; label: string }[]
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, className, id, ...props }, ref) => {
    const selectId = id ?? label?.toLowerCase().replace(/\s/g, '-')
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={selectId} className="text-sm font-medium text-text2">
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={clsx(
            'w-full px-3 py-2 rounded-lg bg-bg3 border text-text text-sm',
            'focus:outline-none focus:ring-1 focus:ring-gold/50 focus:border-gold/50 transition-colors',
            error ? 'border-red/50' : 'border-border',
            className
          )}
          {...props}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {error && <p className="text-xs text-red">{error}</p>}
      </div>
    )
  }
)
Select.displayName = 'Select'

// ── Textarea ─────────────────────────────────────────────

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, className, id, ...props }, ref) => {
    const textareaId = id ?? label?.toLowerCase().replace(/\s/g, '-')
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={textareaId} className="text-sm font-medium text-text2">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          className={clsx(
            'w-full px-3 py-2 rounded-lg bg-bg3 border text-text text-sm placeholder:text-text3 resize-y min-h-[80px]',
            'focus:outline-none focus:ring-1 focus:ring-gold/50 focus:border-gold/50 transition-colors',
            error ? 'border-red/50' : 'border-border',
            className
          )}
          {...props}
        />
        {error && <p className="text-xs text-red">{error}</p>}
      </div>
    )
  }
)
Textarea.displayName = 'Textarea'
