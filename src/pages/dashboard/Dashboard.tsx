import { useEffect, useState, useCallback } from 'react'
import {
  DollarSign,
  Clock,
  Target,
  FolderOpen,
  TrendingUp,
  Wallet,
  FileText,
  User,
  Briefcase,
} from 'lucide-react'
import StatCard from '../../components/ui/StatCard'
import BarChart from '../../components/charts/BarChart'
import Table, { type Column } from '../../components/ui/Table'
import Badge from '../../components/ui/Badge'
import {
  formatEuro,
  fetchFatturatoYTD,
  fetchDaIncassare,
  fetchPipelineValore,
  fetchProgettiAttivi,
  fetchSpeseYTD,
  fetchLiquidita,
  fetchFatturatoMensile,
  fetchPipelinePerFase,
  fetchFattureScadute,
  fetchAttivitaRecenti,
  type MonthlyAmount,
  type PipelineFase,
  type FatturaScaduta,
  type AttivitaRecente,
} from '../../lib/analytics'

// ── Types ──────────────────────────────────────────────────

interface KPIs {
  fatturatoYTD: number
  daIncassare: number
  pipelineValore: number
  progettiAttivi: number
  margine: number
  liquidita: number
}

// ── Component ──────────────────────────────────────────────

export default function Dashboard() {
  const [loading, setLoading] = useState(true)
  const [kpis, setKpis] = useState<KPIs>({
    fatturatoYTD: 0,
    daIncassare: 0,
    pipelineValore: 0,
    progettiAttivi: 0,
    margine: 0,
    liquidita: 0,
  })
  const [fatturatoMensile, setFatturatoMensile] = useState<MonthlyAmount[]>([])
  const [pipelineFase, setPipelineFase] = useState<PipelineFase[]>([])
  const [fattureScadute, setFattureScadute] = useState<FatturaScaduta[]>([])
  const [attivita, setAttivita] = useState<AttivitaRecente[]>([])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [
        fatturatoYTD,
        daIncassare,
        pipelineValore,
        progettiAttivi,
        speseYTD,
        liquidita,
        mensile,
        pipeline,
        scadute,
        recenti,
      ] = await Promise.all([
        fetchFatturatoYTD(),
        fetchDaIncassare(),
        fetchPipelineValore(),
        fetchProgettiAttivi(),
        fetchSpeseYTD(),
        fetchLiquidita(),
        fetchFatturatoMensile(),
        fetchPipelinePerFase(),
        fetchFattureScadute(),
        fetchAttivitaRecenti(),
      ])

      setKpis({
        fatturatoYTD,
        daIncassare,
        pipelineValore,
        progettiAttivi,
        margine: fatturatoYTD - speseYTD,
        liquidita,
      })
      setFatturatoMensile(mensile)
      setPipelineFase(pipeline)
      setFattureScadute(scadute)
      setAttivita(recenti)
    } catch (err) {
      console.error('Dashboard fetch error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  // ── Overdue table columns ──

  const overdueColumns: Column<FatturaScaduta>[] = [
    {
      key: 'numero',
      header: 'Numero',
      render: (r) => <span className="font-medium text-gold">{r.numero}</span>,
    },
    {
      key: 'cliente',
      header: 'Cliente',
      render: (r) => r.cliente_nome,
    },
    {
      key: 'importo',
      header: 'Importo',
      render: (r) => formatEuro(r.importo),
      className: 'text-right',
    },
    {
      key: 'giorni',
      header: 'Scaduta da',
      render: (r) => (
        <Badge color={r.giorni_scaduti > 30 ? 'red' : 'amber'}>
          {r.giorni_scaduti}g
        </Badge>
      ),
      className: 'text-right',
    },
  ]

  // ── Activity icon map ──

  const activityIcon = (tipo: AttivitaRecente['tipo']) => {
    switch (tipo) {
      case 'lead':
        return <User size={14} className="text-blue" />
      case 'fattura':
        return <FileText size={14} className="text-green" />
      case 'progetto':
        return <Briefcase size={14} className="text-purple" />
    }
  }

  const activityColor = (tipo: AttivitaRecente['tipo']): 'blue' | 'green' | 'purple' => {
    switch (tipo) {
      case 'lead':
        return 'blue'
      case 'fattura':
        return 'green'
      case 'progetto':
        return 'purple'
    }
  }

  // ── Loading State ──

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-gold font-display text-xl font-bold animate-pulse">
          Caricamento dashboard...
        </div>
      </div>
    )
  }

  // ── Render ──

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-display font-bold text-text">Dashboard</h1>
        <p className="text-text3 text-sm mt-1">Panoramica in tempo reale della tua azienda</p>
      </div>

      {/* KPI Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard
          icon={DollarSign}
          label="Fatturato YTD"
          value={formatEuro(kpis.fatturatoYTD)}
          trend={{ value: 'YTD', positive: kpis.fatturatoYTD > 0 }}
        />
        <StatCard
          icon={Clock}
          label="Da Incassare"
          value={formatEuro(kpis.daIncassare)}
          trend={kpis.daIncassare > 0 ? { value: `${formatEuro(kpis.daIncassare)}`, positive: false } : undefined}
        />
        <StatCard
          icon={Target}
          label="Pipeline Valore"
          value={formatEuro(kpis.pipelineValore)}
        />
        <StatCard
          icon={FolderOpen}
          label="Progetti Attivi"
          value={String(kpis.progettiAttivi)}
        />
        <StatCard
          icon={TrendingUp}
          label="Margine"
          value={formatEuro(kpis.margine)}
          trend={{ value: 'YTD', positive: kpis.margine > 0 }}
        />
        <StatCard
          icon={Wallet}
          label="Liquidità"
          value={formatEuro(kpis.liquidita)}
          trend={{ value: 'Totale', positive: kpis.liquidita > 0 }}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Fatturato Mensile */}
        <div className="bg-bg2 border border-border rounded-xl p-5">
          <h2 className="text-text font-semibold text-base mb-1">Fatturato Mensile YTD</h2>
          <p className="text-text3 text-xs mb-4">Incassi mensili da fatture pagate</p>
          <BarChart
            data={fatturatoMensile}
            dataKey="totale"
            xKey="mese"
            color="#C9A84C"
            height={280}
          />
        </div>

        {/* Pipeline per Fase */}
        <div className="bg-bg2 border border-border rounded-xl p-5">
          <h2 className="text-text font-semibold text-base mb-1">Pipeline per Fase</h2>
          <p className="text-text3 text-xs mb-4">Valore lead attivi per fase commerciale</p>
          <BarChart
            data={pipelineFase}
            dataKey="valore"
            xKey="fase"
            color="#6BA3D6"
            height={280}
          />
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Fatture Scadute */}
        <div>
          <h2 className="text-text font-semibold text-base mb-3">Fatture Scadute</h2>
          <Table
            columns={overdueColumns}
            data={fattureScadute}
            keyExtractor={(r) => r.id}
            emptyMessage="Nessuna fattura scaduta."
          />
        </div>

        {/* Attività Recenti */}
        <div>
          <h2 className="text-text font-semibold text-base mb-3">Attività Recenti</h2>
          <div className="bg-bg2 border border-border rounded-xl divide-y divide-border/50">
            {attivita.length === 0 ? (
              <div className="px-4 py-8 text-center text-text3">
                Nessuna attività recente.
              </div>
            ) : (
              attivita.map((a) => (
                <div key={`${a.tipo}-${a.id}`} className="px-4 py-3 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-bg3 flex items-center justify-center shrink-0">
                    {activityIcon(a.tipo)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-text text-sm truncate">{a.descrizione}</p>
                    <p className="text-text3 text-xs mt-0.5">
                      {new Date(a.data).toLocaleDateString('it-IT', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                  <Badge color={activityColor(a.tipo)}>
                    {a.tipo === 'lead' ? 'Lead' : a.tipo === 'fattura' ? 'Fattura' : 'Progetto'}
                  </Badge>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
