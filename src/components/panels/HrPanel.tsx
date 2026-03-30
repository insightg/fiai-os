import { useState, useEffect, useMemo, type FormEvent } from 'react'
import { Users, Megaphone, Search, Plus, Trash2 } from 'lucide-react'
import AgentPanel from './AgentPanel'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import { Input, Select, Textarea } from '../ui/Form'
import { useAuthStore, useCandidatiStore, useAnnunciLavoroStore } from '../../store'
import type { CandidatoStato, AnnuncioLavoroStato, Candidato, AnnuncioLavoro } from '../../types'
import toast from 'react-hot-toast'

const CAND_COLORS: Record<CandidatoStato, 'blue' | 'amber' | 'purple' | 'gold' | 'green' | 'red'> = {
  nuovo: 'blue',
  screening: 'amber',
  colloquio: 'purple',
  offerta: 'gold',
  assunto: 'green',
  scartato: 'red',
}
const CAND_LABELS: Record<CandidatoStato, string> = {
  nuovo: 'Nuovo',
  screening: 'Screening',
  colloquio: 'Colloquio',
  offerta: 'Offerta',
  assunto: 'Assunto',
  scartato: 'Scartato',
}
const CAND_STATO_OPTIONS = Object.entries(CAND_LABELS).map(([value, label]) => ({ value, label }))

const ANN_COLORS: Record<AnnuncioLavoroStato, 'gray' | 'green' | 'red'> = {
  bozza: 'gray',
  pubblicato: 'green',
  chiuso: 'red',
}
const ANN_STATO_OPTIONS = [
  { value: 'bozza', label: 'Bozza' },
  { value: 'pubblicato', label: 'Pubblicato' },
  { value: 'chiuso', label: 'Chiuso' },
]

const VALUTAZIONE_OPTIONS = [
  { value: '', label: 'Nessuna' },
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '3', label: '3' },
  { value: '4', label: '4' },
  { value: '5', label: '5' },
]

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

const defaultCandidatoForm = {
  nome: '',
  cognome: '',
  email: '',
  telefono: '',
  ruolo_candidato: '',
  stato: 'nuovo' as CandidatoStato,
  valutazione: '',
  fonte: '',
  note: '',
}

const defaultAnnuncioForm = {
  ruolo: '',
  competenze: '',
  tipo_contratto: '',
  sede: '',
  ral_min: '',
  ral_max: '',
  contenuto: '',
  stato: 'bozza' as AnnuncioLavoroStato,
}

