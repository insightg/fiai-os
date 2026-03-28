import { supabase } from './supabase'
import type {
  Fattura,
  FatturaPassiva,
  Lead,
  Progetto,
  Conto,
  Rimborso,
  Cliente,
  Fornitore,
} from '../types'

// ── Helpers ────────────────────────────────────────────────

const currentYear = () => new Date().getFullYear()

const yearStart = () => `${currentYear()}-01-01`
const yearEnd = () => `${currentYear()}-12-31`

const MONTH_LABELS = [
  'Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu',
  'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic',
]

/** Format number in Italian € style:  € 1.234,56 */
export function formatEuro(n: number): string {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n)
}

export function formatEuroCents(n: number): string {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('it-IT').format(n)
}

// ── Data types ─────────────────────────────────────────────

export interface MonthlyAmount {
  mese: string
  totale: number
}

export interface PipelineFase {
  fase: string
  valore: number
}

export interface FatturaScaduta {
  id: string
  numero: string
  cliente_nome: string
  importo: number
  giorni_scaduti: number
}

export interface AttivitaRecente {
  id: string
  tipo: 'lead' | 'fattura' | 'progetto'
  descrizione: string
  data: string
}

export interface ClienteRicavo {
  name: string
  value: number
}

export interface FornitoreSpesa {
  name: string
  value: number
}

export interface CashFlowMese {
  mese: string
  entrate: number
  uscite: number
}

export interface MargineMese {
  mese: string
  margine: number
}

// ── KPI Fetchers ───────────────────────────────────────────

/** Fatturato YTD: sum of fatture pagate this year */
export async function fetchFatturatoYTD(): Promise<number> {
  const { data } = await supabase
    .from('fatture')
    .select('totale')
    .eq('stato', 'pagata')
    .gte('data', yearStart())
    .lte('data', yearEnd())

  return (data ?? []).reduce((sum: number, f: Pick<Fattura, 'totale'>) => sum + f.totale, 0)
}

/** Da Incassare: sum of fatture inviata/scaduta */
export async function fetchDaIncassare(): Promise<number> {
  const { data } = await supabase
    .from('fatture')
    .select('totale')
    .in('stato', ['inviata_sdi', 'emessa', 'scaduta'])

  return (data ?? []).reduce((sum: number, f: Pick<Fattura, 'totale'>) => sum + f.totale, 0)
}

/** Pipeline Valore: sum of leads attivi (non perso/convertito) */
export async function fetchPipelineValore(): Promise<number> {
  const { data } = await supabase
    .from('leads')
    .select('valore_stimato')
    .not('stato', 'in', '("perso","convertito")')

  return (data ?? []).reduce((sum: number, l: Pick<Lead, 'valore_stimato'>) => sum + (l.valore_stimato ?? 0), 0)
}

/** Progetti Attivi: count progetti in_corso */
export async function fetchProgettiAttivi(): Promise<number> {
  const { count } = await supabase
    .from('progetti')
    .select('id', { count: 'exact', head: true })
    .eq('stato', 'in_corso')

  return count ?? 0
}

/** Spese YTD: fatture passive pagate + rimborsi approvati/rimborsati */
export async function fetchSpeseYTD(): Promise<number> {
  const [fpRes, rRes] = await Promise.all([
    supabase
      .from('fatture_passive')
      .select('totale')
      .eq('stato', 'pagata')
      .gte('data', yearStart())
      .lte('data', yearEnd()),
    supabase
      .from('rimborsi')
      .select('importo')
      .in('stato', ['approvato', 'rimborsato'])
      .gte('data_spesa', yearStart())
      .lte('data_spesa', yearEnd()),
  ])

  const fpTot = (fpRes.data ?? []).reduce((s: number, f: Pick<FatturaPassiva, 'totale'>) => s + f.totale, 0)
  const rTot = (rRes.data ?? []).reduce((s: number, r: Pick<Rimborso, 'importo'>) => s + r.importo, 0)

  return fpTot + rTot
}

/** Liquidità: sum saldi conti */
export async function fetchLiquidita(): Promise<number> {
  const { data } = await supabase
    .from('conti')
    .select('saldo')

  return (data ?? []).reduce((sum: number, c: Pick<Conto, 'saldo'>) => sum + c.saldo, 0)
}

// ── Chart Data ─────────────────────────────────────────────

