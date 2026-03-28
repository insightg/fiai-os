import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

interface BarChartProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any[]
  dataKey: string
  xKey: string
  color?: string
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
        <p key={i} className="text-text font-medium">
          {entry.name}: {entry.value}
        </p>
      ))}
    </div>
  )
}

export default function BarChart({
  data,
  dataKey,
  xKey,
  color = '#C9A84C',
  height = 300,
}: BarChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsBarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2A2A35" vertical={false} />
        <XAxis dataKey={xKey} tick={{ fill: '#9A9494', fontSize: 12 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: '#9A9494', fontSize: 12 }} axisLine={false} tickLine={false} />
        <Tooltip content={<CustomTooltip />} />
        <Bar dataKey={dataKey} fill={color} radius={[4, 4, 0, 0]} />
      </RechartsBarChart>
    </ResponsiveContainer>
  )
}
