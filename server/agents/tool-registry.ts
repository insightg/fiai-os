import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import db from '../db.js'
import { sanitizeMetadata } from '../middleware.js'
import { emit } from './events.js'
import type { ToolDefinition } from './types.js'

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const JWT_SECRET = process.env.JWT_SECRET || 'fiai-dev-secret'

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
  search: { type: 'function', function: { name: 'search', description: 'Cerca nomi (persone/aziende) o entita (fatture, progetti, documenti, task, etc.). Usa table="names" per persone/aziende, table="entity" per oggetti, table="both" per cercare ovunque.', parameters: { type: 'object', properties: {
    table: { type: 'string', enum: ['names', 'entity', 'both'], description: 'Dove cercare' },
    type: { type: 'string', description: 'Tipo entity: fattura, preventivo, ordine, progetto, documento, evento, conto, rimborso, annuncio, board, card, etc.' },
    tags: { type: 'array', items: { type: 'string' }, description: 'Filtro tags (solo names): cliente, lead, fornitore, candidato, utente, organizzazione' },
    stato: { type: 'string', description: 'Filtra per stato' },
    query: { type: 'string', description: 'Ricerca testuale sul display_name' },
    name_id: { type: 'string', description: 'Filtra entity collegati a un name specifico' },
    limit: { type: 'number', description: 'Max risultati (default 25)' },
  } } } },

  create: { type: 'function', function: { name: 'create', description: 'Crea un name (persona/azienda) o entity (fattura, progetto, etc.)', parameters: { type: 'object', properties: {
    table: { type: 'string', enum: ['names', 'entity'], description: 'Tabella' },
    type: { type: 'string', description: 'Tipo entity (solo per entity)' },
    tags: { type: 'array', items: { type: 'string' }, description: 'Tags (solo per names): cliente, lead, fornitore, candidato' },
    display_name: { type: 'string', description: 'Nome visualizzato' },
    email: { type: 'string', description: 'Email (solo names)' },
    telefono: { type: 'string', description: 'Telefono (solo names)' },
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

  delete_record: { type: 'function', function: { name: 'delete_record', description: 'Elimina un name o entity', parameters: { type: 'object', properties: {
    id: { type: 'string' },
    table: { type: 'string', enum: ['names', 'entity'] },
  }, required: ['id', 'table'] } } },

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
    agentDomain: { type: 'string', description: 'Dominio agente: pulse, commerciale, amministrazione, produzione, hr, legal, marketing, infra' },
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
  get_datetime: { type: 'function', function: { name: 'get_datetime', description: 'Ottieni data e ora correnti, giorno della settimana, settimana dell\'anno, e calcola date relative (es. "tra 7 giorni", "lunedì prossimo", "fine mese")', parameters: { type: 'object', properties: {
    offset: { type: 'string', description: 'Offset relativo opzionale: "7d" (7 giorni), "-3d" (3 giorni fa), "1w" (1 settimana), "1m" (1 mese), "next_monday", "end_month", "start_month", "end_week", "start_week", "end_year"' },
  } } } },

  date_diff: { type: 'function', function: { name: 'date_diff', description: 'Calcola la differenza tra due date in giorni, settimane, mesi', parameters: { type: 'object', properties: {
    from: { type: 'string', description: 'Data inizio (ISO o "today")' },
    to: { type: 'string', description: 'Data fine (ISO o "today")' },
  }, required: ['from', 'to'] } } },

  // ── Special tools (non-CRUD) ──
  generate_image: { type: 'function', function: { name: 'generate_image', description: "Genera un'immagine dalla descrizione testuale", parameters: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] } } },
  generate_pdf: { type: 'function', function: { name: 'generate_pdf', description: 'Genera un PDF da contenuto testuale', parameters: { type: 'object', properties: { titolo: { type: 'string' }, contenuto: { type: 'string' } }, required: ['titolo', 'contenuto'] } } },
  get_api_costs: { type: 'function', function: { name: 'get_api_costs', description: 'Costi API OpenRouter', parameters: { type: 'object', properties: {} } } },
  get_whatsapp_status: { type: 'function', function: { name: 'get_whatsapp_status', description: 'Stato connessione WhatsApp', parameters: { type: 'object', properties: {} } } },
  send_whatsapp_message: { type: 'function', function: { name: 'send_whatsapp_message', description: 'Invia un messaggio di testo WhatsApp', parameters: { type: 'object', properties: { phone: { type: 'string', description: 'Numero senza + (es. 393471349312)' }, text: { type: 'string' } }, required: ['phone', 'text'] } } },
  send_whatsapp_voice: { type: 'function', function: { name: 'send_whatsapp_voice', description: 'Invia un messaggio vocale WhatsApp (TTS)', parameters: { type: 'object', properties: { phone: { type: 'string' }, text: { type: 'string', description: 'Testo da pronunciare' }, voice: { type: 'string', description: 'Voce TTS (Vivian, Serena, Ryan...)' } }, required: ['phone', 'text'] } } },
  send_whatsapp_image: { type: 'function', function: { name: 'send_whatsapp_image', description: 'Invia un\'immagine su WhatsApp (da URL o path file)', parameters: { type: 'object', properties: { phone: { type: 'string' }, url: { type: 'string', description: 'URL o path del file immagine' }, caption: { type: 'string', description: 'Didascalia opzionale' } }, required: ['phone', 'url'] } } },
  send_whatsapp_document: { type: 'function', function: { name: 'send_whatsapp_document', description: 'Invia un documento/file su WhatsApp (PDF, DOC, etc.)', parameters: { type: 'object', properties: { phone: { type: 'string' }, url: { type: 'string', description: 'URL o path del file' }, filename: { type: 'string', description: 'Nome file visualizzato' }, caption: { type: 'string' } }, required: ['phone', 'url'] } } },
  send_whatsapp_video: { type: 'function', function: { name: 'send_whatsapp_video', description: 'Invia un video su WhatsApp', parameters: { type: 'object', properties: { phone: { type: 'string' }, url: { type: 'string', description: 'URL o path del video' }, caption: { type: 'string' } }, required: ['phone', 'url'] } } },
}

// ══════════════════════════════════════════════════════════
// TOOL EXECUTORS
// ══════════════════════════════════════════════════════════

export async function executeTool(name: string, aziendaId: string, args?: Record<string, unknown>): Promise<unknown> {
  const input = (args || {}) as any

  switch (name) {

    // ── SEARCH ──
    case 'search': {
      const { table = 'both', type, tags, stato, query, name_id, limit = 25 } = input
      const results: any[] = []

      if (table === 'names' || table === 'both') {
        let sql = 'SELECT id, display_name, slug, email, telefono, piva, tags, stato, metadata, path, created_at FROM names WHERE azienda_id = ?'
        const params: any[] = [aziendaId]
        if (tags?.length) {
          for (const tag of tags) {
            sql += " AND tags LIKE ?"
            params.push(`%"${tag}"%`)
          }
        }
        if (stato) { sql += ' AND stato = ?'; params.push(stato) }
        if (query) {
          const words = (query as string).split(/\s+/).filter((w: string) => w.length > 1)
          const qFields = "(display_name LIKE ? OR email LIKE ? OR json_extract(metadata, '$.ragione_sociale') LIKE ?)"
          if (words.length <= 1) {
            sql += ` AND ${qFields}`
            const q = `%${query}%`
            params.push(q, q, q)
          } else {
            sql += ` AND (${words.map(() => qFields).join(' OR ')})`
            for (const w of words) { const q = `%${w}%`; params.push(q, q, q) }
          }
        }
        sql += ` ORDER BY display_name LIMIT ${Math.min(limit, 100)}`
        results.push(...parseRows(db.prepare(sql).all(...params)))
      }

      if (table === 'entity' || table === 'both') {
        let sql = 'SELECT e.id, e.type, e.display_name, e.slug, e.stato, e.name_id, e.parent_id, e.numero, e.data, e.totale, e.metadata, e.path, e.created_at, n.display_name as name_display FROM entity e LEFT JOIN names n ON e.name_id = n.id WHERE e.azienda_id = ?'
        const params: any[] = [aziendaId]
        if (type) { sql += ' AND e.type = ?'; params.push(type) }
        if (stato) { sql += ' AND e.stato = ?'; params.push(stato) }
        if (name_id) { sql += ' AND e.name_id = ?'; params.push(name_id) }
        if (query) {
          // Split query into words — each word must match at least one field
          const words = (query as string).split(/\s+/).filter((w: string) => w.length > 1)
          if (words.length <= 1) {
            sql += " AND (e.display_name LIKE ? OR json_extract(e.metadata, '$.categoria') LIKE ? OR json_extract(e.metadata, '$.descrizione') LIKE ? OR json_extract(e.metadata, '$.tags') LIKE ?)"
            const q = `%${query}%`
            params.push(q, q, q, q)
          } else {
            // Each word must match somewhere
            const wordClauses = words.map(() =>
              "(e.display_name LIKE ? OR json_extract(e.metadata, '$.categoria') LIKE ? OR json_extract(e.metadata, '$.descrizione') LIKE ? OR json_extract(e.metadata, '$.tags') LIKE ?)"
            )
            sql += ` AND (${wordClauses.join(' OR ')})`
            for (const w of words) {
              const q = `%${w}%`
              params.push(q, q, q, q)
            }
          }
        }
        // Exclude chat messages and chunks from broad searches
        if (!type && table === 'both') sql += " AND e.type NOT IN ('chat_message', 'chat_session', 'chunk')"
        if (type && type !== 'chunk') sql += " AND e.type != 'chunk'"
        sql += ` ORDER BY e.created_at DESC LIMIT ${Math.min(limit, 100)}`
        results.push(...parseRows(db.prepare(sql).all(...params)))
      }

      return results
    }

    // ── CREATE ──
    case 'create': {
      const id = crypto.randomUUID()

      if (input.table === 'names') {
        const slug = slugify(input.display_name)
        const tags = input.tags || ['contatto']
        db.prepare(`INSERT INTO names (id, azienda_id, display_name, slug, email, telefono, piva, tags, stato, metadata, path)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          id, aziendaId, input.display_name, slug,
          input.email || null, input.telefono || null, input.metadata?.piva || null,
          JSON.stringify(tags), input.stato || null,
          JSON.stringify(input.metadata || {}),
          `/names/${slug}`
        )
        // Emit event
        for (const tag of tags) {
          emit(`name_created:${tag}`, { aziendaId, recordId: id, recordType: 'name', tags })
        }
        return { successo: true, id, display_name: input.display_name, tags, messaggio: `"${input.display_name}" creato` }
      }

      if (input.table === 'entity') {
        const slug = slugify(input.display_name)
        // Resolve path
        let path = `/entity/${input.type || 'unknown'}/${slug}`
        if (input.name_id) {
          const nameSlug = (db.prepare("SELECT slug FROM names WHERE id = ?").get(input.name_id) as any)?.slug
          if (nameSlug) path = `/names/${nameSlug}/${input.type || 'item'}/${slug}`
        }
        if (input.parent_id) {
          const parentPath = (db.prepare("SELECT path FROM entity WHERE id = ?").get(input.parent_id) as any)?.path
          if (parentPath) path = `${parentPath}/${slug}`
        }

        db.prepare(`INSERT INTO entity (id, azienda_id, type, display_name, slug, stato, name_id, parent_id, user_id, file_url, numero, data, totale, metadata, path)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          id, aziendaId, input.type || 'item', input.display_name, slug,
          input.stato || null, input.name_id || null, input.parent_id || null,
          input.user_id || null, input.file_url || null,
          input.numero || null, input.data || null, input.totale || null,
          JSON.stringify(input.metadata || {}), path
        )
        // Emit event
        emit(`entity_created:${input.type || 'item'}`, { aziendaId, recordId: id, recordType: 'entity', entityType: input.type })
        return { successo: true, id, type: input.type, display_name: input.display_name, messaggio: `"${input.display_name}" creato` }
      }

      return { errore: 'table deve essere "names" o "entity"' }
    }

    // ── UPDATE ──
    case 'update': {
      if (!input.id || !input.table) return { errore: 'id e table obbligatori' }

      const table = input.table === 'names' ? 'names' : 'entity'
      const existing = db.prepare(`SELECT metadata FROM ${table} WHERE id = ? AND azienda_id = ?`).get(input.id, aziendaId) as any
      if (!existing) return { errore: 'Record non trovato' }

      const updates: string[] = []
      const values: any[] = []

      if (input.display_name) { updates.push('display_name = ?'); values.push(input.display_name); updates.push('slug = ?'); values.push(slugify(input.display_name)) }
      if (input.stato !== undefined) { updates.push('stato = ?'); values.push(input.stato) }
      if (input.tags) { updates.push('tags = ?'); values.push(JSON.stringify(input.tags)) }
      if (input.email !== undefined && table === 'names') { updates.push('email = ?'); values.push(input.email || null) }
      if (input.telefono !== undefined && table === 'names') { updates.push('telefono = ?'); values.push(input.telefono || null) }

      // Merge metadata
      if (input.metadata) {
        const oldMeta = typeof existing.metadata === 'string' ? JSON.parse(existing.metadata) : (existing.metadata || {})
        const newMeta = { ...oldMeta, ...input.metadata }
        updates.push('metadata = ?'); values.push(JSON.stringify(newMeta))
      }

      updates.push("updated_at = datetime('now')")
      if (updates.length === 1) return { errore: 'Nessun campo da aggiornare' }

      values.push(input.id, aziendaId)
      db.prepare(`UPDATE ${table} SET ${updates.join(', ')} WHERE id = ? AND azienda_id = ?`).run(...values)
      return { successo: true, messaggio: `Record aggiornato` }
    }

    // ── DELETE ──
    case 'delete_record': {
      if (!input.id || !input.table) return { errore: 'id e table obbligatori' }
      const table = input.table === 'names' ? 'names' : 'entity'
      const target = db.prepare(`SELECT display_name FROM ${table} WHERE id = ? AND azienda_id = ?`).get(input.id, aziendaId) as any
      if (!target) return { errore: 'Record non trovato' }
      db.prepare(`DELETE FROM ${table} WHERE id = ? AND azienda_id = ?`).run(input.id, aziendaId)
      // Clean up relations
      db.prepare("DELETE FROM relations WHERE from_id = ? OR to_id = ?").run(input.id, input.id)
      return { successo: true, messaggio: `"${target.display_name}" eliminato` }
    }

    // ── RELATE ──
    case 'relate': {
      if (!input.from_id || !input.to_id || !input.tipo) return { errore: 'from_id, to_id e tipo obbligatori' }
      const fromName = db.prepare("SELECT id FROM names WHERE id = ?").get(input.from_id)
      const fromEntity = db.prepare("SELECT id FROM entity WHERE id = ?").get(input.from_id)
      const toName = db.prepare("SELECT id FROM names WHERE id = ?").get(input.to_id)
      const toEntity = db.prepare("SELECT id FROM entity WHERE id = ?").get(input.to_id)
      if (!fromName && !fromEntity) return { errore: 'from_id non trovato' }
      if (!toName && !toEntity) return { errore: 'to_id non trovato' }

      db.prepare(`INSERT OR IGNORE INTO relations (id, azienda_id, from_type, from_id, to_type, to_id, tipo, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, '{}')`).run(
        crypto.randomUUID(), aziendaId,
        fromName ? 'name' : 'entity', input.from_id,
        toName ? 'name' : 'entity', input.to_id,
        input.tipo
      )
      return { successo: true, messaggio: `Relazione "${input.tipo}" creata` }
    }

    // ── GET_TREE ──
    case 'get_tree': {
      if (!input.id) return { errore: 'id obbligatorio' }

      // Try names first, then entity
      let record = parseRow(db.prepare("SELECT * FROM names WHERE id = ?").get(input.id))
      let recordType = 'name'
      if (!record) {
        record = parseRow(db.prepare("SELECT * FROM entity WHERE id = ?").get(input.id))
        recordType = 'entity'
      }
      if (!record) return { errore: 'Record non trovato' }

      // Get children (entity with parent_id or name_id)
      const children = recordType === 'name'
        ? parseRows(db.prepare("SELECT id, type, display_name, stato, numero, totale, data, metadata FROM entity WHERE name_id = ? ORDER BY type, created_at DESC LIMIT 50").all(input.id))
        : parseRows(db.prepare("SELECT id, type, display_name, stato, numero, totale, data, metadata FROM entity WHERE parent_id = ? ORDER BY ordine, created_at").all(input.id))

      // Get relations
      const relationsFrom = db.prepare("SELECT to_type, to_id, tipo FROM relations WHERE from_id = ?").all(input.id) as any[]
      const relationsTo = db.prepare("SELECT from_type, from_id, tipo FROM relations WHERE to_id = ?").all(input.id) as any[]

      return {
        record,
        recordType,
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
        notifyChannels: input.notify || ['chat'],
        enabled: true,
      })
      return { successo: true, id: agentId, messaggio: `Agente autonomo "${input.name}" creato (${input.trigger_type}: ${input.cron || input.event || 'manual'})` }
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
      const users = db.prepare("SELECT id FROM names WHERE azienda_id = ? AND tags LIKE '%\"utente\"%'").all(aziendaId) as any[]
      for (const u of users) {
        db.prepare("UPDATE names SET metadata = json_set(metadata, '$.tts_voice', ?) WHERE id = ?").run(matched, u.id)
      }
      return { successo: true, messaggio: `Voce impostata su ${matched}` }
    }

    case 'get_current_voice': {
      const users = db.prepare("SELECT display_name, json_extract(metadata, '$.tts_voice') as voice FROM names WHERE azienda_id = ? AND tags LIKE '%\"utente\"%'").all(aziendaId) as any[]
      return users.map((u: any) => ({ utente: u.display_name, voce: u.voice || 'Vivian' }))
    }

    case 'clone_voice': {
      return { errore: 'Per clonare una voce, allega un audio nella chat e scrivi "clona voce [nome]".' }
    }

    // ── AGENTIC RAG RETRIEVE ──
    case 'retrieve': {
      const limit = Math.min(input.limit as number || 5, 10)
      const query = input.query as string
      const allChunks = new Map<string, any>()

      // Fast path: direct FTS5 search (no LLM calls) — ~5ms
      const ftsSearch = (q: string) => {
        try {
          let sql = `SELECT e.id, e.display_name, e.parent_id,
            json_extract(e.metadata, '$.contenuto_testo') as contenuto_testo,
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

      // Step 1: Direct FTS5 search with original query
      const directResults = ftsSearch(query)
      for (const r of directResults) allChunks.set(r.id, r)

      // Step 2: If good results (rank < -5 = high relevance), skip LLM calls entirely
      const bestRank = directResults.length > 0 ? Math.abs(directResults[0].rank || 0) : 0
      const hasGoodResults = directResults.length >= 2 && bestRank > 5

      if (!hasGoodResults && allChunks.size < limit) {
        // Step 3: Try individual words from query
        const words = query.split(/\s+/).filter((w: string) => w.length > 2)
        for (const w of words) {
          for (const row of ftsSearch(w)) allChunks.set(row.id, row)
        }

        // Step 4: LLM generates smarter query variants (truly agentic)
        // Always try this if results are insufficient — the LLM understands
        // that "successioni" needs "eredità testamento Art. 456 apertura"
        if (allChunks.size < limit) {
          try {
            const { generateSearchQueries } = await import('../ai.js')
            const variants = await generateSearchQueries(query)
            console.log(`[Retrieve] LLM variants for "${query}":`, variants)
            for (const v of variants.slice(0, 3)) {
              for (const row of ftsSearch(v)) allChunks.set(row.id, row)
            }
          } catch {}
        }

        // Step 5: LIKE fallback if still nothing
        if (allChunks.size === 0) {
          try {
            let sql = `SELECT e.id, e.display_name, e.parent_id,
              json_extract(e.metadata, '$.contenuto_testo') as contenuto_testo,
              json_extract(e.metadata, '$.heading_path') as heading_path,
              json_extract(e.metadata, '$.chunk_index') as chunk_index,
              parent.display_name as document_name
              FROM entity e JOIN entity parent ON e.parent_id = parent.id
              WHERE e.type = 'chunk' AND parent.azienda_id = ?
                AND json_extract(e.metadata, '$.contenuto_testo') LIKE ?`
            const params: any[] = [aziendaId, `%${query}%`]
            if (input.doc_id) { sql += ' AND e.parent_id = ?'; params.push(input.doc_id) }
            sql += ` LIMIT ${limit}`
            for (const row of db.prepare(sql).all(...params) as any[]) allChunks.set(row.id, row)
          } catch {}
        }
      }

      const results = Array.from(allChunks.values()).slice(0, limit)
      return results.map(r => ({
        documento: r.document_name,
        sezione: r.heading_path || r.display_name,
        testo: r.contenuto_testo,
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
        const userVoice = (db.prepare("SELECT json_extract(metadata, '$.tts_voice') as v FROM names WHERE id = ?").get(aziendaId) as any)?.v || input.voice || 'Vivian'

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
      const now = new Date()
      const giorni = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato']
      const mesi = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']

      const result: Record<string, unknown> = {
        iso: now.toISOString(),
        data: now.toLocaleDateString('it-IT'),
        ora: now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
        giorno: giorni[now.getDay()],
        mese: mesi[now.getMonth()],
        anno: now.getFullYear(),
        settimana: Math.ceil(((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / 86400000 + new Date(now.getFullYear(), 0, 1).getDay() + 1) / 7),
        timestamp: now.getTime(),
      }

      if (input.offset) {
        const off = input.offset as string
        let target = new Date(now)

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

        result.offset_data = target.toISOString().split('T')[0]
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
      return { successo: true, messaggio: `PDF "${input.titolo}" pronto per la generazione. Usa l'endpoint /api/pdf/generate per il download.`, titolo: input.titolo }
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

    default:
      return { errore: `Tool "${name}" non disponibile` }
  }
}
