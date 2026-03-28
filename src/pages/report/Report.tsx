import { useEffect, useState, useCallback } from 'react'
import { Download, FileText, Calendar } from 'lucide-react'
import { Document, Page, Text, View, StyleSheet, pdf } from '@react-pdf/renderer'
import Button from '../../components/ui/Button'
import BarChart from '../../components/charts/BarChart'
import LineChart from '../../components/charts/LineChart'
import PieChart from '../../components/charts/PieChart'
import {
  formatEuro,
  fetchFatturatoMensileRange,
  fetchPipelinePerFase,
  fetchCashFlow,
  fetchTopClienti,
  fetchTopFornitori,
  fetchMargineMensile,
  type MonthlyAmount,
  type PipelineFase,
  type CashFlowMese,
  type ClienteRicavo,
  type FornitoreSpesa,
  type MargineMese,
} from '../../lib/analytics'

// ── Helpers ────────────────────────────────────────────────

function currentYearRange(): { from: string; to: string } {
  const y = new Date().getFullYear()
  return { from: `${y}-01-01`, to: `${y}-12-31` }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── CSV Export ─────────────────────────────────────────────

function generateCSV(
  fatturato: MonthlyAmount[],
  cashFlow: CashFlowMese[],
  margine: MargineMese[],
  clienti: ClienteRicavo[],
  fornitori: FornitoreSpesa[],
  pipeline: PipelineFase[],
): string {
  const lines: string[] = []

  lines.push('=== FATTURATO MENSILE ===')
  lines.push('Mese;Totale')
  for (const m of fatturato) lines.push(`${m.mese};${m.totale}`)
  lines.push('')

  lines.push('=== CASH FLOW ===')
  lines.push('Mese;Entrate;Uscite')
  for (const m of cashFlow) lines.push(`${m.mese};${m.entrate};${m.uscite}`)
  lines.push('')

  lines.push('=== MARGINE OPERATIVO ===')
  lines.push('Mese;Margine')
  for (const m of margine) lines.push(`${m.mese};${m.margine}`)
  lines.push('')

  lines.push('=== TOP CLIENTI PER RICAVO ===')
  lines.push('Cliente;Fatturato')
  for (const c of clienti) lines.push(`${c.name};${c.value}`)
  lines.push('')

  lines.push('=== TOP FORNITORI PER SPESA ===')
  lines.push('Fornitore;Spesa')
  for (const f of fornitori) lines.push(`${f.name};${f.value}`)
  lines.push('')

  lines.push('=== PIPELINE PER FASE ===')
  lines.push('Fase;Valore')
  for (const p of pipeline) lines.push(`${p.fase};${p.valore}`)

  return lines.join('\n')
}

// ── PDF Document ───────────────────────────────────────────

const pdfStyles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: '#1a1a1a',
  },
  title: {
    fontSize: 22,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 4,
    color: '#0D0D0F',
  },
  subtitle: {
    fontSize: 10,
    color: '#666',
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    marginTop: 18,
    marginBottom: 8,
    color: '#0D0D0F',
    borderBottomWidth: 1,
    borderBottomColor: '#C9A84C',
    paddingBottom: 4,
  },
  tableHeader: {
    flexDirection: 'row' as const,
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
    paddingBottom: 4,
    marginBottom: 4,
  },
  tableRow: {
    flexDirection: 'row' as const,
    paddingVertical: 2,
  },
  cellLeft: {
    flex: 1,
  },
  cellRight: {
    width: 100,
    textAlign: 'right' as const,
  },
  cellRight2: {
    width: 80,
    textAlign: 'right' as const,
  },
  headerText: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9,
    color: '#666',
  },
  footer: {
    position: 'absolute' as const,
    bottom: 30,
    left: 40,
    right: 40,
    textAlign: 'center' as const,
    fontSize: 8,
    color: '#999',
  },
})

interface PDFDocProps {
  from: string
  to: string
  fatturato: MonthlyAmount[]
  cashFlow: CashFlowMese[]
  margine: MargineMese[]
  clienti: ClienteRicavo[]
  fornitori: FornitoreSpesa[]
  pipeline: PipelineFase[]
}

