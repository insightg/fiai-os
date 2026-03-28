import {
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'

interface PieChartProps {
  data: { name: string; value: number }[]
  colors?: string[]
  height?: number
}

const DEFAULT_COLORS = ['#C9A84C', '#52B788', '#6BA3D6', '#E07070', '#9B72D4', '#F4A833']

interface TooltipPayloadEntry {
  name: string
  value: string | number
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayloadEntry[] }) {
  if (!active || !payload?.length) return null
  const entry = payload[0]
  return (
    <div className="bg-bg2 border border-border rounded-lg px-3 py-2 text-sm shadow-lg">
      <p className="text-text font-medium">
        {entry.name}: {entry.value}
      </p>
    </div>
  )
}

export default function PieChart({
  data,
  colors = DEFAULT_COLORS,
  height = 300,
}: PieChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsPieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={100}
          paddingAngle={2}
          dataKey="value"
        >
          {data.map((_, index) => (
            <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
          ))}
        </Pie>
        <Tooltip content={<CustomTooltip />} />
        <Legend
          formatter={(value: string) => <span className="text-text2 text-sm">{value}</span>}
        />
      </RechartsPieChart>
    </ResponsiveContainer>
  )
}
