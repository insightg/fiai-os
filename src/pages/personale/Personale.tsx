import { useEffect, useState, useMemo } from 'react'
import { useAuthStore, usePersonalStore } from '../../store'
import type { NoteCard, Evento, EventoTipo, CardPriorita } from '../../types'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import Modal from '../../components/ui/Modal'
import { Input, Select, Textarea } from '../../components/ui/Form'
import toast from 'react-hot-toast'
import {
  Plus,
  Trash2,
  Calendar,
  Kanban,
  ChevronLeft,
  ChevronRight,
  Clock,
  CheckCircle2,
  Circle,
  MoreVertical,
} from 'lucide-react'

type TabMode = 'board' | 'calendar'

const PRIORITY_BADGE: Record<CardPriorita, { label: string; color: 'gray' | 'blue' | 'amber' | 'red' }> = {
  bassa: { label: 'Bassa', color: 'gray' },
  media: { label: 'Media', color: 'blue' },
  alta: { label: 'Alta', color: 'amber' },
  urgente: { label: 'Urgente', color: 'red' },
}

const PRIORITY_OPTIONS = [
  { value: 'bassa', label: 'Bassa' },
  { value: 'media', label: 'Media' },
  { value: 'alta', label: 'Alta' },
  { value: 'urgente', label: 'Urgente' },
]

const TIPO_OPTIONS = [
  { value: 'evento', label: 'Evento' },
  { value: 'riunione', label: 'Riunione' },
  { value: 'scadenza', label: 'Scadenza' },
  { value: 'promemoria', label: 'Promemoria' },
]

const TIPO_COLORS: Record<EventoTipo, string> = {
  evento: 'bg-gold',
  riunione: 'bg-blue',
  scadenza: 'bg-amber',
  promemoria: 'bg-purple',
}

const COLORE_OPTIONS = [
  { value: '', label: 'Nessuno' },
  { value: '#3B82F6', label: 'Blu' },
  { value: '#10B981', label: 'Verde' },
  { value: '#F59E0B', label: 'Ambra' },
  { value: '#EF4444', label: 'Rosso' },
  { value: '#8B5CF6', label: 'Viola' },
  { value: '#EC4899', label: 'Rosa' },
]

const DAYS_IT = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']

const MONTHS_IT = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
]

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('it-IT', {
    day: '2-digit',
    month: '2-digit',
  })
}

// ── Board Tab ───────────────────────────────────────────────

