import {
  LineChart as RechartsLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

interface LineChartProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any[]
  lines: { dataKey: string; color: string; name?: string }[]
  xKey: string
  height?: number
}

interface TooltipPayloadEntry {
  name: string
  value: string | number
  color?: string
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayloadEntry[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-bg2 border border-border rounded-lg px-3 py-2 text-sm shadow-lg">
      <p className="text-text3 mb-1">{label}</p>
      {payload.map((entry: TooltipPayloadEntry, i: number) => (
        <p key={i} style={{ color: entry.color }} className="font-medium">
          {entry.name}: {entry.value}
        </p>
      ))}
    </div>
  )
}

export default function LineChart({
  data,
  lines,
  xKey,
  height = 300,
}: LineChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsLineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2A2A35" vertical={false} />
        <XAxis dataKey={xKey} tick={{ fill: '#9A9494', fontSize: 12 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: '#9A9494', fontSize: 12 }} axisLine={false} tickLine={false} />
        <Tooltip content={<CustomTooltip />} />
        {lines.map((line) => (
          <Line
            key={line.dataKey}
            type="monotone"
            dataKey={line.dataKey}
            stroke={line.color}
            name={line.name ?? line.dataKey}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: line.color }}
          />
        ))}
      </RechartsLineChart>
    </ResponsiveContainer>
  )
}
