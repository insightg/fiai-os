import { useState, useEffect, useMemo, type FormEvent } from 'react'
import { Plus, Search, Pencil, Trash2, Sparkles, Save } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore, useAnnunciLavoroStore } from '../../store'
import type { AnnuncioLavoro, AnnuncioLavoroStato } from '../../types'
import Table, { type Column } from '../../components/ui/Table'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import Modal from '../../components/ui/Modal'
import { Input, Select, Textarea } from '../../components/ui/Form'
import StatCard from '../../components/ui/StatCard'
import { FileText, Eye, XCircle } from 'lucide-react'
import { generateAnnuncioLavoro } from '../../lib/hr-ai'

const STATO_COLORS: Record<AnnuncioLavoroStato, 'amber' | 'green' | 'red'> = {
  bozza: 'amber',
  pubblicato: 'green',
  chiuso: 'red',
}

const STATO_LABELS: Record<AnnuncioLavoroStato, string> = {
  bozza: 'Bozza',
  pubblicato: 'Pubblicato',
  chiuso: 'Chiuso',
}

const TIPO_CONTRATTO_OPTIONS = [
  { value: '', label: 'Seleziona...' },
  { value: 'indeterminato', label: 'Indeterminato' },
  { value: 'determinato', label: 'Determinato' },
  { value: 'apprendistato', label: 'Apprendistato' },
  { value: 'stage', label: 'Stage' },
  { value: 'partita_iva', label: 'Partita IVA' },
]

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

interface AnnuncioForm {
  ruolo: string
  competenze: string
  tipo_contratto: string
  sede: string
  ral_min: string
  ral_max: string
  contenuto: string
  stato: AnnuncioLavoroStato
}

const emptyForm: AnnuncioForm = {
  ruolo: '',
  competenze: '',
  tipo_contratto: '',
  sede: '',
  ral_min: '',
  ral_max: '',
  contenuto: '',
  stato: 'bozza',
}

