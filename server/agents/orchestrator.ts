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

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const CLASSIFIER_MODEL = 'anthropic/claude-haiku-4.5'
const GEMINI_MODEL = 'google/gemini-3.1-flash-image-preview'

const VALID_DOMAINS: AgentDomain[] = ['pulse', 'commerciale', 'produzione', 'marketing', 'amministrazione', 'hr', 'legal', 'documents', 'it', 'doctor', 'general', 'image', 'tts']

interface ConversationMessage {
  role: string
  content: string
}

type ResponseMode = 'minimal' | 'iteration' | 'full'

// ── Caches ─────────────────────────────────────────────
const sessionDomainCache = new Map<string, AgentDomain>()
const contextCache = new Map<string, { content: string; ts: number }>()

// ── Image History (for analysis/rework) ────────────────
const imageHistory = new Map<string, string[]>()

// ── Quick Classify Keywords (instant, no LLM call) ─────

// Minimal fast-path — only for cases where the planner would waste time
// All business domain routing is handled by the planner LLM
function quickClassifyKeywords(text: string): AgentDomain | null {
  const t = text.toLowerCase().trim()
  // TTS keywords → route to TTS agent
  if (/\btts\b|sintesi vocale|lista voci|imposta voce|clona.*voce|voce predefinita/.test(t)) return 'tts'
  // WhatsApp keywords → route to WhatsApp agent (MUST have send tools)
  if (/\bwhatsapp\b|\bwhapp\b|\bwapp\b|manda.*(?:a|via)\s|invia.*(?:a|via)\s.*(?:messaggio|vocale|immagine|documento|video)|manda.*messaggio/i.test(t)) return 'whatsapp'
  // Document keywords → route to Documentale (has retrieve, list_documents, explore_document)
  // Catches ANY reference to documents, books, or content search — regardless of topic
  if (/\bbibbia\b|\bcodice civile\b|\bcontratto\b|\bnormativa\b|\bmanuale\b|\breport\b|\blibro\b/i.test(t)) return 'documentale'
  if (/analizza.*document|cerca.*document|cerca.*dentro|contenuto.*document|riassumi.*document/i.test(t)) return 'documentale'
  if (/\barticol[oi]\b|\bclausol[ae]\b|\bcapitolo\b|\bversett[oi]\b|\bvangel[oi]\b|\bsezione\b/i.test(t)) return 'documentale'
  if (/cosa dice|cosa racconta|parlami di.*nel|racconta.*dal|cerca nel|nel documento|nei documenti|dall[ae].*document/i.test(t)) return 'documentale'
  if (/document[oi]|archivio|caricato|upload/i.test(t) && /cerca|analizza|riassumi|leggi|mostra|confronta|spiega/i.test(t)) return 'documentale'
  // Everything else → let the classifier decide
  return null
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
  '- legal: analisi giuridica, compliance, interpretazione normativa, GDPR, privacy\n' +
  '- documentale: QUALSIASI richiesta su documenti caricati nel sistema — cerca dentro documenti, riassumi, confronta, analizza contenuto, articoli, clausole, capitoli, versetti. Vale per QUALSIASI tipo di documento: legale, religioso, letterario, tecnico, scientifico. Se l\'utente menziona un documento specifico (bibbia, codice civile, contratto, report, manuale, libro) → documentale. Se chiede "cosa dice", "cerca dentro", "racconta", "analizza", "riassumi" riferito a un documento → documentale.\n' +
  '- it: costi API, utenti, ruoli, configurazione, agenti autonomi, workflow, AgentOps\n' +
  '- doctor: diagnostica sistema, salute dati, problemi, errori, check-up, performance, job falliti, stato servizi\n' +
  '- tts: sintesi vocale, text-to-speech, leggi ad alta voce, pronuncia, voce, audio, parla, clona voce\n' +
  '- general: saluti, domande generiche, conversazione\n\n' +
  'IMPORTANTE: Le richieste di generazione immagini vanno SEMPRE a "marketing".\n' +
  'Le richieste di leggere, pronunciare o generare audio vanno SEMPRE a "tts".\n' +
  'Le richieste su contenuto di documenti caricati (di QUALSIASI tipo — religioso, letterario, tecnico, legale) vanno SEMPRE a "documentale".\n\n' +
  'MULTI-AGENT: Se la richiesta tocca PIU domini, imposta needsMultiAgent=true e secondaryDomains con i domini aggiuntivi.\n' +
  'Esempi multi-agent:\n' +
  '- "fatturato dei clienti con progetti attivi" → domain="amministrazione", needsMultiAgent=true, secondaryDomains=["commerciale","produzione"]\n' +
  '- "candidati per i ruoli nei nuovi progetti" → domain="hr", needsMultiAgent=true, secondaryDomains=["produzione"]\n' +
  '- "report completo vendite fatture progetti" → domain="pulse", needsMultiAgent=true, secondaryDomains=["commerciale","amministrazione","produzione"]\n' +
  '- "overview con pipeline e scadenze" → domain="pulse", needsMultiAgent=true, secondaryDomains=["commerciale","amministrazione"]\n\n' +
  'CONTESTO: Se nella conversazione recente l\'utente stava interagendo con un agente specifico (es. documentale per analisi documenti, commerciale per clienti), e il nuovo messaggio sembra un follow-up o approfondimento sullo stesso tema, usa LO STESSO dominio. Non cambiare dominio a meno che il tema sia chiaramente diverso.\n\n' +
  'Rispondi SOLO con un JSON valido: {"domain": "...", "confidence": 0.0-1.0, "needsMultiAgent": false, "secondaryDomains": []}'

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
          { role: 'system', content: CLASSIFICATION_PROMPT },
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
    "Sei l'assistente AI di FIAI. Hai ricevuto risposte da diversi agenti specializzati. " +
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
    format?: 'web' | 'whatsapp'
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
      sessionDomainCache.set(sessionId, result.agentDomain as AgentDomain)
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
          agentDomain: 'general', agentColor: AGENT_COLORS.general,
          suggestions: getSuggestions('general', []),
        }
      }
    }

    // Quick minimal response, no classification, no tools
    const context = buildContext('pulse', aziendaId, userId, sessionId)
    const minimalText = await directLLMResponse(message, context, conversationHistory)
    return {
      text: minimalText, toolCalls: [], agentName: 'Assistente FIAI',
      agentDomain: 'general', agentColor: AGENT_COLORS.general,
      suggestions: getSuggestions('general', []),
    }
  }

  // ── ITERATION mode: reuse last domain ──
  if (responseMode === 'iteration' && sessionId) {
    const lastDomain = sessionDomainCache.get(sessionId)
    if (lastDomain && lastDomain !== 'general' && lastDomain !== 'image' && lastDomain !== 'tts') {
      const agent = AGENTS[lastDomain]
      if (agent) {
        const context = buildContext(lastDomain, aziendaId, userId, sessionId)
        const result = await executeAgent(message, agent, aziendaId, userId, context, format, conversationHistory)
        return finalizeResult(result)
      }
    }
    // fallback to full classification
  }

  // ── FULL: Classify → Agent-Native Tool Calling ──
  onProgress({ type: 'status', content: 'Classificazione dominio...' })
  const quickDomain = quickClassifyKeywords(message)

  let classification: ClassificationResult = quickDomain
    ? { domain: quickDomain as AgentDomain, confidence: 0.95, needsMultiAgent: false }
    : await classifyIntent(message, conversationHistory)

  // Normalize domain aliases
  if (classification.domain === 'image' as any) classification.domain = 'marketing' as AgentDomain
  if (classification.domain === 'documents' as any) classification.domain = 'documentale' as AgentDomain

  // Low confidence + session has previous domain → prefer session domain (contextual continuity)
  if (classification.confidence < 0.7 && sessionId) {
    const lastDomain = sessionDomainCache.get(sessionId)
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
    const uniqueDomains = [...new Set(allDomains)].filter(d => d !== 'general')

    const agentPromises = uniqueDomains
      .map(async (domain) => {
        const agent = AGENTS[domain]
        if (!agent) return null
        const context = buildContext(domain, aziendaId, userId, sessionId)
        return executeAgent(message, agent, aziendaId, userId, context, format, conversationHistory, undefined, permissions)
      })
      .filter(p => p !== null)

    const results = await Promise.all(agentPromises)
    const validResults = results.filter(r => r !== null)

    if (validResults.length === 0) {
      const context = buildContext('pulse', aziendaId, userId, sessionId)
      const text = await directLLMResponse(message, context, conversationHistory)
      return finalizeResult({ text, toolCalls: [], agentName: 'Assistente FIAI', agentDomain: 'general', agentColor: AGENT_COLORS.general }, classification)
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
  const agent = AGENTS[classification.domain] || AGENTS.pulse
  onProgress({ type: 'agent', content: `${agent.name} sta elaborando...`, domain: classification.domain, agentName: agent.name, agentColor: agent.color })

  // Context with 60s cache + system summary
  const cacheKey = `${classification.domain}:${aziendaId}:${sessionId}`
  const cached = contextCache.get(cacheKey)
  let context: string
  if (cached && Date.now() - cached.ts < 60000) {
    context = cached.content
  } else {
    const systemSummary = generatePlannerContext(aziendaId)
    context = buildContext(classification.domain, aziendaId, userId, sessionId) + '\n\n' + systemSummary
    contextCache.set(cacheKey, { content: context, ts: Date.now() })
  }

  // Agent calls tools natively — no pre-execution, no planner
  const result = await executeAgent(message, agent, aziendaId, userId, context, format, conversationHistory, onProgress, permissions)

  // Reasoning comes directly from agent's native tool loop
  if (result.reasoning) {
    result.reasoning.latencyMs = Date.now() - startTime
  }

  return finalizeResult(result, classification)
}
