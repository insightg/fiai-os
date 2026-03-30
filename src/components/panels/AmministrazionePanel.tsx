import { useState, useEffect, useMemo, type FormEvent } from 'react'
import { FileText, Clock, Landmark, Wallet, CheckCircle, XCircle, Plus, Trash2 } from 'lucide-react'
import AgentPanel from './AgentPanel'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import { Input, Select, Textarea } from '../ui/Form'
import {
  useAuthStore,
  useFattureStore,
  useFatturePassiveStore,
  useContiStore,
  useRimborsiStore,
  useFornitoriStore,
} from '../../store'
import type { FatturaStato, FatturaPassivaStato, RimborsoStato, FatturaPassiva, Conto, Rimborso, TipoConto } from '../../types'
import toast from 'react-hot-toast'

const FATTURA_COLORS: Record<FatturaStato, 'gray' | 'blue' | 'gold' | 'green' | 'red' | 'purple'> = {
  bozza: 'gray',
  emessa: 'blue',
  inviata_sdi: 'gold',
  pagata: 'green',
  scaduta: 'red',
  stornata: 'purple',
}

const FP_COLORS: Record<FatturaPassivaStato, 'red' | 'green' | 'amber'> = {
  da_pagare: 'red',
  pagata: 'green',
  contestata: 'amber',
}
const FP_STATO_OPTIONS = [
  { value: 'da_pagare', label: 'Da pagare' },
  { value: 'pagata', label: 'Pagata' },
  { value: 'contestata', label: 'Contestata' },
]

const RIMBORSO_COLORS: Record<RimborsoStato, 'blue' | 'green' | 'red' | 'amber'> = {
  richiesto: 'blue',
  approvato: 'green',
  rifiutato: 'red',
  rimborsato: 'amber',
}

const TIPO_CONTO_OPTIONS = [
  { value: 'banca', label: 'Banca' },
  { value: 'cassa', label: 'Cassa' },
  { value: 'carta', label: 'Carta' },
]

function formatEuro(n: number): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

