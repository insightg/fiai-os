import { useState, useEffect, useMemo, type FormEvent } from 'react'
import { Plus, Search, Filter, CheckCircle, XCircle, Clock, Receipt } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore, useRimborsiStore } from '../../store'
import Table, { type Column } from '../../components/ui/Table'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import Modal from '../../components/ui/Modal'
import { Input, Select, Textarea } from '../../components/ui/Form'
import StatCard from '../../components/ui/StatCard'
import type { Rimborso, RimborsoStato } from '../../types'

const statoColors: Record<RimborsoStato, 'amber' | 'green' | 'red' | 'blue'> = {
  richiesto: 'amber',
  approvato: 'green',
  rifiutato: 'red',
  rimborsato: 'blue',
}

const statoLabels: Record<RimborsoStato, string> = {
  richiesto: 'In Attesa',
  approvato: 'Approvato',
  rifiutato: 'Rifiutato',
  rimborsato: 'Rimborsato',
}

const CATEGORIE = [
  'Viaggio',
  'Alloggio',
  'Pasti',
  'Trasporti',
  'Materiale',
  'Software',
  'Formazione',
  'Rappresentanza',
  'Altro',
]

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n)
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('it-IT')
}

interface RimborsoForm {
  descrizione: string
  importo: number
  data_spesa: string
  categoria: string
  note: string
  allegato_url: string
}

const emptyForm: RimborsoForm = {
  descrizione: '',
  importo: 0,
  data_spesa: new Date().toISOString().split('T')[0],
  categoria: 'Altro',
  note: '',
  allegato_url: '',
}