export default function AnnunciLavoro() {
  const profile = useAuthStore((s) => s.profile)
  const { annunci, loading, fetch, create, update, remove } = useAnnunciLavoroStore()
  const [search, setSearch] = useState('')
  const [filterStato, setFilterStato] = useState<string>('tutti')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<AnnuncioForm>(emptyForm)
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    if (profile?.azienda_id) {
      fetch(profile.azienda_id)
    }
  }, [profile?.azienda_id, fetch])

  const filtered = useMemo(() => {
    let result = annunci
    if (filterStato !== 'tutti') {
      result = result.filter((a) => a.stato === filterStato)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(
        (a) =>
          a.ruolo.toLowerCase().includes(q) ||
          (a.sede?.toLowerCase().includes(q) ?? false) ||
          (a.competenze?.toLowerCase().includes(q) ?? false)
      )
    }
    return result
  }, [annunci, filterStato, search])

  const stats = useMemo(() => {
    const totale = annunci.length
    const bozze = annunci.filter((a) => a.stato === 'bozza').length
    const pubblicati = annunci.filter((a) => a.stato === 'pubblicato').length
    const chiusi = annunci.filter((a) => a.stato === 'chiuso').length
    return { totale, bozze, pubblicati, chiusi }
  }, [annunci])

  const openNew = () => {
    setForm(emptyForm)
    setEditingId(null)
    setModalOpen(true)
  }

  const openEdit = (annuncio: AnnuncioLavoro) => {
    setForm({
      ruolo: annuncio.ruolo,
      competenze: annuncio.competenze ?? '',
      tipo_contratto: annuncio.tipo_contratto ?? '',
      sede: annuncio.sede ?? '',
      ral_min: annuncio.ral_min?.toString() ?? '',
      ral_max: annuncio.ral_max?.toString() ?? '',
      contenuto: annuncio.contenuto,
      stato: annuncio.stato,
    })
    setEditingId(annuncio.id)
    setModalOpen(true)
  }

  const handleGenerate = async () => {
    if (!form.ruolo.trim()) {
      toast.error('Inserisci il ruolo prima di generare')
      return
    }
    setGenerating(true)
    try {
      const text = await generateAnnuncioLavoro({
        ruolo: form.ruolo,
        competenze: form.competenze,
        tipo_contratto: form.tipo_contratto,
        sede: form.sede,
        ral_min: form.ral_min ? parseFloat(form.ral_min) : undefined,
        ral_max: form.ral_max ? parseFloat(form.ral_max) : undefined,
      })
      setForm((p) => ({ ...p, contenuto: text }))
      toast.success('Annuncio generato con AI')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Errore nella generazione')
    } finally {
      setGenerating(false)
    }
  }

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    if (!profile?.azienda_id) return
    if (!form.ruolo.trim()) {
      toast.error('Il ruolo è obbligatorio')
      return
    }
    if (!form.contenuto.trim()) {
      toast.error('Il contenuto è obbligatorio')
      return
    }

    const payload = {
      azienda_id: profile.azienda_id,
      ruolo: form.ruolo,
      competenze: form.competenze || null,
      tipo_contratto: form.tipo_contratto || null,
      sede: form.sede || null,
      ral_min: form.ral_min ? parseFloat(form.ral_min) : null,
      ral_max: form.ral_max ? parseFloat(form.ral_max) : null,
      contenuto: form.contenuto,
      stato: form.stato,
    }

    if (editingId) {
      await update(editingId, payload)
      toast.success('Annuncio aggiornato')
    } else {
      const created = await create(payload)
      if (created) toast.success('Annuncio salvato')
      else toast.error('Errore nel salvataggio')
    }
    setModalOpen(false)
  }

  const handleDelete = async (annuncio: AnnuncioLavoro) => {
    if (!confirm(`Eliminare l'annuncio "${annuncio.ruolo}"?`)) return
    await remove(annuncio.id)
    toast.success('Annuncio eliminato')
  }

  const columns: Column<AnnuncioLavoro>[] = [
    {
      key: 'ruolo',
      header: 'Ruolo',
      render: (row) => (
        <div>
          <p className="font-medium">{row.ruolo}</p>
          {row.sede && <p className="text-xs text-text3">{row.sede}</p>}
        </div>
      ),
    },
    {
      key: 'tipo_contratto',
      header: 'Contratto',
      render: (row) => <span className="text-sm text-text2">{row.tipo_contratto ?? '-'}</span>,
    },
    {
      key: 'stato',
      header: 'Stato',
      render: (row) => <Badge color={STATO_COLORS[row.stato]}>{STATO_LABELS[row.stato]}</Badge>,
    },
    {
      key: 'data',
      header: 'Data Creazione',
      render: (row) => <span className="text-sm text-text2">{formatDate(row.created_at)}</span>,
    },
    {
      key: 'azioni',
      header: '',
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
          <h1 className="text-2xl font-bold font-display text-text">Annunci Lavoro</h1>
          <p className="text-sm text-text3 mt-1">Crea e gestisci gli annunci di lavoro con AI</p>
        </div>
        <Button variant="primary" onClick={openNew}>
          <Plus size={16} />
          Nuovo Annuncio
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard icon={FileText} label="Totale Annunci" value={String(stats.totale)} />
        <StatCard icon={FileText} label="Bozze" value={String(stats.bozze)} />
        <StatCard icon={Eye} label="Pubblicati" value={String(stats.pubblicati)} />
        <StatCard icon={XCircle} label="Chiusi" value={String(stats.chiusi)} />
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-4">
        <div className="flex-1 max-w-sm">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text3" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cerca per ruolo, sede, competenze..."
              className="pl-9"
            />
          </div>
        </div>
        <Select
          value={filterStato}
          onChange={(e) => setFilterStato(e.target.value)}
          options={[
            { value: 'tutti', label: 'Tutti gli stati' },
            { value: 'bozza', label: 'Bozza' },
            { value: 'pubblicato', label: 'Pubblicato' },
            { value: 'chiuso', label: 'Chiuso' },
          ]}
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
          emptyMessage="Nessun annuncio trovato."
          onRowClick={openEdit}
        />
      )}

      {/* Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? 'Modifica Annuncio' : 'Nuovo Annuncio'}
        className="max-w-2xl"
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Ruolo"
              value={form.ruolo}
              onChange={(e) => setForm((p) => ({ ...p, ruolo: e.target.value }))}
              placeholder="Es. Frontend Developer"
              required
            />
            <Select
              label="Tipo Contratto"
              value={form.tipo_contratto}
              onChange={(e) => setForm((p) => ({ ...p, tipo_contratto: e.target.value }))}
              options={TIPO_CONTRATTO_OPTIONS}
            />
          </div>

          <Textarea
            label="Competenze Richieste"
            value={form.competenze}
            onChange={(e) => setForm((p) => ({ ...p, competenze: e.target.value }))}
            placeholder="Es. React, TypeScript, Node.js..."
          />

          <Input
            label="Sede"
            value={form.sede}
            onChange={(e) => setForm((p) => ({ ...p, sede: e.target.value }))}
            placeholder="Es. Milano, remoto..."
          />

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="RAL Minima"
              type="number"
              min={0}
              step={1000}
              value={form.ral_min}
              onChange={(e) => setForm((p) => ({ ...p, ral_min: e.target.value }))}
              placeholder="Es. 30000"
            />
            <Input
              label="RAL Massima"
              type="number"
              min={0}
              step={1000}
              value={form.ral_max}
              onChange={(e) => setForm((p) => ({ ...p, ral_max: e.target.value }))}
              placeholder="Es. 45000"
            />
          </div>

          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-text2">Contenuto Annuncio</label>
            <Button
              type="button"
              size="sm"
              variant="primary"
              onClick={handleGenerate}
              disabled={generating}
            >
              <Sparkles size={14} />
              {generating ? 'Generazione...' : 'Genera con AI'}
            </Button>
          </div>

          {generating && (
            <div className="flex items-center justify-center py-6">
              <div className="text-gold text-sm animate-pulse">Generazione in corso...</div>
            </div>
          )}

          <Textarea
            value={form.contenuto}
            onChange={(e) => setForm((p) => ({ ...p, contenuto: e.target.value }))}
            placeholder="Testo dell'annuncio..."
            className="min-h-[200px]"
          />

          <Select
            label="Stato"
            value={form.stato}
            onChange={(e) =>
              setForm((p) => ({ ...p, stato: e.target.value as AnnuncioLavoroStato }))
            }
            options={[
              { value: 'bozza', label: 'Bozza' },
              { value: 'pubblicato', label: 'Pubblicato' },
              { value: 'chiuso', label: 'Chiuso' },
            ]}
          />

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" onClick={() => setModalOpen(false)}>
              Annulla
            </Button>
            <Button type="submit" variant="primary">
              <Save size={16} />
              {editingId ? 'Aggiorna' : 'Salva'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
