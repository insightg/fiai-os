import { useState, type FormEvent } from 'react'
import { Calculator, Euro, Wallet, DollarSign } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/Form'
import StatCard from '../../components/ui/StatCard'
import { simulateCostoDipendente } from '../../lib/hr-ai'
import type { CostoSimulazioneInput, CostoSimulazioneResult } from '../../types'

const REGIONI = [
  { value: '', label: 'Seleziona regione...' },
  { value: 'Abruzzo', label: 'Abruzzo' },
  { value: 'Basilicata', label: 'Basilicata' },
  { value: 'Calabria', label: 'Calabria' },
  { value: 'Campania', label: 'Campania' },
  { value: 'Emilia-Romagna', label: 'Emilia-Romagna' },
  { value: 'Friuli Venezia Giulia', label: 'Friuli Venezia Giulia' },
  { value: 'Lazio', label: 'Lazio' },
  { value: 'Liguria', label: 'Liguria' },
  { value: 'Lombardia', label: 'Lombardia' },
  { value: 'Marche', label: 'Marche' },
  { value: 'Molise', label: 'Molise' },
  { value: 'Piemonte', label: 'Piemonte' },
  { value: 'Puglia', label: 'Puglia' },
  { value: 'Sardegna', label: 'Sardegna' },
  { value: 'Sicilia', label: 'Sicilia' },
  { value: 'Toscana', label: 'Toscana' },
  { value: 'Trentino-Alto Adige', label: 'Trentino-Alto Adige' },
  { value: 'Umbria', label: 'Umbria' },
  { value: "Valle d'Aosta", label: "Valle d'Aosta" },
  { value: 'Veneto', label: 'Veneto' },
]

const TIPO_CONTRATTO_OPTIONS = [
  { value: 'indeterminato', label: 'Indeterminato' },
  { value: 'determinato', label: 'Determinato' },
  { value: 'apprendistato', label: 'Apprendistato' },
]

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n)
}

export default function CostoSimulatore() {
  const [form, setForm] = useState<CostoSimulazioneInput>({
    netto_desiderato: 1500,
    tipo_contratto: 'indeterminato',
    livello_ccnl: '',
    regione: '',
    part_time_percent: 100,
  })
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<CostoSimulazioneResult | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!form.regione) {
      toast.error('Seleziona una regione')
      return
    }
    if (!form.livello_ccnl.trim()) {
      toast.error('Inserisci il livello CCNL')
      return
    }

    setLoading(true)
    setResult(null)
    try {
      const data = await simulateCostoDipendente(form)
      setResult(data)
      toast.success('Simulazione completata')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Errore nella simulazione')
    } finally {
      setLoading(false)
    }
  }

  const breakdownRows = result
    ? [
        { label: 'RAL (Retribuzione Annua Lorda)', value: result.ral },
        { label: 'IRPEF', value: result.irpef },
        { label: 'Contributi INPS Dipendente', value: result.contributi_inps_dipendente },
        { label: 'Contributi INPS Azienda', value: result.contributi_inps_azienda },
        { label: 'INAIL', value: result.inail },
        { label: 'TFR Annuo', value: result.tfr_annuo },
        { label: 'IRAP', value: result.irap },
        { label: 'Addizionale Regionale', value: result.addizionale_regionale },
        { label: 'Addizionale Comunale', value: result.addizionale_comunale },
        { label: 'Costo Totale Azienda', value: result.costo_totale_azienda },
      ]
    : []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold font-display text-text">Simulatore Costo Dipendente</h1>
        <p className="text-sm text-text3 mt-1">
          Calcola il costo aziendale totale partendo dal netto desiderato
        </p>
      </div>

      {/* Form */}
      <div className="bg-bg2 border border-border rounded-xl p-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Input
              label="Netto Desiderato (mensile)"
              type="number"
              min={0}
              step={50}
              value={form.netto_desiderato}
              onChange={(e) =>
                setForm((p) => ({ ...p, netto_desiderato: parseFloat(e.target.value) || 0 }))
              }
              required
            />
            <Select
              label="Tipo Contratto"
              value={form.tipo_contratto}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  tipo_contratto: e.target.value as CostoSimulazioneInput['tipo_contratto'],
                }))
              }
              options={TIPO_CONTRATTO_OPTIONS}
            />
            <Input
              label="Livello CCNL"
              value={form.livello_ccnl}
              onChange={(e) => setForm((p) => ({ ...p, livello_ccnl: e.target.value }))}
              placeholder="Es. 3, 4, 5S..."
              required
            />
            <Select
              label="Regione"
              value={form.regione}
              onChange={(e) => setForm((p) => ({ ...p, regione: e.target.value }))}
              options={REGIONI}
            />
            <Input
              label="Part-Time %"
              type="number"
              min={10}
              max={100}
              step={5}
              value={form.part_time_percent}
              onChange={(e) =>
                setForm((p) => ({ ...p, part_time_percent: parseInt(e.target.value) || 100 }))
              }
            />
          </div>

          <div className="flex justify-end pt-2">
            <Button type="submit" variant="primary" disabled={loading}>
              <Calculator size={16} />
              {loading ? 'Calcolo in corso...' : 'Calcola'}
            </Button>
          </div>
        </form>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="text-gold font-display text-lg animate-pulse">
            Elaborazione AI in corso...
          </div>
        </div>
      )}

      {/* Results */}
      {result && !loading && (
        <>
          {/* Stat Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard icon={Euro} label="RAL" value={formatCurrency(result.ral)} />
            <StatCard
              icon={Wallet}
              label="Costo Totale Azienda"
              value={formatCurrency(result.costo_totale_azienda)}
            />
            <StatCard
              icon={DollarSign}
              label="Netto Mensile"
              value={formatCurrency(result.netto_mensile)}
            />
          </div>

          {/* Breakdown Table */}
          <div className="bg-bg2 border border-border rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="text-lg font-semibold text-text">Dettaglio Calcolo</h2>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-6 py-3 text-left text-xs font-medium text-text3 uppercase tracking-wider">
                    Voce
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-text3 uppercase tracking-wider">
                    Importo Annuo
                  </th>
                </tr>
              </thead>
              <tbody>
                {breakdownRows.map((row, i) => (
                  <tr
                    key={row.label}
                    className={`border-b border-border/50 ${
                      i === breakdownRows.length - 1 ? 'bg-bg3 font-semibold' : ''
                    }`}
                  >
                    <td className="px-6 py-3 text-text">{row.label}</td>
                    <td className="px-6 py-3 text-right text-text font-mono">
                      {formatCurrency(row.value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Spiegazione */}
          {result.spiegazione && (
            <div className="bg-bg2 border border-border rounded-xl p-6">
              <h3 className="text-sm font-semibold text-text2 uppercase tracking-wider mb-3">
                Spiegazione
              </h3>
              <p className="text-text2 text-sm leading-relaxed whitespace-pre-wrap">
                {result.spiegazione}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
