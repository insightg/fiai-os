import { useEffect, useState, useMemo, type FormEvent } from 'react'
import {
  useOrdiniStore,
  useClientiStore,
  usePreventiviStore,
  useFattureStore,
  useAuthStore,
} from '../../store'
import type { Ordine, OrdineStato } from '../../types'
import Table, { type Column } from '../../components/ui/Table'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import Modal from '../../components/ui/Modal'
import { Input, Select, Textarea } from '../../components/ui/Form'
import StatCard from '../../components/ui/StatCard'
import { Plus, Search, ShoppingCart, ArrowRight } from 'lucide-react'
import toast from 'react-hot-toast'

const STATO_COLORS: Record<OrdineStato, 'blue' | 'amber' | 'green' | 'red'> = {
  confermato: 'blue',
  in_lavorazione: 'amber',
  completato: 'green',
  annullato: 'red',
}

const STATO_LABELS: Record<OrdineStato, string> = {
  confermato: 'Confermato',
  in_lavorazione: 'In Lavorazione',
  completato: 'Completato',
  annullato: 'Annullato',
}

const STATO_OPTIONS: { value: OrdineStato; label: string }[] = [
  { value: 'confermato', label: 'Confermato' },
  { value: 'in_lavorazione', label: 'In Lavorazione' },
  { value: 'completato', label: 'Completato' },
  { value: 'annullato', label: 'Annullato' },
]

