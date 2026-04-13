import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import db from '../db.js'
import { sanitizeMetadata } from '../middleware.js'
import { emit } from './events.js'
import type { ToolDefinition } from './types.js'

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const JWT_SECRET = process.env.JWT_SECRET || 'fiai-dev-secret'

// Retrieve query variants cache (TTL 10 min)
const retrieveCache = new Map<string, { variants: string[]; ts: number }>()
const RETRIEVE_CACHE_TTL = 600000

// ── Helper: slugify ───────────────────────────────────────
function slugify(text: string): string {
  return text.toLowerCase()
    .replace(/[àáâã]/g, 'a').replace(/[èéêë]/g, 'e').replace(/[ìíîï]/g, 'i')
    .replace(/[òóôõ]/g, 'o').replace(/[ùúûü]/g, 'u')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 80) || 'unnamed'
}

// ── Helper: parse metadata from row ───────────────────────
function parseRow(row: any): any {
  if (!row) return row
  const r = { ...row }
  if (typeof r.metadata === 'string') try { r.metadata = JSON.parse(r.metadata) } catch {}
  if (typeof r.tags === 'string') try { r.tags = JSON.parse(r.tags) } catch {}
  // Sanitize password_hash
  if (r.metadata?.password_hash) delete r.metadata.password_hash
  return r
}

function parseRows(rows: any[]): any[] {
  return rows.map(parseRow)
}

// ══════════════════════════════════════════════════════════
// TOOL DEFINITIONS — 7 generic + special tools
// ══════════════════════════════════════════════════════════

