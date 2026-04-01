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

  // Company info from names (VFS)
  const azienda = db.prepare("SELECT display_name as nome, piva, email, metadata FROM names WHERE id = ? AND tags LIKE '%\"organizzazione\"%'").get(aziendaId) as any
  const aziendaMeta = azienda?.metadata ? (typeof azienda.metadata === 'string' ? JSON.parse(azienda.metadata) : azienda.metadata) : {}

  // Names counts
  const clienti = queryScalar("SELECT COUNT(*) as c FROM names WHERE azienda_id = ? AND tags LIKE '%\"cliente\"%'", [aziendaId])
  const leadTotali = queryScalar("SELECT COUNT(*) as c FROM names WHERE azienda_id = ? AND tags LIKE '%\"lead\"%'", [aziendaId])
  const leadProposta = queryScalar("SELECT COUNT(*) as c FROM names WHERE azienda_id = ? AND tags LIKE '%\"lead\"%' AND stato = 'proposta'", [aziendaId])
  const leadNuovi = queryScalar("SELECT COUNT(*) as c FROM names WHERE azienda_id = ? AND tags LIKE '%\"lead\"%' AND stato = 'nuovo'", [aziendaId])
  const candidatiInCorso = queryScalar("SELECT COUNT(*) as c FROM names WHERE azienda_id = ? AND tags LIKE '%\"candidato\"%' AND stato IN ('nuovo','screening','colloquio','offerta')", [aziendaId])

  // Entity counts
  const fatturatoYTD = queryScalar("SELECT COALESCE(SUM(totale), 0) as c FROM entity WHERE azienda_id = ? AND type = 'fattura' AND stato = 'pagata' AND data >= ?", [aziendaId, yearStart])
  const daIncassare = queryScalar("SELECT COALESCE(SUM(totale), 0) as c FROM entity WHERE azienda_id = ? AND type = 'fattura' AND stato IN ('emessa','inviata_sdi')", [aziendaId])
  const fattureScaduteCount = queryScalar("SELECT COUNT(*) as c FROM entity WHERE azienda_id = ? AND type = 'fattura' AND json_extract(metadata, '$.scadenza') < date('now') AND stato NOT IN ('pagata','stornata')", [aziendaId])
  const fattureScaduteImporto = queryScalar("SELECT COALESCE(SUM(totale), 0) as c FROM entity WHERE azienda_id = ? AND type = 'fattura' AND json_extract(metadata, '$.scadenza') < date('now') AND stato NOT IN ('pagata','stornata')", [aziendaId])
  const liquidita = queryScalar("SELECT COALESCE(SUM(json_extract(metadata, '$.saldo')), 0) as c FROM entity WHERE azienda_id = ? AND type = 'conto'", [aziendaId])
  const progettiAttivi = queryScalar("SELECT COUNT(*) as c FROM entity WHERE azienda_id = ? AND type = 'progetto' AND stato IN ('pianificato','in_corso')", [aziendaId])
  const ordiniInLavorazione = queryScalar("SELECT COUNT(*) as c FROM entity WHERE azienda_id = ? AND type = 'ordine' AND stato IN ('confermato','in_lavorazione')", [aziendaId])
  const annunciPubblicati = queryScalar("SELECT COUNT(*) as c FROM entity WHERE azienda_id = ? AND type = 'annuncio' AND stato = 'pubblicato'", [aziendaId])
  const documentiCount = queryScalar("SELECT COUNT(*) as c FROM entity WHERE azienda_id = ? AND type = 'documento'", [aziendaId])

  const fmt = (n: number) => n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  let md = `# FIAI — Contesto Aziendale
Aggiornato: ${now}

## Azienda
- Nome: ${azienda?.nome ?? 'N/D'}
- P.IVA: ${azienda?.piva ?? 'N/D'}
- Sede: ${aziendaMeta?.citta ?? ''} ${aziendaMeta?.provincia ? '(' + aziendaMeta.provincia + ')' : ''}
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
  const name = db.prepare("SELECT display_name, email, telefono, tags, metadata FROM names WHERE id = ?").get(userId) as any
  if (!name) return '# Profilo Utente\nProfilo non trovato.\n'

  const meta = typeof name.metadata === 'string' ? JSON.parse(name.metadata) : (name.metadata || {})
  const tags = typeof name.tags === 'string' ? JSON.parse(name.tags) : (name.tags || [])
  const ruolo = meta.ruolo || (tags.includes('admin') ? 'admin' : 'collaboratore')
  const permessi: Record<string, string> = {
    admin: 'Accesso completo a tutte le funzionalità',
    collaboratore: 'Accesso a CRM, vendite, documenti. Limitato su finanza e HR.',
    viewer: 'Solo lettura su tutte le sezioni',
  }

  return `# Profilo Utente
