import type { AgentDomain, ClassificationResult, ChatResponse } from './types.js'
import { AGENTS, AGENT_COLORS } from './config.js'
import { buildContext, saveSessionContext, captureSignal, generatePlannerContext } from './context.js'
import { runHooks, type HookContext } from './hooks.js'
import { getSuggestions } from './suggestions.js'
import { executeAgent, directLLMResponse } from './base-agent.js'
// planner.ts kept for backward compat — no longer used in main pipeline
// import { createPlan, executePlan, formatPlanResults } from './planner.js'
import { checkInput, checkOutput } from './safety.js'
import db from '../db.js'
import { getSetting } from '../settings.js'

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const CLASSIFIER_MODEL = 'anthropic/claude-haiku-4.5'
const GEMINI_MODEL = 'google/gemini-3.1-flash-image-preview'

const VALID_DOMAINS: AgentDomain[] = ['pulse', 'commerciale', 'produzione', 'marketing', 'amministrazione', 'hr', 'legal', 'documentale', 'whatsapp', 'email', 'pianificazione', 'it', 'doctor', 'tts', 'general']

interface ConversationMessage {
  role: string
  content: string
}

type ResponseMode = 'minimal' | 'iteration' | 'full'

// ── Caches ─────────────────────────────────────────────
const sessionDomainCache = new Map<string, { domain: AgentDomain; ts: number }>()
const SESSION_DOMAIN_TTL = 600000 // 10 minutes

function getSessionDomain(sessionId: string): AgentDomain | undefined {
  const entry = sessionDomainCache.get(sessionId)
  if (!entry) return undefined
  if (Date.now() - entry.ts > SESSION_DOMAIN_TTL) { sessionDomainCache.delete(sessionId); return undefined }
  return entry.domain
}

function setSessionDomain(sessionId: string, domain: AgentDomain) {
  sessionDomainCache.set(sessionId, { domain, ts: Date.now() })
}
const contextCache = new Map<string, { content: string; ts: number }>()

// ── Image History (for analysis/rework) ────────────────
const imageHistory = new Map<string, string[]>()

// ── Scoring-based classifier (fast, handles multi-domain) ──

