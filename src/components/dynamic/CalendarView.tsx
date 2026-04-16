import { useState, useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface CalendarConfig {
  dateField: string
  endDateField?: string
  titleField: string
  colorField?: string
}

interface CalendarViewProps {
  config: CalendarConfig
  data: any[]
}

const DAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']
const MONTHS = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']

function getVal(obj: any, key: string): any {
  if (!obj || !key) return null
  return key.split('.').reduce((v, k) => v?.[k], obj)
}

export default function CalendarView({ config, data }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedEvent, setSelectedEvent] = useState<any>(null)

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()

  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstDayOfWeek = (new Date(year, month, 1).getDay() + 6) % 7 // Monday = 0

  // Group events by date
  const eventsByDate = useMemo(() => {
    const map: Record<string, any[]> = {}
    for (const item of data) {
      const dateStr = getVal(item, config.dateField)
      if (!dateStr) continue
      // Parse various date formats
      let d: Date
      if (dateStr.includes('/')) {
        const [day, mon, yr] = dateStr.split('/')
        d = new Date(parseInt(yr), parseInt(mon) - 1, parseInt(day))
      } else {
        d = new Date(dateStr)
      }
      if (isNaN(d.getTime())) continue
      if (d.getMonth() !== month || d.getFullYear() !== year) continue
      const key = d.getDate().toString()
      if (!map[key]) map[key] = []
      map[key].push(item)
    }
    return map
  }, [data, config.dateField, month, year])

  const prev = () => setCurrentDate(new Date(year, month - 1, 1))
  const next = () => setCurrentDate(new Date(year, month + 1, 1))

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <button onClick={prev} className="p-1 rounded hover:bg-bg3 text-text3"><ChevronLeft size={18} /></button>
        <h3 className="font-semibold text-text">{MONTHS[month]} {year}</h3>
        <button onClick={next} className="p-1 rounded hover:bg-bg3 text-text3"><ChevronRight size={18} /></button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 text-center text-[10px] text-text3 font-medium border-b border-border px-2 pb-1">
        {DAYS.map(d => <div key={d}>{d}</div>)}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 flex-1 gap-px bg-border/30 p-px">
        {/* Empty cells before first day */}
        {Array.from({ length: firstDayOfWeek }).map((_, i) => (
          <div key={`empty-${i}`} className="bg-bg2 p-1 min-h-[60px]" />
        ))}

        {/* Day cells */}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1
          const events = eventsByDate[day.toString()] || []
          const isToday = day === new Date().getDate() && month === new Date().getMonth() && year === new Date().getFullYear()

          return (
            <div key={day} className={`bg-bg2 p-1 min-h-[60px] ${isToday ? 'ring-1 ring-gold/50' : ''}`}>
              <div className={`text-[10px] font-medium mb-0.5 ${isToday ? 'text-gold' : 'text-text3'}`}>{day}</div>
              {events.slice(0, 3).map((ev, j) => (
                <div key={j} onClick={() => setSelectedEvent(ev)}
                  className="text-[9px] bg-gold/10 text-gold border border-gold/20 rounded px-1 py-0.5 mb-0.5 truncate cursor-pointer hover:bg-gold/20">
                  {getVal(ev, config.titleField) || '—'}
                </div>
              ))}
              {events.length > 3 && <div className="text-[8px] text-text3">+{events.length - 3}</div>}
            </div>
          )
        })}
      </div>

      {/* Selected event detail */}
      {selectedEvent && (
        <div className="border-t border-border p-3 bg-bg3">
          <div className="flex justify-between items-center mb-2">
            <h4 className="font-medium text-sm text-text">{getVal(selectedEvent, config.titleField)}</h4>
            <button onClick={() => setSelectedEvent(null)} className="text-text3 text-xs hover:text-text">✕</button>
          </div>
          <div className="text-xs text-text3 space-y-0.5">
            {Object.entries(selectedEvent).map(([k, v]) => (
              <div key={k}><span className="text-text2">{k}:</span> {String(v)}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
