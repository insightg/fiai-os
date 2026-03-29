import type { JSX } from 'react'
import Badge from './ui/Badge'
import {
  TrendingUp,
  TrendingDown,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Users,
  FileText,
  FolderKanban,
  Briefcase,
  Landmark,
  Receipt,
  UserSearch,
  Megaphone,
  FolderOpen,
  Image,
  Download,
  Volume2,
} from 'lucide-react'

function fmt(n: number): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)
}

type BadgeColor = 'gold' | 'green' | 'red' | 'blue' | 'amber' | 'purple' | 'gray'

const statoColors: Record<string, BadgeColor> = {
  // fatture
  pagata: 'green', emessa: 'blue', bozza: 'gray', inviata_sdi: 'amber', scaduta: 'red', stornata: 'red',
  // fatture passive
  da_pagare: 'red', contestata: 'amber',
  // preventivi
  inviato: 'blue', accettato: 'green', rifiutato: 'red',
  // ordini
  confermato: 'blue', in_lavorazione: 'amber', completato: 'green', annullato: 'red',
  // progetti
  pianificato: 'gray', in_corso: 'blue', in_pausa: 'amber',
  // leads
  nuovo: 'blue', contattato: 'amber', qualificato: 'purple', proposta: 'gold', perso: 'red', convertito: 'green',
  // candidati
  screening: 'amber', colloquio: 'purple', offerta: 'gold', assunto: 'green', scartato: 'red',
  // annunci
  pubblicato: 'green', chiuso: 'red',
  // rimborsi
  richiesto: 'amber', approvato: 'green', rimborsato: 'blue',
}

function StatMini({ label, value, icon: Icon, trend }: { label: string; value: string; icon?: React.ComponentType<any>; trend?: 'up' | 'down' }) {
  return (
    <div className="bg-bg3 rounded-lg p-2 flex items-center gap-2">
      {Icon && <Icon className="w-4 h-4 text-gold shrink-0" />}
      <div className="min-w-0">
        <div className="text-[10px] text-text3 truncate">{label}</div>
        <div className="text-xs font-semibold text-text flex items-center gap-1">
          {value}
          {trend === 'up' && <TrendingUp className="w-3 h-3 text-green" />}
          {trend === 'down' && <TrendingDown className="w-3 h-3 text-red" />}
        </div>
      </div>
    </div>
  )
}

