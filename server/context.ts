import { Router, Response } from 'express'
import fs from 'fs'
import path from 'path'
import db from './db.js'
import { AuthRequest, authMiddleware } from './middleware.js'

const router = Router()
const CONTEXT_DIR = process.env.CONTEXT_DIR || '/app/data/context'

// ── Path safety ─────────────────────────────────────────────
function safePath(...segments: string[]): string | null {
  const resolved = path.resolve(CONTEXT_DIR, ...segments)
  if (!resolved.startsWith(path.resolve(CONTEXT_DIR))) return null
  return resolved
}

function readContextFile(filePath: string | null): string {
  if (!filePath) return ''
  try {
    return fs.readFileSync(filePath, 'utf-8')
  } catch {
    return ''
  }
}

function writeContextFile(filePath: string | null, content: string): boolean {
  if (!filePath) return false
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content, 'utf-8')
    return true
  } catch (err) {
    console.error('Context write error:', err)
    return false
  }
}

// ── GET /api/context/global — company context ───────────────
router.get('/global', authMiddleware(true), (req: AuthRequest, res: Response) => {
  const aziendaId = req.aziendaId
  if (!aziendaId) { res.json({ content: '' }); return }

  const filePath = safePath('aziende', aziendaId, 'CONTEXT.md')
  let content = readContextFile(filePath)

  // Auto-generate if missing
  if (!content) {
    content = generateGlobalContext(aziendaId)
    writeContextFile(filePath, content)
  }

  res.json({ content })
})

// ── GET /api/context/agent/:domain — skill context ──────────
router.get('/agent/:domain', authMiddleware(true), (req: AuthRequest, res: Response) => {
  const { domain } = req.params
  const aziendaId = req.aziendaId
  if (!aziendaId) { res.json({ content: '' }); return }

  // Try company-specific skill first
  const companyPath = safePath('aziende', aziendaId, 'skills', `${domain}.md`)
  let content = readContextFile(companyPath)

  // Fall back to template
  if (!content) {
    const templatePath = safePath('_templates', 'skills', `${domain}.md`)
    content = readContextFile(templatePath)
  }

  res.json({ content })
})

// ── GET /api/context/profile — user profile context ─────────
router.get('/profile', authMiddleware(true), (req: AuthRequest, res: Response) => {
  const aziendaId = req.aziendaId
  const userId = req.userId
  if (!aziendaId || !userId) { res.json({ content: '' }); return }

  const filePath = safePath('aziende', aziendaId, 'users', userId, 'profile.md')
  let content = readContextFile(filePath)

  // Auto-generate if missing
  if (!content) {
    content = generateUserProfile(aziendaId, userId)
    writeContextFile(filePath, content)
  }

  res.json({ content })
})

// ── GET /api/context/session/:sessionId ─────────────────────
router.get('/session/:sessionId', authMiddleware(true), (req: AuthRequest, res: Response) => {
  const aziendaId = req.aziendaId
  const userId = req.userId
  const { sessionId } = req.params
  if (!aziendaId || !userId) { res.json({ content: '' }); return }

  const filePath = safePath('aziende', aziendaId, 'users', userId, 'sessions', `${sessionId}.md`)
  const content = readContextFile(filePath)
  res.json({ content })
})

// ── PUT /api/context/session/:sessionId ─────────────────────
router.put('/session/:sessionId', authMiddleware(true), (req: AuthRequest, res: Response) => {
  const aziendaId = req.aziendaId
  const userId = req.userId
  const { sessionId } = req.params
  if (!aziendaId || !userId) { res.status(400).json({ error: 'Dati utente mancanti' }); return }

  const { content } = req.body
  if (typeof content !== 'string') { res.status(400).json({ error: 'Contenuto mancante' }); return }

  const filePath = safePath('aziende', aziendaId, 'users', userId, 'sessions', `${sessionId}.md`)
  const ok = writeContextFile(filePath, content)
  res.json({ success: ok })
})

