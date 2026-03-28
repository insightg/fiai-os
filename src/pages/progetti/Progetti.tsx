import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus,
  LayoutGrid,
  Columns3,
  Search,
  Calendar,
  Briefcase,
  Euro,
  FolderKanban,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useProgettiStore, useClientiStore, useAuthStore } from '../../store'
import type { Progetto, ProgettoStato } from '../../types'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import Modal from '../../components/ui/Modal'
import StatCard from '../../components/ui/StatCard'
import { Input, Select } from '../../components/ui/Form'
import ProgettoForm from './ProgettoForm'

type ViewMode = 'grid' | 'kanban'

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

const KANBAN_COLUMNS: ProgettoStato[] = [
  'pianificato',
  'in_corso',
  'in_pausa',
  'completato',
  'annullato',
]

const KANBAN_COLUMN_BORDER: Record<ProgettoStato, string> = {
  pianificato: 'border-t-blue',
  in_corso: 'border-t-gold',
  in_pausa: 'border-t-amber',
  completato: 'border-t-green',
  annullato: 'border-t-red',
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('it-IT', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function formatCurrency(amount: number | null): string {
  if (amount == null) return '—'
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(amount)
}

function ProgressBar({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, value))
  return (
    <div className="w-full h-2 bg-bg3 rounded-full overflow-hidden">
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

function getAvanzamento(_progetto: Progetto): number {
  switch (_progetto.stato) {
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

function ProjectCard({
  progetto,
  onClick,
}: {
  progetto: Progetto
  onClick: () => void
}) {
  const avanzamento = getAvanzamento(progetto)
  const clienteName =
    progetto.cliente?.ragione_sociale ||
    `${progetto.cliente?.nome ?? ''}${progetto.cliente?.cognome ? ' ' + progetto.cliente.cognome : ''}`

  return (
    <div
      onClick={onClick}
      className="bg-bg2 border border-border rounded-xl overflow-hidden cursor-pointer hover:border-border2 transition-all group"
    >
      <div className="h-1" style={{ background: 'linear-gradient(90deg, #C9A84C, #E8C878)' }} />
      <div className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-text font-semibold truncate group-hover:text-gold transition-colors">
              {progetto.nome}
            </h3>
            <p className="text-text3 text-sm mt-0.5 truncate">{clienteName}</p>
          </div>
          <Badge color={STATO_COLORS[progetto.stato]}>{STATO_LABELS[progetto.stato]}</Badge>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-text3">Avanzamento</span>
            <span className="text-text2 font-medium">{avanzamento}%</span>
          </div>
          <ProgressBar value={avanzamento} />
        </div>

        <div className="flex items-center justify-between text-xs text-text3">
          <div className="flex items-center gap-1.5">
            <Euro size={12} />
            <span>{formatCurrency(progetto.budget)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Calendar size={12} />
            <span>
              {formatDate(progetto.data_inizio)} — {formatDate(progetto.data_fine_prevista)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function KanbanCard({
  progetto,
  onClick,
}: {
  progetto: Progetto
  onClick: () => void
}) {
  const avanzamento = getAvanzamento(progetto)
  const clienteName =
    progetto.cliente?.ragione_sociale ||
    `${progetto.cliente?.nome ?? ''}${progetto.cliente?.cognome ? ' ' + progetto.cliente.cognome : ''}`

  return (
    <div
      onClick={onClick}
      className="bg-bg3 border border-border rounded-lg p-3 cursor-pointer hover:border-border2 transition-all group space-y-2"
    >
      <h4 className="text-text text-sm font-medium truncate group-hover:text-gold transition-colors">
        {progetto.nome}
      </h4>
      <p className="text-text3 text-xs truncate">{clienteName}</p>
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-text3">Avanzamento</span>
          <span className="text-text2 font-medium">{avanzamento}%</span>
        </div>
        <ProgressBar value={avanzamento} />
      </div>
      <div className="flex items-center justify-between text-xs text-text3 pt-1">
        <span>{formatCurrency(progetto.budget)}</span>
        <span>{formatDate(progetto.data_fine_prevista)}</span>
      </div>
    </div>
  )
}

export default function Progetti() {
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)
  const { progetti, loading, fetch: fetchProgetti, create: createProgetto } = useProgettiStore()
  const { clienti, fetch: fetchClienti } = useClientiStore()

  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStato, setFilterStato] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)

  const aziendaId = profile?.azienda_id ?? ''

  useEffect(() => {
    if (aziendaId) {
      fetchProgetti(aziendaId)
      fetchClienti(aziendaId)
    }
  }, [aziendaId, fetchProgetti, fetchClienti])

  const filteredProgetti = useMemo(() => {
    let result = [...progetti]

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (p) =>
          p.nome.toLowerCase().includes(q) ||
          p.cliente?.nome?.toLowerCase().includes(q) ||
          p.cliente?.ragione_sociale?.toLowerCase().includes(q)
      )
    }

    if (filterStato) {
      result = result.filter((p) => p.stato === filterStato)
    }

    return result
  }, [progetti, searchQuery, filterStato])

  const stats = useMemo(() => {
    const total = progetti.length
    const inCorso = progetti.filter((p) => p.stato === 'in_corso').length
    const completati = progetti.filter((p) => p.stato === 'completato').length
    const budgetTotale = progetti.reduce((sum, p) => sum + (p.budget ?? 0), 0)
    return { total, inCorso, completati, budgetTotale }
  }, [progetti])

  const kanbanGroups = useMemo(() => {
    const groups: Record<ProgettoStato, Progetto[]> = {
      pianificato: [],
      in_corso: [],
      in_pausa: [],
      completato: [],
      annullato: [],
    }
    filteredProgetti.forEach((p) => {
      groups[p.stato].push(p)
    })
    return groups
  }, [filteredProgetti])

  const handleCreateProgetto = async (
    data: Omit<Progetto, 'id' | 'created_at' | 'updated_at' | 'cliente'>
  ) => {
    const result = await createProgetto(data)
    if (result) {
      toast.success('Progetto creato con successo')
      setShowCreateModal(false)
    } else {
      toast.error('Errore nella creazione del progetto')
    }
  }

  const statoFilterOptions = [
    { value: '', label: 'Tutti gli stati' },
    ...Object.entries(STATO_LABELS).map(([value, label]) => ({ value, label })),
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-text">Progetti</h1>
          <p className="text-text3 text-sm mt-1">Gestisci i progetti della tua azienda</p>
        </div>
        <Button variant="primary" onClick={() => setShowCreateModal(true)}>
          <Plus size={16} />
          Nuovo Progetto
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard icon={FolderKanban} label="Totale Progetti" value={String(stats.total)} />
        <StatCard icon={Briefcase} label="In Corso" value={String(stats.inCorso)} />
        <StatCard
          icon={FolderKanban}
          label="Completati"
          value={String(stats.completati)}
        />
        <StatCard
          icon={Euro}
          label="Budget Totale"
          value={formatCurrency(stats.budgetTotale)}
        />
      </div>

      {/* Filters & View Toggle */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text3" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cerca progetto..."
            className="pl-9"
          />
        </div>
        <div className="w-48">
          <Select
            options={statoFilterOptions}
            value={filterStato}
            onChange={(e) => setFilterStato(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1 bg-bg2 border border-border rounded-lg p-1">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-2 rounded-md transition-colors ${
              viewMode === 'grid'
                ? 'bg-bg3 text-gold'
                : 'text-text3 hover:text-text'
            }`}
          >
            <LayoutGrid size={16} />
          </button>
          <button
            onClick={() => setViewMode('kanban')}
            className={`p-2 rounded-md transition-colors ${
              viewMode === 'kanban'
                ? 'bg-bg3 text-gold'
                : 'text-text3 hover:text-text'
            }`}
          >
            <Columns3 size={16} />
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && progetti.length === 0 && (
        <div className="flex items-center justify-center py-20">
          <div className="text-gold font-display text-lg animate-pulse">Caricamento...</div>
        </div>
      )}

      {/* Grid View */}
      {viewMode === 'grid' && !loading && (
        <>
          {filteredProgetti.length === 0 ? (
            <div className="bg-bg2 border border-border rounded-xl p-12 text-center">
              <FolderKanban size={48} className="mx-auto text-text3 mb-4" />
              <p className="text-text2 text-lg font-medium">Nessun progetto trovato</p>
              <p className="text-text3 text-sm mt-1">
                {searchQuery || filterStato
                  ? 'Prova a modificare i filtri di ricerca'
                  : 'Crea il tuo primo progetto per iniziare'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredProgetti.map((progetto) => (
                <ProjectCard
                  key={progetto.id}
                  progetto={progetto}
                  onClick={() => navigate(`/progetti/${progetto.id}`)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Kanban View */}
      {viewMode === 'kanban' && !loading && (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {KANBAN_COLUMNS.map((stato) => (
            <div
              key={stato}
              className={`flex-shrink-0 w-72 bg-bg2 border border-border rounded-xl overflow-hidden border-t-2 ${KANBAN_COLUMN_BORDER[stato]}`}
            >
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="text-text text-sm font-semibold">{STATO_LABELS[stato]}</h3>
                  <span className="text-xs text-text3 bg-bg3 px-2 py-0.5 rounded-full">
                    {kanbanGroups[stato].length}
                  </span>
                </div>
              </div>
              <div className="p-3 space-y-3 max-h-[calc(100vh-380px)] overflow-y-auto">
                {kanbanGroups[stato].length === 0 ? (
                  <p className="text-text3 text-xs text-center py-4">Nessun progetto</p>
                ) : (
                  kanbanGroups[stato].map((progetto) => (
                    <KanbanCard
                      key={progetto.id}
                      progetto={progetto}
                      onClick={() => navigate(`/progetti/${progetto.id}`)}
                    />
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      <Modal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Nuovo Progetto"
        className="max-w-xl"
      >
        <ProgettoForm
          clienti={clienti}
          loading={loading}
          onSubmit={handleCreateProgetto}
          onCancel={() => setShowCreateModal(false)}
          aziendaId={aziendaId}
        />
      </Modal>
    </div>
  )
}
