import { useState, useEffect, useMemo, type FormEvent } from 'react'
import { Plus, Search, Pencil, Trash2, ChevronRight, Building2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore, useFornitoriStore, useFatturePassiveStore } from '../../store'
import Table, { type Column } from '../../components/ui/Table'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import Modal from '../../components/ui/Modal'
import { Input, Textarea } from '../../components/ui/Form'
import type { Fornitore, FatturaPassiva } from '../../types'

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n)
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString('it-IT')
}

interface FornitoreForm {
  ragione_sociale: string
  piva: string
  email: string
  telefono: string
  indirizzo: string
  cap: string
  citta: string
  provincia: string
  iban: string
  note: string
}

const emptyForm: FornitoreForm = {
  ragione_sociale: '',
  piva: '',
  email: '',
  telefono: '',
  indirizzo: '',
  cap: '',
  citta: '',
  provincia: '',
  iban: '',
  note: '',
}

export default function Fornitori() {
  const profile = useAuthStore((s) => s.profile)
  const { fornitori, loading, fetch, create, update, remove } = useFornitoriStore()
  const { fatturePassive, fetch: fetchFP } = useFatturePassiveStore()
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FornitoreForm>(emptyForm)

  useEffect(() => {
    if (profile?.azienda_id) {
      fetch(profile.azienda_id)
      fetchFP(profile.azienda_id)
    }
  }, [profile?.azienda_id, fetch, fetchFP])

  const spesaPerFornitore = useMemo(() => {
    const map = new Map<string, number>()
    const currentYear = new Date().getFullYear()
    for (const fp of fatturePassive) {
      if (fp.data.startsWith(String(currentYear))) {
        map.set(fp.fornitore_id, (map.get(fp.fornitore_id) ?? 0) + fp.totale)
      }
    }
    return map
  }, [fatturePassive])

  const filtered = useMemo(() => {
    if (!search.trim()) return fornitori
    const q = search.toLowerCase()
    return fornitori.filter(
      (f) =>
        f.ragione_sociale.toLowerCase().includes(q) ||
        (f.piva ?? '').toLowerCase().includes(q) ||
        (f.email ?? '').toLowerCase().includes(q)
    )
  }, [fornitori, search])

  const openNew = () => {
    setForm(emptyForm)
    setEditingId(null)
    setModalOpen(true)
  }

  const openEdit = (f: Fornitore) => {
    setForm({
      ragione_sociale: f.ragione_sociale,
      piva: f.piva ?? '',
      email: f.email ?? '',
      telefono: f.telefono ?? '',
      indirizzo: f.indirizzo ?? '',
      cap: f.cap ?? '',
      citta: f.citta ?? '',
      provincia: f.provincia ?? '',
      iban: f.iban ?? '',
      note: f.note ?? '',
    })
    setEditingId(f.id)
    setModalOpen(true)
  }

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    if (!profile?.azienda_id) return
    const payload = {
      azienda_id: profile.azienda_id,
      ragione_sociale: form.ragione_sociale,
      piva: form.piva || null,
      email: form.email || null,
      telefono: form.telefono || null,
      indirizzo: form.indirizzo || null,
      cap: form.cap || null,
      citta: form.citta || null,
      provincia: form.provincia || null,
      iban: form.iban || null,
      note: form.note || null,
    }
    if (editingId) {
      await update(editingId, payload)
      toast.success('Fornitore aggiornato')
    } else {
      const created = await create(payload)
      if (created) toast.success('Fornitore creato')
      else toast.error('Errore nella creazione')
    }
    setModalOpen(false)
  }

  const handleDelete = async (f: Fornitore) => {
    if (!confirm(`Eliminare il fornitore ${f.ragione_sociale}?`)) return
    await remove(f.id)
    toast.success('Fornitore eliminato')
  }

  const detailFornitore = useMemo(() => {
    if (!detailId) return null
    return fornitori.find((f) => f.id === detailId) ?? null
  }, [detailId, fornitori])

  const detailFatture = useMemo(() => {
    if (!detailId) return []
    return fatturePassive.filter((fp) => fp.fornitore_id === detailId)
  }, [detailId, fatturePassive])

  const columns: Column<Fornitore>[] = [
    {
      key: 'nome',
      header: 'Nome',
      render: (f) => (
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gold/10 flex items-center justify-center flex-shrink-0">
            <Building2 size={14} className="text-gold" />
          </div>
          <span className="font-medium">{f.ragione_sociale}</span>
        </div>
      ),
    },
    {
      key: 'piva',
      header: 'P.IVA',
      render: (f) => <span className="text-text2 font-mono text-xs">{f.piva ?? '-'}</span>,
    },
    {
      key: 'email',
      header: 'Email',
      render: (f) => <span className="text-text2">{f.email ?? '-'}</span>,
    },
    {
      key: 'iban',
      header: 'IBAN',
      render: (f) => <span className="text-text2 font-mono text-xs truncate max-w-[180px] block">{f.iban ?? '-'}</span>,
    },
    {
      key: 'spesa_ytd',
      header: 'Spesa YTD',
      render: (f) => (
        <span className="font-mono font-medium">
          {formatCurrency(spesaPerFornitore.get(f.id) ?? 0)}
        </span>
      ),
    },
    {
      key: 'azioni',
      header: '',
      render: (f) => (
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); setDetailId(f.id) }}
            className="p-1.5 rounded-lg text-text3 hover:text-gold hover:bg-bg3 transition-colors"
            title="Dettagli"
          >
            <ChevronRight size={15} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); openEdit(f) }}
            className="p-1.5 rounded-lg text-text3 hover:text-blue hover:bg-bg3 transition-colors"
            title="Modifica"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleDelete(f) }}
            className="p-1.5 rounded-lg text-text3 hover:text-red hover:bg-bg3 transition-colors"
            title="Elimina"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ),
    },
  ]

  const fpColumns: Column<FatturaPassiva>[] = [
    { key: 'numero', header: 'Numero', render: (fp) => <span className="font-medium">{fp.numero}</span> },
    { key: 'data', header: 'Data', render: (fp) => <span className="text-text2">{formatDate(fp.data)}</span> },
    { key: 'totale', header: 'Totale', render: (fp) => <span className="font-mono">{formatCurrency(fp.totale)}</span> },
    {
      key: 'stato', header: 'Stato', render: (fp) => {
        const colors: Record<string, 'red' | 'green' | 'amber'> = { da_pagare: 'red', pagata: 'green', contestata: 'amber' }
        const labels: Record<string, string> = { da_pagare: 'Da Pagare', pagata: 'Pagata', contestata: 'Contestata' }
        return <Badge color={colors[fp.stato]}>{labels[fp.stato]}</Badge>
      }
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold text-text">Fornitori</h1>
        <Button variant="primary" onClick={openNew}>
          <Plus size={16} />
          Nuovo Fornitore
        </Button>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex-1 max-w-sm">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text3" />
            <input
              type="text"
              placeholder="Cerca per nome, P.IVA o email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-bg3 border border-border text-text text-sm placeholder:text-text3 focus:outline-none focus:ring-1 focus:ring-gold/50 focus:border-gold/50 transition-colors"
            />
          </div>
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
          keyExtractor={(f) => f.id}
          emptyMessage="Nessun fornitore trovato."
          onRowClick={(f) => setDetailId(f.id)}
        />
      )}

      {/* New/Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? 'Modifica Fornitore' : 'Nuovo Fornitore'}
        className="max-w-lg"
      >
        <form onSubmit={handleSave} className="space-y-4">
          <Input
            label="Ragione Sociale"
            value={form.ragione_sociale}
            onChange={(e) => setForm((p) => ({ ...p, ragione_sociale: e.target.value }))}
            required
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="P.IVA"
              value={form.piva}
              onChange={(e) => setForm((p) => ({ ...p, piva: e.target.value }))}
            />
            <Input
              label="Email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Telefono"
              value={form.telefono}
              onChange={(e) => setForm((p) => ({ ...p, telefono: e.target.value }))}
            />
            <Input
              label="IBAN"
              value={form.iban}
              onChange={(e) => setForm((p) => ({ ...p, iban: e.target.value }))}
            />
          </div>
          <Input
            label="Indirizzo"
            value={form.indirizzo}
            onChange={(e) => setForm((p) => ({ ...p, indirizzo: e.target.value }))}
          />
          <div className="grid grid-cols-3 gap-4">
            <Input
              label="CAP"
              value={form.cap}
              onChange={(e) => setForm((p) => ({ ...p, cap: e.target.value }))}
            />
            <Input
              label="Citta"
              value={form.citta}
              onChange={(e) => setForm((p) => ({ ...p, citta: e.target.value }))}
            />
            <Input
              label="Provincia"
              value={form.provincia}
              onChange={(e) => setForm((p) => ({ ...p, provincia: e.target.value }))}
            />
          </div>
          <Textarea
            label="Note"
            value={form.note}
            onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))}
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" onClick={() => setModalOpen(false)}>Annulla</Button>
            <Button type="submit" variant="primary">
              {editingId ? 'Aggiorna' : 'Crea'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Detail Modal */}
      <Modal
        open={!!detailId}
        onClose={() => setDetailId(null)}
        title={detailFornitore ? `Dettaglio - ${detailFornitore.ragione_sociale}` : 'Dettaglio Fornitore'}
        className="max-w-2xl"
      >
        {detailFornitore && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-text3 uppercase tracking-wider mb-1">P.IVA</p>
                <p className="text-text font-mono">{detailFornitore.piva ?? '-'}</p>
              </div>
              <div>
                <p className="text-xs text-text3 uppercase tracking-wider mb-1">Email</p>
                <p className="text-text">{detailFornitore.email ?? '-'}</p>
              </div>
              <div>
                <p className="text-xs text-text3 uppercase tracking-wider mb-1">Telefono</p>
                <p className="text-text">{detailFornitore.telefono ?? '-'}</p>
              </div>
              <div>
                <p className="text-xs text-text3 uppercase tracking-wider mb-1">IBAN</p>
                <p className="text-text font-mono text-xs">{detailFornitore.iban ?? '-'}</p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-text3 uppercase tracking-wider mb-1">Indirizzo</p>
                <p className="text-text">
                  {[detailFornitore.indirizzo, detailFornitore.cap, detailFornitore.citta, detailFornitore.provincia ? `(${detailFornitore.provincia})` : '']
                    .filter(Boolean)
                    .join(', ') || '-'}
                </p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-text3 uppercase tracking-wider mb-1">Spesa Anno Corrente</p>
                <p className="text-2xl font-bold text-gold font-mono">
                  {formatCurrency(spesaPerFornitore.get(detailFornitore.id) ?? 0)}
                </p>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-text mb-3">Fatture Passive</h3>
              <Table
                columns={fpColumns}
                data={detailFatture}
                keyExtractor={(fp) => fp.id}
                emptyMessage="Nessuna fattura passiva per questo fornitore."
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