// ── GET /api/context/preferences — user preferences context ─
router.get('/preferences', authMiddleware(true), (req: AuthRequest, res: Response) => {
  const aziendaId = req.aziendaId
  const userId = req.userId
  if (!aziendaId || !userId) { res.json({ content: '' }); return }

  const filePath = safePath('aziende', aziendaId, 'users', userId, 'preferences.md')
  const content = readContextFile(filePath)
  res.json({ content })
})

// ── GET /api/context/tts-preferences — TTS preferences ──
router.get('/tts-preferences', authMiddleware(true), (req: AuthRequest, res: Response) => {
  const aziendaId = req.aziendaId
  const userId = req.userId
  if (!aziendaId || !userId) { res.json({ content: '' }); return }
  const filePath = safePath('aziende', aziendaId, 'users', userId, 'tts-preferences.md')
  res.json({ content: readContextFile(filePath) })
})

// ── PUT /api/context/tts-preferences — Save TTS preferences ──
router.put('/tts-preferences', authMiddleware(true), (req: AuthRequest, res: Response) => {
  const aziendaId = req.aziendaId
  const userId = req.userId
  if (!aziendaId || !userId) { res.status(400).json({ error: 'Dati utente mancanti' }); return }
  const { content } = req.body
  if (typeof content !== 'string') { res.status(400).json({ error: 'Contenuto mancante' }); return }
  const filePath = safePath('aziende', aziendaId, 'users', userId, 'tts-preferences.md')
  const ok = writeContextFile(filePath, content)
  res.json({ success: ok })
})

// ── POST /api/context/refresh — regenerate all contexts ─────
router.post('/refresh', authMiddleware(true), async (req: AuthRequest, res: Response) => {
  const aziendaId = req.aziendaId
  const userId = req.userId
  if (!aziendaId) { res.status(400).json({ error: 'Azienda non trovata' }); return }

  try {
    // Generate company context
    const globalContent = generateGlobalContext(aziendaId)
    writeContextFile(safePath('aziende', aziendaId, 'CONTEXT.md'), globalContent)

    // Generate skill contexts
    generateSkillContexts(aziendaId)

    // Generate user profile if userId present
    if (userId) {
      const profileContent = generateUserProfile(aziendaId, userId)
      writeContextFile(safePath('aziende', aziendaId, 'users', userId, 'profile.md'), profileContent)

      // Update preferences from interaction signals
      updateUserPreferences(aziendaId, userId)

      // Generate steering rules from ratings
      generateSteeringRules(aziendaId)

      // Ensure preferences file exists even with no signals
      const prefsPath = safePath('aziende', aziendaId, 'users', userId, 'preferences.md')
      if (prefsPath && !fs.existsSync(prefsPath)) {
        writeContextFile(prefsPath, '# Preferenze\n- Interazioni totali: 0\n- Domini usati: (nessuno ancora)\n')
      }
    }

    // Ensure templates exist
    ensureTemplates()

    res.json({ success: true })
  } catch (err) {
    console.error('Context refresh error:', err)
    res.status(500).json({ error: 'Errore durante il refresh del contesto' })
  }
})

// ══════════════════════════════════════════════════════════════
// Context Generation Functions
// ══════════════════════════════════════════════════════════════

function queryScalar(sql: string, params: unknown[] = []): number {
  try {
    const row = db.prepare(sql).get(...params) as Record<string, number> | undefined
    if (!row) return 0
    return Object.values(row)[0] ?? 0
  } catch {
    return 0
  }
}