const DOMAIN_KEYWORDS: Record<string, { words: string[]; weight: number }[]> = {
  pulse: [
    { words: ['overview', 'kpi', 'briefing', 'riepilogo', 'stato azienda', 'andamento', 'cruscotto', 'dashboard', 'daily brief'], weight: 3 },
    { words: ['come va', 'stato generale', 'fatturato complessivo', 'margini'], weight: 2 },
  ],
  commerciale: [
    { words: ['cliente', 'clienti', 'lead', 'prospect', 'pipeline', 'opportunità'], weight: 3 },
    { words: ['preventivo', 'preventivi', 'offerta', 'offerte', 'trattativa', 'vendita', 'vendite'], weight: 3 },
    { words: ['ordine', 'ordini', 'commessa', 'brief pre-call', 'nuovo cliente'], weight: 2 },
  ],
  produzione: [
    { words: ['progetto', 'progetti', 'milestone', 'avanzamento', 'delivery', 'deadline'], weight: 3 },
    { words: ['stato progetto', 'rischi progetto', 'sprint', 'task'], weight: 3 },
  ],
  marketing: [
    { words: ['contenuti', 'campagna', 'campagne', 'brand', 'social', 'newsletter', 'post'], weight: 3 },
    { words: ['genera immagine', 'crea immagine', 'disegna', 'illustra', 'crea logo', 'grafiche'], weight: 4 },
    { words: ['lead scoring', 'seo', 'sem'], weight: 2 },
  ],
  amministrazione: [
    { words: ['fattura', 'fatture', 'conti', 'liquidità', 'scadenze fiscali', 'rimborsi'], weight: 3 },
    { words: ['budget', 'fornitori', 'cash flow', 'pagamenti', 'fatturato', 'f24'], weight: 3 },
    { words: ['bilancio', 'iva', 'contabilità'], weight: 2 },
  ],
  hr: [
    { words: ['candidato', 'candidati', 'recruiting', 'onboarding', 'curriculum', 'selezione'], weight: 3 },
    { words: ['annuncio lavoro', 'annunci lavoro', 'costo aziendale', 'personale'], weight: 3 },
    { words: ['dipendente', 'dipendenti', 'stipendio', 'stipendi', 'ferie', 'permessi'], weight: 2 },
  ],
  legal: [
    { words: ['compliance', 'gdpr', 'privacy', 'normativa', 'giuridica'], weight: 3 },
    { words: ['contratto', 'contratti', 'clausola', 'legale'], weight: 2 },
  ],
  documentale: [
    { words: ['documento', 'documenti', 'archivio', 'documentale'], weight: 2 },
    { words: ['articolo', 'articoli', 'codice civile', 'normativa', 'legge', 'regolamento'], weight: 3 },
    { words: ['bibbia', 'vangelo', 'capitolo', 'versetto', 'sezione'], weight: 3 },
    { words: ['cerca nel', 'nel documento', 'nei documenti', 'contenuto', 'riassumi'], weight: 2 },
    { words: ['manuale', 'procedura', 'specifica'], weight: 2 },
  ],
  email: [
    { words: ['email', 'e-mail', 'mail', 'posta', 'inbox', 'casella'], weight: 3 },
    { words: ['invia email', 'invia mail', 'manda mail', 'scrivi mail', 'leggi mail', 'leggi email'], weight: 4 },
  ],
  pianificazione: [
    { words: ['viaggio', 'viaggi', 'pianificazione', 'pianifica', 'piano trasporti', 'planner'], weight: 4 },
    { words: ['autista', 'autisti', 'conducente', 'conducenti', 'camionista', 'camionisti'], weight: 4 },
    { words: ['semirimorchio', 'semirimorchi', 'rimorchio', 'targa', 'mezzo', 'camion'], weight: 3 },
    { words: ['carico', 'scarico', 'consegna', 'ritiro', 'trasporto', 'spedizione'], weight: 2 },
    { words: ['gps', 'posizione', 'tracking', 'traccia', 'dove si trova', 'localizzazione'], weight: 3 },
    { words: ['silos', 'rotocella', 'centinato', 'portacontainer', 'ribaltabile'], weight: 3 },
    { words: ['assegnazione', 'assegna', 'ottimizza', 'ottimizzazione'], weight: 3 },
    { words: ['flotta', 'parco mezzi', 'eu 561', 'ore guida'], weight: 3 },
  ],
  whatsapp: [
    { words: ['whatsapp', 'wapp', 'whapp'], weight: 4 },
    { words: ['invia whatsapp', 'manda whatsapp', 'vocale whatsapp'], weight: 5 },
  ],
  tts: [
    { words: ['tts', 'sintesi vocale', 'voce', 'leggi ad alta voce', 'pronuncia'], weight: 3 },
    { words: ['lista voci', 'imposta voce', 'clona voce'], weight: 4 },
  ],
  general: [
    { words: ['che ore', 'che ora', 'che giorno', 'che data', 'ora esatta', 'data oggi', 'ore sono', 'giorno è'], weight: 4 },
    { words: ['meteo', 'tempo fa', 'previsioni', 'temperatura', 'piove', 'che tempo'], weight: 4 },
    { words: ['genera pdf'], weight: 3 },
    { words: ['ciao', 'buongiorno', 'buonasera', 'grazie', 'salve'], weight: 1 },
  ],
  it: [
    { words: ['costi api', 'openrouter', 'token', 'agente autonomo', 'workflow'], weight: 3 },
    { words: ['utenti sistema', 'configurazione', 'debug', 'diagnostica'], weight: 2 },
  ],
  doctor: [
    { words: ['diagnostica', 'salute dati', 'check-up', 'performance sistema'], weight: 3 },
    { words: ['job falliti', 'stato servizi', 'errori sistema'], weight: 3 },
  ],
}

const SCORE_THRESHOLD_CONFIDENT = 4   // >= 4: route directly (no LLM)
const SCORE_THRESHOLD_MULTI = 4       // secondary domains with >= 4 included in multi-agent

function scoreClassify(text: string): ClassificationResult | null {
  const t = text.toLowerCase()
  const scores: Record<string, number> = {}

  for (const [domain, groups] of Object.entries(DOMAIN_KEYWORDS)) {
    let score = 0
    for (const group of groups) {
      for (const keyword of group.words) {
        if (t.includes(keyword)) {
          score += group.weight
        }
      }
    }
    if (score > 0) scores[domain] = score
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1])
  if (sorted.length === 0) return null

  const [topDomain, topScore] = sorted[0]

  // Not confident enough → let LLM decide
  if (topScore < SCORE_THRESHOLD_CONFIDENT) return null

  // Check for multi-domain
  const secondaryDomains = sorted.slice(1)
    .filter(([, score]) => score >= SCORE_THRESHOLD_MULTI)
    .map(([domain]) => domain as AgentDomain)

  const needsMultiAgent = secondaryDomains.length > 0 && topScore < 6

  // Confidence: normalize score (4=0.7, 6=0.85, 8+=0.95)
  const confidence = Math.min(0.95, 0.5 + topScore * 0.075)

  console.log(`[ScoreClassify] Scores: ${sorted.map(([d, s]) => `${d}=${s}`).join(', ')} → ${topDomain} (${confidence.toFixed(2)})${needsMultiAgent ? ' MULTI: ' + secondaryDomains.join(',') : ''}`)

  return {
    domain: topDomain as AgentDomain,
    confidence,
    needsMultiAgent,
    secondaryDomains: needsMultiAgent ? secondaryDomains : [],
  }
}

