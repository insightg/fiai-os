import clsx from 'clsx'

type BadgeColor = 'gold' | 'green' | 'red' | 'blue' | 'amber' | 'purple' | 'gray'

interface BadgeProps {
  children: React.ReactNode
  color?: BadgeColor
  className?: string
}

const colorStyles: Record<BadgeColor, string> = {
  gold: 'bg-gold/15 text-gold border-gold/25',
  green: 'bg-green/15 text-green border-green/25',
  red: 'bg-red/15 text-red border-red/25',
  blue: 'bg-blue/15 text-blue border-blue/25',
  amber: 'bg-amber/15 text-amber border-amber/25',
  purple: 'bg-purple/15 text-purple border-purple/25',
  gray: 'bg-bg4 text-text2 border-border',
}

export default function Badge({ children, color = 'gray', className }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border',
        colorStyles[color],
        className
      )}
    >
      {children}
    </span>
  )
}