function ReportPDFDocument({
  from,
  to,
  fatturato,
  cashFlow,
  margine,
  clienti,
  fornitori,
  pipeline,
}: PDFDocProps) {
  return (
    <Document>
      <Page size="A4" style={pdfStyles.page}>
        <Text style={pdfStyles.title}>Report Finanziario</Text>
        <Text style={pdfStyles.subtitle}>
          Periodo: {new Date(from).toLocaleDateString('it-IT')} - {new Date(to).toLocaleDateString('it-IT')}
        </Text>

        {/* Fatturato Mensile */}
        <Text style={pdfStyles.sectionTitle}>Fatturato Mensile</Text>
        <View style={pdfStyles.tableHeader}>
          <Text style={[pdfStyles.cellLeft, pdfStyles.headerText]}>Mese</Text>
          <Text style={[pdfStyles.cellRight, pdfStyles.headerText]}>Totale</Text>
        </View>
        {fatturato.filter((m) => m.totale > 0).map((m) => (
          <View key={m.mese} style={pdfStyles.tableRow}>
            <Text style={pdfStyles.cellLeft}>{m.mese}</Text>
            <Text style={pdfStyles.cellRight}>{formatEuro(m.totale)}</Text>
          </View>
        ))}

        {/* Cash Flow */}
        <Text style={pdfStyles.sectionTitle}>Cash Flow</Text>
        <View style={pdfStyles.tableHeader}>
          <Text style={[pdfStyles.cellLeft, pdfStyles.headerText]}>Mese</Text>
          <Text style={[pdfStyles.cellRight2, pdfStyles.headerText]}>Entrate</Text>
          <Text style={[pdfStyles.cellRight2, pdfStyles.headerText]}>Uscite</Text>
        </View>
        {cashFlow.filter((m) => m.entrate > 0 || m.uscite > 0).map((m) => (
          <View key={m.mese} style={pdfStyles.tableRow}>
            <Text style={pdfStyles.cellLeft}>{m.mese}</Text>
            <Text style={pdfStyles.cellRight2}>{formatEuro(m.entrate)}</Text>
            <Text style={pdfStyles.cellRight2}>{formatEuro(m.uscite)}</Text>
          </View>
        ))}

        {/* Margine */}
        <Text style={pdfStyles.sectionTitle}>Margine Operativo</Text>
        <View style={pdfStyles.tableHeader}>
          <Text style={[pdfStyles.cellLeft, pdfStyles.headerText]}>Mese</Text>
          <Text style={[pdfStyles.cellRight, pdfStyles.headerText]}>Margine</Text>
        </View>
        {margine.filter((m) => m.margine !== 0).map((m) => (
          <View key={m.mese} style={pdfStyles.tableRow}>
            <Text style={pdfStyles.cellLeft}>{m.mese}</Text>
            <Text style={pdfStyles.cellRight}>{formatEuro(m.margine)}</Text>
          </View>
        ))}

        <Text style={pdfStyles.footer}>
          Generato da FIAI OS il {new Date().toLocaleDateString('it-IT')}
        </Text>
      </Page>

      <Page size="A4" style={pdfStyles.page}>
        {/* Top Clienti */}
        <Text style={pdfStyles.sectionTitle}>Top Clienti per Fatturato</Text>
        <View style={pdfStyles.tableHeader}>
          <Text style={[pdfStyles.cellLeft, pdfStyles.headerText]}>Cliente</Text>
          <Text style={[pdfStyles.cellRight, pdfStyles.headerText]}>Fatturato</Text>
        </View>
        {clienti.map((c) => (
          <View key={c.name} style={pdfStyles.tableRow}>
            <Text style={pdfStyles.cellLeft}>{c.name}</Text>
            <Text style={pdfStyles.cellRight}>{formatEuro(c.value)}</Text>
          </View>
        ))}

        {/* Top Fornitori */}
        <Text style={pdfStyles.sectionTitle}>Top Fornitori per Spesa</Text>
        <View style={pdfStyles.tableHeader}>
          <Text style={[pdfStyles.cellLeft, pdfStyles.headerText]}>Fornitore</Text>
          <Text style={[pdfStyles.cellRight, pdfStyles.headerText]}>Spesa</Text>
        </View>
        {fornitori.map((f) => (
          <View key={f.name} style={pdfStyles.tableRow}>
            <Text style={pdfStyles.cellLeft}>{f.name}</Text>
            <Text style={pdfStyles.cellRight}>{formatEuro(f.value)}</Text>
          </View>
        ))}

        {/* Pipeline */}
        <Text style={pdfStyles.sectionTitle}>Pipeline per Fase</Text>
        <View style={pdfStyles.tableHeader}>
          <Text style={[pdfStyles.cellLeft, pdfStyles.headerText]}>Fase</Text>
          <Text style={[pdfStyles.cellRight, pdfStyles.headerText]}>Valore</Text>
        </View>
        {pipeline.map((p) => (
          <View key={p.fase} style={pdfStyles.tableRow}>
            <Text style={pdfStyles.cellLeft}>{p.fase}</Text>
            <Text style={pdfStyles.cellRight}>{formatEuro(p.valore)}</Text>
          </View>
        ))}

        <Text style={pdfStyles.footer}>
          Generato da FIAI OS il {new Date().toLocaleDateString('it-IT')}
        </Text>
      </Page>
    </Document>
  )
}

// ── Report Page ────────────────────────────────────────────

