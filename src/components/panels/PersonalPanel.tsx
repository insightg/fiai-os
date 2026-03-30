import { useState, useEffect, useMemo, type FormEvent } from 'react'
import {
  Kanban,
  Calendar,
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import AgentPanel from './AgentPanel'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import { Input, Select, Textarea } from '../ui/Form'
import { useAuthStore, usePersonalStore } from '../../store'
import type { CardPriorita, EventoTipo, NoteCard, Evento } from '../../types'
import toast from 'react-hot-toast'

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

const TIPO_EVENTO_OPTIONS = [
  { value: 'evento', label: 'Evento' },
  { value: 'riunione', label: 'Riunione' },
  { value: 'scadenza', label: 'Scadenza' },
  { value: 'promemoria', label: 'Promemoria' },
]

const defaultCardForm = {
  titolo: '',
  contenuto: '',
  priorita: 'media' as CardPriorita,
  scadenza: '',
  colId: '',
}

const defaultEventForm = {
  titolo: '',
  descrizione: '',
  data_inizio: '',
  data_fine: '',
  tipo: 'evento' as EventoTipo,
}

export default function PersonalPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState('board')
  const user = useAuthStore((s) => s.user)
  const {
    board,
    events,
    fetchBoard,
    fetchEvents,
    createCard,
    updateCard,
    deleteCard,
    createEvent,
    updateEvent,
    deleteEvent,
  } = usePersonalStore()

  const [calMonth, setCalMonth] = useState(new Date().getMonth())
  const [calYear, setCalYear] = useState(new Date().getFullYear())

  // Card CRUD
  const [editCard, setEditCard] = useState<NoteCard | null>(null)
  const [cardFormOpen, setCardFormOpen] = useState(false)
  const [cardForm, setCardForm] = useState({ ...defaultCardForm })

  // Event CRUD
  const [editEvent, setEditEvent] = useState<Evento | null>(null)
  const [eventFormOpen, setEventFormOpen] = useState(false)
  const [eventForm, setEventForm] = useState({ ...defaultEventForm })

  useEffect(() => {
    if (!user) return
    fetchBoard(user.id)
  }, [user?.id])

  useEffect(() => {
    if (!user) return
    fetchEvents(user.id, calMonth + 1, calYear)
  }, [user?.id, calMonth, calYear])

  const columns = board?.columns ?? []

  // Card handlers
  const openCreateCard = () => {
    setEditCard(null)
    setCardForm({ ...defaultCardForm, colId: columns[0]?.id ?? '' })
    setCardFormOpen(true)
  }
  const openEditCard = (card: NoteCard) => {
    setEditCard(card)
    setCardForm({
      titolo: card.titolo,
      contenuto: card.contenuto ?? '',
      priorita: card.priorita,
      scadenza: card.scadenza ?? '',
      colId: card.column_id,
    })
    setCardFormOpen(true)
  }
  const handleSaveCard = async (e: FormEvent) => {
    e.preventDefault()
    if (!user) return
    if (!cardForm.titolo.trim()) { toast.error('Titolo obbligatorio'); return }
    if (editCard) {
      await updateCard(editCard.id, {
        titolo: cardForm.titolo.trim(),
        contenuto: cardForm.contenuto.trim() || null,
        priorita: cardForm.priorita,
        scadenza: cardForm.scadenza || null,
      })
      toast.success('Card aggiornata')
    } else {
      await createCard(cardForm.colId, {
        titolo: cardForm.titolo.trim(),
        contenuto: cardForm.contenuto.trim() || null,
        priorita: cardForm.priorita,
        scadenza: cardForm.scadenza || null,
        ordine: 0,
      })
      toast.success('Card creata')
    }
    setCardFormOpen(false)
    fetchBoard(user.id)
  }
  const handleDeleteCard = async (cardId: string) => {
    if (!confirm('Eliminare questa card?')) return
    await deleteCard(cardId)
    if (user) fetchBoard(user.id)
    toast.success('Card eliminata')
  }

  // Event handlers
  const openCreateEvent = () => {
    setEditEvent(null)
    setEventForm({ ...defaultEventForm })
    setEventFormOpen(true)
  }
  const openEditEvent = (ev: Evento) => {
    setEditEvent(ev)
    setEventForm({
      titolo: ev.titolo,
      descrizione: ev.descrizione ?? '',
      data_inizio: ev.data_inizio ? ev.data_inizio.slice(0, 10) : '',
      data_fine: ev.data_fine ? ev.data_fine.slice(0, 10) : '',
      tipo: ev.tipo,
    })
    setEventFormOpen(true)
  }
  const handleSaveEvent = async (e: FormEvent) => {
    e.preventDefault()
    if (!user) return
    if (!eventForm.titolo.trim() || !eventForm.data_inizio) { toast.error('Titolo e data obbligatori'); return }
    if (editEvent) {
      await updateEvent(editEvent.id, {
        titolo: eventForm.titolo.trim(),
        descrizione: eventForm.descrizione.trim() || null,
        data_inizio: new Date(eventForm.data_inizio).toISOString(),
        data_fine: eventForm.data_fine ? new Date(eventForm.data_fine).toISOString() : null,
        tipo: eventForm.tipo,
      })
      toast.success('Evento aggiornato')
    } else {
      await createEvent({
        titolo: eventForm.titolo.trim(),
        descrizione: eventForm.descrizione.trim() || null,
        data_inizio: new Date(eventForm.data_inizio).toISOString(),
        data_fine: eventForm.data_fine ? new Date(eventForm.data_fine).toISOString() : null,
        tipo: eventForm.tipo,
        user_id: user.id,
        tutto_il_giorno: true,
        colore: null,
      })
      toast.success('Evento creato')
    }
    setEventFormOpen(false)
    fetchEvents(user.id, calMonth + 1, calYear)
  }
  const handleDeleteEvent = async (evId: string) => {
    if (!confirm('Eliminare questo evento?')) return
    await deleteEvent(evId)
    if (user) fetchEvents(user.id, calMonth + 1, calYear)
    toast.success('Evento eliminato')
  }

  const tabs = [
    { key: 'board', label: 'Board', icon: Kanban },
    { key: 'calendario', label: 'Calendario', icon: Calendar },
  ]

  const MONTH_NAMES = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']

  const calDays = useMemo(() => {
    const first = new Date(calYear, calMonth, 1)
    const startDay = first.getDay() || 7
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate()
    const days: (number | null)[] = []
    for (let i = 1; i < startDay; i++) days.push(null)
    for (let i = 1; i <= daysInMonth; i++) days.push(i)
    return days
  }, [calMonth, calYear])

  const eventsByDay = useMemo(() => {
    const map: Record<number, typeof events> = {}
    events.forEach((ev) => {
      const d = new Date(ev.data_inizio).getDate()
      if (!map[d]) map[d] = []
      map[d].push(ev)
    })
    return map
  }, [events])

  const prevMonth = () => {
    if (calMonth === 0) { setCalMonth(11); setCalYear((y) => y - 1) }
    else setCalMonth((m) => m - 1)
  }
  const nextMonth = () => {
    if (calMonth === 11) { setCalMonth(0); setCalYear((y) => y + 1) }
    else setCalMonth((m) => m + 1)
  }

  return (
    <AgentPanel title="Personale" color="#6B7280" tabs={tabs} activeTab={tab} onTabChange={setTab} onClose={onClose}>
      {tab === 'board' && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-text2">Le tue note</span>
            <Button
              size="sm"
              variant="primary"
              onClick={openCreateCard}
              disabled={columns.length === 0}
            >
              <Plus size={13} />
            </Button>
          </div>
          {columns.length === 0 && (
            <p className="text-xs text-text3 text-center py-6">Nessuna board configurata</p>
          )}
          <div className="space-y-3">
            {columns.map((col) => (
              <div key={col.id}>
                <div className="flex items-center gap-2 mb-1.5">
                  {col.colore && <div className="w-2 h-2 rounded-full" style={{ backgroundColor: col.colore }} />}
                  <span className="text-[10px] font-semibold text-text3 uppercase tracking-wider">{col.nome}</span>
                  <span className="text-[10px] text-text3">({(col.cards ?? []).length})</span>
                </div>
                <div className="space-y-0.5">
                  {(col.cards ?? []).map((card) => (
                    <div
                      key={card.id}
                      onClick={() => openEditCard(card)}
                      className="bg-bg2 border border-border rounded-lg px-2.5 py-1.5 group hover:border-gold/20 transition-colors cursor-pointer"
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-text truncate flex-1">{card.titolo}</p>
                        <div className="flex items-center gap-1 shrink-0">
                          <Badge color={PRIORITY_BADGE[card.priorita].color}>
                            {PRIORITY_BADGE[card.priorita].label}
                          </Badge>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteCard(card.id) }}
                            className="p-0.5 rounded text-text3 hover:text-red opacity-0 group-hover:opacity-100 transition-all"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>
                      {card.contenuto && (
                        <p className="text-[10px] text-text3 mt-0.5 truncate">{card.contenuto}</p>
                      )}
                      {card.scadenza && (
                        <p className="text-[10px] text-amber mt-0.5">Scad: {new Date(card.scadenza).toLocaleDateString('it-IT')}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'calendario' && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <button onClick={prevMonth} className="p-1 rounded text-text3 hover:text-text hover:bg-bg3 transition-colors">
              <ChevronLeft size={16} />
            </button>
            <span className="text-xs font-semibold text-text">{MONTH_NAMES[calMonth]} {calYear}</span>
            <button onClick={nextMonth} className="p-1 rounded text-text3 hover:text-text hover:bg-bg3 transition-colors">
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].map((d) => (
              <div key={d} className="text-center text-[9px] text-text3 font-medium py-0.5">{d}</div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-0.5">
            {calDays.map((day, i) => {
              if (day === null) return <div key={`e-${i}`} />
              const dayEvents = eventsByDay[day] ?? []
              const isToday =
                day === new Date().getDate() &&
                calMonth === new Date().getMonth() &&
                calYear === new Date().getFullYear()
              return (
                <div
                  key={day}
                  className={`min-h-[32px] rounded-md px-0.5 py-0.5 text-center ${
                    isToday ? 'bg-gold/10 border border-gold/30' : 'bg-bg2 border border-border/50'
                  }`}
                >
                  <span className={`text-[10px] ${isToday ? 'text-gold font-bold' : 'text-text2'}`}>
                    {day}
                  </span>
                  {dayEvents.length > 0 && (
                    <div className="flex justify-center mt-0.5">
                      {dayEvents.slice(0, 2).map((ev, j) => (
                        <div
                          key={j}
                          className="w-1.5 h-1.5 rounded-full mx-0.5"
                          style={{ backgroundColor: ev.colore ?? '#eab308' }}
                          title={ev.titolo}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Events list */}
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-semibold text-text3 uppercase tracking-wider">Eventi del mese</span>
              <Button size="sm" variant="primary" onClick={openCreateEvent}>
                <Plus size={13} />
              </Button>
            </div>
            <div className="space-y-0.5">
              {events.length === 0 && <p className="text-xs text-text3 text-center py-3">Nessun evento</p>}
              {events.map((ev) => (
                <div
                  key={ev.id}
                  onClick={() => openEditEvent(ev)}
                  className="flex items-center justify-between bg-bg2 border border-border rounded-lg px-2.5 py-1.5 group cursor-pointer hover:border-gold/20 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: ev.colore ?? '#eab308' }} />
                    <div className="min-w-0">
                      <p className="text-xs text-text truncate">{ev.titolo}</p>
                      <p className="text-[10px] text-text3">
                        {new Date(ev.data_inizio).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })}
                        {ev.data_fine && ` - ${new Date(ev.data_fine).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })}`}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteEvent(ev.id) }}
                    className="p-0.5 rounded text-text3 hover:text-red opacity-0 group-hover:opacity-100 transition-all shrink-0"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Card Modal */}
      <Modal open={cardFormOpen} onClose={() => setCardFormOpen(false)} title={editCard ? 'Modifica Card' : 'Nuova Card'}>
        <form onSubmit={handleSaveCard} className="space-y-3">
          <Input label="Titolo" required value={cardForm.titolo} onChange={(e) => setCardForm((f) => ({ ...f, titolo: e.target.value }))} />
          <Textarea label="Contenuto" value={cardForm.contenuto} onChange={(e) => setCardForm((f) => ({ ...f, contenuto: e.target.value }))} />
          {!editCard && columns.length > 0 && (
            <Select
              label="Colonna"
              options={columns.map((c) => ({ value: c.id, label: c.nome }))}
              value={cardForm.colId}
              onChange={(e) => setCardForm((f) => ({ ...f, colId: e.target.value }))}
            />
          )}
          <Select
            label="Priorita"
            options={PRIORITY_OPTIONS}
            value={cardForm.priorita}
            onChange={(e) => setCardForm((f) => ({ ...f, priorita: e.target.value as CardPriorita }))}
          />
          <Input label="Scadenza" type="date" value={cardForm.scadenza} onChange={(e) => setCardForm((f) => ({ ...f, scadenza: e.target.value }))} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" onClick={() => setCardFormOpen(false)}>Annulla</Button>
            <Button type="submit" variant="primary">Salva</Button>
          </div>
        </form>
      </Modal>

      {/* Event Modal */}
      <Modal open={eventFormOpen} onClose={() => setEventFormOpen(false)} title={editEvent ? 'Modifica Evento' : 'Nuovo Evento'}>
        <form onSubmit={handleSaveEvent} className="space-y-3">
          <Input label="Titolo" required value={eventForm.titolo} onChange={(e) => setEventForm((f) => ({ ...f, titolo: e.target.value }))} />
          <Textarea label="Descrizione" value={eventForm.descrizione} onChange={(e) => setEventForm((f) => ({ ...f, descrizione: e.target.value }))} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Data Inizio" type="date" required value={eventForm.data_inizio} onChange={(e) => setEventForm((f) => ({ ...f, data_inizio: e.target.value }))} />
            <Input label="Data Fine" type="date" value={eventForm.data_fine} onChange={(e) => setEventForm((f) => ({ ...f, data_fine: e.target.value }))} />
          </div>
          <Select label="Tipo" options={TIPO_EVENTO_OPTIONS} value={eventForm.tipo} onChange={(e) => setEventForm((f) => ({ ...f, tipo: e.target.value as EventoTipo }))} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" onClick={() => setEventFormOpen(false)}>Annulla</Button>
            <Button type="submit" variant="primary">Salva</Button>
          </div>
        </form>
      </Modal>
    </AgentPanel>
  )
}