function generateGlobalContext(aziendaId: string): string {
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const yearStart = new Date().getFullYear() + '-01-01'

  // Company info
  const azienda = db.prepare('SELECT * FROM aziende WHERE id = ?').get(aziendaId) as Record<string, string> | undefined

  // Counts
  const clienti = queryScalar('SELECT COUNT(*) as c FROM clienti WHERE azienda_id = ?', [aziendaId])
  const leadTotali = queryScalar('SELECT COUNT(*) as c FROM leads WHERE azienda_id = ?', [aziendaId])
  const leadProposta = queryScalar("SELECT COUNT(*) as c FROM leads WHERE azienda_id = ? AND stato = 'proposta'", [aziendaId])
  const leadNuovi = queryScalar("SELECT COUNT(*) as c FROM leads WHERE azienda_id = ? AND stato = 'nuovo'", [aziendaId])

  // Financial
  const fatturatoYTD = queryScalar(
    "SELECT COALESCE(SUM(totale), 0) as c FROM fatture WHERE azienda_id = ? AND stato = 'pagata' AND data >= ?",
    [aziendaId, yearStart]
  )
  const daIncassare = queryScalar(
    "SELECT COALESCE(SUM(totale), 0) as c FROM fatture WHERE azienda_id = ? AND stato IN ('emessa','inviata_sdi')",
    [aziendaId]
  )
  const fattureScaduteCount = queryScalar(
    "SELECT COUNT(*) as c FROM fatture WHERE azienda_id = ? AND scadenza < date('now') AND stato NOT IN ('pagata','stornata')",
    [aziendaId]
  )
  const fattureScaduteImporto = queryScalar(
    "SELECT COALESCE(SUM(totale), 0) as c FROM fatture WHERE azienda_id = ? AND scadenza < date('now') AND stato NOT IN ('pagata','stornata')",
    [aziendaId]
  )
  const liquidita = queryScalar(
    'SELECT COALESCE(SUM(saldo), 0) as c FROM conti WHERE azienda_id = ?',
    [aziendaId]
  )

  // Projects & Orders
  const progettiAttivi = queryScalar(
    "SELECT COUNT(*) as c FROM progetti WHERE azienda_id = ? AND stato IN ('pianificato','in_corso')",
    [aziendaId]
  )
  const ordiniInLavorazione = queryScalar(
    "SELECT COUNT(*) as c FROM ordini WHERE azienda_id = ? AND stato IN ('confermato','in_lavorazione')",
    [aziendaId]
  )

  // HR
  const candidatiInCorso = queryScalar(
    "SELECT COUNT(*) as c FROM candidati WHERE azienda_id = ? AND stato IN ('nuovo','screening','colloquio','offerta')",
    [aziendaId]
  )
  const annunciPubblicati = queryScalar(
    "SELECT COUNT(*) as c FROM annunci_lavoro WHERE azienda_id = ? AND stato = 'pubblicato'",
    [aziendaId]
  )

  // Documents
  const documentiCount = queryScalar(
    'SELECT COUNT(*) as c FROM documenti WHERE azienda_id = ?',
    [aziendaId]
  )

  const fmt = (n: number) => n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  let md = `# FIAI — Contesto Aziendale
Aggiornato: ${now}

## Azienda
- Nome: ${azienda?.nome ?? 'N/D'}
- P.IVA: ${azienda?.piva ?? 'N/D'}
- Sede: ${azienda?.citta ?? ''} ${azienda?.provincia ? '(' + azienda.provincia + ')' : ''}
- Email: ${azienda?.email ?? 'N/D'}

## KPI Aziendali
- Clienti: ${clienti}
- Lead totali: ${leadTotali} (di cui ${leadProposta} in fase proposta, ${leadNuovi} nuovi)
- Fatturato YTD: € ${fmt(fatturatoYTD)}
- Da incassare: € ${fmt(daIncassare)}
- Fatture scadute: ${fattureScaduteCount} per € ${fmt(fattureScaduteImporto)}
- Liquidità totale: € ${fmt(liquidita)}
- Progetti attivi: ${progettiAttivi}
- Ordini in lavorazione: ${ordiniInLavorazione}
- Candidati in corso: ${candidatiInCorso}
- Annunci pubblicati: ${annunciPubblicati}
- Documenti archiviati: ${documentiCount}
`

  // Append personality if present
  const personalityPath = path.join(CONTEXT_DIR, 'aziende', aziendaId, 'personality.md')
  if (fs.existsSync(personalityPath)) {
    md += '\n' + fs.readFileSync(personalityPath, 'utf-8')
  }

  // Append steering rules if present
  const steeringPath = path.join(CONTEXT_DIR, 'aziende', aziendaId, 'steering-rules.md')
  if (fs.existsSync(steeringPath)) {
    md += '\n' + fs.readFileSync(steeringPath, 'utf-8')
  }

  return md
}

