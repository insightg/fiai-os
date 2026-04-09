import { useState, useEffect, useRef, lazy, Suspense, type JSX } from 'react'
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
  Pencil,
  Trash2,
  Plus,
  X,
} from 'lucide-react'

export interface ActionContext {
  onAction?: (action: string, payload: any) => void
}

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

function MiniTable({ headers, rows }: { headers: string[]; rows: (string | JSX.Element | null)[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border mt-1">
      <div className="flex items-center justify-between bg-bg3 px-2 py-1">
        <span className="text-[9px] text-text3">{rows.length} righe</span>
        <button
          title="Esporta CSV"
          onClick={() => downloadTableAsCSV(headers, rows as (string | JSX.Element)[][], `fiai-tabella-${Date.now()}.csv`)}
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
            <tr key={i} className="border-t border-border/50 group/row">
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

// ── Action button helpers ─────────────────────────────────

function ActionBtn({ icon: Icon, title, onClick, color = 'text-text3 hover:text-gold' }: {
  icon: React.ComponentType<{ size?: number }>
  title: string
  onClick: (e: React.MouseEvent) => void
  color?: string
}) {
  return (
    <button
      title={title}
      onClick={(e) => { e.stopPropagation(); onClick(e) }}
      className={`p-0.5 ${color} transition-colors`}
    >
      <Icon size={11} />
    </button>
  )
}

function RowActions({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
      {children}
    </div>
  )
}

function CreateButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="mt-1 text-[10px] text-gold hover:underline flex items-center gap-1"
    >
      <Plus size={10} /> {label}
    </button>
  )
}

// ── Renderers per tool ────────────────────────────────────

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

function renderOverdueInvoices(data: any[], context?: ActionContext): JSX.Element {
  if (!Array.isArray(data) || data.length === 0) {
    return <div className="text-[10px] text-green flex items-center gap-1 mt-1"><CheckCircle2 className="w-3 h-3" /> Nessuna fattura scaduta</div>
  }
  return (
    <MiniTable
      headers={['N.', 'Cliente', 'Totale', 'Scaduta da', ...(context?.onAction ? [''] : [])]}
      rows={data.slice(0, 8).map(f => [
        f.numero,
        <span className="truncate max-w-[80px] block">{f.cliente_nome}</span>,
        <span className="font-mono">{fmt(f.totale)}</span>,
        <span className="text-red">{f.giorni_scaduta}gg</span>,
        ...(context?.onAction ? [
          <RowActions>
            <ActionBtn icon={CheckCircle2} title="Segna come pagata" color="text-text3 hover:text-green" onClick={() => context.onAction!('mark_paid', { id: f.id })} />
          </RowActions>
        ] : []),
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

function renderProjects(data: any[], context?: ActionContext): JSX.Element {
  if (!Array.isArray(data)) return <></>
  return (
    <MiniTable
      headers={['Progetto', 'Cliente', 'Stato', ...(context?.onAction ? [''] : [])]}
      rows={data.slice(0, 8).map(p => [
        <span className="font-medium truncate max-w-[100px] block">{p.nome}</span>,
        <span className="truncate max-w-[80px] block">{p.cliente_nome}</span>,
        <Badge color={statoColors[p.stato] || 'gray'}>{p.stato}</Badge>,
        ...(context?.onAction ? [
          <RowActions>
            <ActionBtn icon={Pencil} title="Modifica" onClick={() => context.onAction!('edit', p)} />
          </RowActions>
        ] : []),
      ])}
    />
  )
}

function renderClients(data: any[], context?: ActionContext): JSX.Element {
  if (!Array.isArray(data)) return <></>
  return (
    <>
      <MiniTable
        headers={['Nome', 'Tipo', 'Email', ...(context?.onAction ? [''] : [])]}
        rows={data.slice(0, 10).map(c => [
          <span className="font-medium">{c.ragione_sociale || `${c.nome} ${c.cognome || ''}`}</span>,
          <Badge color={c.tipo === 'azienda' ? 'blue' : 'purple'}>{c.tipo}</Badge>,
          <span className="truncate max-w-[100px] block text-text3">{c.email || '-'}</span>,
          ...(context?.onAction ? [
            <RowActions>
              <ActionBtn icon={Pencil} title="Modifica" onClick={() => context.onAction!('edit', c)} />
              <ActionBtn icon={Trash2} title="Elimina" color="text-text3 hover:text-red" onClick={() => context.onAction!('delete', { id: c.id })} />
            </RowActions>
          ] : []),
        ])}
      />
      {context?.onAction && (
        <CreateButton label="Nuovo Cliente" onClick={() => context.onAction!('create', { tool: 'get_clients' })} />
      )}
    </>
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

function renderExpenses(data: any[], context?: ActionContext): JSX.Element {
  if (!Array.isArray(data)) return <></>
  return (
    <MiniTable
      headers={['Descrizione', 'Importo', 'Stato', ...(context?.onAction ? [''] : [])]}
      rows={data.slice(0, 8).map(r => [
        <span className="truncate max-w-[120px] block">{r.descrizione}</span>,
        <span className="font-mono">{fmt(r.importo)}</span>,
        <Badge color={statoColors[r.stato] || 'gray'}>{r.stato}</Badge>,
        ...(context?.onAction && r.stato === 'richiesto' ? [
          <RowActions>
            <ActionBtn icon={CheckCircle2} title="Approva" color="text-text3 hover:text-green" onClick={() => context.onAction!('approve', { id: r.id })} />
            <ActionBtn icon={X} title="Rifiuta" color="text-text3 hover:text-red" onClick={() => context.onAction!('reject', { id: r.id })} />
          </RowActions>
        ] : context?.onAction ? [null] : []),
      ])}
    />
  )
}

function renderCandidates(data: any[], context?: ActionContext): JSX.Element {
  if (!Array.isArray(data)) return <></>
  return (
    <>
      <MiniTable
        headers={['Nome', 'Ruolo', 'Stato', 'Val.', ...(context?.onAction ? [''] : [])]}
        rows={data.slice(0, 8).map(c => [
          <span className="font-medium">{c.nome} {c.cognome}</span>,
          <span className="truncate max-w-[60px] block text-text3">{c.ruolo_candidato || '-'}</span>,
          <Badge color={statoColors[c.stato] || 'gray'}>{c.stato}</Badge>,
          c.valutazione ? <span className="text-amber">{'★'.repeat(c.valutazione)}</span> : <span className="text-text3">-</span>,
          ...(context?.onAction ? [
            <RowActions>
              <ActionBtn icon={Pencil} title="Modifica" onClick={() => context.onAction!('edit', c)} />
              <ActionBtn icon={Trash2} title="Elimina" color="text-text3 hover:text-red" onClick={() => context.onAction!('delete', { id: c.id })} />
            </RowActions>
          ] : []),
        ])}
      />
      {context?.onAction && (
        <CreateButton label="Nuovo Candidato" onClick={() => context.onAction!('create', { tool: 'get_candidates' })} />
      )}
    </>
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

function renderDocuments(data: any[], context?: ActionContext): JSX.Element {
  if (!Array.isArray(data)) return <></>
  return (
    <MiniTable
      headers={['Nome', 'Categoria', 'Tags', ...(context?.onAction ? [''] : [])]}
      rows={data.slice(0, 8).map(d => [
        <span className="truncate max-w-[100px] block font-medium">{d.nome}</span>,
        <Badge color={statoColors[d.categoria] || 'gray'}>{d.categoria}</Badge>,
        <div className="flex gap-0.5 flex-wrap">{(d.tags || []).slice(0, 2).map((t: string, i: number) => <Badge key={i} color="gray">{t}</Badge>)}</div>,
        ...(context?.onAction ? [
          <RowActions>
            <ActionBtn icon={Trash2} title="Elimina" color="text-text3 hover:text-red" onClick={() => context.onAction!('delete', { id: d.id })} />
          </RowActions>
        ] : []),
      ])}
    />
  )
}

function renderDeepSearch(result: any, context?: ActionContext): JSX.Element {
  if (!result) return <></>
  const data = result.data || result
  const summary = result.summary || ''
  const queryVariants = result.queryVariants || []

  return (
    <div className="space-y-2 mt-1">
      {queryVariants.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          <span className="text-[9px] text-text3">Query:</span>
          {queryVariants.map((q: string, i: number) => (
            <Badge key={i} color="gray">{q}</Badge>
          ))}
        </div>
      )}
      {Array.isArray(data) && data.length > 0 && (
        <MiniTable
          headers={['Nome', 'Categoria', 'Descrizione', ...(context?.onAction ? [''] : [])]}
          rows={data.slice(0, 10).map((d: any) => [
            <span className="truncate max-w-[120px] block font-medium">{d.nome}</span>,
            <Badge color={statoColors[d.categoria] || 'gray'}>{d.categoria}</Badge>,
            <span className="text-[9px] text-text3 truncate max-w-[150px] block">{d.descrizione || '-'}</span>,
            ...(context?.onAction ? [
              <RowActions>
                <ActionBtn icon={FileText} title="Riassumi" color="text-text3 hover:text-gold" onClick={() => context.onAction!('summarize', { documentId: d.id })} />
              </RowActions>
            ] : []),
          ])}
        />
      )}
      {summary && (
        <div className="bg-bg3 rounded-lg p-2 border border-border">
          <div className="text-[9px] text-text3 uppercase tracking-wider mb-1 font-medium">Sintesi</div>
          <div className="text-[10px] text-text leading-relaxed whitespace-pre-wrap">{summary}</div>
        </div>
      )}
      {Array.isArray(data) && data.length === 0 && (
        <div className="text-[10px] text-text3">Nessun documento trovato.</div>
      )}
    </div>
  )
}

function renderDocumentSummary(result: any): JSX.Element {
  if (!result) return <></>
  if (result.errore) return <div className="text-[10px] text-red mt-1">{result.errore}</div>

  const summary = result.summary || ''
  const keyInfo = result.keyInfo || {}

  return (
    <div className="space-y-2 mt-1">
      {Object.keys(keyInfo).length > 0 && (
        <div className="grid grid-cols-2 gap-1.5">
          {Object.entries(keyInfo).map(([key, value]) => (
            <div key={key} className="bg-bg3 rounded-lg p-1.5 border border-border">
              <div className="text-[8px] text-text3 uppercase tracking-wider">{key}</div>
              <div className="text-[10px] text-text font-medium truncate">{String(value)}</div>
            </div>
          ))}
        </div>
      )}
      {summary && (
        <div className="bg-bg3 rounded-lg p-2 border border-border">
          <div className="text-[10px] text-text leading-relaxed whitespace-pre-wrap">{summary}</div>
        </div>
      )}
    </div>
  )
}

function RenderDocumentContent({ result }: { result: any }) {
  const [expanded, setExpanded] = useState(false)
  if (!result) return <></>
  if (result.errore) return <div className="text-[10px] text-red mt-1">{result.errore}</div>

  const text = result.contenuto_testo || ''
  const nome = result.nome || 'Documento'
  const preview = text.substring(0, 500)
  const hasMore = text.length > 500

  return (
    <div className="space-y-1 mt-1">
      <div className="text-[10px] text-text3 font-medium">{nome}</div>
      <div className="bg-bg3 rounded-lg p-2 border border-border font-mono text-[9px] text-text leading-relaxed whitespace-pre-wrap max-h-[300px] overflow-y-auto">
        {expanded ? text : preview}
        {hasMore && !expanded && '...'}
      </div>
      {hasMore && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[9px] text-gold hover:underline"
        >
          {expanded ? 'Mostra meno' : 'Mostra tutto'}
        </button>
      )}
    </div>
  )
}

function renderCompareDocuments(result: any): JSX.Element {
  if (!result) return <></>
  if (result.errore) return <div className="text-[10px] text-red mt-1">{result.errore}</div>

  const { similarities = [], differences = [], summary = '', doc1, doc2 } = result

  return (
    <div className="space-y-2 mt-1">
      {doc1 && doc2 && (
        <div className="flex gap-2 text-[9px] text-text3">
          <Badge color="blue">{doc1.nome}</Badge>
          <span>vs</span>
          <Badge color="purple">{doc2.nome}</Badge>
        </div>
      )}
      {similarities.length > 0 && (
        <div className="bg-bg3 rounded-lg p-2 border border-border">
          <div className="text-[9px] text-green uppercase tracking-wider mb-1 font-medium">Somiglianze</div>
          <ul className="space-y-0.5">
            {similarities.map((s: string, i: number) => (
              <li key={i} className="text-[10px] text-text flex items-start gap-1">
                <CheckCircle2 className="w-3 h-3 text-green shrink-0 mt-0.5" />
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}
      {differences.length > 0 && (
        <div className="bg-bg3 rounded-lg p-2 border border-border">
          <div className="text-[9px] text-amber uppercase tracking-wider mb-1 font-medium">Differenze</div>
          <ul className="space-y-0.5">
            {differences.map((d: string, i: number) => (
              <li key={i} className="text-[10px] text-text flex items-start gap-1">
                <AlertTriangle className="w-3 h-3 text-amber shrink-0 mt-0.5" />
                {d}
              </li>
            ))}
          </ul>
        </div>
      )}
      {summary && (
        <div className="text-[10px] text-text3 italic">{summary}</div>
      )}
    </div>
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

function AudioPlayer({ url, streaming, streamUrl, streamBody }: { url?: string; streaming?: boolean; streamUrl?: string; streamBody?: Record<string, unknown> }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [isPlaying, setIsPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const audioRef = useRef<HTMLAudioElement>(null)

  // Streaming mode: POST to streamUrl, read chunks, build blob, auto-play
  useEffect(() => {
    if (!streamUrl) return

    let cancelled = false
    ;(async () => {
      try {
        const { getAuthToken } = await import('../lib/supabase')
        const token = getAuthToken() ?? ''
        const res = await fetch(streamUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(streamBody || {}),
        })

        if (!res.ok || !res.body) {
          if (!cancelled) setLoading(false)
          return
        }

        const reader = res.body.getReader()
        const chunks: Uint8Array[] = []

        while (true) {
          const { done, value } = await reader.read()
          if (done || cancelled) break
          if (value) {
            chunks.push(value)
            if (!cancelled) setProgress(chunks.length)
          }
        }

        if (cancelled) return

        const blob = new Blob(chunks, { type: 'audio/mpeg' })
        const burl = URL.createObjectURL(blob)
        setBlobUrl(burl)
        setLoading(false)

        // Auto-play
        setTimeout(() => {
          audioRef.current?.play().catch(() => {})
          setIsPlaying(true)
        }, 100)
      } catch {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [streamUrl])

  // Non-streaming: fetch blob with auth or use existing URL
  useEffect(() => {
    if (streamUrl) return // handled above
    if (!url) { setLoading(false); return }

    let cancelled = false
    if (url.startsWith('blob:')) {
      setBlobUrl(url)
      setLoading(false)
      setTimeout(() => { audioRef.current?.play().catch(() => {}); setIsPlaying(true) }, 100)
      return
    }
    ;(async () => {
      try {
        const burl = await fetchAuthBlob(url)
        if (!cancelled) { setBlobUrl(burl); setLoading(false) }
      } catch {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [url])

  if (loading) {
    return (
      <div className="mt-2 flex items-center gap-2">
        <div className="w-4 h-4 border-2 border-gold border-t-transparent rounded-full animate-spin" />
        <span className="text-[10px] text-text3">
          {progress > 0 ? `Ricezione audio... (${progress} chunks)` : 'Generazione audio in corso...'}
        </span>
      </div>
    )
  }
  if (!blobUrl) return <div className="text-[10px] text-red mt-2">Errore caricamento audio</div>

  return (
    <div className="mt-2">
      <audio
        ref={audioRef}
        controls
        src={blobUrl}
        className="w-full max-w-md"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
      />
      <button
        onClick={() => {
          const a = document.createElement('a')
          a.href = blobUrl
          a.download = `fiai-speech-${Date.now()}.mp3`
          a.click()
        }}
        className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 text-xs rounded-lg bg-bg3 border border-border text-text3 hover:text-gold hover:border-gold/40 transition-colors"
      >
        <Download size={14} /> Scarica Audio
      </button>
    </div>
  )
}

function renderGeneratedSpeech(data: any): JSX.Element {
  if (!data?.audioUrl && !data?.streamUrl) return <></>
  return <AudioPlayer
    url={data.audioUrl}
    streaming={data.streaming}
    streamUrl={data.streamUrl}
    streamBody={data.streamBody}
  />
}

async function fetchAuthBlob(url: string): Promise<string> {
  const { getAuthToken } = await import('../lib/supabase')
  const token = getAuthToken?.() ?? ''
  const res = await fetch(url, {
    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
  })
  const blob = await res.blob()
  return URL.createObjectURL(blob)
}

function PdfActions({ url, filename }: { url: string; filename: string }) {
  const handleOpen = async () => {
    try {
      const blobUrl = await fetchAuthBlob(url)
      window.open(blobUrl, '_blank')
    } catch {
      window.open(url, '_blank')
    }
  }
  const handleDownload = async () => {
    try {
      const blobUrl = await fetchAuthBlob(url)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = filename
      a.click()
      URL.revokeObjectURL(blobUrl)
    } catch {
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
    }
  }
  return (
    <div className="flex gap-2">
      <button
        onClick={handleOpen}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-gold text-white hover:bg-gold-l transition-colors"
      >
        <FolderOpen size={14} /> Apri PDF
      </button>
      <button
        onClick={handleDownload}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-bg border border-border text-text3 hover:text-gold hover:border-gold/40 transition-colors"
      >
        <Download size={14} /> Scarica
      </button>
    </div>
  )
}

function renderWhatsAppStatus(data: any): JSX.Element {
  if (!data || data.errore) {
    return <div className="text-[10px] text-red mt-1">{data?.errore || 'Errore WhatsApp'}</div>
  }
  const status = data.status || data.stato || 'unknown'
  const isConnected = status === 'connected' || status?.includes('Connesso')
  const isConnecting = status === 'connecting' || status?.includes('connessione')
  const hasQr = !!(data.qrImage || data.qrCode)
  return (
    <div className="mt-2 bg-bg3 rounded-xl p-3 border border-border">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">{isConnected ? '🟢' : isConnecting ? '🟡' : '🔴'}</span>
        <span className="text-sm font-medium text-text">{isConnected ? 'Connesso' : isConnecting ? 'In connessione' : 'Disconnesso'}</span>
      </div>
      <div className="text-[10px] text-text3 space-y-0.5">
        <div>QR disponibile: {hasQr ? 'Sì' : 'No'}</div>
        <div>Sessione salvata: {data.hasAuth ? 'Sì' : 'No'}</div>
      </div>
      {hasQr && (
        <div className="mt-3 flex flex-col items-center">
          <div className="text-xs text-text2 mb-2 font-medium">Scansiona con WhatsApp:</div>
          {data.qrImage && (
            <img
              src={data.qrImage}
              alt="WhatsApp QR Code"
              className="w-48 h-48 rounded-lg border border-border bg-white p-1 mb-2"
            />
          )}
          <a
            href="/api/whatsapp/qr-page"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-green text-white hover:opacity-90 transition-colors"
          >
            Apri QR Code Live (si aggiorna automaticamente)
          </a>
          <div className="text-[9px] text-text3 mt-2">Apri WhatsApp → Dispositivi collegati → Collega dispositivo</div>
        </div>
      )}
    </div>
  )
}

function renderGeneratedPdf(data: any): JSX.Element {
  if (!data?.url) {
    if (data?.successo === false) {
      return <div className="text-[10px] text-red mt-1">{data.messaggio}</div>
    }
    return <></>
  }
  return (
    <div className="mt-2 bg-bg3 rounded-xl p-3 border border-border">
      <div className="flex items-center gap-2 mb-2">
        <FileText className="w-5 h-5 text-gold" />
        <span className="text-sm font-medium text-text">{data.filename || 'documento.pdf'}</span>
      </div>
      <PdfActions url={data.url} filename={data.filename || 'documento.pdf'} />
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
  search_documents_deep: FolderOpen,
  summarize_document: FileText,
  get_document_content: FileText,
  compare_documents: FileText,
  generate_image: Image,
  generate_speech: Volume2,
}

// ── VFS generic tool renderers ──────────────────────────

function renderSearchResults(result: any): JSX.Element {
  if (!Array.isArray(result)) return renderCreateResult(result)
  if (result.length === 0) return <p className="text-xs text-text3 italic">Nessun risultato trovato</p>
  return (
    <div className="space-y-1.5">
      {result.slice(0, 15).map((item: any, i: number) => {
        const fileUrl = item.file_url || item.metadata?.file_url
        const isDoc = item.type === 'documento' || fileUrl
        return (
          <div key={item.id || i} className="flex items-center gap-2 px-2.5 py-2 bg-bg3 rounded-lg text-xs">
            {item.tags && <span className="text-[10px] text-gold">{(Array.isArray(item.tags) ? item.tags : []).join(', ')}</span>}
            {item.type && <span className="text-[10px] px-1.5 py-0.5 bg-bg2 rounded text-text3">{item.type}</span>}
            <span className="font-medium text-text flex-1 truncate">{item.display_name}</span>
            {item.stato && <span className="text-[10px] text-text3">({item.stato})</span>}
            {item.totale != null && <span className="text-[11px] font-semibold text-gold">€ {Number(item.totale).toLocaleString('it-IT')}</span>}
            {item.email && <span className="text-[10px] text-text3">{item.email}</span>}
            {isDoc && fileUrl && (
              <div className="flex gap-1 shrink-0">
                <button
                  onClick={async () => {
                    try {
                      const { getAuthToken } = await import('../lib/supabase')
                      const token = getAuthToken()
                      const res = await fetch(fileUrl, { headers: token ? { 'Authorization': `Bearer ${token}` } : {} })
                      if (!res.ok) throw new Error('Errore')
                      const blob = await res.blob()
                      const url = URL.createObjectURL(blob)
                      window.open(url, '_blank')
                    } catch { window.open(fileUrl, '_blank') }
                  }}
                  className="px-1.5 py-0.5 text-[9px] bg-gold/10 text-gold rounded hover:bg-gold/20 transition-colors"
                >
                  Vedi
                </button>
                <button
                  onClick={async () => {
                    try {
                      const { getAuthToken } = await import('../lib/supabase')
                      const token = getAuthToken()
                      const res = await fetch(fileUrl, { headers: token ? { 'Authorization': `Bearer ${token}` } : {} })
                      if (!res.ok) throw new Error('Errore')
                      const blob = await res.blob()
                      const url = URL.createObjectURL(blob)
                      const a = document.createElement('a')
                      a.href = url; a.download = item.display_name || 'file'; a.click()
                      URL.revokeObjectURL(url)
                    } catch {}
                  }}
                  className="px-1.5 py-0.5 text-[9px] bg-bg2 text-text3 rounded hover:text-text hover:bg-bg transition-colors"
                >
                  <Download size={10} className="inline" />
                </button>
              </div>
            )}
          </div>
        )
      })}
      {result.length > 15 && <p className="text-[10px] text-text3">...e altri {result.length - 15}</p>}
    </div>
  )
}

function renderTreeResult(result: any): JSX.Element {
  if (!result?.record) return renderCreateResult(result)
  const r = result.record
  return (
    <div className="space-y-2">
      <div className="px-2 py-1.5 bg-bg3 rounded text-xs">
        <p className="font-semibold text-text">{r.display_name}</p>
        {r.tags && <p className="text-[10px] text-gold mt-0.5">{(Array.isArray(r.tags) ? r.tags : []).join(', ')}</p>}
        {r.path && <p className="text-[10px] text-text3 mt-0.5">{r.path}</p>}
      </div>
      {result.children?.length > 0 && (
        <div className="pl-3 border-l-2 border-gold/20 space-y-1">
          <p className="text-[10px] text-text3 font-medium">Collegati ({result.children.length}):</p>
          {result.children.slice(0, 10).map((c: any, i: number) => (
            <div key={c.id || i} className="text-xs text-text">
              <span className="text-text3">[{c.type}]</span> {c.display_name}
              {c.totale != null && <span className="text-gold ml-1">€ {Number(c.totale).toLocaleString('it-IT')}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function renderStructuredList(result: any): JSX.Element {
  if (!Array.isArray(result) || result.length === 0) {
    return <p className="text-xs text-text3 italic">Nessun elemento trovato.</p>
  }
  return (
    <div className="space-y-1.5">
      {result.map((item: any, i: number) => (
        <div key={item.id || i} className="flex items-center gap-2 px-3 py-2 bg-bg3 rounded-lg text-xs">
          <div className={`w-2 h-2 rounded-full shrink-0 ${item.enabled || item.stato === 'active' || item.stato === 'completed' ? 'bg-green' : item.stato === 'failed' || item.stato === 'dead' ? 'bg-red' : 'bg-text3'}`} />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-text truncate">{item.name || item.display_name || item.action || `#${i + 1}`}</p>
            <p className="text-[10px] text-text3 truncate">
              {item.description || item.agentDomain || item.stato || ''}
              {item.trigger?.cron ? ` · cron: ${item.trigger.cron}` : ''}
              {item.trigger?.event ? ` · event: ${item.trigger.event}` : ''}
              {item.last_run ? ` · ultimo: ${new Date(item.last_run).toLocaleString('it-IT')}` : ''}
              {item.runs != null ? ` · ${item.runs} esecuzioni` : ''}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

function renderDocumentList(result: any): JSX.Element {
  if (!Array.isArray(result) || result.length === 0) return <p className="text-xs text-text3 italic">Nessun documento trovato.</p>
  return (
    <div className="space-y-1.5">
      {result.map((doc: any, i: number) => (
        <div key={doc.id || i} className="flex items-center gap-3 px-3 py-2 bg-bg3 rounded-lg text-xs">
          <FileText size={14} className="text-gold shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-text truncate">{doc.nome}</p>
            <p className="text-[10px] text-text3">
              {doc.categoria || 'altro'}
              {doc.chunkato && doc.chunkato !== 'No' ? ` · ${doc.chunkato}` : ''}
              {doc.dimensione && doc.dimensione !== 'N/D' ? ` · ${doc.dimensione}` : ''}
              {doc.data ? ` · ${doc.data}` : ''}
            </p>
          </div>
          <div className={`w-2 h-2 rounded-full shrink-0 ${doc.chunkato && doc.chunkato !== 'No' ? 'bg-green' : 'bg-text3'}`} />
        </div>
      ))}
    </div>
  )
}

function renderDocumentStructure(result: any): JSX.Element {
  if (!result || result.errore) return <p className="text-xs text-red">{result?.errore || 'Errore'}</p>
  return (
    <div className="space-y-2">
      <div className="px-3 py-2 bg-bg3 rounded-lg">
        <p className="text-xs font-medium text-text">{result.documento}</p>
        <p className="text-[10px] text-text3">{result.categoria} · {result.chunk_count} sezioni · {result.total_chars ? (result.total_chars / 1000).toFixed(0) + 'K chars' : ''}</p>
      </div>
      {result.struttura && result.struttura.length > 0 && (
        <div className="pl-3 border-l-2 border-gold/20 space-y-0.5 max-h-60 overflow-y-auto">
          {result.struttura.slice(0, 50).map((heading: string, i: number) => (
            <p key={i} className="text-[10px] text-text2">{heading}</p>
          ))}
          {result.struttura.length > 50 && <p className="text-[10px] text-text3">...e altre {result.struttura.length - 50} sezioni</p>}
        </div>
      )}
    </div>
  )
}

function renderRetrieveResults(result: any): JSX.Element {
  if (!Array.isArray(result) || result.length === 0) {
    return <p className="text-xs text-text3 italic">Nessun contenuto trovato nel documento.</p>
  }
  return <CollapsibleDocResults title="Ricerca nel documento" count={result.length} items={result} />
}

function LeafletMap({ result }: { result: any }) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<any>(null)

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return
    import('leaflet').then((L) => {
      if (!document.getElementById('leaflet-css')) {
        const link = document.createElement('link'); link.id = 'leaflet-css'; link.rel = 'stylesheet'
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(link)
      }
      const map = L.map(mapRef.current!, { zoomControl: true, attributionControl: false })
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(map)

      if (result.tipo === 'percorso' && result.coordinate) {
        const { partenza: from, destinazione: to } = result.coordinate
        const startIcon = L.divIcon({ html: '<div style="background:#1565C0;width:12px;height:12px;border-radius:50%;border:2px solid white"></div>', iconSize: [12, 12], className: '' })
        const endIcon = L.divIcon({ html: '<div style="background:#D32F2F;width:12px;height:12px;border-radius:50%;border:2px solid white"></div>', iconSize: [12, 12], className: '' })
        L.marker([from.lat, from.lon], { icon: startIcon }).addTo(map)
        L.marker([to.lat, to.lon], { icon: endIcon }).addTo(map)
        if (result.geojson) {
          const routeLine = L.geoJSON(result.geojson, { style: { color: '#1565C0', weight: 4, opacity: 0.8 } }).addTo(map)
          map.fitBounds(routeLine.getBounds(), { padding: [30, 30] })
        } else if (result.bbox) {
          map.fitBounds([[result.bbox[1], result.bbox[0]], [result.bbox[3], result.bbox[2]]])
        }
      } else {
        L.marker([result.lat || 44.8, result.lon || 10.33]).addTo(map)
        map.setView([result.lat || 44.8, result.lon || 10.33], 15)
      }
      mapInstance.current = map
    })
    return () => { if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null } }
  }, [result])

  return <div ref={mapRef} style={{ height: '280px', borderRadius: '8px' }} />
}

function MapResult({ result }: { result: any }) {
  const [showSteps, setShowSteps] = useState(false)
  const isRoute = result.tipo === 'percorso'

  return (
    <div className="space-y-2">
      <div className="rounded-lg overflow-hidden border border-border">
        <LeafletMap result={result} />
      </div>

      {/* Route info */}
      {isRoute && (
        <div className="bg-bg3/50 rounded-lg p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-text font-medium">{result.partenza?.split(',')[0]} → {result.destinazione?.split(',')[0]}</p>
              <p className="text-[11px] text-text2">{result.distanza} · {result.durata} · {result.mezzo}</p>
            </div>
            <a href={result.mappa_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-gold hover:underline">Apri mappa</a>
          </div>

          {/* Steps toggle */}
          {result.tappe?.length > 0 && (
            <>
              <button onClick={() => setShowSteps(!showSteps)} className="text-[10px] text-gold hover:underline">
                {showSteps ? 'Nascondi' : 'Mostra'} {result.tappe.length} tappe
              </button>
              {showSteps && (
                <div className="space-y-1 mt-1">
                  {result.tappe.map((s: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-[10px]">
                      <span className="text-gold font-mono w-4">{i + 1}</span>
                      <span className="text-text flex-1">{s.istruzione}</span>
                      <span className="text-text3 shrink-0">{s.distanza}</span>
                      <span className="text-text3 shrink-0">{s.durata}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Single location */}
      {!isRoute && (
        <div className="bg-bg3/50 rounded-lg p-2.5 flex items-center justify-between">
          <p className="text-xs text-text">{result.indirizzo}</p>
          <a href={result.mappa_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-gold hover:underline shrink-0 ml-2">Apri mappa</a>
        </div>
      )}
    </div>
  )
}

function WeatherResult({ result }: { result: any }) {
  const [expanded, setExpanded] = useState(false)
  const att = result.attuale

  return (
    <div className="space-y-2">
      {/* Current weather */}
      <div className="bg-bg3/50 rounded-lg p-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-medium text-text">{result.citta}, {result.paese}</span>
          <span className="text-lg font-bold text-text">{att?.temperatura}</span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-text2">
          <span>{att?.condizioni}</span>
          <span>Percepita: {att?.percepita}</span>
          <span>Umidita: {att?.umidita}</span>
          <span>Vento: {att?.vento}</span>
        </div>
      </div>

      {/* Forecast toggle */}
      {(result.previsioni || result.oggi_orario) && (
        <>
          <button onClick={() => setExpanded(!expanded)} className="text-[10px] text-gold hover:underline">
            {expanded ? 'Nascondi' : 'Mostra'} previsioni
          </button>
          {expanded && result.previsioni && (
            <div className="overflow-x-auto">
              <table className="w-full text-[10px]">
                <thead><tr className="bg-bg3">
                  <th className="px-2 py-1.5 text-left text-text3">Giorno</th>
                  <th className="px-2 py-1.5 text-text3">Min</th>
                  <th className="px-2 py-1.5 text-text3">Max</th>
                  <th className="px-2 py-1.5 text-left text-text3">Condizioni</th>
                  <th className="px-2 py-1.5 text-text3">Pioggia</th>
                  <th className="px-2 py-1.5 text-text3">Vento</th>
                </tr></thead>
                <tbody>
                  {result.previsioni.map((p: any, i: number) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-2 py-1.5 text-text font-medium">{p.giorno} {p.data?.split('-')[2]}</td>
                      <td className="px-2 py-1.5 text-center text-blue">{p.temp_min}</td>
                      <td className="px-2 py-1.5 text-center text-red">{p.temp_max}</td>
                      <td className="px-2 py-1.5 text-text2">{p.condizioni}</td>
                      <td className="px-2 py-1.5 text-center text-text3">{p.precipitazioni}</td>
                      <td className="px-2 py-1.5 text-center text-text3">{p.vento_max}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {expanded && result.oggi_orario && (
            <div className="overflow-x-auto">
              <table className="w-full text-[10px]">
                <thead><tr className="bg-bg3">
                  <th className="px-2 py-1.5 text-left text-text3">Ora</th>
                  <th className="px-2 py-1.5 text-text3">Temp</th>
                  <th className="px-2 py-1.5 text-left text-text3">Condizioni</th>
                  <th className="px-2 py-1.5 text-text3">Pioggia</th>
                  <th className="px-2 py-1.5 text-text3">Vento</th>
                </tr></thead>
                <tbody>
                  {result.oggi_orario.map((h: any, i: number) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-2 py-1.5 text-text font-medium">{h.ora}</td>
                      <td className="px-2 py-1.5 text-center text-text">{h.temperatura}</td>
                      <td className="px-2 py-1.5 text-text2">{h.condizioni}</td>
                      <td className="px-2 py-1.5 text-center text-text3">{h.prob_pioggia}</td>
                      <td className="px-2 py-1.5 text-center text-text3">{h.vento}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function CollapsibleWebSearch({ result }: { result: any }) {
  const [expanded, setExpanded] = useState(false)
  const fonti = result.fonti || []
  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-[10px] text-text3 hover:text-text transition-colors group"
      >
        <svg className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="font-medium text-blue">Ricerca web</span>
        <span className="text-text3">via {result.fonte || 'web'}</span>
        {fonti.length > 0 && <span className="text-text3">· {fonti.length} fonti</span>}
      </button>
      {expanded && (
        <div className="mt-2 ml-4 pl-3 border-l-2 border-blue/20 space-y-2 max-h-96 overflow-y-auto">
          <div className="bg-bg3/50 rounded-lg p-3">
            <p className="text-[11px] text-text whitespace-pre-wrap leading-relaxed">{result.risultato}</p>
          </div>
          {fonti.length > 0 && (
            <div className="space-y-1">
              <p className="text-[9px] text-text3 font-medium">Fonti:</p>
              {fonti.map((url: string, i: number) => (
                <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block text-[10px] text-blue hover:underline truncate">{url}</a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function CollapsibleDocResults({ title, count, items, output }: { title: string; count: number; items?: any[]; output?: string }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-[10px] text-text3 hover:text-text transition-colors group"
      >
        <svg className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="font-medium text-gold">{title}</span>
        <span>({count})</span>
      </button>
      {expanded && (
        <div className="mt-2 ml-4 pl-3 border-l-2 border-gold/20 space-y-2 max-h-96 overflow-y-auto">
          {items ? items.slice(0, 10).map((chunk: any, i: number) => (
            <div key={i} className="bg-bg3/50 rounded-lg p-2.5">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-medium text-gold">{chunk.sezione || chunk.display_name || `Risultato ${i + 1}`}</span>
                {chunk.documento && (
                  <span className="text-[9px] text-text3">— {chunk.documento}</span>
                )}
              </div>
              <p className="text-[11px] text-text whitespace-pre-wrap leading-relaxed">{chunk.testo?.substring(0, 500)}{chunk.testo?.length > 500 ? '...' : ''}</p>
            </div>
          )) : output ? (
            <pre className="text-[11px] text-text whitespace-pre-wrap leading-relaxed bg-bg3/50 rounded-lg p-2.5 max-h-80 overflow-y-auto">{output}</pre>
          ) : null}
        </div>
      )}
    </div>
  )
}

function renderGeneratedAudio(result: any): JSX.Element {
  if (!result?.audio_url) return renderCreateResult(result)
  return (
    <div className="space-y-2">
      <p className="text-xs text-text3">{result.messaggio}</p>
      <audio controls className="w-full max-w-sm" src={result.audio_url}>
        Il browser non supporta la riproduzione audio.
      </audio>
    </div>
  )
}

const LazyDynamicPanel = lazy(() => import('./dynamic/DynamicPanel'))

function renderDynamicView(result: any): JSX.Element {
  if (!result?.layout) return renderCreateResult(result)
  return (
    <Suspense fallback={<div className="text-xs text-text3">Caricamento vista...</div>}>
      <LazyDynamicPanel layout={result.layout} />
    </Suspense>
  )
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
  search_documents_deep: 'Ricerca Approfondita',
  summarize_document: 'Riassunto Documento',
  get_document_content: 'Contenuto Documento',
  compare_documents: 'Confronto Documenti',
  generate_image: 'Immagine generata',
  analyze_image: 'Analisi immagine',
  generate_speech: 'Sintesi vocale',
  get_api_costs: 'Costi API',
  get_signal_analytics: 'Analytics Agenti',
  generate_pdf: 'Documento PDF',
  get_whatsapp_status: 'WhatsApp',
  get_whatsapp_users: 'Utenti WhatsApp',
  archive_document: 'Documento Archiviato',
  send_whatsapp_voice: 'Vocale WhatsApp',
  send_whatsapp_message: 'Messaggio WhatsApp',
  // VFS tools
  search: 'Ricerca',
  create: 'Creazione',
  update: 'Aggiornamento',
  delete_record: 'Eliminazione',
  relate: 'Relazione',
  get_tree: 'Dettaglio',
  render_view: 'Vista dinamica',
  retrieve: 'Ricerca nel documento',
  generate_tts: 'Audio TTS',
}

export function renderToolResult(toolName: string, result: any, context?: ActionContext): JSX.Element | null {
  if (!result) return null

  const Icon = toolIcons[toolName]

  const content = (() => {
    switch (toolName) {
      case 'get_financial_summary': return renderFinancialSummary(result)
      case 'get_overdue_invoices': return renderOverdueInvoices(result, context)
      case 'get_pipeline': return renderPipeline(result)
      case 'get_projects': return renderProjects(result, context)
      case 'get_clients': return renderClients(result, context)
      case 'get_suppliers': return renderSuppliers(result)
      case 'get_passive_invoices': return renderInvoicesOrOrders(result, 'fattura')
      case 'get_orders': return renderInvoicesOrOrders(result, 'ordine')
      case 'get_quotes': return renderInvoicesOrOrders(result, 'preventivo')
      case 'get_bank_accounts': return renderBankAccounts(result)
      case 'get_expenses': return renderExpenses(result, context)
      case 'get_candidates': return renderCandidates(result, context)
      case 'get_job_postings': return renderJobPostings(result)
      case 'get_documents':
      case 'search_documents': return renderDocuments(result, context)
      case 'search_documents_deep': return renderDeepSearch(result, context)
      case 'summarize_document': return renderDocumentSummary(result)
      case 'get_document_content': return <RenderDocumentContent result={result} />
      case 'compare_documents': return renderCompareDocuments(result)
      case 'get_dashboard_summary': return renderDashboardSummary(result)
      case 'create_lead':
      case 'create_client':
      case 'create_candidate':
      case 'approve_expense': return renderCreateResult(result)
      case 'generate_image': return renderGeneratedImage(result)
      case 'generate_speech': return renderGeneratedSpeech(result)
      case 'analyze_image': return null
      case 'generate_pdf': return renderGeneratedPdf(result)
      case 'get_whatsapp_status': return renderWhatsAppStatus(result)
      // VFS generic tools
      case 'search': return renderSearchResults(result)
      case 'create': return renderCreateResult(result)
      case 'update': return renderCreateResult(result)
      case 'delete_record': return renderCreateResult(result)
      case 'relate': return renderCreateResult(result)
      case 'get_tree': return renderTreeResult(result)
      case 'retrieve': return renderRetrieveResults(result)
      case 'list_autonomous_agents':
      case 'list_workflows':
      case 'get_jobs':
      case 'get_agent_logs': return renderStructuredList(result)
      case 'list_documents': return renderDocumentList(result)
      case 'explore_document': return renderDocumentStructure(result)
      case 'generate_tts': return renderGeneratedAudio(result)
      case 'render_view': return renderDynamicView(result)
      case 'web_search': {
        if (!result?.risultato) return renderCreateResult(result)
        return <CollapsibleWebSearch result={result} />
      }
      case 'execute_code': {
        if (!result?.output || result.output.length < 50) return renderCreateResult(result)
        const lines = result.output.split('\n').filter((l: string) => l.trim())
        return <CollapsibleDocResults title="execute_code" count={lines.length} output={result.output} />
      }
      case 'get_map': {
        if (result?.errore) return renderCreateResult(result)
        return <MapResult result={result} />
      }
      case 'get_weather': {
        if (result?.errore) return renderCreateResult(result)
        return <WeatherResult result={result} />
      }
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