function BoardTab() {
  const { board, createColumn, updateColumn, deleteColumn, createCard, updateCard, moveCard, deleteCard } =
    usePersonalStore()

  const [quickAddTexts, setQuickAddTexts] = useState<Record<string, string>>({})
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null)
  const [editingColumnName, setEditingColumnName] = useState('')
  const [editCardModal, setEditCardModal] = useState<NoteCard | null>(null)
  const [cardForm, setCardForm] = useState({
    titolo: '',
    contenuto: '',
    priorita: 'media' as CardPriorita,
    scadenza: '',
    colore: '',
  })
  const [moveDropdownCard, setMoveDropdownCard] = useState<string | null>(null)

  const columns = board?.columns ?? []

  function handleQuickAdd(columnId: string) {
    const text = (quickAddTexts[columnId] ?? '').trim()
    if (!text) return
    createCard(columnId, { titolo: text }).then((card) => {
      if (card) {
        toast.success('Nota creata')
        setQuickAddTexts((prev) => ({ ...prev, [columnId]: '' }))
      } else {
        toast.error('Errore nella creazione')
      }
    })
  }

  function openEditCard(card: NoteCard) {
    setEditCardModal(card)
    setCardForm({
      titolo: card.titolo,
      contenuto: card.contenuto ?? '',
      priorita: card.priorita,
      scadenza: card.scadenza ?? '',
      colore: card.colore ?? '',
    })
  }

  function handleSaveCard() {
    if (!editCardModal) return
    updateCard(editCardModal.id, {
      titolo: cardForm.titolo,
      contenuto: cardForm.contenuto || null,
      priorita: cardForm.priorita,
      scadenza: cardForm.scadenza || null,
      colore: cardForm.colore || null,
    }).then(() => {
      toast.success('Nota aggiornata')
      setEditCardModal(null)
    })
  }

  function handleDeleteCard(id: string) {
    deleteCard(id).then(() => {
      toast.success('Nota eliminata')
      setEditCardModal(null)
    })
  }

  function handleMoveCard(cardId: string, targetColumnId: string) {
    const targetCol = columns.find((c) => c.id === targetColumnId)
    const newOrdine = (targetCol?.cards?.length ?? 0)
    moveCard(cardId, targetColumnId, newOrdine).then(() => {
      toast.success('Nota spostata')
      setMoveDropdownCard(null)
    })
  }

  function handleToggleComplete(card: NoteCard) {
    updateCard(card.id, { completata: !card.completata })
  }

  function handleAddColumn() {
    if (!board) return
    const nome = 'Nuova Colonna'
    createColumn(board.id, nome).then((col) => {
      if (col) toast.success('Colonna creata')
      else toast.error('Errore nella creazione')
    })
  }

  function handleColumnNameSave(colId: string) {
    if (editingColumnName.trim()) {
      updateColumn(colId, { nome: editingColumnName.trim() })
    }
    setEditingColumnId(null)
  }

  function handleDeleteColumn(colId: string) {
    if (!confirm('Eliminare questa colonna e tutte le sue note?')) return
    deleteColumn(colId).then(() => toast.success('Colonna eliminata'))
  }

  return (
    <>
      <div className="flex gap-4 overflow-x-auto pb-4" style={{ minHeight: 'calc(100vh - 240px)' }}>
        {columns.map((col) => (
          <div
            key={col.id}
            className="w-[280px] min-w-[280px] bg-bg3 rounded-xl border border-border flex flex-col"
          >
            {/* Column Header */}
            <div className="flex items-center justify-between px-3 py-3 border-b border-border">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: col.colore ?? '#3B82F6' }}
                />
                {editingColumnId === col.id ? (
                  <input
                    autoFocus
                    value={editingColumnName}
                    onChange={(e) => setEditingColumnName(e.target.value)}
                    onBlur={() => handleColumnNameSave(col.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleColumnNameSave(col.id)
                      if (e.key === 'Escape') setEditingColumnId(null)
                    }}
                    className="bg-bg2 border border-border rounded px-2 py-0.5 text-sm text-text w-full"
                  />
                ) : (
                  <span
                    className="font-semibold text-sm text-text truncate cursor-pointer"
                    onDoubleClick={() => {
                      setEditingColumnId(col.id)
                      setEditingColumnName(col.nome)
                    }}
                  >
                    {col.nome}
                  </span>
                )}
                <span className="text-xs text-text3 shrink-0">
                  {col.cards?.length ?? 0}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => {
                    const text = (quickAddTexts[col.id] ?? '').trim()
                    if (!text) {
                      setQuickAddTexts((prev) => ({ ...prev, [col.id]: '' }))
                      // Focus will happen naturally via the input below
                    }
                    createCard(col.id, { titolo: 'Nuova nota' }).then((card) => {
                      if (card) toast.success('Nota creata')
                    })
                  }}
                  className="p-1 rounded-md text-text3 hover:text-gold hover:bg-bg2 transition-colors"
                  title="Aggiungi nota"
                >
                  <Plus size={14} />
                </button>
                <button
                  onClick={() => handleDeleteColumn(col.id)}
                  className="p-1 rounded-md text-text3 hover:text-red hover:bg-bg2 transition-colors"
                  title="Elimina colonna"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            {/* Cards List */}
            <div className="flex-1 overflow-y-auto px-2 py-2 flex flex-col gap-2">
              {col.cards?.map((card) => (
                <div
                  key={card.id}
                  className="bg-bg2 rounded-xl border border-border p-3 cursor-pointer hover:border-gold/30 transition-colors group relative"
                  style={card.colore ? { borderLeftColor: card.colore, borderLeftWidth: 3 } : undefined}
                  onClick={() => openEditCard(card)}
                >
                  <div className="flex items-start gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleToggleComplete(card)
                      }}
                      className="mt-0.5 shrink-0 text-text3 hover:text-gold transition-colors"
                    >
                      {card.completata ? (
                        <CheckCircle2 size={16} className="text-green" />
                      ) : (
                        <Circle size={16} />
                      )}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-sm font-medium text-text ${
                          card.completata ? 'line-through opacity-50' : ''
                        }`}
                      >
                        {card.titolo}
                      </p>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <Badge color={PRIORITY_BADGE[card.priorita].color}>
                          {PRIORITY_BADGE[card.priorita].label}
                        </Badge>
                        {card.scadenza && (
                          <span className="text-xs text-text3 flex items-center gap-1">
                            <Clock size={10} />
                            {formatDate(card.scadenza)}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Move dropdown */}
                    <div className="relative shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setMoveDropdownCard(moveDropdownCard === card.id ? null : card.id)
                        }}
                        className="p-1 rounded-md text-text3 hover:text-text hover:bg-bg3 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <MoreVertical size={14} />
                      </button>
                      {moveDropdownCard === card.id && (
                        <div className="absolute right-0 top-full mt-1 z-10 bg-bg2 border border-border rounded-lg shadow-xl py-1 min-w-[160px]">
                          <p className="px-3 py-1 text-xs text-text3 font-medium">Sposta in...</p>
                          {columns
                            .filter((c) => c.id !== col.id)
                            .map((targetCol) => (
                              <button
                                key={targetCol.id}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleMoveCard(card.id, targetCol.id)
                                }}
                                className="w-full text-left px-3 py-1.5 text-sm text-text2 hover:bg-bg3 hover:text-text transition-colors flex items-center gap-2"
                              >
                                <div
                                  className="w-2 h-2 rounded-full"
                                  style={{ backgroundColor: targetCol.colore ?? '#3B82F6' }}
                                />
                                {targetCol.nome}
                              </button>
                            ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Quick Add */}
            <div className="px-2 pb-2">
              <input
                value={quickAddTexts[col.id] ?? ''}
                onChange={(e) =>
                  setQuickAddTexts((prev) => ({ ...prev, [col.id]: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleQuickAdd(col.id)
                }}
                placeholder="+ Aggiungi nota..."
                className="w-full px-3 py-2 rounded-lg bg-bg2 border border-border text-text text-sm placeholder:text-text3 focus:outline-none focus:border-gold/50 transition-colors"
              />
            </div>
          </div>
        ))}

        {/* Add Column Button */}
        <button
          onClick={handleAddColumn}
          className="w-[280px] min-w-[280px] bg-bg3/50 rounded-xl border border-dashed border-border hover:border-gold/30 flex items-center justify-center gap-2 text-text3 hover:text-gold transition-colors"
        >
          <Plus size={16} />
          <span className="text-sm font-medium">Aggiungi Colonna</span>
        </button>
      </div>

      {/* Edit Card Modal */}
      <Modal
        open={!!editCardModal}
        onClose={() => setEditCardModal(null)}
        title="Modifica Nota"
        className="max-w-lg"
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Titolo"
            value={cardForm.titolo}
            onChange={(e) => setCardForm((f) => ({ ...f, titolo: e.target.value }))}
          />
          <Textarea
            label="Contenuto"
            value={cardForm.contenuto}
            onChange={(e) => setCardForm((f) => ({ ...f, contenuto: e.target.value }))}
            rows={4}
          />
          <div className="grid grid-cols-2 gap-4">
            <Select
              label="Priorita"
              value={cardForm.priorita}
              onChange={(e) =>
                setCardForm((f) => ({ ...f, priorita: e.target.value as CardPriorita }))
              }
              options={PRIORITY_OPTIONS}
            />
            <Input
              label="Scadenza"
              type="date"
              value={cardForm.scadenza}
              onChange={(e) => setCardForm((f) => ({ ...f, scadenza: e.target.value }))}
            />
          </div>
          <Select
            label="Colore"
            value={cardForm.colore}
            onChange={(e) => setCardForm((f) => ({ ...f, colore: e.target.value }))}
            options={COLORE_OPTIONS}
          />
          <div className="flex items-center justify-between pt-2">
            <button
              onClick={() => editCardModal && handleDeleteCard(editCardModal.id)}
              className="flex items-center gap-1.5 text-sm text-red hover:text-red/80 transition-colors"
            >
              <Trash2 size={14} />
              Elimina
            </button>
            <div className="flex gap-2">
              <Button onClick={() => setEditCardModal(null)}>Annulla</Button>
              <Button variant="primary" onClick={handleSaveCard}>
                Salva
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </>
  )
}

// ── Calendar Tab ────────────────────────────────────────────

function CalendarTab() {
  const profile = useAuthStore((s) => s.profile)
  const { events, fetchEvents, createEvent, updateEvent, deleteEvent } = usePersonalStore()

  const today = new Date()
  const [currentMonth, setCurrentMonth] = useState(today.getMonth())
  const [currentYear, setCurrentYear] = useState(today.getFullYear())
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)
  const [eventModalOpen, setEventModalOpen] = useState(false)
  const [editingEvent, setEditingEvent] = useState<Evento | null>(null)
  const [eventForm, setEventForm] = useState({
    titolo: '',
    descrizione: '',
    data_inizio: '',
    data_fine: '',
    tutto_il_giorno: false,
    tipo: 'evento' as EventoTipo,
    colore: '',
  })

  useEffect(() => {
    if (profile?.id) {
      fetchEvents(profile.id, currentMonth, currentYear)
    }
  }, [profile?.id, currentMonth, currentYear, fetchEvents])

  function prevMonth() {
    if (currentMonth === 0) {
      setCurrentMonth(11)
      setCurrentYear((y) => y - 1)
    } else {
      setCurrentMonth((m) => m - 1)
    }
  }

  function nextMonth() {
    if (currentMonth === 11) {
      setCurrentMonth(0)
      setCurrentYear((y) => y + 1)
    } else {
      setCurrentMonth((m) => m + 1)
    }
  }

  // Build calendar grid
  const calendarDays = useMemo(() => {
    const firstDay = new Date(currentYear, currentMonth, 1)
    // getDay(): 0=Sun. We want Mon=0
    let startDow = firstDay.getDay() - 1
    if (startDow < 0) startDow = 6

    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate()
    const daysInPrevMonth = new Date(currentYear, currentMonth, 0).getDate()

    const cells: { date: Date; inMonth: boolean }[] = []

    // Previous month fill
    for (let i = startDow - 1; i >= 0; i--) {
      cells.push({
        date: new Date(currentYear, currentMonth - 1, daysInPrevMonth - i),
        inMonth: false,
      })
    }

    // Current month
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({
        date: new Date(currentYear, currentMonth, d),
        inMonth: true,
      })
    }

    // Next month fill
    const remaining = 7 - (cells.length % 7)
    if (remaining < 7) {
      for (let d = 1; d <= remaining; d++) {
        cells.push({
          date: new Date(currentYear, currentMonth + 1, d),
          inMonth: false,
        })
      }
    }

    return cells
  }, [currentMonth, currentYear])

  function getEventsForDay(date: Date): Evento[] {
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    return events.filter((e) => e.data_inizio.startsWith(dateStr))
  }

  function isToday(date: Date): boolean {
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    )
  }

  function handleDayClick(date: Date) {
    setSelectedDay(date)
  }

  function openNewEventForm() {
    if (!selectedDay) return
    const dateStr = `${selectedDay.getFullYear()}-${String(selectedDay.getMonth() + 1).padStart(2, '0')}-${String(selectedDay.getDate()).padStart(2, '0')}`
    setEditingEvent(null)
    setEventForm({
      titolo: '',
      descrizione: '',
      data_inizio: `${dateStr}T09:00`,
      data_fine: `${dateStr}T10:00`,
      tutto_il_giorno: false,
      tipo: 'evento',
      colore: '',
    })
    setEventModalOpen(true)
  }

  function openEditEvent(evento: Evento) {
    setEditingEvent(evento)
    setEventForm({
      titolo: evento.titolo,
      descrizione: evento.descrizione ?? '',
      data_inizio: evento.data_inizio.slice(0, 16),
      data_fine: evento.data_fine?.slice(0, 16) ?? '',
      tutto_il_giorno: evento.tutto_il_giorno,
      tipo: evento.tipo,
      colore: evento.colore ?? '',
    })
    setSelectedDay(null)
    setEventModalOpen(true)
  }

  function handleSaveEvent() {
    if (!profile?.id) return
    if (!eventForm.titolo.trim()) {
      toast.error('Inserisci un titolo')
      return
    }

    const payload = {
      titolo: eventForm.titolo.trim(),
      descrizione: eventForm.descrizione || null,
      data_inizio: new Date(eventForm.data_inizio).toISOString(),
      data_fine: eventForm.data_fine ? new Date(eventForm.data_fine).toISOString() : null,
      tutto_il_giorno: eventForm.tutto_il_giorno,
      tipo: eventForm.tipo,
      colore: eventForm.colore || null,
    }

    if (editingEvent) {
      updateEvent(editingEvent.id, payload).then(() => {
        toast.success('Evento aggiornato')
        setEventModalOpen(false)
        setEditingEvent(null)
      })
    } else {
      createEvent({ ...payload, user_id: profile.id }).then((ev) => {
        if (ev) {
          toast.success('Evento creato')
          setEventModalOpen(false)
        } else {
          toast.error('Errore nella creazione')
        }
      })
    }
  }

  function handleDeleteEvent(id: string) {
    deleteEvent(id).then(() => {
      toast.success('Evento eliminato')
      setEventModalOpen(false)
      setEditingEvent(null)
    })
  }

  const selectedDayEvents = selectedDay ? getEventsForDay(selectedDay) : []

  return (
    <>
      {/* Calendar Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-text">
          {MONTHS_IT[currentMonth]} {currentYear}
        </h2>
        <div className="flex items-center gap-1">
          <button
            onClick={prevMonth}
            className="p-2 rounded-lg text-text3 hover:text-text hover:bg-bg3 transition-colors"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={nextMonth}
            className="p-2 rounded-lg text-text3 hover:text-text hover:bg-bg3 transition-colors"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="bg-bg2 rounded-xl border border-border overflow-hidden">
        {/* Day Headers */}
        <div className="grid grid-cols-7 border-b border-border">
          {DAYS_IT.map((day) => (
            <div
              key={day}
              className="px-2 py-2 text-center text-xs font-semibold text-text3 uppercase"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Day Cells */}
        <div className="grid grid-cols-7">
          {calendarDays.map((cell, idx) => {
            const dayEvents = getEventsForDay(cell.date)
            const isCurrentDay = isToday(cell.date)
            const visibleEvents = dayEvents.slice(0, 3)
            const moreCount = dayEvents.length - 3

            return (
              <div
                key={idx}
                onClick={() => handleDayClick(cell.date)}
                className={`min-h-[90px] p-1.5 border-b border-r border-border cursor-pointer transition-colors hover:bg-bg3/50 ${
                  !cell.inMonth ? 'opacity-30' : ''
                } ${isCurrentDay ? 'ring-2 ring-inset ring-gold' : ''}`}
              >
                <div
                  className={`text-xs font-medium mb-1 ${
                    isCurrentDay ? 'text-gold font-bold' : 'text-text2'
                  }`}
                >
                  {cell.date.getDate()}
                </div>
                <div className="flex flex-col gap-0.5">
                  {visibleEvents.map((ev) => (
                    <div
                      key={ev.id}
                      className={`${TIPO_COLORS[ev.tipo]} rounded px-1 py-0.5 text-[10px] font-medium text-white truncate cursor-pointer`}
                      onClick={(e) => {
                        e.stopPropagation()
                        openEditEvent(ev)
                      }}
                      title={ev.titolo}
                    >
                      {ev.titolo}
                    </div>
                  ))}
                  {moreCount > 0 && (
                    <span className="text-[10px] text-text3 pl-1">+{moreCount}</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Day Detail Modal */}
      <Modal
        open={!!selectedDay}
        onClose={() => setSelectedDay(null)}
        title={
          selectedDay
            ? `${selectedDay.getDate()} ${MONTHS_IT[selectedDay.getMonth()]} ${selectedDay.getFullYear()}`
            : ''
        }
      >
        <div className="flex flex-col gap-3">
          {selectedDayEvents.length === 0 && (
            <p className="text-sm text-text3 py-4 text-center">Nessun evento per questo giorno</p>
          )}
          {selectedDayEvents.map((ev) => (
            <div
              key={ev.id}
              className="flex items-center gap-3 p-3 bg-bg3 rounded-lg cursor-pointer hover:bg-bg3/70 transition-colors"
              onClick={() => openEditEvent(ev)}
            >
              <div className={`w-3 h-3 rounded-full shrink-0 ${TIPO_COLORS[ev.tipo]}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text">{ev.titolo}</p>
                {!ev.tutto_il_giorno && (
                  <p className="text-xs text-text3 flex items-center gap-1 mt-0.5">
                    <Clock size={10} />
                    {new Date(ev.data_inizio).toLocaleTimeString('it-IT', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {ev.data_fine && (
                      <>
                        {' - '}
                        {new Date(ev.data_fine).toLocaleTimeString('it-IT', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </>
                    )}
                  </p>
                )}
                {ev.tutto_il_giorno && (
                  <p className="text-xs text-text3 mt-0.5">Tutto il giorno</p>
                )}
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleDeleteEvent(ev.id)
                }}
                className="p-1 text-text3 hover:text-red transition-colors"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <Button variant="primary" onClick={openNewEventForm} className="mt-2">
            <Plus size={14} />
            Nuovo Evento
          </Button>
        </div>
      </Modal>

      {/* Event Form Modal */}
      <Modal
        open={eventModalOpen}
        onClose={() => {
          setEventModalOpen(false)
          setEditingEvent(null)
        }}
        title={editingEvent ? 'Modifica Evento' : 'Nuovo Evento'}
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Titolo"
            value={eventForm.titolo}
            onChange={(e) => setEventForm((f) => ({ ...f, titolo: e.target.value }))}
          />
          <Textarea
            label="Descrizione"
            value={eventForm.descrizione}
            onChange={(e) => setEventForm((f) => ({ ...f, descrizione: e.target.value }))}
            rows={3}
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Data inizio"
              type="datetime-local"
              value={eventForm.data_inizio}
              onChange={(e) => setEventForm((f) => ({ ...f, data_inizio: e.target.value }))}
            />
            <Input
              label="Data fine"
              type="datetime-local"
              value={eventForm.data_fine}
              onChange={(e) => setEventForm((f) => ({ ...f, data_fine: e.target.value }))}
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="tutto_il_giorno"
              checked={eventForm.tutto_il_giorno}
              onChange={(e) =>
                setEventForm((f) => ({ ...f, tutto_il_giorno: e.target.checked }))
              }
              className="rounded border-border bg-bg3 text-gold focus:ring-gold/50"
            />
            <label htmlFor="tutto_il_giorno" className="text-sm text-text2">
              Tutto il giorno
            </label>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Select
              label="Tipo"
              value={eventForm.tipo}
              onChange={(e) =>
                setEventForm((f) => ({ ...f, tipo: e.target.value as EventoTipo }))
              }
              options={TIPO_OPTIONS}
            />
            <Select
              label="Colore"
              value={eventForm.colore}
              onChange={(e) => setEventForm((f) => ({ ...f, colore: e.target.value }))}
              options={COLORE_OPTIONS}
            />
          </div>
          <div className="flex items-center justify-between pt-2">
            {editingEvent ? (
              <button
                onClick={() => handleDeleteEvent(editingEvent.id)}
                className="flex items-center gap-1.5 text-sm text-red hover:text-red/80 transition-colors"
              >
                <Trash2 size={14} />
                Elimina
              </button>
            ) : (
              <div />
            )}
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  setEventModalOpen(false)
                  setEditingEvent(null)
                }}
              >
                Annulla
              </Button>
              <Button variant="primary" onClick={handleSaveEvent}>
                Salva
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </>
  )
}

