import { useState, useEffect, useMemo, useRef, type FormEvent } from 'react'
import { Plus, Search, Pencil, Trash2, Users, UserPlus, UserCheck, Star, Upload } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore, useCandidatiStore } from '../../store'
import type { Candidato, CandidatoStato } from '../../types'
import Table, { type Column } from '../../components/ui/Table'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import Modal from '../../components/ui/Modal'
import { Input, Select, Textarea } from '../../components/ui/Form'
import StatCard from '../../components/ui/StatCard'
import { uploadGeneric } from '../../lib/upload'

const STATO_COLORS: Record<CandidatoStato, 'blue' | 'amber' | 'purple' | 'gold' | 'green' | 'red'> = {
  nuovo: 'blue',
  screening: 'amber',
  colloquio: 'purple',
  offerta: 'gold',
  assunto: 'green',
  scartato: 'red',
}

const STATO_LABELS: Record<CandidatoStato, string> = {
  nuovo: 'Nuovo',
  screening: 'Screening',
  colloquio: 'Colloquio',
  offerta: 'Offerta',
  assunto: 'Assunto',
  scartato: 'Scartato',
}

const FILTER_OPTIONS = [
  { value: 'tutti', label: 'Tutti gli stati' },
  { value: 'nuovo', label: 'Nuovo' },
  { value: 'screening', label: 'Screening' },
  { value: 'colloquio', label: 'Colloquio' },
  { value: 'offerta', label: 'Offerta' },
  { value: 'assunto', label: 'Assunto' },
  { value: 'scartato', label: 'Scartato' },
]

const VALUTAZIONE_OPTIONS = [
  { value: '0', label: 'Nessuna' },
  { value: '1', label: '1 Stella' },
  { value: '2', label: '2 Stelle' },
  { value: '3', label: '3 Stelle' },
  { value: '4', label: '4 Stelle' },
  { value: '5', label: '5 Stelle' },
]

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function StarsDisplay({ value }: { value: number | null }) {
  if (value == null || value === 0) return <span className="text-text3 text-sm">-</span>
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          size={14}
          className={i < value ? 'text-gold fill-gold' : 'text-text3'}
        />
      ))}
    </div>
  )
}

interface CandidatoForm {
  nome: string
  cognome: string
  email: string
  telefono: string
  ruolo_candidato: string
  stato: CandidatoStato
  valutazione: string
  fonte: string
  data_candidatura: string
  note: string
  cv_url: string
}

const emptyForm: CandidatoForm = {
  nome: '',
  cognome: '',
  email: '',
  telefono: '',
  ruolo_candidato: '',
  stato: 'nuovo',
  valutazione: '0',
  fonte: '',
  data_candidatura: new Date().toISOString().split('T')[0],
  note: '',
  cv_url: '',
}

