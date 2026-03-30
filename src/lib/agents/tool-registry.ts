import { supabase } from '../supabase'
import type { AgentToolDefinition, AgentDomain } from './types'

// ── Tool Definitions (OpenAI format for OpenRouter) ──────────

const toolDefinitions: { domain: AgentDomain; definition: AgentToolDefinition['definition'] }[] = [
  {
    domain: 'amministrazione',
    definition: {
      type: 'function' as const,
      function: {
        name: 'get_financial_summary',
        description: 'Restituisce riepilogo finanziario: fatturato YTD, da incassare, liquidità',
        parameters: { type: 'object', properties: {} },
      },
    },
  },
  {
    domain: 'amministrazione',
    definition: {
      type: 'function' as const,
      function: {
        name: 'get_overdue_invoices',
        description: 'Lista fatture scadute non pagate',
        parameters: { type: 'object', properties: {} },
      },
    },
  },
  {
    domain: 'commerciale',
    definition: {
      type: 'function' as const,
      function: {
        name: 'get_pipeline',
        description: 'Stato pipeline commerciale per fase con valori',
        parameters: { type: 'object', properties: {} },
      },
    },
  },
  {
    domain: 'produzione',
    definition: {
      type: 'function' as const,
      function: {
        name: 'get_projects',
        description: 'Lista progetti con stato e avanzamento',
        parameters: { type: 'object', properties: {} },
      },
    },
  },
  {
    domain: 'commerciale',
    definition: {
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
  },
  {
    domain: 'amministrazione',
    definition: {
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
  },
  {
    domain: 'commerciale',
    definition: {
      type: 'function' as const,
      function: {
        name: 'get_clients',
        description: 'Lista clienti con nome, tipo, email, telefono',
        parameters: { type: 'object', properties: {} },
      },
    },
  },
  {
    domain: 'amministrazione',
    definition: {
      type: 'function' as const,
      function: {
        name: 'get_suppliers',
        description: 'Lista fornitori con ragione sociale, P.IVA, email, telefono',
        parameters: { type: 'object', properties: {} },
      },
    },
  },
  {
    domain: 'amministrazione',
    definition: {
      type: 'function' as const,
      function: {
        name: 'get_passive_invoices',
        description: 'Lista fatture passive (da fornitori) con stato e scadenza',
        parameters: { type: 'object', properties: {} },
      },
    },
  },
  {
    domain: 'produzione',
    definition: {
      type: 'function' as const,
      function: {
        name: 'get_orders',
        description: 'Lista ordini con stato, totale e cliente',
        parameters: { type: 'object', properties: {} },
      },
    },
  },
  {
    domain: 'produzione',
    definition: {
      type: 'function' as const,
      function: {
        name: 'get_quotes',
        description: 'Lista preventivi con stato, totale e cliente',
        parameters: { type: 'object', properties: {} },
      },
    },
  },
  {
    domain: 'amministrazione',
    definition: {
      type: 'function' as const,
      function: {
        name: 'get_bank_accounts',
        description: 'Lista conti bancari con saldo e IBAN',
        parameters: { type: 'object', properties: {} },
      },
    },
  },
  {
    domain: 'amministrazione',
    definition: {
      type: 'function' as const,
      function: {
        name: 'get_expenses',
        description: 'Lista rimborsi e note spese con stato e categoria',
        parameters: { type: 'object', properties: {} },
      },
    },
  },
  {
    domain: 'hr',
    definition: {
      type: 'function' as const,
      function: {
        name: 'get_candidates',
        description: 'Lista candidati HR con ruolo, stato e valutazione',
        parameters: { type: 'object', properties: {} },
      },
    },
  },
  {
    domain: 'hr',
    definition: {
      type: 'function' as const,
      function: {
        name: 'get_job_postings',
        description: 'Lista annunci lavoro con ruolo, stato, sede e tipo contratto',
        parameters: { type: 'object', properties: {} },
      },
    },
  },
  {
    domain: 'legal',
    definition: {
      type: 'function' as const,
      function: {
        name: 'get_documents',
        description: 'Lista documenti aziendali con categoria, descrizione e tags',
        parameters: { type: 'object', properties: {} },
      },
    },
  },
  {
    domain: 'commerciale',
    definition: {
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
  },
  {
    domain: 'hr',
    definition: {
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
  },
  {
    domain: 'legal',
    definition: {
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
  },
  {
    domain: 'documents',
    definition: {
      type: 'function' as const,
      function: {
        name: 'search_documents_deep',
        description: 'Ricerca approfondita documenti con varianti di query e sintesi RAG',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Testo da cercare in profondità nei documenti' },
          },
          required: ['query'],
        },
      },
    },
  },
  {
    domain: 'documents',
    definition: {
      type: 'function' as const,
      function: {
        name: 'summarize_document',
        description: 'Riassume un documento estraendo informazioni chiave (date, parti, importi, obblighi)',
        parameters: {
          type: 'object',
          properties: {
            documentId: { type: 'string', description: 'ID del documento da riassumere' },
          },
          required: ['documentId'],
        },
      },
    },
  },
  {
    domain: 'documents',
    definition: {
      type: 'function' as const,
      function: {
        name: 'get_document_content',
        description: 'Legge il contenuto testuale di un documento',
        parameters: {
          type: 'object',
          properties: {
            documentId: { type: 'string', description: 'ID del documento di cui leggere il contenuto' },
          },
          required: ['documentId'],
        },
      },
    },
  },
  {
    domain: 'documents',
    definition: {
      type: 'function' as const,
      function: {
        name: 'compare_documents',
        description: 'Confronta due documenti evidenziando somiglianze e differenze',
        parameters: {
          type: 'object',
          properties: {
            docId1: { type: 'string', description: 'ID del primo documento' },
            docId2: { type: 'string', description: 'ID del secondo documento' },
          },
          required: ['docId1', 'docId2'],
        },
      },
    },
  },
  {
    domain: 'pulse',
    definition: {
      type: 'function' as const,
      function: {
        name: 'get_dashboard_summary',
        description: 'Overview completa: conteggio clienti, leads, fatture, progetti attivi, fatture passive da pagare, candidati',
        parameters: { type: 'object', properties: {} },
      },
    },
  },
  {
    domain: 'infra',
    definition: {
      type: 'function' as const,
      function: {
        name: 'get_api_costs',
        description: 'Costi API OpenRouter: credito utilizzato totale, giornaliero, settimanale, mensile',
        parameters: { type: 'object', properties: {} },
      },
    },
  },
  {
    domain: 'infra',
    definition: {
      type: 'function' as const,
      function: {
        name: 'get_signal_analytics',
        description: 'Statistiche interazioni agenti: conteggio per agente, latenza media, costi per dominio, errori',
        parameters: { type: 'object', properties: {} },
      },
    },
  },
  {
    domain: 'pulse',
    definition: {
      type: 'function' as const,
      function: {
        name: 'generate_pdf',
        description: 'Genera un documento PDF professionale. Templates: report_finanziario, lista_clienti, stato_progetti, pipeline_commerciale, report_hr, report_generico',
        parameters: {
          type: 'object',
          properties: {
            template: { type: 'string', description: 'ID template: report_finanziario, lista_clienti, stato_progetti, pipeline_commerciale, report_hr, report_generico' },
            data: { type: 'object', description: 'Dati da inserire nel report' },
            filename: { type: 'string', description: 'Nome del file (senza .pdf)' },
          },
          required: ['template', 'data'],
        },
      },
    },
  },
  {
    domain: 'infra',
    definition: {
      type: 'function' as const,
      function: {
        name: 'get_whatsapp_status',
        description: 'Stato connessione WhatsApp: connesso/disconnesso, QR code disponibile, sessione attiva',
        parameters: { type: 'object', properties: {} },
      },
    },
  },
  {
    domain: 'infra',
    definition: {
      type: 'function' as const,
      function: {
        name: 'get_whatsapp_users',
        description: 'Lista utenti collegati a WhatsApp con numero telefono e account FIAI',
        parameters: { type: 'object', properties: {} },
      },
    },
  },
  {
    domain: 'documents',
    definition: {
      type: 'function' as const,
      function: {
        name: 'archive_document',
        description: 'Archivia un documento nel sistema con categoria, tags, descrizione e testo estratto per renderlo ricercabile',
        parameters: {
          type: 'object',
          properties: {
            nome: { type: 'string', description: 'Nome del documento' },
            file_url: { type: 'string', description: 'URL del file caricato' },
            categoria: { type: 'string', description: 'Categoria: legale, pubblicita, documentazione_tecnica, normative, atti, contratti, altro' },
            tags: { type: 'string', description: 'Tags separati da virgola' },
            descrizione: { type: 'string', description: 'Descrizione del documento' },
            contenuto_testo: { type: 'string', description: 'Testo estratto dal documento per la ricerca full-text' },
          },
          required: ['nome', 'file_url', 'categoria'],
        },
      },
    },
  },
  {
    domain: 'infra',
    definition: {
      type: 'function' as const,
      function: {
        name: 'send_whatsapp_voice',
        description: 'Invia un messaggio vocale WhatsApp a un utente. Genera audio TTS e lo invia come voice note.',
        parameters: {
          type: 'object',
          properties: {
            phone: { type: 'string', description: 'Numero telefono destinatario' },
            text: { type: 'string', description: 'Testo da pronunciare nel vocale' },
            voice: { type: 'string', description: 'Voce TTS (Vivian, Ryan, Serena)' },
          },
          required: ['phone', 'text'],
        },
      },
    },
  },
  {
    domain: 'infra',
    definition: {
      type: 'function' as const,
      function: {
        name: 'send_whatsapp_message',
        description: 'Invia un messaggio di testo WhatsApp a un utente',
        parameters: {
          type: 'object',
          properties: {
            phone: { type: 'string', description: 'Numero telefono destinatario' },
            text: { type: 'string', description: 'Testo del messaggio' },
          },
          required: ['phone', 'text'],
        },
      },
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

  const fatturato_ytd = fatture
    .filter((f: { stato: string }) => f.stato !== 'stornata')
    .reduce((sum: number, f: { totale: number }) => sum + f.totale, 0)
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

async function searchDocumentsDeep(query: string) {
  try {
    const { getAuthToken } = await import('../supabase')
    const token = getAuthToken() ?? ''

    const res = await fetch('/api/documenti/search-deep', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ query }),
    })

    if (!res.ok) {
      return { errore: `Errore nella ricerca approfondita: ${res.status}` }
    }

    return await res.json()
  } catch (err) {
    return { errore: err instanceof Error ? err.message : 'Errore nella ricerca approfondita' }
  }
}

async function summarizeDocument(documentId: string) {
  try {
    const { getAuthToken } = await import('../supabase')
    const token = getAuthToken() ?? ''

    const res = await fetch('/api/documenti/summarize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ documentId }),
    })

    if (!res.ok) {
      return { errore: `Errore nel riassunto: ${res.status}` }
    }

    return await res.json()
  } catch (err) {
    return { errore: err instanceof Error ? err.message : 'Errore nel riassunto documento' }
  }
}

async function getDocumentContent(documentId: string) {
  try {
    const { getAuthToken } = await import('../supabase')
    const token = getAuthToken() ?? ''

    const res = await fetch(`/api/documenti/content/${documentId}`, {
      headers: {
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
    })

    if (!res.ok) {
      return { errore: `Errore nel recupero contenuto: ${res.status}` }
    }

    return await res.json()
  } catch (err) {
    return { errore: err instanceof Error ? err.message : 'Errore nel recupero contenuto documento' }
  }
}

async function compareDocuments(docId1: string, docId2: string) {
  try {
    const { getAuthToken } = await import('../supabase')
    const token = getAuthToken() ?? ''

    // Fetch both documents' content
    const [res1, res2] = await Promise.all([
      fetch(`/api/documenti/content/${docId1}`, {
        headers: { ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
      }),
      fetch(`/api/documenti/content/${docId2}`, {
        headers: { ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
      }),
    ])

    if (!res1.ok || !res2.ok) {
      return { errore: 'Impossibile recuperare uno o entrambi i documenti' }
    }

    const doc1 = await res1.json()
    const doc2 = await res2.json()

    if (!doc1.contenuto_testo || !doc2.contenuto_testo) {
      return { errore: 'Uno o entrambi i documenti non hanno contenuto testuale estraibile' }
    }

    // Call the backend compare endpoint (we'll use summarize-style LLM call via a dedicated endpoint)
    // For simplicity, we build the comparison request client-side and call a generic LLM endpoint
    // Actually, let's call the backend to do the comparison
    const compareRes = await fetch('/api/documenti/compare', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ docId1, docId2 }),
    })

    if (!compareRes.ok) {
      return { errore: `Errore nel confronto: ${compareRes.status}` }
    }

    return await compareRes.json()
  } catch (err) {
    return { errore: err instanceof Error ? err.message : 'Errore nel confronto documenti' }
  }
}

async function searchDocuments(query: string) {
  try {
    const { getAuthToken } = await import('../supabase')
    const token = getAuthToken() ?? ''

    const res = await fetch('/api/documenti/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
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

// ── API Costs (OpenRouter) ────────────────────────────────

async function getApiCosts() {
  try {
    const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY ?? ''
    const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    })
    if (!res.ok) return { errore: 'Impossibile recuperare i costi API' }
    const data = await res.json()
    const d = data.data ?? {}
    return {
      credito_utilizzato_totale: `$${(d.usage ?? 0).toFixed(4)}`,
      costo_oggi: `$${(d.usage_daily ?? 0).toFixed(4)}`,
      costo_settimana: `$${(d.usage_weekly ?? 0).toFixed(4)}`,
      costo_mese: `$${(d.usage_monthly ?? 0).toFixed(4)}`,
      limite: d.limit ? `$${d.limit}` : 'Nessun limite',
      limite_residuo: d.limit_remaining ? `$${d.limit_remaining}` : 'N/D',
      piano: d.is_free_tier ? 'Free' : 'A pagamento',
    }
  } catch (err) {
    return { errore: (err as Error).message }
  }
}

// ── Signal Analytics ─────────────────────────────────────

async function getSignalAnalytics() {
  try {
    const { getAuthToken } = await import('../supabase')
    const token = getAuthToken() ?? ''
    // Read signals from context files via backend
    const res = await fetch('/api/signals/analytics', {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    })
    if (!res.ok) {
      // Fallback: return basic info
      return {
        note: 'Analytics dettagliate non disponibili. Usa il pannello Infra per visualizzare i dati.',
      }
    }
    return await res.json()
  } catch {
    return { note: 'Servizio analytics non raggiungibile' }
  }
}

// ── PDF Generation ───────────────────────────────────────────

async function generatePdf(input: { template: string; data: any; filename?: string }) {
  try {
    const { getAuthToken } = await import('../supabase')
    const token = getAuthToken() ?? ''

    const res = await fetch('/api/pdf/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(input),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Errore generazione PDF' }))
      return { successo: false, messaggio: err.error || 'Errore generazione PDF' }
    }

    const result = await res.json()
    return { successo: true, url: result.url, filename: result.filename, messaggio: 'PDF generato con successo' }
  } catch (err) {
    return { successo: false, messaggio: (err as Error).message }
  }
}

