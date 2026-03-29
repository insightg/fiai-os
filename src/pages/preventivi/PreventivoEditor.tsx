import { useState, useEffect, useMemo, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePreventiviStore, useClientiStore, useOrdiniStore, useAuthStore } from '../../store'
import type { Preventivo, PreventivoStato } from '../../types'
import Button from '../../components/ui/Button'
import { Input, Select, Textarea } from '../../components/ui/Form'
import { Plus, Trash2, FileText, ArrowRight } from 'lucide-react'
import toast from 'react-hot-toast'

interface PreventivoEditorProps {
  preventivo?: Preventivo | null
  onClose: () => void
  initialClienteId?: string
  initialImporto?: number
  initialOggetto?: string
  initialNote?: string
}

const STATO_OPTIONS: { value: PreventivoStato; label: string }[] = [
  { value: 'bozza', label: 'Bozza' },
  { value: 'inviato', label: 'Inviato' },
  { value: 'accettato', label: 'Accettato' },
  { value: 'rifiutato', label: 'Rifiutato' },
  { value: 'scaduto', label: 'Scaduto' },
]

interface LocalRiga {
  tempId: string
  id?: string
  descrizione: string
  quantita: number
  prezzo_unitario: number
  iva_percent: number
  totale: number
  ordine: number
}

