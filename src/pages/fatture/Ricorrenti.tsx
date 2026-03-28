import { useState, useEffect, useCallback } from 'react'
import { Plus, Play, Pause, Zap } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore, useFattureStore, useClientiStore } from '../../store'
import { supabase } from '../../lib/supabase'
import Table, { type Column } from '../../components/ui/Table'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import Modal from '../../components/ui/Modal'
import { Input, Select } from '../../components/ui/Form'
import type { Ricorrente, FrequenzaRicorrente } from '../../types'

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n)
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('it-IT')
}

const frequenzaLabels: Record<FrequenzaRicorrente, string> = {
  mensile: 'Mensile',
  bimestrale: 'Bimestrale',
  trimestrale: 'Trimestrale',
  semestrale: 'Semestrale',
  annuale: 'Annuale',
}

const frequenzaMonths: Record<FrequenzaRicorrente, number> = {
  mensile: 1,
  bimestrale: 2,
  trimestrale: 3,
  semestrale: 6,
  annuale: 12,
}

function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr)
  d.setMonth(d.getMonth() + months)
  return d.toISOString().split('T')[0]
}

interface RicorrenteForm {
  cliente_id: string
  descrizione: string
  importo: number
  iva_percent: number
  frequenza: FrequenzaRicorrente
  prossima_emissione: string
  attivo: boolean
}

const emptyForm: RicorrenteForm = {
  cliente_id: '',
  descrizione: '',
  importo: 0,
  iva_percent: 22,
  frequenza: 'mensile',
  prossima_emissione: new Date().toISOString().split('T')[0],
  attivo: true,
}