function generateUserProfile(aziendaId: string, userId: string): string {
  const profile = db.prepare('SELECT * FROM user_profiles WHERE id = ? AND azienda_id = ?').get(userId, aziendaId) as Record<string, string> | undefined
  if (!profile) return '# Profilo Utente\nProfilo non trovato.\n'

  const permessi: Record<string, string> = {
    admin: 'Accesso completo a tutte le funzionalità',
    collaboratore: 'Accesso a CRM, vendite, documenti. Limitato su finanza e HR.',
    viewer: 'Solo lettura su tutte le sezioni',
  }

  return `# Profilo Utente
- Nome: ${profile.nome} ${profile.cognome}
- Ruolo: ${profile.ruolo}
- Email: ${profile.email}
- Permessi: ${permessi[profile.ruolo] ?? 'Standard'}
`
}

function generateSkillContexts(aziendaId: string): void {
  const yearStart = new Date().getFullYear() + '-01-01'
  const fmt = (n: number) => n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  // ── Finance ──
  try {
    const conti = db.prepare('SELECT nome, tipo, saldo FROM conti WHERE azienda_id = ? ORDER BY saldo DESC').all(aziendaId) as { nome: string; tipo: string; saldo: number }[]
    const contiStr = conti.map(c => `  - ${c.nome} (${c.tipo}): € ${fmt(c.saldo)}`).join('\n') || '  (nessun conto)'

    const fattureInScadenza = db.prepare(
      "SELECT numero, totale, scadenza FROM fatture WHERE azienda_id = ? AND stato IN ('emessa','inviata_sdi') AND scadenza BETWEEN date('now') AND date('now', '+7 days') ORDER BY scadenza LIMIT 5"
    ).all(aziendaId) as { numero: string; totale: number; scadenza: string }[]
    const scadenzaStr = fattureInScadenza.map(f => `  - Fatt. ${f.numero}: € ${fmt(f.totale)} scad. ${f.scadenza}`).join('\n') || '  (nessuna)'

    const topDaIncassare = db.prepare(
      "SELECT numero, totale, scadenza FROM fatture WHERE azienda_id = ? AND stato IN ('emessa','inviata_sdi') ORDER BY totale DESC LIMIT 5"
    ).all(aziendaId) as { numero: string; totale: number; scadenza: string }[]
    const topStr = topDaIncassare.map(f => `  - Fatt. ${f.numero}: € ${fmt(f.totale)} scad. ${f.scadenza ?? 'N/D'}`).join('\n') || '  (nessuna)'

    const financeContent = `# Contesto Finanza
Aggiornato: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}

## Conti Bancari
${contiStr}

## Fatture in Scadenza (prossimi 7 giorni)
${scadenzaStr}

## Top 5 Fatture da Incassare
${topStr}
`
    writeContextFile(safePath('aziende', aziendaId, 'skills', 'finance.md'), financeContent)
  } catch (err) {
    console.error('Finance context generation error:', err)
  }

  // ── CRM ──
  try {
    const topClienti = db.prepare(
      `SELECT c.nome, c.ragione_sociale, COALESCE(SUM(f.totale), 0) as fatturato
       FROM clienti c LEFT JOIN fatture f ON f.cliente_id = c.id AND f.stato = 'pagata' AND f.data >= ?
       WHERE c.azienda_id = ? GROUP BY c.id ORDER BY fatturato DESC LIMIT 5`
    ).all(yearStart, aziendaId) as { nome: string; ragione_sociale: string; fatturato: number }[]
    const topCliStr = topClienti.map(c => `  - ${c.ragione_sociale || c.nome}: € ${fmt(c.fatturato)}`).join('\n') || '  (nessun cliente)'

    const leadCaldi = db.prepare(
      "SELECT nome, cognome, azienda_lead, valore_stimato FROM leads WHERE azienda_id = ? AND stato = 'proposta' ORDER BY valore_stimato DESC LIMIT 5"
    ).all(aziendaId) as { nome: string; cognome: string; azienda_lead: string; valore_stimato: number }[]
    const leadStr = leadCaldi.map(l => `  - ${l.nome} ${l.cognome} (${l.azienda_lead || 'N/D'}): € ${fmt(l.valore_stimato ?? 0)}`).join('\n') || '  (nessuno)'

    const ultimiLead = db.prepare(
      "SELECT nome, cognome, stato, created_at FROM leads WHERE azienda_id = ? ORDER BY created_at DESC LIMIT 5"
    ).all(aziendaId) as { nome: string; cognome: string; stato: string; created_at: string }[]
    const ultimiStr = ultimiLead.map(l => `  - ${l.nome} ${l.cognome} [${l.stato}] — ${l.created_at.slice(0, 10)}`).join('\n') || '  (nessuno)'

    const crmContent = `# Contesto CRM
Aggiornato: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}

## Top 5 Clienti per Fatturato YTD
${topCliStr}

## Lead Caldi (in fase proposta)
${leadStr}

## Ultimi Lead Creati
${ultimiStr}
`
    writeContextFile(safePath('aziende', aziendaId, 'skills', 'crm.md'), crmContent)
  } catch (err) {
    console.error('CRM context generation error:', err)
  }

  // ── Sales ──
  try {
    const preventiviAperti = db.prepare(
      "SELECT numero, oggetto, totale, stato FROM preventivi WHERE azienda_id = ? AND stato IN ('bozza','inviato') ORDER BY totale DESC LIMIT 5"
    ).all(aziendaId) as { numero: string; oggetto: string; totale: number; stato: string }[]
    const prevStr = preventiviAperti.map(p => `  - Prev. ${p.numero}: € ${fmt(p.totale)} [${p.stato}] — ${p.oggetto ?? ''}`).join('\n') || '  (nessuno)'

    const ordiniAttivi = db.prepare(
      "SELECT numero, totale, stato FROM ordini WHERE azienda_id = ? AND stato IN ('confermato','in_lavorazione') ORDER BY data DESC LIMIT 5"
    ).all(aziendaId) as { numero: string; totale: number; stato: string }[]
    const ordStr = ordiniAttivi.map(o => `  - Ord. ${o.numero}: € ${fmt(o.totale)} [${o.stato}]`).join('\n') || '  (nessuno)'

    const progettiAttivi = db.prepare(
      "SELECT nome, stato, data_fine_prevista FROM progetti WHERE azienda_id = ? AND stato IN ('pianificato','in_corso') ORDER BY data_fine_prevista LIMIT 5"
    ).all(aziendaId) as { nome: string; stato: string; data_fine_prevista: string }[]
    const projStr = progettiAttivi.map(p => `  - ${p.nome} [${p.stato}] scad. ${p.data_fine_prevista ?? 'N/D'}`).join('\n') || '  (nessuno)'

    const salesContent = `# Contesto Vendite
Aggiornato: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}

## Preventivi Aperti
${prevStr}

## Ordini Attivi
${ordStr}

## Progetti in Corso
${projStr}
`
    writeContextFile(safePath('aziende', aziendaId, 'skills', 'sales.md'), salesContent)
  } catch (err) {
    console.error('Sales context generation error:', err)
  }

  // ── HR ──
  try {
    const annunci = db.prepare(
      "SELECT ruolo, stato, sede FROM annunci_lavoro WHERE azienda_id = ? AND stato = 'pubblicato' ORDER BY created_at DESC LIMIT 5"
    ).all(aziendaId) as { ruolo: string; stato: string; sede: string }[]
    const annStr = annunci.map(a => `  - ${a.ruolo} — ${a.sede ?? 'N/D'}`).join('\n') || '  (nessun annuncio)'

    const candidati = db.prepare(
      "SELECT nome, cognome, ruolo_candidato, stato FROM candidati WHERE azienda_id = ? AND stato IN ('colloquio','offerta') ORDER BY updated_at DESC LIMIT 5"
    ).all(aziendaId) as { nome: string; cognome: string; ruolo_candidato: string; stato: string }[]
    const candStr = candidati.map(c => `  - ${c.nome} ${c.cognome} per ${c.ruolo_candidato ?? 'N/D'} [${c.stato}]`).join('\n') || '  (nessuno)'

    const hrContent = `# Contesto HR
Aggiornato: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}

## Annunci Pubblicati
${annStr}

## Candidati in Colloquio/Offerta
${candStr}
`
    writeContextFile(safePath('aziende', aziendaId, 'skills', 'hr.md'), hrContent)
  } catch (err) {
    console.error('HR context generation error:', err)
  }

  // ── Documents ──
  try {
    const perCategoria = db.prepare(
      "SELECT categoria, COUNT(*) as c FROM documenti WHERE azienda_id = ? GROUP BY categoria ORDER BY c DESC"
    ).all(aziendaId) as { categoria: string; c: number }[]
    const catStr = perCategoria.map(d => `  - ${d.categoria}: ${d.c}`).join('\n') || '  (nessun documento)'

    const ultimi = db.prepare(
      "SELECT nome, categoria, created_at FROM documenti WHERE azienda_id = ? ORDER BY created_at DESC LIMIT 5"
    ).all(aziendaId) as { nome: string; categoria: string; created_at: string }[]
    const ultStr = ultimi.map(d => `  - ${d.nome} [${d.categoria}] — ${d.created_at.slice(0, 10)}`).join('\n') || '  (nessuno)'

    const docsContent = `# Contesto Documenti
Aggiornato: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}

## Documenti per Categoria
${catStr}

## Ultimi 5 Documenti Caricati
${ultStr}
`
    writeContextFile(safePath('aziende', aziendaId, 'skills', 'documents.md'), docsContent)
  } catch (err) {
    console.error('Documents context generation error:', err)
  }

  // ── Analytics ──
  try {
    const now = new Date()
    const thisMonth = now.toISOString().slice(0, 7) // YYYY-MM
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const prevMonth = prevDate.toISOString().slice(0, 7)

    const fatturatoThisMonth = queryScalar(
      "SELECT COALESCE(SUM(totale), 0) as c FROM fatture WHERE azienda_id = ? AND stato = 'pagata' AND data LIKE ?",
      [aziendaId, thisMonth + '%']
    )
    const fatturatoPrevMonth = queryScalar(
      "SELECT COALESCE(SUM(totale), 0) as c FROM fatture WHERE azienda_id = ? AND stato = 'pagata' AND data LIKE ?",
      [aziendaId, prevMonth + '%']
    )

    const leadThisMonth = queryScalar(
      "SELECT COUNT(*) as c FROM leads WHERE azienda_id = ? AND created_at LIKE ?",
      [aziendaId, thisMonth + '%']
    )
    const leadPrevMonth = queryScalar(
      "SELECT COUNT(*) as c FROM leads WHERE azienda_id = ? AND created_at LIKE ?",
      [aziendaId, prevMonth + '%']
    )

    const delta = (curr: number, prev: number): string => {
      if (prev === 0) return curr > 0 ? '+100%' : '0%'
      const pct = ((curr - prev) / prev * 100).toFixed(0)
      return (curr >= prev ? '+' : '') + pct + '%'
    }

    const analyticsContent = `# Contesto Analytics
Aggiornato: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}

## Confronto Mese Corrente vs Precedente
- Fatturato incassato: € ${fmt(fatturatoThisMonth)} vs € ${fmt(fatturatoPrevMonth)} (${delta(fatturatoThisMonth, fatturatoPrevMonth)})
- Nuovi lead: ${leadThisMonth} vs ${leadPrevMonth} (${delta(leadThisMonth, leadPrevMonth)})
`
    writeContextFile(safePath('aziende', aziendaId, 'skills', 'analytics.md'), analyticsContent)
  } catch (err) {
    console.error('Analytics context generation error:', err)
  }
}

