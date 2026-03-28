import { type LucideIcon, TrendingUp, TrendingDown } from 'lucide-react'
import clsx from 'clsx'

interface StatCardProps {
  icon: LucideIcon
  label: string
  value: string
  trend?: {
    value: string
    positive: boolean
  }
  className?: string
}

export default function StatCard({ icon: Icon, label, value, trend, className }: StatCardProps) {
  return (
    <div
      className={clsx(
        'bg-bg2 border border-border rounded-xl p-5 flex flex-col gap-3',
        className
      )}
    >
      <div className="flex items-center justify-between">
        <div className="w-10 h-10 rounded-lg bg-gold/10 flex items-center justify-center">
          <Icon size={20} className="text-gold" />
        </div>
        {trend && (
          <div
            className={clsx(
              'flex items-center gap-1 text-xs font-medium',
              trend.positive ? 'text-green' : 'text-red'
            )}
          >
            {trend.positive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            {trend.value}
          </div>
        )}
      </div>
      <div>
        <p className="text-text3 text-xs uppercase tracking-wider">{label}</p>
        <p className="text-2xl font-bold text-text mt-1">{value}</p>
      </div>
    </div>
  )
}
