import type { AgentDomain, ClassificationResult } from './types'
import { getAgent, AGENT_COLORS } from './registry'
import { buildFullContext, saveSessionContext, refreshContexts, captureSignal } from './context-client'
import { runHooks, type HookContext } from './hooks'
import { getSuggestions } from './suggestions'

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'
const OPENROUTER_API_KEY = import.meta.env.VITE_OPENROUTER_API_KEY ?? ''
const MODEL = 'z-ai/glm-5'

interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string | object[]
}

interface ToolUseEvent {
  toolName: string
  status: 'running' | 'done'
}

interface OrchestrateResult {
  text: string
  toolCalls: Record<string, unknown>[]
  agentName: string
  agentDomain: string
  agentColor: string
  suggestions?: string[]
}

const CLASSIFICATION_PROMPT =
  'Sei un classificatore di intenti per FIAI, un gestionale aziendale italiano. ' +
  'Analizza il messaggio dell\'utente e classifica il dominio principale. ' +
  'I domini disponibili sono:\n' +
  '- crm: clienti, lead, pipeline commerciale, creazione clienti/lead\n' +
  '- finance: fatture, conti bancari, rimborsi, fatture passive, fatture scadute, riepilogo finanziario, liquidità, pagamenti, approvazione spese\n' +
  '- sales: preventivi, ordini, progetti\n' +
  '- hr: candidati, annunci lavoro, selezione personale, recruiting\n' +
  '- documents: documenti aziendali, ricerca documenti, contratti, archivio\n' +
  '- analytics: dashboard, overview aziendale, fornitori, statistiche generali, riepilogo complessivo\n' +
  '- image: generazione immagini, disegni, illustrazioni, grafiche, loghi, foto, visualizzazioni, analisi/descrizione di immagini generate, rielaborazione immagini, modifica immagini\n' +
  '- tts: sintesi vocale, text-to-speech, leggi ad alta voce, pronuncia, voce, clona voce, audio parlato, leggi questo, dì questo, genera audio\n' +
  '- general: saluti, domande generiche, conversazione, opinioni\n\n' +
  'Rispondi SOLO con un JSON valido nel formato:\n' +
  '{"domain": "nome_dominio", "confidence": 0.0-1.0, "needsMultiAgent": false, "secondaryDomains": []}\n\n' +
  'Se la richiesta coinvolge chiaramente PIU\' domini (es. "dammi fatture e candidati"), ' +
  'imposta needsMultiAgent: true e includi i domini secondari in secondaryDomains.\n' +
  'Se l\'utente chiede di generare, creare, disegnare, analizzare, descrivere o modificare un\'immagine, usa SEMPRE il dominio "image".\n' +
  'Se l\'utente dice "analizzala", "descrivila", "cosa vedi" dopo aver generato un\'immagine, classifica come "image".\n' +
  'Se l\'utente chiede di leggere ad alta voce, pronunciare, generare audio parlato, sintesi vocale, o clonare una voce, usa SEMPRE il dominio "tts".'

async function classifyIntent(messages: ConversationMessage[]): Promise<ClassificationResult> {
  // Use last 3 messages for context
  const recentMessages = messages.slice(-3)
  const contextText = recentMessages
    .map((m) => {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      return `${m.role}: ${content}`
    })
    .join('\n')

  try {
    const res = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: CLASSIFICATION_PROMPT },
          { role: 'user', content: contextText },
        ],
        max_tokens: 256,
      }),
    })

    if (!res.ok) {
      // Fallback to general on classification failure
      return { domain: 'general', confidence: 0.5, needsMultiAgent: false }
    }

    const data = await res.json()
    const text = data.choices?.[0]?.message?.content ?? ''

    // Also check reasoning field (some models put content in reasoning)
    const reasoning = data.choices?.[0]?.message?.reasoning ?? ''
    const fullText = text || reasoning

    const jsonMatch = fullText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.warn('Classification: no JSON found in response, falling back to analytics')
      return { domain: 'analytics', confidence: 0.5, needsMultiAgent: false }
    }

    const parsed = JSON.parse(jsonMatch[0]) as ClassificationResult
    const validDomains: AgentDomain[] = ['crm', 'finance', 'sales', 'hr', 'documents', 'analytics', 'general', 'image', 'tts']
    if (!validDomains.includes(parsed.domain)) {
      return { domain: 'analytics', confidence: 0.5, needsMultiAgent: false }
    }

    console.log(`Classification: ${parsed.domain} (confidence: ${parsed.confidence})`)
    return parsed
  } catch (err) {
    console.warn('Classification error, falling back to analytics:', err)
    return { domain: 'analytics', confidence: 0.5, needsMultiAgent: false }
  }
}