// ── User Preferences (Learning Memory) ─────────────────────
function updateUserPreferences(aziendaId: string, userId: string): void {
  const signalsDir = path.join(CONTEXT_DIR, 'aziende', aziendaId, 'users', userId, 'signals')
  const interactionsFile = path.join(signalsDir, 'interactions.jsonl')

  if (!fs.existsSync(interactionsFile)) return

  const lines = fs.readFileSync(interactionsFile, 'utf-8').trim().split('\n').filter(Boolean)
  const signals = lines.map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)

  if (signals.length === 0) return

  // Calculate stats
  const domainCounts: Record<string, number> = {}
  const toolCounts: Record<string, number> = {}
  const hourCounts: Record<number, number> = {}

  for (const s of signals) {
    if (s.domain) domainCounts[s.domain] = (domainCounts[s.domain] || 0) + 1
    if (s.tools) for (const t of s.tools) toolCounts[t] = (toolCounts[t] || 0) + 1
    if (s.ts) {
      const hour = new Date(s.ts).getHours()
      hourCounts[hour] = (hourCounts[hour] || 0) + 1
    }
  }

  const total = signals.length
  const topDomains = Object.entries(domainCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)
  const topTools = Object.entries(toolCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)
  const peakHour = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0]

  // Check ratings
  const ratingsFile = path.join(signalsDir, 'ratings.jsonl')
  let positiveRatings = 0, negativeRatings = 0
  if (fs.existsSync(ratingsFile)) {
    const ratingLines = fs.readFileSync(ratingsFile, 'utf-8').trim().split('\n').filter(Boolean)
    for (const l of ratingLines) {
      try {
        const r = JSON.parse(l)
        if (r.rating === 'up') positiveRatings++
        else negativeRatings++
      } catch { /* skip malformed */ }
    }
  }

  const md = `# Preferenze Utente
Aggiornato: ${new Date().toISOString().split('T')[0]}

## Utilizzo
- Interazioni totali: ${total}
- Domini usati: ${topDomains.map(([d, c]) => `${d} (${Math.round(c / total * 100)}%)`).join(', ')}
- Tools preferiti: ${topTools.map(([t, c]) => `${t} (${c}x)`).join(', ')}
- Orario tipico: ${peakHour ? `${peakHour[0]}:00` : 'N/D'}
${positiveRatings + negativeRatings > 0 ? `- Feedback: ${positiveRatings} positivi, ${negativeRatings} negativi` : ''}
`

  const prefDir = path.join(CONTEXT_DIR, 'aziende', aziendaId, 'users', userId)
  fs.mkdirSync(prefDir, { recursive: true })
  fs.writeFileSync(path.join(prefDir, 'preferences.md'), md)
}