// ── WhatsApp Status ──────────────────────────────────────────

async function getWhatsAppStatus() {
  try {
    const { getAuthToken } = await import('../supabase')
    const token = getAuthToken() ?? ''
    const res = await fetch('/api/whatsapp/status', {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    })
    if (!res.ok) return { errore: 'Impossibile recuperare lo stato WhatsApp' }
    const data = await res.json()
    return {
      stato: data.status === 'connected' ? '🟢 Connesso' : data.status === 'connecting' ? '🟡 In connessione' : '🔴 Disconnesso',
      qr_disponibile: data.qrCode ? 'Sì' : 'No',
      sessione_salvata: data.hasAuth ? 'Sì' : 'No',
      qrImage: data.qrImage || null,
    }
  } catch {
    return { errore: 'Servizio WhatsApp non raggiungibile' }
  }
}

async function getWhatsAppUsers() {
  try {
    const { getAuthToken } = await import('../supabase')
    const token = getAuthToken() ?? ''
    const res = await fetch('/api/whatsapp/users', {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    })
    if (!res.ok) return { errore: 'Impossibile recuperare utenti WhatsApp' }
    const data = await res.json()
    return data.users || []
  } catch {
    return { errore: 'Servizio WhatsApp non raggiungibile' }
  }
}

// ── Archive Document ─────────────────────────────────────────