/** Fatturato mensile YTD: monthly breakdown of fatture pagate */
export async function fetchFatturatoMensile(): Promise<MonthlyAmount[]> {
  const { data } = await supabase
    .from('fatture')
    .select('data, totale')
    .eq('stato', 'pagata')
    .gte('data', yearStart())
    .lte('data', yearEnd())

  const months = new Array(12).fill(0) as number[]
  for (const f of data ?? []) {
    const d = f as Pick<Fattura, 'data' | 'totale'>
    const m = new Date(d.data).getMonth()
    months[m] += d.totale
  }

  return months.map((tot, i) => ({
    mese: MONTH_LABELS[i],
    totale: Math.round(tot),
  }))
}

/** Pipeline per Fase: lead values grouped by stato */
export async function fetchPipelinePerFase(): Promise<PipelineFase[]> {
  const { data } = await supabase
    .from('leads')
    .select('stato, valore_stimato')
    .not('stato', 'in', '("perso","convertito")')

  const map: Record<string, number> = {}
  for (const l of data ?? []) {
    const lead = l as Pick<Lead, 'stato' | 'valore_stimato'>
    const key = lead.stato
    map[key] = (map[key] ?? 0) + (lead.valore_stimato ?? 0)
  }

  const faseLabels: Record<string, string> = {
    nuovo: 'Nuovo',
    contattato: 'Contattato',
    qualificato: 'Qualificato',
    proposta: 'Proposta',
  }

  return Object.entries(map).map(([fase, valore]) => ({
    fase: faseLabels[fase] ?? fase,
    valore: Math.round(valore),
  }))
}

/** Fatture scadute (overdue) */
export async function fetchFattureScadute(): Promise<FatturaScaduta[]> {
  const today = new Date().toISOString().slice(0, 10)

  const { data } = await supabase
    .from('fatture')
    .select('id, numero, totale, scadenza, cliente:clienti(nome, ragione_sociale)')
    .in('stato', ['inviata_sdi', 'emessa', 'scaduta'])
    .lt('scadenza', today)
    .order('scadenza', { ascending: true })
    .limit(10)

  return (data ?? []).map((f: Record<string, unknown>) => {
    const row = f as unknown as Fattura & { cliente: Pick<Cliente, 'nome' | 'ragione_sociale'> | null }
    const scadenza = row.scadenza ? new Date(row.scadenza) : new Date()
    const diffMs = Date.now() - scadenza.getTime()
    const giorni = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)))
    return {
      id: row.id,
      numero: row.numero,
      cliente_nome: row.cliente?.ragione_sociale ?? row.cliente?.nome ?? '-',
      importo: row.totale,
      giorni_scaduti: giorni,
    }
  })
}

/** Attività recenti: latest leads, invoices, projects */
export async function fetchAttivitaRecenti(): Promise<AttivitaRecente[]> {
  const [leadsRes, fattureRes, progettiRes] = await Promise.all([
    supabase
      .from('leads')
      .select('id, nome, cognome, created_at')
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('fatture')
      .select('id, numero, stato, updated_at')
      .order('updated_at', { ascending: false })
      .limit(5),
    supabase
      .from('progetti')
      .select('id, nome, stato, updated_at')
      .order('updated_at', { ascending: false })
      .limit(5),
  ])

  const items: AttivitaRecente[] = []

  for (const l of leadsRes.data ?? []) {
    const lead = l as Pick<Lead, 'id' | 'nome' | 'cognome' | 'created_at'>
    items.push({
      id: lead.id,
      tipo: 'lead',
      descrizione: `Nuovo lead: ${lead.nome} ${lead.cognome}`,
      data: lead.created_at,
    })
  }

  for (const f of fattureRes.data ?? []) {
    const fattura = f as Pick<Fattura, 'id' | 'numero' | 'stato' | 'updated_at'>
    items.push({
      id: fattura.id,
      tipo: 'fattura',
      descrizione: `Fattura ${fattura.numero} — ${fattura.stato}`,
      data: fattura.updated_at,
    })
  }

  for (const p of progettiRes.data ?? []) {
    const progetto = p as Pick<Progetto, 'id' | 'nome' | 'stato' | 'updated_at'>
    items.push({
      id: progetto.id,
      tipo: 'progetto',
      descrizione: `Progetto "${progetto.nome}" — ${progetto.stato}`,
      data: progetto.updated_at,
    })
  }

  items.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime())
  return items.slice(0, 10)
}

// ── Report Chart Data ──────────────────────────────────────

