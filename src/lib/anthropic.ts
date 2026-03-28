import { supabase } from './supabase'
import type { ChatMessage } from '../types'

// ── OpenRouter Client ────────────────────────────────────────
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'
const OPENROUTER_API_KEY = import.meta.env.VITE_OPENROUTER_API_KEY ?? ''
const MODEL = 'z-ai/glm-5'

// ── System Prompt ───────────────────────────────────────────
const SYSTEM_PROMPT =
  "Sei l'assistente AI di FIAI (Fabbrica Italiana Agenti Intelligenti). " +
  'Hai accesso completo ai dati aziendali: clienti, leads, fatture, preventivi, ordini, progetti, fornitori, fatture passive, conti, rimborsi, candidati HR, annunci lavoro e documenti. ' +
  'Rispondi sempre in italiano, in modo professionale e conciso. ' +
  'Usa i tool per recuperare dati reali prima di rispondere. ' +
  'Puoi creare clienti, lead, candidati e cercare documenti.'

// ── Tool Definitions (OpenAI format for OpenRouter) ──────────
const tools = [
  {
    type: 'function' as const,
    function: {
      name: 'get_financial_summary',
      description: 'Restituisce riepilogo finanziario: fatturato YTD, da incassare, liquidità',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_overdue_invoices',
      description: 'Lista fatture scadute non pagate',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_pipeline',
      description: 'Stato pipeline commerciale per fase con valori',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_projects',
      description: 'Lista progetti con stato e avanzamento',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_lead',
      description: 'Crea un nuovo lead nel CRM',
      parameters: {
        type: 'object',
        properties: {
          nome: { type: 'string' },
          contatto: { type: 'string' },
          email: { type: 'string' },
          valore: { type: 'number' },
          note: { type: 'string' },
        },
        required: ['nome'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'approve_expense',
      description: 'Approva una nota spese per ID',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_clients',
      description: 'Lista clienti con nome, tipo, email, telefono',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_suppliers',
      description: 'Lista fornitori con ragione sociale, P.IVA, email, telefono',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_passive_invoices',
      description: 'Lista fatture passive (da fornitori) con stato e scadenza',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_orders',
      description: 'Lista ordini con stato, totale e cliente',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_quotes',
      description: 'Lista preventivi con stato, totale e cliente',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_bank_accounts',
      description: 'Lista conti bancari con saldo e IBAN',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_expenses',
      description: 'Lista rimborsi e note spese con stato e categoria',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_candidates',
      description: 'Lista candidati HR con ruolo, stato e valutazione',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_job_postings',
      description: 'Lista annunci lavoro con ruolo, stato, sede e tipo contratto',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_documents',
      description: 'Lista documenti aziendali con categoria, descrizione e tags',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_client',
      description: 'Crea un nuovo cliente',
      parameters: {
        type: 'object',
        properties: {
          nome: { type: 'string', description: 'Nome del cliente' },
          cognome: { type: 'string', description: 'Cognome del cliente' },
          ragione_sociale: { type: 'string', description: 'Ragione sociale (per aziende)' },
          tipo: { type: 'string', enum: ['privato', 'azienda'], description: 'Tipo cliente' },
          email: { type: 'string' },
          telefono: { type: 'string' },
          piva: { type: 'string', description: 'Partita IVA' },
        },
        required: ['nome'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_candidate',
      description: 'Crea un nuovo candidato HR',
      parameters: {
        type: 'object',
        properties: {
          nome: { type: 'string' },
          cognome: { type: 'string' },
          email: { type: 'string' },
          telefono: { type: 'string' },
          ruolo_candidato: { type: 'string', description: 'Ruolo per cui si candida' },
          fonte: { type: 'string', description: 'Fonte della candidatura' },
          note: { type: 'string' },
        },
        required: ['nome', 'cognome'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_documents',
      description: 'Cerca documenti aziendali per query testuale',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Testo da cercare nei documenti' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_dashboard_summary',
      description: 'Overview completa: conteggio clienti, leads, fatture, progetti attivi, fatture passive da pagare, candidati',
      parameters: { type: 'object', properties: {} },
    },
  },
]

// ── Tool Execution Functions ────────────────────────────────

interface FinancialSummary {
  fatturato_ytd: number
  da_incassare: number
  liquidita_totale: number
  fatture_emesse: number
  fatture_pagate: number
}

async function getFinancialSummary(): Promise<FinancialSummary> {
  const currentYear = new Date().getFullYear()
  const yearStart = `${currentYear}-01-01`

  const [fattureRes, contiRes] = await Promise.all([
    supabase
      .from('fatture')
      .select('totale, stato')
      .gte('data', yearStart),
    supabase.from('conti').select('saldo'),
  ])

  const fatture = fattureRes.data ?? []
  const conti = contiRes.data ?? []

  const fatturato_ytd = fatture.reduce(
    (sum: number, f: { totale: number }) => sum + f.totale,
    0
  )
  const da_incassare = fatture
    .filter((f: { stato: string }) => f.stato !== 'pagata' && f.stato !== 'stornata')
    .reduce((sum: number, f: { totale: number }) => sum + f.totale, 0)
  const liquidita_totale = conti.reduce(
    (sum: number, c: { saldo: number }) => sum + c.saldo,
    0
  )
  const fatture_emesse = fatture.length
  const fatture_pagate = fatture.filter(
    (f: { stato: string }) => f.stato === 'pagata'
  ).length

  return {
    fatturato_ytd,
    da_incassare,
    liquidita_totale,
    fatture_emesse,
    fatture_pagate,
  }
}

interface OverdueInvoice {
  id: string
  numero: string
  cliente_nome: string
  totale: number
  scadenza: string
  giorni_scaduta: number
}

async function getOverdueInvoices(): Promise<OverdueInvoice[]> {
  const today = new Date().toISOString().split('T')[0]

  const { data } = await supabase
    .from('fatture')
    .select('id, numero, totale, scadenza, stato, cliente:clienti(nome, ragione_sociale)')
    .lt('scadenza', today)
    .not('stato', 'eq', 'pagata')
    .not('stato', 'eq', 'stornata')
    .order('scadenza', { ascending: true })

  const rows = data ?? []
  return rows.map((f: Record<string, unknown>) => {
    const cliente = Array.isArray(f.cliente) ? f.cliente[0] : f.cliente
    const clienteNome =
      (cliente as { ragione_sociale?: string; nome?: string } | undefined)
        ?.ragione_sociale ??
      (cliente as { nome?: string } | undefined)?.nome ??
      'N/D'
    return {
      id: f.id as string,
      numero: f.numero as string,
      cliente_nome: clienteNome,
      totale: f.totale as number,
      scadenza: f.scadenza as string,
      giorni_scaduta: Math.floor(
        (Date.now() - new Date(f.scadenza as string).getTime()) / (1000 * 60 * 60 * 24)
      ),
    }
  })
}

interface PipelinePhase {
  fase: string
  conteggio: number
  valore_totale: number
}

async function getPipeline(): Promise<PipelinePhase[]> {
  const { data } = await supabase.from('leads').select('stato, valore_stimato')

  const leads = data ?? []
  const fasi: Record<string, { conteggio: number; valore_totale: number }> = {}

  for (const lead of leads) {
    const stato = (lead as { stato: string; valore_stimato: number | null }).stato
    const valore = (lead as { stato: string; valore_stimato: number | null }).valore_stimato ?? 0
    if (!fasi[stato]) {
      fasi[stato] = { conteggio: 0, valore_totale: 0 }
    }
    fasi[stato].conteggio++
    fasi[stato].valore_totale += valore
  }

  return Object.entries(fasi).map(([fase, data]) => ({
    fase,
    conteggio: data.conteggio,
    valore_totale: data.valore_totale,
  }))
}

interface ProjectStatus {
  id: string
  nome: string
  stato: string
  cliente_nome: string
  data_fine_prevista: string | null
  budget: number | null
}

async function getProjects(): Promise<ProjectStatus[]> {
  const { data } = await supabase
    .from('progetti')
    .select('id, nome, stato, data_fine_prevista, budget, cliente:clienti(nome, ragione_sociale)')
    .not('stato', 'eq', 'annullato')
    .order('created_at', { ascending: false })

  const rows = data ?? []
  return rows.map((p: Record<string, unknown>) => {
    const cliente = Array.isArray(p.cliente) ? p.cliente[0] : p.cliente
    const clienteNome =
      (cliente as { ragione_sociale?: string; nome?: string } | undefined)
        ?.ragione_sociale ??
      (cliente as { nome?: string } | undefined)?.nome ??
      'N/D'
    return {
      id: p.id as string,
      nome: p.nome as string,
      stato: p.stato as string,
      cliente_nome: clienteNome,
      data_fine_prevista: p.data_fine_prevista as string | null,
      budget: p.budget as number | null,
    }
  })
}

interface CreateLeadInput {
  nome: string
  contatto?: string
  email?: string
  valore?: number
  note?: string
}

interface CreateLeadResult {
  successo: boolean
  id?: string
  messaggio: string
}

async function createLead(input: CreateLeadInput): Promise<CreateLeadResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { successo: false, messaggio: 'Utente non autenticato' }
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('azienda_id')
    .eq('id', user.id)
    .single()

  if (!profile) {
    return { successo: false, messaggio: 'Profilo utente non trovato' }
  }

  const parts = input.nome.trim().split(/\s+/)
  const nome = parts[0]
  const cognome = parts.length > 1 ? parts.slice(1).join(' ') : ''

  const { data, error } = await supabase
    .from('leads')
    .insert({
      azienda_id: (profile as { azienda_id: string }).azienda_id,
      nome,
      cognome,
      email: input.email ?? null,
      telefono: input.contatto ?? null,
      valore_stimato: input.valore ?? null,
      note: input.note ?? null,
      stato: 'nuovo',
    })
    .select('id')
    .single()

  if (error) {
    return { successo: false, messaggio: `Errore nella creazione: ${error.message}` }
  }

  return {
    successo: true,
    id: (data as { id: string }).id,
    messaggio: `Lead "${input.nome}" creato con successo`,
  }
}

interface ApproveExpenseResult {
  successo: boolean
  messaggio: string
}

async function approveExpense(id: string): Promise<ApproveExpenseResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { successo: false, messaggio: 'Utente non autenticato' }
  }

  const { error } = await supabase
    .from('rimborsi')
    .update({
      stato: 'approvato',
      approvato_da: user.id,
      approvato_il: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) {
    return { successo: false, messaggio: `Errore nell'approvazione: ${error.message}` }
  }

  return { successo: true, messaggio: `Rimborso ${id} approvato con successo` }
}

// ── New Tool Execution Functions ─────────────────────────────

async function getClients() {
  const { data } = await supabase
    .from('clienti')
    .select('id, nome, cognome, ragione_sociale, tipo, email, telefono')
    .order('created_at', { ascending: false })
  return data ?? []
}

async function getSuppliers() {
  const { data } = await supabase
    .from('fornitori')
    .select('id, ragione_sociale, piva, email, telefono')
    .order('created_at', { ascending: false })
  return data ?? []
}

async function getPassiveInvoices() {
  const { data } = await supabase
    .from('fatture_passive')
    .select('id, numero, totale, stato, data, scadenza, fornitore:fornitori(ragione_sociale)')
    .order('data', { ascending: false })
  return data ?? []
}

async function getOrders() {
  const { data } = await supabase
    .from('ordini')
    .select('id, numero, totale, stato, data, cliente:clienti(nome, ragione_sociale)')
    .order('data', { ascending: false })
  return data ?? []
}

async function getQuotes() {
  const { data } = await supabase
    .from('preventivi')
    .select('id, numero, totale, stato, data, cliente:clienti(nome, ragione_sociale)')
    .order('data', { ascending: false })
  return data ?? []
}

async function getBankAccounts() {
  const { data } = await supabase
    .from('conti')
    .select('id, nome, tipo, saldo, iban')
  return data ?? []
}

async function getExpenses() {
  const { data } = await supabase
    .from('rimborsi')
    .select('id, descrizione, importo, stato, data_spesa, categoria')
    .order('data_spesa', { ascending: false })
  return data ?? []
}

async function getCandidates() {
  const { data } = await supabase
    .from('candidati')
    .select('id, nome, cognome, ruolo_candidato, stato, email, valutazione, data_candidatura')
    .order('data_candidatura', { ascending: false })
  return data ?? []
}

async function getJobPostings() {
  const { data } = await supabase
    .from('annunci_lavoro')
    .select('id, ruolo, stato, sede, tipo_contratto, ral_min, ral_max')
    .order('created_at', { ascending: false })
  return data ?? []
}

async function getDocuments() {
  const { data } = await supabase
    .from('documenti')
    .select('id, nome, categoria, descrizione, tags, tipo_file, created_at')
    .order('created_at', { ascending: false })
  return data ?? []
}

interface CreateClientInput {
  nome: string
  cognome?: string
  ragione_sociale?: string
  tipo?: string
  email?: string
  telefono?: string
  piva?: string
}

async function createClient(input: CreateClientInput): Promise<CreateLeadResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { successo: false, messaggio: 'Utente non autenticato' }
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('azienda_id')
    .eq('id', user.id)
    .single()

  if (!profile) {
    return { successo: false, messaggio: 'Profilo utente non trovato' }
  }

  const { data, error } = await supabase
    .from('clienti')
    .insert({
      azienda_id: (profile as { azienda_id: string }).azienda_id,
      nome: input.nome,
      cognome: input.cognome ?? null,
      ragione_sociale: input.ragione_sociale ?? null,
      tipo: input.tipo ?? 'privato',
      email: input.email ?? null,
      telefono: input.telefono ?? null,
      piva: input.piva ?? null,
    })
    .select('id')
    .single()

  if (error) {
    return { successo: false, messaggio: `Errore nella creazione: ${error.message}` }
  }

  return {
    successo: true,
    id: (data as { id: string }).id,
    messaggio: `Cliente "${input.nome}" creato con successo`,
  }
}

interface CreateCandidateInput {
  nome: string
  cognome: string
  email?: string
  telefono?: string
  ruolo_candidato?: string
  fonte?: string
  note?: string
}

async function createCandidate(input: CreateCandidateInput): Promise<CreateLeadResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { successo: false, messaggio: 'Utente non autenticato' }
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('azienda_id')
    .eq('id', user.id)
    .single()

  if (!profile) {
    return { successo: false, messaggio: 'Profilo utente non trovato' }
  }

  const { data, error } = await supabase
    .from('candidati')
    .insert({
      azienda_id: (profile as { azienda_id: string }).azienda_id,
      nome: input.nome,
      cognome: input.cognome,
      email: input.email ?? null,
      telefono: input.telefono ?? null,
      ruolo_candidato: input.ruolo_candidato ?? null,
      fonte: input.fonte ?? null,
      note: input.note ?? null,
      stato: 'nuovo',
      data_candidatura: new Date().toISOString().split('T')[0],
    })
    .select('id')
    .single()

  if (error) {
    return { successo: false, messaggio: `Errore nella creazione: ${error.message}` }
  }

  return {
    successo: true,
    id: (data as { id: string }).id,
    messaggio: `Candidato "${input.nome} ${input.cognome}" creato con successo`,
  }
}

async function searchDocuments(query: string) {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    const token = session?.access_token ?? ''

    const res = await fetch('/api/documenti/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ query }),
    })

    if (!res.ok) {
      return { errore: `Errore nella ricerca: ${res.status}` }
    }

    return await res.json()
  } catch (err) {
    return { errore: err instanceof Error ? err.message : 'Errore nella ricerca documenti' }
  }
}

