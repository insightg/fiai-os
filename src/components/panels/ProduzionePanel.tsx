import { useState, useEffect, useMemo, type FormEvent } from 'react'
import { FolderOpen, ShoppingCart, Search, Plus, Trash2 } from 'lucide-react'
import AgentPanel from './AgentPanel'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import { Input, Select, Textarea } from '../ui/Form'
import { useAuthStore, useProgettiStore, useOrdiniStore } from '../../store'
import type { ProgettoStato, OrdineStato, Progetto, Ordine } from '../../types'
import toast from 'react-hot-toast'

const PROGETTO_COLORS: Record<ProgettoStato, 'blue' | 'gold' | 'amber' | 'green' | 'red'> = {
  pianificato: 'blue',
  in_corso: 'gold',
  in_pausa: 'amber',
  completato: 'green',
  annullato: 'red',
}
const PROGETTO_LABELS: Record<ProgettoStato, string> = {
  pianificato: 'Pianificazione',
  in_corso: 'In Corso',
  in_pausa: 'In Pausa',
  completato: 'Completato',
  annullato: 'Annullato',
}
const PROGETTO_STATO_OPTIONS = Object.entries(PROGETTO_LABELS).map(([value, label]) => ({ value, label }))

const ORDINE_COLORS: Record<OrdineStato, 'blue' | 'amber' | 'green' | 'red'> = {
  confermato: 'blue',
  in_lavorazione: 'amber',
  completato: 'green',
  annullato: 'red',
}
const ORDINE_LABELS: Record<OrdineStato, string> = {
  confermato: 'Confermato',
  in_lavorazione: 'In Lavorazione',
  completato: 'Completato',
  annullato: 'Annullato',
}
const ORDINE_STATO_OPTIONS = Object.entries(ORDINE_LABELS).map(([value, label]) => ({ value, label }))

function formatDate(d: string | null): string {
  if (!d) return '-'
  return new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function formatEuro(n: number): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
}

const defaultProgettoForm = {
  nome: '',
  descrizione: '',
  stato: 'pianificato' as ProgettoStato,
  data_inizio: '',
  data_fine_prevista: '',
  budget: '',
  note: '',
}

const defaultOrdineForm = {
  numero: '',
  data: '',
  stato: 'confermato' as OrdineStato,
  imponibile: '',
  iva: '',
  totale: '',
  note: '',
}

