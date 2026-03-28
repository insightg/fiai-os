import { useState, useEffect, useMemo, type FormEvent } from 'react'
import { Plus, Search, Filter, Pencil, Trash2, Upload } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore, useFatturePassiveStore, useFornitoriStore } from '../../store'
import Table, { type Column } from '../../components/ui/Table'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import Modal from '../../components/ui/Modal'
import { Input, Select, Textarea } from '../../components/ui/Form'
import StatCard from '../../components/ui/StatCard'
import { FileText, CreditCard, AlertTriangle } from 'lucide-react'
import UploadFatturaModal from './UploadFatturaModal'
import type { FatturaPassiva, FatturaPassivaStato } from '../../types'

const statoColors: Record<FatturaPassivaStato, 'red' | 'green' | 'amber'> = {
  da_pagare: 'red',
  pagata: 'green',
  contestata: 'amber',
}

const statoLabels: Record<FatturaPassivaStato, string> = {
  da_pagare: 'Da Pagare',
  pagata: 'Pagata',
  contestata: 'Contestata',
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n)
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString('it-IT')
}

interface FatturaPassivaForm {
  fornitore_id: string
  numero: string
  data: string
  scadenza: string
  stato: FatturaPassivaStato
  imponibile: number
  iva: number
  totale: number
  pagata_il: string
  note: string
}

const emptyForm: FatturaPassivaForm = {
  fornitore_id: '',
  numero: '',
  data: new Date().toISOString().split('T')[0],
  scadenza: '',
  stato: 'da_pagare',
  imponibile: 0,
  iva: 0,
  totale: 0,
  pagata_il: '',
  note: '',
}

