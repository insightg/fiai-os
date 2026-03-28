import { useEffect, useState, useMemo, type FormEvent } from 'react'
import {
  useClientiStore,
  useAuthStore,
  usePreventiviStore,
  useOrdiniStore,
  useFattureStore,
} from '../../store'
import type { Cliente } from '../../types'
import Table, { type Column } from '../../components/ui/Table'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import Modal from '../../components/ui/Modal'
import { Input, Select, Textarea } from '../../components/ui/Form'
import { Plus, Search, Building2 } from 'lucide-react'
import StatCard from '../../components/ui/StatCard'
import toast from 'react-hot-toast'

const TIPO_OPTIONS = [
  { value: 'privato', label: 'Privato' },
  { value: 'azienda', label: 'Azienda' },
]

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function formatEuro(value: number): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(value)
}

export default function Clienti() {
  const profile = useAuthStore((s) => s.profile)
  const { clienti, loading, fetch: fetchClienti, create: createCliente, update: updateCliente, remove: removeCliente } = useClientiStore()
  const { preventivi, fetch: fetchPreventivi } = usePreventiviStore()
  const { ordini, fetch: fetchOrdini } = useOrdiniStore()
  const { fatture, fetch: fetchFatture } = useFattureStore()

  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [selectedCliente, setSelectedCliente] = useState<Cliente | null>(null)
  const [editingCliente, setEditingCliente] = useState<Cliente | null>(null)

  // Form state
  const [form, setForm] = useState({
    tipo: 'privato' as 'privato' | 'azienda',
    nome: '',
    cognome: '',
    ragione_sociale: '',
    piva: '',
    codice_fiscale: '',
    email: '',
    telefono: '',
    indirizzo: '',
    cap: '',
    citta: '',
    provincia: '',
    codice_sdi: '',
    pec: '',
    note: '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (profile?.azienda_id) {
      fetchClienti(profile.azienda_id)
      fetchPreventivi(profile.azienda_id)
      fetchOrdini(profile.azienda_id)
      fetchFatture(profile.azienda_id)
    }
  }, [profile?.azienda_id, fetchClienti, fetchPreventivi, fetchOrdini, fetchFatture])

  const filtered = useMemo(() => {
    if (!search) return clienti
    const q = search.toLowerCase()
    return clienti.filter(
      (c) =>
        c.nome.toLowerCase().includes(q) ||
        (c.cognome?.toLowerCase().includes(q) ?? false) ||
        (c.ragione_sociale?.toLowerCase().includes(q) ?? false) ||
        (c.email?.toLowerCase().includes(q) ?? false) ||
        (c.piva?.includes(q) ?? false)
    )
  }, [clienti, search])

  function resetForm() {
    setForm({
      tipo: 'privato',
      nome: '',
      cognome: '',
      ragione_sociale: '',
      piva: '',
      codice_fiscale: '',
      email: '',
      telefono: '',
      indirizzo: '',
      cap: '',
      citta: '',
      provincia: '',
      codice_sdi: '',
      pec: '',
      note: '',
    })
    setErrors({})
  }

  function openNewModal() {
    resetForm()
    setEditingCliente(null)
    setModalOpen(true)
  }

  function openEditModal(cliente: Cliente) {
    setEditingCliente(cliente)
    setForm({
      tipo: cliente.tipo,
      nome: cliente.nome,
      cognome: cliente.cognome ?? '',
      ragione_sociale: cliente.ragione_sociale ?? '',
      piva: cliente.piva ?? '',
      codice_fiscale: cliente.codice_fiscale ?? '',
      email: cliente.email ?? '',
      telefono: cliente.telefono ?? '',
      indirizzo: cliente.indirizzo ?? '',
      cap: cliente.cap ?? '',
      citta: cliente.citta ?? '',
      provincia: cliente.provincia ?? '',
      codice_sdi: cliente.codice_sdi ?? '',
      pec: cliente.pec ?? '',
      note: cliente.note ?? '',
    })
    setErrors({})
    setModalOpen(true)
  }

  function openDetail(cliente: Cliente) {
    setSelectedCliente(cliente)
    setDetailOpen(true)
  }

  function validate(): boolean {
    const errs: Record<string, string> = {}
    if (!form.nome.trim()) errs.nome = 'Il nome è obbligatorio'
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      errs.email = 'Indirizzo email non valido'
    }
    if (form.pec && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.pec)) {
      errs.pec = 'Indirizzo PEC non valido'
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!validate() || !profile) return

    const payload = {
      tipo: form.tipo,
      nome: form.nome.trim(),
      cognome: form.cognome.trim() || null,
      ragione_sociale: form.ragione_sociale.trim() || null,
      piva: form.piva.trim() || null,
      codice_fiscale: form.codice_fiscale.trim() || null,
      email: form.email.trim() || null,
      telefono: form.telefono.trim() || null,
      indirizzo: form.indirizzo.trim() || null,
      cap: form.cap.trim() || null,
      citta: form.citta.trim() || null,
      provincia: form.provincia.trim() || null,
      codice_sdi: form.codice_sdi.trim() || null,
      pec: form.pec.trim() || null,
      note: form.note.trim() || null,
    }

    if (editingCliente) {
      await updateCliente(editingCliente.id, payload)
      toast.success('Cliente aggiornato con successo')
    } else {
      const created = await createCliente({
        ...payload,
        azienda_id: profile.azienda_id,
      })
      if (created) {
        toast.success('Cliente creato con successo')
      } else {
        toast.error('Errore nella creazione del cliente')
        return
      }
    }
    setModalOpen(false)
  }

  async function handleDelete(cliente: Cliente) {
    if (!confirm(`Eliminare il cliente "${cliente.nome}"?`)) return
    await removeCliente(cliente.id)
    toast.success('Cliente eliminato')
    setDetailOpen(false)
  }

  // Storico for selected client
  const clientePreventivi = useMemo(
    () => (selectedCliente ? preventivi.filter((p) => p.cliente_id === selectedCliente.id) : []),
    [selectedCliente, preventivi]
  )
  const clienteOrdini = useMemo(
    () => (selectedCliente ? ordini.filter((o) => o.cliente_id === selectedCliente.id) : []),
    [selectedCliente, ordini]
  )
  const clienteFatture = useMemo(
    () => (selectedCliente ? fatture.filter((f) => f.cliente_id === selectedCliente.id) : []),
    [selectedCliente, fatture]
  )

  const displayName = (c: Cliente) =>
    c.ragione_sociale ?? `${c.nome}${c.cognome ? ' ' + c.cognome : ''}`

  const columns: Column<Cliente>[] = [
    {
      key: 'nome',
      header: 'Nome',
      render: (row) => (
        <div>
          <p className="font-medium">{displayName(row)}</p>
          <p className="text-xs text-text3">
            {row.tipo === 'azienda' ? 'Azienda' : 'Privato'}
          </p>
        </div>
      ),
    },
    {
      key: 'piva',
      header: 'P.IVA',
      render: (row) => <span className="text-sm text-text2">{row.piva ?? '-'}</span>,
    },
    {
      key: 'email',
      header: 'Email',
      render: (row) => <span className="text-sm text-text2">{row.email ?? '-'}</span>,
    },
    {
      key: 'telefono',
      header: 'Tel',
      render: (row) => <span className="text-sm text-text2">{row.telefono ?? '-'}</span>,
    },
    {
      key: 'indirizzo',
      header: 'Indirizzo',
      render: (row) => (
        <span className="text-sm text-text2">
          {row.indirizzo
            ? `${row.indirizzo}${row.citta ? ', ' + row.citta : ''}${row.provincia ? ' (' + row.provincia + ')' : ''}`
            : '-'}
        </span>
      ),
    },
    {
      key: 'pec',
      header: 'PEC',
      render: (row) => <span className="text-sm text-text2">{row.pec ?? '-'}</span>,
    },
    {
      key: 'sdi',
      header: 'SDI',
      render: (row) => <span className="text-sm text-text2">{row.codice_sdi ?? '-'}</span>,
    },
    {
      key: 'azioni',
      header: 'Azioni',
      render: (row) => (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => openEditModal(row)}>
            Modifica
          </Button>
          <Button size="sm" variant="primary" onClick={() => openDetail(row)}>
            Storico
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display text-text">Clienti</h1>
          <p className="text-sm text-text3 mt-1">Gestione anagrafica clienti</p>
        </div>
        <Button variant="primary" onClick={openNewModal}>
          <Plus size={16} />
          Nuovo Cliente
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard
          icon={Building2}
          label="Totale Clienti"
          value={clienti.length.toString()}
        />
        <StatCard
          icon={Building2}
          label="Aziende"
          value={clienti.filter((c) => c.tipo === 'azienda').length.toString()}
        />
        <StatCard
          icon={Building2}
          label="Privati"
          value={clienti.filter((c) => c.tipo === 'privato').length.toString()}
        />
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text3" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cerca per nome, P.IVA, email..."
          className="pl-9"
        />
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
          onRowClick={openDetail}
          emptyMessage="Nessun cliente trovato."
        />
      )}

      {/* Create/Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingCliente ? 'Modifica Cliente' : 'Nuovo Cliente'}
        className="max-w-2xl"
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Select
            label="Tipo"
            value={form.tipo}
            onChange={(e) => setForm({ ...form, tipo: e.target.value as 'privato' | 'azienda' })}
            options={TIPO_OPTIONS}
          />

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Nome *"
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              error={errors.nome}
            />
            <Input
              label="Cognome"
              value={form.cognome}
              onChange={(e) => setForm({ ...form, cognome: e.target.value })}
            />
          </div>

          {form.tipo === 'azienda' && (
            <Input
              label="Ragione Sociale"
              value={form.ragione_sociale}
              onChange={(e) => setForm({ ...form, ragione_sociale: e.target.value })}
            />
          )}

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="P.IVA"
              value={form.piva}
              onChange={(e) => setForm({ ...form, piva: e.target.value })}
            />
            <Input
              label="Codice Fiscale"
              value={form.codice_fiscale}
              onChange={(e) => setForm({ ...form, codice_fiscale: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              error={errors.email}
            />
            <Input
              label="Telefono"
              value={form.telefono}
              onChange={(e) => setForm({ ...form, telefono: e.target.value })}
            />
          </div>

          <Input
            label="Indirizzo"
            value={form.indirizzo}
            onChange={(e) => setForm({ ...form, indirizzo: e.target.value })}
          />

          <div className="grid grid-cols-3 gap-4">
            <Input
              label="CAP"
              value={form.cap}
              onChange={(e) => setForm({ ...form, cap: e.target.value })}
            />
            <Input
              label="Città"
              value={form.citta}
              onChange={(e) => setForm({ ...form, citta: e.target.value })}
            />
            <Input
              label="Provincia"
              value={form.provincia}
              onChange={(e) => setForm({ ...form, provincia: e.target.value })}
              maxLength={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="PEC"
              type="email"
              value={form.pec}
              onChange={(e) => setForm({ ...form, pec: e.target.value })}
              error={errors.pec}
            />
            <Input
              label="Codice SDI"
              value={form.codice_sdi}
              onChange={(e) => setForm({ ...form, codice_sdi: e.target.value })}
              maxLength={7}
            />
          </div>

          <Textarea
            label="Note"
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />

          <div className="flex justify-end gap-3 mt-2">
            <Button type="button" onClick={() => setModalOpen(false)}>
              Annulla
            </Button>
            <Button type="submit" variant="primary" disabled={loading}>
              {loading ? 'Salvataggio...' : editingCliente ? 'Aggiorna' : 'Crea Cliente'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Detail / Storico Modal */}
      <Modal
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        title={selectedCliente ? `Dettaglio: ${displayName(selectedCliente)}` : 'Dettaglio Cliente'}
        className="max-w-3xl"
      >
        {selectedCliente && (
          <div className="flex flex-col gap-6">
            {/* Client Info */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-text3">Tipo</p>
                <p className="text-text font-medium">
                  {selectedCliente.tipo === 'azienda' ? 'Azienda' : 'Privato'}
                </p>
              </div>
              <div>
                <p className="text-text3">Email</p>
                <p className="text-text">{selectedCliente.email ?? '-'}</p>
              </div>
              <div>
                <p className="text-text3">Telefono</p>
                <p className="text-text">{selectedCliente.telefono ?? '-'}</p>
              </div>
              <div>
                <p className="text-text3">P.IVA</p>
                <p className="text-text">{selectedCliente.piva ?? '-'}</p>
              </div>
              <div>
                <p className="text-text3">PEC</p>
                <p className="text-text">{selectedCliente.pec ?? '-'}</p>
              </div>
              <div>
                <p className="text-text3">Codice SDI</p>
                <p className="text-text">{selectedCliente.codice_sdi ?? '-'}</p>
              </div>
            </div>

            {/* Storico */}
            <div>
              <h3 className="text-lg font-semibold text-text mb-3">Storico Documenti</h3>

              {/* Preventivi */}
              <div className="mb-4">
                <h4 className="text-sm font-medium text-text2 mb-2">
                  Preventivi ({clientePreventivi.length})
                </h4>
                {clientePreventivi.length === 0 ? (
                  <p className="text-xs text-text3">Nessun preventivo</p>
                ) : (
                  <div className="space-y-1">
                    {clientePreventivi.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between bg-bg3 rounded-lg px-3 py-2 text-sm"
                      >
                        <span className="text-text">{p.numero}</span>
                        <span className="text-text2">{p.oggetto ?? '-'}</span>
                        <span className="text-gold font-medium">{formatEuro(p.totale)}</span>
                        <Badge
                          color={
                            p.stato === 'accettato'
                              ? 'green'
                              : p.stato === 'rifiutato'
                              ? 'red'
                              : p.stato === 'inviato'
                              ? 'blue'
                              : 'gray'
                          }
                        >
                          {p.stato.charAt(0).toUpperCase() + p.stato.slice(1)}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Ordini */}
              <div className="mb-4">
                <h4 className="text-sm font-medium text-text2 mb-2">
                  Ordini ({clienteOrdini.length})
                </h4>
                {clienteOrdini.length === 0 ? (
                  <p className="text-xs text-text3">Nessun ordine</p>
                ) : (
                  <div className="space-y-1">
                    {clienteOrdini.map((o) => (
                      <div
                        key={o.id}
                        className="flex items-center justify-between bg-bg3 rounded-lg px-3 py-2 text-sm"
                      >
                        <span className="text-text">{o.numero}</span>
                        <span className="text-gold font-medium">{formatEuro(o.totale)}</span>
                        <Badge
                          color={
                            o.stato === 'completato'
                              ? 'green'
                              : o.stato === 'annullato'
                              ? 'red'
                              : o.stato === 'in_lavorazione'
                              ? 'amber'
                              : 'blue'
                          }
                        >
                          {o.stato === 'in_lavorazione'
                            ? 'In Lavorazione'
                            : o.stato.charAt(0).toUpperCase() + o.stato.slice(1)}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Fatture */}
              <div>
                <h4 className="text-sm font-medium text-text2 mb-2">
                  Fatture ({clienteFatture.length})
                </h4>
                {clienteFatture.length === 0 ? (
                  <p className="text-xs text-text3">Nessuna fattura</p>
                ) : (
                  <div className="space-y-1">
                    {clienteFatture.map((f) => (
                      <div
                        key={f.id}
                        className="flex items-center justify-between bg-bg3 rounded-lg px-3 py-2 text-sm"
                      >
                        <span className="text-text">{f.numero}</span>
                        <span className="text-text2">{formatDate(f.data)}</span>
                        <span className="text-gold font-medium">{formatEuro(f.totale)}</span>
                        <Badge
                          color={
                            f.stato === 'pagata'
                              ? 'green'
                              : f.stato === 'scaduta'
                              ? 'red'
                              : f.stato === 'emessa' || f.stato === 'inviata_sdi'
                              ? 'blue'
                              : 'gray'
                          }
                        >
                          {f.stato === 'inviata_sdi'
                            ? 'Inviata SDI'
                            : f.stato.charAt(0).toUpperCase() + f.stato.slice(1)}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-between pt-4 border-t border-border">
              <Button variant="danger" onClick={() => handleDelete(selectedCliente)}>
                Elimina Cliente
              </Button>
              <div className="flex gap-3">
                <Button onClick={() => setDetailOpen(false)}>Chiudi</Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    setDetailOpen(false)
                    openEditModal(selectedCliente)
                  }}
                >
                  Modifica
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