export default function Candidati() {
  const profile = useAuthStore((s) => s.profile)
  const { candidati, loading, fetch, create, update, remove } = useCandidatiStore()
  const [search, setSearch] = useState('')
  const [filterStato, setFilterStato] = useState<string>('tutti')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<CandidatoForm>(emptyForm)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (profile?.azienda_id) {
      fetch(profile.azienda_id)
    }
  }, [profile?.azienda_id, fetch])

  const filtered = useMemo(() => {
    let result = candidati
    if (filterStato !== 'tutti') {
      result = result.filter((c) => c.stato === filterStato)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(
        (c) =>
          c.nome.toLowerCase().includes(q) ||
          c.cognome.toLowerCase().includes(q) ||
          (c.email?.toLowerCase().includes(q) ?? false) ||
          (c.ruolo_candidato?.toLowerCase().includes(q) ?? false)
      )
    }
    return result
  }, [candidati, filterStato, search])

  const stats = useMemo(() => {
    const totale = candidati.length
    const nuovi = candidati.filter((c) => c.stato === 'nuovo').length
    const inColloquio = candidati.filter((c) => c.stato === 'colloquio').length
    const assunti = candidati.filter((c) => c.stato === 'assunto').length
    return { totale, nuovi, inColloquio, assunti }
  }, [candidati])

  const openNew = () => {
    setForm(emptyForm)
    setEditingId(null)
    setModalOpen(true)
  }

  const openEdit = (candidato: Candidato) => {
    setForm({
      nome: candidato.nome,
      cognome: candidato.cognome,
      email: candidato.email ?? '',
      telefono: candidato.telefono ?? '',
      ruolo_candidato: candidato.ruolo_candidato ?? '',
      stato: candidato.stato,
      valutazione: String(candidato.valutazione ?? 0),
      fonte: candidato.fonte ?? '',
      data_candidatura: candidato.data_candidatura,
      note: candidato.note ?? '',
      cv_url: candidato.cv_url ?? '',
    })
    setEditingId(candidato.id)
    setModalOpen(true)
  }

  const handleCvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const result = await uploadGeneric(file)
      const url = (result as { url?: string }).url ?? ''
      setForm((p) => ({ ...p, cv_url: url }))
      toast.success('CV caricato')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Errore nel caricamento')
    } finally {
      setUploading(false)
    }
  }

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    if (!profile?.azienda_id) return
    if (!form.nome.trim() || !form.cognome.trim()) {
      toast.error('Nome e cognome sono obbligatori')
      return
    }

    const payload = {
      azienda_id: profile.azienda_id,
      nome: form.nome,
      cognome: form.cognome,
      email: form.email || null,
      telefono: form.telefono || null,
      ruolo_candidato: form.ruolo_candidato || null,
      stato: form.stato,
      valutazione: parseInt(form.valutazione) || null,
      fonte: form.fonte || null,
      data_candidatura: form.data_candidatura,
      note: form.note || null,
      cv_url: form.cv_url || null,
    }

    if (editingId) {
      await update(editingId, payload)
      toast.success('Candidato aggiornato')
    } else {
      const created = await create(payload)
      if (created) toast.success('Candidato creato')
      else toast.error('Errore nella creazione')
    }
    setModalOpen(false)
  }

  const handleDelete = async (candidato: Candidato) => {
    if (!confirm(`Eliminare ${candidato.nome} ${candidato.cognome}?`)) return
    await remove(candidato.id)
    toast.success('Candidato eliminato')
  }

  const columns: Column<Candidato>[] = [
    {
      key: 'nome',
      header: 'Nome Cognome',
      render: (row) => (
        <div>
          <p className="font-medium">
            {row.nome} {row.cognome}
          </p>
        </div>
      ),
    },
    {
      key: 'ruolo',
      header: 'Ruolo',
      render: (row) => <span className="text-sm text-text2">{row.ruolo_candidato ?? '-'}</span>,
    },
    {
      key: 'email',
      header: 'Email',
      render: (row) => <span className="text-sm text-text2">{row.email ?? '-'}</span>,
    },
    {
      key: 'stato',
      header: 'Stato',
      render: (row) => (
        <Badge color={STATO_COLORS[row.stato]}>{STATO_LABELS[row.stato]}</Badge>
      ),
    },
    {
      key: 'valutazione',
      header: 'Valutazione',
      render: (row) => <StarsDisplay value={row.valutazione} />,
    },
    {
      key: 'data',
      header: 'Data',
      render: (row) => (
        <span className="text-sm text-text2">{formatDate(row.data_candidatura)}</span>
      ),
    },
    {
      key: 'azioni',
      header: 'Azioni',
      render: (row) => (
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation()
              openEdit(row)
            }}
            className="p-1.5 rounded-lg text-text3 hover:text-gold hover:bg-bg3 transition-colors"
            title="Modifica"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              handleDelete(row)
            }}
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display text-text">Candidati</h1>
          <p className="text-sm text-text3 mt-1">Gestisci i candidati e il processo di selezione</p>
        </div>
        <Button variant="primary" onClick={openNew}>
          <Plus size={16} />
          Nuovo Candidato
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Totale Candidati" value={String(stats.totale)} />
        <StatCard icon={UserPlus} label="Nuovi" value={String(stats.nuovi)} />
        <StatCard icon={Users} label="In Colloquio" value={String(stats.inColloquio)} />
        <StatCard icon={UserCheck} label="Assunti" value={String(stats.assunti)} />
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-4">
        <div className="flex-1 max-w-sm">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text3" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cerca per nome, email, ruolo..."
              className="pl-9"
            />
          </div>
        </div>
        <Select
          value={filterStato}
          onChange={(e) => setFilterStato(e.target.value)}
          options={FILTER_OPTIONS}
        />
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="text-gold font-display text-lg animate-pulse">Caricamento...</div>
        </div>
      ) : (
        <Table
          columns={columns}
          data={filtered}
          keyExtractor={(row) => row.id}
          emptyMessage="Nessun candidato trovato."
          onRowClick={openEdit}
        />
      )}

      {/* Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? 'Modifica Candidato' : 'Nuovo Candidato'}
        className="max-w-2xl"
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Nome"
              value={form.nome}
              onChange={(e) => setForm((p) => ({ ...p, nome: e.target.value }))}
              required
            />
            <Input
              label="Cognome"
              value={form.cognome}
              onChange={(e) => setForm((p) => ({ ...p, cognome: e.target.value }))}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
            />
            <Input
              label="Telefono"
              value={form.telefono}
              onChange={(e) => setForm((p) => ({ ...p, telefono: e.target.value }))}
            />
          </div>

          <Input
            label="Ruolo Candidato"
            value={form.ruolo_candidato}
            onChange={(e) => setForm((p) => ({ ...p, ruolo_candidato: e.target.value }))}
            placeholder="Es. Frontend Developer"
          />

          <div className="grid grid-cols-3 gap-4">
            <Select
              label="Stato"
              value={form.stato}
              onChange={(e) =>
                setForm((p) => ({ ...p, stato: e.target.value as CandidatoStato }))
              }
              options={[
                { value: 'nuovo', label: 'Nuovo' },
                { value: 'screening', label: 'Screening' },
                { value: 'colloquio', label: 'Colloquio' },
                { value: 'offerta', label: 'Offerta' },
                { value: 'assunto', label: 'Assunto' },
                { value: 'scartato', label: 'Scartato' },
              ]}
            />
            <Select
              label="Valutazione"
              value={form.valutazione}
              onChange={(e) => setForm((p) => ({ ...p, valutazione: e.target.value }))}
              options={VALUTAZIONE_OPTIONS}
            />
            <Input
              label="Fonte"
              value={form.fonte}
              onChange={(e) => setForm((p) => ({ ...p, fonte: e.target.value }))}
              placeholder="Es. LinkedIn"
            />
          </div>

          <Input
            label="Data Candidatura"
            type="date"
            value={form.data_candidatura}
            onChange={(e) => setForm((p) => ({ ...p, data_candidatura: e.target.value }))}
          />

          <Textarea
            label="Note"
            value={form.note}
            onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))}
          />

          {/* CV Upload */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text2">CV</label>
            <div className="flex items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.doc,.docx"
                onChange={handleCvUpload}
                className="hidden"
              />
              <Button
                type="button"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                <Upload size={14} />
                {uploading ? 'Caricamento...' : 'Carica CV'}
              </Button>
              {form.cv_url && (
                <a
                  href={form.cv_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-gold hover:underline"
                >
                  Visualizza CV
                </a>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" onClick={() => setModalOpen(false)}>
              Annulla
            </Button>
            <Button type="submit" variant="primary">
              {editingId ? 'Aggiorna' : 'Crea'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