/** Cash flow mensile: entrate from fatture pagate, uscite from fp pagate + rimborsi */
export async function fetchCashFlow(from: string, to: string): Promise<CashFlowMese[]> {
  const [fattureRes, fpRes, rimborsiRes] = await Promise.all([
    supabase
      .from('fatture')
      .select('data, totale')
      .eq('stato', 'pagata')
      .gte('data', from)
      .lte('data', to),
    supabase
      .from('fatture_passive')
      .select('data, totale')
      .eq('stato', 'pagata')
      .gte('data', from)
      .lte('data', to),
    supabase
      .from('rimborsi')
      .select('data_spesa, importo')
      .in('stato', ['approvato', 'rimborsato'])
      .gte('data_spesa', from)
      .lte('data_spesa', to),
  ])

  const entrate = new Array(12).fill(0) as number[]
  const uscite = new Array(12).fill(0) as number[]

  for (const f of fattureRes.data ?? []) {
    const row = f as Pick<Fattura, 'data' | 'totale'>
    entrate[new Date(row.data).getMonth()] += row.totale
  }
  for (const f of fpRes.data ?? []) {
    const row = f as Pick<FatturaPassiva, 'data' | 'totale'>
    uscite[new Date(row.data).getMonth()] += row.totale
  }
  for (const r of rimborsiRes.data ?? []) {
    const row = r as { data_spesa: string; importo: number }
    uscite[new Date(row.data_spesa).getMonth()] += row.importo
  }

  return MONTH_LABELS.map((mese, i) => ({
    mese,
    entrate: Math.round(entrate[i]),
    uscite: Math.round(uscite[i]),
  }))
}

/** Top clienti per fatturato */
export async function fetchTopClienti(from: string, to: string): Promise<ClienteRicavo[]> {
  const { data } = await supabase
    .from('fatture')
    .select('totale, cliente:clienti(id, nome, ragione_sociale)')
    .eq('stato', 'pagata')
    .gte('data', from)
    .lte('data', to)

  const map: Record<string, { nome: string; tot: number }> = {}
  for (const f of data ?? []) {
    const row = f as unknown as Fattura & { cliente: Pick<Cliente, 'id' | 'nome' | 'ragione_sociale'> | null }
    const cid = row.cliente?.id ?? 'unknown'
    const cname = row.cliente?.ragione_sociale ?? row.cliente?.nome ?? 'Sconosciuto'
    if (!map[cid]) map[cid] = { nome: cname, tot: 0 }
    map[cid].tot += row.totale
  }

  return Object.values(map)
    .sort((a, b) => b.tot - a.tot)
    .slice(0, 8)
    .map((c) => ({ name: c.nome, value: Math.round(c.tot) }))
}

/** Top fornitori per spesa */
export async function fetchTopFornitori(from: string, to: string): Promise<FornitoreSpesa[]> {
  const { data } = await supabase
    .from('fatture_passive')
    .select('totale, fornitore:fornitori(id, ragione_sociale)')
    .eq('stato', 'pagata')
    .gte('data', from)
    .lte('data', to)

  const map: Record<string, { nome: string; tot: number }> = {}
  for (const f of data ?? []) {
    const row = f as unknown as FatturaPassiva & { fornitore: Pick<Fornitore, 'id' | 'ragione_sociale'> | null }
    const fid = row.fornitore?.id ?? 'unknown'
    const fname = row.fornitore?.ragione_sociale ?? 'Sconosciuto'
    if (!map[fid]) map[fid] = { nome: fname, tot: 0 }
    map[fid].tot += row.totale
  }

  return Object.values(map)
    .sort((a, b) => b.tot - a.tot)
    .slice(0, 8)
    .map((f) => ({ name: f.nome, value: Math.round(f.tot) }))
}

/** Margine operativo mensile: fatturato - spese per mese */
export async function fetchMargineMensile(from: string, to: string): Promise<MargineMese[]> {
  const cashFlow = await fetchCashFlow(from, to)
  return cashFlow.map((m) => ({
    mese: m.mese,
    margine: m.entrate - m.uscite,
  }))
}

/** Fatturato mensile with custom range */
export async function fetchFatturatoMensileRange(from: string, to: string): Promise<MonthlyAmount[]> {
  const { data } = await supabase
    .from('fatture')
    .select('data, totale')
    .eq('stato', 'pagata')
    .gte('data', from)
    .lte('data', to)

  const months = new Array(12).fill(0) as number[]
  for (const f of data ?? []) {
    const d = f as Pick<Fattura, 'data' | 'totale'>
    const m = new Date(d.data).getMonth()
    months[m] += d.totale
  }

  return months.map((tot, i) => ({
    mese: MONTH_LABELS[i],
    totale: Math.round(tot),
  }))
}