interface DashboardSummary {
  clienti: number
  leads: number
  fatture_attive: number
  fatture_da_incassare: number
  progetti_attivi: number
  fatture_passive_da_pagare: number
  candidati: number
  preventivi_aperti: number
  ordini_aperti: number
}

async function getDashboardSummary(): Promise<DashboardSummary> {
  const [
    clientiRes,
    leadsRes,
    fattureRes,
    progettiRes,
    fatturePassiveRes,
    candidatiRes,
    preventiviRes,
    ordiniRes,
  ] = await Promise.all([
    supabase.from('clienti').select('id', { count: 'exact', head: true }),
    supabase.from('leads').select('id', { count: 'exact', head: true }),
    supabase.from('fatture').select('id, stato', { count: 'exact' }),
    supabase.from('progetti').select('id', { count: 'exact', head: true }).in('stato', ['in_corso', 'attivo', 'pianificato']),
    supabase.from('fatture_passive').select('id', { count: 'exact', head: true }).in('stato', ['da_pagare', 'in_scadenza', 'scaduta']),
    supabase.from('candidati').select('id', { count: 'exact', head: true }),
    supabase.from('preventivi').select('id', { count: 'exact', head: true }).in('stato', ['inviato', 'bozza', 'in_attesa']),
    supabase.from('ordini').select('id', { count: 'exact', head: true }).in('stato', ['confermato', 'in_lavorazione', 'nuovo']),
  ])

  const fattureData = fattureRes.data ?? []
  const fatture_da_incassare = fattureData.filter(
    (f: { stato: string }) => f.stato !== 'pagata' && f.stato !== 'stornata'
  ).length

  return {
    clienti: clientiRes.count ?? 0,
    leads: leadsRes.count ?? 0,
    fatture_attive: fattureRes.count ?? 0,
    fatture_da_incassare,
    progetti_attivi: progettiRes.count ?? 0,
    fatture_passive_da_pagare: fatturePassiveRes.count ?? 0,
    candidati: candidatiRes.count ?? 0,
    preventivi_aperti: preventiviRes.count ?? 0,
    ordini_aperti: ordiniRes.count ?? 0,
  }
}