export default function Report() {
  const defaults = currentYearRange()
  const [from, setFrom] = useState(defaults.from)
  const [to, setTo] = useState(defaults.to)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  const [fatturato, setFatturato] = useState<MonthlyAmount[]>([])
  const [pipeline, setPipeline] = useState<PipelineFase[]>([])
  const [cashFlow, setCashFlow] = useState<CashFlowMese[]>([])
  const [clienti, setClienti] = useState<ClienteRicavo[]>([])
  const [fornitori, setFornitori] = useState<FornitoreSpesa[]>([])
  const [margine, setMargine] = useState<MargineMese[]>([])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [fat, pip, cf, cl, forn, marg] = await Promise.all([
        fetchFatturatoMensileRange(from, to),
        fetchPipelinePerFase(),
        fetchCashFlow(from, to),
        fetchTopClienti(from, to),
        fetchTopFornitori(from, to),
        fetchMargineMensile(from, to),
      ])

      setFatturato(fat)
      setPipeline(pip)
      setCashFlow(cf)
      setClienti(cl)
      setFornitori(forn)
      setMargine(marg)
    } catch (err) {
      console.error('Report fetch error:', err)
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => {
    loadData()
  }, [loadData])

  // ── Export CSV ──

  const handleExportCSV = () => {
    const csv = generateCSV(fatturato, cashFlow, margine, clienti, fornitori, pipeline)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const dateStr = new Date().toISOString().slice(0, 10)
    downloadBlob(blob, `report-fiai-${dateStr}.csv`)
  }

  // ── Export PDF ──

  const handleExportPDF = async () => {
    setExporting(true)
    try {
      const doc = (
        <ReportPDFDocument
          from={from}
          to={to}
          fatturato={fatturato}
          cashFlow={cashFlow}
          margine={margine}
          clienti={clienti}
          fornitori={fornitori}
          pipeline={pipeline}
        />
      )
      const blob = await pdf(doc).toBlob()
      const dateStr = new Date().toISOString().slice(0, 10)
      downloadBlob(blob, `report-fiai-${dateStr}.pdf`)
    } catch (err) {
      console.error('PDF export error:', err)
    } finally {
      setExporting(false)
    }
  }

  // ── Loading state ──

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-gold font-display text-xl font-bold animate-pulse">
          Caricamento report...
        </div>
      </div>
    )
  }

  // ── Render ──

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-text">Report</h1>
          <p className="text-text3 text-sm mt-1">Analisi finanziaria dettagliata</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Date range */}
          <div className="flex items-center gap-2">
            <Calendar size={16} className="text-text3" />
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="bg-bg3 border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-gold"
            />
            <span className="text-text3 text-sm">—</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="bg-bg3 border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-gold"
            />
          </div>

          {/* Export buttons */}
          <Button size="sm" onClick={handleExportCSV}>
            <Download size={14} />
            CSV
          </Button>
          <Button size="sm" onClick={handleExportPDF} disabled={exporting}>
            <FileText size={14} />
            {exporting ? 'Generando...' : 'PDF'}
          </Button>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* 1. Fatturato Mensile YTD */}
        <ChartCard
          title="Fatturato Mensile"
          description="Totali mensili da fatture pagate"
        >
          <BarChart
            data={fatturato}
            dataKey="totale"
            xKey="mese"
            color="#C9A84C"
            height={280}
          />
        </ChartCard>

        {/* 2. Pipeline per Fase */}
        <ChartCard
          title="Pipeline per Fase"
          description="Valore lead attivi per fase commerciale"
        >
          <BarChart
            data={pipeline}
            dataKey="valore"
            xKey="fase"
            color="#6BA3D6"
            height={280}
          />
        </ChartCard>

        {/* 3. Cash Flow 12 Mesi */}
        <ChartCard
          title="Cash Flow"
          description="Entrate ed uscite mensili"
        >
          <LineChart
            data={cashFlow}
            lines={[
              { dataKey: 'entrate', color: '#52B788', name: 'Entrate' },
              { dataKey: 'uscite', color: '#E07070', name: 'Uscite' },
            ]}
            xKey="mese"
            height={280}
          />
        </ChartCard>

        {/* 4. Distribuzione Ricavi per Cliente */}
        <ChartCard
          title="Distribuzione Ricavi per Cliente"
          description="Top clienti per fatturato nel periodo"
        >
          {clienti.length > 0 ? (
            <PieChart data={clienti} height={280} />
          ) : (
            <EmptyChartMessage />
          )}
        </ChartCard>

        {/* 5. Spese per Fornitore */}
        <ChartCard
          title="Spese per Fornitore"
          description="Top fornitori per importo pagato"
        >
          <BarChart
            data={fornitori.map((f) => ({ fornitore: f.name, spesa: f.value }))}
            dataKey="spesa"
            xKey="fornitore"
            color="#E07070"
            height={280}
          />
        </ChartCard>

        {/* 6. Margine Operativo nel Tempo */}
        <ChartCard
          title="Margine Operativo nel Tempo"
          description="Fatturato meno spese, mese per mese"
        >
          <LineChart
            data={margine}
            lines={[
              { dataKey: 'margine', color: '#C9A84C', name: 'Margine' },
            ]}
            xKey="mese"
            height={280}
          />
        </ChartCard>
      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────

function ChartCard({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-bg2 border border-border rounded-xl p-5">
      <h2 className="text-text font-semibold text-base mb-1">{title}</h2>
      {description && (
        <p className="text-text3 text-xs mb-4">{description}</p>
      )}
      {children}
    </div>
  )
}

function EmptyChartMessage() {
  return (
    <div className="flex items-center justify-center h-[280px] text-text3 text-sm">
      Nessun dato disponibile per il periodo selezionato.
    </div>
  )
}
