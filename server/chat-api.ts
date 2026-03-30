import { Router, Response } from 'express'
import { AuthRequest, authMiddleware } from './middleware.js'
import db from './db.js'
import jwt from 'jsonwebtoken'
import fs from 'fs'
import path from 'path'

const router = Router()

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const CLASSIFIER_MODEL = 'anthropic/claude-haiku-4.5'
const AGENT_MODEL = 'anthropic/claude-haiku-4.5'
const JWT_SECRET = process.env.JWT_SECRET || 'fiai-dev-secret'
const CONTEXT_DIR = process.env.CONTEXT_DIR || '/app/data/context'

// ── Types ───────────────────────────────────────────────

type AgentDomain = 'pulse' | 'commerciale' | 'produzione' | 'marketing' | 'amministrazione' | 'hr' | 'legal' | 'documents' | 'infra' | 'general' | 'image' | 'tts'

// Valid domains for classification (superset used for validation)
const VALID_DOMAINS: AgentDomain[] = ['pulse', 'commerciale', 'produzione', 'marketing', 'amministrazione', 'hr', 'legal', 'documents', 'infra', 'general', 'image', 'tts']

type ResponseMode = 'minimal' | 'iteration' | 'full'

interface ClassificationResult {
  domain: AgentDomain
  confidence: number
  needsMultiAgent: boolean
  secondaryDomains?: AgentDomain[]
}

interface ConversationMessage {
  role: string
  content: string
}

// ── Agent Configurations (aligned with frontend) ────────

interface AgentConfig {
  name: string
  domain: string
  color: string
  systemPrompt: string
  toolNames: string[]
}

const AGENTS: Record<string, AgentConfig> = {
  pulse: {
    name: 'Pulse', domain: 'pulse', color: '#C41E3A',
    systemPrompt:
      "Sei Pulse, l'agente centrale di FIAI. Hai una visione executive dell'azienda. " +
      'Fornisci overview sintetiche, daily brief e alert prioritari. ' +
      'Parla come un CEO che ha 5 minuti: vai dritto al punto con i numeri chiave. ' +
      'Usa i tool per recuperare dati reali da tutti i domini.',
    toolNames: ['get_dashboard_summary', 'get_financial_summary', 'get_pipeline', 'get_projects', 'get_overdue_invoices', 'get_candidates'],
  },
  commerciale: {
    name: 'Marco — Commerciale', domain: 'commerciale', color: '#1976D2',
    systemPrompt:
      'Sei Marco, il responsabile commerciale di FIAI. Sei diretto, orientato ai numeri e sempre con un prossimo passo concreto. ' +
      "Gestisci pipeline, clienti, lead e prospect. Quando parli di un lead, suggerisci sempre l'azione successiva. " +
      'Usa i tool per recuperare dati reali.',
    toolNames: ['get_pipeline', 'get_clients', 'create_lead', 'create_client', 'get_quotes'],
  },
  produzione: {
    name: 'Luca — Produzione', domain: 'produzione', color: '#E68A00',
    systemPrompt:
      'Sei Luca, il responsabile produzione di FIAI. Sei metodico, orientato alle deadline e avvisi sempre sui rischi. ' +
      'Gestisci progetti, ordini e milestone. Segnala ritardi e problemi in anticipo. ' +
      'Usa i tool per recuperare dati reali.',
    toolNames: ['get_projects', 'get_orders', 'get_quotes'],
  },
  marketing: {
    name: 'Giulia — Marketing', domain: 'marketing', color: '#9C27B0',
    systemPrompt:
      'Sei Giulia, la responsabile marketing di FIAI. Sei creativa, orientata al brand e proponi sempre idee originali. ' +
      'Generi contenuti (testi e immagini), analizzi lead scoring e gestisci campagne. ' +
      "Quando ti chiedono un'immagine, logo, grafica o illustrazione, generala direttamente. " +
      'Usa i tool per recuperare dati reali.',
    toolNames: ['get_pipeline', 'get_clients', 'get_documents', 'generate_image'],
  },
  amministrazione: {
    name: 'Sofia — Amministrazione', domain: 'amministrazione', color: '#2D8B56',
    systemPrompt:
      'Sei Sofia, la responsabile amministrativa di FIAI. Sei precisa, analitica e attenta alle scadenze. ' +
      'Gestisci fatture, conti bancari, liquidita, rimborsi, fornitori e scadenze fiscali. ' +
      'Presenti sempre i numeri con contesto e periodo di riferimento. ' +
      'Usa i tool per recuperare dati reali.',
    toolNames: ['get_financial_summary', 'get_overdue_invoices', 'get_bank_accounts', 'get_passive_invoices', 'get_expenses', 'approve_expense', 'get_suppliers'],
  },
  hr: {
    name: 'Elena — HR', domain: 'hr', color: '#7B1FA2',
    systemPrompt:
      'Sei Elena, la responsabile HR di FIAI. Sei empatica, organizzata e attenta alle persone. ' +
      'Gestisci candidati, annunci lavoro, recruiting e onboarding. ' +
      'Suggerisci sempre i prossimi step nel processo di selezione. ' +
      'Usa i tool per recuperare dati reali.',
    toolNames: ['get_candidates', 'get_job_postings', 'create_candidate'],
  },
  legal: {
    name: 'Avv. Rossi — Legal', domain: 'legal', color: '#D32F2F',
    systemPrompt:
      "Sei l'Avvocato Rossi, il consulente legale e documentalista di FIAI. " +
      "Puoi cercare documenti con search_documents_deep, riassumere con summarize_document. " +
      "Usa un linguaggio formale, preciso e prudente.",
    toolNames: ['get_documents', 'search_documents_deep', 'summarize_document', 'get_document_content'],
  },
  infra: {
    name: 'Dev — IT/Infra', domain: 'infra', color: '#455A64',
    systemPrompt:
      'Sei Dev, il responsabile IT e infrastruttura di FIAI. Sei tecnico, conciso e orientato ai dati. ' +
      'Gestisci utenti, ruoli, configurazione agenti, monitoring performance, costi API e WhatsApp. ' +
      'Puoi mostrare il QR code WhatsApp, lo stato della connessione e gli utenti collegati. ' +
      'Rispondi con dati precisi e metriche. Usa i tool per recuperare dati reali.',
    toolNames: ['get_dashboard_summary', 'get_api_costs', 'get_whatsapp_status', 'get_whatsapp_users'],
  },
}