async function archiveDocument(input: { nome: string; file_url: string; categoria: string; tags: string; descrizione: string; contenuto_testo: string }) {
  try {
    const { getAuthToken } = await import('../supabase')
    const { supabase } = await import('../supabase')

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { successo: false, messaggio: 'Utente non autenticato' }

    const { data: profile } = await supabase.from('user_profiles').select('azienda_id').eq('id', user.id).single()
    if (!profile) return { successo: false, messaggio: 'Profilo non trovato' }

    const tagsArray = input.tags ? input.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : []

    const { data, error } = await supabase.from('documenti').insert({
      azienda_id: (profile as any).azienda_id,
      nome: input.nome,
      tipo_file: input.file_url.split('.').pop() || 'pdf',
      categoria: input.categoria || 'altro',
      descrizione: input.descrizione || null,
      file_url: input.file_url,
      tags: tagsArray,
      contenuto_testo: input.contenuto_testo || null,
      uploaded_by: user.id,
    }).select('id').single()

    if (error) return { successo: false, messaggio: error.message }
    return { successo: true, id: (data as any).id, messaggio: `Documento "${input.nome}" archiviato come ${input.categoria}` }
  } catch (err) {
    return { successo: false, messaggio: (err as Error).message }
  }
}

// ── WhatsApp Send ────────────────────────────────────────────