export default function HrPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState('candidati')
  const [search, setSearch] = useState('')
  const profile = useAuthStore((s) => s.profile)
  const { candidati, fetch: fetchCandidati, create: createCandidato, update: updateCandidato, remove: removeCandidato } = useCandidatiStore()
  const { annunci, fetch: fetchAnnunci, create: createAnnuncio, update: updateAnnuncio, remove: removeAnnuncio } = useAnnunciLavoroStore()

  // Candidato CRUD
  const [editCandidato, setEditCandidato] = useState<Candidato | null>(null)
  const [candidatoFormOpen, setCandidatoFormOpen] = useState(false)
  const [candidatoForm, setCandidatoForm] = useState({ ...defaultCandidatoForm })

  // Annuncio CRUD
  const [editAnnuncio, setEditAnnuncio] = useState<AnnuncioLavoro | null>(null)
  const [annuncioFormOpen, setAnnuncioFormOpen] = useState(false)
  const [annuncioForm, setAnnuncioForm] = useState({ ...defaultAnnuncioForm })

  useEffect(() => {
    if (!profile?.azienda_id) return
    fetchCandidati(profile.azienda_id)
    fetchAnnunci(profile.azienda_id)
  }, [profile?.azienda_id])

  const filteredCandidati = useMemo(() => {
    if (!search.trim()) return candidati
    const q = search.toLowerCase()
    return candidati.filter(
      (c) =>
        c.nome.toLowerCase().includes(q) ||
        c.cognome.toLowerCase().includes(q) ||
        (c.ruolo_candidato ?? '').toLowerCase().includes(q)
    )
  }, [candidati, search])

  const filteredAnnunci = useMemo(() => {
    if (!search.trim()) return annunci
    const q = search.toLowerCase()
    return annunci.filter((a) => a.ruolo.toLowerCase().includes(q))
  }, [annunci, search])

  // Candidato handlers
  const openCreateCandidato = () => { setEditCandidato(null); setCandidatoForm({ ...defaultCandidatoForm }); setCandidatoFormOpen(true) }
  const openEditCandidato = (item: Candidato) => {
    setEditCandidato(item)
    setCandidatoForm({
      nome: item.nome,
      cognome: item.cognome,
      email: item.email ?? '',
      telefono: item.telefono ?? '',
      ruolo_candidato: item.ruolo_candidato ?? '',
      stato: item.stato,
      valutazione: item.valutazione?.toString() ?? '',
      fonte: item.fonte ?? '',
      note: item.note ?? '',
    })
    setCandidatoFormOpen(true)
  }
  const handleSaveCandidato = async (e: FormEvent) => {
    e.preventDefault()
    if (!profile?.azienda_id) return
    if (!candidatoForm.nome.trim() || !candidatoForm.cognome.trim()) { toast.error('Nome e cognome obbligatori'); return }
    const payload = {
      nome: candidatoForm.nome.trim(),
      cognome: candidatoForm.cognome.trim(),
      email: candidatoForm.email.trim() || null,
      telefono: candidatoForm.telefono.trim() || null,
      ruolo_candidato: candidatoForm.ruolo_candidato.trim() || null,
      stato: candidatoForm.stato,
      valutazione: candidatoForm.valutazione ? parseInt(candidatoForm.valutazione) : null,
      fonte: candidatoForm.fonte.trim() || null,
      note: candidatoForm.note.trim() || null,
      cv_url: editCandidato?.cv_url ?? null,
      data_candidatura: editCandidato?.data_candidatura ?? new Date().toISOString().slice(0, 10),
    }
    if (editCandidato) {
      await updateCandidato(editCandidato.id, payload)
      toast.success('Candidato aggiornato')
    } else {
      await createCandidato({ ...payload, azienda_id: profile.azienda_id })
      toast.success('Candidato creato')
    }
    setCandidatoFormOpen(false)
  }
  const handleDeleteCandidato = async (id: string) => {
    if (!confirm('Eliminare questo candidato?')) return
    await removeCandidato(id)
    toast.success('Candidato eliminato')
  }

  // Annuncio handlers
  const openCreateAnnuncio = () => { setEditAnnuncio(null); setAnnuncioForm({ ...defaultAnnuncioForm }); setAnnuncioFormOpen(true) }
  const openEditAnnuncio = (item: AnnuncioLavoro) => {
    setEditAnnuncio(item)
    setAnnuncioForm({
      ruolo: item.ruolo,
      competenze: item.competenze ?? '',
      tipo_contratto: item.tipo_contratto ?? '',
      sede: item.sede ?? '',
      ral_min: item.ral_min?.toString() ?? '',
      ral_max: item.ral_max?.toString() ?? '',
      contenuto: item.contenuto,
      stato: item.stato,
    })
    setAnnuncioFormOpen(true)
  }
  const handleSaveAnnuncio = async (e: FormEvent) => {
    e.preventDefault()
    if (!profile?.azienda_id) return
    if (!annuncioForm.ruolo.trim()) { toast.error('Ruolo obbligatorio'); return }
    const payload = {
      ruolo: annuncioForm.ruolo.trim(),
      competenze: annuncioForm.competenze.trim() || null,
      tipo_contratto: annuncioForm.tipo_contratto.trim() || null,
      sede: annuncioForm.sede.trim() || null,
      ral_min: annuncioForm.ral_min ? parseFloat(annuncioForm.ral_min) : null,
      ral_max: annuncioForm.ral_max ? parseFloat(annuncioForm.ral_max) : null,
      contenuto: annuncioForm.contenuto.trim() || '',
      stato: annuncioForm.stato,
    }
    if (editAnnuncio) {
      await updateAnnuncio(editAnnuncio.id, payload)
      toast.success('Annuncio aggiornato')
    } else {
      await createAnnuncio({ ...payload, azienda_id: profile.azienda_id })
      toast.success('Annuncio creato')
    }
    setAnnuncioFormOpen(false)
  }
  const handleDeleteAnnuncio = async (id: string) => {
    if (!confirm('Eliminare questo annuncio?')) return
    await removeAnnuncio(id)
    toast.success('Annuncio eliminato')
  }

  const tabs = [
    { key: 'candidati', label: 'Candidati', icon: Users },
    { key: 'annunci', label: 'Annunci', icon: Megaphone },
  ]

  return (
    <AgentPanel title="HR" color="#7B1FA2" tabs={tabs} activeTab={tab} onTabChange={setTab} onClose={onClose}>
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text3" />
          <input
            type="text"
            placeholder={tab === 'candidati' ? 'Cerca candidati...' : 'Cerca annunci...'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-bg2 border border-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-text placeholder:text-text3 focus:outline-none focus:border-gold/40"
          />
        </div>
        <Button size="sm" variant="primary" onClick={tab === 'candidati' ? openCreateCandidato : openCreateAnnuncio}>
          <Plus size={13} />
        </Button>
      </div>

      {tab === 'candidati' && (
        <div className="space-y-0.5">
          {filteredCandidati.slice(0, 25).map((c) => (
            <div
              key={c.id}
              onClick={() => openEditCandidato(c)}
              className="bg-bg2 border border-border rounded-lg px-2.5 py-2 hover:border-gold/20 transition-colors cursor-pointer group"
            >
              <div className="flex items-center justify-between mb-0.5">
                <p className="text-xs font-medium text-text truncate">{c.nome} {c.cognome}</p>
                <div className="flex items-center gap-1.5">
                  <Badge color={CAND_COLORS[c.stato]}>{CAND_LABELS[c.stato]}</Badge>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteCandidato(c.id) }}
                    className="p-0.5 rounded text-text3 hover:text-red opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-text3">
                {c.ruolo_candidato && <span>{c.ruolo_candidato}</span>}
                <span>{formatDate(c.data_candidatura)}</span>
                {c.valutazione != null && (
                  <span className="text-gold">{'★'.repeat(c.valutazione)}</span>
                )}
              </div>
            </div>
          ))}
          {filteredCandidati.length === 0 && (
            <p className="text-xs text-text3 text-center py-4">Nessun candidato trovato</p>
          )}
        </div>
      )}

      {tab === 'annunci' && (
        <div className="space-y-1">
          {filteredAnnunci.slice(0, 20).map((a) => (
            <div
              key={a.id}
              onClick={() => openEditAnnuncio(a)}
              className="bg-bg2 border border-border rounded-lg px-2.5 py-2 hover:border-gold/20 transition-colors cursor-pointer group"
            >
              <div className="flex items-center justify-between mb-0.5">
                <p className="text-xs font-medium text-text truncate">{a.ruolo}</p>
                <div className="flex items-center gap-1.5">
                  <Badge color={ANN_COLORS[a.stato]}>{a.stato}</Badge>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteAnnuncio(a.id) }}
                    className="p-0.5 rounded text-text3 hover:text-red opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-text3">
                {a.tipo_contratto && <span>{a.tipo_contratto}</span>}
                {a.sede && <span>{a.sede}</span>}
                {(a.ral_min != null || a.ral_max != null) && (
                  <span>
                    RAL: {a.ral_min ? `${(a.ral_min / 1000).toFixed(0)}k` : '?'}-{a.ral_max ? `${(a.ral_max / 1000).toFixed(0)}k` : '?'}
                  </span>
                )}
              </div>
            </div>
          ))}
          {filteredAnnunci.length === 0 && (
            <p className="text-xs text-text3 text-center py-4">Nessun annuncio trovato</p>
          )}
        </div>
      )}

      {/* Candidato Modal */}
      <Modal open={candidatoFormOpen} onClose={() => setCandidatoFormOpen(false)} title={editCandidato ? 'Modifica Candidato' : 'Nuovo Candidato'}>
        <form onSubmit={handleSaveCandidato} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Nome" required value={candidatoForm.nome} onChange={(e) => setCandidatoForm((f) => ({ ...f, nome: e.target.value }))} />
            <Input label="Cognome" required value={candidatoForm.cognome} onChange={(e) => setCandidatoForm((f) => ({ ...f, cognome: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Email" type="email" value={candidatoForm.email} onChange={(e) => setCandidatoForm((f) => ({ ...f, email: e.target.value }))} />
            <Input label="Telefono" value={candidatoForm.telefono} onChange={(e) => setCandidatoForm((f) => ({ ...f, telefono: e.target.value }))} />
          </div>
          <Input label="Ruolo candidato" value={candidatoForm.ruolo_candidato} onChange={(e) => setCandidatoForm((f) => ({ ...f, ruolo_candidato: e.target.value }))} />
          <div className="grid grid-cols-2 gap-3">
            <Select label="Stato" options={CAND_STATO_OPTIONS} value={candidatoForm.stato} onChange={(e) => setCandidatoForm((f) => ({ ...f, stato: e.target.value as CandidatoStato }))} />
            <Select label="Valutazione" options={VALUTAZIONE_OPTIONS} value={candidatoForm.valutazione} onChange={(e) => setCandidatoForm((f) => ({ ...f, valutazione: e.target.value }))} />
          </div>
          <Input label="Fonte" value={candidatoForm.fonte} onChange={(e) => setCandidatoForm((f) => ({ ...f, fonte: e.target.value }))} />
          <Textarea label="Note" value={candidatoForm.note} onChange={(e) => setCandidatoForm((f) => ({ ...f, note: e.target.value }))} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" onClick={() => setCandidatoFormOpen(false)}>Annulla</Button>
            <Button type="submit" variant="primary">Salva</Button>
          </div>
        </form>
      </Modal>

      {/* Annuncio Modal */}
      <Modal open={annuncioFormOpen} onClose={() => setAnnuncioFormOpen(false)} title={editAnnuncio ? 'Modifica Annuncio' : 'Nuovo Annuncio'}>
        <form onSubmit={handleSaveAnnuncio} className="space-y-3">
          <Input label="Ruolo" required value={annuncioForm.ruolo} onChange={(e) => setAnnuncioForm((f) => ({ ...f, ruolo: e.target.value }))} />
          <Input label="Competenze" value={annuncioForm.competenze} onChange={(e) => setAnnuncioForm((f) => ({ ...f, competenze: e.target.value }))} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Tipo contratto" value={annuncioForm.tipo_contratto} onChange={(e) => setAnnuncioForm((f) => ({ ...f, tipo_contratto: e.target.value }))} />
            <Input label="Sede" value={annuncioForm.sede} onChange={(e) => setAnnuncioForm((f) => ({ ...f, sede: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="RAL Min" type="number" value={annuncioForm.ral_min} onChange={(e) => setAnnuncioForm((f) => ({ ...f, ral_min: e.target.value }))} />
            <Input label="RAL Max" type="number" value={annuncioForm.ral_max} onChange={(e) => setAnnuncioForm((f) => ({ ...f, ral_max: e.target.value }))} />
          </div>
          <Textarea label="Contenuto" value={annuncioForm.contenuto} onChange={(e) => setAnnuncioForm((f) => ({ ...f, contenuto: e.target.value }))} />
          <Select label="Stato" options={ANN_STATO_OPTIONS} value={annuncioForm.stato} onChange={(e) => setAnnuncioForm((f) => ({ ...f, stato: e.target.value as AnnuncioLavoroStato }))} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" onClick={() => setAnnuncioFormOpen(false)}>Annulla</Button>
            <Button type="submit" variant="primary">Salva</Button>
          </div>
        </form>
      </Modal>
    </AgentPanel>
  )
}