function formatDate(d: string | null): string {
  if (!d) return '-'
  return new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

const defaultFPForm = {
  fornitore_id: '',
  numero: '',
  data: '',
  scadenza: '',
  imponibile: '',
  iva: '',
  totale: '',
  stato: 'da_pagare' as FatturaPassivaStato,
  note: '',
}

const defaultContoForm = {
  nome: '',
  tipo: 'banca' as TipoConto,
  saldo: '',
  iban: '',
  banca: '',
}

const defaultRimborsoForm = {
  descrizione: '',
  importo: '',
  data_spesa: '',
  categoria: '',
  note: '',
}

export default function AmministrazionePanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState('fatture')
  const profile = useAuthStore((s) => s.profile)
  const user = useAuthStore((s) => s.user)
  const { fatture, fetch: fetchFatture } = useFattureStore()
  const { fatturePassive, fetch: fetchFP, create: createFP, update: updateFP, remove: removeFP } = useFatturePassiveStore()
  const { conti, fetchConti, createConto, updateConto, removeConto } = useContiStore()
  const { rimborsi, fetch: fetchRimborsi, create: createRimborso, update: updateRimborso, remove: removeRimborso, approve, reject } = useRimborsiStore()
  const { fornitori, fetch: fetchFornitori } = useFornitoriStore()

  // FP CRUD
  const [editFP, setEditFP] = useState<FatturaPassiva | null>(null)
  const [fpFormOpen, setFpFormOpen] = useState(false)
  const [fpForm, setFpForm] = useState({ ...defaultFPForm })

  // Conto CRUD
  const [editConto, setEditConto] = useState<Conto | null>(null)
  const [contoFormOpen, setContoFormOpen] = useState(false)
  const [contoForm, setContoForm] = useState({ ...defaultContoForm })

  // Rimborso CRUD
  const [editRimborso, setEditRimborso] = useState<Rimborso | null>(null)
  const [rimborsoFormOpen, setRimborsoFormOpen] = useState(false)
  const [rimborsoForm, setRimborsoForm] = useState({ ...defaultRimborsoForm })

  useEffect(() => {
    if (!profile?.azienda_id) return
    const aid = profile.azienda_id
    fetchFatture(aid)
    fetchFP(aid)
    fetchConti(aid)
    fetchRimborsi(aid)
    fetchFornitori(aid)
  }, [profile?.azienda_id])

  // Scadenze
  const scadenze = useMemo(() => {
    const now = new Date()
    const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    const fattureScad = fatture
      .filter((f) => f.scadenza && ['emessa', 'inviata_sdi'].includes(f.stato))
      .filter((f) => new Date(f.scadenza!) <= in30)
      .sort((a, b) => new Date(a.scadenza!).getTime() - new Date(b.scadenza!).getTime())
    const fpScad = fatturePassive
      .filter((f) => f.scadenza && f.stato === 'da_pagare')
      .filter((f) => new Date(f.scadenza!) <= in30)
      .sort((a, b) => new Date(a.scadenza!).getTime() - new Date(b.scadenza!).getTime())
    return { attive: fattureScad, passive: fpScad }
  }, [fatture, fatturePassive])

  const fornitoriOptions = useMemo(
    () => fornitori.map((f) => ({ value: f.id, label: f.ragione_sociale })),
    [fornitori]
  )

  // FP handlers
  const openCreateFP = () => { setEditFP(null); setFpForm({ ...defaultFPForm }); setFpFormOpen(true) }
  const openEditFP = (item: FatturaPassiva) => {
    setEditFP(item)
    setFpForm({
      fornitore_id: item.fornitore_id,
      numero: item.numero,
      data: item.data,
      scadenza: item.scadenza ?? '',
      imponibile: item.imponibile.toString(),
      iva: item.iva.toString(),
      totale: item.totale.toString(),
      stato: item.stato,
      note: item.note ?? '',
    })
    setFpFormOpen(true)
  }
  const handleSaveFP = async (e: FormEvent) => {
    e.preventDefault()
    if (!profile?.azienda_id) return
    if (!fpForm.numero.trim()) { toast.error('Numero obbligatorio'); return }
    const payload = {
      fornitore_id: fpForm.fornitore_id,
      numero: fpForm.numero.trim(),
      data: fpForm.data || new Date().toISOString().slice(0, 10),
      scadenza: fpForm.scadenza || null,
      imponibile: parseFloat(fpForm.imponibile) || 0,
      iva: parseFloat(fpForm.iva) || 0,
      totale: parseFloat(fpForm.totale) || 0,
      stato: fpForm.stato,
      note: fpForm.note.trim() || null,
      pagata_il: editFP?.pagata_il ?? null,
      file_url: editFP?.file_url ?? null,
    }
    if (editFP) {
      await updateFP(editFP.id, payload)
      toast.success('Fattura passiva aggiornata')
    } else {
      await createFP({ ...payload, azienda_id: profile.azienda_id })
      toast.success('Fattura passiva creata')
    }
    setFpFormOpen(false)
  }
  const handleDeleteFP = async (id: string) => {
    if (!confirm('Eliminare questa fattura passiva?')) return
    await removeFP(id)
    toast.success('Fattura passiva eliminata')
  }

  // Conto handlers
  const openCreateConto = () => { setEditConto(null); setContoForm({ ...defaultContoForm }); setContoFormOpen(true) }
  const openEditConto = (item: Conto) => {
    setEditConto(item)
    setContoForm({
      nome: item.nome,
      tipo: item.tipo,
      saldo: item.saldo.toString(),
      iban: item.iban ?? '',
      banca: item.banca ?? '',
    })
    setContoFormOpen(true)
  }
  const handleSaveConto = async (e: FormEvent) => {
    e.preventDefault()
    if (!profile?.azienda_id) return
    if (!contoForm.nome.trim()) { toast.error('Nome obbligatorio'); return }
    const payload = {
      nome: contoForm.nome.trim(),
      tipo: contoForm.tipo,
      saldo: parseFloat(contoForm.saldo) || 0,
      iban: contoForm.iban.trim() || null,
      banca: contoForm.banca.trim() || null,
      colore: editConto?.colore ?? null,
    }
    if (editConto) {
      await updateConto(editConto.id, payload)
      toast.success('Conto aggiornato')
    } else {
      await createConto({ ...payload, azienda_id: profile.azienda_id })
      toast.success('Conto creato')
    }
    setContoFormOpen(false)
  }
  const handleDeleteConto = async (id: string) => {
    if (!confirm('Eliminare questo conto?')) return
    await removeConto(id)
    toast.success('Conto eliminato')
  }

  // Rimborso handlers
  const openCreateRimborso = () => { setEditRimborso(null); setRimborsoForm({ ...defaultRimborsoForm }); setRimborsoFormOpen(true) }
  const openEditRimborso = (item: Rimborso) => {
    setEditRimborso(item)
    setRimborsoForm({
      descrizione: item.descrizione,
      importo: item.importo.toString(),
      data_spesa: item.data_spesa,
      categoria: item.categoria ?? '',
      note: item.note ?? '',
    })
    setRimborsoFormOpen(true)
  }
  const handleSaveRimborso = async (e: FormEvent) => {
    e.preventDefault()
    if (!profile?.azienda_id || !user) return
    if (!rimborsoForm.descrizione.trim()) { toast.error('Descrizione obbligatoria'); return }
    const payload = {
      descrizione: rimborsoForm.descrizione.trim(),
      importo: parseFloat(rimborsoForm.importo) || 0,
      data_spesa: rimborsoForm.data_spesa || new Date().toISOString().slice(0, 10),
      categoria: rimborsoForm.categoria.trim() || null,
      note: rimborsoForm.note.trim() || null,
    }
    if (editRimborso) {
      await updateRimborso(editRimborso.id, payload)
      toast.success('Rimborso aggiornato')
    } else {
      await createRimborso({
        ...payload,
        azienda_id: profile.azienda_id,
        richiedente_id: user.id,
        stato: 'richiesto',
        allegato_url: null,
        approvato_da: null,
        approvato_il: null,
      })
      toast.success('Rimborso creato')
    }
    setRimborsoFormOpen(false)
  }
  const handleDeleteRimborso = async (id: string) => {
    if (!confirm('Eliminare questo rimborso?')) return
    await removeRimborso(id)
    toast.success('Rimborso eliminato')
  }

  const tabs = [
    { key: 'fatture', label: 'Fatture', icon: FileText },
    { key: 'scadenze', label: 'Scadenze', icon: Clock },
    { key: 'conti', label: 'Conti', icon: Landmark },
    { key: 'rimborsi', label: 'Rimborsi', icon: Wallet },
  ]

  return (
    <AgentPanel title="Amministrazione" color="#2D8B56" tabs={tabs} activeTab={tab} onTabChange={setTab} onClose={onClose}>
      {tab === 'fatture' && (
        <div className="space-y-3">
          <SectionLabel label="Fatture Attive" />
          <div className="space-y-0.5">
            {fatture.slice(0, 15).map((f) => (
              <div key={f.id} className="flex items-center justify-between bg-bg2 border border-border rounded-lg px-2.5 py-1.5">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-text">#{f.numero}</p>
                  <p className="text-[10px] text-text3">{formatDate(f.data)} &middot; {f.cliente?.nome ?? '-'}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-text2">{formatEuro(f.totale)}</span>
                  <Badge color={FATTURA_COLORS[f.stato]}>{f.stato}</Badge>
                </div>
              </div>
            ))}
            {fatture.length === 0 && <Empty />}
          </div>

          <div className="flex items-center justify-between">
            <SectionLabel label="Fatture Passive" />
            <Button size="sm" variant="primary" onClick={openCreateFP}>
              <Plus size={13} />
            </Button>
          </div>
          <div className="space-y-0.5">
            {fatturePassive.slice(0, 10).map((f) => (
              <div
                key={f.id}
                onClick={() => openEditFP(f)}
                className="flex items-center justify-between bg-bg2 border border-border rounded-lg px-2.5 py-1.5 cursor-pointer hover:border-gold/20 transition-colors group"
              >
                <div className="min-w-0">
                  <p className="text-xs font-medium text-text">#{f.numero}</p>
                  <p className="text-[10px] text-text3">{formatDate(f.data)} &middot; {f.fornitore?.ragione_sociale ?? '-'}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-text2">{formatEuro(f.totale)}</span>
                  <Badge color={FP_COLORS[f.stato]}>{f.stato}</Badge>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteFP(f.id) }}
                    className="p-0.5 rounded text-text3 hover:text-red opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            ))}
            {fatturePassive.length === 0 && <Empty />}
          </div>
        </div>
      )}

      {tab === 'scadenze' && (
        <div className="space-y-3">
          <SectionLabel label="Fatture Attive in Scadenza" />
          {scadenze.attive.length === 0 && <p className="text-xs text-text3 text-center py-3">Nessuna scadenza nei prossimi 30 giorni</p>}
          <div className="space-y-0.5">
            {scadenze.attive.map((f) => (
              <div key={f.id} className="flex items-center justify-between bg-bg2 border border-border rounded-lg px-2.5 py-1.5">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-text">#{f.numero} &middot; {f.cliente?.nome ?? '-'}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-text2">{formatEuro(f.totale)}</span>
                  <span className="text-[10px] text-amber font-medium">{formatDate(f.scadenza)}</span>
                </div>
              </div>
            ))}
          </div>

          <SectionLabel label="Fatture Passive in Scadenza" />
          {scadenze.passive.length === 0 && <p className="text-xs text-text3 text-center py-3">Nessuna scadenza</p>}
          <div className="space-y-0.5">
            {scadenze.passive.map((f) => (
              <div key={f.id} className="flex items-center justify-between bg-bg2 border border-border rounded-lg px-2.5 py-1.5">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-text">#{f.numero}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-text2">{formatEuro(f.totale)}</span>
                  <span className="text-[10px] text-red font-medium">{formatDate(f.scadenza)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'conti' && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <SectionLabel label="Conti" />
            <Button size="sm" variant="primary" onClick={openCreateConto}>
              <Plus size={13} />
            </Button>
          </div>
          <div className="space-y-1">
            {conti.map((c) => (
              <div
                key={c.id}
                onClick={() => openEditConto(c)}
                className="bg-bg2 border border-border rounded-lg px-3 py-2.5 cursor-pointer hover:border-gold/20 transition-colors group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {c.colore && <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c.colore }} />}
                    <span className="text-xs font-medium text-text">{c.nome}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge color={c.tipo === 'banca' ? 'blue' : c.tipo === 'cassa' ? 'green' : 'amber'}>{c.tipo}</Badge>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteConto(c.id) }}
                      className="p-0.5 rounded text-text3 hover:text-red opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
                <p className="text-lg font-bold text-text mt-1">{formatEuro(c.saldo)}</p>
                {c.iban && <p className="text-[10px] text-text3 mt-0.5 font-mono">{c.iban}</p>}
              </div>
            ))}
            {conti.length === 0 && <Empty />}
            <div className="bg-bg2 border border-border rounded-lg px-3 py-2.5 mt-2">
              <span className="text-xs font-semibold text-text2">Saldo totale</span>
              <p className="text-lg font-bold text-text">
                {formatEuro(conti.reduce((a, c) => a + c.saldo, 0))}
              </p>
            </div>
          </div>
        </div>
      )}

      {tab === 'rimborsi' && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <SectionLabel label="Rimborsi" />
            <Button size="sm" variant="primary" onClick={openCreateRimborso}>
              <Plus size={13} />
            </Button>
          </div>
          <div className="space-y-1">
            {rimborsi.slice(0, 20).map((r) => (
              <div
                key={r.id}
                onClick={() => openEditRimborso(r)}
                className="bg-bg2 border border-border rounded-lg px-2.5 py-2 cursor-pointer hover:border-gold/20 transition-colors group"
              >
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-medium text-text truncate flex-1 mr-2">{r.descrizione}</p>
                  <Badge color={RIMBORSO_COLORS[r.stato]}>{r.stato}</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-text3">{formatDate(r.data_spesa)} &middot; {r.categoria ?? '-'}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-text">{formatEuro(r.importo)}</span>
                    {r.stato === 'richiesto' && (
                      <div className="flex gap-1">
                        <button
                          onClick={async (e) => {
                            e.stopPropagation()
                            if (!user) return
                            await approve(r.id, user.id)
                            toast.success('Rimborso approvato')
                          }}
                          className="p-1 rounded text-green hover:bg-green/10 transition-colors"
                          title="Approva"
                        >
                          <CheckCircle size={14} />
                        </button>
                        <button
                          onClick={async (e) => {
                            e.stopPropagation()
                            if (!user) return
                            await reject(r.id, user.id, '')
                            toast.success('Rimborso rifiutato')
                          }}
                          className="p-1 rounded text-red hover:bg-red/10 transition-colors"
                          title="Rifiuta"
                        >
                          <XCircle size={14} />
                        </button>
                      </div>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteRimborso(r.id) }}
                      className="p-0.5 rounded text-text3 hover:text-red opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {rimborsi.length === 0 && <Empty />}
          </div>
        </div>
      )}

      {/* Fattura Passiva Modal */}
      <Modal open={fpFormOpen} onClose={() => setFpFormOpen(false)} title={editFP ? 'Modifica Fattura Passiva' : 'Nuova Fattura Passiva'}>
        <form onSubmit={handleSaveFP} className="space-y-3">
          {fornitoriOptions.length > 0 && (
            <Select label="Fornitore" options={[{ value: '', label: '-- Seleziona --' }, ...fornitoriOptions]} value={fpForm.fornitore_id} onChange={(e) => setFpForm((f) => ({ ...f, fornitore_id: e.target.value }))} />
          )}
          <div className="grid grid-cols-2 gap-3">
            <Input label="Numero" required value={fpForm.numero} onChange={(e) => setFpForm((f) => ({ ...f, numero: e.target.value }))} />
            <Input label="Data" type="date" value={fpForm.data} onChange={(e) => setFpForm((f) => ({ ...f, data: e.target.value }))} />
          </div>
          <Input label="Scadenza" type="date" value={fpForm.scadenza} onChange={(e) => setFpForm((f) => ({ ...f, scadenza: e.target.value }))} />
          <div className="grid grid-cols-3 gap-3">
            <Input label="Imponibile" type="number" value={fpForm.imponibile} onChange={(e) => setFpForm((f) => ({ ...f, imponibile: e.target.value }))} />
            <Input label="IVA" type="number" value={fpForm.iva} onChange={(e) => setFpForm((f) => ({ ...f, iva: e.target.value }))} />
            <Input label="Totale" type="number" value={fpForm.totale} onChange={(e) => setFpForm((f) => ({ ...f, totale: e.target.value }))} />
          </div>
          <Select label="Stato" options={FP_STATO_OPTIONS} value={fpForm.stato} onChange={(e) => setFpForm((f) => ({ ...f, stato: e.target.value as FatturaPassivaStato }))} />
          <Textarea label="Note" value={fpForm.note} onChange={(e) => setFpForm((f) => ({ ...f, note: e.target.value }))} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" onClick={() => setFpFormOpen(false)}>Annulla</Button>
            <Button type="submit" variant="primary">Salva</Button>
          </div>
        </form>
      </Modal>

      {/* Conto Modal */}
      <Modal open={contoFormOpen} onClose={() => setContoFormOpen(false)} title={editConto ? 'Modifica Conto' : 'Nuovo Conto'}>
        <form onSubmit={handleSaveConto} className="space-y-3">
          <Input label="Nome" required value={contoForm.nome} onChange={(e) => setContoForm((f) => ({ ...f, nome: e.target.value }))} />
          <Select label="Tipo" options={TIPO_CONTO_OPTIONS} value={contoForm.tipo} onChange={(e) => setContoForm((f) => ({ ...f, tipo: e.target.value as TipoConto }))} />
          <Input label="Saldo" type="number" value={contoForm.saldo} onChange={(e) => setContoForm((f) => ({ ...f, saldo: e.target.value }))} />
          <Input label="IBAN" value={contoForm.iban} onChange={(e) => setContoForm((f) => ({ ...f, iban: e.target.value }))} />
          <Input label="Banca" value={contoForm.banca} onChange={(e) => setContoForm((f) => ({ ...f, banca: e.target.value }))} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" onClick={() => setContoFormOpen(false)}>Annulla</Button>
            <Button type="submit" variant="primary">Salva</Button>
          </div>
        </form>
      </Modal>

      {/* Rimborso Modal */}
      <Modal open={rimborsoFormOpen} onClose={() => setRimborsoFormOpen(false)} title={editRimborso ? 'Modifica Rimborso' : 'Nuovo Rimborso'}>
        <form onSubmit={handleSaveRimborso} className="space-y-3">
          <Input label="Descrizione" required value={rimborsoForm.descrizione} onChange={(e) => setRimborsoForm((f) => ({ ...f, descrizione: e.target.value }))} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Importo" type="number" required value={rimborsoForm.importo} onChange={(e) => setRimborsoForm((f) => ({ ...f, importo: e.target.value }))} />
            <Input label="Data Spesa" type="date" value={rimborsoForm.data_spesa} onChange={(e) => setRimborsoForm((f) => ({ ...f, data_spesa: e.target.value }))} />
          </div>
          <Input label="Categoria" value={rimborsoForm.categoria} onChange={(e) => setRimborsoForm((f) => ({ ...f, categoria: e.target.value }))} />
          <Textarea label="Note" value={rimborsoForm.note} onChange={(e) => setRimborsoForm((f) => ({ ...f, note: e.target.value }))} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" onClick={() => setRimborsoFormOpen(false)}>Annulla</Button>
            <Button type="submit" variant="primary">Salva</Button>
          </div>
        </form>
      </Modal>
    </AgentPanel>
  )
}

function SectionLabel({ label }: { label: string }) {
  return (
    <p className="text-[10px] font-semibold text-text3 uppercase tracking-wider">{label}</p>
  )
}

function Empty() {
  return <p className="text-xs text-text3 text-center py-3">Nessun dato</p>
}