// ── Steering Rules (learned from negative feedback) ──────
function generateSteeringRules(aziendaId: string): void {
  const aziendaDir = path.join(CONTEXT_DIR, 'aziende', aziendaId)
  const usersDir = path.join(aziendaDir, 'users')
  if (!fs.existsSync(usersDir)) return

  // Aggregate all ratings across users
  const domainNegatives: Record<string, number> = {}
  const domainTotals: Record<string, number> = {}
  let totalNegative = 0

  try {
    const userDirs = fs.readdirSync(usersDir, { withFileTypes: true }).filter(d => d.isDirectory())
    for (const userDir of userDirs) {
      const ratingsFile = path.join(usersDir, userDir.name, 'signals', 'ratings.jsonl')
      if (!fs.existsSync(ratingsFile)) continue

      const lines = fs.readFileSync(ratingsFile, 'utf-8').trim().split('\n').filter(Boolean)
      for (const line of lines) {
        try {
          const r = JSON.parse(line)
          const domain = r.domain || 'general'
          domainTotals[domain] = (domainTotals[domain] || 0) + 1
          if (r.rating === 'down' || (typeof r.rating === 'number' && r.rating < 4)) {
            domainNegatives[domain] = (domainNegatives[domain] || 0) + 1
            totalNegative++
          }
        } catch { /* skip */ }
      }
    }
  } catch { /* skip */ }

  let md = `# Regole di Comportamento
Aggiornato: ${new Date().toISOString().split('T')[0]}

## Regole Generali
- Usa sempre i tool per recuperare dati reali, non inventare numeri
- Quando mostri dati finanziari, includi sempre il periodo di riferimento
- Non ripetere in formato markdown i dati che il tool renderer mostra già come tabella o stat card
- Rispondi in modo conciso e diretto, senza preamboli inutili
- Se un tool non restituisce dati, dillo chiaramente
`

  if (totalNegative > 0) {
    md += `\n## Feedback per Dominio\n`
    for (const [domain, total] of Object.entries(domainTotals)) {
      const neg = domainNegatives[domain] || 0
      if (neg > 0) {
        md += `- ${domain}: ${neg} negativi su ${total} interazioni — attenzione a migliorare\n`
      }
    }
  }

  fs.writeFileSync(path.join(aziendaDir, 'steering-rules.md'), md)
}

