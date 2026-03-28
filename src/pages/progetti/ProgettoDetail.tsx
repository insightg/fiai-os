import { useState, useEffect, type FormEvent } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft,
  Edit2,
  Calendar,
  Euro,
  FileText,
  Users,
  Activity,
  ClipboardList,
  ExternalLink,
  Trash2,
  CheckCircle,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useProgettiStore, useClientiStore, useAuthStore } from '../../store'
import type { Progetto, ProgettoStato } from '../../types'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import Modal from '../../components/ui/Modal'
import { Input, Textarea } from '../../components/ui/Form'
import ProgettoForm from './ProgettoForm'

const STATO_LABELS: Record<ProgettoStato, string> = {
  pianificato: 'Pianificazione',
  in_corso: 'In Corso',
  in_pausa: 'In Pausa',
  completato: 'Completato',
  annullato: 'Annullato',
}

const STATO_COLORS: Record<ProgettoStato, 'blue' | 'gold' | 'amber' | 'green' | 'red'> = {
  pianificato: 'blue',
  in_corso: 'gold',
  in_pausa: 'amber',
  completato: 'green',
  annullato: 'red',
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('it-IT', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

function formatCurrency(amount: number | null): string {
  if (amount == null) return '—'
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(amount)
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('it-IT', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function ProgressBar({ value, size = 'md' }: { value: number; size?: 'sm' | 'md' | 'lg' }) {
  const clamped = Math.max(0, Math.min(100, value))
  const heights = { sm: 'h-1.5', md: 'h-3', lg: 'h-4' }
  return (
    <div className={`w-full ${heights[size]} bg-bg3 rounded-full overflow-hidden`}>
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{
          width: `${clamped}%`,
          background: 'linear-gradient(90deg, #C9A84C, #E8C878)',
        }}
      />
    </div>
  )
}

function getAvanzamento(progetto: Progetto): number {
  switch (progetto.stato) {
    case 'pianificato':
      return 0
    case 'in_corso':
      return 50
    case 'in_pausa':
      return 30
    case 'completato':
      return 100
    case 'annullato':
      return 0
    default:
      return 0
  }
}

interface SALEntry {
  id: string
  data: string
  percentuale: number
  nota: string
}

function generateSALHistory(progetto: Progetto): SALEntry[] {
  const entries: SALEntry[] = []
  const avanzamento = getAvanzamento(progetto)

  if (progetto.data_inizio) {
    entries.push({
      id: 'sal-1',
      data: progetto.data_inizio,
      percentuale: 0,
      nota: 'Inizio progetto',
    })
  }

  if (progetto.stato === 'in_corso') {
    entries.push({
      id: 'sal-2',
      data: progetto.updated_at,
      percentuale: avanzamento,
      nota: 'Avanzamento lavori in corso',
    })
  }

  if (progetto.stato === 'completato') {
    entries.push({
      id: 'sal-2',
      data: progetto.updated_at,
      percentuale: 50,
      nota: 'Avanzamento intermedio',
    })
    entries.push({
      id: 'sal-3',
      data: progetto.data_fine_effettiva ?? progetto.updated_at,
      percentuale: 100,
      nota: 'Progetto completato',
    })
  }

  if (progetto.stato === 'in_pausa') {
    entries.push({
      id: 'sal-2',
      data: progetto.updated_at,
      percentuale: avanzamento,
      nota: 'Progetto in pausa',
    })
  }

  return entries.sort((a, b) => new Date(a.data).getTime() - new Date(b.data).getTime())
}

interface TimelineEvent {
  id: string
  data: string
  titolo: string
  descrizione: string
  tipo: 'creazione' | 'aggiornamento' | 'completamento' | 'pausa'
}

function generateTimeline(progetto: Progetto): TimelineEvent[] {
  const events: TimelineEvent[] = []

  events.push({
    id: 'tl-1',
    data: progetto.created_at,
    titolo: 'Progetto creato',
    descrizione: `Il progetto "${progetto.nome}" è stato creato`,
    tipo: 'creazione',
  })

  if (progetto.data_inizio && progetto.data_inizio !== progetto.created_at.substring(0, 10)) {
    events.push({
      id: 'tl-2',
      data: progetto.data_inizio,
      titolo: 'Inizio lavori',
      descrizione: 'Il progetto è entrato nella fase operativa',
      tipo: 'aggiornamento',
    })
  }

  if (progetto.stato === 'in_pausa') {
    events.push({
      id: 'tl-3',
      data: progetto.updated_at,
      titolo: 'Progetto in pausa',
      descrizione: 'Il progetto è stato messo in pausa',
      tipo: 'pausa',
    })
  }

  if (progetto.stato === 'completato') {
    events.push({
      id: 'tl-4',
      data: progetto.data_fine_effettiva ?? progetto.updated_at,
      titolo: 'Progetto completato',
      descrizione: 'Il progetto è stato completato con successo',
      tipo: 'completamento',
    })
  }

  return events.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime())
}

const TIMELINE_TIPO_COLORS: Record<TimelineEvent['tipo'], string> = {
  creazione: 'bg-blue',
  aggiornamento: 'bg-gold',
  completamento: 'bg-green',
  pausa: 'bg-amber',
}

export default function ProgettoDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)
  const {
    loading,
    fetchOne,
    update: updateProgetto,
    remove: removeProgetto,
  } = useProgettiStore()
  const { clienti, fetch: fetchClienti } = useClientiStore()

  const [progetto, setProgetto] = useState<Progetto | null>(null)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showSALForm, setShowSALForm] = useState(false)
  const [salPercentuale, setSalPercentuale] = useState('')
  const [salNota, setSalNota] = useState('')
  const [updatingSAL, setUpdatingSAL] = useState(false)

  const aziendaId = profile?.azienda_id ?? ''

  useEffect(() => {
    if (id) {
      fetchOne(id).then((data) => {
        if (data) {
          setProgetto(data)
        } else {
          toast.error('Progetto non trovato')
          navigate('/progetti')
        }
      })
    }
    if (aziendaId) {
      fetchClienti(aziendaId)
    }
  }, [id, aziendaId, fetchOne, fetchClienti, navigate])

  if (!progetto) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-gold font-display text-lg animate-pulse">Caricamento...</div>
      </div>
    )
  }

  const avanzamento = getAvanzamento(progetto)
  const salHistory = generateSALHistory(progetto)
  const timeline = generateTimeline(progetto)

  const clienteName =
    progetto.cliente?.ragione_sociale ||
    `${progetto.cliente?.nome ?? ''}${progetto.cliente?.cognome ? ' ' + progetto.cliente.cognome : ''}`

  const handleUpdateProgetto = async (
    data: Omit<Progetto, 'id' | 'created_at' | 'updated_at' | 'cliente'>
  ) => {
    await updateProgetto(progetto.id, data)
    const updated = await fetchOne(progetto.id)
    if (updated) {
      setProgetto(updated)
      toast.success('Progetto aggiornato con successo')
      setShowEditModal(false)
    } else {
      toast.error("Errore nell'aggiornamento del progetto")
    }
  }

  const handleDelete = async () => {
    await removeProgetto(progetto.id)
    toast.success('Progetto eliminato')
    navigate('/progetti')
  }

  const handleSALUpdate = async (e: FormEvent) => {
    e.preventDefault()
    const perc = Number(salPercentuale)
    if (isNaN(perc) || perc < 0 || perc > 100) {
      toast.error('Inserisci una percentuale valida tra 0 e 100')
      return
    }
    setUpdatingSAL(true)

    let newStato: ProgettoStato = progetto.stato
    if (perc === 100) {
      newStato = 'completato'
    } else if (perc > 0 && progetto.stato === 'pianificato') {
      newStato = 'in_corso'
    }

    const updates: Partial<Progetto> = {
      stato: newStato,
      note: salNota
        ? `${progetto.note ? progetto.note + '\n' : ''}[SAL ${perc}%] ${salNota}`
        : progetto.note,
    }

    if (perc === 100) {
      updates.data_fine_effettiva = new Date().toISOString().substring(0, 10)
    }

    await updateProgetto(progetto.id, updates)
    const updated = await fetchOne(progetto.id)
    if (updated) {
      setProgetto(updated)
      toast.success(`Avanzamento aggiornato a ${perc}%`)
    }

    setShowSALForm(false)
    setSalPercentuale('')
    setSalNota('')
    setUpdatingSAL(false)
  }

  return (
    <div className="space-y-6">
      {/* Back + Actions */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate('/progetti')}
          className="flex items-center gap-2 text-text3 hover:text-text transition-colors"
        >
          <ArrowLeft size={18} />
          <span className="text-sm">Torna ai progetti</span>
        </button>
        <div className="flex items-center gap-2">
          <Button onClick={() => setShowEditModal(true)}>
            <Edit2 size={14} />
            Modifica
          </Button>
          <Button variant="danger" onClick={() => setShowDeleteConfirm(true)}>
            <Trash2 size={14} />
            Elimina
          </Button>
        </div>
      </div>

      {/* Header Card */}
      <div className="bg-bg2 border border-border rounded-xl overflow-hidden">
        <div className="h-1.5" style={{ background: 'linear-gradient(90deg, #C9A84C, #E8C878)' }} />
        <div className="p-6 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-display font-bold text-text">{progetto.nome}</h1>
              <p className="text-text3 mt-1">{clienteName}</p>
            </div>
            <Badge color={STATO_COLORS[progetto.stato]}>
              {STATO_LABELS[progetto.stato]}
            </Badge>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-text3 text-sm">Avanzamento</span>
              <span className="text-text font-semibold text-lg">{avanzamento}%</span>
            </div>
            <ProgressBar value={avanzamento} size="lg" />
          </div>
        </div>
      </div>

      {/* Content Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left Column - Main Info */}
        <div className="xl:col-span-2 space-y-6">
          {/* Info Section */}
          <div className="bg-bg2 border border-border rounded-xl p-6 space-y-4">
            <h2 className="text-lg font-semibold text-text flex items-center gap-2">
              <FileText size={18} className="text-gold" />
              Informazioni
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-text3 text-xs uppercase tracking-wider mb-1">Budget</p>
                <p className="text-text font-medium">{formatCurrency(progetto.budget)}</p>
              </div>
              <div>
                <p className="text-text3 text-xs uppercase tracking-wider mb-1">Cliente</p>
                <p className="text-text font-medium">{clienteName}</p>
              </div>
              <div>
                <p className="text-text3 text-xs uppercase tracking-wider mb-1">Data Inizio</p>
                <p className="text-text font-medium">{formatDate(progetto.data_inizio)}</p>
              </div>
              <div>
                <p className="text-text3 text-xs uppercase tracking-wider mb-1">Scadenza</p>
                <p className="text-text font-medium">{formatDate(progetto.data_fine_prevista)}</p>
              </div>
              {progetto.data_fine_effettiva && (
                <div>
                  <p className="text-text3 text-xs uppercase tracking-wider mb-1">
                    Data Fine Effettiva
                  </p>
                  <p className="text-text font-medium">
                    {formatDate(progetto.data_fine_effettiva)}
                  </p>
                </div>
              )}
              <div>
                <p className="text-text3 text-xs uppercase tracking-wider mb-1">Creato il</p>
                <p className="text-text font-medium">{formatDateTime(progetto.created_at)}</p>
              </div>
            </div>
            {progetto.descrizione && (
              <div>
                <p className="text-text3 text-xs uppercase tracking-wider mb-1">Descrizione</p>
                <p className="text-text2 text-sm whitespace-pre-wrap">{progetto.descrizione}</p>
              </div>
            )}
            {progetto.note && (
              <div>
                <p className="text-text3 text-xs uppercase tracking-wider mb-1">Note</p>
                <p className="text-text2 text-sm whitespace-pre-wrap">{progetto.note}</p>
              </div>
            )}
          </div>

          {/* Timeline / Activity */}
          <div className="bg-bg2 border border-border rounded-xl p-6 space-y-4">
            <h2 className="text-lg font-semibold text-text flex items-center gap-2">
              <Activity size={18} className="text-gold" />
              Timeline Attività
            </h2>
            {timeline.length === 0 ? (
              <p className="text-text3 text-sm">Nessuna attività registrata</p>
            ) : (
              <div className="relative">
                <div className="absolute left-3 top-2 bottom-2 w-px bg-border" />
                <div className="space-y-6">
                  {timeline.map((event) => (
                    <div key={event.id} className="flex gap-4 relative">
                      <div
                        className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center ${TIMELINE_TIPO_COLORS[event.tipo]} z-10`}
                      >
                        <div className="w-2 h-2 bg-bg rounded-full" />
                      </div>
                      <div className="min-w-0 flex-1 pb-1">
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="text-text text-sm font-medium">{event.titolo}</h4>
                          <span className="text-text3 text-xs flex-shrink-0">
                            {formatDateTime(event.data)}
                          </span>
                        </div>
                        <p className="text-text3 text-xs mt-0.5">{event.descrizione}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* SAL Section */}
          <div className="bg-bg2 border border-border rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-text flex items-center gap-2">
                <ClipboardList size={18} className="text-gold" />
                SAL — Stato Avanzamento Lavori
              </h2>
              <Button size="sm" onClick={() => setShowSALForm(true)}>
                <CheckCircle size={14} />
                Aggiorna Avanzamento
              </Button>
            </div>

            {salHistory.length === 0 ? (
              <p className="text-text3 text-sm">Nessun avanzamento registrato</p>
            ) : (
              <div className="space-y-3">
                {salHistory.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center gap-4 bg-bg3 rounded-lg p-3"
                  >
                    <div className="flex-shrink-0 w-14 text-center">
                      <span className="text-gold font-bold text-lg">{entry.percentuale}%</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3">
                        <ProgressBar value={entry.percentuale} />
                      </div>
                      <p className="text-text2 text-sm mt-1">{entry.nota}</p>
                    </div>
                    <span className="text-text3 text-xs flex-shrink-0">
                      {formatDate(entry.data)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column - Sidebar */}
        <div className="space-y-6">
          {/* Team Section */}
          <div className="bg-bg2 border border-border rounded-xl p-6 space-y-4">
            <h2 className="text-lg font-semibold text-text flex items-center gap-2">
              <Users size={18} className="text-gold" />
              Team
            </h2>
            <div className="space-y-3">
              <div className="flex items-center gap-3 bg-bg3 rounded-lg p-3">
                <div className="w-9 h-9 rounded-full bg-gold/20 flex items-center justify-center text-gold font-semibold text-sm">
                  {profile?.nome?.charAt(0) ?? 'U'}
                  {profile?.cognome?.charAt(0) ?? ''}
                </div>
                <div className="min-w-0">
                  <p className="text-text text-sm font-medium truncate">
                    {profile?.nome ?? ''} {profile?.cognome ?? ''}
                  </p>
                  <p className="text-text3 text-xs">Project Manager</p>
                </div>
              </div>
            </div>
          </div>

          {/* Documents Section */}
          <div className="bg-bg2 border border-border rounded-xl p-6 space-y-4">
            <h2 className="text-lg font-semibold text-text flex items-center gap-2">
              <FileText size={18} className="text-gold" />
              Documenti
            </h2>
            <div className="bg-bg3 rounded-lg p-4 text-center">
              <FileText size={32} className="mx-auto text-text3 mb-2" />
              <p className="text-text3 text-sm">Nessun documento allegato</p>
              <p className="text-text3 text-xs mt-1">
                I documenti saranno disponibili in un aggiornamento futuro
              </p>
            </div>
          </div>

          {/* Related Section */}
          <div className="bg-bg2 border border-border rounded-xl p-6 space-y-4">
            <h2 className="text-lg font-semibold text-text flex items-center gap-2">
              <ExternalLink size={18} className="text-gold" />
              Collegati
            </h2>
            <div className="space-y-3">
              {progetto.ordine_id ? (
                <Link
                  to={`/ordini`}
                  className="flex items-center gap-3 bg-bg3 rounded-lg p-3 hover:bg-bg4 transition-colors group"
                >
                  <div className="w-8 h-8 rounded-lg bg-blue/10 flex items-center justify-center">
                    <ClipboardList size={16} className="text-blue" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-text text-sm font-medium group-hover:text-gold transition-colors">
                      Ordine collegato
                    </p>
                    <p className="text-text3 text-xs truncate">ID: {progetto.ordine_id.substring(0, 8)}...</p>
                  </div>
                  <ExternalLink size={14} className="text-text3" />
                </Link>
              ) : (
                <div className="bg-bg3 rounded-lg p-3">
                  <p className="text-text3 text-sm">Nessun ordine collegato</p>
                </div>
              )}
              <Link
                to="/fatture"
                className="flex items-center gap-3 bg-bg3 rounded-lg p-3 hover:bg-bg4 transition-colors group"
              >
                <div className="w-8 h-8 rounded-lg bg-green/10 flex items-center justify-center">
                  <Euro size={16} className="text-green" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-text text-sm font-medium group-hover:text-gold transition-colors">
                    Fatture
                  </p>
                  <p className="text-text3 text-xs">Visualizza fatture correlate</p>
                </div>
                <ExternalLink size={14} className="text-text3" />
              </Link>
            </div>
          </div>

          {/* Quick Info */}
          <div className="bg-bg2 border border-border rounded-xl p-6 space-y-3">
            <h2 className="text-lg font-semibold text-text flex items-center gap-2">
              <Calendar size={18} className="text-gold" />
              Date
            </h2>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-text3">Creato</span>
                <span className="text-text2">{formatDateTime(progetto.created_at)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-text3">Aggiornato</span>
                <span className="text-text2">{formatDateTime(progetto.updated_at)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      <Modal
        open={showEditModal}
        onClose={() => setShowEditModal(false)}
        title="Modifica Progetto"
        className="max-w-xl"
      >
        <ProgettoForm
          progetto={progetto}
          clienti={clienti}
          loading={loading}
          onSubmit={handleUpdateProgetto}
          onCancel={() => setShowEditModal(false)}
          aziendaId={aziendaId}
        />
      </Modal>

      {/* SAL Update Modal */}
      <Modal
        open={showSALForm}
        onClose={() => {
          setShowSALForm(false)
          setSalPercentuale('')
          setSalNota('')
        }}
        title="Aggiorna Avanzamento"
      >
        <form onSubmit={handleSALUpdate} className="space-y-4">
          <Input
            label="Nuova Percentuale (%)"
            type="number"
            min="0"
            max="100"
            step="1"
            value={salPercentuale}
            onChange={(e) => setSalPercentuale(e.target.value)}
            placeholder="Es. 75"
          />
          <div className="space-y-1.5">
            <ProgressBar value={Number(salPercentuale) || 0} size="md" />
            <p className="text-text3 text-xs text-right">{Number(salPercentuale) || 0}%</p>
          </div>
          <Textarea
            label="Nota"
            value={salNota}
            onChange={(e) => setSalNota(e.target.value)}
            placeholder="Descrivi lo stato di avanzamento..."
          />
          {Number(salPercentuale) === 100 && (
            <div className="bg-green/10 border border-green/20 rounded-lg p-3">
              <p className="text-green text-sm font-medium">
                Impostando al 100% il progetto verrà segnato come completato
              </p>
            </div>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <Button
              type="button"
              onClick={() => {
                setShowSALForm(false)
                setSalPercentuale('')
                setSalNota('')
              }}
              disabled={updatingSAL}
            >
              Annulla
            </Button>
            <Button type="submit" variant="primary" disabled={updatingSAL}>
              {updatingSAL ? 'Aggiornamento...' : 'Aggiorna SAL'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title="Conferma Eliminazione"
      >
        <div className="space-y-4">
          <p className="text-text2">
            Sei sicuro di voler eliminare il progetto{' '}
            <span className="text-text font-semibold">"{progetto.nome}"</span>? Questa azione non
            può essere annullata.
          </p>
          <div className="flex justify-end gap-3">
            <Button onClick={() => setShowDeleteConfirm(false)}>Annulla</Button>
            <Button variant="danger" onClick={handleDelete} disabled={loading}>
              {loading ? 'Eliminazione...' : 'Elimina Progetto'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