// ── Tool Definitions (OpenAI format) ─────────────────────

const TOOL_DEFS: Record<string, { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }> = {
  get_financial_summary: { type: 'function', function: { name: 'get_financial_summary', description: 'Riepilogo finanziario', parameters: { type: 'object', properties: {} } } },
  get_overdue_invoices: { type: 'function', function: { name: 'get_overdue_invoices', description: 'Fatture scadute', parameters: { type: 'object', properties: {} } } },
  get_pipeline: { type: 'function', function: { name: 'get_pipeline', description: 'Pipeline commerciale', parameters: { type: 'object', properties: {} } } },
  get_clients: { type: 'function', function: { name: 'get_clients', description: 'Lista clienti', parameters: { type: 'object', properties: {} } } },
  get_projects: { type: 'function', function: { name: 'get_projects', description: 'Stato progetti', parameters: { type: 'object', properties: {} } } },
  get_candidates: { type: 'function', function: { name: 'get_candidates', description: 'Candidati HR', parameters: { type: 'object', properties: {} } } },
  get_bank_accounts: { type: 'function', function: { name: 'get_bank_accounts', description: 'Conti bancari', parameters: { type: 'object', properties: {} } } },
  get_expenses: { type: 'function', function: { name: 'get_expenses', description: 'Rimborsi', parameters: { type: 'object', properties: {} } } },
  get_orders: { type: 'function', function: { name: 'get_orders', description: 'Ordini', parameters: { type: 'object', properties: {} } } },
  get_quotes: { type: 'function', function: { name: 'get_quotes', description: 'Preventivi', parameters: { type: 'object', properties: {} } } },
  get_suppliers: { type: 'function', function: { name: 'get_suppliers', description: 'Fornitori', parameters: { type: 'object', properties: {} } } },
  get_passive_invoices: { type: 'function', function: { name: 'get_passive_invoices', description: 'Fatture passive', parameters: { type: 'object', properties: {} } } },
  get_job_postings: { type: 'function', function: { name: 'get_job_postings', description: 'Annunci lavoro', parameters: { type: 'object', properties: {} } } },
  get_documents: { type: 'function', function: { name: 'get_documents', description: 'Documenti aziendali', parameters: { type: 'object', properties: {} } } },
  get_dashboard_summary: { type: 'function', function: { name: 'get_dashboard_summary', description: 'Overview aziendale', parameters: { type: 'object', properties: {} } } },
  create_lead: { type: 'function', function: { name: 'create_lead', description: 'Crea nuovo lead', parameters: { type: 'object', properties: { nome: { type: 'string' }, cognome: { type: 'string' }, email: { type: 'string' }, telefono: { type: 'string' }, valore: { type: 'number' } }, required: ['nome'] } } },
  create_client: { type: 'function', function: { name: 'create_client', description: 'Crea nuovo cliente', parameters: { type: 'object', properties: { nome: { type: 'string' }, tipo: { type: 'string' }, email: { type: 'string' }, ragione_sociale: { type: 'string' } }, required: ['nome'] } } },
  create_candidate: { type: 'function', function: { name: 'create_candidate', description: 'Crea nuovo candidato HR', parameters: { type: 'object', properties: { nome: { type: 'string' }, cognome: { type: 'string' }, email: { type: 'string' }, ruolo_candidato: { type: 'string' } }, required: ['nome', 'cognome'] } } },
  approve_expense: { type: 'function', function: { name: 'approve_expense', description: 'Approva rimborso per ID', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
  search_documents_deep: { type: 'function', function: { name: 'search_documents_deep', description: 'Ricerca approfondita documenti', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  summarize_document: { type: 'function', function: { name: 'summarize_document', description: 'Riassume un documento', parameters: { type: 'object', properties: { documentId: { type: 'string' } }, required: ['documentId'] } } },
  get_document_content: { type: 'function', function: { name: 'get_document_content', description: 'Legge contenuto documento', parameters: { type: 'object', properties: { documentId: { type: 'string' } }, required: ['documentId'] } } },
  generate_image: { type: 'function', function: { name: 'generate_image', description: "Genera un'immagine dalla descrizione testuale", parameters: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] } } },
  get_api_costs: { type: 'function', function: { name: 'get_api_costs', description: 'Costi API OpenRouter', parameters: { type: 'object', properties: {} } } },
  get_whatsapp_status: { type: 'function', function: { name: 'get_whatsapp_status', description: 'Stato connessione WhatsApp', parameters: { type: 'object', properties: {} } } },
  get_whatsapp_users: { type: 'function', function: { name: 'get_whatsapp_users', description: 'Utenti WhatsApp collegati', parameters: { type: 'object', properties: {} } } },
  send_whatsapp_voice: { type: 'function', function: { name: 'send_whatsapp_voice', description: 'Invia un messaggio vocale WhatsApp a un utente. Genera audio TTS e lo invia come voice note.', parameters: { type: 'object', properties: { phone: { type: 'string', description: 'Numero telefono destinatario' }, text: { type: 'string', description: 'Testo da pronunciare nel vocale' }, voice: { type: 'string', description: 'Voce TTS (Vivian, Ryan, Serena, etc.)' } }, required: ['phone', 'text'] } } },
  send_whatsapp_message: { type: 'function', function: { name: 'send_whatsapp_message', description: 'Invia un messaggio di testo WhatsApp a un utente', parameters: { type: 'object', properties: { phone: { type: 'string', description: 'Numero telefono destinatario' }, text: { type: 'string', description: 'Testo del messaggio' } }, required: ['phone', 'text'] } } },
}

// ── Server-Side Tool Execution ───────────────────────────

async function executeTool(name: string, aziendaId: string, args?: Record<string, unknown>): Promise<unknown> {
  const year = new Date().getFullYear()
  const today = new Date().toISOString().split('T')[0]

  switch (name) {
    case 'get_financial_summary': {
      const fatture = db.prepare("SELECT totale, stato FROM fatture WHERE azienda_id = ? AND data >= ?").all(aziendaId, `${year}-01-01`) as any[]
      const conti = db.prepare("SELECT saldo FROM conti WHERE azienda_id = ?").all(aziendaId) as any[]
      return {
        fatturato_ytd: fatture.filter(f => f.stato !== 'stornata').reduce((s: number, f: any) => s + (f.totale || 0), 0),
        da_incassare: fatture.filter(f => !['pagata', 'stornata'].includes(f.stato)).reduce((s: number, f: any) => s + (f.totale || 0), 0),
        liquidita_totale: conti.reduce((s: number, c: any) => s + (c.saldo || 0), 0),
        fatture_emesse: fatture.length,
        fatture_pagate: fatture.filter(f => f.stato === 'pagata').length,
      }
    }
    case 'get_overdue_invoices':
      return db.prepare("SELECT f.numero, f.totale, f.scadenza, f.stato, c.nome as cliente_nome, c.ragione_sociale FROM fatture f LEFT JOIN clienti c ON f.cliente_id = c.id WHERE f.azienda_id = ? AND f.scadenza < ? AND f.stato NOT IN ('pagata','stornata') ORDER BY f.scadenza").all(aziendaId, today)
    case 'get_pipeline': {
      const leads = db.prepare("SELECT stato, valore_stimato FROM leads WHERE azienda_id = ?").all(aziendaId) as any[]
      const fasi: Record<string, { conteggio: number; valore_totale: number }> = {}
      for (const l of leads) { if (!fasi[l.stato]) fasi[l.stato] = { conteggio: 0, valore_totale: 0 }; fasi[l.stato].conteggio++; fasi[l.stato].valore_totale += l.valore_stimato || 0 }
      return Object.entries(fasi).map(([fase, d]) => ({ fase, ...d }))
    }
    case 'get_clients':
      return db.prepare("SELECT id, nome, cognome, ragione_sociale, tipo, email, telefono FROM clienti WHERE azienda_id = ?").all(aziendaId)
    case 'get_projects':
      return db.prepare("SELECT p.nome, p.stato, p.data_fine_prevista, p.budget, c.ragione_sociale as cliente FROM progetti p LEFT JOIN clienti c ON p.cliente_id = c.id WHERE p.azienda_id = ? AND p.stato != 'annullato'").all(aziendaId)
    case 'get_candidates':
      return db.prepare("SELECT nome, cognome, ruolo_candidato, stato, valutazione FROM candidati WHERE azienda_id = ?").all(aziendaId)
    case 'get_bank_accounts':
      return db.prepare("SELECT nome, tipo, saldo FROM conti WHERE azienda_id = ?").all(aziendaId)
    case 'get_expenses':
      return db.prepare("SELECT descrizione, importo, stato, data_spesa FROM rimborsi WHERE azienda_id = ?").all(aziendaId)
    case 'get_orders':
      return db.prepare("SELECT o.numero, o.stato, o.totale, c.nome as cliente FROM ordini o LEFT JOIN clienti c ON o.cliente_id = c.id WHERE o.azienda_id = ?").all(aziendaId)
    case 'get_quotes':
      return db.prepare("SELECT p.numero, p.stato, p.totale, c.nome as cliente FROM preventivi p LEFT JOIN clienti c ON p.cliente_id = c.id WHERE p.azienda_id = ?").all(aziendaId)
    case 'get_suppliers':
      return db.prepare("SELECT ragione_sociale, piva, email FROM fornitori WHERE azienda_id = ?").all(aziendaId)
    case 'get_passive_invoices':
      return db.prepare("SELECT fp.numero, fp.totale, fp.stato, fp.scadenza, f.ragione_sociale as fornitore FROM fatture_passive fp LEFT JOIN fornitori f ON fp.fornitore_id = f.id WHERE fp.azienda_id = ?").all(aziendaId)
    case 'get_job_postings':
      return db.prepare("SELECT ruolo, stato, sede, tipo_contratto FROM annunci_lavoro WHERE azienda_id = ?").all(aziendaId)
    case 'get_documents':
      return db.prepare("SELECT nome, categoria, descrizione, tipo_file, created_at FROM documenti WHERE azienda_id = ?").all(aziendaId)
    case 'get_dashboard_summary':
      return {
        clienti: (db.prepare("SELECT COUNT(*) as c FROM clienti WHERE azienda_id = ?").get(aziendaId) as any)?.c || 0,
        leads: (db.prepare("SELECT COUNT(*) as c FROM leads WHERE azienda_id = ?").get(aziendaId) as any)?.c || 0,
        fatture: (db.prepare("SELECT COUNT(*) as c FROM fatture WHERE azienda_id = ?").get(aziendaId) as any)?.c || 0,
        progetti_attivi: (db.prepare("SELECT COUNT(*) as c FROM progetti WHERE azienda_id = ? AND stato IN ('pianificato','in_corso')").get(aziendaId) as any)?.c || 0,
        candidati: (db.prepare("SELECT COUNT(*) as c FROM candidati WHERE azienda_id = ?").get(aziendaId) as any)?.c || 0,
      }
    case 'create_lead': {
      const id = crypto.randomUUID()
      const input = args as any
      db.prepare('INSERT INTO leads (id, azienda_id, nome, cognome, email, telefono, valore_stimato, stato) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, aziendaId, input.nome || '', input.cognome || '', input.email || null, input.telefono || null, input.valore || null, 'nuovo')
      return { successo: true, id, messaggio: `Lead "${input.nome}" creato` }
    }
    case 'create_client': {
      const id = crypto.randomUUID()
      const input = args as any
      db.prepare('INSERT INTO clienti (id, azienda_id, tipo, nome, ragione_sociale, email) VALUES (?, ?, ?, ?, ?, ?)').run(id, aziendaId, input.tipo || 'privato', input.nome || '', input.ragione_sociale || null, input.email || null)
      return { successo: true, id, messaggio: `Cliente "${input.nome}" creato` }
    }
    case 'create_candidate': {
      const id = crypto.randomUUID()
      const input = args as any
      db.prepare('INSERT INTO candidati (id, azienda_id, nome, cognome, email, ruolo_candidato, stato) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, aziendaId, input.nome, input.cognome, input.email || null, input.ruolo_candidato || null, 'nuovo')
      return { successo: true, id, messaggio: `Candidato "${input.nome} ${input.cognome}" creato` }
    }
    case 'approve_expense': {
      const input = args as any
      db.prepare("UPDATE rimborsi SET stato = 'approvato' WHERE id = ? AND azienda_id = ?").run(input.id, aziendaId)
      return { successo: true, messaggio: `Rimborso approvato` }
    }
    case 'search_documents_deep': {
      const input = args as any
      const docs = db.prepare("SELECT nome, categoria, descrizione FROM documenti WHERE azienda_id = ? AND (nome LIKE ? OR descrizione LIKE ?) LIMIT 10").all(aziendaId, `%${input.query}%`, `%${input.query}%`)
      return docs
    }
    case 'summarize_document': {
      const input = args as any
      const doc = db.prepare("SELECT nome, contenuto_testo FROM documenti WHERE id = ? AND azienda_id = ?").get(input.documentId, aziendaId) as any
      if (!doc) return { errore: 'Documento non trovato' }
      return { nome: doc.nome, contenuto: doc.contenuto_testo ? doc.contenuto_testo.substring(0, 2000) : 'Testo non disponibile' }
    }
    case 'get_document_content': {
      const input = args as any
      const doc = db.prepare("SELECT nome, contenuto_testo FROM documenti WHERE id = ? AND azienda_id = ?").get(input.documentId, aziendaId) as any
      if (!doc) return { errore: 'Documento non trovato' }
      return { nome: doc.nome, contenuto: doc.contenuto_testo || 'Testo non estratto' }
    }
    case 'generate_image': {
      const input = args as any
      try {
        const imgRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENROUTER_API_KEY}` },
          body: JSON.stringify({ model: 'google/gemini-3.1-flash-image-preview', messages: [{ role: 'user', content: input.prompt }], max_tokens: 4096 }),
        })
        const imgData = await imgRes.json()
        const images = imgData.choices?.[0]?.message?.images ?? []
        if (images.length > 0) {
          return { successo: true, image_url: images[0]?.image_url?.url || images[0], messaggio: 'Immagine generata' }
        }
        return { successo: false, messaggio: 'Nessuna immagine generata' }
      } catch (err: any) {
        return { successo: false, messaggio: err.message }
      }
    }
    case 'get_api_costs': {
      try {
        const res = await fetch('https://openrouter.ai/api/v1/auth/key', { headers: { 'Authorization': `Bearer ${OPENROUTER_API_KEY}` } })
        const data = await res.json()
        const d = data.data ?? {}
        return { credito_totale: `$${(d.usage ?? 0).toFixed(4)}`, costo_oggi: `$${(d.usage_daily ?? 0).toFixed(4)}`, costo_mese: `$${(d.usage_monthly ?? 0).toFixed(4)}` }
      } catch { return { errore: 'Non disponibile' } }
    }
    case 'get_whatsapp_status': {
      try {
        const res = await fetch(`http://localhost:${process.env.PORT || 3001}/api/whatsapp/status`, { headers: { 'Authorization': `Bearer ${jwt.sign({ userId: 'system', email: 'system' }, JWT_SECRET, { expiresIn: '1m' })}` } })
        return await res.json()
      } catch { return { stato: 'Non disponibile' } }
    }
    case 'get_whatsapp_users': {
      return db.prepare("SELECT whatsapp_phone as phone, nome, cognome, email, ruolo FROM user_profiles WHERE whatsapp_phone IS NOT NULL AND whatsapp_active = 1").all()
    }
    case 'send_whatsapp_voice': {
      const input = args as any
      try {
        const { sendVoiceNote } = await import('./whatsapp.js')
        const phone = input.phone.replace(/\D/g, '')
        const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`
        await sendVoiceNote(jid, input.text, input.voice || 'Vivian')
        return { successo: true, messaggio: `Vocale inviato a ${phone}` }
      } catch (err: any) {
        return { successo: false, messaggio: err.message }
      }
    }
    case 'send_whatsapp_message': {
      const input = args as any
      try {
        const whatsapp = await import('./whatsapp.js')
        const phone = input.phone.replace(/\D/g, '')
        const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`
        const sock = (whatsapp as any).getSock?.()
        if (!sock) throw new Error('WhatsApp non connesso')
        await sock.sendMessage(jid, { text: input.text })
        return { successo: true, messaggio: `Messaggio inviato a ${phone}` }
      } catch (err: any) {
        return { successo: false, messaggio: err.message }
      }
    }
    default:
      return { errore: `Tool ${name} non disponibile` }
  }
}

// ── Suggestions (same as frontend) ──────────────────────

const TOOL_SUGGESTIONS: Record<string, string[]> = {
  get_dashboard_summary: ['Fatturato del mese', 'Pipeline commerciale', 'Progetti attivi', 'Alert e scadenze'],
  get_pipeline: ['Lead caldi in proposta', 'Crea nuovo lead', 'Brief pre-call', 'Preventivi aperti'],
  get_clients: ['Nuovo cliente', 'Pipeline lead', 'Preventivi per cliente', 'Storico ordini'],
  create_lead: ['Pipeline commerciale', 'Stato lead', 'Converti lead'],
  create_client: ['Crea preventivo', 'Pipeline', 'Assegna progetto'],
  get_projects: ['Milestone prossime', 'Rischi progetto', 'Budget vs speso', 'Ordini in corso'],
  get_orders: ['Stato progetti', 'Crea fattura', 'Avanzamento delivery'],
  generate_image: ['Genera variante', 'Crea post LinkedIn', 'Score lead'],
  get_financial_summary: ['Fatture scadute', 'Saldo conti', 'Cash flow', 'Scadenze fiscali'],
  get_overdue_invoices: ['Sollecita fattura', 'Riepilogo finanziario', 'Dettaglio cliente'],
  get_bank_accounts: ['Movimenti recenti', 'Cash flow', 'Fatture da pagare'],
  get_passive_invoices: ['Scadenze fornitori', 'Totale da pagare', 'Budget residuo'],
  get_expenses: ['Approva rimborso', 'Spese mensili', 'Per categoria'],
  approve_expense: ['Rimborsi pendenti', 'Riepilogo spese'],
  get_suppliers: ['Fatture passive', 'Dettaglio fornitore'],
  get_candidates: ['In colloquio', 'Nuovo candidato', 'Annunci aperti'],
  get_job_postings: ['Crea annuncio', 'Candidati per posizione'],
  create_candidate: ['Pipeline candidati', 'Annunci aperti'],
  get_documents: ['Cerca contratto', 'Normative recenti', 'Analizza documento'],
}

const DOMAIN_SUGGESTIONS: Record<string, string[]> = {
  pulse: ['Overview aziendale', 'Daily brief', 'Alert e priorita', 'Stato generale'],
  commerciale: ['Pipeline lead', 'Lista clienti', 'Nuovo lead', 'Brief pre-call'],
  produzione: ['Progetti attivi', 'Milestone prossime', 'Rischi', 'Ordini in corso'],
  marketing: ['Genera immagine', 'Crea post', 'Score lead', 'Contenuti campagna'],
  amministrazione: ['Riepilogo finanziario', 'Fatture scadute', 'Saldo conti', 'Rimborsi'],
  hr: ['Candidati attivi', 'Annunci lavoro', 'Simula costo', 'Screening CV'],
  legal: ['Cerca contratto', 'Analizza clausole', 'Normative', 'Scadenze contratti'],
  infra: ['Performance agenti', 'Costi API', 'Gestione utenti', 'System health'],
  general: ['Overview aziendale', 'Lista clienti', 'Fatturato', 'Progetti attivi'],
}

function getSuggestions(domain: string, toolsUsed: string[]): string[] {
  for (const tool of [...toolsUsed].reverse()) {
    const suggestions = TOOL_SUGGESTIONS[tool]
    if (suggestions) return suggestions.slice(0, 4)
  }
  return (DOMAIN_SUGGESTIONS[domain] || DOMAIN_SUGGESTIONS.general).slice(0, 4)
}

// ── Context Loading (filesystem) ────────────────────────

function readContextFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8')
  } catch {
    return ''
  }
}

function buildFullContext(aziendaId: string, domain: string, userId: string, sessionId?: string): string {
  const parts: string[] = []

  // 1. Global context
  const globalPath = path.join(CONTEXT_DIR, 'aziende', aziendaId, 'CONTEXT.md')
  const globalCtx = readContextFile(globalPath)
  if (globalCtx) parts.push('--- CONTESTO AZIENDALE ---\n' + globalCtx)

  // 2. Agent/skill context
  const agentPath = path.join(CONTEXT_DIR, 'aziende', aziendaId, 'skills', `${domain}.md`)
  let agentCtx = readContextFile(agentPath)
  if (!agentCtx) {
    const templatePath = path.join(CONTEXT_DIR, '_templates', 'skills', `${domain}.md`)
    agentCtx = readContextFile(templatePath)
  }
  if (agentCtx) parts.push('--- CONTESTO AGENTE ---\n' + agentCtx)

  // 3. User profile
  const profilePath = path.join(CONTEXT_DIR, 'aziende', aziendaId, 'users', userId, 'profile.md')
  const profileCtx = readContextFile(profilePath)
  if (profileCtx) parts.push('--- PROFILO UTENTE ---\n' + profileCtx)

  // 4. Session context
  if (sessionId) {
    const sessionPath = path.join(CONTEXT_DIR, 'aziende', aziendaId, 'users', userId, 'sessions', `${sessionId}.md`)
    const sessionCtx = readContextFile(sessionPath)
    if (sessionCtx) parts.push('--- SESSIONE CORRENTE ---\n' + sessionCtx)
  }

  // 5. Preferences
  const prefsPath = path.join(CONTEXT_DIR, 'aziende', aziendaId, 'users', userId, 'preferences.md')
  const prefsCtx = readContextFile(prefsPath)
  if (prefsCtx) parts.push('--- PREFERENZE ---\n' + prefsCtx)

  // 6. Steering rules
  const steeringPath = path.join(CONTEXT_DIR, 'aziende', aziendaId, 'steering-rules.md')
  const steeringCtx = readContextFile(steeringPath)
  if (steeringCtx) parts.push('--- REGOLE DI STEERING ---\n' + steeringCtx)

  return parts.join('\n\n')
}

function saveSessionContext(aziendaId: string, userId: string, sessionId: string, summary: string): void {
  try {
    const sessionDir = path.join(CONTEXT_DIR, 'aziende', aziendaId, 'users', userId, 'sessions')
    fs.mkdirSync(sessionDir, { recursive: true })
    const sessionPath = path.join(sessionDir, `${sessionId}.md`)

    // Append to existing session context
    const existing = readContextFile(sessionPath)
    const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
    const newContent = existing
      ? existing + `\n\n---\n[${timestamp}]\n${summary}`
      : `# Sessione ${sessionId}\n\n[${timestamp}]\n${summary}`
    fs.writeFileSync(sessionPath, newContent, 'utf-8')
  } catch (err) {
    console.error('Session save error:', err)
  }
}

// ── Signal Capture (filesystem) ─────────────────────────

function captureSignal(aziendaId: string, userId: string, signal: Record<string, unknown>): void {
  try {
    const signalsDir = path.join(CONTEXT_DIR, 'aziende', aziendaId, 'users', userId, 'signals')
    fs.mkdirSync(signalsDir, { recursive: true })
    const line = JSON.stringify({ ...signal, ts: new Date().toISOString() }) + '\n'
    fs.appendFileSync(path.join(signalsDir, 'interactions.jsonl'), line)
  } catch (err) {
    console.error('Signal capture error:', err)
  }
}

// ── Session Domain Cache (for ITERATION mode) ───────────

const sessionDomainCache = new Map<string, AgentDomain>()

// ── Quick Classify Keywords (same as frontend — avoids LLM call) ──

function quickClassifyKeywords(text: string): AgentDomain | null {
  const t = text.toLowerCase().trim()
  // TTS — HIGHEST PRIORITY
  if (/con la mia voce|mia voce|\bleggi\b|leggi.*alta|pronuncia|text.to.speech|\btts\b|\bparla\b|sintesi vocale|genera.*audio|voce.*clona|lista voci|voci disponibili|imposta voce|voce predefinita|impostazioni tts|clona.*voce|wizard.*voce|crea.*voce|registra.*voce/.test(t)) return 'tts'
  // Commerciale
  if (/client[ie]|lead[s]?|pipeline|prospect|contatt[io]/.test(t)) return 'commerciale'
  // Amministrazione
  if (/fattur|finanz|fatturato|incass|liquid|scadut|conto|saldo|rimbors|spese|pagament|fornitor/.test(t)) return 'amministrazione'
  // Produzione
  if (/progett[io]|ordin[ie]|milestone|delivery|avanzament/.test(t)) return 'produzione'
  // HR
  if (/candidat|annunci.*lavoro|recruiting|assunzion|cv|curriculum|onboarding/.test(t)) return 'hr'
  // Documents
  if (/\[documento caricato|\[documento allegato|archivia.*documento|cataloga|classifica.*file/.test(t)) return 'documents'
  // Legal
  if (/\bcontratt|clausol|normativ|compliance|gdpr|\blegal\b|riassumi.*document|confronta.*document|cerca.*document|contenuto.*document/.test(t)) return 'legal'
  // Marketing
  if (/immag|disegna|illustra|logo|grafica|\bpost\b|newsletter|contenut|campagna|brand/.test(t)) return 'marketing'
  // Infra
  if (/costi? api|performance|monitoring|agenti.*config|utenti.*sistema|health|agentops|whatsapp|qr code/.test(t)) return 'infra'
  // Pulse
  if (/overview|riepilog|come va|stato general|daily brief|panoramic|dashboard/.test(t)) return 'pulse'
  return null
}

// ── Response Mode Detection (same as frontend) ──────────

function detectResponseMode(message: string, historyLength: number): ResponseMode {
  const t = message.trim().toLowerCase()

  // MINIMAL: greetings, thanks, ratings, very short acks
  if (t.length < 25 && /^(ok|va bene|grazie|thanks|ciao|buon[a-z]*|salve|perfetto|ottimo|capito|chiaro|si|sì|no|bene|bravo|fantastico|eccellente)[\s!.]*$/i.test(t)) {
    return 'minimal'
  }
  // Explicit numeric rating: "8", "3 - non era giusto", "10!"
  if (/^\d{1,2}[\s\-:!.]/.test(t) || /^\d{1,2}$/.test(t)) {
    return 'minimal'
  }

  // ITERATION: continues previous context
  if (historyLength > 2 && /^(ora|adesso|invece|piuttosto|prova|modifica|cambia|aggiungi|togli|rimuovi|rifai|migliora|correggi|aggiorna|continua|e anche|inoltre|poi)/i.test(t)) {
    return 'iteration'
  }

  return 'full'
}

// ── Classify Intent (LLM-based) ─────────────────────────

const CLASSIFICATION_PROMPT =
  'Sei un classificatore di intenti per FIAI, un gestionale aziendale italiano. ' +
  "Analizza il messaggio dell'utente e classifica il dominio principale. " +
  'I domini disponibili sono:\n' +
  "- pulse: overview aziendale, briefing, riepilogo generale, daily brief, come va l'azienda, stato generale\n" +
  '- commerciale: clienti, lead, pipeline, prospect, vendita, contatti commerciali, brief pre-call, nuovo cliente\n' +
  '- produzione: progetti, ordini, milestone, avanzamento, delivery, deadline, rischi progetto, stato progetto\n' +
  '- marketing: contenuti, campagne, lead scoring, brand, social, immagini, grafiche, genera immagine, crea logo, illustra, post, newsletter\n' +
  '- amministrazione: fatture, conti, liquidita, scadenze fiscali, rimborsi, budget, fornitori, cash flow, pagamenti, fatturato\n' +
  '- hr: candidati, annunci lavoro, recruiting, onboarding, costo aziendale, curriculum, selezione\n' +
  '- legal: contratti, clausole, normative, compliance, documenti legali, privacy, GDPR, analisi contratto, ricerca documenti, riassumi documento, confronta documenti, contenuto documento\n' +
  '- infra: costi API, performance sistema, monitoring agenti, utenti, ruoli, configurazione, AgentOps\n' +
  '- general: saluti, domande generiche, conversazione\n\n' +
  'IMPORTANTE: Le richieste di generazione immagini vanno SEMPRE a "marketing".\n' +
  'Rispondi SOLO con un JSON valido: {"domain": "...", "confidence": 0.0-1.0, "needsMultiAgent": false, "secondaryDomains": []}'

async function classifyIntent(message: string, conversationHistory?: ConversationMessage[]): Promise<ClassificationResult> {
  try {
    // Build context from history if available
    let contextText = message
    if (conversationHistory && conversationHistory.length > 0) {
      const recent = conversationHistory.slice(-3)
      contextText = recent.map(m => `${m.role}: ${m.content}`).join('\n') + '\nuser: ' + message
    }

    const res = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENROUTER_API_KEY}` },
      body: JSON.stringify({
        model: CLASSIFIER_MODEL,
        messages: [
          { role: 'system', content: CLASSIFICATION_PROMPT },
          { role: 'user', content: contextText },
        ],
        max_tokens: 80,
      }),
    })

    if (!res.ok) return { domain: 'pulse', confidence: 0.5, needsMultiAgent: false }

    const data = await res.json()
    const text = data.choices?.[0]?.message?.content ?? ''
    const reasoning = data.choices?.[0]?.message?.reasoning ?? ''
    const fullText = text || reasoning

    const jsonMatch = fullText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.warn('Classification: no JSON found, falling back to pulse')
      return { domain: 'pulse', confidence: 0.5, needsMultiAgent: false }
    }

    const parsed = JSON.parse(jsonMatch[0]) as ClassificationResult
    if (!VALID_DOMAINS.includes(parsed.domain)) {
      return { domain: 'pulse', confidence: 0.5, needsMultiAgent: false }
    }

    console.log(`Classification: ${parsed.domain} (confidence: ${parsed.confidence})`)
    return parsed
  } catch (err) {
    console.warn('Classification error, falling back to pulse:', err)
    return { domain: 'pulse', confidence: 0.5, needsMultiAgent: false }
  }
}

// ── Direct LLM Response (for MINIMAL/general) ───────────

async function directLLMResponse(message: string, context: string, conversationHistory?: ConversationMessage[]): Promise<string> {
  let systemPrompt =
    "Sei l'assistente AI di FIAI (Fabbrica Italiana Agenti Intelligenti). " +
    'Rispondi sempre in italiano, in modo professionale e conciso. ' +
    'Non hai accesso a tool in questo momento, rispondi con le tue conoscenze generali.'

  if (context) {
    systemPrompt += '\n\n' + context
  }

  const messages: { role: string; content: string }[] = [
    { role: 'system', content: systemPrompt },
  ]

  // Include conversation history if available
  if (conversationHistory && conversationHistory.length > 0) {
    for (const m of conversationHistory.slice(-6)) {
      messages.push({ role: m.role, content: m.content })
    }
  }

  messages.push({ role: 'user', content: message })

  const res = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENROUTER_API_KEY}` },
    body: JSON.stringify({ model: AGENT_MODEL, messages, max_tokens: 4096 }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenRouter error ${res.status}: ${err}`)
  }

  const data = await res.json()
  return data.choices?.[0]?.message?.content ?? ''
}

// ── Orchestrate (server-side — full parity with frontend) ──

export async function orchestrateServerSide(
  message: string,
  userId: string,
  aziendaId: string,
  options?: {
    format?: 'web' | 'whatsapp'
    sessionId?: string
    conversationHistory?: ConversationMessage[]
  }
): Promise<{
  text: string
  toolCalls: any[]
  agentName: string
  agentDomain: string
  agentColor: string
  suggestions?: string[]
}> {
  const startTime = Date.now()
  const format = options?.format ?? 'web'
  const sessionId = options?.sessionId ?? ''
  const conversationHistory = options?.conversationHistory

  const historyLength = (conversationHistory?.length ?? 0) + 1 // +1 for current message

  // ── Response Mode Routing ──
  const responseMode = detectResponseMode(message, historyLength)

  if (responseMode === 'minimal') {
    // Check for explicit numeric rating (1-10)
    const ratingMatch = message.trim().match(/^(\d{1,2})/)
    if (ratingMatch) {
      const rating = parseInt(ratingMatch[1])
      if (rating >= 1 && rating <= 10) {
        captureSignal(aziendaId, userId, {
          sessionId,
          type: 'explicit_rating',
          rating,
          domain: sessionDomainCache.get(sessionId) || 'general',
        })
        const response = rating >= 7
          ? 'Grazie per il feedback positivo!'
          : rating >= 4
            ? 'Grazie, terro conto del tuo feedback per migliorare.'
            : 'Mi dispiace. Cerchero di fare meglio la prossima volta.'
        return {
          text: response, toolCalls: [], agentName: 'Assistente FIAI',
          agentDomain: 'general', agentColor: '#607D8B',
          suggestions: getSuggestions('general', []),
        }
      }
    }

    // Quick minimal response, no classification, no tools
    const context = buildFullContext(aziendaId, 'pulse', userId, sessionId)
    const minimalText = await directLLMResponse(message, context, conversationHistory)
    return {
      text: minimalText, toolCalls: [], agentName: 'Assistente FIAI',
      agentDomain: 'general', agentColor: '#607D8B',
      suggestions: getSuggestions('general', []),
    }
  }

  // ── ITERATION mode: reuse last domain ──
  if (responseMode === 'iteration' && sessionId) {
    const lastDomain = sessionDomainCache.get(sessionId)
    if (lastDomain && lastDomain !== 'general' && lastDomain !== 'image' && lastDomain !== 'tts') {
      const agent = AGENTS[lastDomain]
      if (agent) {
        const result = await executeAgentCall(message, agent, aziendaId, userId, sessionId, format, conversationHistory)
        const latencyMs = Date.now() - startTime
        const toolsUsed = result.toolCalls.map((t: any) => t.tool).filter(Boolean) as string[]
        captureSignal(aziendaId, userId, { sessionId, domain: lastDomain, confidence: 0.95, tools: toolsUsed, latencyMs, agentName: agent.name, cost: 0, tokens: 0 })
        saveSessionContext(aziendaId, userId, sessionId, `Dominio: ${lastDomain}\nAgente: ${agent.name}\nRisposta: ${result.text.substring(0, 200)}...`)
        return { ...result, suggestions: getSuggestions(lastDomain, toolsUsed) }
      }
    }
    // fallback to full classification
  }

  // ── FULL classification ──
  // Fast-path keyword classification (instant, no LLM call)
  let classification: ClassificationResult
  const kwDomain = quickClassifyKeywords(message)
  if (kwDomain) {
    classification = { domain: kwDomain, confidence: 0.95, needsMultiAgent: false }
  } else {
    classification = await classifyIntent(message, conversationHistory)
  }

  // Normalize image domain to marketing
  if (classification.domain === 'image') {
    classification.domain = 'marketing' as AgentDomain
  }

  // documents -> legal fallback
  if (classification.domain === 'documents') {
    classification.domain = 'legal' as AgentDomain
  }

  // ── General — direct LLM response (no tools) ──
  if (classification.domain === 'general') {
    const context = buildFullContext(aziendaId, 'pulse', userId, sessionId)
    const text = await directLLMResponse(message, context, conversationHistory)
    const latencyMs = Date.now() - startTime
    captureSignal(aziendaId, userId, { sessionId, domain: 'general', confidence: classification.confidence, tools: [], latencyMs, agentName: 'Assistente FIAI', cost: 0, tokens: 0 })
    if (sessionId) {
      saveSessionContext(aziendaId, userId, sessionId, `Dominio: general\nAgente: Assistente FIAI\nRisposta: ${text.substring(0, 200)}...`)
    }
    return {
      text, toolCalls: [], agentName: 'Assistente FIAI',
      agentDomain: 'general', agentColor: '#607D8B',
      suggestions: getSuggestions('general', []),
    }
  }

  // ── TTS domain — not supported server-side, return text message ──
  if (classification.domain === 'tts') {
    return {
      text: 'La sintesi vocale non e disponibile via WhatsApp al momento. Puoi usarla dalla web chat.',
      toolCalls: [], agentName: 'Assistente FIAI', agentDomain: 'tts', agentColor: '#FF6F00',
      suggestions: getSuggestions('general', []),
    }
  }

  // ── Single-agent execution ──
  const agent = AGENTS[classification.domain] || AGENTS.pulse
  const result = await executeAgentCall(message, agent, aziendaId, userId, sessionId, format, conversationHistory)

  const latencyMs = Date.now() - startTime
  const toolsUsed = result.toolCalls.map((t: any) => t.tool).filter(Boolean) as string[]

  // Capture signal
  captureSignal(aziendaId, userId, {
    sessionId,
    domain: classification.domain,
    confidence: classification.confidence,
    tools: toolsUsed,
    latencyMs,
    agentName: agent.name,
    cost: 0,
    tokens: 0,
  })

  // Save session context
  if (sessionId) {
    saveSessionContext(aziendaId, userId, sessionId,
      `Dominio: ${classification.domain}\nAgente: ${agent.name}\nTools usati: ${toolsUsed.join(', ')}\nRisposta: ${result.text.substring(0, 200)}...`
    )
    // Cache domain for ITERATION mode
    if ((classification.domain as string) !== 'general') {
      sessionDomainCache.set(sessionId, classification.domain)
    }
  }

  return { ...result, suggestions: getSuggestions(classification.domain, toolsUsed) }
}

// ── Execute Agent Call (with context, tools, tool loop) ──

async function executeAgentCall(
  message: string,
  agent: AgentConfig,
  aziendaId: string,
  userId: string,
  sessionId: string,
  format: 'web' | 'whatsapp',
  conversationHistory?: ConversationMessage[]
): Promise<{ text: string; toolCalls: any[]; agentName: string; agentDomain: string; agentColor: string }> {
  // Build tools
  const tools = agent.toolNames
    .map(name => TOOL_DEFS[name])
    .filter(Boolean)

  // Build system prompt with context
  const context = buildFullContext(aziendaId, agent.domain, userId, sessionId)

  let systemPrompt = agent.systemPrompt +
    '\n\nREGOLA IMPORTANTE: Quando usi un tool che restituisce dati (tabelle, liste, numeri), NON ripetere gli stessi dati in formato tabella markdown nella tua risposta testuale. I dati del tool vengono gia visualizzati automaticamente. Nella tua risposta aggiungi solo commenti, analisi, suggerimenti o prossimi passi — mai duplicare i dati.'

  if (context) {
    systemPrompt += '\n\n' + context
  }

  if (format === 'whatsapp') {
    systemPrompt += '\nFormatta per WhatsApp: *grassetto*, liste con -, niente tabelle markdown. Sii conciso.'
  }
  systemPrompt += '\nNon ripetere i dati grezzi dei tool nella risposta. Sintetizza in modo leggibile.'

  // Profile context from DB
  const profile = db.prepare('SELECT nome, cognome, ruolo FROM user_profiles WHERE id = ?').get(userId) as any
  if (profile) {
    systemPrompt += `\nUtente: ${profile.nome} ${profile.cognome} (${profile.ruolo})`
  }

  const apiMessages: any[] = [
    { role: 'system', content: systemPrompt },
  ]

  // Include conversation history
  if (conversationHistory && conversationHistory.length > 0) {
    for (const m of conversationHistory.slice(-8)) {
      apiMessages.push({ role: m.role, content: m.content })
    }
  }

  apiMessages.push({ role: 'user', content: message })

  const allToolCalls: any[] = []
  let loops = 5

  while (loops-- > 0) {
    const res = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENROUTER_API_KEY}` },
      body: JSON.stringify({ model: AGENT_MODEL, messages: apiMessages, tools: tools.length > 0 ? tools : undefined, max_tokens: 1024 }),
    })

    if (!res.ok) throw new Error(`API error ${res.status}`)

    const data = await res.json()
    const choice = data.choices?.[0]
    const msg = choice?.message

    if (choice?.finish_reason === 'tool_calls' || msg?.tool_calls) {
      apiMessages.push(msg)
      for (const tc of msg.tool_calls || []) {
        let fnArgs: Record<string, unknown> = {}
        try { fnArgs = JSON.parse(tc.function.arguments || '{}') } catch {}
        const result = await executeTool(tc.function.name, aziendaId, fnArgs)
        allToolCalls.push({ tool: tc.function.name, result })

        let toolContent: string
        if (tc.function.name === 'generate_image' && (result as any)?.image_url) {
          toolContent = JSON.stringify({ successo: true, messaggio: 'Immagine generata con successo' })
        } else {
          toolContent = JSON.stringify(result)
        }
        apiMessages.push({ role: 'tool', tool_call_id: tc.id, content: toolContent })
      }
      continue
    }

    return {
      text: msg?.content ?? '',
      toolCalls: allToolCalls,
      agentName: agent.name,
      agentDomain: agent.domain,
      agentColor: agent.color,
    }
  }

  return { text: 'Troppi passaggi.', toolCalls: allToolCalls, agentName: agent.name, agentDomain: agent.domain, agentColor: agent.color }
}

// ── API Endpoint ─────────────────────────────────────────

router.post('/message', authMiddleware(true), async (req: AuthRequest, res: Response) => {
  try {
    const { message, format, sessionId, conversationHistory } = req.body
    if (!message) { res.status(400).json({ error: 'message richiesto' }); return }

    const result = await orchestrateServerSide(
      message,
      req.userId || '',
      req.aziendaId || '',
      {
        format: format || 'web',
        sessionId: sessionId || '',
        conversationHistory: conversationHistory || [],
      }
    )

    res.json(result)
  } catch (err) {
    console.error('Chat API error:', err)
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── Generate JWT for internal use (WhatsApp) ─────────────

export function generateInternalToken(userId: string, email: string): string {
  return jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: '1h' })
}

export default router