export default function FatturePassive() {
  const profile = useAuthStore((s) => s.profile)
  const { fatturePassive, loading, fetch, create, update, remove } = useFatturePassiveStore()
  const { fornitori, fetch: fetchFornitori } = useFornitoriStore()
  const [search, setSearch] = useState('')
  const [filterStato, setFilterStato] = useState<string>('tutti')
  const [modalOpen, setModalOpen] = useState(false)
  const [uploadModalOpen, setUploadModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FatturaPassivaForm>(emptyForm)

  useEffect(() => {
    if (profile?.azienda_id) {
      fetch(profile.azienda_id)
      fetchFornitori(profile.azienda_id)
    }
  }, [profile?.azienda_id, fetch, fetchFornitori])

  const filtered = useMemo(() => {
    let result = fatturePassive
    if (filterStato !== 'tutti') {
      result = result.filter((fp) => fp.stato === filterStato)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(
        (fp) =>
          fp.numero.toLowerCase().includes(q) ||
          (fp.fornitore?.ragione_sociale ?? '').toLowerCase().includes(q)
      )
    }
    return result
  }, [fatturePassive, filterStato, search])

  const stats = useMemo(() => {
    const totale = fatturePassive.reduce((acc, fp) => acc + fp.totale, 0)
    const daPagare = fatturePassive.filter((fp) => fp.stato === 'da_pagare').reduce((acc, fp) => acc + fp.totale, 0)
    const contestate = fatturePassive.filter((fp) => fp.stato === 'contestata').length
    return { totale, daPagare, contestate }
  }, [fatturePassive])

  const handleImponibileChange = (imponibile: number) => {
    const ivaPercent = 22
    const iva = Math.round(imponibile * (ivaPercent / 100) * 100) / 100
    setForm((p) => ({ ...p, imponibile, iva, totale: Math.round((imponibile + iva) * 100) / 100 }))
  }

  const openNew = () => {
    setForm(emptyForm)
    setEditingId(null)
    setModalOpen(true)
  }

  const openEdit = (fp: FatturaPassiva) => {
    setForm({
      fornitore_id: fp.fornitore_id,
      numero: fp.numero,
      data: fp.data,
      scadenza: fp.scadenza ?? '',
      stato: fp.stato,
      imponibile: fp.imponibile,
      iva: fp.iva,
      totale: fp.totale,
      pagata_il: fp.pagata_il ?? '',
      note: fp.note ?? '',
    })
    setEditingId(fp.id)
    setModalOpen(true)
  }

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    if (!profile?.azienda_id || !form.fornitore_id) {
      toast.error('Seleziona un fornitore')
      return
    }
    const payload = {
      azienda_id: profile.azienda_id,
      fornitore_id: form.fornitore_id,
      numero: form.numero,
      data: form.data,
      scadenza: form.scadenza || null,
      stato: form.stato,
      imponibile: form.imponibile,
      iva: form.iva,
      totale: form.totale,
      pagata_il: form.pagata_il || null,
      note: form.note || null,
    }
    if (editingId) {
      await update(editingId, payload)
      toast.success('Fattura passiva aggiornata')
    } else {
      const created = await create(payload)
      if (created) toast.success('Fattura passiva creata')
      else toast.error('Errore nella creazione')
    }
    setModalOpen(false)
  }

  const handleDelete = async (fp: FatturaPassiva) => {
    if (!confirm(`Eliminare la fattura ${fp.numero}?`)) return
    await remove(fp.id)
    toast.success('Fattura eliminata')
  }

  const columns: Column<FatturaPassiva>[] = [
    {
      key: 'numero',
      header: 'Numero',
      render: (fp) => <span className="font-medium">{fp.numero}</span>,
    },
    {
      key: 'fornitore',
      header: 'Fornitore',
      render: (fp) => <span>{fp.fornitore?.ragione_sociale ?? '-'}</span>,
    },
    {
      key: 'descrizione',
      header: 'Descrizione',
      render: (fp) => <span className="text-text2 truncate max-w-[200px] block">{fp.note ?? '-'}</span>,
    },
    {
      key: 'importo',
      header: 'Importo',
      render: (fp) => <span className="font-mono font-medium">{formatCurrency(fp.totale)}</span>,
    },
    {
      key: 'data',
      header: 'Data',
      render: (fp) => <span className="text-text2">{formatDate(fp.data)}</span>,
    },
    {
      key: 'scadenza',
      header: 'Scadenza',
      render: (fp) => {
        const overdue = fp.scadenza && fp.stato === 'da_pagare' && new Date(fp.scadenza) < new Date()
        return (
          <span className={overdue ? 'text-red font-semibold' : 'text-text2'}>
            {formatDate(fp.scadenza)}
          </span>
        )
      },
    },
    {
      key: 'stato',
      header: 'Stato',
      render: (fp) => <Badge color={statoColors[fp.stato]}>{statoLabels[fp.stato]}</Badge>,
    },
    {
      key: 'azioni',
      header: '',
      render: (fp) => (
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); openEdit(fp) }}
            className="p-1.5 rounded-lg text-text3 hover:text-gold hover:bg-bg3 transition-colors"
            title="Modifica"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleDelete(fp) }}
            className="p-1.5 rounded-lg text-text3 hover:text-red hover:bg-bg3 transition-colors"
            title="Elimina"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold text-text">Fatture Passive</h1>
        <div className="flex items-center gap-3">
          <Button onClick={() => setUploadModalOpen(true)}>
            <Upload size={16} />
            Upload Fattura
          </Button>
          <Button variant="primary" onClick={openNew}>
            <Plus size={16} />
            Nuova Fattura Passiva
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard icon={FileText} label="Totale Fatture Passive" value={formatCurrency(stats.totale)} />
        <StatCard icon={CreditCard} label="Da Pagare" value={formatCurrency(stats.daPagare)} />
        <StatCard icon={AlertTriangle} label="Contestate" value={String(stats.contestate)} />
      </div>

      <div className="flex items-center gap-4">
        <div className="flex-1 max-w-sm">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text3" />
            <input
              type="text"
              placeholder="Cerca per numero o fornitore..."
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
              { value: 'da_pagare', label: 'Da Pagare' },
              { value: 'pagata', label: 'Pagata' },
              { value: 'contestata', label: 'Contestata' },
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
          keyExtractor={(fp) => fp.id}
          emptyMessage="Nessuna fattura passiva trovata."
          onRowClick={openEdit}
        />
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? 'Modifica Fattura Passiva' : 'Nuova Fattura Passiva'}
        className="max-w-lg"
      >
        <form onSubmit={handleSave} className="space-y-4">
          <Select
            label="Fornitore"
            value={form.fornitore_id}
            onChange={(e) => setForm((p) => ({ ...p, fornitore_id: e.target.value }))}
            options={[
              { value: '', label: 'Seleziona fornitore...' },
              ...fornitori.map((f) => ({ value: f.id, label: f.ragione_sociale })),
            ]}
          />
          <Input
            label="Numero Fattura"
            value={form.numero}
            onChange={(e) => setForm((p) => ({ ...p, numero: e.target.value }))}
            required
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Data"
              type="date"
              value={form.data}
              onChange={(e) => setForm((p) => ({ ...p, data: e.target.value }))}
              required
            />
            <Input
              label="Scadenza"
              type="date"
              value={form.scadenza}
              onChange={(e) => setForm((p) => ({ ...p, scadenza: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Input
              label="Imponibile"
              type="number"
              min={0}
              step={0.01}
              value={form.imponibile}
              onChange={(e) => handleImponibileChange(parseFloat(e.target.value) || 0)}
            />
            <Input
              label="IVA"
              type="number"
              min={0}
              step={0.01}
              value={form.iva}
              onChange={(e) => {
                const iva = parseFloat(e.target.value) || 0
                setForm((p) => ({ ...p, iva, totale: Math.round((p.imponibile + iva) * 100) / 100 }))
              }}
            />
            <Input
              label="Totale"
              type="number"
              min={0}
              step={0.01}
              value={form.totale}
              onChange={(e) => setForm((p) => ({ ...p, totale: parseFloat(e.target.value) || 0 }))}
            />
          </div>
          <Select
            label="Stato"
            value={form.stato}
            onChange={(e) => setForm((p) => ({ ...p, stato: e.target.value as FatturaPassivaStato }))}
            options={[
              { value: 'da_pagare', label: 'Da Pagare' },
              { value: 'pagata', label: 'Pagata' },
              { value: 'contestata', label: 'Contestata' },
            ]}
          />
          {form.stato === 'pagata' && (
            <Input
              label="Pagata il"
              type="date"
              value={form.pagata_il}
              onChange={(e) => setForm((p) => ({ ...p, pagata_il: e.target.value }))}
            />
          )}
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

      <UploadFatturaModal
        open={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        fornitori={fornitori}
        onSave={async (data) => {
          if (!profile?.azienda_id) return
          const created = await create({ ...data, azienda_id: profile.azienda_id })
          if (!created) throw new Error('Errore nella creazione')
        }}
      />
    </div>
  )
}