export const TOOL_DEFINITIONS: Record<string, ToolDefinition> = {
  // ── Generic VFS tools ──
  find: { type: 'function', function: { name: 'find', description: 'Cerca QUALSIASI cosa nel sistema. Usa automaticamente il motore migliore (SQL/full-text/semantico). Per persone: find(tags=["cliente"]). Per contenuto documenti: find(query="definizione imprenditore"). Per simili: find(query="aziende settore metalli"). Per filtri: find(type="fattura", filters={stato:"scaduta"}).', parameters: { type: 'object', properties: {
    query: { type: 'string', description: 'Cosa cercare (testo libero)' },
    type: { type: 'string', description: 'Tipo entity: persona, utente, organizzazione, fattura, documento, report, progetto, etc.' },
    tags: { type: 'array', items: { type: 'string' }, description: 'Filtro tags: cliente, lead, fornitore, candidato, utente' },
    stato: { type: 'string', description: 'Filtra per stato' },
    name_id: { type: 'string', description: 'Filtra entity collegati a un record' },
    doc_id: { type: 'string', description: 'Cerca DENTRO un documento specifico (chunk search)' },
    limit: { type: 'number', description: 'Max risultati (default 10)' },
  } } } },

  // Legacy alias
  search: { type: 'function', function: { name: 'search', description: '(Alias di find) Cerca nel sistema.', parameters: { type: 'object', properties: {
    type: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, stato: { type: 'string' },
    query: { type: 'string' }, name_id: { type: 'string' }, limit: { type: 'number' },
  } } } },

  create: { type: 'function', function: { name: 'create', description: 'Crea un record: persona, azienda, fattura, progetto, documento, etc. Tutto è entity.', parameters: { type: 'object', properties: {
    type: { type: 'string', description: 'Tipo: persona, utente, organizzazione, fattura, ordine, progetto, documento, report, etc.' },
    tags: { type: 'array', items: { type: 'string' }, description: 'Tags: cliente, lead, fornitore, candidato, admin' },
    display_name: { type: 'string', description: 'Nome visualizzato' },
    email: { type: 'string', description: 'Email' },
    telefono: { type: 'string', description: 'Telefono' },
    stato: { type: 'string', description: 'Stato iniziale' },
    name_id: { type: 'string', description: 'ID name collegato (solo entity)' },
    parent_id: { type: 'string', description: 'ID entity padre (solo entity)' },
    numero: { type: 'string', description: 'Numero documento (solo entity)' },
    data: { type: 'string', description: 'Data principale (solo entity)' },
    totale: { type: 'number', description: 'Importo/totale (solo entity)' },
    metadata: { type: 'object', description: 'Campi specifici del tipo in JSON' },
  }, required: ['table', 'display_name'] } } },

  update: { type: 'function', function: { name: 'update', description: 'Aggiorna un name o entity', parameters: { type: 'object', properties: {
    id: { type: 'string', description: 'ID record' },
    table: { type: 'string', enum: ['names', 'entity'] },
    display_name: { type: 'string' },
    stato: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    metadata: { type: 'object', description: 'Campi da aggiornare (merge con esistenti)' },
  }, required: ['id', 'table'] } } },

  delete_record: { type: 'function', function: { name: 'delete_record', description: 'Elimina un record (soft delete di default — archivia il record in modo recuperabile). Usa permanent=true per eliminazione definitiva irreversibile. Elimina anche i chunk e le relazioni collegati.', parameters: { type: 'object', properties: {
    id: { type: 'string', description: 'ID del record da eliminare' },
    permanent: { type: 'boolean', description: 'true = eliminazione definitiva irreversibile. false/omesso = soft delete (archiviazione recuperabile)' },
  }, required: ['id'] } } },

  relate: { type: 'function', function: { name: 'relate', description: 'Crea una relazione tra due record (name↔name, name↔entity, entity↔entity)', parameters: { type: 'object', properties: {
    from_id: { type: 'string' },
    to_id: { type: 'string' },
    tipo: { type: 'string', description: 'Tipo relazione: persona_di, allegato_a, assegnato_a, convertito_da, ordine_da_preventivo, etc.' },
  }, required: ['from_id', 'to_id', 'tipo'] } } },

  get_tree: { type: 'function', function: { name: 'get_tree', description: 'Ottieni un record con tutti i figli, entity collegate e relazioni', parameters: { type: 'object', properties: {
    id: { type: 'string' },
  }, required: ['id'] } } },

  render_view: { type: 'function', function: { name: 'render_view', description: 'Genera una vista dinamica (lista, kanban, form, chart, detail, calendar) per il pannello laterale o inline nella chat. Restituisci un layout descriptor JSON.', parameters: { type: 'object', properties: {
    layout: { type: 'object', description: 'Layout descriptor JSON con: view, title, source, columns, kanban, fields, chart, actions, createForm' },
  }, required: ['layout'] } } },

  // ── Autonomous agent tools ──
  create_autonomous_agent: { type: 'function', function: { name: 'create_autonomous_agent', description: 'Crea un agente autonomo che gira in background. Puo essere schedulato (cron), reagire a eventi, o controllare condizioni.', parameters: { type: 'object', properties: {
    name: { type: 'string', description: 'Nome agente (es. "Monitor Fatture Scadute")' },
    description: { type: 'string', description: 'Cosa fa questo agente' },
    agentDomain: { type: 'string', description: 'Dominio agente (opzionale — dedotto dal prompt se omesso): pulse, commerciale, amministrazione, produzione, hr, legal, documentale, marketing, it, doctor, whatsapp' },
    promptTemplate: { type: 'string', description: 'Messaggio/istruzione che l\'agente riceve ad ogni esecuzione' },
    trigger_type: { type: 'string', enum: ['cron', 'event'], description: 'Tipo di trigger' },
    cron: { type: 'string', description: 'Espressione cron (es. "0 8 * * 1" = lunedi 8:00, "0 9 * * *" = ogni giorno 9:00)' },
    event: { type: 'string', description: 'Nome evento (es. "entity_created:documento", "name_created:lead")' },
    notify: { type: 'array', items: { type: 'string' }, description: 'Canali notifica: chat, whatsapp' },
  }, required: ['name', 'agentDomain', 'promptTemplate', 'trigger_type'] } } },

  list_autonomous_agents: { type: 'function', function: { name: 'list_autonomous_agents', description: 'Mostra tutti gli agenti autonomi attivi e inattivi', parameters: { type: 'object', properties: {} } } },

  toggle_autonomous_agent: { type: 'function', function: { name: 'toggle_autonomous_agent', description: 'Attiva o disattiva un agente autonomo', parameters: { type: 'object', properties: {
    id: { type: 'string' }, enabled: { type: 'boolean' }
  }, required: ['id', 'enabled'] } } },

  delete_autonomous_agent: { type: 'function', function: { name: 'delete_autonomous_agent', description: 'Elimina un agente autonomo', parameters: { type: 'object', properties: {
    id: { type: 'string' }
  }, required: ['id'] } } },

  get_agent_logs: { type: 'function', function: { name: 'get_agent_logs', description: 'Mostra i log di esecuzione degli agenti autonomi', parameters: { type: 'object', properties: {
    agent_id: { type: 'string', description: 'ID agente specifico (opzionale)' },
    limit: { type: 'number' },
  } } } },

  // ── Workflow tools ──
  create_workflow: { type: 'function', function: { name: 'create_workflow', description: 'Crea un workflow multi-step (catena di agenti). Ogni step esegue un agente con un prompt, con dipendenze opzionali tra step.', parameters: { type: 'object', properties: {
    name: { type: 'string', description: 'Nome workflow' },
    description: { type: 'string' },
    steps: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, agent: { type: 'string' }, prompt: { type: 'string' }, dependsOn: { type: 'array', items: { type: 'string' } }
    }, required: ['id', 'agent', 'prompt'] }, description: 'Lista step del workflow' },
  }, required: ['name', 'steps'] } } },

  run_workflow: { type: 'function', function: { name: 'run_workflow', description: 'Esegui un workflow immediatamente', parameters: { type: 'object', properties: {
    workflow_id: { type: 'string' }
  }, required: ['workflow_id'] } } },

  list_workflows: { type: 'function', function: { name: 'list_workflows', description: 'Lista tutti i workflow disponibili', parameters: { type: 'object', properties: {} } } },

  // ── Job queue tools ──
  create_job: { type: 'function', function: { name: 'create_job', description: 'Crea un job in background (task asincrono). Usalo per operazioni lunghe: import dati, generazione batch, invio notifiche, report periodici.', parameters: { type: 'object', properties: {
    action: { type: 'string', description: 'Azione da eseguire (es. generate_report, send_notifications, import_data)' },
    params: { type: 'object', description: 'Parametri per il job' },
    scheduled_at: { type: 'string', description: 'Data/ora di esecuzione (ISO). Ometti per esecuzione immediata.' },
    cron: { type: 'string', description: 'Espressione cron per job ricorrenti (es. "0 8 * * 1" = ogni lunedi alle 8)' },
  }, required: ['action'] } } },

  get_jobs: { type: 'function', function: { name: 'get_jobs', description: 'Mostra lo stato dei job in background (queued, running, completed, failed)', parameters: { type: 'object', properties: {
    stato: { type: 'string', description: 'Filtra per stato: queued, running, completed, failed, dead' },
    limit: { type: 'number' },
  } } } },

  // ── TTS agent tools ──
  list_voices: { type: 'function', function: { name: 'list_voices', description: 'Lista tutte le voci disponibili (built-in + clonate dall\'utente)', parameters: { type: 'object', properties: {} } } },
  set_voice: { type: 'function', function: { name: 'set_voice', description: 'Imposta la voce preferita dell\'utente', parameters: { type: 'object', properties: { voice_name: { type: 'string' } }, required: ['voice_name'] } } },
  get_current_voice: { type: 'function', function: { name: 'get_current_voice', description: 'Ottieni la voce attuale dell\'utente', parameters: { type: 'object', properties: {} } } },
  clone_voice: { type: 'function', function: { name: 'clone_voice', description: 'Clona una voce da un audio allegato. L\'utente deve aver allegato un audio nella chat.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Nome da dare alla voce clonata' } }, required: ['name'] } } },

  // ── Skill & Memory management tools ──
  update_skill: { type: 'function', function: { name: 'update_skill', description: 'Aggiorna la skill (personalità, regole, modello) di un agente. Le modifiche sono persistenti.', parameters: { type: 'object', properties: {
    domain: { type: 'string', description: 'Dominio agente: pulse, commerciale, produzione, marketing, amministrazione, hr, legal, documentale, whatsapp, infra, tts' },
    system_prompt: { type: 'string', description: 'Nuovo prompt di sistema (personalità e istruzioni)' },
    rules: { type: 'array', items: { type: 'string' }, description: 'Regole specifiche (es. ["Proponi sempre un follow-up", "Ordina per valore"])' },
    model: { type: 'string', description: 'Modello LLM (es. anthropic/claude-haiku-4.5, mistralai/mistral-small-2603)' },
  }, required: ['domain'] } } },

  list_skills: { type: 'function', function: { name: 'list_skills', description: 'Mostra le skill di tutti gli agenti con personalità, regole e modello', parameters: { type: 'object', properties: {} } } },

  add_agent_lesson: { type: 'function', function: { name: 'add_agent_lesson', description: 'Aggiungi una lezione appresa alla memoria di un agente (es. "non ripetere i dati in tabella", "ordina per valore")', parameters: { type: 'object', properties: {
    domain: { type: 'string', description: 'Dominio agente' },
    rule: { type: 'string', description: 'La lezione/regola da ricordare' },
  }, required: ['domain', 'rule'] } } },

  // ── Document management tools ──
  list_documents: { type: 'function', function: { name: 'list_documents', description: 'Lista documenti con dettagli: nome, categoria, chunk count, dimensione, stato indicizzazione.', parameters: { type: 'object', properties: {
    categoria: { type: 'string', description: 'Filtra per categoria' },
  } } } },

  explore_document: { type: 'function', function: { name: 'explore_document', description: 'Esplora struttura interna di un documento: mostra capitoli, sezioni, articoli (heading path dei chunk). Per navigare documenti grandi.', parameters: { type: 'object', properties: {
    doc_id: { type: 'string', description: 'ID documento' },
    limit: { type: 'number', description: 'Max sezioni (default 30)' },
  }, required: ['doc_id'] } } },

  rechunk_document: { type: 'function', function: { name: 'rechunk_document', description: 'Ri-indicizza un documento: elimina chunk esistenti, ri-estrae testo, ri-chunka. Per documenti non chunkati o da re-indicizzare.', parameters: { type: 'object', properties: {
    doc_id: { type: 'string', description: 'ID documento' },
  }, required: ['doc_id'] } } },

  reclassify_document: { type: 'function', function: { name: 'reclassify_document', description: 'Cambia classificazione di un documento: categoria, tags, nome, tipo.', parameters: { type: 'object', properties: {
    doc_id: { type: 'string', description: 'ID documento' },
    categoria: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    display_name: { type: 'string' },
  }, required: ['doc_id'] } } },

  // ── Agentic RAG retrieve tool ──
  retrieve: { type: 'function', function: { name: 'retrieve', description: 'Cerca DENTRO il contenuto dei documenti caricati. Trova articoli, clausole, definizioni, sezioni specifiche. Usa per domande sul contenuto di documenti, non per cercare documenti per nome.', parameters: { type: 'object', properties: {
    query: { type: 'string', description: 'Cosa cercare nel contenuto (es. "definizione imprenditore", "clausola penale")' },
    doc_id: { type: 'string', description: 'ID documento specifico in cui cercare (opzionale — se omesso cerca in tutti)' },
    limit: { type: 'number', description: 'Max risultati (default 5)' },
  }, required: ['query'] } } },

  // ── TTS tool ──
  generate_tts: { type: 'function', function: { name: 'generate_tts', description: 'Genera audio TTS (sintesi vocale) da ascoltare nella chat. NON invia su WhatsApp — usa send_whatsapp_voice per quello.', parameters: { type: 'object', properties: {
    text: { type: 'string', description: 'Testo da leggere' },
    voice: { type: 'string', description: 'Voce (Vivian, Serena, Ryan...)' },
  }, required: ['text'] } } },

  // ── Date/Time tools ──
  get_datetime: { type: 'function', function: { name: 'get_datetime', description: 'Ottieni data e ora correnti (o di qualsiasi citta/timezone), giorno della settimana, settimana dell\'anno, e calcola date relative. Senza parametri restituisce data/ora locale (Europe/Rome).', parameters: { type: 'object', properties: {
    offset: { type: 'string', description: 'Offset relativo: "7d", "-3d", "1w", "1m", "next_monday", "next_friday", "end_month", "start_month", "end_week", "start_week", "end_year"' },
    timezone: { type: 'string', description: 'Timezone IANA (es. "America/New_York", "Asia/Tokyo", "Europe/London") o nome citta (es. "New York", "Tokyo", "Londra", "Dubai")' },
  } } } },

  date_diff: { type: 'function', function: { name: 'date_diff', description: 'Calcola la differenza tra due date in giorni, settimane, mesi', parameters: { type: 'object', properties: {
    from: { type: 'string', description: 'Data inizio (ISO o "today")' },
    to: { type: 'string', description: 'Data fine (ISO o "today")' },
  }, required: ['from', 'to'] } } },

  // ── Special tools (non-CRUD) ──
  generate_image: { type: 'function', function: { name: 'generate_image', description: "Genera un'immagine dalla descrizione testuale", parameters: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] } } },
  generate_pdf: { type: 'function', function: { name: 'generate_pdf', description: 'Genera un PDF da contenuto testuale', parameters: { type: 'object', properties: { titolo: { type: 'string' }, contenuto: { type: 'string' } }, required: ['titolo', 'contenuto'] } } },
  get_api_costs: { type: 'function', function: { name: 'get_api_costs', description: 'Costi API OpenRouter', parameters: { type: 'object', properties: {} } } },
  get_session_context: { type: 'function', function: { name: 'get_session_context', description: 'Mostra statistiche del contesto della sessione corrente: token usati, percentuale rimanente, dettagli system prompt, tool, history, pruning.', parameters: { type: 'object', properties: { session_id: { type: 'string', description: 'ID sessione (opzionale, usa la sessione corrente)' } } } } },
  inspect_system: { type: 'function', function: { name: 'inspect_system', description: 'Ispeziona agenti e tool del sistema. Senza parametri: lista tutti gli agenti con tools. Con agent_domain: dettagli agente (prompt completo, tools, modello). Con tool_name: dettaglio tool (descrizione, parametri).', parameters: { type: 'object', properties: {
    agent_domain: { type: 'string', description: 'Dominio agente per vedere dettagli (es. "commerciale", "it", "documentale")' },
    tool_name: { type: 'string', description: 'Nome tool per vedere definizione completa (es. "find", "execute_code")' },
  } } } },
  get_whatsapp_status: { type: 'function', function: { name: 'get_whatsapp_status', description: 'Stato connessione WhatsApp', parameters: { type: 'object', properties: {} } } },
  send_whatsapp_message: { type: 'function', function: { name: 'send_whatsapp_message', description: 'Invia un messaggio di testo WhatsApp', parameters: { type: 'object', properties: { phone: { type: 'string', description: 'Numero ESATTAMENTE come trovato nel sistema — NON aggiungere prefissi, NON modificare. Es: se il sistema restituisce 393471349312, usa 393471349312' }, text: { type: 'string' } }, required: ['phone', 'text'] } } },
  send_whatsapp_voice: { type: 'function', function: { name: 'send_whatsapp_voice', description: 'Invia un messaggio vocale WhatsApp (TTS)', parameters: { type: 'object', properties: { phone: { type: 'string', description: 'Numero ESATTAMENTE come trovato nel sistema — NON aggiungere prefissi' }, text: { type: 'string', description: 'Testo da pronunciare' }, voice: { type: 'string', description: 'Voce TTS (Vivian, Serena, Ryan...)' } }, required: ['phone', 'text'] } } },
  send_whatsapp_image: { type: 'function', function: { name: 'send_whatsapp_image', description: 'Invia un\'immagine su WhatsApp (da URL o path file)', parameters: { type: 'object', properties: { phone: { type: 'string', description: 'Numero ESATTAMENTE come trovato nel sistema — NON aggiungere prefissi' }, url: { type: 'string', description: 'URL o path del file immagine' }, caption: { type: 'string', description: 'Didascalia opzionale' } }, required: ['phone', 'url'] } } },
  send_whatsapp_document: { type: 'function', function: { name: 'send_whatsapp_document', description: 'Invia un documento/file su WhatsApp (PDF, DOC, etc.)', parameters: { type: 'object', properties: { phone: { type: 'string', description: 'Numero ESATTAMENTE come trovato nel sistema — NON aggiungere prefissi' }, url: { type: 'string', description: 'URL o path del file' }, filename: { type: 'string', description: 'Nome file visualizzato' }, caption: { type: 'string' } }, required: ['phone', 'url'] } } },
  send_whatsapp_video: { type: 'function', function: { name: 'send_whatsapp_video', description: 'Invia un video su WhatsApp', parameters: { type: 'object', properties: { phone: { type: 'string', description: 'Numero ESATTAMENTE come trovato nel sistema — NON aggiungere prefissi' }, url: { type: 'string', description: 'URL o path del video' }, caption: { type: 'string' } }, required: ['phone', 'url'] } } },

  // ── Email ──
  get_email_status: { type: 'function', function: { name: 'get_email_status', description: 'Stato connessione email (IMAP/SMTP)', parameters: { type: 'object', properties: {} } } },
  send_email: { type: 'function', function: { name: 'send_email', description: 'Invia una email con supporto HTML e allegati', parameters: { type: 'object', properties: { to: { type: 'string', description: 'Destinatario email' }, subject: { type: 'string', description: 'Oggetto' }, html: { type: 'string', description: 'Corpo email (HTML supportato)' }, cc: { type: 'string', description: 'CC (virgola-separati)' }, bcc: { type: 'string', description: 'BCC (virgola-separati)' }, attachments: { type: 'array', items: { type: 'object', properties: { filename: { type: 'string' }, path: { type: 'string', description: 'file_url dal VFS (es. /api/uploads/...)' } } }, description: 'Allegati da VFS' } }, required: ['to', 'subject', 'html'] } } },
  read_inbox: { type: 'function', function: { name: 'read_inbox', description: 'Lista email recenti dalla casella di posta', parameters: { type: 'object', properties: { limit: { type: 'number', description: 'Numero email da mostrare (default 15)' }, folder: { type: 'string', description: 'Cartella IMAP (default INBOX)' } } } } },
  read_email: { type: 'function', function: { name: 'read_email', description: 'Leggi email completa per UID — restituisce corpo, allegati, header threading', parameters: { type: 'object', properties: { uid: { type: 'number', description: 'UID del messaggio' } }, required: ['uid'] } } },
  search_emails: { type: 'function', function: { name: 'search_emails', description: 'Cerca email per oggetto, mittente, data o testo nel corpo', parameters: { type: 'object', properties: { subject: { type: 'string', description: 'Filtra per oggetto' }, from: { type: 'string', description: 'Filtra per mittente' }, since: { type: 'string', description: 'Data da (YYYY-MM-DD)' }, before: { type: 'string', description: 'Data fino a (YYYY-MM-DD)' }, text: { type: 'string', description: 'Cerca nel corpo' }, limit: { type: 'number', description: 'Max risultati (default 10)' } } } } },
  reply_email: { type: 'function', function: { name: 'reply_email', description: 'Rispondi a una email mantenendo il thread di conversazione', parameters: { type: 'object', properties: { uid: { type: 'number', description: 'UID email a cui rispondere' }, html: { type: 'string', description: 'Corpo risposta (HTML)' }, cc: { type: 'string', description: 'CC aggiuntivi' } }, required: ['uid', 'html'] } } },
  download_email_attachment: { type: 'function', function: { name: 'download_email_attachment', description: 'Scarica allegato da una email e salvalo nel sistema', parameters: { type: 'object', properties: { uid: { type: 'number', description: 'UID email' }, part_id: { type: 'string', description: 'ID parte allegato (indice numerico)' } }, required: ['uid', 'part_id'] } } },

  // ── Planning (proxy to ai-planner via VPN) ──
  planning_health: { type: 'function', function: { name: 'planning_health', description: 'Verifica connessione al planner trasporti (richiede VPN)', parameters: { type: 'object', properties: {} } } },
  planning_viaggi: { type: 'function', function: { name: 'planning_viaggi', description: 'Lista viaggi/ordini da pianificare per una data', parameters: { type: 'object', properties: { data: { type: 'string', description: 'Data YYYY-MM-DD' }, solo_non_assegnati: { type: 'boolean', description: 'Solo non assegnati' } }, required: ['data'] } } },
  planning_suggerisci: { type: 'function', function: { name: 'planning_suggerisci', description: 'Esegui ottimizzazione automatica: assegna autisti e semirimorchi ai viaggi con scoring composito', parameters: { type: 'object', properties: { data: { type: 'string', description: 'Data YYYY-MM-DD' }, template: { type: 'string', description: 'Template viaggi (opzionale)' } }, required: ['data'] } } },
  planning_assegna: { type: 'function', function: { name: 'planning_assegna', description: 'Assegna manualmente un viaggio a un autista/semirimorchio', parameters: { type: 'object', properties: { bg: { type: 'string', description: 'Codice BG del viaggio' }, targa: { type: 'string', description: 'Targa semirimorchio' }, autista: { type: 'string', description: 'Nome autista' } }, required: ['bg'] } } },
  planning_autisti: { type: 'function', function: { name: 'planning_autisti', description: 'Lista autisti disponibili per una data (esclude assenti/ferie)', parameters: { type: 'object', properties: { data: { type: 'string', description: 'Data YYYY-MM-DD' } }, required: ['data'] } } },
  planning_semirimorchi: { type: 'function', function: { name: 'planning_semirimorchi', description: 'Lista semirimorchi disponibili, filtrabili per tipo (SILOS, ROTOCELLA, CENTINATO, etc.)', parameters: { type: 'object', properties: { data: { type: 'string', description: 'Data YYYY-MM-DD' }, tipo: { type: 'string', description: 'Tipo: SILOS, ROTOCELLA, RIBALTABILE_9M, PORTACTR_9M, PORTACTR_13_6M, CENTINATO' } }, required: ['data'] } } },
  planning_gps: { type: 'function', function: { name: 'planning_gps', description: 'Posizione GPS in tempo reale di un semirimorchio', parameters: { type: 'object', properties: { targa: { type: 'string', description: 'Targa semirimorchio' } }, required: ['targa'] } } },
  planning_distanza: { type: 'function', function: { name: 'planning_distanza', description: 'Calcola distanza stradale tra due localita', parameters: { type: 'object', properties: { origine: { type: 'string', description: 'Localita partenza' }, destinazione: { type: 'string', description: 'Localita arrivo' } }, required: ['origine', 'destinazione'] } } },
  planning_statistiche: { type: 'function', function: { name: 'planning_statistiche', description: 'Statistiche viaggi per periodo (per cliente, destinazione, autista)', parameters: { type: 'object', properties: { data_inizio: { type: 'string' }, data_fine: { type: 'string' }, raggruppa_per: { type: 'string', description: 'cliente, destinazione, autista, vettore' } }, required: ['data_inizio', 'data_fine'] } } },
  planning_confronta: { type: 'function', function: { name: 'planning_confronta', description: 'Confronta piano proposto vs assegnazioni effettive per una data', parameters: { type: 'object', properties: { data: { type: 'string' } }, required: ['data'] } } },
  planning_scenario: { type: 'function', function: { name: 'planning_scenario', description: 'Simulazione what-if: ricalcola con vincoli diversi (escludi autisti, modifica distanze)', parameters: { type: 'object', properties: { data: { type: 'string' }, escludi_autisti: { type: 'array', items: { type: 'string' } }, vincoli: { type: 'object' } }, required: ['data'] } } },
  planning_eta: { type: 'function', function: { name: 'planning_eta', description: 'Calcola ETA di un autista in viaggio — cerca per nome, trova BG e targa automaticamente', parameters: { type: 'object', properties: { nome_autista: { type: 'string', description: 'Nome autista (anche parziale)' }, data: { type: 'string', description: 'Data YYYY-MM-DD (default oggi)' } }, required: ['nome_autista'] } } },
  planning_conflitti: { type: 'function', function: { name: 'planning_conflitti', description: 'Mostra conflitti di risorse (autisti/semirimorchi doppiamente assegnati)', parameters: { type: 'object', properties: { data: { type: 'string' } }, required: ['data'] } } },
  planning_storico: { type: 'function', function: { name: 'planning_storico', description: 'Cerca precedenti storici simili (RAG) per un viaggio o situazione', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  planning_dettaglio: { type: 'function', function: { name: 'planning_dettaglio', description: 'Dettaglio completo di un viaggio (BG, cliente, localita, date, container, genere)', parameters: { type: 'object', properties: { bg: { type: 'string' } }, required: ['bg'] } } },
  planning_analizza: { type: 'function', function: { name: 'planning_analizza', description: 'Diagnostica perche un viaggio non e stato assegnato', parameters: { type: 'object', properties: { bg: { type: 'string' } }, required: ['bg'] } } },
  planning_pianificazione_corrente: { type: 'function', function: { name: 'planning_pianificazione_corrente', description: 'Assegnazioni correnti per una data', parameters: { type: 'object', properties: { data: { type: 'string' } }, required: ['data'] } } },
  planning_cerca_autista: { type: 'function', function: { name: 'planning_cerca_autista', description: 'Cerca autista per nome — restituisce posizione, impegni, skill. NOTA: la ricerca fuzzy puo dare match errati, verifica sempre il nome nel risultato.', parameters: { type: 'object', properties: { nome: { type: 'string' } }, required: ['nome'] } } },
  planning_tutti_autisti: { type: 'function', function: { name: 'planning_tutti_autisti', description: 'Lista COMPLETA di tutti gli autisti (interni + trazionisti/esterni) con ID, nome, tipo. Utile per cercare un autista quando planning_cerca_autista non lo trova.', parameters: { type: 'object', properties: {} } } },

  // ── Weather ──
  get_weather: { type: 'function', function: { name: 'get_weather', description: 'Meteo attuale e previsioni per una citta. Restituisce temperatura, condizioni, vento, umidita. Supporta previsioni fino a 16 giorni con dettaglio orario.', parameters: { type: 'object', properties: {
    city: { type: 'string', description: 'Nome citta (es. "Parma", "Roma", "New York", "Tokyo")' },
    days: { type: 'number', description: 'Giorni di previsione (1-16, default 1). 1=solo oggi, 3=prossimi 3 giorni' },
  }, required: ['city'] } } },

  // ── Maps & Routing ──
  get_map: { type: 'function', function: { name: 'get_map', description: 'Mostra mappa di un indirizzo o calcola un percorso tra due punti. Restituisce mappa interattiva + dettagli percorso (distanza, durata, tappe). Supporta auto, bici, piedi.', parameters: { type: 'object', properties: {
    address: { type: 'string', description: 'Indirizzo o luogo da mostrare (es. "Via Garibaldi 10, Parma")' },
    from: { type: 'string', description: 'Partenza per calcolo percorso (es. "Parma")' },
    to: { type: 'string', description: 'Destinazione per calcolo percorso (es. "Milano")' },
    mode: { type: 'string', enum: ['driving', 'cycling', 'walking'], description: 'Mezzo: driving (auto, default), cycling (bici), walking (piedi)' },
  } } } },

  // ── Code Execution (programmatic tool calling) ──
  execute_code: { type: 'function', function: { name: 'execute_code', description: 'Esegui codice JavaScript per operazioni complesse: loop su molti record, aggregazioni, filtri condizionali, batch operations. Il codice ha accesso ai tool FIAI come funzioni async: find(params), create(params), update(params), delete_record(params), relate(params), get_tree(params), retrieve(params), list_documents(), get_datetime(), date_diff(params), generate_pdf(params). Usa print() per output. Solo l\'output finale torna nel contesto — i risultati intermedi non consumano token. QUANDO USARE: operazioni su >3 record (es. "controlla tutte le fatture scadute"), aggregazioni (es. "totale fatturato per cliente"), batch updates, confronti multipli.', parameters: { type: 'object', properties: {
    code: { type: 'string', description: 'Codice JavaScript con await per tool async. Es: const clients = await find({tags:["cliente"]}); print(`${clients.length} clienti trovati`)' },
  }, required: ['code'] } } },

  // ── Web Search (via LLM con browsing) ──
  web_search: { type: 'function', function: { name: 'web_search', description: 'Cerca informazioni sul web. Usa quando l\'utente chiede esplicitamente di cercare online, o quando i dati non sono nel sistema. Restituisce risultati dal web con fonti.', parameters: { type: 'object', properties: {
    query: { type: 'string', description: 'Cosa cercare sul web' },
  }, required: ['query'] } } },

  // ── Permission management tools ──
  create_group: { type: 'function', function: { name: 'create_group', description: 'Crea un gruppo con permessi specifici per tipo di entity', parameters: { type: 'object', properties: {
    name: { type: 'string', description: 'Nome del gruppo (es. "Team Commerciale")' },
    permissions: { type: 'object', description: 'Permessi per tipo entity: {"organizzazione": ["read","create","update"], "fattura": ["read"]}. Azioni: read, create, update, delete, send' },
  }, required: ['name', 'permissions'] } } },

  add_to_group: { type: 'function', function: { name: 'add_to_group', description: 'Aggiunge un utente a un gruppo', parameters: { type: 'object', properties: {
    user_id: { type: 'string', description: 'ID utente' },
    group_id: { type: 'string', description: 'ID gruppo' },
  }, required: ['user_id', 'group_id'] } } },

  remove_from_group: { type: 'function', function: { name: 'remove_from_group', description: 'Rimuove un utente da un gruppo', parameters: { type: 'object', properties: {
    user_id: { type: 'string', description: 'ID utente' },
    group_id: { type: 'string', description: 'ID gruppo' },
  }, required: ['user_id', 'group_id'] } } },

  list_groups: { type: 'function', function: { name: 'list_groups', description: 'Lista gruppi con membri e permessi', parameters: { type: 'object', properties: {} } } },

  // set_user_role removed — permissions managed via groups only
}

// ══════════════════════════════════════════════════════════
// TOOL EXECUTORS
// ══════════════════════════════════════════════════════════

// Tool → required permission action
const TOOL_ACTIONS: Record<string, string> = {
  find: 'read', search: 'read', get_tree: 'read', retrieve: 'read',
  list_documents: 'read', explore_document: 'read', get_datetime: 'read',
  date_diff: 'read', get_api_costs: 'read', get_whatsapp_status: 'read',
  get_jobs: 'read', list_autonomous_agents: 'read', list_workflows: 'read',
  list_skills: 'read', get_agent_logs: 'read', get_session_context: 'read', inspect_system: 'read',
  create: 'create', relate: 'create', create_job: 'create',
  create_autonomous_agent: 'create', create_workflow: 'create',
  update: 'update', update_skill: 'update',
  delete_record: 'delete', delete_autonomous_agent: 'delete',
  send_whatsapp_message: 'send', send_whatsapp_voice: 'send',
  send_whatsapp_image: 'send', send_whatsapp_document: 'send',
  send_whatsapp_video: 'send',
  planning_health: 'read', planning_viaggi: 'read', planning_autisti: 'read',
  planning_semirimorchi: 'read', planning_gps: 'read', planning_distanza: 'read',
  planning_statistiche: 'read', planning_confronta: 'read', planning_storico: 'read',
  planning_dettaglio: 'read', planning_analizza: 'read', planning_conflitti: 'read',
  planning_pianificazione_corrente: 'read', planning_cerca_autista: 'read', planning_tutti_autisti: 'read',
  planning_eta: 'read', planning_scenario: 'read',
  planning_suggerisci: 'create', planning_assegna: 'create',
  get_email_status: 'read', read_inbox: 'read', read_email: 'read',
  search_emails: 'read', download_email_attachment: 'read',
  send_email: 'send', reply_email: 'send',
}

function auditLog(entityId: string, entityType: string | null, action: string, beforeData: any, afterData: any) {
  try {
    db.prepare("INSERT INTO entity_audit (id, entity_id, entity_type, action, before_data, after_data) VALUES (?,?,?,?,?,?)").run(
      crypto.randomUUID(), entityId, entityType, action,
      beforeData ? JSON.stringify(beforeData) : null,
      afterData ? JSON.stringify(afterData) : null
    )
  } catch {}
}

// ── Tool Result Cache (LRU per session, TTL 60s) ──
const toolCache = new Map<string, { result: unknown; ts: number }>()
const TOOL_CACHE_TTL = 60000
// Cache only tools with stable, repeatable results — NOT retrieve (LLM variants), NOT get_datetime (time-sensitive)
const CACHEABLE_TOOLS = new Set(['find', 'search', 'list_documents', 'get_email_status', 'get_whatsapp_status', 'get_weather'])

function getCacheKey(name: string, aziendaId: string, args: any): string {
  return `${name}:${aziendaId}:${JSON.stringify(args || {})}`
}

// Clean stale cache entries periodically
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of toolCache) {
    if (now - entry.ts > TOOL_CACHE_TTL) toolCache.delete(key)
  }
}, 30000)

