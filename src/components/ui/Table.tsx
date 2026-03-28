import { type ReactNode } from 'react'
import clsx from 'clsx'

export interface Column<T> {
  key: string
  header: string
  render: (row: T) => ReactNode
  className?: string
}

interface TableProps<T> {
  columns: Column<T>[]
  data: T[]
  onRowClick?: (row: T) => void
  emptyMessage?: string
  keyExtractor: (row: T) => string
}

export default function Table<T>({
  columns,
  data,
  onRowClick,
  emptyMessage = 'Nessun dato disponibile.',
  keyExtractor,
}: TableProps<T>) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-bg2">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {columns.map((col) => (
              <th
                key={col.key}
                className={clsx(
                  'px-4 py-3 text-left text-xs font-medium text-text3 uppercase tracking-wider',
                  col.className
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-8 text-center text-text3"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row) => (
              <tr
                key={keyExtractor(row)}
                onClick={() => onRowClick?.(row)}
                className={clsx(
                  'border-b border-border/50 transition-colors',
                  onRowClick && 'cursor-pointer hover:bg-bg3'
                )}
              >
                {columns.map((col) => (
                  <td key={col.key} className={clsx('px-4 py-3 text-text', col.className)}>
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
