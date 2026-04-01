interface ChartConfig {
  type: 'bar' | 'pie' | 'line' | 'donut'
  data: { label: string; value: number; color?: string }[]
}

interface ChartViewProps {
  config: ChartConfig
  title?: string
}

const DEFAULT_COLORS = ['#C41E3A', '#1976D2', '#2D8B56', '#E68A00', '#9C27B0', '#D32F2F', '#455A64', '#7B1FA2']

export default function ChartView({ config, title }: ChartViewProps) {
  const maxVal = Math.max(...config.data.map(d => d.value), 1)
  const total = config.data.reduce((s, d) => s + d.value, 0)

  if (config.type === 'bar') {
    return (
      <div className="space-y-3">
        {config.data.map((item, i) => {
          const color = item.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]
          const width = Math.max((item.value / maxVal) * 100, 2)
          return (
            <div key={i}>
              <div className="flex justify-between items-baseline mb-1">
                <span className="text-xs text-text">{item.label}</span>
                <span className="text-xs font-semibold text-text">
                  {item.value >= 1000 ? `€ ${item.value.toLocaleString('it-IT')}` : item.value.toLocaleString('it-IT')}
                </span>
              </div>
              <div className="h-6 bg-bg3 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${width}%`, backgroundColor: color }}
                />
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  if (config.type === 'pie' || config.type === 'donut') {
    // Simple CSS pie chart
    let cumPercent = 0
    const gradientStops = config.data.map((item, i) => {
      const color = item.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]
      const percent = total > 0 ? (item.value / total) * 100 : 0
      const stop = `${color} ${cumPercent}% ${cumPercent + percent}%`
      cumPercent += percent
      return stop
    }).join(', ')

    return (
      <div className="flex items-center gap-6">
        <div
          className="w-32 h-32 rounded-full shrink-0"
          style={{
            background: `conic-gradient(${gradientStops})`,
            ...(config.type === 'donut' ? {} : {}),
          }}
        >
          {config.type === 'donut' && (
            <div className="w-full h-full flex items-center justify-center">
              <div className="w-16 h-16 rounded-full bg-bg2" />
            </div>
          )}
        </div>
        <div className="space-y-2">
          {config.data.map((item, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: item.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length] }} />
              <span className="text-xs text-text">{item.label}</span>
              <span className="text-xs font-semibold text-text ml-auto">{item.value.toLocaleString('it-IT')}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Fallback: render as simple stat cards
  return (
    <div className="grid grid-cols-2 gap-3">
      {config.data.map((item, i) => (
        <div key={i} className="bg-bg3 rounded-lg p-4 border border-border">
          <p className="text-[10px] text-text3">{item.label}</p>
          <p className="text-lg font-bold text-text mt-1" style={{ color: item.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length] }}>
            {item.value >= 1000 ? `€ ${item.value.toLocaleString('it-IT')}` : item.value.toLocaleString('it-IT')}
          </p>
        </div>
      ))}
    </div>
  )
}