async function _executeTool(name: string, aziendaId: string, args?: Record<string, unknown>, permissions?: import('./types.js').UserPermissions): Promise<unknown> {
  const input = (args || {}) as any

  // Permission check
  const requiredAction = TOOL_ACTIONS[name]
  if (requiredAction && permissions && !permissions.can(requiredAction as any, input.type || input.table)) {
    return { errore: `Permesso negato: non puoi eseguire "${name}" (richiede ${requiredAction})` }
  }

  switch (name) {

    // ── FIND (unified search: SQL + FTS5 + Vec) ──
    case 'find':
    case 'search': {
      const { type, tags, stato, query, name_id, doc_id, limit = 10 } = input
      const maxLimit = Math.min(limit as number || 10, 50)

      // Detect search mode
      const hasStructuralFilters = type || tags?.length || stato || name_id
      const queryStr = (query || '') as string
      const isDocContentSearch = doc_id || /Art\.\s*\d+|definizione|clausola|articolo|contenuto|capitolo/i.test(queryStr)
      const isSemanticQuery = /simil|correlat|settore|argomento|come|riguard|tipo di|relazionat/i.test(queryStr)

      // MODE 1: SQL (structural filters)
      if (hasStructuralFilters || !queryStr) {
        let sql = 'SELECT e.id, e.type, e.display_name, e.slug, e.stato, e.email, e.telefono, e.tags, e.name_id, e.parent_id, e.file_url, e.numero, e.data, e.totale, e.categoria, e.metadata, e.path, e.created_at FROM entity e WHERE e.azienda_id = ? AND e.deleted_at IS NULL'
        const params: any[] = [aziendaId]
        if (type) { sql += ' AND e.type = ?'; params.push(type) }
        if (tags?.length) { for (const tag of tags) { sql += " AND e.tags LIKE ?"; params.push(`%"${tag}"%`) } }
        if (stato) { sql += ' AND e.stato = ?'; params.push(stato) }
        if (name_id) { sql += ' AND e.name_id = ?'; params.push(name_id) }
        if (queryStr) {
          const words = queryStr.split(/\s+/).filter((w: string) => w.length > 1)
          const fields = "(e.display_name LIKE ? OR e.email LIKE ? OR e.categoria LIKE ? OR e.tags LIKE ?)"
          if (words.length <= 1) { sql += ` AND ${fields}`; const q = `%${queryStr}%`; params.push(q, q, q, q) }
          else { sql += ` AND (${words.map(() => fields).join(' OR ')})`; for (const w of words) { const q = `%${w}%`; params.push(q, q, q, q) } }
        }
        if (!type || type !== 'chunk') sql += " AND e.type NOT IN ('chat_message','chat_session','chunk','agent_log','workflow_log')"
        sql += ` ORDER BY e.created_at DESC LIMIT ${maxLimit}`
        return parseRows(db.prepare(sql).all(...params))
      }

      // MODE 2: FTS5 (document content / keyword search)
      if (isDocContentSearch) {
        // Delegate to retrieve tool logic (chunk FTS5 search)
        return executeTool('retrieve', aziendaId, { query: queryStr, doc_id, limit: maxLimit })
      }

      // MODE 3: Semantic (vector similarity)
      if (isSemanticQuery) {
        try {
          const { semanticSearch } = await import('../embeddings.js')
          const vecResults = await semanticSearch(queryStr, aziendaId, type as string, maxLimit)
          if (vecResults.length > 0) {
            return vecResults.map(r => {
              const parsed = parseRow(r)
              return { ...parsed, similarity: r.similarity?.toFixed(3) }
            })
          }
        } catch {}
        // Fallback to SQL if vec fails
      }

      // MODE 4: Hybrid (SQL LIKE + optional Vec rerank)
      let sql = 'SELECT e.id, e.type, e.display_name, e.slug, e.stato, e.email, e.telefono, e.tags, e.categoria, e.metadata, e.path, e.created_at FROM entity e WHERE e.azienda_id = ?'
      const params: any[] = [aziendaId]
      const words = queryStr.split(/\s+/).filter((w: string) => w.length > 1)
      const fields = "(e.display_name LIKE ? OR e.email LIKE ? OR e.categoria LIKE ? OR e.tags LIKE ?)"
      if (words.length <= 1) { sql += ` AND ${fields}`; const q = `%${queryStr}%`; params.push(q, q, q, q) }
      else { sql += ` AND (${words.map(() => fields).join(' OR ')})`; for (const w of words) { const q = `%${w}%`; params.push(q, q, q, q) } }
      sql += " AND e.type NOT IN ('chat_message','chat_session','chunk','agent_log','workflow_log')"
      sql += ` ORDER BY e.created_at DESC LIMIT ${maxLimit}`
      return parseRows(db.prepare(sql).all(...params))
    }

    // ── CREATE (unified — everything is entity) ──
    case 'create': {
      const id = crypto.randomUUID()
      const slug = slugify(input.display_name || 'unnamed')
      const type = input.type || 'persona'
      const tags = input.tags ? JSON.stringify(input.tags) : '[]'

      // Resolve path
      let entityPath = `/entity/${type}/${slug}`
      if (input.parent_id) {
        const parentPath = (db.prepare("SELECT path FROM entity WHERE id = ?").get(input.parent_id) as any)?.path
        if (parentPath) entityPath = `${parentPath}/${slug}`
      } else if (input.name_id) {
        const parentSlug = (db.prepare("SELECT slug FROM entity WHERE id = ?").get(input.name_id) as any)?.slug
        if (parentSlug) entityPath = `/entity/${parentSlug}/${type}/${slug}`
      }

      db.prepare(`INSERT INTO entity (id, azienda_id, type, display_name, slug, stato, email, telefono, tags, name_id, parent_id, user_id, file_url, numero, data, totale, metadata, path)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, aziendaId, type, input.display_name, slug,
        input.stato || null, input.email || null, input.telefono || null, tags,
        input.name_id || null, input.parent_id || null,
        input.user_id || null, input.file_url || null,
        input.numero || null, input.data || null, input.totale || null,
        JSON.stringify(input.metadata || {}), entityPath
      )

      // Emit events
      emit(`entity_created:${type}`, { aziendaId, recordId: id, recordType: 'entity', entityType: type, tags: input.tags })
      auditLog(id, type, 'create', null, { display_name: input.display_name, type, tags: input.tags })

      return { successo: true, id, type, display_name: input.display_name, tags: input.tags, messaggio: `"${input.display_name}" creato` }
    }

    // ── UPDATE ──
    case 'update': {
      if (!input.id) return { errore: 'id obbligatorio' }

      const existing = db.prepare('SELECT metadata FROM entity WHERE id = ? AND azienda_id = ?').get(input.id, aziendaId) as any
      if (!existing) return { errore: 'Record non trovato' }

      const updates: string[] = []
      const values: any[] = []

      if (input.display_name) { updates.push('display_name = ?'); values.push(input.display_name); updates.push('slug = ?'); values.push(slugify(input.display_name)) }
      if (input.stato !== undefined) { updates.push('stato = ?'); values.push(input.stato) }
      if (input.tags) { updates.push('tags = ?'); values.push(JSON.stringify(input.tags)) }
      if (input.email !== undefined) { updates.push('email = ?'); values.push(input.email || null) }
      if (input.telefono !== undefined) { updates.push('telefono = ?'); values.push(input.telefono || null) }

      // Merge metadata
      if (input.metadata) {
        const oldMeta = typeof existing.metadata === 'string' ? JSON.parse(existing.metadata) : (existing.metadata || {})
        const newMeta = { ...oldMeta, ...input.metadata }
        updates.push('metadata = ?'); values.push(JSON.stringify(newMeta))
      }

      updates.push("updated_at = datetime('now')")
      if (updates.length === 1) return { errore: 'Nessun campo da aggiornare' }

      values.push(input.id, aziendaId)
      db.prepare(`UPDATE entity SET ${updates.join(', ')} WHERE id = ? AND azienda_id = ?`).run(...values)

      const afterRecord = db.prepare('SELECT display_name, type, stato, tags, metadata FROM entity WHERE id = ?').get(input.id) as any
      auditLog(input.id, afterRecord?.type, 'update', { metadata: existing.metadata }, afterRecord)

      return { successo: true, messaggio: `Record aggiornato` }
    }

    // ── DELETE ──
    case 'delete_record': {
      if (!input.id) return { errore: 'id obbligatorio' }
      const target = db.prepare('SELECT display_name, type FROM entity WHERE id = ? AND azienda_id = ? AND deleted_at IS NULL').get(input.id, aziendaId) as any
      if (!target) return { errore: 'Record non trovato' }

      const now = new Date().toISOString()
      if (input.permanent === true) {
        // Hard delete — only when explicitly requested
        const children = db.prepare('DELETE FROM entity WHERE parent_id = ?').run(input.id)
        try { db.prepare('DELETE FROM chunk_vec WHERE chunk_id IN (SELECT id FROM entity WHERE parent_id = ?)').run(input.id) } catch {}
        db.prepare('DELETE FROM entity WHERE id = ? AND azienda_id = ?').run(input.id, aziendaId)
        db.prepare("DELETE FROM relations WHERE from_id = ? OR to_id = ?").run(input.id, input.id)
        auditLog(input.id, target.type, 'hard_delete', { display_name: target.display_name }, null)
        const msg = children.changes > 0
          ? `"${target.display_name}" eliminato permanentemente con ${children.changes} elementi collegati`
          : `"${target.display_name}" eliminato permanentemente`
        return { successo: true, messaggio: msg }
      } else {
        // Soft delete — default behavior
        db.prepare("UPDATE entity SET deleted_at = ?, updated_at = ? WHERE id = ? AND azienda_id = ?").run(now, now, input.id, aziendaId)
        const children = db.prepare("UPDATE entity SET deleted_at = ?, updated_at = ? WHERE parent_id = ? AND deleted_at IS NULL").run(now, now, input.id)
        auditLog(input.id, target.type, 'soft_delete', { display_name: target.display_name }, null)
        const msg = children.changes > 0
          ? `"${target.display_name}" archiviato con ${children.changes} elementi collegati (recuperabile)`
          : `"${target.display_name}" archiviato (recuperabile)`
        return { successo: true, messaggio: msg }
      }
    }

    // ── RELATE ──
    case 'relate': {
      if (!input.from_id || !input.to_id || !input.tipo) return { errore: 'from_id, to_id e tipo obbligatori' }
      const fromExists = db.prepare("SELECT id FROM entity WHERE id = ?").get(input.from_id)
      const toExists = db.prepare("SELECT id FROM entity WHERE id = ?").get(input.to_id)
      if (!fromExists) return { errore: 'from_id non trovato' }
      if (!toExists) return { errore: 'to_id non trovato' }

      db.prepare(`INSERT OR IGNORE INTO relations (id, azienda_id, from_id, to_id, tipo, metadata)
        VALUES (?, ?, ?, ?, ?, '{}')`).run(
        crypto.randomUUID(), aziendaId, input.from_id, input.to_id, input.tipo
      )
      return { successo: true, messaggio: `Relazione "${input.tipo}" creata` }
    }

    // ── GET_TREE ──
    case 'get_tree': {
      if (!input.id) return { errore: 'id obbligatorio' }

      // Try by id first, then by numero/slug as fallback
      let record = parseRow(db.prepare("SELECT * FROM entity WHERE id = ?").get(input.id))
      if (!record) {
        record = parseRow(db.prepare("SELECT * FROM entity WHERE numero = ? OR slug = ? LIMIT 1").get(input.id, input.id))
      }
      if (!record) return { errore: 'Record non trovato' }

      // Get children (by parent_id or name_id)
      const childrenByParent = parseRows(db.prepare("SELECT id, type, display_name, stato, numero, totale, data, metadata FROM entity WHERE parent_id = ? ORDER BY ordine, created_at").all(input.id))
      const childrenByNameId = parseRows(db.prepare("SELECT id, type, display_name, stato, numero, totale, data, metadata FROM entity WHERE name_id = ? AND id != ? ORDER BY type, created_at DESC LIMIT 50").all(input.id, input.id))
      const children = [...childrenByParent, ...childrenByNameId]

      // Get relations
      const relationsFrom = db.prepare("SELECT to_id, tipo FROM relations WHERE from_id = ?").all(input.id) as any[]
      const relationsTo = db.prepare("SELECT from_id, tipo FROM relations WHERE to_id = ?").all(input.id) as any[]

      return {
        record,
        children,
        relations: {
          outgoing: relationsFrom,
          incoming: relationsTo,
        }
      }
    }

    // ── RENDER_VIEW ──
    case 'render_view': {
      // Pass-through: the layout descriptor is returned as-is to the frontend
      return { layout: input.layout }
    }

    // ── AUTONOMOUS AGENTS ──
    case 'create_autonomous_agent': {
      // Guided creation: collect missing fields and return a helpful guide
      const missing: string[] = []
      const guide: Record<string, string> = {}

      if (!input.name) {
        missing.push('name')
        guide.name = 'Nome dell\'agente (es. "Monitor Fatture", "Saluti Mattutini")'
      }
      // agentDomain: auto-detect from prompt if not specified
      if (!input.agentDomain && input.promptTemplate) {
        const pt = (input.promptTemplate as string).toLowerCase()
        if (/whatsapp|messaggio|invia.*a\s/.test(pt)) input.agentDomain = 'whatsapp'
        else if (/fattur|scaden|pagament|conto|saldo/.test(pt)) input.agentDomain = 'amministrazione'
        else if (/client|lead|pipeline|vendite/.test(pt)) input.agentDomain = 'commerciale'
        else if (/candidat|annunci|cv|recruiting/.test(pt)) input.agentDomain = 'hr'
        else if (/progett|ordin|milestone/.test(pt)) input.agentDomain = 'produzione'
        else if (/document|contratt|normat|articol/.test(pt)) input.agentDomain = 'documentale'
        else if (/immagin|campagna|brand|content/.test(pt)) input.agentDomain = 'marketing'
        else input.agentDomain = 'pulse' // default
      }
      if (!input.agentDomain && !input.promptTemplate) {
        missing.push('agentDomain')
        guide.agentDomain = 'Dominio agente (opzionale — viene dedotto dal prompt). Opzioni: pulse, commerciale, amministrazione, hr, whatsapp, documentale, etc.'
      }
      if (!input.promptTemplate) {
        missing.push('promptTemplate')
        guide.promptTemplate = 'Istruzione che l\'agente eseguirà ad ogni attivazione. Es: "Cerca tutte le fatture in scadenza nei prossimi 7 giorni e genera un riepilogo"'
      }
      if (!input.trigger_type || !['cron', 'event'].includes(input.trigger_type)) {
        missing.push('trigger_type')
        guide.trigger_type = 'Tipo di attivazione: "cron" (schedulato) o "event" (reattivo a eventi)'
      }
      if (input.trigger_type === 'cron') {
        if (!input.cron) {
          missing.push('cron')
          guide.cron = 'Espressione cron (5 campi: minuto ora giorno mese giorno_settimana). Esempi:\n' +
            '"* * * * *" = ogni minuto\n' +
            '"*/5 * * * *" = ogni 5 minuti\n' +
            '"0 8 * * *" = ogni giorno alle 8:00\n' +
            '"0 9 * * 1" = ogni lunedì alle 9:00\n' +
            '"0 8 1 * *" = il 1° di ogni mese alle 8:00'
        } else {
          // Validate cron format (5 fields)
          const cronParts = (input.cron as string).trim().split(/\s+/)
          if (cronParts.length !== 5) {
            missing.push('cron')
            guide.cron = `Formato cron non valido: "${input.cron}" ha ${cronParts.length} campi, servono 5 (minuto ora giorno mese giorno_settimana). Es: "0 8 * * *"`
          }
        }
      }
      if (input.trigger_type === 'event') {
        const VALID_EVENTS = [
          'entity_created:documento', 'entity_created:fattura', 'entity_created:ordine', 'entity_created:progetto',
          'name_created:lead', 'name_created:cliente', 'name_created:candidato', 'name_created:fornitore',
          'entity_created:*', 'name_created:*',
        ]
        if (!input.event) {
          missing.push('event')
          guide.event = 'Evento trigger. Eventi disponibili:\n' + VALID_EVENTS.map(e => `"${e}"`).join('\n')
        } else if (!VALID_EVENTS.some(v => v === input.event || (v.endsWith(':*') && (input.event as string).startsWith(v.replace(':*', ':'))))) {
          missing.push('event')
          guide.event = `Evento "${input.event}" non riconosciuto. Eventi disponibili:\n` + VALID_EVENTS.map(e => `"${e}"`).join('\n')
        }
      }

      if (missing.length > 0) {
        return {
          incompleto: true,
          messaggio: `Per creare l'agente autonomo servono questi dati:`,
          campi_mancanti: missing,
          guida: guide,
          campi_forniti: {
            ...(input.name ? { name: input.name } : {}),
            ...(input.agentDomain ? { agentDomain: input.agentDomain } : {}),
            ...(input.promptTemplate ? { promptTemplate: input.promptTemplate } : {}),
            ...(input.trigger_type ? { trigger_type: input.trigger_type } : {}),
            ...(input.cron ? { cron: input.cron } : {}),
            ...(input.event ? { event: input.event } : {}),
            ...(input.description ? { description: input.description } : {}),
          },
          esempio: {
            name: 'Monitor Fatture Scadute',
            agentDomain: 'amministrazione',
            promptTemplate: 'Controlla le fatture in scadenza nei prossimi 7 giorni e genera un riepilogo',
            trigger_type: 'cron',
            cron: '0 8 * * *',
            notify: ['chat'],
          },
        }
      }

      const { createAutonomousAgent } = await import('./autonomous.js')
      const agentId = createAutonomousAgent(aziendaId, {
        name: input.name,
        description: input.description || '',
        agentDomain: input.agentDomain,
        promptTemplate: input.promptTemplate,
        trigger: {
          type: input.trigger_type,
          cron: input.cron,
          event: input.event,
        },
        notifyChannels: input.notify || ['chat', 'whatsapp'],
        enabled: true,
      })
      return {
        successo: true,
        id: agentId,
        messaggio: `Agente autonomo "${input.name}" creato`,
        configurazione: {
          dominio: input.agentDomain,
          trigger: input.trigger_type === 'cron' ? `Schedulato: ${input.cron}` : `Evento: ${input.event}`,
          prompt: input.promptTemplate,
          notifiche: input.notify || ['chat', 'whatsapp'],
        },
      }
    }

    case 'list_autonomous_agents': {
      const { listAutonomousAgents } = await import('./autonomous.js')
      return listAutonomousAgents(aziendaId)
    }

    case 'toggle_autonomous_agent': {
      const { toggleAutonomousAgent } = await import('./autonomous.js')
      const ok = toggleAutonomousAgent(input.id, aziendaId, input.enabled)
      return ok ? { successo: true, messaggio: `Agente ${input.enabled ? 'attivato' : 'disattivato'}` } : { errore: 'Agente non trovato' }
    }

    case 'delete_autonomous_agent': {
      const { deleteAutonomousAgent } = await import('./autonomous.js')
      const ok = deleteAutonomousAgent(input.id, aziendaId)
      return ok ? { successo: true, messaggio: 'Agente eliminato' } : { errore: 'Agente non trovato' }
    }

    case 'get_agent_logs': {
      const { getAgentLogs } = await import('./autonomous.js')
      return getAgentLogs(aziendaId, input.agent_id, input.limit || 20)
    }

    // ── WORKFLOWS ──
    case 'create_workflow': {
      const { createWorkflow } = await import('./workflows.js')
      const wfId = createWorkflow(aziendaId, { name: input.name, description: input.description, steps: input.steps })
      return { successo: true, id: wfId, messaggio: `Workflow "${input.name}" creato con ${input.steps?.length || 0} step` }
    }

    case 'run_workflow': {
      const { runWorkflow } = await import('./workflows.js')
      const result = await runWorkflow(input.workflow_id, aziendaId)
      return { successo: true, risultato: result.synthesized?.substring(0, 1000) }
    }

    case 'list_workflows': {
      const { listWorkflows } = await import('./workflows.js')
      return listWorkflows(aziendaId)
    }

    // ── JOBS ──
    case 'create_job': {
      const { createJob } = await import('../jobs.js')
      const jobId = createJob(aziendaId, input.action, input.params || {}, {
        scheduledAt: input.scheduled_at,
        cron: input.cron,
      })
      return { successo: true, job_id: jobId, messaggio: `Job "${input.action}" creato${input.cron ? ' (ricorrente)' : input.scheduled_at ? ` (schedulato per ${input.scheduled_at})` : ''}` }
    }

    case 'get_jobs': {
      let sql = "SELECT id, display_name, stato, data, metadata, created_at, updated_at FROM entity WHERE type = 'job' AND azienda_id = ?"
      const params: any[] = [aziendaId]
      if (input.stato) { sql += ' AND stato = ?'; params.push(input.stato) }
      sql += ` ORDER BY created_at DESC LIMIT ${input.limit || 20}`
      const jobs = db.prepare(sql).all(...params) as any[]
      return jobs.map(j => {
        const m = typeof j.metadata === 'string' ? JSON.parse(j.metadata) : j.metadata
        return { id: j.id, action: m.action, stato: j.stato, scheduled: j.data, retry: m.retry_count, error: m.error, created: j.created_at }
      })
    }

    // ── TTS AGENT TOOLS ──
    case 'list_voices': {
      const TTS_BASE = (process.env.TTS_API_URL || 'http://host.docker.internal:7777/v1/audio/speech').replace('/v1/audio/speech', '')
      let builtinVoices = ['Vivian', 'Serena', 'Ryan', 'Dylan', 'Eric', 'Aiden']
      try {
        const vRes = await fetch(`${TTS_BASE}/v1/voices`, { signal: AbortSignal.timeout(5000) })
        if (vRes.ok) {
          const voices = await vRes.json()
          const names = (voices.voices || voices || []).map((v: any) => v.name || v)
          if (names.length > 0) builtinVoices = names
        }
      } catch {}
      // Cloned voices
      const UPLOADS_DIR = process.env.UPLOADS_DIR || '/app/data/uploads'
      const fs = await import('fs')
      const path = await import('path')
      let clonedVoices: string[] = []
      try {
        // Find user from aziendaId context — list all voice dirs
        const voiceDirs = fs.default.readdirSync(path.default.join(UPLOADS_DIR, aziendaId), { withFileTypes: true })
        for (const d of voiceDirs) {
          if (d.isDirectory()) {
            const vDir = path.default.join(UPLOADS_DIR, aziendaId, d.name, 'voices')
            if (fs.default.existsSync(vDir)) {
              clonedVoices.push(...fs.default.readdirSync(vDir).filter((f: string) => f.endsWith('.wav')).map((f: string) => f.replace('.wav', '')))
            }
          }
        }
      } catch {}
      return { builtin: builtinVoices, clonate: [...new Set(clonedVoices)] }
    }

    case 'set_voice': {
      const allVoices = ['Vivian', 'Serena', 'Ryan', 'Dylan', 'Eric', 'Aiden']
      // Check cloned voices too
      const fs = await import('fs')
      const path = await import('path')
      const UPLOADS_DIR = process.env.UPLOADS_DIR || '/app/data/uploads'
      try {
        const dirs = fs.default.readdirSync(path.default.join(UPLOADS_DIR, aziendaId), { withFileTypes: true })
        for (const d of dirs) {
          if (d.isDirectory()) {
            const vDir = path.default.join(UPLOADS_DIR, aziendaId, d.name, 'voices')
            if (fs.default.existsSync(vDir)) {
              allVoices.push(...fs.default.readdirSync(vDir).filter((f: string) => f.endsWith('.wav')).map((f: string) => f.replace('.wav', '')))
            }
          }
        }
      } catch {}
      const matched = allVoices.find(v => v.toLowerCase() === (input.voice_name as string).toLowerCase())
      if (!matched) return { errore: `Voce "${input.voice_name}" non trovata. Disponibili: ${allVoices.join(', ')}` }
      // Save in names metadata — find the user who is making the request
      const users = db.prepare("SELECT id FROM entity WHERE azienda_id = ? AND tags LIKE '%\"utente\"%'").all(aziendaId) as any[]
      for (const u of users) {
        db.prepare("UPDATE entity SET metadata = json_set(metadata, '$.tts_voice', ?) WHERE id = ?").run(matched, u.id)
      }
      return { successo: true, messaggio: `Voce impostata su ${matched}` }
    }

    case 'get_current_voice': {
      const users = db.prepare("SELECT display_name, json_extract(metadata, '$.tts_voice') as voice FROM entity WHERE azienda_id = ? AND tags LIKE '%\"utente\"%'").all(aziendaId) as any[]
      return users.map((u: any) => ({ utente: u.display_name, voce: u.voice || 'Vivian' }))
    }

    case 'clone_voice': {
      return { errore: 'Per clonare una voce, allega un audio nella chat e scrivi "clona voce [nome]".' }
    }

    // ── AGENTIC RAG RETRIEVE ──
    // ── SKILL & MEMORY MANAGEMENT ──
    case 'update_skill': {
      if (!input.domain) return { errore: 'domain obbligatorio' }
      const { AGENTS } = await import('./config.js')
      if (!AGENTS[input.domain as string]) return { errore: `Dominio "${input.domain}" non trovato` }

      // Find or create skill entity
      const existing = db.prepare(
        "SELECT id, metadata FROM entity WHERE type = 'skill' AND json_extract(metadata, '$.domain') = ? AND azienda_id = ?"
      ).get(input.domain, aziendaId) as any

      const skillData: Record<string, unknown> = {
        domain: input.domain,
        ...(existing ? JSON.parse(existing.metadata) : {}),
      }
      if (input.system_prompt) skillData.system_prompt = input.system_prompt
      if (input.rules) skillData.rules = input.rules
      if (input.model) skillData.model = input.model
      skillData.version = ((skillData.version as number) || 0) + 1
      skillData.updated_at = new Date().toISOString()

      if (existing) {
        db.prepare("UPDATE entity SET metadata = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(skillData), existing.id)
      } else {
        db.prepare(
          "INSERT INTO entity (id, azienda_id, type, display_name, slug, metadata, path, created_at, updated_at) VALUES (?, ?, 'skill', ?, ?, ?, ?, datetime('now'), datetime('now'))"
        ).run(crypto.randomUUID(), aziendaId, `Skill: ${input.domain}`, `skill-${input.domain}`, JSON.stringify(skillData), `/entity/skills/${input.domain}`)
      }

      return { successo: true, messaggio: `Skill "${input.domain}" aggiornata (v${skillData.version}). Riavvia per applicare le modifiche al system prompt.` }
    }

    case 'list_skills': {
      const { AGENTS } = await import('./config.js')
      return Object.entries(AGENTS).map(([domain, agent]) => ({
        domain,
        name: agent.name,
        model: agent.model || 'default (claude-haiku-4.5)',
        prompt_preview: agent.systemPrompt.substring(0, 100) + '...',
        color: agent.color,
        tools_count: agent.toolNames.length,
      }))
    }

    case 'add_agent_lesson': {
      if (!input.domain || !input.rule) return { errore: 'domain e rule obbligatori' }
      const { addAgentLesson } = await import('./context.js')
      addAgentLesson(aziendaId, input.domain as string, input.rule as string, 'istruzione utente')
      return { successo: true, messaggio: `Lezione aggiunta alla memoria di "${input.domain}": "${input.rule}"` }
    }

    // ── DOCUMENT MANAGEMENT ──
    case 'list_documents': {
      let sql = "SELECT id, display_name, categoria, json_extract(metadata,'$.tipo_file') as tipo_file, json_extract(metadata,'$.file_size') as file_size, json_extract(metadata,'$.chunked') as chunked, json_extract(metadata,'$.chunk_count') as chunk_count, json_extract(metadata,'$.total_chars') as total_chars, file_url, created_at FROM entity WHERE azienda_id = ? AND type IN ('documento','contratto','cv','report','normativa','fattura_passiva') AND type != 'chunk'"
      const params: any[] = [aziendaId]
      if (input.categoria) {
        sql += " AND categoria = ?"
        params.push(input.categoria)
      }
      sql += ' ORDER BY created_at DESC LIMIT 50'
      const docs = db.prepare(sql).all(...params) as any[]
      return docs.map(d => ({
        id: d.id,
        nome: d.display_name,
        categoria: d.categoria || 'altro',
        tipo_file: d.tipo_file,
        dimensione: d.file_size ? `${(d.file_size / 1024).toFixed(0)} KB` : 'N/D',
        chunkato: d.chunked ? `Sì (${d.chunk_count} sezioni, ${d.total_chars ? (d.total_chars / 1000).toFixed(0) + 'K chars' : ''})` : 'No',
        data: d.created_at?.slice(0, 10),
      }))
    }

    case 'explore_document': {
      const limit = Math.min(input.limit as number || 30, 100)
      const doc = db.prepare("SELECT display_name, metadata FROM entity WHERE id = ? AND azienda_id = ?").get(input.doc_id, aziendaId) as any
      if (!doc) return { errore: 'Documento non trovato' }
      const meta = typeof doc.metadata === 'string' ? JSON.parse(doc.metadata) : doc.metadata

      const chunks = db.prepare(
        "SELECT display_name, json_extract(metadata,'$.heading_path') as heading, json_extract(metadata,'$.chunk_index') as idx FROM entity WHERE parent_id = ? AND type = 'chunk' ORDER BY ordine LIMIT ?"
      ).all(input.doc_id, limit) as any[]

      // Group by unique headings for a clean TOC
      const toc: string[] = []
      const seen = new Set<string>()
      for (const c of chunks) {
        const heading = c.heading || c.display_name
        if (!seen.has(heading)) { seen.add(heading); toc.push(heading) }
      }

      return {
        documento: doc.display_name,
        categoria: meta.categoria,
        chunk_count: meta.chunk_count || chunks.length,
        total_chars: meta.total_chars,
        struttura: toc,
      }
    }

    case 'rechunk_document': {
      console.log('[rechunk] doc_id:', input.doc_id, 'aziendaId:', aziendaId)
      const doc = db.prepare("SELECT id, display_name, file_url, metadata FROM entity WHERE id = ? AND azienda_id = ?").get(input.doc_id, aziendaId) as any
      if (!doc) {
        console.log('[rechunk] Doc not found for id:', input.doc_id)
        return { errore: 'Documento non trovato' }
      }

      const UPLOADS_DIR = process.env.UPLOADS_DIR || '/app/data/uploads'
      const filePath = doc.file_url?.replace('/api/uploads/', UPLOADS_DIR + '/')
      const fs = await import('fs')
      console.log('[rechunk] filePath:', filePath, 'exists:', filePath ? fs.default.existsSync(filePath) : false)
      if (!filePath || !fs.default.existsSync(filePath)) return { errore: 'File non trovato su disco: ' + filePath }

      // Extract text
      const ext = filePath.split('.').pop()?.toLowerCase()
      let text = ''
      if (ext === 'pdf') {
        try {
          const { PDFParse } = await import('pdf-parse')
          const buf = fs.default.readFileSync(filePath)
          const uint8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
          const parser = new PDFParse(uint8, {})
          await parser.load()
          text = await parser.getText()
          if (typeof text !== 'string') {
            // Fallback: use pdfjs-dist directly
            const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
            const pdfDoc = await pdfjsLib.getDocument({ data: uint8, useSystemFonts: true }).promise
            text = ''
            for (let i = 1; i <= pdfDoc.numPages; i++) {
              const page = await pdfDoc.getPage(i)
              const content = await page.getTextContent()
              text += content.items.map((item: any) => item.str).join(' ') + '\n'
            }
          }
        } catch { return { errore: 'Errore estrazione testo dal PDF' } }
      } else if (ext === 'txt' || ext === 'csv') {
        text = fs.default.readFileSync(filePath, 'utf-8')
      } else if (ext === 'docx') {
        try {
          const mammoth = await import('mammoth')
          const result = await mammoth.default.extractRawText({ path: filePath })
          text = result.value || ''
        } catch { return { errore: 'Errore estrazione testo dal DOCX' } }
      } else {
        return { errore: `Tipo file .${ext} non supportato per il chunking` }
      }

      if (text.length < 100) return { errore: 'Testo estratto troppo corto per il chunking' }

      // Delete old chunks
      const deleted = db.prepare("DELETE FROM entity WHERE parent_id = ? AND type = 'chunk'").run(input.doc_id)

      // Chunk
      const { chunkDocument } = await import('../chunker.js')
      const meta = typeof doc.metadata === 'string' ? JSON.parse(doc.metadata) : doc.metadata
      const chunks = chunkDocument(text, meta.entity_type || 'documento', doc.display_name)

      if (chunks.length === 0) return { errore: 'Nessun chunk generato — il documento potrebbe essere troppo corto' }

      // Save chunks
      const chunkCrypto = await import('crypto')
      const stmt = db.prepare('INSERT INTO entity (id,azienda_id,type,display_name,slug,parent_id,body,metadata,path,ordine,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,datetime("now"),datetime("now"))')
      for (const c of chunks) {
        stmt.run(chunkCrypto.randomUUID(), aziendaId, 'chunk', c.display_name.substring(0, 200), 'chunk-' + c.chunk_index, input.doc_id,
          c.content,
          JSON.stringify({ chunk_index: c.chunk_index, chunk_total: chunks.length, heading_path: c.heading_path }),
          `/entity/documento/${doc.display_name}/chunks/chunk-${c.chunk_index}`, c.chunk_index)
      }

      // Update parent metadata
      db.prepare("UPDATE entity SET metadata = json_set(metadata, '$.chunked', 1, '$.chunk_count', ?, '$.total_chars', ?) WHERE id = ?").run(chunks.length, text.length, input.doc_id)

      // Rebuild FTS
      try { db.exec("INSERT INTO chunk_fts(chunk_fts) VALUES('rebuild')") } catch {}

      return { successo: true, messaggio: `"${doc.display_name}" ri-chunkato: ${chunks.length} sezioni (${deleted.changes} vecchi chunk eliminati)` }
    }

    case 'reclassify_document': {
      const doc = db.prepare("SELECT id FROM entity WHERE id = ? AND azienda_id = ?").get(input.doc_id, aziendaId)
      if (!doc) return { errore: 'Documento non trovato' }
      const updates: string[] = []
      if (input.display_name) { db.prepare("UPDATE entity SET display_name = ? WHERE id = ?").run(input.display_name, input.doc_id); updates.push('nome') }
      if (input.categoria) { db.prepare("UPDATE entity SET metadata = json_set(metadata, '$.categoria', ?) WHERE id = ?").run(input.categoria, input.doc_id); updates.push('categoria') }
      if (input.tags) { db.prepare("UPDATE entity SET metadata = json_set(metadata, '$.tags', ?) WHERE id = ?").run(JSON.stringify(input.tags), input.doc_id); updates.push('tags') }
      return { successo: true, messaggio: `Documento aggiornato (${updates.join(', ')})` }
    }

    // ── AGENTIC RAG RETRIEVE ──
    case 'retrieve': {
      const limit = Math.min(input.limit as number || 5, 10)
      // Truncate query to max 3 significant words — long queries cause FTS5 AND to return 0
      const rawQuery = input.query as string
      const queryWords = rawQuery.split(/\s+/).filter((w: string) => w.length > 2)
      const query = queryWords.length > 3 ? queryWords.slice(0, 3).join(' ') : rawQuery
      if (query !== rawQuery) console.log(`[Retrieve] Query truncated: "${rawQuery.substring(0, 40)}" → "${query}"`)
      const allChunks = new Map<string, any>()

      const ftsSearch = (q: string) => {
        try {
          let sql = `SELECT e.id, e.display_name, e.parent_id,
            e.body as contenuto_testo,
            json_extract(e.metadata, '$.heading_path') as heading_path,
            json_extract(e.metadata, '$.chunk_index') as chunk_index,
            parent.display_name as document_name, rank
            FROM chunk_fts fts
            JOIN entity e ON e.rowid = fts.rowid
            JOIN entity parent ON e.parent_id = parent.id
            WHERE chunk_fts MATCH ?
              AND parent.azienda_id = ?`
          const params: any[] = [q, aziendaId]
          if (input.doc_id) { sql += ' AND e.parent_id = ?'; params.push(input.doc_id) }
          sql += ` ORDER BY rank LIMIT ${limit}`
          return db.prepare(sql).all(...params) as any[]
        } catch { return [] }
      }

      // Livello 1: FTS diretto (~5ms)
      const directResults = ftsSearch(query)
      for (const r of directResults) allChunks.set(r.id, r)

      const bestRank = directResults.length > 0 ? Math.abs(directResults[0].rank || 0) : 0
      const threshold = input.doc_id ? 2 : 5
      const hasGoodResults = directResults.length >= 3 && bestRank > threshold

      if (hasGoodResults) {
        console.log(`[Retrieve] L1 fast: ${directResults.length} results, rank=${bestRank.toFixed(1)}`)
      }

      if (!hasGoodResults && allChunks.size < limit) {
        // Livello 2: Coppie adiacenti first (more precise), then single words
        const words = query.split(/\s+/).filter((w: string) => w.length > 2)
        // Coppie adiacenti — most relevant
        for (let i = 0; i < words.length - 1 && allChunks.size < limit * 3; i++) {
          try {
            for (const row of ftsSearch(`"${words[i]} ${words[i + 1]}"`)) allChunks.set(row.id, row)
          } catch {}
        }
        // Single words only if still not enough, cap at limit*3
        if (allChunks.size < limit) {
          for (const w of words) {
            if (allChunks.size >= limit * 3) break
            for (const row of ftsSearch(w)) allChunks.set(row.id, row)
          }
        }
        if (allChunks.size > 0) {
          console.log(`[Retrieve] L2 words: ${allChunks.size} results (capped)`)
        }
      }

      // Livello 3: LLM variants con cache (solo se 0 risultati)
      if (allChunks.size === 0) {
        const cacheKey = query.toLowerCase().trim()
        const cached = retrieveCache.get(cacheKey)
        let variants: string[]

        if (cached && Date.now() - cached.ts < RETRIEVE_CACHE_TTL) {
          variants = cached.variants
          console.log(`[Retrieve] L3 cache hit for "${query}"`)
        } else {
          try {
            const { generateSearchQueries } = await import('../ai.js')
            variants = await generateSearchQueries(query)
            retrieveCache.set(cacheKey, { variants, ts: Date.now() })
            console.log(`[Retrieve] L3 LLM variants for "${query}":`, variants)
          } catch {
            variants = [query]
          }
        }

        for (const v of variants.slice(0, 3)) {
          for (const row of ftsSearch(v)) allChunks.set(row.id, row)
        }
      }

      // Tag-based search: find chunks whose tags match query keywords
      if (allChunks.size < limit * 2) {
        const queryWords = query.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3)
        if (queryWords.length > 0) {
          try {
            const tagConditions = queryWords.map(() => "e.tags LIKE ?").join(' OR ')
            let tagSql = `SELECT e.id, e.display_name, e.parent_id, e.body as contenuto_testo,
              json_extract(e.metadata, '$.heading_path') as heading_path,
              json_extract(e.metadata, '$.chunk_index') as chunk_index,
              parent.display_name as document_name
              FROM entity e
              JOIN entity parent ON e.parent_id = parent.id
              WHERE e.type = 'chunk' AND parent.azienda_id = ? AND (${tagConditions})`
            const tagParams: any[] = [aziendaId, ...queryWords.map((w: string) => `%${w}%`)]
            if (input.doc_id) { tagSql += ' AND e.parent_id = ?'; tagParams.push(input.doc_id) }
            tagSql += ` LIMIT ${limit * 2}`
            const tagResults = db.prepare(tagSql).all(...tagParams) as any[]
            for (const r of tagResults) allChunks.set(r.id, r)
            if (tagResults.length > 0) console.log(`[Retrieve] Tags: +${tagResults.length} results`)
          } catch {}
        }
      }

      // Deduplicate: if multiple chunks have very similar display_name, keep best rank
      const seen = new Map<string, any>()
      for (const r of allChunks.values()) {
        // Normalize: extract article number for dedup key
        const artMatch = (r.display_name || '').match(/Art\.\s*(\d+)/)
        const key = artMatch ? `art_${artMatch[1]}` : (r.display_name || '').substring(0, 40)
        const existing = seen.get(key)
        if (!existing || (r.rank && existing.rank && r.rank < existing.rank)) {
          seen.set(key, r)
        }
      }
      let results = Array.from(seen.values())

      // ALWAYS run semantic search — best quality, finds synonyms/paraphrases
      {
        try {
          const { semanticChunkSearch } = await import('../embeddings.js')
          console.log(`[Retrieve] Running semantic search for "${query.substring(0, 40)}"...`)
          const semanticResults = await semanticChunkSearch(query, aziendaId, input.doc_id as string, limit)
          let added = 0
          for (const sr of semanticResults) {
            const key = sr.display_name?.substring(0, 40) || sr.id || sr.chunk_id
            if (!seen.has(key)) {
              seen.set(key, sr)
              results.push(sr)
              added++
            }
          }
          if (semanticResults.length > 0) {
            console.log(`[Retrieve] Semantic: ${semanticResults.length} found, +${added} new (total: ${results.length})`)
          }
        } catch (err) {
          console.warn('[Retrieve] Semantic fallback failed:', (err as Error).message)
        }
      }

      results = results.slice(0, limit)

      return results.map((r: any) => ({
        chunk_id: r.id,
        documento: r.document_name,
        sezione: r.heading_path || r.display_name,
        testo: r.contenuto_testo || r.body,
        indice: r.chunk_index,
      }))
    }

    // ── GENERATE TTS (for chat playback, not WhatsApp) ──
    case 'generate_tts': {
      try {
        const fs = await import('fs')
        const path = await import('path')
        const TTS_API_URL = process.env.TTS_API_URL || 'http://host.docker.internal:7777/v1/audio/speech'
        const UPLOADS_DIR = process.env.UPLOADS_DIR || '/app/data/uploads'

        // Get user voice preference
        const userVoice = (db.prepare("SELECT json_extract(metadata, '$.tts_voice') as v FROM entity WHERE id = ?").get(aziendaId) as any)?.v || input.voice || 'Vivian'

        const ttsRes = await fetch(TTS_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'tts-1',
            voice: userVoice,
            input: (input.text as string).substring(0, 500),
            response_format: 'mp3',
            speed: 1.0,
          }),
        })

        if (!ttsRes.ok) throw new Error(`TTS error: ${ttsRes.status}`)

        const audioDir = path.default.join(UPLOADS_DIR, 'generated')
        fs.default.mkdirSync(audioDir, { recursive: true })
        const filename = `tts-${crypto.randomUUID()}.mp3`
        const filePath = path.default.join(audioDir, filename)
        fs.default.writeFileSync(filePath, Buffer.from(await ttsRes.arrayBuffer()))

        return {
          successo: true,
          audio_url: `/api/uploads/generated/${filename}`,
          file_path: filePath,
          messaggio: `Audio generato: "${(input.text as string).substring(0, 50)}..."`,
        }
      } catch (err: any) {
        return { successo: false, messaggio: err.message }
      }
    }

    // ── DATE/TIME ──
    case 'get_datetime': {
      // City name → IANA timezone mapping
      const cityToTz: Record<string, string> = {
        'roma': 'Europe/Rome', 'milano': 'Europe/Rome', 'napoli': 'Europe/Rome', 'torino': 'Europe/Rome', 'parma': 'Europe/Rome',
        'londra': 'Europe/London', 'london': 'Europe/London',
        'parigi': 'Europe/Paris', 'paris': 'Europe/Paris',
        'berlino': 'Europe/Berlin', 'berlin': 'Europe/Berlin',
        'madrid': 'Europe/Madrid',
        'new york': 'America/New_York', 'newyork': 'America/New_York',
        'los angeles': 'America/Los_Angeles', 'losangeles': 'America/Los_Angeles',
        'chicago': 'America/Chicago',
        'tokyo': 'Asia/Tokyo',
        'pechino': 'Asia/Shanghai', 'shanghai': 'Asia/Shanghai', 'beijing': 'Asia/Shanghai',
        'dubai': 'Asia/Dubai',
        'sydney': 'Australia/Sydney',
        'mosca': 'Europe/Moscow', 'moscow': 'Europe/Moscow',
        'mumbai': 'Asia/Kolkata', 'delhi': 'Asia/Kolkata',
        'san paolo': 'America/Sao_Paulo', 'sao paulo': 'America/Sao_Paulo',
        'singapore': 'Asia/Singapore',
        'hong kong': 'Asia/Hong_Kong', 'hongkong': 'Asia/Hong_Kong',
        'seoul': 'Asia/Seoul',
        'istanbul': 'Europe/Istanbul',
        'cairo': 'Africa/Cairo',
      }

      const tz = input.timezone
        ? (cityToTz[(input.timezone as string).toLowerCase()] || input.timezone as string)
        : 'Europe/Rome'

      const now = new Date()
      const formatter = new Intl.DateTimeFormat('it-IT', {
        timeZone: tz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      })
      const parts = formatter.formatToParts(now)
      const get = (type: string) => parts.find(p => p.type === type)?.value || ''

      const dayOfWeek = get('weekday')
      const day = get('day')
      const month = get('month')
      const year = get('year')
      const hour = get('hour')
      const minute = get('minute')

      const result: Record<string, unknown> = {
        iso: now.toISOString(),
        data: `${day}/${(parts.findIndex(p => p.type === 'month') > -1 ? String(now.toLocaleDateString('it-IT', { timeZone: tz })) : '')}`,
        data_formattata: new Date().toLocaleDateString('it-IT', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' }),
        ora: `${hour}:${minute}`,
        giorno: dayOfWeek.charAt(0).toUpperCase() + dayOfWeek.slice(1),
        mese: month.charAt(0).toUpperCase() + month.slice(1),
        anno: parseInt(year),
        timezone: tz,
        timestamp: now.getTime(),
      }

      if (input.timezone) {
        result.citta = input.timezone
        // Calculate UTC offset
        const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }))
        const tzDate = new Date(now.toLocaleString('en-US', { timeZone: tz }))
        const offsetHours = (tzDate.getTime() - utcDate.getTime()) / 3600000
        result.utc_offset = `UTC${offsetHours >= 0 ? '+' : ''}${offsetHours}`
      }

      if (input.offset) {
        const off = input.offset as string
        let target = new Date(now)
        const giorni = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato']

        const dMatch = off.match(/^(-?\d+)d$/)
        const wMatch = off.match(/^(-?\d+)w$/)
        const mMatch = off.match(/^(-?\d+)m$/)

        if (dMatch) target.setDate(target.getDate() + parseInt(dMatch[1]))
        else if (wMatch) target.setDate(target.getDate() + parseInt(wMatch[1]) * 7)
        else if (mMatch) target.setMonth(target.getMonth() + parseInt(mMatch[1]))
        else if (off === 'next_monday') { target.setDate(target.getDate() + ((7 - target.getDay() + 1) % 7 || 7)) }
        else if (off === 'next_friday') { target.setDate(target.getDate() + ((7 - target.getDay() + 5) % 7 || 7)) }
        else if (off === 'end_month') { target = new Date(target.getFullYear(), target.getMonth() + 1, 0) }
        else if (off === 'start_month') { target = new Date(target.getFullYear(), target.getMonth(), 1) }
        else if (off === 'end_week') { target.setDate(target.getDate() + (7 - target.getDay())) }
        else if (off === 'start_week') { target.setDate(target.getDate() - target.getDay() + 1) }
        else if (off === 'end_year') { target = new Date(target.getFullYear(), 11, 31) }
        else if (off === 'start_year') { target = new Date(target.getFullYear(), 0, 1) }

        result.offset_data = target.toLocaleDateString('it-IT', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' })
        result.offset_giorno = giorni[target.getDay()]
        result.offset_label = off
      }

      return result
    }

    case 'date_diff': {
      const parseDate = (s: string) => s === 'today' ? new Date() : new Date(s)
      const from = parseDate(input.from as string)
      const to = parseDate(input.to as string)
      const diffMs = to.getTime() - from.getTime()
      const diffDays = Math.round(diffMs / 86400000)
      const diffWeeks = Math.round(diffDays / 7 * 10) / 10
      const diffMonths = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth())

      return {
        from: from.toISOString().split('T')[0],
        to: to.toISOString().split('T')[0],
        giorni: diffDays,
        settimane: diffWeeks,
        mesi: diffMonths,
        passato: diffDays < 0,
        label: diffDays === 0 ? 'oggi' : diffDays === 1 ? 'domani' : diffDays === -1 ? 'ieri' : diffDays > 0 ? `tra ${diffDays} giorni` : `${Math.abs(diffDays)} giorni fa`,
      }
    }

    // ══════════════════════════════════════════════════════
    // SPECIAL TOOLS (non-CRUD)
    // ══════════════════════════════════════════════════════

    case 'generate_image': {
      try {
        const fs = await import('fs')
        const path = await import('path')
        const imgRes = await fetch(OPENROUTER_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENROUTER_API_KEY}` },
          body: JSON.stringify({ model: 'google/gemini-3.1-flash-image-preview', messages: [{ role: 'user', content: input.prompt }], max_tokens: 4096 }),
        })
        const imgData = await imgRes.json()
        const images = imgData.choices?.[0]?.message?.images ?? []
        if (images.length > 0) {
          const imageUrl = images[0]?.image_url?.url || images[0]
          // Save image to disk for WhatsApp sending
          const UPLOADS_DIR = process.env.UPLOADS_DIR || '/app/data/uploads'
          const imgDir = path.default.join(UPLOADS_DIR, 'generated')
          fs.default.mkdirSync(imgDir, { recursive: true })
          const filename = `img-${crypto.randomUUID()}.png`
          const filePath = path.default.join(imgDir, filename)

          if (typeof imageUrl === 'string' && imageUrl.startsWith('data:')) {
            // Base64 data URL
            const base64 = imageUrl.split(',')[1]
            fs.default.writeFileSync(filePath, Buffer.from(base64, 'base64'))
          } else if (typeof imageUrl === 'string' && imageUrl.startsWith('http')) {
            // Remote URL — download
            try {
              const dlRes = await fetch(imageUrl)
              if (dlRes.ok) fs.default.writeFileSync(filePath, Buffer.from(await dlRes.arrayBuffer()))
            } catch {}
          }

          const savedPath = fs.default.existsSync(filePath) ? filePath : null
          return {
            successo: true,
            image_url: imageUrl,
            file_path: savedPath,
            api_url: `/api/uploads/generated/${filename}`,
            messaggio: 'Immagine generata'
          }
        }
        return { successo: false, messaggio: 'Nessuna immagine generata' }
      } catch (err: any) {
        return { successo: false, messaggio: err.message }
      }
    }

    case 'generate_pdf': {
      try {
        const fs = await import('fs')
        const path = await import('path')
        const crypto = await import('crypto')
        const { execSync } = await import('child_process')
        const UPLOADS_DIR = process.env.UPLOADS_DIR || '/app/data/uploads'
        const tmpDir = path.default.join(UPLOADS_DIR, 'tmp')
        if (!fs.default.existsSync(tmpDir)) fs.default.mkdirSync(tmpDir, { recursive: true })

        const fileId = crypto.default.randomUUID()
        const typFile = path.default.join(tmpDir, `${fileId}.typ`)
        const pdfFile = typFile.replace('.typ', '.pdf')

        // Build simple Typst document
        const titolo = (input.titolo || 'Documento').replace(/"/g, '\\"')
        const contenuto = (input.contenuto || '').replace(/\\/g, '\\\\')
        const typstSource = `#set page(margin: 2cm)\n#set text(font: "Liberation Sans", size: 11pt)\n\n= ${titolo}\n\n${contenuto}`
        fs.default.writeFileSync(typFile, typstSource)

        execSync(`typst compile "${typFile}" "${pdfFile}"`, { timeout: 30000, stdio: 'pipe' })

        // Move to uploads with proper path
        const destDir = path.default.join(UPLOADS_DIR, aziendaId, 'generated')
        if (!fs.default.existsSync(destDir)) fs.default.mkdirSync(destDir, { recursive: true })
        const destFile = path.default.join(destDir, `${fileId}.pdf`)
        fs.default.renameSync(pdfFile, destFile)
        try { fs.default.unlinkSync(typFile) } catch {}

        const fileUrl = `/api/uploads/${aziendaId}/generated/${fileId}.pdf`
        return { successo: true, messaggio: `PDF "${input.titolo}" generato`, file_url: fileUrl, filename: `${input.titolo}.pdf` }
      } catch (err: any) {
        return { errore: `Errore generazione PDF: ${err.message}` }
      }
    }

    case 'get_api_costs': {
      try {
        const res = await fetch('https://openrouter.ai/api/v1/auth/key', { headers: { 'Authorization': `Bearer ${OPENROUTER_API_KEY}` } })
        const data = await res.json()
        const d = data.data ?? {}
        return {
          totale_speso: `$${(d.usage ?? 0).toFixed(2)}`,
          speso_oggi: `$${(d.usage_daily ?? 0).toFixed(2)}`,
          speso_questo_mese: `$${(d.usage_monthly ?? 0).toFixed(2)}`,
          limite: d.limit ? `$${d.limit.toFixed(2)}` : 'Nessun limite',
          nota: 'Questi sono i COSTI sostenuti, non il credito residuo',
        }
      } catch { return { errore: 'Non disponibile' } }
    }

    case 'get_session_context': {
      const { sessionStatsCache } = await import('./base-agent.js')
      // Find stats: use provided session_id or find most recent
      let stats = input.session_id ? sessionStatsCache.get(input.session_id) : null
      if (!stats) {
        // Get the most recent session stats
        let latest: any = null
        for (const s of sessionStatsCache.values()) {
          if (!latest || s.updatedAt > latest.updatedAt) latest = s
        }
        stats = latest
      }
      if (!stats) return { errore: 'Nessuna sessione attiva trovata' }

      const remaining = stats.maxTokens - stats.totalTokensEstimate
      const bar = (pct: number) => {
        const filled = Math.round(pct / 5)
        return '█'.repeat(filled) + '░'.repeat(20 - filled)
      }

      return {
        sessione: stats.sessionId,
        agente: `${stats.agentName} (${stats.agentDomain})`,
        modello: stats.model,
        contesto: {
          system_prompt: `${stats.systemPromptChars.toLocaleString()} chars`,
          contesto_8_livelli: `${stats.contextChars.toLocaleString()} chars`,
          tool_definitions: `${stats.toolDefsCount} tools, ${stats.toolDefsChars.toLocaleString()} chars`,
          history: `${stats.historyMessages} messaggi, ${stats.historyChars.toLocaleString()} chars`,
          tool_exchanges: `${stats.toolExchanges} scambi, ${stats.toolResultsChars.toLocaleString()} chars risultati`,
        },
        token: {
          usati: `~${stats.totalTokensEstimate.toLocaleString()}`,
          massimo: stats.maxTokens.toLocaleString(),
          rimanenti: `~${remaining.toLocaleString()}`,
          percentuale_usata: `${stats.usagePercent}%`,
          percentuale_rimanente: `${100 - stats.usagePercent}%`,
          barra: `${bar(stats.usagePercent)} ${stats.usagePercent}%`,
        },
        loop: {
          usati: stats.loopsUsed,
          rimanenti: stats.loopsRemaining,
          tool_exchange_prunati: stats.prunedExchanges,
        },
        costi_api: {
          token_api_totali: stats.totalApiTokens,
          costo_totale: `$${stats.totalApiCost.toFixed(4)}`,
        },
      }
    }

    case 'inspect_system': {
      const { AGENTS } = await import('./config.js')

      // Detail for a specific tool
      if (input.tool_name) {
        const toolDef = TOOL_DEFINITIONS[input.tool_name as string]
        if (!toolDef) return { errore: `Tool "${input.tool_name}" non trovato` }
        const fn = (toolDef as any).function
        // Find which agents use this tool
        const usedBy = Object.entries(AGENTS)
          .filter(([_, a]) => a.toolNames.includes(input.tool_name as string))
          .map(([domain, a]) => ({ domain, agente: a.name }))
        return {
          nome: fn.name,
          descrizione: fn.description,
          parametri: fn.parameters?.properties || {},
          required: fn.parameters?.required || [],
          usato_da: usedBy,
        }
      }

      // Detail for a specific agent
      if (input.agent_domain) {
        const agent = AGENTS[input.agent_domain as string]
        if (!agent) return { errore: `Agente "${input.agent_domain}" non trovato. Disponibili: ${Object.keys(AGENTS).join(', ')}` }
        return {
          nome: agent.name,
          dominio: agent.domain,
          colore: agent.color,
          modello: agent.model || 'default (anthropic/claude-haiku-4.5)',
          system_prompt: agent.systemPrompt,
          tools: agent.toolNames.map(tn => {
            const td = TOOL_DEFINITIONS[tn]
            return td ? { nome: tn, descrizione: (td as any).function?.description?.substring(0, 80) } : { nome: tn, descrizione: '(non trovato)' }
          }),
          views: agent.views ? Object.keys(agent.views) : [],
        }
      }

      // Overview: list all agents with their tools
      const agentList = Object.entries(AGENTS).map(([domain, agent]) => ({
        dominio: domain,
        nome: agent.name,
        colore: agent.color,
        modello: agent.model || 'default',
        tools_count: agent.toolNames.length,
        tools: agent.toolNames,
      }))

      const allToolNames = new Set<string>()
      for (const a of Object.values(AGENTS)) {
        for (const t of a.toolNames) allToolNames.add(t)
      }

      return {
        agenti: agentList,
        totale_agenti: agentList.length,
        tools_unici: allToolNames.size,
        tutti_i_tools: [...allToolNames].sort(),
      }
    }

    case 'get_whatsapp_status': {
      try {
        const res = await fetch(`http://localhost:${process.env.PORT || 3001}/api/whatsapp/status`, {
          headers: { 'Authorization': `Bearer ${jwt.sign({ userId: 'system', email: 'system' }, JWT_SECRET, { expiresIn: '1m' })}` }
        })
        return await res.json()
      } catch { return { stato: 'Non disponibile' } }
    }

    case 'send_whatsapp_voice': {
      try {
        const { sendVoiceNote } = await import('../whatsapp.js')
        const phone = input.phone.replace(/\D/g, '')
        const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`
        await sendVoiceNote(jid, input.text, input.voice || 'Vivian')
        return { successo: true, messaggio: `Vocale inviato a ${phone}` }
      } catch (err: any) {
        return { successo: false, messaggio: err.message }
      }
    }

    case 'send_whatsapp_message': {
      try {
        console.log(`[WhatsApp] send_whatsapp_message called: phone=${input.phone}, text=${(input.text || '').substring(0, 50)}`)
        const msgText = (input.text || '') as string
        if (!msgText.trim()) {
          return { errore: 'Testo del messaggio mancante. Specifica cosa vuoi inviare.' }
        }
        // Prevent sending internal agent reasoning as WhatsApp message
        if (/^(Non ho trovato|Mi dispiace|Non posso|Errore|quale messaggio vuoi)/i.test(msgText.trim())) {
          return { errore: `Il testo sembra una risposta interna, non un messaggio da inviare. Chiedi all'utente quale testo vuole inviare.` }
        }
        const whatsapp = await import('../whatsapp.js')
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

    case 'send_whatsapp_image': {
      try {
        const whatsapp = await import('../whatsapp.js')
        const fs = await import('fs')
        const phone = input.phone.replace(/\D/g, '')
        const jid = `${phone}@s.whatsapp.net`
        const sock = (whatsapp as any).getSock?.()
        if (!sock) throw new Error('WhatsApp non connesso')

        let imagePayload: any
        let url = (input.url || '') as string

        // If URL is empty or invalid, check if there's a file_path
        if (!url || url === 'undefined' || url === 'null') {
          // Try to find the most recently generated image
          const genDir = (process.env.UPLOADS_DIR || '/app/data/uploads') + '/generated'
          if (fs.default.existsSync(genDir)) {
            const files = fs.default.readdirSync(genDir).filter((f: string) => f.endsWith('.png') || f.endsWith('.jpg')).sort().reverse()
            if (files.length > 0) url = genDir + '/' + files[0]
          }
        }

        if (url.startsWith('data:')) {
          // Base64 data URL → buffer
          const base64 = url.split(',')[1]
          imagePayload = Buffer.from(base64, 'base64')
        } else if (url.startsWith('/app/') || url.startsWith('./')) {
          // Local file path
          if (!fs.default.existsSync(url)) throw new Error(`File non trovato: ${url}`)
          imagePayload = fs.default.readFileSync(url)
        } else if (url.startsWith('/api/uploads/')) {
          // API path → convert to local file path
          const localPath = url.replace('/api/uploads/', (process.env.UPLOADS_DIR || '/app/data/uploads') + '/')
          if (!fs.default.existsSync(localPath)) throw new Error(`File non trovato: ${localPath}`)
          imagePayload = fs.default.readFileSync(localPath)
        } else {
          // Remote URL
          imagePayload = { url }
        }

        await sock.sendMessage(jid, { image: imagePayload, caption: input.caption || '' })
        return { successo: true, messaggio: `Immagine inviata a ${phone}` }
      } catch (err: any) {
        return { successo: false, messaggio: err.message }
      }
    }

    case 'send_whatsapp_document': {
      try {
        const whatsapp = await import('../whatsapp.js')
        const fs = await import('fs')
        const pathMod = await import('path')
        const phone = input.phone.replace(/\D/g, '')
        const jid = `${phone}@s.whatsapp.net`
        const sock = (whatsapp as any).getSock?.()
        if (!sock) throw new Error('WhatsApp non connesso')

        let url = input.url as string
        // Resolve /api/uploads/ paths to local
        if (url.startsWith('/api/uploads/')) {
          url = url.replace('/api/uploads/', (process.env.UPLOADS_DIR || '/app/data/uploads') + '/')
        }
        const fileName = input.filename || pathMod.default.basename(url)
        const ext = pathMod.default.extname(fileName).toLowerCase()
        const mimeMap: Record<string, string> = {
          '.pdf': 'application/pdf', '.doc': 'application/msword',
          '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          '.csv': 'text/csv', '.txt': 'text/plain', '.zip': 'application/zip',
          '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        }
        const mimetype = mimeMap[ext] || 'application/octet-stream'

        let docPayload: any
        if (url.startsWith('http')) {
          docPayload = { url }
        } else if (fs.default.existsSync(url)) {
          docPayload = fs.default.readFileSync(url)
        } else {
          throw new Error(`File non trovato: ${url}`)
        }

        await sock.sendMessage(jid, { document: docPayload, mimetype, fileName, caption: input.caption || '' })
        return { successo: true, messaggio: `Documento "${fileName}" inviato a ${phone}` }
      } catch (err: any) {
        return { successo: false, messaggio: err.message }
      }
    }

    case 'send_whatsapp_video': {
      try {
        const whatsapp = await import('../whatsapp.js')
        const fs = await import('fs')
        const phone = input.phone.replace(/\D/g, '')
        const jid = `${phone}@s.whatsapp.net`
        const sock = (whatsapp as any).getSock?.()
        if (!sock) throw new Error('WhatsApp non connesso')

        let url = input.url as string
        if (url.startsWith('/api/uploads/')) {
          url = url.replace('/api/uploads/', (process.env.UPLOADS_DIR || '/app/data/uploads') + '/')
        }

        let videoPayload: any
        if (url.startsWith('http')) {
          videoPayload = { url }
        } else if (fs.default.existsSync(url)) {
          videoPayload = fs.default.readFileSync(url)
        } else {
          throw new Error(`File non trovato: ${url}`)
        }

        await sock.sendMessage(jid, { video: videoPayload, caption: input.caption || '' })
        return { successo: true, messaggio: `Video inviato a ${phone}` }
      } catch (err: any) {
        return { successo: false, messaggio: err.message }
      }
    }

    // ── EMAIL ──

    case 'get_email_status': {
      try {
        const res = await fetch(`http://localhost:${process.env.PORT || 3001}/api/email/status`, {
          headers: { 'Authorization': `Bearer ${jwt.sign({ userId: 'system', email: 'system' }, JWT_SECRET, { expiresIn: '1m' })}` }
        })
        return await res.json()
      } catch { return { stato: 'Non disponibile' } }
    }

    case 'send_email': {
      try {
        const { sendEmail } = await import('../email.js')
        const result = await sendEmail({
          to: input.to,
          subject: input.subject,
          html: input.html,
          cc: input.cc || undefined,
          bcc: input.bcc || undefined,
          attachments: input.attachments || undefined,
        })
        return { successo: true, messaggio: `Email inviata a ${input.to}`, messageId: result.messageId }
      } catch (err: any) {
        return { successo: false, messaggio: err.message }
      }
    }

    case 'read_inbox': {
      try {
        const { listEmails } = await import('../email.js')
        return await listEmails({ limit: input.limit, folder: input.folder })
      } catch (err: any) {
        return { errore: err.message }
      }
    }

    case 'read_email': {
      try {
        const { readEmail } = await import('../email.js')
        return await readEmail(input.uid)
      } catch (err: any) {
        return { errore: err.message }
      }
    }

    case 'search_emails': {
      try {
        const { searchEmails } = await import('../email.js')
        return await searchEmails({
          subject: input.subject, from: input.from,
          since: input.since, before: input.before,
          text: input.text, limit: input.limit,
        })
      } catch (err: any) {
        return { errore: err.message }
      }
    }

    case 'reply_email': {
      try {
        const { readEmail, sendEmail } = await import('../email.js')
        const original = await readEmail(input.uid)
        if (!original) return { errore: `Email UID ${input.uid} non trovata` }

        const replyTo = original.fromAddress || original.from
        const subject = original.subject?.startsWith('Re:') ? original.subject : `Re: ${original.subject}`

        const result = await sendEmail({
          to: replyTo,
          cc: input.cc || undefined,
          subject,
          html: input.html,
          inReplyTo: original.messageId || undefined,
          references: original.messageId || undefined,
        })
        return { successo: true, messaggio: `Risposta inviata a ${replyTo}`, messageId: result.messageId }
      } catch (err: any) {
        return { successo: false, messaggio: err.message }
      }
    }

    case 'download_email_attachment': {
      try {
        const { downloadAttachment } = await import('../email.js')
        return await downloadAttachment(input.uid, input.part_id)
      } catch (err: any) {
        return { errore: err.message }
      }
    }

    // ── PLANNING (proxy to ai-planner) ──

    case 'planning_health': {
      const { planningHealth } = await import('../planning-proxy.js')
      return await planningHealth()
    }

    case 'planning_tutti_autisti': {
      const { planningCall } = await import('../planning-proxy.js')
      return await planningCall('execute', { tool: 'get_tutti_autisti', args: {} })
    }

    case 'planning_viaggi':
    case 'planning_suggerisci':
    case 'planning_assegna':
    case 'planning_autisti':
    case 'planning_semirimorchi':
    case 'planning_gps':
    case 'planning_distanza':
    case 'planning_statistiche':
    case 'planning_confronta':
    case 'planning_scenario':
    case 'planning_eta':
    case 'planning_conflitti':
    case 'planning_storico':
    case 'planning_dettaglio':
    case 'planning_analizza':
    case 'planning_pianificazione_corrente':
    case 'planning_cerca_autista': {
      const { planningCall } = await import('../planning-proxy.js')
      // Map tool name to API endpoint
      const endpointMap: Record<string, string> = {
        planning_viaggi: 'viaggi', planning_suggerisci: 'suggerisci', planning_assegna: 'assegna',
        planning_autisti: 'autisti', planning_semirimorchi: 'semirimorchi', planning_gps: 'gps',
        planning_distanza: 'distanza', planning_statistiche: 'statistiche', planning_confronta: 'confronta',
        planning_scenario: 'scenario', planning_eta: 'eta', planning_conflitti: 'conflitti',
        planning_storico: 'storico', planning_dettaglio: 'dettaglio', planning_analizza: 'analizza',
        planning_pianificazione_corrente: 'pianificazione_corrente', planning_cerca_autista: 'cerca_autista',
      }
      const endpoint = endpointMap[name] || name.replace('planning_', '')
      return await planningCall(endpoint, input)
    }

    // ── CODE EXECUTION (programmatic tool calling) ──
    case 'execute_code': {
      if (!input.code) return { errore: 'code obbligatorio' }
      try {
        const { executeCode } = await import('./code-executor.js')
        console.log(`[CodeExec] Running:\n${(input.code as string).substring(0, 1500)}`)
        const result = await executeCode(input.code as string, aziendaId)
        console.log(`[CodeExec] return_code=${result.return_code}, stdout=${result.stdout.length}ch${result.stderr ? ', stderr=' + result.stderr.substring(0, 100) : ''}`)
        if (result.return_code !== 0) {
          return { errore: result.stderr, output: result.stdout || undefined }
        }
        return { output: result.stdout }
      } catch (err: any) {
        return { errore: `Code execution failed: ${err.message}` }
      }
    }

    // ── MAPS & ROUTING (OpenStreetMap + OSRM — free) ──
    case 'get_map': {
      try {
        const geocode = async (query: string) => {
          const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`, {
            headers: { 'User-Agent': 'BERNARDINI-OS/1.0' }
          })
          const data = await res.json()
          if (!data.length) return null
          return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), display_name: data[0].display_name }
        }

        // Single address → show map
        if (input.address && !input.from && !input.to) {
          const loc = await geocode(input.address as string)
          if (!loc) return { errore: `Indirizzo "${input.address}" non trovato` }
          return {
            tipo: 'mappa',
            indirizzo: loc.display_name,
            lat: loc.lat,
            lon: loc.lon,
            mappa_url: `https://www.openstreetmap.org/?mlat=${loc.lat}&mlon=${loc.lon}#map=16/${loc.lat}/${loc.lon}`,
            embed_url: `https://www.openstreetmap.org/export/embed.html?bbox=${loc.lon-0.01},${loc.lat-0.01},${loc.lon+0.01},${loc.lat+0.01}&layer=mapnik&marker=${loc.lat},${loc.lon}`,
          }
        }

        // Route between two points
        if (input.from && input.to) {
          const fromLoc = await geocode(input.from as string)
          const toLoc = await geocode(input.to as string)
          if (!fromLoc) return { errore: `Partenza "${input.from}" non trovata` }
          if (!toLoc) return { errore: `Destinazione "${input.to}" non trovata` }

          const mode = (input.mode as string) || 'driving'
          const osrmProfile = mode === 'cycling' ? 'bike' : mode === 'walking' ? 'foot' : 'car'

          // OSRM routing
          const routeRes = await fetch(`https://router.project-osrm.org/route/v1/${osrmProfile}/${fromLoc.lon},${fromLoc.lat};${toLoc.lon},${toLoc.lat}?overview=full&geometries=geojson&steps=true`)
          const routeData = await routeRes.json()

          if (routeData.code !== 'Ok' || !routeData.routes?.length) {
            return { errore: 'Percorso non disponibile per questo mezzo' }
          }

          const route = routeData.routes[0]
          const durationMin = Math.round(route.duration / 60)
          const distanceKm = (route.distance / 1000).toFixed(1)
          const hours = Math.floor(durationMin / 60)
          const mins = durationMin % 60

          // Extract key steps
          const steps = route.legs[0].steps
            .filter((s: any) => s.name && s.distance > 500)
            .slice(0, 10)
            .map((s: any) => ({
              istruzione: s.maneuver?.type === 'turn' ? `Svolta ${s.maneuver.modifier || ''} su ${s.name}` :
                          s.maneuver?.type === 'depart' ? `Parti da ${s.name}` :
                          s.maneuver?.type === 'arrive' ? `Arrivo a ${s.name}` :
                          `Prosegui su ${s.name}`,
              distanza: `${(s.distance / 1000).toFixed(1)} km`,
              durata: `${Math.round(s.duration / 60)} min`,
            }))

          const modeLabel = mode === 'cycling' ? 'bici' : mode === 'walking' ? 'piedi' : 'auto'

          // Map with route
          const bbox = [
            Math.min(fromLoc.lon, toLoc.lon) - 0.1,
            Math.min(fromLoc.lat, toLoc.lat) - 0.1,
            Math.max(fromLoc.lon, toLoc.lon) + 0.1,
            Math.max(fromLoc.lat, toLoc.lat) + 0.1,
          ]

          return {
            tipo: 'percorso',
            partenza: fromLoc.display_name,
            destinazione: toLoc.display_name,
            mezzo: modeLabel,
            distanza: `${distanceKm} km`,
            durata: hours > 0 ? `${hours}h ${mins}min` : `${mins} min`,
            tappe: steps,
            mappa_url: `https://www.openstreetmap.org/directions?engine=osrm_${osrmProfile}&route=${fromLoc.lat},${fromLoc.lon};${toLoc.lat},${toLoc.lon}`,
            embed_url: `https://www.openstreetmap.org/export/embed.html?bbox=${bbox.join(',')}&layer=mapnik`,
            coordinate: {
              partenza: { lat: fromLoc.lat, lon: fromLoc.lon },
              destinazione: { lat: toLoc.lat, lon: toLoc.lon },
            },
            bbox,
            geojson: route.geometry, // GeoJSON LineString for drawing route on map
          }
        }

        return { errore: 'Specifica un indirizzo (address) o una partenza/destinazione (from/to)' }
      } catch (err: any) {
        return { errore: `Mappa non disponibile: ${err.message}` }
      }
    }

    // ── WEATHER (Open-Meteo API — free, no key) ──
    case 'get_weather': {
      if (!input.city) return { errore: 'city obbligatorio' }
      try {
        const city = input.city as string
        const days = Math.min(Math.max(input.days as number || 1, 1), 16)

        // Geocode city name to lat/lon
        const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=it`)
        const geoData = await geoRes.json()
        if (!geoData.results?.length) return { errore: `Citta "${city}" non trovata` }

        const { latitude, longitude, name, country, timezone } = geoData.results[0]

        // Weather codes → descriptions
        const weatherDesc: Record<number, string> = {
          0: 'Sereno', 1: 'Prevalentemente sereno', 2: 'Parzialmente nuvoloso', 3: 'Coperto',
          45: 'Nebbia', 48: 'Nebbia con brina',
          51: 'Pioggerella leggera', 53: 'Pioggerella', 55: 'Pioggerella intensa',
          61: 'Pioggia leggera', 63: 'Pioggia', 65: 'Pioggia intensa',
          71: 'Neve leggera', 73: 'Neve', 75: 'Neve intensa',
          77: 'Granuli di neve', 80: 'Rovesci leggeri', 81: 'Rovesci', 82: 'Rovesci intensi',
          85: 'Neve a rovesci', 86: 'Neve intensa a rovesci',
          95: 'Temporale', 96: 'Temporale con grandine leggera', 99: 'Temporale con grandine',
        }

        // Build API URL
        let url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&timezone=${encodeURIComponent(timezone)}`
        url += `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,relative_humidity_2m,precipitation`

        if (days > 1) {
          url += `&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_sum,wind_speed_10m_max,sunrise,sunset`
          url += `&forecast_days=${days}`
        } else {
          url += `&hourly=temperature_2m,weather_code,precipitation_probability,wind_speed_10m`
          url += `&forecast_days=1`
        }

        const weatherRes = await fetch(url)
        const weather = await weatherRes.json()
        const current = weather.current

        const result: Record<string, unknown> = {
          citta: name,
          paese: country,
          timezone,
          attuale: {
            temperatura: `${current.temperature_2m}°C`,
            percepita: `${current.apparent_temperature}°C`,
            condizioni: weatherDesc[current.weather_code] || `Codice ${current.weather_code}`,
            umidita: `${current.relative_humidity_2m}%`,
            vento: `${current.wind_speed_10m} km/h`,
            precipitazioni: `${current.precipitation} mm`,
          },
        }

        if (days > 1 && weather.daily) {
          const giorni = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab']
          result.previsioni = weather.daily.time.map((date: string, i: number) => {
            const d = new Date(date)
            return {
              data: date,
              giorno: giorni[d.getDay()],
              temp_max: `${weather.daily.temperature_2m_max[i]}°C`,
              temp_min: `${weather.daily.temperature_2m_min[i]}°C`,
              condizioni: weatherDesc[weather.daily.weather_code[i]] || `Codice ${weather.daily.weather_code[i]}`,
              precipitazioni: `${weather.daily.precipitation_sum[i]} mm`,
              vento_max: `${weather.daily.wind_speed_10m_max[i]} km/h`,
              alba: weather.daily.sunrise[i]?.split('T')[1],
              tramonto: weather.daily.sunset[i]?.split('T')[1],
            }
          })
        } else if (weather.hourly) {
          // Show key hours: 6, 9, 12, 15, 18, 21
          const keyHours = [6, 9, 12, 15, 18, 21]
          result.oggi_orario = keyHours.map(h => ({
            ora: `${String(h).padStart(2, '0')}:00`,
            temperatura: `${weather.hourly.temperature_2m[h]}°C`,
            condizioni: weatherDesc[weather.hourly.weather_code[h]] || `Codice ${weather.hourly.weather_code[h]}`,
            prob_pioggia: `${weather.hourly.precipitation_probability[h]}%`,
            vento: `${weather.hourly.wind_speed_10m[h]} km/h`,
          }))
        }

        return result
      } catch (err: any) {
        return { errore: `Meteo non disponibile: ${err.message}` }
      }
    }

    // ── WEB SEARCH (via LLM con browsing) ──
    case 'web_search': {
      if (!input.query) return { errore: 'query obbligatoria' }
      try {
        const query = input.query as string
        const res = await fetch(OPENROUTER_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENROUTER_API_KEY}` },
          body: JSON.stringify({
            model: 'perplexity/sonar',
            messages: [
              { role: 'system', content: 'Rispondi in italiano. Cerca informazioni aggiornate sul web. Includi le fonti (URL) alla fine della risposta. Sii preciso e conciso.' },
              { role: 'user', content: query },
            ],
            max_tokens: 1500,
          }),
        })
        if (!res.ok) {
          // Fallback to Gemini Flash
          const res2 = await fetch(OPENROUTER_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENROUTER_API_KEY}` },
            body: JSON.stringify({
              model: 'google/gemini-2.0-flash-001',
              messages: [
                { role: 'system', content: 'Rispondi in italiano. Cerca informazioni aggiornate. Includi le fonti alla fine.' },
                { role: 'user', content: query },
              ],
              max_tokens: 1500,
            }),
          })
          const data2 = await res2.json()
          return { risultato: data2.choices?.[0]?.message?.content || 'Nessun risultato', fonte: 'gemini' }
        }
        const data = await res.json()
        const text = data.choices?.[0]?.message?.content || ''
        const citations = data.citations || []
        return { risultato: text, fonti: citations, fonte: 'perplexity' }
      } catch (err: any) {
        return { errore: `Ricerca web fallita: ${err.message}` }
      }
    }

    // ── PERMISSION MANAGEMENT ──
    case 'create_group': {
      if (!input.name) return { errore: 'name obbligatorio' }
      const groupId = crypto.randomUUID()
      const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 80)
      db.prepare(`INSERT INTO entity (id, azienda_id, type, display_name, slug, metadata, path)
        VALUES (?, ?, 'gruppo', ?, ?, ?, ?)`).run(
        groupId, aziendaId, input.name, slug,
        JSON.stringify({ permissions: input.permissions || {} }),
        `/entity/gruppo/${slug}`
      )
      return { successo: true, id: groupId, messaggio: `Gruppo "${input.name}" creato` }
    }

    case 'add_to_group': {
      if (!input.user_id || !input.group_id) return { errore: 'user_id e group_id obbligatori' }
      db.prepare(`INSERT OR IGNORE INTO relations (id, azienda_id, from_id, to_id, tipo)
        VALUES (?, ?, ?, ?, 'membro_di_gruppo')`).run(
        crypto.randomUUID(), aziendaId, input.user_id, input.group_id
      )
      return { successo: true, messaggio: 'Utente aggiunto al gruppo' }
    }

    case 'remove_from_group': {
      if (!input.user_id || !input.group_id) return { errore: 'user_id e group_id obbligatori' }
      db.prepare("DELETE FROM relations WHERE from_id = ? AND to_id = ? AND tipo = 'membro_di_gruppo'").run(input.user_id, input.group_id)
      return { successo: true, messaggio: 'Utente rimosso dal gruppo' }
    }

    case 'list_groups': {
      const groups = db.prepare("SELECT id, display_name, metadata FROM entity WHERE type = 'gruppo' AND azienda_id = ?").all(aziendaId) as any[]
      return groups.map(g => {
        const meta = typeof g.metadata === 'string' ? JSON.parse(g.metadata) : (g.metadata || {})
        const members = db.prepare("SELECT e.display_name, e.email FROM relations r JOIN entity e ON e.id = r.from_id WHERE r.to_id = ? AND r.tipo = 'membro_di_gruppo'").all(g.id) as any[]
        return { id: g.id, nome: g.display_name, permessi: meta.permissions || {}, membri: members }
      })
    }

    default:
      return { errore: `Tool "${name}" non disponibile` }
  }
}

// Public wrapper with caching for read-only tools
export async function executeTool(name: string, aziendaId: string, args?: Record<string, unknown>, permissions?: import('./types.js').UserPermissions): Promise<unknown> {
  // Check cache for read-only tools
  if (CACHEABLE_TOOLS.has(name)) {
    const cacheKey = getCacheKey(name, aziendaId, args)
    const cached = toolCache.get(cacheKey)
    if (cached && Date.now() - cached.ts < TOOL_CACHE_TTL) {
      console.log(`[ToolCache] HIT: ${name}`)
      return cached.result
    }
  }

  const result = await _executeTool(name, aziendaId, args, permissions)

  // Save to cache for read-only tools (only on non-empty success)
  if (CACHEABLE_TOOLS.has(name) && result && !(result as any)?.errore) {
    // Don't cache empty arrays (failed searches should be retryable)
    const isEmpty = Array.isArray(result) && result.length === 0
    if (!isEmpty) {
      const cacheKey = getCacheKey(name, aziendaId, args)
      toolCache.set(cacheKey, { result, ts: Date.now() })
    }
  }

  return result
}
