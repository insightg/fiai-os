import { useState, useEffect, useMemo, type FormEvent } from 'react'
import { GitBranch, Users, UserPlus, Plus, Search, Trash2 } from 'lucide-react'
import AgentPanel from './AgentPanel'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import { Input, Select, Textarea } from '../ui/Form'
import { useAuthStore, useLeadsStore, useClientiStore } from '../../store'
import type { LeadStato, Lead, Cliente } from '../../types'
import toast from 'react-hot-toast'

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

const STATO_OPTIONS = Object.entries(STATO_LABELS).map(([value, label]) => ({ value, label }))

function formatEuro(n: number): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
}

const defaultLeadForm = {
  nome: '',
  cognome: '',
  email: '',
  telefono: '',
  azienda_lead: '',
  stato: 'nuovo' as LeadStato,
  valore_stimato: '',
  note: '',
}

const defaultClienteForm = {
  tipo: 'privato' as 'privato' | 'azienda',
  nome: '',
  cognome: '',
  ragione_sociale: '',
  piva: '',
  email: '',
  telefono: '',
  note: '',
}

export default function CommercialePanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState('pipeline')
  const profile = useAuthStore((s) => s.profile)
  const { leads, fetch: fetchLeads, create: createLead, update: updateLead, remove: removeLead } = useLeadsStore()
  const { clienti, fetch: fetchClienti, create: createCliente, update: updateCliente, remove: removeCliente } = useClientiStore()

  const [search, setSearch] = useState('')

  // Lead CRUD state
  const [editLead, setEditLead] = useState<Lead | null>(null)
  const [leadFormOpen, setLeadFormOpen] = useState(false)
  const [leadForm, setLeadForm] = useState({ ...defaultLeadForm })

  // Cliente CRUD state
  const [editCliente, setEditCliente] = useState<Cliente | null>(null)
  const [clienteFormOpen, setClienteFormOpen] = useState(false)
  const [clienteForm, setClienteForm] = useState({ ...defaultClienteForm })

  useEffect(() => {
    if (!profile?.azienda_id) return
    fetchLeads(profile.azienda_id)
    fetchClienti(profile.azienda_id)
  }, [profile?.azienda_id])

  // Pipeline counts
  const pipeline = useMemo(() => {
    const counts: Record<LeadStato, { count: number; value: number }> = {} as any
    for (const s of Object.keys(STATO_LABELS) as LeadStato[]) {
      counts[s] = { count: 0, value: 0 }
    }
    leads.forEach((l) => {
      counts[l.stato].count++
      counts[l.stato].value += l.valore_stimato ?? 0
    })
    return counts
  }, [leads])

  const filteredLeads = useMemo(() => {
    if (!search.trim()) return leads
    const q = search.toLowerCase()
    return leads.filter(
      (l) =>
        l.nome.toLowerCase().includes(q) ||
        l.cognome.toLowerCase().includes(q) ||
        (l.email ?? '').toLowerCase().includes(q)
    )
  }, [leads, search])

  const filteredClienti = useMemo(() => {
    if (!search.trim()) return clienti
    const q = search.toLowerCase()
    return clienti.filter(
      (c) =>
        c.nome.toLowerCase().includes(q) ||
        (c.cognome ?? '').toLowerCase().includes(q) ||
        (c.ragione_sociale ?? '').toLowerCase().includes(q) ||
        (c.email ?? '').toLowerCase().includes(q)
    )
  }, [clienti, search])

  // Lead CRUD
  const openCreateLead = () => { setEditLead(null); setLeadForm({ ...defaultLeadForm }); setLeadFormOpen(true) }
  const openEditLead = (item: Lead) => {
    setEditLead(item)
    setLeadForm({
      nome: item.nome,
      cognome: item.cognome,
      email: item.email ?? '',
      telefono: item.telefono ?? '',
      azienda_lead: item.azienda_lead ?? '',
      stato: item.stato,
      valore_stimato: item.valore_stimato?.toString() ?? '',
      note: item.note ?? '',
    })
    setLeadFormOpen(true)
  }
  const handleSaveLead = async (e: FormEvent) => {
    e.preventDefault()
    if (!profile?.azienda_id) return
    if (!leadForm.nome.trim() || !leadForm.cognome.trim()) { toast.error('Nome e cognome obbligatori'); return }
    const payload = {
      nome: leadForm.nome.trim(),
      cognome: leadForm.cognome.trim(),
      email: leadForm.email.trim() || null,
      telefono: leadForm.telefono.trim() || null,
      azienda_lead: leadForm.azienda_lead.trim() || null,
      stato: leadForm.stato,
      valore_stimato: leadForm.valore_stimato ? parseFloat(leadForm.valore_stimato) : null,
      note: leadForm.note.trim() || null,
      fonte: editLead?.fonte ?? null,
      assegnato_a: editLead?.assegnato_a ?? null,
    }
    if (editLead) {
      await updateLead(editLead.id, payload)
      toast.success('Lead aggiornato')
    } else {
      await createLead({ ...payload, azienda_id: profile.azienda_id })
      toast.success('Lead creato')
    }
    setLeadFormOpen(false)
  }
  const handleDeleteLead = async (id: string) => {
    if (!confirm('Eliminare questo lead?')) return
    await removeLead(id)
    toast.success('Lead eliminato')
  }

  // Cliente CRUD
  const openCreateCliente = () => { setEditCliente(null); setClienteForm({ ...defaultClienteForm }); setClienteFormOpen(true) }
  const openEditCliente = (item: Cliente) => {
    setEditCliente(item)
    setClienteForm({
      tipo: item.tipo,
      nome: item.nome,
      cognome: item.cognome ?? '',
      ragione_sociale: item.ragione_sociale ?? '',
      piva: item.piva ?? '',
      email: item.email ?? '',
      telefono: item.telefono ?? '',
      note: item.note ?? '',
    })
    setClienteFormOpen(true)
  }
  const handleSaveCliente = async (e: FormEvent) => {
    e.preventDefault()
    if (!profile?.azienda_id) return
    if (!clienteForm.nome.trim()) { toast.error('Nome obbligatorio'); return }
    const payload = {
      tipo: clienteForm.tipo,
      nome: clienteForm.nome.trim(),
      cognome: clienteForm.cognome.trim() || null,
      ragione_sociale: clienteForm.ragione_sociale.trim() || null,
      piva: clienteForm.piva.trim() || null,
      codice_fiscale: null,
      email: clienteForm.email.trim() || null,
      telefono: clienteForm.telefono.trim() || null,
      indirizzo: null,
      cap: null,
      citta: null,
      provincia: null,
      codice_sdi: null,
      pec: null,
      note: clienteForm.note.trim() || null,
    }
    if (editCliente) {
      await updateCliente(editCliente.id, payload)
      toast.success('Cliente aggiornato')
    } else {
      await createCliente({ ...payload, azienda_id: profile.azienda_id })
      toast.success('Cliente creato')
    }
    setClienteFormOpen(false)
  }
  const handleDeleteCliente = async (id: string) => {
    if (!confirm('Eliminare questo cliente?')) return
    await removeCliente(id)
    toast.success('Cliente eliminato')
  }

  const tabs = [
    { key: 'pipeline', label: 'Pipeline', icon: GitBranch },
    { key: 'clienti', label: 'Clienti', icon: Users },
    { key: 'lead', label: 'Lead', icon: UserPlus },
  ]

  return (
    <AgentPanel title="Commerciale" color="#1976D2" tabs={tabs} activeTab={tab} onTabChange={setTab} onClose={onClose}>
      {tab === 'pipeline' && (
        <div className="space-y-2">
          {(Object.keys(STATO_LABELS) as LeadStato[]).map((stato) => (
            <div key={stato} className="flex items-center justify-between bg-bg2 border border-border rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <Badge color={STATO_COLORS[stato]}>{STATO_LABELS[stato]}</Badge>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-text2">{pipeline[stato].count} lead</span>
                <span className="text-xs font-medium text-text">{formatEuro(pipeline[stato].value)}</span>
              </div>
            </div>
          ))}
          <div className="mt-3 bg-bg2 border border-border rounded-lg px-3 py-2 flex justify-between">
            <span className="text-xs font-semibold text-text">Totale pipeline</span>
            <span className="text-sm font-bold text-text">
              {formatEuro(Object.values(pipeline).reduce((a, p) => a + p.value, 0))}
            </span>
          </div>
        </div>
      )}

      {tab === 'clienti' && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text3" />
              <input
                type="text"
                placeholder="Cerca clienti..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-bg2 border border-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-text placeholder:text-text3 focus:outline-none focus:border-gold/40"
              />
            </div>
            <Button size="sm" variant="primary" onClick={openCreateCliente}>
              <Plus size={13} />
            </Button>
          </div>
          <div className="space-y-0.5">
            {filteredClienti.slice(0, 20).map((c) => (
              <div
                key={c.id}
                onClick={() => openEditCliente(c)}
                className="flex items-center justify-between bg-bg2 border border-border rounded-lg px-2.5 py-2 hover:border-gold/20 transition-colors cursor-pointer group"
              >
                <div className="min-w-0">
                  <p className="text-xs font-medium text-text truncate">
                    {c.tipo === 'azienda' ? c.ragione_sociale : `${c.nome} ${c.cognome ?? ''}`}
                  </p>
                  <p className="text-[10px] text-text3 truncate">{c.email ?? '-'}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge color={c.tipo === 'azienda' ? 'blue' : 'gray'}>{c.tipo}</Badge>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteCliente(c.id) }}
                    className="p-0.5 rounded text-text3 hover:text-red opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            ))}
            {filteredClienti.length === 0 && (
              <p className="text-xs text-text3 text-center py-4">Nessun cliente trovato</p>
            )}
            {filteredClienti.length > 20 && (
              <p className="text-[10px] text-text3 text-center pt-2">
                +{filteredClienti.length - 20} altri clienti
              </p>
            )}
          </div>
        </div>
      )}

      {tab === 'lead' && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text3" />
              <input
                type="text"
                placeholder="Cerca lead..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-bg2 border border-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-text placeholder:text-text3 focus:outline-none focus:border-gold/40"
              />
            </div>
            <Button size="sm" variant="primary" onClick={openCreateLead}>
              <Plus size={13} />
            </Button>
          </div>
          <div className="space-y-0.5">
            {filteredLeads.slice(0, 20).map((l) => (
              <div
                key={l.id}
                onClick={() => openEditLead(l)}
                className="flex items-center justify-between bg-bg2 border border-border rounded-lg px-2.5 py-2 hover:border-gold/20 transition-colors cursor-pointer group"
              >
                <div className="min-w-0">
                  <p className="text-xs font-medium text-text truncate">{l.nome} {l.cognome}</p>
                  <p className="text-[10px] text-text3 truncate">{l.azienda_lead ?? l.email ?? '-'}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge color={STATO_COLORS[l.stato]}>{STATO_LABELS[l.stato]}</Badge>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteLead(l.id) }}
                    className="p-0.5 rounded text-text3 hover:text-red opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            ))}
            {filteredLeads.length === 0 && (
              <p className="text-xs text-text3 text-center py-4">Nessun lead trovato</p>
            )}
          </div>
        </div>
      )}

      {/* Lead Modal */}
      <Modal open={leadFormOpen} onClose={() => setLeadFormOpen(false)} title={editLead ? 'Modifica Lead' : 'Nuovo Lead'}>
        <form onSubmit={handleSaveLead} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Nome" required value={leadForm.nome} onChange={(e) => setLeadForm((f) => ({ ...f, nome: e.target.value }))} />
            <Input label="Cognome" required value={leadForm.cognome} onChange={(e) => setLeadForm((f) => ({ ...f, cognome: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Email" type="email" value={leadForm.email} onChange={(e) => setLeadForm((f) => ({ ...f, email: e.target.value }))} />
            <Input label="Telefono" value={leadForm.telefono} onChange={(e) => setLeadForm((f) => ({ ...f, telefono: e.target.value }))} />
          </div>
          <Input label="Azienda" value={leadForm.azienda_lead} onChange={(e) => setLeadForm((f) => ({ ...f, azienda_lead: e.target.value }))} />
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Stato"
              options={STATO_OPTIONS}
              value={leadForm.stato}
              onChange={(e) => setLeadForm((f) => ({ ...f, stato: e.target.value as LeadStato }))}
            />
            <Input label="Valore stimato" type="number" value={leadForm.valore_stimato} onChange={(e) => setLeadForm((f) => ({ ...f, valore_stimato: e.target.value }))} />
          </div>
          <Textarea label="Note" value={leadForm.note} onChange={(e) => setLeadForm((f) => ({ ...f, note: e.target.value }))} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" onClick={() => setLeadFormOpen(false)}>Annulla</Button>
            <Button type="submit" variant="primary">Salva</Button>
          </div>
        </form>
      </Modal>

      {/* Cliente Modal */}
      <Modal open={clienteFormOpen} onClose={() => setClienteFormOpen(false)} title={editCliente ? 'Modifica Cliente' : 'Nuovo Cliente'}>
        <form onSubmit={handleSaveCliente} className="space-y-3">
          <Select
            label="Tipo"
            options={[
              { value: 'privato', label: 'Privato' },
              { value: 'azienda', label: 'Azienda' },
            ]}
            value={clienteForm.tipo}
            onChange={(e) => setClienteForm((f) => ({ ...f, tipo: e.target.value as any }))}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Nome" required value={clienteForm.nome} onChange={(e) => setClienteForm((f) => ({ ...f, nome: e.target.value }))} />
            <Input label="Cognome" value={clienteForm.cognome} onChange={(e) => setClienteForm((f) => ({ ...f, cognome: e.target.value }))} />
          </div>
          {clienteForm.tipo === 'azienda' && (
            <Input label="Ragione Sociale" value={clienteForm.ragione_sociale} onChange={(e) => setClienteForm((f) => ({ ...f, ragione_sociale: e.target.value }))} />
          )}
          <Input label="P.IVA" value={clienteForm.piva} onChange={(e) => setClienteForm((f) => ({ ...f, piva: e.target.value }))} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Email" type="email" value={clienteForm.email} onChange={(e) => setClienteForm((f) => ({ ...f, email: e.target.value }))} />
            <Input label="Telefono" value={clienteForm.telefono} onChange={(e) => setClienteForm((f) => ({ ...f, telefono: e.target.value }))} />
          </div>
          <Textarea label="Note" value={clienteForm.note} onChange={(e) => setClienteForm((f) => ({ ...f, note: e.target.value }))} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" onClick={() => setClienteFormOpen(false)}>Annulla</Button>
            <Button type="submit" variant="primary">Salva</Button>
          </div>
        </form>
      </Modal>
    </AgentPanel>
  )
}