function downloadTableAsCSV(headers: string[], rows: (string | JSX.Element)[][], filename: string) {
  const textRows = rows.map(r =>
    r.map(cell => {
      if (typeof cell === 'string') return cell
      // Extract text content from JSX elements
      if (cell && typeof cell === 'object' && 'props' in cell) {
        const props = cell.props as Record<string, unknown>
        const children = props.children
        if (typeof children === 'string') return children
        if (Array.isArray(children)) return children.filter(c => typeof c === 'string').join('')
      }
      return String(cell)
    })
  )
  const csvContent = [
    headers.join(','),
    ...textRows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(','))
  ].join('\n')
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function MiniTable({ headers, rows }: { headers: string[]; rows: (string | JSX.Element)[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border mt-1">
      <div className="flex items-center justify-between bg-bg3 px-2 py-1">
        <span className="text-[9px] text-text3">{rows.length} righe</span>
        <button
          title="Esporta CSV"
          onClick={() => downloadTableAsCSV(headers, rows, `fiai-tabella-${Date.now()}.csv`)}
          className="p-1 rounded text-text3 hover:text-gold transition-colors"
        >
          <Download size={12} />
        </button>
      </div>
      <table className="w-full text-[10px]">
        <thead>
          <tr className="bg-bg3">
            {headers.map((h, i) => (
              <th key={i} className="px-2 py-1.5 text-left text-text3 font-medium uppercase tracking-wider">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-border/50">
              {row.map((cell, j) => (
                <td key={j} className="px-2 py-1.5 text-text2">{cell}</td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={headers.length} className="px-2 py-3 text-center text-text3">Nessun risultato</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ── Renderers per tool ────────────────────────────────

function renderFinancialSummary(data: any): JSX.Element {
  return (
    <div className="space-y-1.5 mt-1">
      <div className="grid grid-cols-3 gap-1.5">
        <StatMini label="Fatturato YTD" value={fmt(data.fatturato_ytd)} icon={TrendingUp} />
        <StatMini label="Da Incassare" value={fmt(data.da_incassare)} icon={Clock} />
        <StatMini label="Liquidita" value={fmt(data.liquidita_totale)} icon={Landmark} />
      </div>
      <div className="text-[10px] text-text3">
        {data.fatture_pagate}/{data.fatture_emesse} fatture pagate
      </div>
    </div>
  )
}

function renderOverdueInvoices(data: any[]): JSX.Element {
  if (!Array.isArray(data) || data.length === 0) {
    return <div className="text-[10px] text-green flex items-center gap-1 mt-1"><CheckCircle2 className="w-3 h-3" /> Nessuna fattura scaduta</div>
  }
  return (
    <MiniTable
      headers={['N.', 'Cliente', 'Totale', 'Scaduta da']}
      rows={data.slice(0, 8).map(f => [
        f.numero,
        <span className="truncate max-w-[80px] block">{f.cliente_nome}</span>,
        <span className="font-mono">{fmt(f.totale)}</span>,
        <span className="text-red">{f.giorni_scaduta}gg</span>,
      ])}
    />
  )
}

function renderPipeline(data: any[]): JSX.Element {
  if (!Array.isArray(data)) return <></>
  return (
    <div className="space-y-1 mt-1">
      {data.map((fase, i) => (
        <div key={i} className="flex items-center gap-2">
          <Badge color={statoColors[fase.fase] || 'gray'}>{fase.fase}</Badge>
          <span className="text-[10px] text-text2">{fase.conteggio} lead</span>
          <span className="text-[10px] font-mono text-text ml-auto">{fmt(fase.valore_totale)}</span>
        </div>
      ))}
    </div>
  )
}

function renderProjects(data: any[]): JSX.Element {
  if (!Array.isArray(data)) return <></>
  return (
    <MiniTable
      headers={['Progetto', 'Cliente', 'Stato']}
      rows={data.slice(0, 8).map(p => [
        <span className="font-medium truncate max-w-[100px] block">{p.nome}</span>,
        <span className="truncate max-w-[80px] block">{p.cliente_nome}</span>,
        <Badge color={statoColors[p.stato] || 'gray'}>{p.stato}</Badge>,
      ])}
    />
  )
}

function renderClients(data: any[]): JSX.Element {
  if (!Array.isArray(data)) return <></>
  return (
    <MiniTable
      headers={['Nome', 'Tipo', 'Email']}
      rows={data.slice(0, 10).map(c => [
        <span className="font-medium">{c.ragione_sociale || `${c.nome} ${c.cognome || ''}`}</span>,
        <Badge color={c.tipo === 'azienda' ? 'blue' : 'purple'}>{c.tipo}</Badge>,
        <span className="truncate max-w-[100px] block text-text3">{c.email || '-'}</span>,
      ])}
    />
  )
}

function renderSuppliers(data: any[]): JSX.Element {
  if (!Array.isArray(data)) return <></>
  return (
    <MiniTable
      headers={['Fornitore', 'P.IVA', 'Email']}
      rows={data.slice(0, 10).map(f => [
        <span className="font-medium">{f.ragione_sociale}</span>,
        <span className="font-mono text-text3">{f.piva || '-'}</span>,
        <span className="truncate max-w-[80px] block text-text3">{f.email || '-'}</span>,
      ])}
    />
  )
}

function renderInvoicesOrOrders(data: any[], type: 'fattura' | 'ordine' | 'preventivo'): JSX.Element {
  if (!Array.isArray(data)) return <></>
  return (
    <MiniTable
      headers={['N.', type === 'fattura' ? 'Fornitore' : 'Cliente', 'Totale', 'Stato']}
      rows={data.slice(0, 8).map(item => {
        const nome = item.fornitore?.ragione_sociale || item.cliente?.ragione_sociale || item.cliente?.nome || '-'
        return [
          item.numero,
          <span className="truncate max-w-[80px] block">{nome}</span>,
          <span className="font-mono">{fmt(item.totale)}</span>,
          <Badge color={statoColors[item.stato] || 'gray'}>{item.stato}</Badge>,
        ]
      })}
    />
  )
}

function renderBankAccounts(data: any[]): JSX.Element {
  if (!Array.isArray(data)) return <></>
  const totale = data.reduce((s: number, c: any) => s + (c.saldo || 0), 0)
  return (
    <div className="space-y-1.5 mt-1">
      <StatMini label="Liquidita Totale" value={fmt(totale)} icon={Landmark} />
      {data.map((c, i) => (
        <div key={i} className="flex items-center justify-between bg-bg3 rounded-lg px-2 py-1.5">
          <div className="flex items-center gap-1.5">
            <Badge color={c.tipo === 'banca' ? 'blue' : c.tipo === 'cassa' ? 'green' : 'purple'}>{c.tipo}</Badge>
            <span className="text-[10px] text-text">{c.nome}</span>
          </div>
          <span className="text-[10px] font-mono font-semibold text-text">{fmt(c.saldo)}</span>
        </div>
      ))}
    </div>
  )
}

function renderExpenses(data: any[]): JSX.Element {
  if (!Array.isArray(data)) return <></>
  return (
    <MiniTable
      headers={['Descrizione', 'Importo', 'Stato']}
      rows={data.slice(0, 8).map(r => [
        <span className="truncate max-w-[120px] block">{r.descrizione}</span>,
        <span className="font-mono">{fmt(r.importo)}</span>,
        <Badge color={statoColors[r.stato] || 'gray'}>{r.stato}</Badge>,
      ])}
    />
  )
}

function renderCandidates(data: any[]): JSX.Element {
  if (!Array.isArray(data)) return <></>
  return (
    <MiniTable
      headers={['Nome', 'Ruolo', 'Stato', 'Val.']}
      rows={data.slice(0, 8).map(c => [
        <span className="font-medium">{c.nome} {c.cognome}</span>,
        <span className="truncate max-w-[60px] block text-text3">{c.ruolo_candidato || '-'}</span>,
        <Badge color={statoColors[c.stato] || 'gray'}>{c.stato}</Badge>,
        c.valutazione ? <span className="text-amber">{'★'.repeat(c.valutazione)}</span> : <span className="text-text3">-</span>,
      ])}
    />
  )
}

function renderJobPostings(data: any[]): JSX.Element {
  if (!Array.isArray(data)) return <></>
  return (
    <MiniTable
      headers={['Ruolo', 'Sede', 'Stato', 'RAL']}
      rows={data.slice(0, 8).map(a => [
        <span className="font-medium">{a.ruolo}</span>,
        <span className="text-text3">{a.sede || '-'}</span>,
        <Badge color={statoColors[a.stato] || 'gray'}>{a.stato}</Badge>,
        a.ral_min && a.ral_max ? <span className="font-mono text-[9px]">{fmt(a.ral_min)}-{fmt(a.ral_max)}</span> : '-',
      ])}
    />
  )
}

function renderDocuments(data: any[]): JSX.Element {
  if (!Array.isArray(data)) return <></>
  return (
    <MiniTable
      headers={['Nome', 'Categoria', 'Tags']}
      rows={data.slice(0, 8).map(d => [
        <span className="truncate max-w-[100px] block font-medium">{d.nome}</span>,
        <Badge color={statoColors[d.categoria] || 'gray'}>{d.categoria}</Badge>,
        <div className="flex gap-0.5 flex-wrap">{(d.tags || []).slice(0, 2).map((t: string, i: number) => <Badge key={i} color="gray">{t}</Badge>)}</div>,
      ])}
    />
  )
}

function renderDashboardSummary(data: any): JSX.Element {
  if (!data || typeof data !== 'object') return <></>
  return (
    <div className="grid grid-cols-3 gap-1.5 mt-1">
      <StatMini label="Clienti" value={String(data.clienti ?? 0)} icon={Users} />
      <StatMini label="Leads" value={String(data.leads ?? 0)} icon={UserSearch} />
      <StatMini label="Fatture" value={String(data.fatture ?? 0)} icon={Receipt} />
      <StatMini label="Progetti" value={String(data.progetti_attivi ?? 0)} icon={FolderKanban} />
      <StatMini label="Da Pagare" value={String(data.fatture_passive_da_pagare ?? 0)} icon={AlertTriangle} />
      <StatMini label="Candidati" value={String(data.candidati ?? 0)} icon={Briefcase} />
    </div>
  )
}

function renderCreateResult(data: any): JSX.Element {
  if (!data) return <></>
  if (data.successo === false) {
    return <div className="text-[10px] text-red mt-1">{data.messaggio}</div>
  }
  return <div className="text-[10px] text-green flex items-center gap-1 mt-1"><CheckCircle2 className="w-3 h-3" />{data.messaggio || 'Creato con successo'}</div>
}

function renderGeneratedSpeech(data: any): JSX.Element {
  if (!data?.audioUrl) return <></>
  return (
    <div className="mt-2">
      <audio controls src={data.audioUrl} className="w-full max-w-md" />
      <a
        href={data.audioUrl}
        download={`fiai-speech-${Date.now()}.mp3`}
        className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 text-xs rounded-lg bg-bg3 border border-border text-text3 hover:text-gold hover:border-gold/40 transition-colors"
      >
        <Download size={14} /> Scarica Audio
      </a>
    </div>
  )
}

function renderGeneratedImage(data: any): JSX.Element {
  if (!data?.image_url) return <></>
  return (
    <div className="mt-2">
      <img
        src={data.image_url}
        alt="Immagine generata"
        className="max-w-full rounded-xl border border-border shadow-sm"
        style={{ maxHeight: '400px' }}
      />
      <a
        href={data.image_url}
        download={`fiai-image-${Date.now()}.png`}
        className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 text-xs rounded-lg bg-bg3 border border-border text-text3 hover:text-gold hover:border-gold/40 transition-colors"
      >
        <Download size={14} /> Scarica
      </a>
    </div>
  )
}

// ── Main Renderer ────────────────────────────────────

const toolIcons: Record<string, React.ComponentType<any>> = {
  get_financial_summary: TrendingUp,
  get_overdue_invoices: AlertTriangle,
  get_pipeline: FolderKanban,
  get_projects: FolderKanban,
  get_clients: Users,
  get_suppliers: Receipt,
  get_passive_invoices: Receipt,
  get_orders: FileText,
  get_quotes: FileText,
  get_bank_accounts: Landmark,
  get_expenses: Receipt,
  get_candidates: UserSearch,
  get_job_postings: Megaphone,
  get_documents: FolderOpen,
  get_dashboard_summary: Briefcase,
  create_lead: UserSearch,
  create_client: Users,
  create_candidate: UserSearch,
  search_documents: FolderOpen,
  generate_image: Image,
  generate_speech: Volume2,
}

export const toolNameMapExtended: Record<string, string> = {
  get_financial_summary: 'Riepilogo finanziario',
  get_overdue_invoices: 'Fatture scadute',
  get_pipeline: 'Pipeline commerciale',
  get_projects: 'Progetti',
  get_clients: 'Clienti',
  get_suppliers: 'Fornitori',
  get_passive_invoices: 'Fatture passive',
  get_orders: 'Ordini',
  get_quotes: 'Preventivi',
  get_bank_accounts: 'Conti bancari',
  get_expenses: 'Rimborsi',
  get_candidates: 'Candidati',
  get_job_postings: 'Annunci lavoro',
  get_documents: 'Documenti',
  get_dashboard_summary: 'Dashboard',
  create_lead: 'Nuovo lead',
  create_client: 'Nuovo cliente',
  create_candidate: 'Nuovo candidato',
  approve_expense: 'Approvazione rimborso',
  search_documents: 'Ricerca documenti',
  generate_image: 'Immagine generata',
  analyze_image: 'Analisi immagine',
  generate_speech: 'Sintesi vocale',
}

export function renderToolResult(toolName: string, result: any): JSX.Element | null {
  if (!result) return null

  const Icon = toolIcons[toolName]

  const content = (() => {
    switch (toolName) {
      case 'get_financial_summary': return renderFinancialSummary(result)
      case 'get_overdue_invoices': return renderOverdueInvoices(result)
      case 'get_pipeline': return renderPipeline(result)
      case 'get_projects': return renderProjects(result)
      case 'get_clients': return renderClients(result)
      case 'get_suppliers': return renderSuppliers(result)
      case 'get_passive_invoices': return renderInvoicesOrOrders(result, 'fattura')
      case 'get_orders': return renderInvoicesOrOrders(result, 'ordine')
      case 'get_quotes': return renderInvoicesOrOrders(result, 'preventivo')
      case 'get_bank_accounts': return renderBankAccounts(result)
      case 'get_expenses': return renderExpenses(result)
      case 'get_candidates': return renderCandidates(result)
      case 'get_job_postings': return renderJobPostings(result)
      case 'get_documents':
      case 'search_documents': return renderDocuments(result)
      case 'get_dashboard_summary': return renderDashboardSummary(result)
      case 'create_lead':
      case 'create_client':
      case 'create_candidate':
      case 'approve_expense': return renderCreateResult(result)
      case 'generate_image': return renderGeneratedImage(result)
      case 'generate_speech': return renderGeneratedSpeech(result)
      case 'analyze_image': return null // analysis is shown as text, no special render
      default: return null
    }
  })()

  if (!content) return null

  return (
    <div className="mt-1.5 mb-1">
      <div className="flex items-center gap-1.5 mb-1">
        {Icon && <Icon className="w-3 h-3 text-gold" />}
        <span className="text-[10px] font-medium text-text3 uppercase tracking-wider">
          {toolNameMapExtended[toolName] || toolName}
        </span>
        {Array.isArray(result) && <span className="text-[10px] text-text3">({result.length})</span>}
      </div>
      {content}
    </div>
  )
}
