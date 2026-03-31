import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import db from '../db.js'
import type { ToolDefinition } from './types.js'

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const JWT_SECRET = process.env.JWT_SECRET || 'fiai-dev-secret'

// ── Tool Definitions (OpenAI function-calling format) ──────

export const TOOL_DEFINITIONS: Record<string, ToolDefinition> = {
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
  archive_document: { type: 'function', function: { name: 'archive_document', description: 'Archivia un documento nel sistema documentale', parameters: { type: 'object', properties: { nome: { type: 'string' }, categoria: { type: 'string' }, descrizione: { type: 'string' } }, required: ['nome'] } } },
  generate_pdf: { type: 'function', function: { name: 'generate_pdf', description: 'Genera un PDF da contenuto testuale', parameters: { type: 'object', properties: { titolo: { type: 'string' }, contenuto: { type: 'string' } }, required: ['titolo', 'contenuto'] } } },
  get_users: { type: 'function', function: { name: 'get_users', description: 'Lista tutti gli utenti del sistema con ruolo, email, telefono WhatsApp e voce TTS', parameters: { type: 'object', properties: {} } } },
  create_user: { type: 'function', function: { name: 'create_user', description: 'Crea un nuovo utente nel sistema', parameters: { type: 'object', properties: { email: { type: 'string', description: 'Email (obbligatoria, usata per login)' }, password: { type: 'string', description: 'Password (obbligatoria, min 6 caratteri)' }, nome: { type: 'string', description: 'Nome' }, cognome: { type: 'string', description: 'Cognome' }, ruolo: { type: 'string', description: 'Ruolo: admin, collaboratore, viewer' } }, required: ['email', 'password', 'nome', 'cognome'] } } },
  update_user: { type: 'function', function: { name: 'update_user', description: 'Modifica un utente esistente (nome, cognome, ruolo, whatsapp_phone, tts_voice)', parameters: { type: 'object', properties: { user_id: { type: 'string', description: 'ID utente da modificare' }, nome: { type: 'string' }, cognome: { type: 'string' }, ruolo: { type: 'string', description: 'admin, collaboratore, viewer' }, whatsapp_phone: { type: 'string' }, tts_voice: { type: 'string' } }, required: ['user_id'] } } },
  delete_user: { type: 'function', function: { name: 'delete_user', description: 'Elimina un utente dal sistema (irreversibile)', parameters: { type: 'object', properties: { user_id: { type: 'string', description: 'ID utente da eliminare' } }, required: ['user_id'] } } },
}

// ── Tool Executors ─────────────────────────────────────────

export async function executeTool(name: string, aziendaId: string, args?: Record<string, unknown>): Promise<unknown> {
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
        const imgRes = await fetch(OPENROUTER_API_URL, {
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
      const input = args as any
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
    case 'archive_document': {
      const input = args as any
      const id = crypto.randomUUID()
      db.prepare('INSERT INTO documenti (id, azienda_id, nome, categoria, descrizione) VALUES (?, ?, ?, ?, ?)').run(
        id, aziendaId, input.nome || 'Senza nome', input.categoria || 'altro', input.descrizione || ''
      )
      return { successo: true, id, messaggio: `Documento "${input.nome}" archiviato` }
    }
    case 'generate_pdf': {
      const input = args as any
      // PDF generation is a stub — the actual PDF router handles it
      return { successo: true, messaggio: `PDF "${input.titolo}" pronto per la generazione. Usa l'endpoint /api/pdf/generate per il download.`, titolo: input.titolo }
    }

    // ── User Management ──
    case 'get_users':
      return db.prepare(
        "SELECT id, nome, cognome, email, ruolo, whatsapp_phone, whatsapp_active, tts_voice, created_at FROM user_profiles WHERE azienda_id = ? ORDER BY nome"
      ).all(aziendaId)

    case 'create_user': {
      const input = args as any
      if (!input.email || !input.password || !input.nome || !input.cognome) {
        return { errore: 'Campi obbligatori: email, password, nome, cognome' }
      }
      if (input.password.length < 6) {
        return { errore: 'La password deve avere almeno 6 caratteri' }
      }
      const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(input.email)
      if (existing) {
        return { errore: `Un utente con email "${input.email}" esiste già` }
      }
      const bcrypt = await import('bcryptjs')
      const userId = crypto.randomUUID()
      const hash = bcrypt.hashSync(input.password, 10)
      const ruolo = ['admin', 'collaboratore', 'viewer'].includes(input.ruolo) ? input.ruolo : 'collaboratore'
      db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)").run(userId, input.email, hash)
      db.prepare(
        "INSERT INTO user_profiles (id, azienda_id, email, nome, cognome, ruolo) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(userId, aziendaId, input.email, input.nome, input.cognome, ruolo)
      return { successo: true, id: userId, messaggio: `Utente ${input.nome} ${input.cognome} creato con ruolo ${ruolo}` }
    }

    case 'update_user': {
      const input = args as any
      if (!input.user_id) return { errore: 'user_id obbligatorio' }
      const user = db.prepare("SELECT id FROM user_profiles WHERE id = ? AND azienda_id = ?").get(input.user_id, aziendaId)
      if (!user) return { errore: 'Utente non trovato' }
      const updates: string[] = []
      const values: any[] = []
      if (input.nome) { updates.push('nome = ?'); values.push(input.nome) }
      if (input.cognome) { updates.push('cognome = ?'); values.push(input.cognome) }
      if (input.ruolo && ['admin', 'collaboratore', 'viewer'].includes(input.ruolo)) { updates.push('ruolo = ?'); values.push(input.ruolo) }
      if (input.whatsapp_phone !== undefined) { updates.push('whatsapp_phone = ?'); values.push(input.whatsapp_phone || null) }
      if (input.tts_voice) { updates.push('tts_voice = ?'); values.push(input.tts_voice) }
      if (updates.length === 0) return { errore: 'Nessun campo da aggiornare' }
      values.push(input.user_id, aziendaId)
      db.prepare(`UPDATE user_profiles SET ${updates.join(', ')} WHERE id = ? AND azienda_id = ?`).run(...values)
      return { successo: true, messaggio: `Utente aggiornato (${updates.map(u => u.split(' =')[0]).join(', ')})` }
    }

    case 'delete_user': {
      const input = args as any
      if (!input.user_id) return { errore: 'user_id obbligatorio' }
      const target = db.prepare("SELECT nome, cognome FROM user_profiles WHERE id = ? AND azienda_id = ?").get(input.user_id, aziendaId) as any
      if (!target) return { errore: 'Utente non trovato' }
      db.prepare("DELETE FROM user_profiles WHERE id = ? AND azienda_id = ?").run(input.user_id, aziendaId)
      db.prepare("DELETE FROM users WHERE id = ?").run(input.user_id)
      return { successo: true, messaggio: `Utente ${target.nome} ${target.cognome} eliminato` }
    }

    default:
      return { errore: `Tool ${name} non disponibile` }
  }
}