function generateTempId(): string {
  return `tmp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
}

export default function PreventivoEditor({
  preventivo,
  onClose,
  initialClienteId,
  initialImporto,
  initialOggetto,
  initialNote,
}: PreventivoEditorProps) {
  const profile = useAuthStore((s) => s.profile)
  const clienti = useClientiStore((s) => s.clienti)
  const {
    create: createPreventivo,
    update: updatePreventivo,
    addRiga,
    updateRiga,
    removeRiga,
    fetchOne,
    loading,
  } = usePreventiviStore()
  const { create: createOrdine } = useOrdiniStore()
  const navigate = useNavigate()

  const [clienteId, setClienteId] = useState(preventivo?.cliente_id ?? initialClienteId ?? '')
  const [clienteSearch, setClienteSearch] = useState('')
  const [showClienteDropdown, setShowClienteDropdown] = useState(false)
  const [numero, setNumero] = useState(
    preventivo?.numero ?? `PRE-${Date.now().toString(36).toUpperCase()}`
  )
  const [data, setData] = useState(
    preventivo?.data ?? new Date().toISOString().split('T')[0]
  )
  const [validitaGiorni, setValiditaGiorni] = useState('30')
  const [stato, setStato] = useState<PreventivoStato>(preventivo?.stato ?? 'bozza')
  const [oggetto, setOggetto] = useState(preventivo?.oggetto ?? initialOggetto ?? '')
  const [note, setNote] = useState(preventivo?.note ?? initialNote ?? '')
  const [righe, setRighe] = useState<LocalRiga[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Load righe from existing preventivo
  useEffect(() => {
    if (preventivo?.id) {
      fetchOne(preventivo.id).then((p) => {
        if (p?.righe && p.righe.length > 0) {
          setRighe(
            p.righe.map((r) => ({
              tempId: generateTempId(),
              id: r.id,
              descrizione: r.descrizione,
              quantita: r.quantita,
              prezzo_unitario: r.prezzo_unitario,
              iva_percent: r.iva_percent,
              totale: r.totale,
              ordine: r.ordine,
            }))
          )
        }
      })
    } else if (initialImporto && righe.length === 0) {
      // Pre-populate a single row from conversion
      setRighe([
        {
          tempId: generateTempId(),
          descrizione: initialOggetto ?? 'Servizio',
          quantita: 1,
          prezzo_unitario: initialImporto,
          iva_percent: 22,
          totale: initialImporto,
          ordine: 0,
        },
      ])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preventivo?.id])

  // Client search
  const filteredClienti = useMemo(() => {
    if (!clienteSearch) return clienti.slice(0, 10)
    const q = clienteSearch.toLowerCase()
    return clienti.filter(
      (c) =>
        c.nome.toLowerCase().includes(q) ||
        (c.ragione_sociale?.toLowerCase().includes(q) ?? false)
    ).slice(0, 10)
  }, [clienti, clienteSearch])

  const selectedCliente = clienti.find((c) => c.id === clienteId)

  // Totals
  const totals = useMemo(() => {
    const imponibile = righe.reduce((sum, r) => sum + r.totale, 0)
    const iva = righe.reduce((sum, r) => sum + r.totale * (r.iva_percent / 100), 0)
    const totale = imponibile + iva
    return {
      imponibile: Math.round(imponibile * 100) / 100,
      iva: Math.round(iva * 100) / 100,
      totale: Math.round(totale * 100) / 100,
    }
  }, [righe])

  function addNewRiga() {
    setRighe([
      ...righe,
      {
        tempId: generateTempId(),
        descrizione: '',
        quantita: 1,
        prezzo_unitario: 0,
        iva_percent: 22,
        totale: 0,
        ordine: righe.length,
      },
    ])
  }

  function updateLocalRiga(tempId: string, field: keyof LocalRiga, value: string | number) {
    setRighe((prev) =>
      prev.map((r) => {
        if (r.tempId !== tempId) return r
        const updated = { ...r, [field]: value }
        if (field === 'quantita' || field === 'prezzo_unitario') {
          updated.totale =
            Math.round(
              (field === 'quantita' ? (value as number) : updated.quantita) *
                (field === 'prezzo_unitario' ? (value as number) : updated.prezzo_unitario) *
                100
            ) / 100
        }
        return updated
      })
    )
  }

  function removeLocalRiga(tempId: string) {
    setRighe((prev) => prev.filter((r) => r.tempId !== tempId))
  }

  function validate(): boolean {
    const errs: Record<string, string> = {}
    if (!clienteId) errs.cliente = 'Selezionare un cliente'
    if (!numero.trim()) errs.numero = 'Il numero è obbligatorio'
    if (righe.length === 0) errs.righe = 'Aggiungere almeno una riga'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    if (!validate() || !profile) return

    const scadenza = validitaGiorni
      ? new Date(new Date(data).getTime() + Number(validitaGiorni) * 86400000)
          .toISOString()
          .split('T')[0]
      : null

    const prevPayload = {
      azienda_id: profile.azienda_id,
      cliente_id: clienteId,
      numero: numero.trim(),
      data,
      scadenza,
      stato,
      oggetto: oggetto.trim() || null,
      note: note.trim() || null,
      imponibile: totals.imponibile,
      iva: totals.iva,
      totale: totals.totale,
    }

    if (preventivo) {
      await updatePreventivo(preventivo.id, prevPayload)

      // Sync righe: delete removed, update existing, add new
      const existingIds = righe.filter((r) => r.id).map((r) => r.id!)
      const originalIds = preventivo.righe?.map((r) => r.id) ?? []
      const toDelete = originalIds.filter((id) => !existingIds.includes(id))

      for (const id of toDelete) {
        await removeRiga(id)
      }
      for (const riga of righe) {
        if (riga.id) {
          await updateRiga(riga.id, {
            descrizione: riga.descrizione,
            quantita: riga.quantita,
            prezzo_unitario: riga.prezzo_unitario,
            iva_percent: riga.iva_percent,
            totale: riga.totale,
            ordine: riga.ordine,
          })
        } else {
          await addRiga({
            preventivo_id: preventivo.id,
            descrizione: riga.descrizione,
            quantita: riga.quantita,
            prezzo_unitario: riga.prezzo_unitario,
            iva_percent: riga.iva_percent,
            totale: riga.totale,
            ordine: riga.ordine,
          })
        }
      }

      toast.success('Preventivo aggiornato con successo')
    } else {
      const created = await createPreventivo(prevPayload)
      if (!created) {
        toast.error('Errore nella creazione del preventivo')
        return
      }

      // Add righe
      for (const riga of righe) {
        await addRiga({
          preventivo_id: created.id,
          descrizione: riga.descrizione,
          quantita: riga.quantita,
          prezzo_unitario: riga.prezzo_unitario,
          iva_percent: riga.iva_percent,
          totale: riga.totale,
          ordine: riga.ordine,
        })
      }

      toast.success('Preventivo creato con successo')
    }

    onClose()
  }

  async function handleConvertToOrdine() {
    if (!profile || !preventivo) return

    const ordine = await createOrdine({
      azienda_id: profile.azienda_id,
      cliente_id: clienteId,
      preventivo_id: preventivo.id,
      numero: `ORD-${Date.now().toString(36).toUpperCase()}`,
      data: new Date().toISOString().split('T')[0],
      stato: 'confermato',
      imponibile: totals.imponibile,
      iva: totals.iva,
      totale: totals.totale,
      note: `Generato dal preventivo ${numero}`,
    })

    if (ordine) {
      await updatePreventivo(preventivo.id, { stato: 'accettato' })
      toast.success('Preventivo convertito in ordine')
      navigate('/app/ordini')
    } else {
      toast.error('Errore nella conversione in ordine')
    }
  }

  function formatEuro(value: number): string {
    return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(value)
  }

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-5">
      {/* Header Fields */}
      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Numero"
          value={numero}
          onChange={(e) => setNumero(e.target.value)}
          error={errors.numero}
        />
        <Select
          label="Stato"
          value={stato}
          onChange={(e) => setStato(e.target.value as PreventivoStato)}
          options={STATO_OPTIONS}
        />
      </div>

      {/* Cliente Search */}
      <div className="flex flex-col gap-1.5 relative">
        <label className="text-sm font-medium text-text2">Cliente *</label>
        {selectedCliente ? (
          <div className="flex items-center gap-2 bg-bg3 border border-border rounded-lg px-3 py-2">
            <span className="text-sm text-text flex-1">
              {selectedCliente.ragione_sociale ?? `${selectedCliente.nome} ${selectedCliente.cognome ?? ''}`}
            </span>
            <button
              type="button"
              onClick={() => { setClienteId(''); setClienteSearch('') }}
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
                      setClienteId(c.id)
                      setClienteSearch('')
                      setShowClienteDropdown(false)
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-text hover:bg-bg3 transition-colors"
                  >
                    {c.ragione_sociale ?? `${c.nome} ${c.cognome ?? ''}`}
                    {c.piva && <span className="text-text3 ml-2">({c.piva})</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Data"
          type="date"
          value={data}
          onChange={(e) => setData(e.target.value)}
        />
        <Input
          label="Validità (giorni)"
          type="number"
          value={validitaGiorni}
          onChange={(e) => setValiditaGiorni(e.target.value)}
          min={1}
        />
      </div>

      <Input
        label="Oggetto"
        value={oggetto}
        onChange={(e) => setOggetto(e.target.value)}
        placeholder="Oggetto del preventivo"
      />

      {/* Line Items */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-text">Righe preventivo</h3>
          <Button type="button" size="sm" onClick={addNewRiga}>
            <Plus size={14} />
            Aggiungi riga
          </Button>
        </div>

        {errors.righe && <p className="text-xs text-red mb-2">{errors.righe}</p>}

        <div className="space-y-2">
          {/* Header */}
          {righe.length > 0 && (
            <div className="grid grid-cols-12 gap-2 text-xs text-text3 font-medium px-1">
              <div className="col-span-5">Descrizione</div>
              <div className="col-span-1 text-center">Qtà</div>
              <div className="col-span-2 text-right">Prezzo Unit.</div>
              <div className="col-span-1 text-center">IVA%</div>
              <div className="col-span-2 text-right">Totale</div>
              <div className="col-span-1" />
            </div>
          )}

          {righe.map((riga) => (
            <div
              key={riga.tempId}
              className="grid grid-cols-12 gap-2 items-center bg-bg3 rounded-lg p-2"
            >
              <div className="col-span-5">
                <input
                  value={riga.descrizione}
                  onChange={(e) => updateLocalRiga(riga.tempId, 'descrizione', e.target.value)}
                  className="w-full bg-bg border border-border rounded px-2 py-1.5 text-sm text-text placeholder:text-text3 focus:outline-none focus:border-gold/50"
                  placeholder="Descrizione"
                />
              </div>
              <div className="col-span-1">
                <input
                  type="number"
                  value={riga.quantita}
                  onChange={(e) =>
                    updateLocalRiga(riga.tempId, 'quantita', Number(e.target.value))
                  }
                  className="w-full bg-bg border border-border rounded px-2 py-1.5 text-sm text-text text-center focus:outline-none focus:border-gold/50"
                  min={0}
                  step={1}
                />
              </div>
              <div className="col-span-2">
                <input
                  type="number"
                  value={riga.prezzo_unitario}
                  onChange={(e) =>
                    updateLocalRiga(riga.tempId, 'prezzo_unitario', Number(e.target.value))
                  }
                  className="w-full bg-bg border border-border rounded px-2 py-1.5 text-sm text-text text-right focus:outline-none focus:border-gold/50"
                  min={0}
                  step={0.01}
                />
              </div>
              <div className="col-span-1">
                <input
                  type="number"
                  value={riga.iva_percent}
                  onChange={(e) =>
                    updateLocalRiga(riga.tempId, 'iva_percent', Number(e.target.value))
                  }
                  className="w-full bg-bg border border-border rounded px-2 py-1.5 text-sm text-text text-center focus:outline-none focus:border-gold/50"
                  min={0}
                  max={100}
                />
              </div>
              <div className="col-span-2 text-right text-sm text-gold font-medium pr-1">
                {formatEuro(riga.totale)}
              </div>
              <div className="col-span-1 flex justify-center">
                <button
                  type="button"
                  onClick={() => removeLocalRiga(riga.tempId)}
                  className="text-text3 hover:text-red transition-colors p-1"
                  title="Rimuovi riga"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Totals */}
      <div className="bg-bg3 border border-border rounded-xl p-4">
        <div className="flex flex-col gap-2 items-end text-sm">
          <div className="flex justify-between w-64">
            <span className="text-text3">Imponibile:</span>
            <span className="text-text font-medium">{formatEuro(totals.imponibile)}</span>
          </div>
          <div className="flex justify-between w-64">
            <span className="text-text3">IVA:</span>
            <span className="text-text font-medium">{formatEuro(totals.iva)}</span>
          </div>
          <div className="flex justify-between w-64 pt-2 border-t border-border">
            <span className="text-text font-semibold">Totale:</span>
            <span className="text-gold text-lg font-bold">{formatEuro(totals.totale)}</span>
          </div>
        </div>
      </div>

      <Textarea
        label="Note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note aggiuntive..."
      />

      {/* Actions */}
      <div className="flex items-center justify-between mt-2">
        <div className="flex gap-2">
          {preventivo && stato === 'accettato' && (
            <Button type="button" variant="primary" onClick={handleConvertToOrdine}>
              <ArrowRight size={16} />
              Converti in Ordine
            </Button>
          )}
        </div>
        <div className="flex gap-3">
          <Button type="button" onClick={onClose}>
            Annulla
          </Button>
          <Button type="submit" variant="primary" disabled={loading}>
            <FileText size={16} />
            {loading ? 'Salvataggio...' : 'Salva Preventivo'}
          </Button>
        </div>
      </div>
    </form>
  )
}
