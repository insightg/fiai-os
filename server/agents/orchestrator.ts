import type { AgentDomain, ClassificationResult, ChatResponse } from './types.js'
import { AGENTS, AGENT_COLORS } from './config.js'
import { buildContext, saveSessionContext, captureSignal } from './context.js'
import { runHooks, type HookContext } from './hooks.js'
import { getSuggestions } from './suggestions.js'
import { executeAgent, directLLMResponse } from './base-agent.js'
import { createPlan, executePlan, formatPlanResults } from './planner.js'
import db from '../db.js'

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const CLASSIFIER_MODEL = 'anthropic/claude-haiku-4.5'
const GEMINI_MODEL = 'google/gemini-3.1-flash-image-preview'

const VALID_DOMAINS: AgentDomain[] = ['pulse', 'commerciale', 'produzione', 'marketing', 'amministrazione', 'hr', 'legal', 'documents', 'infra', 'general', 'image', 'tts']

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
  // Everything else → let the planner decide
  return null
}

// ── Response Mode Detection ────────────────────────────

function detectResponseMode(message: string, historyLength: number): ResponseMode {
  const t = message.trim().toLowerCase()

  // MINIMAL: greetings, thanks, ratings, very short acks
  if (t.length < 25 && /^(ok|va bene|grazie|thanks|ciao|buon[a-z]*|salve|perfetto|ottimo|capito|chiaro|si|si|no|bene|bravo|fantastico|eccellente)[\s!.]*$/i.test(t)) {
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
  if (historyLength > 2 && /^(ora|adesso|invece|piuttosto|prova|modifica|cambia|aggiungi|togli|rimuovi|rifai|migliora|correggi|aggiorna|continua|e anche|inoltre|poi)/i.test(t)) {
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
  '- legal: contratti, clausole, normative, compliance, documenti legali, privacy, GDPR, analisi contratto, ricerca documenti, riassumi documento, confronta documenti, contenuto documento\n' +
  '- infra: costi API, performance sistema, monitoring agenti, utenti, ruoli, configurazione, AgentOps\n' +
  '- tts: sintesi vocale, text-to-speech, leggi ad alta voce, pronuncia, voce, audio, parla, clona voce\n' +
  '- general: saluti, domande generiche, conversazione\n\n' +
  'IMPORTANTE: Le richieste di generazione immagini vanno SEMPRE a "marketing".\n' +
  'Le richieste di leggere, pronunciare o generare audio vanno SEMPRE a "tts".\n\n' +
  'MULTI-AGENT: Se la richiesta tocca PIU domini, imposta needsMultiAgent=true e secondaryDomains con i domini aggiuntivi.\n' +
  'Esempi multi-agent:\n' +
  '- "fatturato dei clienti con progetti attivi" → domain="amministrazione", needsMultiAgent=true, secondaryDomains=["commerciale","produzione"]\n' +
  '- "candidati per i ruoli nei nuovi progetti" → domain="hr", needsMultiAgent=true, secondaryDomains=["produzione"]\n' +
  '- "report completo vendite fatture progetti" → domain="pulse", needsMultiAgent=true, secondaryDomains=["commerciale","amministrazione","produzione"]\n' +
  '- "overview con pipeline e scadenze" → domain="pulse", needsMultiAgent=true, secondaryDomains=["commerciale","amministrazione"]\n\n' +
  'Rispondi SOLO con un JSON valido: {"domain": "...", "confidence": 0.0-1.0, "needsMultiAgent": false, "secondaryDomains": []}'

async function classifyIntent(message: string, conversationHistory?: ConversationMessage[]): Promise<ClassificationResult> {
  try {
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
  }
): Promise<ChatResponse> {
  const startTime = Date.now()
  const format = options?.format ?? 'web'
  const sessionId = options?.sessionId ?? ''
  const conversationHistory = options?.history
  const attachedImageBase64 = options?.attachedImageBase64
  const attachedAudioBase64 = options?.attachedAudioBase64

  const historyLength = (conversationHistory?.length ?? 0) + 1

  // Helper: finalize result with signal capture, hooks, and suggestions
  const finalizeResult = async (result: ChatResponse, classification?: ClassificationResult): Promise<ChatResponse> => {
    const latencyMs = Date.now() - startTime
    const toolsUsed = result.toolCalls.map(t => (t as Record<string, unknown>).tool).filter(Boolean) as string[]

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

  // ── FULL: Planner LLM → plan + execute + synthesize ──
  // Quick classify can override domain for specific cases (TTS)
  const quickDomain = quickClassifyKeywords(message)

  const plan = await createPlan(message, conversationHistory)
  let planDomain = (quickDomain || plan.domain) as AgentDomain
  if (planDomain === 'image' as any) planDomain = 'marketing' as AgentDomain
  if (planDomain === 'documents' as any) planDomain = 'legal' as AgentDomain

  const classification: ClassificationResult = {
    domain: planDomain || 'general',
    confidence: quickDomain ? 0.95 : 0.9,
    needsMultiAgent: false,
  }

  // Run post_classify hook
  const hookCtx: HookContext = {
    messages: conversationHistory ? [...conversationHistory, { role: 'user', content: message }] : [{ role: 'user', content: message }],
    domain: classification.domain,
    confidence: classification.confidence,
    sessionId,
  }
  await runHooks('post_classify', hookCtx)

  // ── TTS — handled by TTS agent (no hardcoded logic) ──
  // (The TTS agent in config.ts has tools: list_voices, set_voice, get_current_voice, clone_voice, generate_tts)
  // It goes through the standard agent execution path below.

  // ── General — direct LLM response (but execute plan steps if any) ──
  if (classification.domain === 'general' && plan.steps.length === 0) {
    const context = buildContext('pulse', aziendaId, userId, sessionId)
    const text = await directLLMResponse(message, context, conversationHistory)
    const result: ChatResponse = {
      text, toolCalls: [], agentName: 'Assistente FIAI',
      agentDomain: 'general', agentColor: AGENT_COLORS.general,
    }
    return finalizeResult(result, classification)
  }

  // ── Multi-agent execution ──
  if (classification.needsMultiAgent && classification.secondaryDomains && classification.secondaryDomains.length > 0) {
    const allDomains: AgentDomain[] = [classification.domain, ...classification.secondaryDomains]
    const uniqueDomains = [...new Set(allDomains)].filter(d => d !== 'general')

    const agentPromises = uniqueDomains
      .map(async (domain) => {
        const agent = AGENTS[domain]
        if (!agent) return null
        const context = buildContext(domain, aziendaId, userId, sessionId)
        return executeAgent(message, agent, aziendaId, userId, context, format, conversationHistory)
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

  // ── Execute plan + synthesize with domain agent ──
  const agent = AGENTS[classification.domain] || AGENTS.pulse

  // Context with 60s cache
  const cacheKey = `${classification.domain}:${aziendaId}:${sessionId}`
  const cached = contextCache.get(cacheKey)
  let context: string
  if (cached && Date.now() - cached.ts < 60000) {
    context = cached.content
  } else {
    context = buildContext(classification.domain, aziendaId, userId, sessionId)
    contextCache.set(cacheKey, { content: context, ts: Date.now() })
  }

  // Execute plan steps (if any)
  let planContext = ''
  const allToolCalls: Record<string, unknown>[] = []
  const reasoningSteps: { tool: string; description: string; result_summary: string }[] = []

  if (plan.steps.length > 0) {
    const planResults = await executePlan(plan, aziendaId)
    planContext = '\n\nRISULTATI TOOL (già eseguiti dal planner):\n' + formatPlanResults(plan, planResults)

    for (const pr of planResults) {
      allToolCalls.push({ tool: pr.step.tool, result: pr.result })
      // Build reasoning step summary
      let summary = ''
      if (pr.error) summary = `Errore: ${pr.error}`
      else if (Array.isArray(pr.result)) summary = `${pr.result.length} risultati`
      else if (pr.result && typeof pr.result === 'object') {
        const r = pr.result as any
        if (r.successo) summary = r.messaggio || 'OK'
        else if (r.errore) summary = r.errore
        else summary = Object.keys(r).slice(0, 3).join(', ')
      } else summary = String(pr.result || '').substring(0, 60)
      reasoningSteps.push({ tool: pr.step.tool, description: pr.step.description, result_summary: summary })
    }
  }

  // Agent synthesizes: gets the message + plan results as context
  const agentMessage = plan.steps.length > 0
    ? message + planContext
    : message

  const result = await executeAgent(agentMessage, agent, aziendaId, userId, context, format, conversationHistory)

  // Planner tool calls go into reasoning only (not shown as visible cards)
  // Only the agent's own tool calls (if any) stay in toolCalls for rendering

  // Attach reasoning info with planner results
  if (plan.steps.length > 0) {
    result.reasoning = {
      steps: reasoningSteps,
      domain: plan.domain,
      thinking: plan.reasoning,
      latencyMs: Date.now() - startTime,
    }
  }

  return finalizeResult(result, classification)
}