async function sendWhatsAppVoice(input: { phone: string; text: string; voice?: string }) {
  try {
    const { getAuthToken } = await import('../supabase')
    const token = getAuthToken() ?? ''
    const res = await fetch('/api/chat/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
      body: JSON.stringify({ message: `__internal_tool__:send_whatsapp_voice:${JSON.stringify(input)}` }),
    })
    // Actually call the server-side tool directly
    const res2 = await fetch('/api/whatsapp/send-voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
      body: JSON.stringify(input),
    })
    if (!res2.ok) return { successo: false, messaggio: 'Errore invio vocale' }
    return await res2.json()
  } catch (err) { return { successo: false, messaggio: (err as Error).message } }
}

async function sendWhatsAppMessage(input: { phone: string; text: string }) {
  try {
    const { getAuthToken } = await import('../supabase')
    const token = getAuthToken() ?? ''
    const res = await fetch('/api/whatsapp/send-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
      body: JSON.stringify(input),
    })
    if (!res.ok) return { successo: false, messaggio: 'Errore invio messaggio' }
    return await res.json()
  } catch (err) { return { successo: false, messaggio: (err as Error).message } }
}

// ── Tool Executor ───────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolResult = any

const executorMap: Record<string, (input: Record<string, unknown>) => Promise<ToolResult>> = {
  get_financial_summary: () => getFinancialSummary(),
  get_overdue_invoices: () => getOverdueInvoices(),
  get_pipeline: () => getPipeline(),
  get_projects: () => getProjects(),
  create_lead: (input) => createLead(input as unknown as CreateLeadInput),
  approve_expense: (input) => approveExpense((input as { id: string }).id),
  get_clients: () => getClients(),
  get_suppliers: () => getSuppliers(),
  get_passive_invoices: () => getPassiveInvoices(),
  get_orders: () => getOrders(),
  get_quotes: () => getQuotes(),
  get_bank_accounts: () => getBankAccounts(),
  get_expenses: () => getExpenses(),
  get_candidates: () => getCandidates(),
  get_job_postings: () => getJobPostings(),
  get_documents: () => getDocuments(),
  create_client: (input) => createClient(input as unknown as CreateClientInput),
  create_candidate: (input) => createCandidate(input as unknown as CreateCandidateInput),
  search_documents: (input) => searchDocuments((input as { query: string }).query),
  search_documents_deep: (input) => searchDocumentsDeep((input as { query: string }).query),
  summarize_document: (input) => summarizeDocument((input as { documentId: string }).documentId),
  get_document_content: (input) => getDocumentContent((input as { documentId: string }).documentId),
  compare_documents: (input) => compareDocuments((input as { docId1: string; docId2: string }).docId1, (input as { docId1: string; docId2: string }).docId2),
  get_dashboard_summary: () => getDashboardSummary(),
  get_api_costs: () => getApiCosts(),
  get_signal_analytics: () => getSignalAnalytics(),
  generate_pdf: (input) => generatePdf(input as { template: string; data: any; filename?: string }),
  get_whatsapp_status: () => getWhatsAppStatus(),
  get_whatsapp_users: () => getWhatsAppUsers(),
  send_whatsapp_voice: (input) => sendWhatsAppVoice(input as { phone: string; text: string; voice?: string }),
  send_whatsapp_message: (input) => sendWhatsAppMessage(input as { phone: string; text: string }),
  archive_document: (input) => archiveDocument(input as { nome: string; file_url: string; categoria: string; tags: string; descrizione: string; contenuto_testo: string }),
}

// ── Build Registry ──────────────────────────────────────────

export const toolRegistry: Map<string, AgentToolDefinition> = new Map()

for (const entry of toolDefinitions) {
  const name = entry.definition.function.name
  const executor = executorMap[name]
  if (executor !== undefined) {
    toolRegistry.set(name, {
      domain: entry.domain,
      definition: entry.definition,
      executor,
    })
  }
}

export function getToolDefinitions(names: string[]): AgentToolDefinition['definition'][] {
  return names
    .map((name) => toolRegistry.get(name)?.definition)
    .filter((d): d is AgentToolDefinition['definition'] => d !== undefined)
}

export function executeTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  const tool = toolRegistry.get(name)
  if (!tool) {
    throw new Error(`Tool sconosciuto: ${name}`)
  }
  return tool.executor(input)
}