// ── Response Mode Detection ────────────────────────────

function detectResponseMode(message: string, historyLength: number): ResponseMode {
  const t = message.trim().toLowerCase()

  // ITERATION: confirmations in an active conversation (si, ok, confermo, procedi, etc.)
  // Must check BEFORE minimal — "si" in a conversation is a confirmation, not a greeting
  if (historyLength > 2 && /^(si|sì|ok|confermo|procedi|vai|fallo|manda|invia|elimina|approva|no|annulla)[\s!.]*$/i.test(t)) {
    return 'iteration'
  }

  // MINIMAL: greetings, thanks, ratings, very short acks (only at conversation start)
  if (t.length < 25 && /^(ok|va bene|grazie|thanks|ciao|buon[a-z]*|salve|perfetto|ottimo|capito|chiaro|bene|bravo|fantastico|eccellente)[\s!.]*$/i.test(t)) {
    return 'minimal'
  }
  // Explicit numeric rating — but NOT if in a conversation (likely a menu choice)
  if (historyLength <= 2 && (/^\d{1,2}[\s\-:!.]/.test(t) || /^\d{1,2}$/.test(t))) {
    return 'minimal'
  }

  // ITERATION: continues previous context
  // Single number in conversation = menu choice, not rating
  if (historyLength > 2 && /^\d{1,2}$/.test(t)) {
    return 'iteration'
  }
  if (historyLength > 2 && t.length < 80 && /^(ora|adesso|invece|piuttosto|prova|modifica|cambia|aggiungi|togli|rimuovi|rifai|migliora|correggi|aggiorna|continua|e anche|inoltre|poi|visualizza|mostra|vedi|apri|dettaglio|espandi|fammi vedere|dimmi di più|quali|cosa|come|dove|quando|chi|cerca|elenca|approfondisci)/i.test(t)) {
    return 'iteration'
  }

  return 'full'
}

// ── Classify Intent (LLM-based) ────────────────────────

