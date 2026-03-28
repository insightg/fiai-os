import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePreventiviStore, useClientiStore, useOrdiniStore, useAuthStore } from '../../store'
import type { Preventivo, PreventivoStato } from '../../types'
import Table, { type Column } from '../../components/ui/Table'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import Modal from '../../components/ui/Modal'
import { Input, Select } from '../../components/ui/Form'
import StatCard from '../../components/ui/StatCard'
import PreventivoEditor from './PreventivoEditor'
import { Plus, Search, FileText, ArrowRight } from 'lucide-react'
import toast from 'react-hot-toast'

const STATO_COLORS: Record<PreventivoStato, 'gray' | 'blue' | 'green' | 'red' | 'amber'> = {
  bozza: 'gray',
  inviato: 'blue',
  accettato: 'green',
  rifiutato: 'red',
  scaduto: 'amber',
}

const STATO_LABELS: Record<PreventivoStato, string> = {
  bozza: 'Bozza',
  inviato: 'Inviato',
  accettato: 'Accettato',
  rifiutato: 'Rifiutato',
  scaduto: 'Scaduto',
}

const FILTER_OPTIONS = [
  { value: '', label: 'Tutti gli stati' },
  { value: 'bozza', label: 'Bozza' },
  { value: 'inviato', label: 'Inviato' },
  { value: 'accettato', label: 'Accettato' },
  { value: 'rifiutato', label: 'Rifiutato' },
  { value: 'scaduto', label: 'Scaduto' },
]