async function directLLMResponse(messages: ConversationMessage[], context?: string): Promise<string> {
  let systemPrompt =
    "Sei l'assistente AI di FIAI (Fabbrica Italiana Agenti Intelligenti). " +
    'Rispondi sempre in italiano, in modo professionale e conciso. ' +
    'Non hai accesso a tool in questo momento, rispondi con le tue conoscenze generali.'

  if (context) {
    systemPrompt += '\n\n--- CONTESTO AZIENDALE ---\n' + context
  }

  const res = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map((m) => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        })),
      ],
      max_tokens: 4096,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenRouter error ${res.status}: ${err}`)
  }

  const data = await res.json()
  return data.choices?.[0]?.message?.content ?? ''
}

async function synthesizeResults(
  messages: ConversationMessage[],
  agentResults: { agentName: string; text: string }[]
): Promise<string> {
  const systemPrompt =
    "Sei l'assistente AI di FIAI. Hai ricevuto risposte da diversi agenti specializzati. " +
    'Sintetizza le risposte in un unico messaggio coerente e completo in italiano. ' +
    'Mantieni tutte le informazioni importanti e presenta i dati in modo chiaro.'

  const agentSummary = agentResults
    .map((r) => `--- ${r.agentName} ---\n${r.text}`)
    .join('\n\n')

  const lastUserMsg = messages[messages.length - 1]
  const userContent = typeof lastUserMsg.content === 'string'
    ? lastUserMsg.content
    : JSON.stringify(lastUserMsg.content)

  const res = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Domanda originale: ${userContent}\n\nRisposte degli agenti:\n${agentSummary}`,
        },
      ],
      max_tokens: 4096,
    }),
  })

  if (!res.ok) {
    // Fallback: concatenate results
    return agentResults.map((r) => `**${r.agentName}:**\n${r.text}`).join('\n\n')
  }

  const data = await res.json()
  return data.choices?.[0]?.message?.content ?? ''
}

// ── Response Mode Detection ──────────────────────────────
type ResponseMode = 'minimal' | 'iteration' | 'full'

const sessionDomainCache = new Map<string, AgentDomain>()

function detectResponseMode(messages: ConversationMessage[]): ResponseMode {
  const lastMsg = messages[messages.length - 1]
  const text = (typeof lastMsg.content === 'string' ? lastMsg.content : '').trim()
  const t = text.toLowerCase()

  // MINIMAL: greetings, thanks, ratings, very short acks
  if (t.length < 25 && /^(ok|va bene|grazie|thanks|ciao|buon[a-z]*|salve|perfetto|ottimo|capito|chiaro|si|sì|no|bene|bravo|fantastico|eccellente)[\s!.]*$/i.test(t)) {
    return 'minimal'
  }
  // Explicit numeric rating: "8", "3 - non era giusto", "10!"
  if (/^\d{1,2}[\s\-:!.]/.test(t) || /^\d{1,2}$/.test(t)) {
    return 'minimal'
  }

  // ITERATION: continues previous context
  if (messages.length > 2 && /^(ora|adesso|invece|piuttosto|prova|modifica|cambia|aggiungi|togli|rimuovi|rifai|migliora|correggi|aggiorna|continua|e anche|inoltre|poi)/i.test(t)) {
    return 'iteration'
  }

  return 'full'
}

