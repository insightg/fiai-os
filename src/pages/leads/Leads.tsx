import { useEffect, useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLeadsStore, useAuthStore, useClientiStore, usePreventiviStore } from '../../store'
import type { Lead, LeadStato } from '../../types'
import Table, { type Column } from '../../components/ui/Table'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import Modal from '../../components/ui/Modal'
import { Input, Select } from '../../components/ui/Form'
import LeadForm from './LeadForm'
import LeadKanban from './LeadKanban'
import { LayoutGrid, List, Plus, Search, Users } from 'lucide-react'
import StatCard from '../../components/ui/StatCard'
import toast from 'react-hot-toast'

type ViewMode = 'table' | 'kanban'

const STATO_COLORS: Record<LeadStato, 'blue' | 'amber' | 'purple' | 'gold' | 'green' | 'red'> = {
  nuovo: 'blue',
  contattato: 'amber',
  qualificato: 'purple',
  proposta: 'gold',
  convertito: 'green',
  perso: 'red',
}

const STATO_LABELS: Record<LeadStato, string> = {
  nuovo: 'Nuovo',
  contattato: 'Contattato',
  qualificato: 'Qualificato',
  proposta: 'Proposta',
  convertito: 'Convertito',
  perso: 'Perso',
}

const FILTER_OPTIONS = [
  { value: '', label: 'Tutti gli stati' },
  { value: 'nuovo', label: 'Nuovo' },
  { value: 'contattato', label: 'Contattato' },
  { value: 'qualificato', label: 'Qualificato' },
  { value: 'proposta', label: 'Proposta' },
  { value: 'convertito', label: 'Convertito' },
  { value: 'perso', label: 'Perso' },
]