function formatEuro(value: number): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(value)
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export default function Preventivi() {
  const profile = useAuthStore((s) => s.profile)
  const { preventivi, loading, fetch: fetchPreventivi, update: updatePreventivo } = usePreventiviStore()
  const { fetch: fetchClienti } = useClientiStore()
  const { create: createOrdine } = useOrdiniStore()
  const navigate = useNavigate()

  const [search, setSearch] = useState('')
  const [filterStato, setFilterStato] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingPreventivo, setEditingPreventivo] = useState<Preventivo | null>(null)

  useEffect(() => {
    if (profile?.azienda_id) {
      fetchPreventivi(profile.azienda_id)
      fetchClienti(profile.azienda_id)
    }
  }, [profile?.azienda_id, fetchPreventivi, fetchClienti])

  const filtered = useMemo(() => {
    let result = preventivi
    if (filterStato) {
      result = result.filter((p) => p.stato === filterStato)
    }
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(
        (p) =>
          p.numero.toLowerCase().includes(q) ||
          (p.cliente?.nome?.toLowerCase().includes(q) ?? false) ||
          (p.cliente?.ragione_sociale?.toLowerCase().includes(q) ?? false) ||
          (p.oggetto?.toLowerCase().includes(q) ?? false)
      )
    }
    return result
  }, [preventivi, filterStato, search])

  const stats = useMemo(() => {
    const total = preventivi.length
    const totalValue = preventivi.reduce((sum, p) => sum + p.totale, 0)
    const accettati = preventivi.filter((p) => p.stato === 'accettato')
    const accettatiValue = accettati.reduce((sum, p) => sum + p.totale, 0)
    const bozze = preventivi.filter((p) => p.stato === 'bozza').length
    return { total, totalValue, accettatiValue, bozze }
  }, [preventivi])

  function handleNew() {
    setEditingPreventivo(null)
    setEditorOpen(true)
  }

  function handleEdit(preventivo: Preventivo) {
    setEditingPreventivo(preventivo)
    setEditorOpen(true)
  }

  async function handleConvertToOrdine(preventivo: Preventivo) {
    if (!profile) return

    const ordine = await createOrdine({
      azienda_id: profile.azienda_id,
      cliente_id: preventivo.cliente_id,
      preventivo_id: preventivo.id,
      numero: `ORD-${Date.now().toString(36).toUpperCase()}`,
      data: new Date().toISOString().split('T')[0],
      stato: 'confermato',
      imponibile: preventivo.imponibile,
      iva: preventivo.iva,
      totale: preventivo.totale,
      note: `Generato dal preventivo ${preventivo.numero}`,
    })

    if (ordine) {
      await updatePreventivo(preventivo.id, { stato: 'accettato' })
      toast.success('Preventivo convertito in ordine')
      navigate('/ordini')
    } else {
      toast.error('Errore nella conversione in ordine')
    }
  }

  const clienteName = (p: Preventivo) =>
    p.cliente?.ragione_sociale ?? (`${p.cliente?.nome ?? ''} ${p.cliente?.cognome ?? ''}`.trim() || '-')

  const columns: Column<Preventivo>[] = [
    {
      key: 'numero',
      header: 'Numero',
      render: (row) => <span className="font-medium text-text">{row.numero}</span>,
    },
    {
      key: 'cliente',
      header: 'Cliente',
      render: (row) => <span className="text-sm text-text2">{clienteName(row)}</span>,
    },
    {
      key: 'oggetto',
      header: 'Oggetto',
      render: (row) => (
        <span className="text-sm text-text2 truncate max-w-[200px] block">
          {row.oggetto ?? '-'}
        </span>
      ),
    },
    {
      key: 'importo',
      header: 'Importo',
      render: (row) => <span className="text-sm text-text2">{formatEuro(row.imponibile)}</span>,
    },
    {
      key: 'iva',
      header: 'IVA',
      render: (row) => <span className="text-sm text-text2">{formatEuro(row.iva)}</span>,
    },
    {
      key: 'totale',
      header: 'Totale',
      render: (row) => <span className="font-semibold text-gold">{formatEuro(row.totale)}</span>,
    },
    {
      key: 'data',
      header: 'Data',
      render: (row) => <span className="text-sm text-text2">{formatDate(row.data)}</span>,
    },
    {
      key: 'scadenza',
      header: 'Validità',
      render: (row) => (
        <span className="text-sm text-text2">
          {row.scadenza ? formatDate(row.scadenza) : '-'}
        </span>
      ),
    },
    {
      key: 'stato',
      header: 'Stato',
      render: (row) => (
        <Badge color={STATO_COLORS[row.stato]}>{STATO_LABELS[row.stato]}</Badge>
      ),
    },
    {
      key: 'azioni',
      header: 'Azioni',
      render: (row) => (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => handleEdit(row)}>
            Modifica
          </Button>
          {row.stato === 'accettato' && (
            <Button size="sm" variant="primary" onClick={() => handleConvertToOrdine(row)}>
              <ArrowRight size={14} />
              Ordine
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
          <h1 className="text-2xl font-bold font-display text-text">Preventivi</h1>
          <p className="text-sm text-text3 mt-1">Gestione preventivi e offerte commerciali</p>
        </div>
        <Button variant="primary" onClick={handleNew}>
          <Plus size={16} />
          Nuovo Preventivo
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard icon={FileText} label="Totale Preventivi" value={stats.total.toString()} />
        <StatCard icon={FileText} label="Valore Totale" value={formatEuro(stats.totalValue)} />
        <StatCard icon={FileText} label="Valore Accettati" value={formatEuro(stats.accettatiValue)} />
        <StatCard icon={FileText} label="Bozze" value={stats.bozze.toString()} />
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text3" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cerca per numero, cliente..."
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

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="text-gold animate-pulse">Caricamento...</div>
        </div>
      )}

      {/* Table */}
      {!loading && (
        <Table
          columns={columns}
          data={filtered}
          keyExtractor={(row) => row.id}
          onRowClick={handleEdit}
          emptyMessage="Nessun preventivo trovato."
        />
      )}

      {/* Editor Modal */}
      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editingPreventivo ? `Modifica Preventivo ${editingPreventivo.numero}` : 'Nuovo Preventivo'}
        className="max-w-4xl"
      >
        <PreventivoEditor
          preventivo={editingPreventivo}
          onClose={() => setEditorOpen(false)}
        />
      </Modal>
    </div>
  )
}