export default function Ricorrenti() {
  const profile = useAuthStore((s) => s.profile)
  const fattureStore = useFattureStore()
  const { clienti, fetch: fetchClienti } = useClientiStore()
  const [ricorrenti, setRicorrenti] = useState<Ricorrente[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<RicorrenteForm>(emptyForm)

  const fetchRicorrenti = useCallback(async () => {
    if (!profile?.azienda_id) return
    setLoading(true)
    const { data, error } = await supabase
      .from('ricorrenti')
      .select('*, cliente:clienti(*)')
      .eq('azienda_id', profile.azienda_id)
      .order('prossima_emissione', { ascending: true })
    if (error) {
      toast.error('Errore nel caricamento fatture ricorrenti')
      setLoading(false)
      return
    }
    setRicorrenti((data ?? []) as Ricorrente[])
    setLoading(false)
  }, [profile?.azienda_id])

  useEffect(() => {
    if (profile?.azienda_id) {
      fetchRicorrenti()
      fetchClienti(profile.azienda_id)
      fattureStore.fetch(profile.azienda_id)
    }
  }, [profile?.azienda_id, fetchRicorrenti, fetchClienti])

  // Auto-emission check
  useEffect(() => {
    const autoEmit = async () => {
      const today = new Date().toISOString().split('T')[0]
      const toEmit = ricorrenti.filter(
        (r) => r.attivo && r.prossima_emissione <= today
      )
      for (const ric of toEmit) {
        await emettiFattura(ric)
      }
      if (toEmit.length > 0) {
        toast.success(`${toEmit.length} fattura/e ricorrente/i emessa/e automaticamente`)
        fetchRicorrenti()
      }
    }
    if (ricorrenti.length > 0) {
      autoEmit()
    }
  }, [ricorrenti.length])

  const emettiFattura = async (ric: Ricorrente) => {
    if (!profile?.azienda_id) return
    const year = new Date().getFullYear()
    const count = fattureStore.fatture.filter((f) => f.data.startsWith(String(year))).length
    const numero = `FT-${year}-${String(count + 1).padStart(4, '0')}`
    const data = new Date().toISOString().split('T')[0]
    const scadenza = addMonths(data, 1)

    const imponibile = ric.importo
    const iva = Math.round(imponibile * (ric.iva_percent / 100) * 100) / 100
    const totale = Math.round((imponibile + iva) * 100) / 100

    const fattura = await fattureStore.create({
      azienda_id: profile.azienda_id,
      cliente_id: ric.cliente_id,
      ordine_id: null,
      numero,
      data,
      scadenza,
      stato: 'emessa',
      oggetto: ric.descrizione,
      imponibile,
      iva,
      totale,
      pagata_il: null,
      metodo_pagamento: 'bonifico',
      note: `Fattura ricorrente - ${frequenzaLabels[ric.frequenza]}`,
    })

    if (fattura) {
      await fattureStore.addRiga({
        fattura_id: fattura.id,
        descrizione: ric.descrizione,
        quantita: 1,
        prezzo_unitario: ric.importo,
        iva_percent: ric.iva_percent,
        totale,
        ordine: 1,
      })

      const nextDate = addMonths(ric.prossima_emissione, frequenzaMonths[ric.frequenza])
      await supabase
        .from('ricorrenti')
        .update({ prossima_emissione: nextDate })
        .eq('id', ric.id)
    }
  }

  const handleEmitNow = async (ric: Ricorrente) => {
    await emettiFattura(ric)
    toast.success('Fattura emessa')
    fetchRicorrenti()
  }

  const handleToggleAttivo = async (ric: Ricorrente) => {
    const { error } = await supabase
      .from('ricorrenti')
      .update({ attivo: !ric.attivo })
      .eq('id', ric.id)
    if (error) {
      toast.error('Errore nell\'aggiornamento')
      return
    }
    toast.success(ric.attivo ? 'Fattura sospesa' : 'Fattura riattivata')
    fetchRicorrenti()
  }

  const openNew = () => {
    setForm(emptyForm)
    setEditingId(null)
    setModalOpen(true)
  }

  const openEdit = (ric: Ricorrente) => {
    setForm({
      cliente_id: ric.cliente_id,
      descrizione: ric.descrizione,
      importo: ric.importo,
      iva_percent: ric.iva_percent,
      frequenza: ric.frequenza,
      prossima_emissione: ric.prossima_emissione,
      attivo: ric.attivo,
    })
    setEditingId(ric.id)
    setModalOpen(true)
  }

  const handleSave = async () => {
    if (!profile?.azienda_id || !form.cliente_id) {
      toast.error('Seleziona un cliente')
      return
    }
    setLoading(true)
    if (editingId) {
      const { error } = await supabase
        .from('ricorrenti')
        .update({
          cliente_id: form.cliente_id,
          descrizione: form.descrizione,
          importo: form.importo,
          iva_percent: form.iva_percent,
          frequenza: form.frequenza,
          prossima_emissione: form.prossima_emissione,
          attivo: form.attivo,
        })
        .eq('id', editingId)
      if (error) {
        toast.error('Errore nell\'aggiornamento')
      } else {
        toast.success('Fattura ricorrente aggiornata')
      }
    } else {
      const { error } = await supabase.from('ricorrenti').insert({
        azienda_id: profile.azienda_id,
        cliente_id: form.cliente_id,
        descrizione: form.descrizione,
        importo: form.importo,
        iva_percent: form.iva_percent,
        frequenza: form.frequenza,
        prossima_emissione: form.prossima_emissione,
        attivo: form.attivo,
      })
      if (error) {
        toast.error('Errore nella creazione')
      } else {
        toast.success('Fattura ricorrente creata')
      }
    }
    setModalOpen(false)
    setLoading(false)
    fetchRicorrenti()
  }

  const getClienteName = (ric: Ricorrente): string => {
    const c = ric.cliente
    if (!c) return '-'
    return c.tipo === 'azienda' && c.ragione_sociale ? c.ragione_sociale : c.nome
  }

  const columns: Column<Ricorrente>[] = [
    {
      key: 'cliente',
      header: 'Cliente',
      render: (r) => <span className="font-medium">{getClienteName(r)}</span>,
    },
    {
      key: 'descrizione',
      header: 'Descrizione',
      render: (r) => <span className="text-text2 truncate max-w-[200px] block">{r.descrizione}</span>,
    },
    {
      key: 'importo',
      header: 'Importo',
      render: (r) => <span className="font-mono font-medium">{formatCurrency(r.importo)}</span>,
    },
    {
      key: 'frequenza',
      header: 'Frequenza',
      render: (r) => <Badge color="blue">{frequenzaLabels[r.frequenza]}</Badge>,
    },
    {
      key: 'prossima',
      header: 'Prossima Emissione',
      render: (r) => {
        const isOverdue = r.prossima_emissione <= new Date().toISOString().split('T')[0]
        return (
          <span className={isOverdue && r.attivo ? 'text-red font-semibold' : 'text-text2'}>
            {formatDate(r.prossima_emissione)}
          </span>
        )
      },
    },
    {
      key: 'stato',
      header: 'Stato',
      render: (r) => (
        <Badge color={r.attivo ? 'green' : 'gray'}>
          {r.attivo ? 'Attivo' : 'Sospeso'}
        </Badge>
      ),
    },
    {
      key: 'azioni',
      header: '',
      render: (r) => (
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); handleEmitNow(r) }}
            className="p-1.5 rounded-lg text-text3 hover:text-gold hover:bg-bg3 transition-colors"
            title="Emetti Ora"
          >
            <Zap size={15} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleToggleAttivo(r) }}
            className="p-1.5 rounded-lg text-text3 hover:text-blue hover:bg-bg3 transition-colors"
            title={r.attivo ? 'Sospendi' : 'Riattiva'}
          >
            {r.attivo ? <Pause size={15} /> : <Play size={15} />}
          </button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold text-text">Fatture Ricorrenti</h1>
        <Button variant="primary" onClick={openNew}>
          <Plus size={16} />
          Nuova Ricorrente
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="text-gold font-display text-lg animate-pulse">Caricamento...</div>
        </div>
      ) : (
        <Table
          columns={columns}
          data={ricorrenti}
          keyExtractor={(r) => r.id}
          emptyMessage="Nessuna fattura ricorrente configurata."
          onRowClick={openEdit}
        />
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? 'Modifica Ricorrente' : 'Nuova Fattura Ricorrente'}
        className="max-w-lg"
      >
        <div className="space-y-4">
          <Select
            label="Cliente"
            value={form.cliente_id}
            onChange={(e) => setForm((p) => ({ ...p, cliente_id: e.target.value }))}
            options={[
              { value: '', label: 'Seleziona cliente...' },
              ...clienti.map((c) => ({
                value: c.id,
                label: c.tipo === 'azienda' && c.ragione_sociale ? c.ragione_sociale : c.nome,
              })),
            ]}
          />
          <Input
            label="Descrizione"
            value={form.descrizione}
            onChange={(e) => setForm((p) => ({ ...p, descrizione: e.target.value }))}
            required
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Importo (netto)"
              type="number"
              min={0}
              step={0.01}
              value={form.importo}
              onChange={(e) => setForm((p) => ({ ...p, importo: parseFloat(e.target.value) || 0 }))}
            />
            <Select
              label="IVA %"
              value={String(form.iva_percent)}
              onChange={(e) => setForm((p) => ({ ...p, iva_percent: parseFloat(e.target.value) }))}
              options={[
                { value: '0', label: '0%' },
                { value: '4', label: '4%' },
                { value: '5', label: '5%' },
                { value: '10', label: '10%' },
                { value: '22', label: '22%' },
              ]}
            />
          </div>
          <Select
            label="Frequenza"
            value={form.frequenza}
            onChange={(e) => setForm((p) => ({ ...p, frequenza: e.target.value as FrequenzaRicorrente }))}
            options={[
              { value: 'mensile', label: 'Mensile' },
              { value: 'bimestrale', label: 'Bimestrale' },
              { value: 'trimestrale', label: 'Trimestrale' },
              { value: 'semestrale', label: 'Semestrale' },
              { value: 'annuale', label: 'Annuale' },
            ]}
          />
          <Input
            label="Prossima Emissione"
            type="date"
            value={form.prossima_emissione}
            onChange={(e) => setForm((p) => ({ ...p, prossima_emissione: e.target.value }))}
          />
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="attivo"
              checked={form.attivo}
              onChange={(e) => setForm((p) => ({ ...p, attivo: e.target.checked }))}
              className="rounded border-border bg-bg3 text-gold focus:ring-gold/50"
            />
            <label htmlFor="attivo" className="text-sm text-text2">Attivo</label>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button onClick={() => setModalOpen(false)}>Annulla</Button>
            <Button variant="primary" onClick={handleSave}>
              {editingId ? 'Aggiorna' : 'Crea'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