// ── Main Page ───────────────────────────────────────────────

export default function Personale() {
  const profile = useAuthStore((s) => s.profile)
  const { loading, fetchBoard } = usePersonalStore()
  const [activeTab, setActiveTab] = useState<TabMode>('board')

  useEffect(() => {
    if (profile?.id) {
      fetchBoard(profile.id)
    }
  }, [profile?.id, fetchBoard])

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold font-display text-text">Area Personale</h1>
        <p className="text-sm text-text3 mt-1">Organizza le tue attivita e il tuo calendario</p>
      </div>

      {/* Tab Switcher */}
      <div className="flex items-center gap-1 border-b border-border">
        <button
          onClick={() => setActiveTab('board')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
            activeTab === 'board'
              ? 'border-gold text-gold'
              : 'border-transparent text-text3 hover:text-text'
          }`}
        >
          <Kanban size={16} />
          Board
        </button>
        <button
          onClick={() => setActiveTab('calendar')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
            activeTab === 'calendar'
              ? 'border-gold text-gold'
              : 'border-transparent text-text3 hover:text-text'
          }`}
        >
          <Calendar size={16} />
          Calendario
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="text-gold animate-pulse">Caricamento...</div>
        </div>
      )}

      {/* Content */}
      {!loading && activeTab === 'board' && <BoardTab />}
      {!loading && activeTab === 'calendar' && <CalendarTab />}
    </div>
  )
}