// ── Tool Executor ───────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolResult = any

async function executeTool(
  name: string,
  input: Record<string, unknown>
): Promise<ToolResult> {
  switch (name) {
    case 'get_financial_summary':
      return getFinancialSummary()
    case 'get_overdue_invoices':
      return getOverdueInvoices()
    case 'get_pipeline':
      return getPipeline()
    case 'get_projects':
      return getProjects()
    case 'create_lead':
      return createLead(input as unknown as CreateLeadInput)
    case 'approve_expense':
      return approveExpense((input as { id: string }).id)
    case 'get_clients':
      return getClients()
    case 'get_suppliers':
      return getSuppliers()
    case 'get_passive_invoices':
      return getPassiveInvoices()
    case 'get_orders':
      return getOrders()
    case 'get_quotes':
      return getQuotes()
    case 'get_bank_accounts':
      return getBankAccounts()
    case 'get_expenses':
      return getExpenses()
    case 'get_candidates':
      return getCandidates()
    case 'get_job_postings':
      return getJobPostings()
    case 'get_documents':
      return getDocuments()
    case 'create_client':
      return createClient(input as unknown as CreateClientInput)
    case 'create_candidate':
      return createCandidate(input as unknown as CreateCandidateInput)
    case 'search_documents':
      return searchDocuments((input as { query: string }).query)
    case 'get_dashboard_summary':
      return getDashboardSummary()
    default:
      throw new Error(`Tool sconosciuto: ${name}`)
  }
}