export default function ProduzionePanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState('progetti')
  const [search, setSearch] = useState('')
  const profile = useAuthStore((s) => s.profile)
  const { progetti, fetch: fetchProgetti, create: createProgetto, update: updateProgetto, remove: removeProgetto } = useProgettiStore()
  const { ordini, fetch: fetchOrdini, create: createOrdine, update: updateOrdine, remove: removeOrdine } = useOrdiniStore()

  // Progetto CRUD
  const [editProgetto, setEditProgetto] = useState<Progetto | null>(null)
  const [progettoFormOpen, setProgettoFormOpen] = useState(false)
  const [progettoForm, setProgettoForm] = useState({ ...defaultProgettoForm })

  // Ordine CRUD
  const [editOrdine, setEditOrdine] = useState<Ordine | null>(null)
  const [ordineFormOpen, setOrdineFormOpen] = useState(false)
  const [ordineForm, setOrdineForm] = useState({ ...defaultOrdineForm })

  useEffect(() => {
    if (!profile?.azienda_id) return
    fetchProgetti(profile.azienda_id)
    fetchOrdini(profile.azienda_id)
  }, [profile?.azienda_id])

  const filteredProgetti = useMemo(() => {
    if (!search.trim()) return progetti
    const q = search.toLowerCase()
    return progetti.filter((p) => p.nome.toLowerCase().includes(q))
  }, [progetti, search])

  const filteredOrdini = useMemo(() => {
    if (!search.trim()) return ordini
    const q = search.toLowerCase()
    return ordini.filter((o) => o.numero.toLowerCase().includes(q))
  }, [ordini, search])

  // Progetto CRUD handlers
  const openCreateProgetto = () => { setEditProgetto(null); setProgettoForm({ ...defaultProgettoForm }); setProgettoFormOpen(true) }
  const openEditProgetto = (item: Progetto) => {
    setEditProgetto(item)
    setProgettoForm({
      nome: item.nome,
      descrizione: item.descrizione ?? '',
      stato: item.stato,
      data_inizio: item.data_inizio ?? '',
      data_fine_prevista: item.data_fine_prevista ?? '',
      budget: item.budget?.toString() ?? '',
      note: item.note ?? '',
    })
    setProgettoFormOpen(true)
  }
  const handleSaveProgetto = async (e: FormEvent) => {
    e.preventDefault()
    if (!profile?.azienda_id) return
    if (!progettoForm.nome.trim()) { toast.error('Nome obbligatorio'); return }
    const payload = {
      nome: progettoForm.nome.trim(),
      descrizione: progettoForm.descrizione.trim() || null,
      stato: progettoForm.stato,
      data_inizio: progettoForm.data_inizio || null,
      data_fine_prevista: progettoForm.data_fine_prevista || null,
      data_fine_effettiva: editProgetto?.data_fine_effettiva ?? null,
      budget: progettoForm.budget ? parseFloat(progettoForm.budget) : null,
      note: progettoForm.note.trim() || null,
    }
    if (editProgetto) {
      await updateProgetto(editProgetto.id, payload)
      toast.success('Progetto aggiornato')
    } else {
      await createProgetto({ ...payload, azienda_id: profile.azienda_id, cliente_id: editProgetto?.cliente_id ?? '', ordine_id: null })
      toast.success('Progetto creato')
    }
    setProgettoFormOpen(false)
  }
  const handleDeleteProgetto = async (id: string) => {
    if (!confirm('Eliminare questo progetto?')) return
    await removeProgetto(id)
    toast.success('Progetto eliminato')
  }

  // Ordine CRUD handlers
  const openCreateOrdine = () => { setEditOrdine(null); setOrdineForm({ ...defaultOrdineForm }); setOrdineFormOpen(true) }
  const openEditOrdine = (item: Ordine) => {
    setEditOrdine(item)
    setOrdineForm({
      numero: item.numero,
      data: item.data,
      stato: item.stato,
      imponibile: item.imponibile.toString(),
      iva: item.iva.toString(),
      totale: item.totale.toString(),
      note: item.note ?? '',
    })
    setOrdineFormOpen(true)
  }
  const handleSaveOrdine = async (e: FormEvent) => {
    e.preventDefault()
    if (!profile?.azienda_id) return
    if (!ordineForm.numero.trim()) { toast.error('Numero obbligatorio'); return }
    const payload = {
      numero: ordineForm.numero.trim(),
      data: ordineForm.data || new Date().toISOString().slice(0, 10),
      stato: ordineForm.stato,
      imponibile: parseFloat(ordineForm.imponibile) || 0,
      iva: parseFloat(ordineForm.iva) || 0,
      totale: parseFloat(ordineForm.totale) || 0,
      note: ordineForm.note.trim() || null,
    }
    if (editOrdine) {
      await updateOrdine(editOrdine.id, payload)
      toast.success('Ordine aggiornato')
    } else {
      await createOrdine({ ...payload, azienda_id: profile.azienda_id, cliente_id: editOrdine?.cliente_id ?? '', preventivo_id: null })
      toast.success('Ordine creato')
    }
    setOrdineFormOpen(false)
  }
  const handleDeleteOrdine = async (id: string) => {
    if (!confirm('Eliminare questo ordine?')) return
    await removeOrdine(id)
    toast.success('Ordine eliminato')
  }

  const tabs = [
    { key: 'progetti', label: 'Progetti', icon: FolderOpen },
    { key: 'ordini', label: 'Ordini', icon: ShoppingCart },
  ]

  return (
    <AgentPanel title="Produzione" color="#E68A00" tabs={tabs} activeTab={tab} onTabChange={setTab} onClose={onClose}>
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text3" />
          <input
            type="text"
            placeholder={tab === 'progetti' ? 'Cerca progetti...' : 'Cerca ordini...'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-bg2 border border-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-text placeholder:text-text3 focus:outline-none focus:border-gold/40"
          />
        </div>
        <Button size="sm" variant="primary" onClick={tab === 'progetti' ? openCreateProgetto : openCreateOrdine}>
          <Plus size={13} />
        </Button>
      </div>

      {tab === 'progetti' && (
        <div className="space-y-1">
          {filteredProgetti.slice(0, 25).map((p) => (
            <div
              key={p.id}
              onClick={() => openEditProgetto(p)}
              className="bg-bg2 border border-border rounded-lg px-2.5 py-2 hover:border-gold/20 transition-colors cursor-pointer group"
            >
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-medium text-text truncate flex-1 mr-2">{p.nome}</p>
                <div className="flex items-center gap-1.5">
                  <Badge color={PROGETTO_COLORS[p.stato]}>{PROGETTO_LABELS[p.stato]}</Badge>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteProgetto(p.id) }}
                    className="p-0.5 rounded text-text3 hover:text-red opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-text3">
                {p.cliente && <span>{p.cliente.tipo === 'azienda' ? p.cliente.ragione_sociale : p.cliente.nome}</span>}
                {p.data_fine_prevista && <span>Scad: {formatDate(p.data_fine_prevista)}</span>}
                {p.budget != null && <span>{formatEuro(p.budget)}</span>}
              </div>
            </div>
          ))}
          {filteredProgetti.length === 0 && (
            <p className="text-xs text-text3 text-center py-4">Nessun progetto trovato</p>
          )}
        </div>
      )}

      {tab === 'ordini' && (
        <div className="space-y-1">
          {filteredOrdini.slice(0, 25).map((o) => (
            <div
              key={o.id}
              onClick={() => openEditOrdine(o)}
              className="flex items-center justify-between bg-bg2 border border-border rounded-lg px-2.5 py-2 hover:border-gold/20 transition-colors cursor-pointer group"
            >
              <div className="min-w-0">
                <p className="text-xs font-medium text-text">#{o.numero}</p>
                <p className="text-[10px] text-text3">{formatDate(o.data)} &middot; {formatEuro(o.totale)}</p>
              </div>
              <div className="flex items-center gap-1.5">
                <Badge color={ORDINE_COLORS[o.stato]}>{ORDINE_LABELS[o.stato]}</Badge>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteOrdine(o.id) }}
                  className="p-0.5 rounded text-text3 hover:text-red opacity-0 group-hover:opacity-100 transition-all"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          ))}
          {filteredOrdini.length === 0 && (
            <p className="text-xs text-text3 text-center py-4">Nessun ordine trovato</p>
          )}
        </div>
      )}

      {/* Progetto Modal */}
      <Modal open={progettoFormOpen} onClose={() => setProgettoFormOpen(false)} title={editProgetto ? 'Modifica Progetto' : 'Nuovo Progetto'}>
        <form onSubmit={handleSaveProgetto} className="space-y-3">
          <Input label="Nome" required value={progettoForm.nome} onChange={(e) => setProgettoForm((f) => ({ ...f, nome: e.target.value }))} />
          <Textarea label="Descrizione" value={progettoForm.descrizione} onChange={(e) => setProgettoForm((f) => ({ ...f, descrizione: e.target.value }))} />
          <Select label="Stato" options={PROGETTO_STATO_OPTIONS} value={progettoForm.stato} onChange={(e) => setProgettoForm((f) => ({ ...f, stato: e.target.value as ProgettoStato }))} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Data Inizio" type="date" value={progettoForm.data_inizio} onChange={(e) => setProgettoForm((f) => ({ ...f, data_inizio: e.target.value }))} />
            <Input label="Data Fine Prevista" type="date" value={progettoForm.data_fine_prevista} onChange={(e) => setProgettoForm((f) => ({ ...f, data_fine_prevista: e.target.value }))} />
          </div>
          <Input label="Budget" type="number" value={progettoForm.budget} onChange={(e) => setProgettoForm((f) => ({ ...f, budget: e.target.value }))} />
          <Textarea label="Note" value={progettoForm.note} onChange={(e) => setProgettoForm((f) => ({ ...f, note: e.target.value }))} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" onClick={() => setProgettoFormOpen(false)}>Annulla</Button>
            <Button type="submit" variant="primary">Salva</Button>
          </div>
        </form>
      </Modal>

      {/* Ordine Modal */}
      <Modal open={ordineFormOpen} onClose={() => setOrdineFormOpen(false)} title={editOrdine ? 'Modifica Ordine' : 'Nuovo Ordine'}>
        <form onSubmit={handleSaveOrdine} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Numero" required value={ordineForm.numero} onChange={(e) => setOrdineForm((f) => ({ ...f, numero: e.target.value }))} />
            <Input label="Data" type="date" value={ordineForm.data} onChange={(e) => setOrdineForm((f) => ({ ...f, data: e.target.value }))} />
          </div>
          <Select label="Stato" options={ORDINE_STATO_OPTIONS} value={ordineForm.stato} onChange={(e) => setOrdineForm((f) => ({ ...f, stato: e.target.value as OrdineStato }))} />
          <div className="grid grid-cols-3 gap-3">
            <Input label="Imponibile" type="number" value={ordineForm.imponibile} onChange={(e) => setOrdineForm((f) => ({ ...f, imponibile: e.target.value }))} />
            <Input label="IVA" type="number" value={ordineForm.iva} onChange={(e) => setOrdineForm((f) => ({ ...f, iva: e.target.value }))} />
            <Input label="Totale" type="number" value={ordineForm.totale} onChange={(e) => setOrdineForm((f) => ({ ...f, totale: e.target.value }))} />
          </div>
          <Textarea label="Note" value={ordineForm.note} onChange={(e) => setOrdineForm((f) => ({ ...f, note: e.target.value }))} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" onClick={() => setOrdineFormOpen(false)}>Annulla</Button>
            <Button type="submit" variant="primary">Salva</Button>
          </div>
        </form>
      </Modal>
    </AgentPanel>
  )
}
