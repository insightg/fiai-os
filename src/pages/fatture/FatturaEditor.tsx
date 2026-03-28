import { useState, useEffect, useMemo, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Plus, Trash2, Save, Eye, FileText, Send, ArrowLeft } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore, useFattureStore, useClientiStore } from '../../store'
import { supabase } from '../../lib/supabase'
import Button from '../../components/ui/Button'
import { Input, Select, Textarea } from '../../components/ui/Form'
import Badge from '../../components/ui/Badge'
import { generateInvoicePdfBlob, downloadBlob } from '../../lib/pdf'
import { generateFatturaPA, downloadXml } from '../../lib/xml-sdi'
import type { Fattura, FatturaRiga, FatturaStato, Azienda, Cliente } from '../../types'

interface LocalRiga {
  id: string
  descrizione: string
  quantita: number
  prezzo_unitario: number
  iva_percent: number
  ordine: number
  isNew?: boolean
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n)
}

function generateTempId(): string {
  return `temp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

export default function FatturaEditor() {
  const { id } = useParams<{ id: string }>()
  const isNew = !id || id === 'nuova'
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)
  const fattureStore = useFattureStore()
  const { clienti, fetch: fetchClienti } = useClientiStore()
  const [azienda, setAzienda] = useState<Azienda | null>(null)
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState({
    numero: '',
    cliente_id: '',
    data: new Date().toISOString().split('T')[0],
    scadenza: '',
    stato: 'bozza' as FatturaStato,
    oggetto: '',
    ordine_id: '' as string | null,
    metodo_pagamento: 'bonifico',
    note: '',
  })

  const [righe, setRighe] = useState<LocalRiga[]>([
    { id: generateTempId(), descrizione: '', quantita: 1, prezzo_unitario: 0, iva_percent: 22, ordine: 1, isNew: true },
  ])

  const [clientSearch, setClientSearch] = useState('')
  const [showClientDropdown, setShowClientDropdown] = useState(false)

  useEffect(() => {
    if (profile?.azienda_id) {
      fetchClienti(profile.azienda_id)
      supabase
        .from('aziende')
        .select('*')
        .eq('id', profile.azienda_id)
        .single()
        .then(({ data }) => {
          if (data) setAzienda(data as Azienda)
        })
    }
  }, [profile?.azienda_id, fetchClienti])

  useEffect(() => {
    if (!isNew && id) {
      fattureStore.fetchOne(id).then((fattura) => {
        if (fattura) {
          setForm({
            numero: fattura.numero,
            cliente_id: fattura.cliente_id,
            data: fattura.data,
            scadenza: fattura.scadenza ?? '',
            stato: fattura.stato,
            oggetto: fattura.oggetto ?? '',
            ordine_id: fattura.ordine_id,
            metodo_pagamento: fattura.metodo_pagamento ?? 'bonifico',
            note: fattura.note ?? '',
          })
          if (fattura.righe && fattura.righe.length > 0) {
            setRighe(fattura.righe.map((r) => ({ ...r, isNew: false })))
          }
          const cl = clienti.find((c) => c.id === fattura.cliente_id)
          if (cl) {
            setClientSearch(cl.tipo === 'azienda' && cl.ragione_sociale ? cl.ragione_sociale : cl.nome)
          }
        }
      })
    }
  }, [id, isNew])

  useEffect(() => {
    if (isNew && profile?.azienda_id) {
      const year = new Date().getFullYear()
      const count = fattureStore.fatture.filter((f) => f.data.startsWith(String(year))).length
      setForm((prev) => ({
        ...prev,
        numero: `FT-${year}-${String(count + 1).padStart(4, '0')}`,
      }))
    }
  }, [isNew, fattureStore.fatture.length, profile?.azienda_id])

  const filteredClienti = useMemo(() => {
    if (!clientSearch.trim()) return clienti
    const q = clientSearch.toLowerCase()
    return clienti.filter(
      (c) =>
        c.nome.toLowerCase().includes(q) ||
        (c.ragione_sociale ?? '').toLowerCase().includes(q) ||
        (c.email ?? '').toLowerCase().includes(q)
    )
  }, [clienti, clientSearch])

  const selectedCliente = useMemo(() => clienti.find((c) => c.id === form.cliente_id), [clienti, form.cliente_id])

  const totals = useMemo(() => {
    let imponibile = 0
    let iva = 0
    for (const riga of righe) {
      const rigaImponibile = riga.quantita * riga.prezzo_unitario
      imponibile += rigaImponibile
      iva += rigaImponibile * (riga.iva_percent / 100)
    }
    imponibile = Math.round(imponibile * 100) / 100
    iva = Math.round(iva * 100) / 100
    return { imponibile, iva, totale: Math.round((imponibile + iva) * 100) / 100 }
  }, [righe])

  const ivaBreakdown = useMemo(() => {
    const map = new Map<number, number>()
    for (const riga of righe) {
      const imp = riga.quantita * riga.prezzo_unitario
      const ivaAmount = imp * (riga.iva_percent / 100)
      map.set(riga.iva_percent, (map.get(riga.iva_percent) ?? 0) + ivaAmount)
    }
    return Array.from(map.entries()).map(([aliquota, importo]) => ({
      aliquota,
      importo: Math.round(importo * 100) / 100,
    }))
  }, [righe])

  const handleSelectCliente = (cliente: Cliente) => {
    setForm((prev) => ({ ...prev, cliente_id: cliente.id }))
    setClientSearch(cliente.tipo === 'azienda' && cliente.ragione_sociale ? cliente.ragione_sociale : cliente.nome)
    setShowClientDropdown(false)
  }

  const updateRiga = (idx: number, field: keyof LocalRiga, value: string | number) => {
    setRighe((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r))
    )
  }

  const addRiga = () => {
    setRighe((prev) => [
      ...prev,
      {
        id: generateTempId(),
        descrizione: '',
        quantita: 1,
        prezzo_unitario: 0,
        iva_percent: 22,
        ordine: prev.length + 1,
        isNew: true,
      },
    ])
  }

  const removeRiga = (idx: number) => {
    if (righe.length <= 1) return
    setRighe((prev) => prev.filter((_, i) => i !== idx).map((r, i) => ({ ...r, ordine: i + 1 })))
  }

  const handleSave = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!profile?.azienda_id || !form.cliente_id) {
      toast.error('Seleziona un cliente')
      return
    }
    setSaving(true)
    try {
      const fatturaData = {
        azienda_id: profile.azienda_id,
        cliente_id: form.cliente_id,
        ordine_id: form.ordine_id || null,
        numero: form.numero,
        data: form.data,
        scadenza: form.scadenza || null,
        stato: form.stato,
        oggetto: form.oggetto || null,
        imponibile: totals.imponibile,
        iva: totals.iva,
        totale: totals.totale,
        metodo_pagamento: form.metodo_pagamento || null,
        note: form.note || null,
        pagata_il: null,
      }

      if (isNew) {
        const created = await fattureStore.create(fatturaData)
        if (!created) {
          toast.error('Errore nella creazione fattura')
          setSaving(false)
          return
        }
        for (const riga of righe) {
          await fattureStore.addRiga({
            fattura_id: created.id,
            descrizione: riga.descrizione,
            quantita: riga.quantita,
            prezzo_unitario: riga.prezzo_unitario,
            iva_percent: riga.iva_percent,
            totale: Math.round(riga.quantita * riga.prezzo_unitario * (1 + riga.iva_percent / 100) * 100) / 100,
            ordine: riga.ordine,
          })
        }
        toast.success('Fattura creata')
        navigate(`/fatture/${created.id}/edit`, { replace: true })
      } else {
        await fattureStore.update(id as string, fatturaData)
        for (const riga of righe) {
          const rigaPayload = {
            descrizione: riga.descrizione,
            quantita: riga.quantita,
            prezzo_unitario: riga.prezzo_unitario,
            iva_percent: riga.iva_percent,
            totale: Math.round(riga.quantita * riga.prezzo_unitario * (1 + riga.iva_percent / 100) * 100) / 100,
            ordine: riga.ordine,
          }
          if (riga.isNew) {
            await fattureStore.addRiga({ ...rigaPayload, fattura_id: id as string })
          } else {
            await fattureStore.updateRiga(riga.id, rigaPayload)
          }
        }
        toast.success('Fattura aggiornata')
      }
    } catch {
      toast.error('Errore nel salvataggio')
    }
    setSaving(false)
  }

  const handlePreviewPdf = async () => {
    if (!azienda || !selectedCliente) {
      toast.error('Dati azienda o cliente mancanti')
      return
    }
    try {
      const fakeFattura: Fattura = {
        id: id ?? 'preview',
        azienda_id: profile?.azienda_id ?? '',
        cliente_id: form.cliente_id,
        ordine_id: form.ordine_id,
        numero: form.numero,
        data: form.data,
        scadenza: form.scadenza || null,
        stato: form.stato,
        oggetto: form.oggetto || null,
        imponibile: totals.imponibile,
        iva: totals.iva,
        totale: totals.totale,
        pagata_il: null,
        metodo_pagamento: form.metodo_pagamento || null,
        note: form.note || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      const fakeRighe: FatturaRiga[] = righe.map((r) => ({
        id: r.id,
        fattura_id: id ?? 'preview',
        descrizione: r.descrizione,
        quantita: r.quantita,
        prezzo_unitario: r.prezzo_unitario,
        iva_percent: r.iva_percent,
        totale: Math.round(r.quantita * r.prezzo_unitario * (1 + r.iva_percent / 100) * 100) / 100,
        ordine: r.ordine,
      }))
      const blob = await generateInvoicePdfBlob(fakeFattura, fakeRighe, azienda, selectedCliente)
      downloadBlob(blob, `Fattura_${form.numero}_Anteprima.pdf`)
      toast.success('Anteprima PDF generata')
    } catch {
      toast.error('Errore nella generazione PDF')
    }
  }

  const handleGeneraXml = async () => {
    if (!azienda || !selectedCliente) {
      toast.error('Dati azienda o cliente mancanti')
      return
    }
    try {
      const fakeFattura: Fattura = {
        id: id ?? 'preview',
        azienda_id: profile?.azienda_id ?? '',
        cliente_id: form.cliente_id,
        ordine_id: form.ordine_id,
        numero: form.numero,
        data: form.data,
        scadenza: form.scadenza || null,
        stato: form.stato,
        oggetto: form.oggetto || null,
        imponibile: totals.imponibile,
        iva: totals.iva,
        totale: totals.totale,
        pagata_il: null,
        metodo_pagamento: form.metodo_pagamento || null,
        note: form.note || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      const fakeRighe: FatturaRiga[] = righe.map((r) => ({
        id: r.id,
        fattura_id: id ?? 'preview',
        descrizione: r.descrizione,
        quantita: r.quantita,
        prezzo_unitario: r.prezzo_unitario,
        iva_percent: r.iva_percent,
        totale: Math.round(r.quantita * r.prezzo_unitario * (1 + r.iva_percent / 100) * 100) / 100,
        ordine: r.ordine,
      }))
      const xml = generateFatturaPA(fakeFattura, fakeRighe, azienda, selectedCliente)
      downloadXml(xml, `IT${azienda.piva.replace(/\s/g, '')}_${form.numero}.xml`)
      toast.success('XML FatturaPA generato')
    } catch {
      toast.error('Errore nella generazione XML')
    }
  }

  const handleInvia = async () => {
    setForm((prev) => ({ ...prev, stato: 'inviata_sdi' }))
    if (!isNew && id) {
      await fattureStore.update(id, { stato: 'inviata_sdi' })
      toast.success('Fattura segnata come Inviata')
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/fatture')}
          className="p-2 rounded-lg text-text3 hover:text-text hover:bg-bg3 transition-colors"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-2xl font-display font-bold text-text">
          {isNew ? 'Nuova Fattura' : `Fattura ${form.numero}`}
        </h1>
        <Badge color={form.stato === 'pagata' ? 'green' : form.stato === 'bozza' ? 'gray' : 'gold'}>
          {form.stato.replace('_', ' ').toUpperCase()}
        </Badge>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Header */}
        <div className="bg-bg2 border border-border rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold text-text mb-2">Dati Fattura</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Input
              label="Numero"
              value={form.numero}
              onChange={(e) => setForm((p) => ({ ...p, numero: e.target.value }))}
              required
            />
            <div className="relative">
              <Input
                label="Cliente"
                value={clientSearch}
                onChange={(e) => {
                  setClientSearch(e.target.value)
                  setShowClientDropdown(true)
                  if (!e.target.value) setForm((p) => ({ ...p, cliente_id: '' }))
                }}
                onFocus={() => setShowClientDropdown(true)}
                placeholder="Cerca cliente..."
                required
              />
              {showClientDropdown && filteredClienti.length > 0 && (
                <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-bg3 border border-border rounded-lg shadow-xl max-h-48 overflow-y-auto">
                  {filteredClienti.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handleSelectCliente(c)}
                      className="w-full text-left px-3 py-2 text-sm text-text hover:bg-bg4 transition-colors"
                    >
                      {c.tipo === 'azienda' && c.ragione_sociale ? c.ragione_sociale : c.nome}
                      {c.piva && <span className="text-text3 ml-2">P.IVA {c.piva}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Select
              label="Stato"
              value={form.stato}
              onChange={(e) => setForm((p) => ({ ...p, stato: e.target.value as FatturaStato }))}
              options={[
                { value: 'bozza', label: 'Bozza' },
                { value: 'emessa', label: 'Emessa' },
                { value: 'inviata_sdi', label: 'Inviata SDI' },
                { value: 'pagata', label: 'Pagata' },
                { value: 'scaduta', label: 'Scaduta' },
                { value: 'stornata', label: 'Stornata' },
              ]}
            />
            <Select
              label="Metodo Pagamento"
              value={form.metodo_pagamento}
              onChange={(e) => setForm((p) => ({ ...p, metodo_pagamento: e.target.value }))}
              options={[
                { value: 'bonifico', label: 'Bonifico Bancario' },
                { value: 'contanti', label: 'Contanti' },
                { value: 'carta', label: 'Carta di Credito' },
                { value: 'ri.ba', label: 'Ri.Ba.' },
              ]}
            />
            <Input
              label="Rif. Ordine (opzionale)"
              value={form.ordine_id ?? ''}
              onChange={(e) => setForm((p) => ({ ...p, ordine_id: e.target.value || null }))}
              placeholder="ID ordine..."
            />
          </div>
          <Input
            label="Oggetto"
            value={form.oggetto}
            onChange={(e) => setForm((p) => ({ ...p, oggetto: e.target.value }))}
            placeholder="Descrizione oggetto fattura..."
          />
        </div>

        {/* Line items */}
        <div className="bg-bg2 border border-border rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-text">Righe Fattura</h2>
            <Button type="button" size="sm" onClick={addRiga}>
              <Plus size={14} />
              Aggiungi Riga
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-2 py-2 text-left text-xs font-medium text-text3 uppercase w-[40%]">Descrizione</th>
                  <th className="px-2 py-2 text-right text-xs font-medium text-text3 uppercase w-[12%]">Quantita</th>
                  <th className="px-2 py-2 text-right text-xs font-medium text-text3 uppercase w-[15%]">Prezzo Unit.</th>
                  <th className="px-2 py-2 text-right text-xs font-medium text-text3 uppercase w-[10%]">IVA %</th>
                  <th className="px-2 py-2 text-right text-xs font-medium text-text3 uppercase w-[18%]">Totale Riga</th>
                  <th className="px-2 py-2 w-[5%]"></th>
                </tr>
              </thead>
              <tbody>
                {righe.map((riga, idx) => {
                  const rigaTotale = riga.quantita * riga.prezzo_unitario * (1 + riga.iva_percent / 100)
                  return (
                    <tr key={riga.id} className="border-b border-border/50">
                      <td className="px-1 py-1">
                        <input
                          type="text"
                          value={riga.descrizione}
                          onChange={(e) => updateRiga(idx, 'descrizione', e.target.value)}
                          className="w-full px-2 py-1.5 rounded bg-bg3 border border-border text-text text-sm focus:outline-none focus:ring-1 focus:ring-gold/50"
                          placeholder="Descrizione..."
                        />
                      </td>
                      <td className="px-1 py-1">
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          value={riga.quantita}
                          onChange={(e) => updateRiga(idx, 'quantita', parseFloat(e.target.value) || 0)}
                          className="w-full px-2 py-1.5 rounded bg-bg3 border border-border text-text text-sm text-right focus:outline-none focus:ring-1 focus:ring-gold/50"
                        />
                      </td>
                      <td className="px-1 py-1">
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          value={riga.prezzo_unitario}
                          onChange={(e) => updateRiga(idx, 'prezzo_unitario', parseFloat(e.target.value) || 0)}
                          className="w-full px-2 py-1.5 rounded bg-bg3 border border-border text-text text-sm text-right focus:outline-none focus:ring-1 focus:ring-gold/50"
                        />
                      </td>
                      <td className="px-1 py-1">
                        <select
                          value={riga.iva_percent}
                          onChange={(e) => updateRiga(idx, 'iva_percent', parseFloat(e.target.value))}
                          className="w-full px-2 py-1.5 rounded bg-bg3 border border-border text-text text-sm text-right focus:outline-none focus:ring-1 focus:ring-gold/50"
                        >
                          <option value={0}>0%</option>
                          <option value={4}>4%</option>
                          <option value={5}>5%</option>
                          <option value={10}>10%</option>
                          <option value={22}>22%</option>
                        </select>
                      </td>
                      <td className="px-2 py-1 text-right font-mono font-medium text-text">
                        {formatCurrency(rigaTotale)}
                      </td>
                      <td className="px-1 py-1">
                        <button
                          type="button"
                          onClick={() => removeRiga(idx)}
                          disabled={righe.length <= 1}
                          className="p-1 rounded text-text3 hover:text-red disabled:opacity-30 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="mt-4 flex justify-end">
            <div className="w-72 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-text2">Imponibile</span>
                <span className="font-mono font-medium text-text">{formatCurrency(totals.imponibile)}</span>
              </div>
              {ivaBreakdown.map((item) => (
                <div key={item.aliquota} className="flex justify-between text-sm">
                  <span className="text-text2">IVA {item.aliquota}%</span>
                  <span className="font-mono text-text">{formatCurrency(item.importo)}</span>
                </div>
              ))}
              <div className="flex justify-between text-sm border-t border-border pt-2">
                <span className="text-text2">Totale IVA</span>
                <span className="font-mono font-medium text-text">{formatCurrency(totals.iva)}</span>
              </div>
              <div className="flex justify-between text-lg font-bold border-t-2 border-gold pt-2">
                <span className="text-text">Totale</span>
                <span className="font-mono text-gold">{formatCurrency(totals.totale)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Note */}
        <div className="bg-bg2 border border-border rounded-xl p-6">
          <Textarea
            label="Note"
            value={form.note}
            onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))}
            placeholder="Note aggiuntive..."
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 flex-wrap">
          <Button type="submit" variant="primary" disabled={saving}>
            <Save size={16} />
            {saving ? 'Salvataggio...' : 'Salva'}
          </Button>
          <Button type="button" onClick={handlePreviewPdf}>
            <Eye size={16} />
            Anteprima PDF
          </Button>
          <Button type="button" onClick={handleGeneraXml}>
            <FileText size={16} />
            Genera XML
          </Button>
          {form.stato === 'bozza' || form.stato === 'emessa' ? (
            <Button type="button" onClick={handleInvia}>
              <Send size={16} />
              Invia
            </Button>
          ) : null}
        </div>
      </form>
    </div>
  )
}