export default function Rimborsi() {
  const profile = useAuthStore((s) => s.profile)
  const { rimborsi, loading, fetch, create, approve, reject } = useRimborsiStore()
  const [search, setSearch] = useState('')
  const [filterStato, setFilterStato] = useState<string>('tutti')
  const [modalOpen, setModalOpen] = useState(false)
  const [rejectModalOpen, setRejectModalOpen] = useState(false)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectNote, setRejectNote] = useState('')
  const [form, setForm] = useState<RimborsoForm>(emptyForm)

  useEffect(() => {
    if (profile?.azienda_id) {
      fetch(profile.azienda_id)
    }
  }, [profile?.azienda_id, fetch])

  const isAdmin = profile?.ruolo === 'admin'

  const filtered = useMemo(() => {
    let result = rimborsi
    if (filterStato !== 'tutti') {
      result = result.filter((r) => r.stato === filterStato)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(
        (r) =>
          r.descrizione.toLowerCase().includes(q) ||
          (r.categoria ?? '').toLowerCase().includes(q)
      )
    }
    return result
  }, [rimborsi, filterStato, search])

  const stats = useMemo(() => {
    const totaleRichiesto = rimborsi.filter((r) => r.stato === 'richiesto').reduce((acc, r) => acc + r.importo, 0)
    const totaleApprovato = rimborsi.filter((r) => r.stato === 'approvato' || r.stato === 'rimborsato').reduce((acc, r) => acc + r.importo, 0)
    const inAttesa = rimborsi.filter((r) => r.stato === 'richiesto').length
    return { totaleRichiesto, totaleApprovato, inAttesa }
  }, [rimborsi])

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    if (!profile?.azienda_id || !profile.id) return
    const created = await create({
      azienda_id: profile.azienda_id,
      richiedente_id: profile.id,
      descrizione: form.descrizione,
      importo: form.importo,
      data_spesa: form.data_spesa,
      categoria: form.categoria || null,
      stato: 'richiesto',
      allegato_url: form.allegato_url || null,
      approvato_da: null,
      approvato_il: null,
      note: form.note || null,
    })
    if (created) {
      toast.success('Nota spese creata')
      setModalOpen(false)
      setForm(emptyForm)
    } else {
      toast.error('Errore nella creazione')
    }
  }

  const handleApprove = async (id: string) => {
    if (!profile?.id) return
    await approve(id, profile.id)
    toast.success('Rimborso approvato')
  }

  const handleOpenReject = (id: string) => {
    setRejectingId(id)
    setRejectNote('')
    setRejectModalOpen(true)
  }

  const handleReject = async () => {
    if (!rejectingId || !profile?.id) return
    await reject(rejectingId, profile.id, rejectNote)
    toast.success('Rimborso rifiutato')
    setRejectModalOpen(false)
    setRejectingId(null)
  }

  const columns: Column<Rimborso>[] = [
    {
      key: 'richiedente',
      header: 'Richiedente',
      render: (r) => <span className="text-text2">{r.richiedente_id.slice(0, 8)}...</span>,
    },
    {
      key: 'descrizione',
      header: 'Descrizione',
      render: (r) => <span className="font-medium truncate max-w-[200px] block">{r.descrizione}</span>,
    },
    {
      key: 'importo',
      header: 'Importo',
      render: (r) => <span className="font-mono font-medium">{formatCurrency(r.importo)}</span>,
    },
    {
      key: 'data',
      header: 'Data Spesa',
      render: (r) => <span className="text-text2">{formatDate(r.data_spesa)}</span>,
    },
    {
      key: 'categoria',
      header: 'Categoria',
      render: (r) => <span className="text-text2">{r.categoria ?? '-'}</span>,
    },
    {
      key: 'stato',
      header: 'Stato',
      render: (r) => <Badge color={statoColors[r.stato]}>{statoLabels[r.stato]}</Badge>,
    },
    {
      key: 'approvato_da',
      header: 'Approvato Da',
      render: (r) => (
        <span className="text-text3 text-xs">
          {r.approvato_da ? `${r.approvato_da.slice(0, 8)}...` : '-'}
        </span>
      ),
    },
    {
      key: 'azioni',
      header: '',
      render: (r) => (
        <div className="flex items-center gap-1">
          {isAdmin && r.stato === 'richiesto' && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); handleApprove(r.id) }}
                className="p-1.5 rounded-lg text-text3 hover:text-green hover:bg-bg3 transition-colors"
                title="Approva"
              >
                <CheckCircle size={15} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleOpenReject(r.id) }}
                className="p-1.5 rounded-lg text-text3 hover:text-red hover:bg-bg3 transition-colors"
                title="Rifiuta"
              >
                <XCircle size={15} />
              </button>
            </>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold text-text">Rimborsi</h1>
        <Button variant="primary" onClick={() => setModalOpen(true)}>
          <Plus size={16} />
          Nuova Nota Spese
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard icon={Clock} label="In Attesa di Approvazione" value={String(stats.inAttesa)} />
        <StatCard icon={Receipt} label="Totale Richiesto" value={formatCurrency(stats.totaleRichiesto)} />
        <StatCard icon={CheckCircle} label="Totale Approvato" value={formatCurrency(stats.totaleApprovato)} />
      </div>

      <div className="flex items-center gap-4">
        <div className="flex-1 max-w-sm">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text3" />
            <input
              type="text"
              placeholder="Cerca per descrizione o categoria..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-bg3 border border-border text-text text-sm placeholder:text-text3 focus:outline-none focus:ring-1 focus:ring-gold/50 focus:border-gold/50 transition-colors"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Filter size={16} className="text-text3" />
          <Select
            value={filterStato}
            onChange={(e) => setFilterStato(e.target.value)}
            options={[
              { value: 'tutti', label: 'Tutti gli stati' },
              { value: 'richiesto', label: 'In Attesa' },
              { value: 'approvato', label: 'Approvato' },
              { value: 'rifiutato', label: 'Rifiutato' },
              { value: 'rimborsato', label: 'Rimborsato' },
            ]}
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="text-gold font-display text-lg animate-pulse">Caricamento...</div>
        </div>
      ) : (
        <Table
          columns={columns}
          data={filtered}
          keyExtractor={(r) => r.id}
          emptyMessage="Nessun rimborso trovato."
        />
      )}

      {/* New Rimborso Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Nuova Nota Spese"
        className="max-w-lg"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <Input
            label="Descrizione"
            value={form.descrizione}
            onChange={(e) => setForm((p) => ({ ...p, descrizione: e.target.value }))}
            required
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Importo"
              type="number"
              min={0}
              step={0.01}
              value={form.importo}
              onChange={(e) => setForm((p) => ({ ...p, importo: parseFloat(e.target.value) || 0 }))}
              required
            />
            <Input
              label="Data Spesa"
              type="date"
              value={form.data_spesa}
              onChange={(e) => setForm((p) => ({ ...p, data_spesa: e.target.value }))}
              required
            />
          </div>
          <Select
            label="Categoria"
            value={form.categoria}
            onChange={(e) => setForm((p) => ({ ...p, categoria: e.target.value }))}
            options={CATEGORIE.map((c) => ({ value: c, label: c }))}
          />
          <Input
            label="URL Allegato (opzionale)"
            value={form.allegato_url}
            onChange={(e) => setForm((p) => ({ ...p, allegato_url: e.target.value }))}
            placeholder="https://..."
          />
          <Textarea
            label="Note"
            value={form.note}
            onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))}
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" onClick={() => setModalOpen(false)}>Annulla</Button>
            <Button type="submit" variant="primary">Invia Richiesta</Button>
          </div>
        </form>
      </Modal>

      {/* Reject Modal */}
      <Modal
        open={rejectModalOpen}
        onClose={() => setRejectModalOpen(false)}
        title="Rifiuta Rimborso"
        className="max-w-md"
      >
        <div className="space-y-4">
          <Textarea
            label="Motivazione del rifiuto"
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            placeholder="Inserisci la motivazione..."
            required
          />
          <div className="flex justify-end gap-3">
            <Button onClick={() => setRejectModalOpen(false)}>Annulla</Button>
            <Button variant="danger" onClick={handleReject}>
              <XCircle size={16} />
              Rifiuta
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