function getClassificationPrompt() {
  const cn = getSetting('company_name')
  return 'Sei un classificatore di intenti per il gestionale ' + cn + '. ' +
  "Analizza il messaggio dell'utente e classifica il dominio principale. " +
  'I domini disponibili sono:\n' +
  "- pulse: overview aziendale, briefing, riepilogo generale, daily brief, come va l'azienda, stato generale\n" +
  '- commerciale: clienti, lead, pipeline, prospect, vendita, contatti commerciali, brief pre-call, nuovo cliente\n' +
  '- produzione: progetti, ordini, milestone, avanzamento, delivery, deadline, rischi progetto, stato progetto\n' +
  '- marketing: contenuti, campagne, lead scoring, brand, social, immagini, grafiche, genera immagine, crea logo, illustra, post, newsletter\n' +
  '- amministrazione: fatture, conti, liquidita, scadenze fiscali, rimborsi, budget, fornitori, cash flow, pagamenti, fatturato\n' +
  '- hr: candidati, annunci lavoro, recruiting, onboarding, costo aziendale, curriculum, selezione\n' +
  '- legal: analisi giuridica, compliance, interpretazione normativa, GDPR, privacy\n' +
  '- documentale: QUALSIASI richiesta su documenti caricati nel sistema — cerca dentro documenti, riassumi, confronta, analizza contenuto, articoli, clausole, capitoli, versetti. Se l\'utente menziona un documento specifico → documentale.\n' +
  '- email: casella di posta, invio email/mail, lettura email, allegati email, inbox, posta elettronica. SOLO se l\'utente menziona esplicitamente "email", "mail", "posta".\n' +
  '- pianificazione: pianificazione trasporti, viaggi, autisti, semirimorchi, assegnazione mezzi, GPS tracking, flotta, carico/scarico, EU 561, ottimizzazione trasporti\n' +
  '- it: costi API, utenti, ruoli, configurazione, agenti autonomi, workflow, AgentOps\n' +
  '- doctor: diagnostica sistema, salute dati, problemi, errori, check-up, performance, job falliti, stato servizi\n' +
  '- tts: sintesi vocale, text-to-speech, leggi ad alta voce, pronuncia, voce, audio, parla, clona voce\n' +
  '- general: saluti, domande generiche, conversazione\n\n' +
  'IMPORTANTE: Le richieste di generazione immagini vanno SEMPRE a "marketing".\n' +
  'Le richieste di leggere, pronunciare o generare audio vanno SEMPRE a "tts".\n' +
  'Le richieste su contenuto di documenti caricati (di QUALSIASI tipo) vanno SEMPRE a "documentale".\n\n' +
  'DISAMBIGUAZIONE: se il messaggio e\' ambiguo tra piu\' domini, imposta confidence=0.3 e domain="general". L\'agente chiedera\' chiarimenti all\'utente.\n' +
  'Esempi di ambiguita\':\n' +
  '- "manda un messaggio a X" / "scrivi a X" / "contatta X" SENZA specificare il canale → ambiguo tra email e whatsapp → confidence=0.3, domain="general" (l\'agente chiedera\' se via email o WhatsApp)\n' +
  '- "invia mail/email a X" → email (canale esplicito)\n' +
  '- "manda un whatsapp a X" → whatsapp (canale esplicito)\n\n' +
  'MULTI-AGENT: Se la richiesta tocca PIU domini, imposta needsMultiAgent=true e secondaryDomains con i domini aggiuntivi.\n' +
  'Esempi multi-agent:\n' +
  '- "fatturato dei clienti con progetti attivi" → domain="amministrazione", needsMultiAgent=true, secondaryDomains=["commerciale","produzione"]\n' +
  '- "candidati per i ruoli nei nuovi progetti" → domain="hr", needsMultiAgent=true, secondaryDomains=["produzione"]\n' +
  '- "report completo vendite fatture progetti" → domain="pulse", needsMultiAgent=true, secondaryDomains=["commerciale","amministrazione","produzione"]\n' +
  '- "overview con pipeline e scadenze" → domain="pulse", needsMultiAgent=true, secondaryDomains=["commerciale","amministrazione"]\n\n' +
  'CONTESTO: Se nella conversazione recente l\'utente stava interagendo con un agente specifico (es. documentale per analisi documenti, commerciale per clienti), e il nuovo messaggio sembra un follow-up o approfondimento sullo stesso tema, usa LO STESSO dominio. Non cambiare dominio a meno che il tema sia chiaramente diverso.\n\n' +
  'Rispondi SOLO con un JSON valido: {"domain": "...", "confidence": 0.0-1.0, "needsMultiAgent": false, "secondaryDomains": []}'
}

async function classifyIntent(message: string, conversationHistory?: ConversationMessage[]): Promise<ClassificationResult> {
  try {
    let contextText = message
    if (conversationHistory && conversationHistory.length > 0) {
      const recent = conversationHistory.slice(-4)
      contextText = recent.map(m => {
        const content = typeof m.content === 'string' ? m.content.substring(0, 300) : String(m.content).substring(0, 300)
        return `${m.role}: ${content}`
      }).join('\n') + '\nuser: ' + message
    }

    const res = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENROUTER_API_KEY}` },
      body: JSON.stringify({
        model: CLASSIFIER_MODEL,
        messages: [
          { role: 'system', content: getClassificationPrompt() },
          { role: 'user', content: contextText },
        ],
        max_tokens: 150,
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

// ── Image Handling (Gemini — server-side) ──────────────

function isImageAnalysisRequest(text: string): boolean {
  return /analizz|descri|cosa (vedi|c'e|contiene)|spiega.*immag|interpreta|riconosc|identifica|leggi.*immag|esamina/i.test(text)
}

async function callGemini(messages: any[], retries = 3): Promise<any> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: GEMINI_MODEL,
        messages,
        max_tokens: 4096,
      }),
    })

    if (res.status === 429 && attempt < retries - 1) {
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)))
      continue
    }

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Errore Gemini: ${err}`)
    }

    const data = await res.json()
    if (data.error && attempt < retries - 1) {
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)))
      continue
    }
    return data
  }
  throw new Error('Gemini: troppi tentativi falliti')
}