export async function orchestrate(
  messages: ConversationMessage[],
  sessionId: string,
  onToolUse?: (event: ToolUseEvent) => void,
  onTextChunk?: (chunk: string) => void,
  attachedImageBase64?: string
): Promise<OrchestrateResult> {
  const startTime = Date.now()

  // Refresh contexts on first message of session (fire-and-forget)
  if (messages.length === 1) {
    refreshContexts().catch(() => {})
  }

  // Helper: finalize result with signal capture, hooks, and suggestions
  const finalizeResult = async (result: OrchestrateResult, classification?: ClassificationResult): Promise<OrchestrateResult> => {
    const latencyMs = Date.now() - startTime
    const toolsUsed = result.toolCalls.map(t => (t as Record<string, unknown>).tool).filter(Boolean) as string[]

    // Capture signal (fire-and-forget)
    captureSignal({
      sessionId,
      domain: result.agentDomain,
      confidence: classification?.confidence ?? 1.0,
      tools: toolsUsed,
      latencyMs,
      agentName: result.agentName,
    })

    // Run post_execute hook
    const hookCtx: HookContext = {
      messages,
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
      saveSessionContext(sessionId, summary).catch(() => {})
    }

    // Cache domain for ITERATION mode
    if (sessionId && result.agentDomain !== 'general') {
      sessionDomainCache.set(sessionId, result.agentDomain as AgentDomain)
    }

    return { ...result, suggestions }
  }

  // ── Response Mode Routing (MINIMAL / ITERATION / FULL) ──
  const responseMode = detectResponseMode(messages)

  if (responseMode === 'minimal') {
    const lastText = (typeof messages[messages.length - 1].content === 'string' ? messages[messages.length - 1].content : '').trim()

    // Check for explicit numeric rating (1-10)
    const ratingMatch = lastText.match(/^(\d{1,2})/)
    if (ratingMatch) {
      const rating = parseInt(ratingMatch[1])
      if (rating >= 1 && rating <= 10) {
        captureSignal({
          sessionId,
          type: 'explicit_rating',
          rating,
          domain: sessionDomainCache.get(sessionId || '') || 'general',
        })
        const response = rating >= 7
          ? 'Grazie per il feedback positivo!'
          : rating >= 4
            ? 'Grazie, terrò conto del tuo feedback per migliorare.'
            : 'Mi dispiace. Cercherò di fare meglio la prossima volta.'
        return { text: response, toolCalls: [], agentName: 'Assistente FIAI', agentDomain: 'general', agentColor: AGENT_COLORS.general }
      }
    }

    // Minimal: quick response, no classification, no tools
    const minimalText = await directLLMResponse(messages.slice(-2), '')
    return { text: minimalText, toolCalls: [], agentName: 'Assistente FIAI', agentDomain: 'general', agentColor: AGENT_COLORS.general }
  }

  if (responseMode === 'iteration' && sessionId) {
    const lastDomain = sessionDomainCache.get(sessionId)
    if (lastDomain && lastDomain !== 'general' && lastDomain !== 'image' && lastDomain !== 'tts') {
      const agent = getAgent(lastDomain)
      if (agent) {
        const context = await buildFullContext(lastDomain, sessionId).catch(() => '')
        const result = await agent.execute(messages, onToolUse, context, onTextChunk)
        return finalizeResult(result)
      }
    }
    // fallback to full classification
  }

  // If an image is attached, force image domain for analysis
  if (attachedImageBase64) {
    const { imageAgent } = await import('./registry')
    // Store the attached image for analysis
    if (sessionId) {
      imageAgent.addImageToHistory(sessionId, attachedImageBase64)
    }
    const result = await imageAgent.execute(messages, onTextChunk, sessionId)
    return finalizeResult(result)
  }

  // Step 1: Classify intent
  const classification = await classifyIntent(messages)

  // Run post_classify hook
  let hookCtx: HookContext = { messages, domain: classification.domain, confidence: classification.confidence, sessionId }
  hookCtx = await runHooks('post_classify', hookCtx)

  // Step 2a: TTS — uses DashScope Qwen3-TTS
  if (classification.domain === 'tts') {
    const { ttsAgent } = await import('./registry')
    const result = await ttsAgent.execute(messages, onTextChunk, sessionId)
    return finalizeResult(result, classification)
  }

  // Step 2b: Image generation/analysis — uses Gemini model
  if (classification.domain === 'image') {
    const { imageAgent } = await import('./registry')
    const result = await imageAgent.execute(messages, onTextChunk, sessionId)
    return finalizeResult(result, classification)
  }

  // Step 3: General — direct LLM response (no tools)
  if (classification.domain === 'general') {
    const context = await buildFullContext('analytics', sessionId).catch(() => '')
    const text = await directLLMResponse(messages, context)
    const result: OrchestrateResult = {
      text,
      toolCalls: [],
      agentName: 'Assistente FIAI',
      agentDomain: 'general',
      agentColor: AGENT_COLORS.general,
    }
    return finalizeResult(result, classification)
  }

  // Step 4: Multi-agent — execute agents in parallel, then synthesize
  if (classification.needsMultiAgent && classification.secondaryDomains && classification.secondaryDomains.length > 0) {
    const allDomains: AgentDomain[] = [classification.domain, ...classification.secondaryDomains]
    const uniqueDomains = [...new Set(allDomains)].filter((d) => d !== 'general')

    const agentPromises = uniqueDomains
      .map(async (domain) => {
        const agent = getAgent(domain)
        if (!agent) return null
        const context = await buildFullContext(domain, sessionId).catch(() => '')
        return agent.execute(messages, onToolUse, context)
      })
      .filter((p) => p !== null)

    const results = await Promise.all(agentPromises)
    const validResults = results.filter((r) => r !== null)

    // Merge all tool calls
    const allToolCalls = validResults.flatMap((r) => r.toolCalls)

    // Synthesize text responses
    const synthesized = await synthesizeResults(
      messages,
      validResults.map((r) => ({ agentName: r.agentName, text: r.text }))
    )

    const result: OrchestrateResult = {
      text: synthesized,
      toolCalls: allToolCalls,
      agentName: validResults.map((r) => r.agentName).join(' + '),
      agentDomain: classification.domain,
      agentColor: AGENT_COLORS[classification.domain],
    }
    return finalizeResult(result, classification)
  }

  // Step 5: Single-agent
  const agent = getAgent(classification.domain)
  if (!agent) {
    // Fallback to general
    const context = await buildFullContext('analytics', sessionId).catch(() => '')
    const text = await directLLMResponse(messages, context)
    const result: OrchestrateResult = {
      text,
      toolCalls: [],
      agentName: 'Assistente FIAI',
      agentDomain: 'general',
      agentColor: AGENT_COLORS.general,
    }
    return finalizeResult(result, classification)
  }

  const context = await buildFullContext(classification.domain, sessionId).catch(() => '')
  const result = await agent.execute(messages, onToolUse, context, onTextChunk)

  return finalizeResult(result, classification)
}