// ── Skill Templates ─────────────────────────────────────────
function ensureTemplates(): void {
  const templates: Record<string, string> = {
    'crm.md': `# Esperto CRM
Sei l'esperto CRM di FIAI. Gestisci clienti, lead e pipeline commerciale.
Conosci lo stato di ogni lead, i clienti principali e le opportunità in corso.
Aiuta l'utente a gestire relazioni commerciali, qualificare lead e convertirli in clienti.
`,
    'finance.md': `# Esperto Finanziario
Sei l'esperto finanziario di FIAI. Gestisci fatture attive e passive, conti bancari, movimenti e rimborsi.
Conosci la situazione di liquidità, le scadenze imminenti e il fatturato.
Aiuta l'utente con analisi finanziarie, gestione incassi e pianificazione pagamenti.
`,
    'sales.md': `# Esperto Vendite
Sei l'esperto vendite di FIAI. Gestisci preventivi, ordini e progetti.
Conosci lo stato dei preventivi aperti, gli ordini in lavorazione e i progetti attivi.
Aiuta l'utente a chiudere trattative, gestire ordini e monitorare l'avanzamento progetti.
`,
    'hr.md': `# Esperto HR
Sei l'esperto risorse umane di FIAI. Gestisci candidati, annunci di lavoro e processi di selezione.
Conosci le posizioni aperte, i candidati in fase di colloquio e le offerte in corso.
Aiuta l'utente nel recruiting, nella valutazione candidati e nella gestione annunci.
`,
    'documents.md': `# Esperto Documenti
Sei l'esperto documentale di FIAI. Gestisci l'archivio documenti aziendali.
Conosci le categorie disponibili, i documenti recenti e puoi cercare nel contenuto.
Aiuta l'utente a trovare, organizzare e gestire la documentazione aziendale.
`,
    'analytics.md': `# Esperto Analytics
Sei l'esperto di analisi dati di FIAI. Fornisci panoramiche aziendali e KPI.
Conosci i trend di fatturato, lead, clienti e tutte le metriche chiave.
Aiuta l'utente con dashboard, report e analisi comparative.
`,
  }

  for (const [filename, content] of Object.entries(templates)) {
    const filePath = safePath('_templates', 'skills', filename)
    if (filePath && !fs.existsSync(filePath)) {
      writeContextFile(filePath, content)
    }
  }
}

// Initialize templates on module load
try {
  ensureTemplates()
} catch {
  // Non-critical: templates will be created on first refresh
}

export default router