async function handleImageRequest(
  message: string,
  sessionId: string,
  attachedImageBase64?: string
): Promise<ChatResponse> {
  // If image is attached, analyze it
  if (attachedImageBase64) {
    const existing = imageHistory.get(sessionId) || []
    existing.push(attachedImageBase64)
    imageHistory.set(sessionId, existing)

    if (isImageAnalysisRequest(message)) {
      const geminiMessages = [
        { role: 'system', content: "Sei un analista visivo esperto. Analizza l'immagine fornita e rispondi in italiano in modo dettagliato e professionale." },
        { role: 'user', content: [{ type: 'text', text: message }, { type: 'image_url', image_url: { url: attachedImageBase64 } }] },
      ]
      const data = await callGemini(geminiMessages)
      const text = data.choices?.[0]?.message?.content ?? "Non sono riuscito ad analizzare l'immagine."
      return {
        text,
        toolCalls: [{ tool: 'analyze_image', result: { analyzed: true } }],
        agentName: 'Vision Analyst',
        agentDomain: 'marketing',
        agentColor: '#9C27B0',
      }
    }

    // Generate with reference
    const geminiMessages = [
      { role: 'system', content: "Sei un generatore e editor di immagini. Modifica l'immagine esistente secondo le istruzioni dell'utente." },
      { role: 'user', content: [{ type: 'text', text: message }, { type: 'image_url', image_url: { url: attachedImageBase64 } }] },
    ]
    const data = await callGemini(geminiMessages)
    const msg = data.choices?.[0]?.message
    const images = msg?.images ?? []
    const imageUrls = images.map((img: any) => img?.image_url?.url || img).filter(Boolean) as string[]

    if (sessionId && imageUrls.length > 0) {
      for (const url of imageUrls) {
        const existing = imageHistory.get(sessionId) || []
        existing.push(url)
        imageHistory.set(sessionId, existing)
      }
    }

    return {
      text: msg?.content || "Ecco l'immagine modificata:",
      toolCalls: imageUrls.map((url: string, i: number) => ({ tool: 'generate_image', result: { image_url: url, index: i } })),
      agentName: 'Image Editor',
      agentDomain: 'marketing',
      agentColor: '#E91E63',
    }
  }

  // Check if rework of previous image
  const lastImages = imageHistory.get(sessionId)
  const lastImage = lastImages && lastImages.length > 0 ? lastImages[lastImages.length - 1] : null
  const isRework = lastImage && /modifica|cambia|rifai|migliora|aggiungi|togli|rielabora|trasforma/i.test(message)

  let geminiMessages: any[]
  if (isRework && lastImage) {
    geminiMessages = [
      { role: 'system', content: "Sei un generatore e editor di immagini. Modifica l'immagine esistente secondo le istruzioni dell'utente." },
      { role: 'user', content: [{ type: 'text', text: message }, { type: 'image_url', image_url: { url: lastImage } }] },
    ]
  } else {
    geminiMessages = [
      { role: 'system', content: "Sei un generatore di immagini. Crea l'immagine richiesta dall'utente." },
      { role: 'user', content: message },
    ]
  }

  const data = await callGemini(geminiMessages)
  const msg = data.choices?.[0]?.message
  const images = msg?.images ?? []
  const imageUrls = images.map((img: any) => img?.image_url?.url || img).filter(Boolean) as string[]

  if (sessionId && imageUrls.length > 0) {
    for (const url of imageUrls) {
      const existing = imageHistory.get(sessionId) || []
      existing.push(url)
      imageHistory.set(sessionId, existing)
    }
  }

  const responseText = msg?.content || (isRework ? "Ecco l'immagine modificata:" : "Ecco l'immagine generata:")

  return {
    text: responseText,
    toolCalls: imageUrls.map((url: string, i: number) => ({ tool: 'generate_image', result: { image_url: url, index: i } })),
    agentName: isRework ? 'Image Editor' : 'Image Generator',
    agentDomain: 'marketing',
    agentColor: '#E91E63',
  }
}

// ── Synthesize Multi-Agent Results ─────────────────────

async function synthesizeResults(
  message: string,
  agentResults: { agentName: string; text: string }[]
): Promise<string> {
  const systemPrompt =
    "Sei l'assistente di " + getSetting('company_name') + ". Hai ricevuto risposte da diversi agenti specializzati. " +
    'Sintetizza le risposte in un unico messaggio coerente e completo in italiano. ' +
    'Mantieni tutte le informazioni importanti e presenta i dati in modo chiaro.'

  const agentSummary = agentResults
    .map(r => `--- ${r.agentName} ---\n${r.text}`)
    .join('\n\n')

  try {
    const res = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENROUTER_API_KEY}` },
      body: JSON.stringify({
        model: CLASSIFIER_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Domanda originale: ${message}\n\nRisposte degli agenti:\n${agentSummary}` },
        ],
        max_tokens: 4096,
      }),
    })

    if (!res.ok) {
      return agentResults.map(r => `**${r.agentName}:**\n${r.text}`).join('\n\n')
    }

    const data = await res.json()
    return data.choices?.[0]?.message?.content ?? ''
  } catch {
    return agentResults.map(r => `**${r.agentName}:**\n${r.text}`).join('\n\n')
  }
}