// ── Message Types ───────────────────────────────────────────
interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string | object[]
}

export interface ToolUseEvent {
  toolName: string
  status: 'running' | 'done'
}

// ── OpenRouter API Call ──────────────────────────────────────
async function callOpenRouter(messages: OpenRouterMessage[], retries = 3): Promise<any> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        tools,
        max_tokens: 4096,
      }),
    })

    if (res.status === 429 && attempt < retries - 1) {
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)))
      continue
    }

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`OpenRouter error ${res.status}: ${err}`)
    }

    const data = await res.json()
    if (data.error && attempt < retries - 1) {
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)))
      continue
    }

    return data
  }
  throw new Error('OpenRouter: troppi tentativi falliti')
}

// ── Main Send Message Function ──────────────────────────────
export async function sendMessage(
  messages: ConversationMessage[],
  sessionId: string,
  onToolUse?: (event: ToolUseEvent) => void
): Promise<{ text: string; toolCalls: Record<string, unknown>[] }> {
  // Build API messages
  const apiMessages: OpenRouterMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    })),
  ]

  let response = await callOpenRouter(apiMessages)
  const allToolCalls: Record<string, unknown>[] = []

  // Handle tool use loop
  while (response.choices?.[0]?.finish_reason === 'tool_calls' || response.choices?.[0]?.message?.tool_calls) {
    const assistantMessage = response.choices[0].message
    apiMessages.push(assistantMessage)

    const toolCalls = assistantMessage.tool_calls ?? []

    for (const toolCall of toolCalls) {
      const fnName = toolCall.function.name
      let fnArgs: Record<string, unknown> = {}
      try {
        fnArgs = JSON.parse(toolCall.function.arguments || '{}')
      } catch {
        // empty args
      }

      onToolUse?.({ toolName: fnName, status: 'running' })

      allToolCalls.push({ tool: fnName, input: fnArgs })

      try {
        const result = await executeTool(fnName, fnArgs)
        apiMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        })
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Errore sconosciuto'
        apiMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({ errore: errorMessage }),
        })
      }

      onToolUse?.({ toolName: fnName, status: 'done' })
    }

    response = await callOpenRouter(apiMessages)
  }

  // Extract final text
  const text = response.choices?.[0]?.message?.content ?? ''

  // Save messages to DB
  try {
    const lastUserMsg = messages[messages.length - 1]
    if (lastUserMsg && lastUserMsg.role === 'user') {
      const userContent =
        typeof lastUserMsg.content === 'string'
          ? lastUserMsg.content
          : JSON.stringify(lastUserMsg.content)

      await supabase.from('chat_messages').insert({
        session_id: sessionId,
        ruolo: 'user',
        contenuto: userContent,
        tool_calls: null,
      })
    }

    await supabase.from('chat_messages').insert({
      session_id: sessionId,
      ruolo: 'assistant',
      contenuto: text,
      tool_calls: allToolCalls.length > 0 ? allToolCalls : null,
    })
  } catch {
    console.warn('Errore nel salvataggio messaggi chat')
  }

  return { text, toolCalls: allToolCalls }
}

// ── Session Management ──────────────────────────────────────
export async function createChatSession(
  title: string
): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('azienda_id')
    .eq('id', user.id)
    .single()

  if (!profile) return null

  const { data, error } = await supabase
    .from('chat_sessions')
    .insert({
      azienda_id: (profile as { azienda_id: string }).azienda_id,
      user_id: user.id,
      titolo: title,
    })
    .select('id')
    .single()

  if (error) return null
  return (data as { id: string }).id
}

export async function fetchChatSessions(): Promise<
  { id: string; titolo: string; created_at: string; updated_at: string }[]
> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from('chat_sessions')
    .select('id, titolo, created_at, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })

  return (data ?? []) as {
    id: string
    titolo: string
    created_at: string
    updated_at: string
  }[]
}

export async function fetchSessionMessages(
  sessionId: string
): Promise<ChatMessage[]> {
  const { data } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })

  return (data ?? []) as ChatMessage[]
}

export async function updateSessionTitle(
  sessionId: string,
  title: string
): Promise<void> {
  await supabase
    .from('chat_sessions')
    .update({ titolo: title, updated_at: new Date().toISOString() })
    .eq('id', sessionId)
}