- Nome: ${name.display_name}
- Ruolo: ${ruolo}
- Email: ${name.email || 'N/D'}
- Telefono: ${name.telefono || 'N/D'}
- Tags: ${tags.join(', ')}
- Voce TTS: ${meta.tts_voice || 'Vivian'}
- Permessi: ${permessi[ruolo] ?? 'Standard'}
`
}

function generateSkillContexts(aziendaId: string): void {
  const yearStart = new Date().getFullYear() + '-01-01'
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const fmt = (n: number) => n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  // VFS-only query helpers
  const q = (sql: string, params: any[]) => db.prepare(sql).all(...params)
  const qs = (sql: string, params: any[]) => queryScalar(sql, params)

  // ── Amministrazione (finance) ──
  try {
    const conti = q(
      "SELECT display_name as nome, json_extract(metadata,'$.tipo') as tipo, json_extract(metadata,'$.saldo') as saldo FROM entity WHERE azienda_id = ? AND type = 'conto' ORDER BY json_extract(metadata,'$.saldo') DESC",
      [aziendaId]
    ) as any[]
    const contiStr = conti.map((c: any) => `  - ${c.nome} (${c.tipo}): € ${fmt(c.saldo || 0)}`).join('\n') || '  (nessun conto)'

    const fattureInScadenza = q(
      "SELECT numero, totale, json_extract(metadata,'$.scadenza') as scadenza FROM entity WHERE azienda_id = ? AND type = 'fattura' AND stato IN ('emessa','inviata_sdi') AND json_extract(metadata,'$.scadenza') BETWEEN date('now') AND date('now','+7 days') ORDER BY json_extract(metadata,'$.scadenza') LIMIT 5",
      [aziendaId]
    ) as any[]
    const scadenzaStr = fattureInScadenza.map((f: any) => `  - Fatt. ${f.numero}: € ${fmt(f.totale)} scad. ${f.scadenza}`).join('\n') || '  (nessuna)'

    writeContextFile(safePath('aziende', aziendaId, 'skills', 'amministrazione.md'),
      `# Contesto Amministrazione\nAggiornato: ${now}\n\n## Conti Bancari\n${contiStr}\n\n## Fatture in Scadenza (7gg)\n${scadenzaStr}\n`)
  } catch (err) { console.error('Amministrazione context error:', err) }

  // ── Commerciale (CRM + sales) ──
  try {
    const topClienti = q(
      `SELECT n.display_name, COALESCE(SUM(e.totale), 0) as fatturato FROM names n LEFT JOIN entity e ON e.name_id = n.id AND e.type = 'fattura' AND e.stato = 'pagata' AND e.data >= ? WHERE n.azienda_id = ? AND n.tags LIKE '%"cliente"%' GROUP BY n.id ORDER BY fatturato DESC LIMIT 5`,
      [yearStart, aziendaId]
    ) as any[]
    const topCliStr = topClienti.map((c: any) => `  - ${c.display_name}: € ${fmt(c.fatturato)}`).join('\n') || '  (nessun cliente)'

    const leadCaldi = q(
      "SELECT display_name, json_extract(metadata,'$.valore_stimato') as valore FROM names WHERE azienda_id = ? AND tags LIKE '%\"lead\"%' AND stato = 'proposta' ORDER BY json_extract(metadata,'$.valore_stimato') DESC LIMIT 5",
      [aziendaId]
    ) as any[]
    const leadStr = leadCaldi.map((l: any) => `  - ${l.display_name}: € ${fmt(l.valore || 0)}`).join('\n') || '  (nessuno)'

    const ultimiLead = q(
      "SELECT display_name, stato, created_at FROM names WHERE azienda_id = ? AND tags LIKE '%\"lead\"%' ORDER BY created_at DESC LIMIT 5",
      [aziendaId]
    ) as any[]
    const ultimiStr = ultimiLead.map((l: any) => `  - ${l.display_name} [${l.stato}] — ${l.created_at?.slice(0, 10)}`).join('\n') || '  (nessuno)'

    const preventiviAperti = q(
      "SELECT numero, totale, stato, display_name FROM entity WHERE azienda_id = ? AND type = 'preventivo' AND stato IN ('bozza','inviato') ORDER BY totale DESC LIMIT 5",
      [aziendaId]
    ) as any[]
    const prevStr = preventiviAperti.map((p: any) => `  - ${p.numero}: € ${fmt(p.totale)} [${p.stato}]`).join('\n') || '  (nessuno)'

    writeContextFile(safePath('aziende', aziendaId, 'skills', 'commerciale.md'),
      `# Contesto Commerciale\nAggiornato: ${now}\n\n## Top Clienti per Fatturato\n${topCliStr}\n\n## Lead Caldi\n${leadStr}\n\n## Ultimi Lead\n${ultimiStr}\n\n## Preventivi Aperti\n${prevStr}\n`)
  } catch (err) { console.error('Commerciale context error:', err) }

  // ── Produzione ──
  try {
    const ordiniAttivi = q(
      "SELECT numero, totale, stato FROM entity WHERE azienda_id = ? AND type = 'ordine' AND stato IN ('confermato','in_lavorazione') ORDER BY data DESC LIMIT 5",
      [aziendaId]
    ) as any[]
    const ordStr = ordiniAttivi.map((o: any) => `  - Ord. ${o.numero}: € ${fmt(o.totale)} [${o.stato}]`).join('\n') || '  (nessuno)'

    const progettiAttivi = q(
      "SELECT display_name, stato, json_extract(metadata,'$.data_fine_prevista') as scadenza FROM entity WHERE azienda_id = ? AND type = 'progetto' AND stato IN ('pianificato','in_corso') LIMIT 5",
      [aziendaId]
    ) as any[]
    const projStr = progettiAttivi.map((p: any) => `  - ${p.display_name} [${p.stato}] scad. ${p.scadenza ?? 'N/D'}`).join('\n') || '  (nessuno)'

    writeContextFile(safePath('aziende', aziendaId, 'skills', 'produzione.md'),
      `# Contesto Produzione\nAggiornato: ${now}\n\n## Ordini Attivi\n${ordStr}\n\n## Progetti in Corso\n${projStr}\n`)
  } catch (err) { console.error('Produzione context error:', err) }

  // ── HR ──
  try {
    const annunci = q(
      "SELECT display_name as ruolo, json_extract(metadata,'$.sede') as sede FROM entity WHERE azienda_id = ? AND type = 'annuncio' AND stato = 'pubblicato' LIMIT 5",
      [aziendaId]
    ) as any[]
    const annStr = annunci.map((a: any) => `  - ${a.ruolo} — ${a.sede ?? 'N/D'}`).join('\n') || '  (nessun annuncio)'

    const candidati = q(
      "SELECT display_name, stato, json_extract(metadata,'$.ruolo_candidato') as ruolo FROM names WHERE azienda_id = ? AND tags LIKE '%\"candidato\"%' AND stato IN ('colloquio','offerta') LIMIT 5",
      [aziendaId]
    ) as any[]
    const candStr = candidati.map((c: any) => `  - ${c.display_name} per ${c.ruolo || 'N/D'} [${c.stato}]`).join('\n') || '  (nessuno)'

    writeContextFile(safePath('aziende', aziendaId, 'skills', 'hr.md'),
      `# Contesto HR\nAggiornato: ${now}\n\n## Annunci Pubblicati\n${annStr}\n\n## Candidati Avanzati\n${candStr}\n`)
  } catch (err) { console.error('HR context error:', err) }

  // ── Legal (documents) ──
  try {
    const perCategoria = q(
      "SELECT json_extract(metadata,'$.categoria') as categoria, COUNT(*) as c FROM entity WHERE azienda_id = ? AND type = 'documento' GROUP BY json_extract(metadata,'$.categoria') ORDER BY c DESC",
      [aziendaId]
    ) as any[]
    const catStr = perCategoria.map((d: any) => `  - ${d.categoria}: ${d.c}`).join('\n') || '  (nessun documento)'

    const ultimi = q(
      "SELECT display_name, json_extract(metadata,'$.categoria') as categoria, created_at FROM entity WHERE azienda_id = ? AND type = 'documento' ORDER BY created_at DESC LIMIT 5",
      [aziendaId]
    ) as any[]
    const ultStr = ultimi.map((d: any) => `  - ${d.display_name} [${d.categoria}] — ${d.created_at?.slice(0, 10)}`).join('\n') || '  (nessuno)'

    writeContextFile(safePath('aziende', aziendaId, 'skills', 'legal.md'),
      `# Contesto Documenti/Legal\nAggiornato: ${now}\n\n## Per Categoria\n${catStr}\n\n## Ultimi Documenti\n${ultStr}\n`)
  } catch (err) { console.error('Legal context error:', err) }

  // ── Pulse (analytics) ──
  try {
    const thisMonth = new Date().toISOString().slice(0, 7)
    const prevDate = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1)
    const prevMonth = prevDate.toISOString().slice(0, 7)

    const fatturatoThis = qs(
      "SELECT COALESCE(SUM(totale),0) as c FROM entity WHERE azienda_id=? AND type='fattura' AND stato='pagata' AND data LIKE ?",
      [aziendaId, thisMonth + '%']
    )
    const fatturatoPrev = qs(
      "SELECT COALESCE(SUM(totale),0) as c FROM entity WHERE azienda_id=? AND type='fattura' AND stato='pagata' AND data LIKE ?",
      [aziendaId, prevMonth + '%']
    )
    const leadThis = qs(
      "SELECT COUNT(*) as c FROM names WHERE azienda_id=? AND tags LIKE '%\"lead\"%' AND created_at LIKE ?",
      [aziendaId, thisMonth + '%']
    )
    const leadPrev = qs(
      "SELECT COUNT(*) as c FROM names WHERE azienda_id=? AND tags LIKE '%\"lead\"%' AND created_at LIKE ?",
      [aziendaId, prevMonth + '%']
    )
    const delta = (c: number, p: number) => { if (p === 0) return c > 0 ? '+100%' : '0%'; return ((c - p) / p * 100).toFixed(0) + '%' }

    writeContextFile(safePath('aziende', aziendaId, 'skills', 'pulse.md'),
      `# Contesto Analytics\nAggiornato: ${now}\n\n## Mese Corrente vs Precedente\n- Fatturato: € ${fmt(fatturatoThis)} vs € ${fmt(fatturatoPrev)} (${delta(fatturatoThis, fatturatoPrev)})\n- Nuovi lead: ${leadThis} vs ${leadPrev} (${delta(leadThis, leadPrev)})\n`)
  } catch (err) { console.error('Pulse context error:', err) }
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