// ── Main Orchestrator ──────────────────────────────────

export type ProgressCallback = (event: { type: string; [key: string]: unknown }) => void

export async function orchestrate(
  message: string,
  userId: string,
  aziendaId: string,
  options?: {
    format?: string
    sessionId?: string
    history?: ConversationMessage[]
    attachedImageBase64?: string
    attachedAudioBase64?: string
    onProgress?: ProgressCallback
    permissions?: import('./types.js').UserPermissions
  }
): Promise<ChatResponse> {
  const startTime = Date.now()
  const format = options?.format ?? 'web'
  const sessionId = options?.sessionId ?? ''
  const conversationHistory = options?.history
  const permissions = options?.permissions
  const attachedImageBase64 = options?.attachedImageBase64
  const attachedAudioBase64 = options?.attachedAudioBase64
  const onProgress = options?.onProgress || (() => {})

  const historyLength = (conversationHistory?.length ?? 0) + 1
  console.log(`[Orchestrate] sessionId=${sessionId}, historyLength=${historyLength}, message="${message.substring(0, 50)}"`)

  // ── Safety Gate: Input Check ──
  const inputCheck = checkInput(message)
  if (!inputCheck.safe) {
    return {
      text: inputCheck.reason || 'Richiesta bloccata per motivi di sicurezza.',
      toolCalls: [], agentName: 'Sistema', agentDomain: 'general', agentColor: AGENT_COLORS.general,
    }
  }

  // Helper: finalize result with signal capture, hooks, and suggestions
  const finalizeResult = async (result: ChatResponse, classification?: ClassificationResult): Promise<ChatResponse> => {
    const latencyMs = Date.now() - startTime
    const toolsUsed = result.toolCalls.map(t => (t as Record<string, unknown>).tool).filter(Boolean) as string[]

    // ── Safety Gate: Output Check ──
    const outputCheck = checkOutput(result.text, format)
    if (outputCheck.masked.length > 0) {
      result.text = outputCheck.filtered
      console.log(`[Safety] Masked PII in ${format} output:`, outputCheck.masked.length, 'items')
    }

    // Capture signal (fire-and-forget)
    captureSignal(aziendaId, userId, {
      sessionId,
      domain: result.agentDomain,
      confidence: classification?.confidence ?? 1.0,
      tools: toolsUsed,
      latencyMs,
      agentName: result.agentName,
      cost: result.totalCost ?? 0,
      tokens: result.totalTokens ?? 0,
    })

    // Run post_execute hook
    const hookCtx: HookContext = {
      messages: conversationHistory ? [...conversationHistory, { role: 'user', content: message }] : [{ role: 'user', content: message }],
      domain: result.agentDomain,
      confidence: classification?.confidence,
      agentName: result.agentName,
      toolCalls: result.toolCalls,
      result: { text: result.text, toolCalls: result.toolCalls },
      sessionId,
      startTime,
    }
    await runHooks('post_execute', hookCtx)

    // Get rule-based suggestions
    const suggestions = getSuggestions(result.agentDomain, toolsUsed)

    // Save session context (fire-and-forget)
    if (sessionId) {
      const summary = `Dominio: ${result.agentDomain}\nAgente: ${result.agentName}\nTools usati: ${toolsUsed.join(', ')}\nRisposta: ${result.text.substring(0, 200)}...`
      try { saveSessionContext(aziendaId, userId, sessionId, summary) } catch {}
    }

    // Cache domain for ITERATION mode
    if (sessionId && result.agentDomain !== 'general') {
      setSessionDomain(sessionId, result.agentDomain as AgentDomain)
    }

    return { ...result, suggestions }
  }

  // ── If an image is attached, handle image analysis/generation ──
  if (attachedImageBase64) {
    const result = await handleImageRequest(message, sessionId, attachedImageBase64)
    return finalizeResult(result)
  }

  // ── Response Mode Routing ──
  const responseMode = detectResponseMode(message, historyLength)
  const cachedDomain = sessionId ? getSessionDomain(sessionId) : undefined
  console.log(`[Orchestrate] responseMode=${responseMode}, cachedDomain=${cachedDomain || 'none'}`)

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
          domain: getSessionDomain(sessionId) || 'general',
        })
        const response = rating >= 7
          ? 'Grazie per il feedback positivo!'
          : rating >= 4
            ? 'Grazie, terro conto del tuo feedback per migliorare.'
            : 'Mi dispiace. Cerchero di fare meglio la prossima volta.'
        return {
          text: response, toolCalls: [], agentName: 'Assistente',
          agentDomain: 'general', agentColor: AGENT_COLORS.general,
          suggestions: getSuggestions('general', []),
        }
      }
    }

    // Quick minimal response, no classification, no tools
    const context = buildContext('pulse', aziendaId, userId, sessionId)
    const minimalText = await directLLMResponse(message, context, conversationHistory, onProgress)
    return {
      text: minimalText, toolCalls: [], agentName: 'Assistente',
      agentDomain: 'general', agentColor: AGENT_COLORS.general,
      suggestions: getSuggestions('general', []),
    }
  }

  // ── ITERATION mode: reuse last domain ──
  if (responseMode === 'iteration' && sessionId) {
    // Check keywords first — they override session domain if they match
    const scoreOverride = scoreClassify(message)
    const lastDomain = scoreOverride?.domain || getSessionDomain(sessionId)
    if (lastDomain && lastDomain !== 'general' && lastDomain !== 'image' as any && lastDomain !== 'tts') {
      const agent = AGENTS[lastDomain]
      if (agent) {
        // Check agent permission
        if (permissions && !permissions.canAgent('chat', lastDomain)) {
          return { text: `Non hai accesso all'agente **${agent.name}**. Contatta l'amministratore per richiedere i permessi.`, toolCalls: [], agentName: 'Sistema', agentDomain: 'general', agentColor: AGENT_COLORS.general }
        }
        const context = buildContext(lastDomain, aziendaId, userId, sessionId)
        const result = await executeAgent(message, agent, aziendaId, userId, context, format, conversationHistory, onProgress, permissions, sessionId)
        return finalizeResult(result)
      }
    }
    // fallback to full classification
  }

  // ── FULL: Classify → Agent-Native Tool Calling ──
  onProgress({ type: 'status', content: 'Classificazione dominio...' })

  // Try fast score-based classification first; fallback to LLM if unsure
  const scoreResult = scoreClassify(message)
  let classification: ClassificationResult = scoreResult || await classifyIntent(message, conversationHistory)

  // Session continuity: if cached domain exists and classifier returned general/low confidence,
  // prefer the session domain (user is likely continuing the same conversation topic)
  const sessionDomain = sessionId ? getSessionDomain(sessionId) : undefined
  if (sessionDomain && sessionDomain !== 'general' && (classification.domain === 'general' || classification.confidence < 0.6)) {
    console.log(`[Classify] Session continuity: ${classification.domain} (${classification.confidence.toFixed(2)}) → ${sessionDomain} (cached)`)
    classification = { domain: sessionDomain, confidence: 0.75, needsMultiAgent: false }
  }

  // Normalize domain aliases
  if (classification.domain === 'image' as any) classification.domain = 'marketing' as AgentDomain
  if (classification.domain === 'documents' as any) classification.domain = 'documentale' as AgentDomain

  // Very low confidence + no session context → route to general with disambiguation hint
  if (classification.confidence <= 0.4) {
    const lastDomain = sessionId ? getSessionDomain(sessionId) : undefined
    if (!lastDomain || lastDomain === 'general') {
      console.log(`[Classify] Very low confidence (${classification.confidence}), routing to general for disambiguation`)
      classification = { domain: 'general', confidence: 0.5, needsMultiAgent: false }
      // Prepend disambiguation context to the message so the agent knows to ask
      message = `[SISTEMA: La richiesta dell'utente e' ambigua — non e' chiaro quale azione o agente serva. Chiedi chiarimenti all'utente presentando le opzioni possibili. NON procedere con un'azione specifica senza conferma.]\n\n${message}`
    }
  }

  // Low confidence + session has previous domain → prefer session domain (contextual continuity)
  if (classification.confidence < 0.7 && sessionId) {
    const lastDomain = getSessionDomain(sessionId)
    if (lastDomain && lastDomain !== 'general') {
      console.log(`[Classify] Low confidence (${classification.confidence}), using session domain: ${lastDomain}`)
      classification = { domain: lastDomain, confidence: 0.8, needsMultiAgent: false }
    }
  }

  // If not already documentale, check if the query might relate to a loaded document
  // This prevents non-RAG agents from hallucinating document content
  if (classification.domain !== 'documentale' && classification.domain !== 'legal') {
    try {
      const msgLower = message.toLowerCase()
      // Quick check: does the query mention any document name in the system?
      const docs = db.prepare(
        "SELECT display_name FROM entity WHERE type = 'documento' AND azienda_id = (SELECT DISTINCT azienda_id FROM entity WHERE type = 'chunk' LIMIT 1)"
      ).all() as any[]
      const mentionsDoc = docs.some((d: any) => {
        const words = d.display_name.toLowerCase().replace(/\.[^.]+$/, '').split(/[\s_-]+/)
        return words.some((w: string) => w.length > 3 && msgLower.includes(w))
      })
      if (mentionsDoc) {
        console.log(`[Classify] Query mentions a document name → routing to documentale`)
        classification = { domain: 'documentale' as AgentDomain, confidence: 0.9, needsMultiAgent: false }
      }
    } catch {}
  }

  // Run post_classify hook
  const hookCtx: HookContext = {
    messages: conversationHistory ? [...conversationHistory, { role: 'user', content: message }] : [{ role: 'user', content: message }],
    domain: classification.domain,
    confidence: classification.confidence,
    sessionId,
  }
  await runHooks('post_classify', hookCtx)

  // General agent now goes through full agent execution (has tools including web_search)

  // ── Multi-agent execution ──
  if (classification.needsMultiAgent && classification.secondaryDomains && classification.secondaryDomains.length > 0) {
    const allDomains: AgentDomain[] = [classification.domain, ...classification.secondaryDomains]
    const uniqueDomains = [...new Set(allDomains)].filter(d => d !== 'general' && (!permissions || permissions.canAgent('chat', d)))

    const agentPromises = uniqueDomains
      .map(async (domain) => {
        const agent = AGENTS[domain]
        if (!agent) return null
        const context = buildContext(domain, aziendaId, userId, sessionId)
        return executeAgent(message, agent, aziendaId, userId, context, format, conversationHistory, undefined, permissions, sessionId)
      })
      .filter(p => p !== null)

    const results = await Promise.all(agentPromises)
    const validResults = results.filter(r => r !== null)

    if (validResults.length === 0) {
      const context = buildContext('pulse', aziendaId, userId, sessionId)
      const text = await directLLMResponse(message, context, conversationHistory, onProgress)
      return finalizeResult({ text, toolCalls: [], agentName: 'Assistente', agentDomain: 'general', agentColor: AGENT_COLORS.general }, classification)
    }

    const allToolCalls = validResults.flatMap(r => r.toolCalls)
    const synthesized = await synthesizeResults(message, validResults.map(r => ({ agentName: r.agentName, text: r.text })))

    const result: ChatResponse = {
      text: synthesized,
      toolCalls: allToolCalls,
      agentName: validResults.map(r => r.agentName).join(' + '),
      agentDomain: classification.domain,
      agentColor: AGENT_COLORS[classification.domain] || AGENT_COLORS.general,
    }
    return finalizeResult(result, classification)
  }

  // ── Single agent — direct execution with native tool calling ──
  const agent = AGENTS[classification.domain] || AGENTS.pulse || AGENTS.general

  // Check agent permission
  if (permissions && !permissions.canAgent('chat', classification.domain)) {
    return {
      text: `Non hai accesso all'agente **${agent.name}** (${classification.domain}). Contatta l'amministratore per richiedere i permessi.`,
      toolCalls: [], agentName: 'Sistema', agentDomain: 'general', agentColor: AGENT_COLORS.general,
    }
  }

  onProgress({ type: 'agent', content: `${agent.name} sta elaborando...`, domain: classification.domain, agentName: agent.name, agentColor: agent.color })

  // Context with 5min cache + system summary
  const cacheKey = `${classification.domain}:${aziendaId}:${sessionId}`
  const cached = contextCache.get(cacheKey)
  let context: string
  if (cached && Date.now() - cached.ts < 300000) {
    context = cached.content
  } else {
    const systemSummary = generatePlannerContext(aziendaId)
    context = buildContext(classification.domain, aziendaId, userId, sessionId) + '\n\n' + systemSummary
    contextCache.set(cacheKey, { content: context, ts: Date.now() })
  }

  // Agent calls tools natively — no pre-execution, no planner
  const result = await executeAgent(message, agent, aziendaId, userId, context, format, conversationHistory, onProgress, permissions, sessionId)

  // Reasoning comes directly from agent's native tool loop
  if (result.reasoning) {
    result.reasoning.latencyMs = Date.now() - startTime
  }

  return finalizeResult(result, classification)
}