const FILTER_OPTIONS = [
  { value: '', label: 'Tutti gli stati' },
  { value: 'confermato', label: 'Confermato' },
  { value: 'in_lavorazione', label: 'In Lavorazione' },
  { value: 'completato', label: 'Completato' },
  { value: 'annullato', label: 'Annullato' },
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

export default function Ordini() {
  const profile = useAuthStore((s) => s.profile)
  const {
    ordini,
    loading,
    fetch: fetchOrdini,
    create: createOrdine,
    update: updateOrdine,
    remove: removeOrdine,
  } = useOrdiniStore()
  const { clienti, fetch: fetchClienti } = useClientiStore()
  const { preventivi, fetch: fetchPreventivi } = usePreventiviStore()
  const { create: createFattura } = useFattureStore()

  const [search, setSearch] = useState('')
  const [filterStato, setFilterStato] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingOrdine, setEditingOrdine] = useState<Ordine | null>(null)

  // Form state
  const [form, setForm] = useState({
    cliente_id: '',
    preventivo_id: '',
    numero: '',
    data: new Date().toISOString().split('T')[0],
    stato: 'confermato' as OrdineStato,
    imponibile: '',
    iva: '',
    totale: '',
    note: '',
  })
  const [clienteSearch, setClienteSearch] = useState('')
  const [showClienteDropdown, setShowClienteDropdown] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (profile?.azienda_id) {
      fetchOrdini(profile.azienda_id)
      fetchClienti(profile.azienda_id)
      fetchPreventivi(profile.azienda_id)
    }
  }, [profile?.azienda_id, fetchOrdini, fetchClienti, fetchPreventivi])

  const filtered = useMemo(() => {
    let result = ordini
    if (filterStato) {
      result = result.filter((o) => o.stato === filterStato)
    }
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(
        (o) =>
          o.numero.toLowerCase().includes(q) ||
          (o.cliente?.nome?.toLowerCase().includes(q) ?? false) ||
          (o.cliente?.ragione_sociale?.toLowerCase().includes(q) ?? false)
      )
    }
    return result
  }, [ordini, filterStato, search])

  const stats = useMemo(() => {
    const total = ordini.length
    const totalValue = ordini.reduce((sum, o) => sum + o.totale, 0)
    const inLavorazione = ordini.filter((o) => o.stato === 'in_lavorazione').length
    const completati = ordini.filter((o) => o.stato === 'completato').length
    return { total, totalValue, inLavorazione, completati }
  }, [ordini])

  const filteredClienti = useMemo(() => {
    if (!clienteSearch) return clienti.slice(0, 10)
    const q = clienteSearch.toLowerCase()
    return clienti
      .filter(
        (c) =>
          c.nome.toLowerCase().includes(q) ||
          (c.ragione_sociale?.toLowerCase().includes(q) ?? false)
      )
      .slice(0, 10)
  }, [clienti, clienteSearch])

  const selectedCliente = clienti.find((c) => c.id === form.cliente_id)

  // Client's preventivi for linking
  const clientePreventivi = useMemo(() => {
    if (!form.cliente_id) return []
    return preventivi.filter(
      (p) => p.cliente_id === form.cliente_id && p.stato === 'accettato'
    )
  }, [preventivi, form.cliente_id])

  function resetForm() {
    setForm({
      cliente_id: '',
      preventivo_id: '',
      numero: `ORD-${Date.now().toString(36).toUpperCase()}`,
      data: new Date().toISOString().split('T')[0],
      stato: 'confermato',
      imponibile: '',
      iva: '',
      totale: '',
      note: '',
    })
    setClienteSearch('')
    setErrors({})
  }

  function handleNew() {
    resetForm()
    setEditingOrdine(null)
    setModalOpen(true)
  }

  function handleEdit(ordine: Ordine) {
    setEditingOrdine(ordine)
    setForm({
      cliente_id: ordine.cliente_id,
      preventivo_id: ordine.preventivo_id ?? '',
      numero: ordine.numero,
      data: ordine.data,
      stato: ordine.stato,
      imponibile: ordine.imponibile.toString(),
      iva: ordine.iva.toString(),
      totale: ordine.totale.toString(),
      note: ordine.note ?? '',
    })
    setErrors({})
    setModalOpen(true)
  }

  function handlePreventivoSelect(preventivoId: string) {
    const prev = preventivi.find((p) => p.id === preventivoId)
    if (prev) {
      setForm({
        ...form,
        preventivo_id: preventivoId,
        imponibile: prev.imponibile.toString(),
        iva: prev.iva.toString(),
        totale: prev.totale.toString(),
        note: `Generato dal preventivo ${prev.numero}`,
      })
    }
  }

  function recalcTotale(imponibileStr: string) {
    const imponibile = Number(imponibileStr) || 0
    const iva = Math.round(imponibile * 0.22 * 100) / 100
    const totale = Math.round((imponibile + iva) * 100) / 100
    setForm((f) => ({
      ...f,
      imponibile: imponibileStr,
      iva: iva.toString(),
      totale: totale.toString(),
    }))
  }

  function validate(): boolean {
    const errs: Record<string, string> = {}
    if (!form.cliente_id) errs.cliente = 'Selezionare un cliente'
    if (!form.numero.trim()) errs.numero = 'Il numero è obbligatorio'
    if (!form.imponibile || isNaN(Number(form.imponibile))) {
      errs.imponibile = 'Importo non valido'
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!validate() || !profile) return

    const payload = {
      cliente_id: form.cliente_id,
      preventivo_id: form.preventivo_id || null,
      numero: form.numero.trim(),
      data: form.data,
      stato: form.stato,
      imponibile: Number(form.imponibile),
      iva: Number(form.iva),
      totale: Number(form.totale),
      note: form.note.trim() || null,
    }

    if (editingOrdine) {
      await updateOrdine(editingOrdine.id, payload)
      toast.success('Ordine aggiornato con successo')
    } else {
      const created = await createOrdine({
        ...payload,
        azienda_id: profile.azienda_id,
      })
      if (created) {
        toast.success('Ordine creato con successo')
      } else {
        toast.error("Errore nella creazione dell'ordine")
        return
      }
    }
    setModalOpen(false)
  }

  async function handleConvertToFattura(ordine: Ordine) {
    if (!profile) return

    const fattura = await createFattura({
      azienda_id: profile.azienda_id,
      cliente_id: ordine.cliente_id,
      ordine_id: ordine.id,
      numero: `FAT-${Date.now().toString(36).toUpperCase()}`,
      data: new Date().toISOString().split('T')[0],
      scadenza: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
      stato: 'bozza',
      oggetto: `Fattura per ordine ${ordine.numero}`,
      imponibile: ordine.imponibile,
      iva: ordine.iva,
      totale: ordine.totale,
      pagata_il: null,
      metodo_pagamento: null,
      note: `Generata dall'ordine ${ordine.numero}`,
    })

    if (fattura) {
      await updateOrdine(ordine.id, { stato: 'completato' })
      toast.success('Ordine convertito in fattura')
    } else {
      toast.error('Errore nella conversione in fattura')
    }
  }

  async function handleDelete(ordine: Ordine) {
    if (!confirm(`Eliminare l'ordine "${ordine.numero}"?`)) return
    await removeOrdine(ordine.id)
    toast.success('Ordine eliminato')
    setModalOpen(false)
  }

  const clienteName = (o: Ordine) =>
    o.cliente?.ragione_sociale ??
    (`${o.cliente?.nome ?? ''} ${o.cliente?.cognome ?? ''}`.trim() || '-')

  const preventivoNumero = (o: Ordine) => {
    if (!o.preventivo_id) return '-'
    const p = preventivi.find((p) => p.id === o.preventivo_id)
    return p?.numero ?? '-'
  }

  const columns: Column<Ordine>[] = [
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
      key: 'preventivo',
      header: 'Preventivo',
      render: (row) => (
        <span className="text-sm text-text3">{preventivoNumero(row)}</span>
      ),
    },
    {
      key: 'valore',
      header: 'Valore',
      render: (row) => <span className="font-semibold text-gold">{formatEuro(row.totale)}</span>,
    },
    {
      key: 'data',
      header: 'Data',
      render: (row) => <span className="text-sm text-text2">{formatDate(row.data)}</span>,
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
          {(row.stato === 'completato' || row.stato === 'confermato') && (
            <Button size="sm" variant="primary" onClick={() => handleConvertToFattura(row)}>
              <ArrowRight size={14} />
              Fattura
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
          <h1 className="text-2xl font-bold font-display text-text">Ordini</h1>
          <p className="text-sm text-text3 mt-1">Gestione ordini e commesse</p>
        </div>
        <Button variant="primary" onClick={handleNew}>
          <Plus size={16} />
          Nuovo Ordine
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard icon={ShoppingCart} label="Totale Ordini" value={stats.total.toString()} />
        <StatCard icon={ShoppingCart} label="Valore Totale" value={formatEuro(stats.totalValue)} />
        <StatCard
          icon={ShoppingCart}
          label="In Lavorazione"
          value={stats.inLavorazione.toString()}
        />
        <StatCard icon={ShoppingCart} label="Completati" value={stats.completati.toString()} />
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
          emptyMessage="Nessun ordine trovato."
        />
      )}

      {/* Create/Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingOrdine ? `Modifica Ordine ${editingOrdine.numero}` : 'Nuovo Ordine'}
        className="max-w-2xl"
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input
            label="Numero"
            value={form.numero}
            onChange={(e) => setForm({ ...form, numero: e.target.value })}
            error={errors.numero}
          />

          {/* Cliente Search */}
          <div className="flex flex-col gap-1.5 relative">
            <label className="text-sm font-medium text-text2">Cliente *</label>
            {selectedCliente ? (
              <div className="flex items-center gap-2 bg-bg3 border border-border rounded-lg px-3 py-2">
                <span className="text-sm text-text flex-1">
                  {selectedCliente.ragione_sociale ??
                    `${selectedCliente.nome} ${selectedCliente.cognome ?? ''}`}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setForm({ ...form, cliente_id: '', preventivo_id: '' })
                    setClienteSearch('')
                  }}
                  className="text-text3 hover:text-red transition-colors text-xs"
                >
                  Cambia
                </button>
              </div>
            ) : (
              <div className="relative">
                <Input
                  value={clienteSearch}
                  onChange={(e) => {
                    setClienteSearch(e.target.value)
                    setShowClienteDropdown(true)
                  }}
                  onFocus={() => setShowClienteDropdown(true)}
                  placeholder="Cerca cliente..."
                  error={errors.cliente}
                />
                {showClienteDropdown && filteredClienti.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-bg2 border border-border rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
                    {filteredClienti.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setForm({ ...form, cliente_id: c.id })
                          setClienteSearch('')
                          setShowClienteDropdown(false)
                        }}
                        className="w-full text-left px-3 py-2 text-sm text-text hover:bg-bg3 transition-colors"
                      >
                        {c.ragione_sociale ?? `${c.nome} ${c.cognome ?? ''}`}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Preventivo Link */}
          {clientePreventivi.length > 0 && (
            <Select
              label="Collega Preventivo"
              value={form.preventivo_id}
              onChange={(e) => handlePreventivoSelect(e.target.value)}
              options={[
                { value: '', label: '-- Nessun preventivo --' },
                ...clientePreventivi.map((p) => ({
                  value: p.id,
                  label: `${p.numero} - ${formatEuro(p.totale)}`,
                })),
              ]}
            />
          )}

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Data"
              type="date"
              value={form.data}
              onChange={(e) => setForm({ ...form, data: e.target.value })}
            />
            <Select
              label="Stato"
              value={form.stato}
              onChange={(e) => setForm({ ...form, stato: e.target.value as OrdineStato })}
              options={STATO_OPTIONS}
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Input
              label="Imponibile (EUR)"
              type="number"
              value={form.imponibile}
              onChange={(e) => recalcTotale(e.target.value)}
              error={errors.imponibile}
              min={0}
              step={0.01}
            />
            <Input
              label="IVA (EUR)"
              type="number"
              value={form.iva}
              onChange={(e) =>
                setForm({
                  ...form,
                  iva: e.target.value,
                  totale: (Number(form.imponibile) + Number(e.target.value)).toFixed(2),
                })
              }
              min={0}
              step={0.01}
            />
            <Input
              label="Totale (EUR)"
              type="number"
              value={form.totale}
              disabled
            />
          </div>

          <Textarea
            label="Note"
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />

          <div className="flex items-center justify-between mt-2">
            <div>
              {editingOrdine && (
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => handleDelete(editingOrdine)}
                >
                  Elimina
                </Button>
              )}
            </div>
            <div className="flex gap-3">
              <Button type="button" onClick={() => setModalOpen(false)}>
                Annulla
              </Button>
              <Button type="submit" variant="primary" disabled={loading}>
                {loading
                  ? 'Salvataggio...'
                  : editingOrdine
                  ? 'Aggiorna'
                  : 'Crea Ordine'}
              </Button>
            </div>
          </div>
        </form>
      </Modal>
    </div>
  )
}