function formatEuro(value: number | null): string {
  if (value == null) return '-'
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(value)
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export default function Leads() {
  const profile = useAuthStore((s) => s.profile)
  const { leads, loading, fetch: fetchLeads } = useLeadsStore()
  const createCliente = useClientiStore((s) => s.create)
  const fetchClienti = useClientiStore((s) => s.fetch)
  const clienti = useClientiStore((s) => s.clienti)
  const createPreventivo = usePreventiviStore((s) => s.create)
  const navigate = useNavigate()

  const [viewMode, setViewMode] = useState<ViewMode>('table')
  const [search, setSearch] = useState('')
  const [filterStato, setFilterStato] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingLead, setEditingLead] = useState<Lead | null>(null)

  useEffect(() => {
    if (profile?.azienda_id) {
      fetchLeads(profile.azienda_id)
      fetchClienti(profile.azienda_id)
    }
  }, [profile?.azienda_id, fetchLeads, fetchClienti])

  const filtered = useMemo(() => {
    let result = leads
    if (filterStato) {
      result = result.filter((l) => l.stato === filterStato)
    }
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(
        (l) =>
          l.nome.toLowerCase().includes(q) ||
          l.cognome.toLowerCase().includes(q) ||
          (l.azienda_lead?.toLowerCase().includes(q) ?? false) ||
          (l.email?.toLowerCase().includes(q) ?? false)
      )
    }
    return result
  }, [leads, filterStato, search])

  const stats = useMemo(() => {
    const total = leads.length
    const totalValue = leads.reduce((sum, l) => sum + (l.valore_stimato ?? 0), 0)
    const nuovi = leads.filter((l) => l.stato === 'nuovo').length
    const convertiti = leads.filter((l) => l.stato === 'convertito').length
    return { total, totalValue, nuovi, convertiti }
  }, [leads])

  function handleEdit(lead: Lead) {
    setEditingLead(lead)
    setModalOpen(true)
  }

  function handleNewLead() {
    setEditingLead(null)
    setModalOpen(true)
  }

  function handleCloseModal() {
    setModalOpen(false)
    setEditingLead(null)
  }

  const handleConvertLead = useCallback(async (lead: Lead) => {
    if (!profile) return

    // Check if a client already exists for this lead
    let clienteId: string | null = null
    const existingClient = clienti.find(
      (c) =>
        c.nome.toLowerCase() === lead.nome.toLowerCase() &&
        c.cognome?.toLowerCase() === lead.cognome.toLowerCase()
    )

    if (existingClient) {
      clienteId = existingClient.id
    } else {
      // Create a new client from the lead
      const newCliente = await createCliente({
        azienda_id: profile.azienda_id,
        tipo: lead.azienda_lead ? 'azienda' : 'privato',
        nome: lead.nome,
        cognome: lead.cognome,
        ragione_sociale: lead.azienda_lead ?? null,
        piva: null,
        codice_fiscale: null,
        email: lead.email,
        telefono: lead.telefono,
        indirizzo: null,
        cap: null,
        citta: null,
        provincia: null,
        codice_sdi: null,
        pec: null,
        note: `Creato da lead: ${lead.nome} ${lead.cognome}`,
      })
      if (!newCliente) {
        toast.error('Errore nella creazione del cliente')
        return
      }
      clienteId = newCliente.id
    }

    // Create a preventivo from the lead
    const today = new Date().toISOString().split('T')[0]
    const numero = `PRE-${Date.now().toString(36).toUpperCase()}`
    const imponibile = lead.valore_stimato ?? 0
    const iva = Math.round(imponibile * 0.22 * 100) / 100
    const totale = Math.round((imponibile + iva) * 100) / 100

    const preventivo = await createPreventivo({
      azienda_id: profile.azienda_id,
      cliente_id: clienteId,
      numero,
      data: today,
      scadenza: null,
      stato: 'bozza',
      oggetto: `Preventivo per ${lead.nome} ${lead.cognome}`,
      note: lead.note,
      imponibile,
      iva,
      totale,
    })

    if (preventivo) {
      // Update lead stato to "convertito"
      await useLeadsStore.getState().update(lead.id, { stato: 'convertito' })
      toast.success('Lead convertito in preventivo')
      navigate('/app/preventivi')
    } else {
      toast.error('Errore nella conversione del lead')
    }
  }, [profile, clienti, createCliente, createPreventivo, navigate])

  const columns: Column<Lead>[] = [
    {
      key: 'nome',
      header: 'Nome',
      render: (row) => (
        <div>
          <p className="font-medium">{row.nome} {row.cognome}</p>
          {row.azienda_lead && <p className="text-xs text-text3">{row.azienda_lead}</p>}
        </div>
      ),
    },
    {
      key: 'contatto',
      header: 'Contatto',
      render: (row) => (
        <div className="text-sm">
          {row.telefono && <p>{row.telefono}</p>}
        </div>
      ),
    },
    {
      key: 'email',
      header: 'Email',
      render: (row) => <span className="text-sm text-text2">{row.email ?? '-'}</span>,
    },
    {
      key: 'valore',
      header: 'Valore',
      render: (row) => (
        <span className="font-semibold text-gold">{formatEuro(row.valore_stimato)}</span>
      ),
    },
    {
      key: 'fase',
      header: 'Fase',
      render: (row) => (
        <Badge color={STATO_COLORS[row.stato]}>{STATO_LABELS[row.stato]}</Badge>
      ),
    },
    {
      key: 'fonte',
      header: 'Fonte',
      render: (row) => <span className="text-sm text-text2">{row.fonte ?? '-'}</span>,
    },
    {
      key: 'data',
      header: 'Data',
      render: (row) => <span className="text-sm text-text2">{formatDate(row.created_at)}</span>,
    },
    {
      key: 'azioni',
      header: 'Azioni',
      render: (row) => (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => handleEdit(row)}>
            Modifica
          </Button>
          {row.stato !== 'convertito' && row.stato !== 'perso' && (
            <Button size="sm" variant="primary" onClick={() => handleConvertLead(row)}>
              Converti
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display text-text">Pipeline Leads</h1>
          <p className="text-sm text-text3 mt-1">Gestisci i tuoi contatti commerciali</p>
        </div>
        <Button variant="primary" onClick={handleNewLead}>
          <Plus size={16} />
          Nuovo Lead
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard icon={Users} label="Totale Leads" value={stats.total.toString()} />
        <StatCard
          icon={Users}
          label="Valore Pipeline"
          value={formatEuro(stats.totalValue)}
        />
        <StatCard icon={Users} label="Nuovi" value={stats.nuovi.toString()} />
        <StatCard icon={Users} label="Convertiti" value={stats.convertiti.toString()} />
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-1">
          <div className="relative flex-1 max-w-sm">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text3" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cerca per nome, email..."
              className="pl-9"
            />
          </div>
          <div className="w-48">
            <Select
              value={filterStato}
              onChange={(e) => setFilterStato(e.target.value)}
              options={FILTER_OPTIONS}
            />
          </div>
        </div>

        <div className="flex items-center gap-1 bg-bg2 border border-border rounded-lg p-1">
          <button
            onClick={() => setViewMode('table')}
            className={`p-2 rounded-md transition-colors ${
              viewMode === 'table' ? 'bg-bg3 text-gold' : 'text-text3 hover:text-text'
            }`}
            title="Vista tabella"
          >
            <List size={16} />
          </button>
          <button
            onClick={() => setViewMode('kanban')}
            className={`p-2 rounded-md transition-colors ${
              viewMode === 'kanban' ? 'bg-bg3 text-gold' : 'text-text3 hover:text-text'
            }`}
            title="Vista kanban"
          >
            <LayoutGrid size={16} />
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="text-gold animate-pulse">Caricamento...</div>
        </div>
      )}

      {/* Content */}
      {!loading && viewMode === 'table' && (
        <Table
          columns={columns}
          data={filtered}
          keyExtractor={(row) => row.id}
          onRowClick={handleEdit}
          emptyMessage="Nessun lead trovato."
        />
      )}

      {!loading && viewMode === 'kanban' && (
        <LeadKanban onEditLead={handleEdit} onConvertLead={handleConvertLead} />
      )}

      {/* Modal */}
      <Modal
        open={modalOpen}
        onClose={handleCloseModal}
        title={editingLead ? 'Modifica Lead' : 'Nuovo Lead'}
        className="max-w-2xl"
      >
        <LeadForm lead={editingLead} onClose={handleCloseModal} />
      </Modal>
    </div>
  )
}
