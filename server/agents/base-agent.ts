import type { AgentConfig, AgentResult, ToolDefinition, UserPermissions } from './types.js'
import { TOOL_DEFINITIONS, executeTool } from './tool-registry.js'
import db from '../db.js'
import { getSetting, getResponseProfile } from '../settings.js'

// ── Session context stats (shared with tool-registry for get_session_context) ──
export interface SessionStats {
  sessionId: string
  agentName: string
  agentDomain: string
  model: string
  systemPromptChars: number
  contextChars: number
  toolDefsCount: number
  toolDefsChars: number
  historyMessages: number
  historyChars: number
  toolExchanges: number
  toolResultsChars: number
  totalChars: number
  totalTokensEstimate: number
  maxTokens: number
  usagePercent: number
  prunedExchanges: number
  loopsRemaining: number
  loopsUsed: number
  totalApiTokens: number
  totalApiCost: number
  updatedAt: number
}

export const sessionStatsCache = new Map<string, SessionStats>()

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const AGENT_MODEL = 'anthropic/claude-haiku-4.5'
const FALLBACK_MODEL = 'anthropic/claude-haiku-4.5'

interface ConversationMessage {
  role: string
  content: string
}

async function fetchWithRetry(body: Record<string, unknown>, retries = 3): Promise<any> {
  const originalModel = body.model as string
  let currentModel = originalModel

  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({ ...body, model: currentModel }),
    })

    if (res.status === 429 && attempt < retries - 1) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '2', 10)
      await new Promise(r => setTimeout(r, retryAfter * 1000 * (attempt + 1)))
      continue
    }

    // Provider error (503, 502, 500) — fallback to Haiku if using a different model
    if ([500, 502, 503].includes(res.status) && currentModel !== FALLBACK_MODEL) {
      console.warn(`[Agent] Model ${currentModel} returned ${res.status}, falling back to ${FALLBACK_MODEL}`)
      currentModel = FALLBACK_MODEL
      continue
    }

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`OpenRouter error ${res.status}: ${err}`)
    }

    const data = await res.json()
    if (data.error && attempt < retries - 1) {
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)))
      continue
    }

    if (currentModel !== originalModel) {
      console.log(`[Agent] Response served by fallback model ${currentModel} (original: ${originalModel})`)
    }

    return data
  }
  throw new Error('OpenRouter: too many retries')
}

export type ProgressCallback = (event: { type: string; [key: string]: unknown }) => void

// ── Streaming LLM call (real token-by-token from OpenRouter) ──

async function fetchStreaming(
  body: Record<string, unknown>,
  onToken: (token: string) => void
): Promise<{ message: any; usage?: any }> {
  const res = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({ ...body, stream: true }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenRouter stream error ${res.status}: ${err}`)
  }

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullContent = ''
  let toolCalls: any[] = []
  let finishReason = ''
  let usage: any = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data: ')) continue
      const data = trimmed.slice(6)
      if (data === '[DONE]') continue

      try {
        const parsed = JSON.parse(data)
        const delta = parsed.choices?.[0]?.delta
        if (!delta) continue

        // Text content
        if (delta.content) {
          fullContent += delta.content
          onToken(delta.content)
        }

        // Tool calls (accumulated across chunks)
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0
            if (!toolCalls[idx]) toolCalls[idx] = { id: tc.id, type: 'function', function: { name: '', arguments: '' } }
            if (tc.id) toolCalls[idx].id = tc.id
            if (tc.function?.name) toolCalls[idx].function.name += tc.function.name
            if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments
          }
        }

        if (parsed.choices?.[0]?.finish_reason) finishReason = parsed.choices[0].finish_reason
        if (parsed.usage) usage = parsed.usage
      } catch {}
    }
  }

  // Build message object matching non-streaming format
  const message: any = { content: fullContent, role: 'assistant' }
  if (toolCalls.length > 0) message.tool_calls = toolCalls

  return { message, usage }
}

// ── Pruning: rimuove tool exchange vecchi quando i messaggi superano la soglia ──
const MAX_MESSAGES_CHARS = 400000 // ~100K token, margine per i 200K del modello

function pruneMessages(messages: any[]): any[] {
  const total = messages.reduce((s, m) => s + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m).length), 0)
  if (total <= MAX_MESSAGES_CHARS) return messages

  // Trova gruppi tool exchange: assistant(tool_calls) + N tool responses
  const groups: { start: number; end: number }[] = []
  for (let i = 1; i < messages.length; i++) {
    if (messages[i].role === 'assistant' && messages[i].tool_calls) {
      const start = i
      let end = i
      while (end + 1 < messages.length && messages[end + 1].role === 'tool') {
        end++
      }
      groups.push({ start, end })
      i = end
    }
  }

  if (groups.length <= 2) return messages

  // Rimuovi gruppi vecchi, tieni gli ultimi 2
  const toRemove = new Set<number>()
  for (const g of groups.slice(0, -2)) {
    for (let i = g.start; i <= g.end; i++) toRemove.add(i)
  }

  const pruned = messages.filter((_: any, i: number) => !toRemove.has(i))
  const insertIdx = pruned.findIndex((m: any) => m.role === 'assistant' && m.tool_calls)
  if (insertIdx > 0) {
    pruned.splice(insertIdx, 0, {
      role: 'user',
      content: `[${groups.length - 2} tool exchange precedenti rimossi per spazio. Risultati gia' elaborati.]`
    })
  }

  console.log(`[Agent] Pruned ${groups.length - 2} old tool exchanges (${total} → ${pruned.reduce((s: number, m: any) => s + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m).length), 0)} chars)`)
  return pruned
}

export async function executeAgent(
  message: string,
  agent: AgentConfig,
  aziendaId: string,
  userId: string,
  context: string,
  format: string,  // 'web' (default), 'whatsapp', 'voice', 'brief', 'json', 'report', or any custom profile slug
  conversationHistory?: ConversationMessage[],
  onProgress?: ProgressCallback,
  permissions?: UserPermissions,
  sessionId?: string
): Promise<AgentResult> {
  // Build tools from agent config (dedup by function name)
  const seenNames = new Set<string>()
  const tools = agent.toolNames
    .map(name => TOOL_DEFINITIONS[name])
    .filter((t): t is ToolDefinition => {
      if (!t) return false
      const fname = (t as any).function?.name
      if (seenNames.has(fname)) return false
      seenNames.add(fname)
      return true
    })

  // Inject company name into prompt template
  const companyName = getSetting('company_name')

  // Build system prompt with context
  let systemPrompt = agent.systemPrompt.replace(/\{COMPANY_NAME\}/g, companyName) +
    '\n\nREGOLE FONDAMENTALI:' +
    '\n1. CERCA PRIMA, RISPONDI DOPO: usa SEMPRE i tool per cercare prima di rispondere. Per dati interni: find, retrieve, execute_code. Per informazioni dal web: web_search. Se l\'utente chiede "cerca sul web/online/internet" o informazioni che non possono essere nel sistema (es. elenchi aziende, notizie, informazioni generali), USA web_search. Basa la risposta sui risultati dei tool.' +
    '\n2. DIVIETO DI ALLUCINAZIONE: non aggiungere fatti non presenti nei risultati dei tool. Se non trovi nulla: "Non ho trovato questa informazione." In caso di dubbio, non scriverlo.' +
    '\n3. Quando citi dati o testi da documenti, riporta il testo LETTERALMENTE come trovato nel sistema — non riformulare, non parafrasare, non interpretare. Usa virgolette e indica la fonte esatta (nome documento, articolo, sezione).' +
    '\n4. I risultati dei tool vengono visualizzati AUTOMATICAMENTE come card nella chat. NON ripetere i dati in tabelle o liste markdown — sono già visibili. Il tuo compito è SOLO aggiungere commenti, analisi, contesto o suggerire prossimi passi. Mai duplicare dati già mostrati.' +
    '\n5. EXECUTE_CODE FIRST: per operazioni che richiedono piu\' di 1 tool call (cercare + elaborare + agire), usa execute_code per fare tutto in un unico script. Questo e\' PIU\' VELOCE di chiamare tool uno alla volta. Esempio: invece di chiamare find, poi find, poi send_whatsapp — scrivi uno script che fa tutto insieme. Le funzioni disponibili nello script: find, create, update, delete_record, relate, get_tree, retrieve, list_documents, get_datetime, date_diff, generate_pdf, render_view. Per azioni WhatsApp nello script: send_whatsapp_message, send_whatsapp_voice, send_whatsapp_image, send_whatsapp_document. Usa print() per l\'output.' +
    '\n   IMPORTANTE: quando cerchi persone/contatti, NON filtrare per type="persona" — gli utenti del sistema hanno type="utente". Cerca con find({query: "nome"}) SENZA type, oppure filtra con .filter(r => ["persona","utente","organizzazione"].includes(r.type)).' +
    '\n   Usa tool singoli SOLO per operazioni semplici (1 sola chiamata) o quando devi mostrare risultati intermedi all\'utente.' +
    '\n6. DISAMBIGUAZIONE: se una ricerca restituisce risultati ambigui o multipli, NON scegliere arbitrariamente. Presenta le opzioni all\'utente.' +
    '\n7. CONFERMA OBBLIGATORIA prima di azioni irreversibili o di invio:' +
    '\n   - INVIO MESSAGGI (WhatsApp): PRIMA raccogli i dati (usa execute_code per cercare contatto + comporre messaggio), POI mostra all\'utente cosa invierai e a chi. Chiedi "Confermo l\'invio?". Solo dopo la conferma, esegui l\'invio (con execute_code o tool diretto).' +
    '\n   - ELIMINAZIONE: mostra cosa cancelli, chiedi conferma.' +
    '\n   - MODIFICA DATI: mostra prima/dopo, chiedi conferma.' +
    '\n   Eccezione: gli agenti autonomi (background) non chiedono conferma.' +
    '\n8. NON MENTIRE sulle azioni: se non hai il tool per fare qualcosa, NON dire che l\'hai fatto. Dì chiaramente che non puoi.'

  if (context) {
    // Truncate context to avoid token overflow (200K limit)
    systemPrompt += '\n\n' + context.substring(0, 8000)
  }

  // Apply response profile (voice, whatsapp, brief, json, report, or custom)
  if (format && format !== 'web') {
    const profilePrompt = getResponseProfile(format)
    if (profilePrompt) {
      systemPrompt += '\n' + profilePrompt
    }
  }
  systemPrompt += '\nNon ripetere i dati grezzi dei tool nella risposta. Sintetizza in modo leggibile.'

  // Profile context from names (VFS)
  const nameProfile = db.prepare("SELECT display_name, metadata FROM entity WHERE id = ?").get(userId) as any
  if (nameProfile) {
    const meta = typeof nameProfile.metadata === 'string' ? JSON.parse(nameProfile.metadata) : (nameProfile.metadata || {})
    systemPrompt += `\nUtente: ${nameProfile.display_name} (${meta.ruolo || 'collaboratore'})`
  }

  const apiMessages: any[] = [
    { role: 'system', content: systemPrompt },
  ]

  // Include conversation history (limited to avoid token overflow)
  if (conversationHistory && conversationHistory.length > 0) {
    for (const m of conversationHistory.slice(-4)) {
      const content = typeof m.content === 'string' ? m.content.substring(0, 2000) : m.content
      apiMessages.push({ role: m.role, content })
    }
  }

  apiMessages.push({ role: 'user', content: message })

  const agentStart = Date.now()
  const allToolCalls: any[] = []
  const reasoningSteps: { tool: string; description: string; result_summary: string }[] = []
  let totalCost = 0
  let totalTokens = 0
  let loops = 10
  const maxLoops = loops
  let prunedCount = 0

  // Pre-compute static sizes for session stats
  const systemPromptChars = systemPrompt.length
  const contextChars = context ? context.substring(0, 8000).length : 0
  const toolDefsChars = JSON.stringify(tools).length
  const historyChars = conversationHistory ? conversationHistory.slice(-4).reduce((s, m) => s + (typeof m.content === 'string' ? m.content.length : 0), 0) : 0
  const historyCount = conversationHistory ? Math.min(conversationHistory.length, 4) : 0
  const MODEL_MAX_TOKENS = 200000

  while (loops-- > 0) {
    const messagesToSend = pruneMessages(apiMessages)
    prunedCount = apiMessages.length - messagesToSend.length

    // Update session stats
    if (sessionId) {
      const toolExchangeCount = apiMessages.filter((m: any) => m.role === 'assistant' && m.tool_calls).length
      const toolResultsChars = apiMessages.filter((m: any) => m.role === 'tool').reduce((s: number, m: any) => s + (typeof m.content === 'string' ? m.content.length : 0), 0)
      const totalChars = messagesToSend.reduce((s: number, m: any) => s + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m).length), 0)
      const totalTokensEst = Math.ceil(totalChars / 4)
      sessionStatsCache.set(sessionId, {
        sessionId,
        agentName: agent.name,
        agentDomain: agent.domain,
        model: agent.model || AGENT_MODEL,
        systemPromptChars,
        contextChars,
        toolDefsCount: tools.length,
        toolDefsChars,
        historyMessages: historyCount,
        historyChars,
        toolExchanges: toolExchangeCount,
        toolResultsChars,
        totalChars,
        totalTokensEstimate: totalTokensEst,
        maxTokens: MODEL_MAX_TOKENS,
        usagePercent: Math.round((totalTokensEst / MODEL_MAX_TOKENS) * 100),
        prunedExchanges: prunedCount,
        loopsRemaining: loops,
        loopsUsed: maxLoops - loops,
        totalApiTokens: totalTokens,
        totalApiCost: totalCost,
        updatedAt: Date.now(),
      })
    }
    // Use streaming for the LLM call — tokens emitted via onProgress
    let msg: any
    let usage: any

    if (onProgress) {
      // Streaming mode: emit tokens in real-time
      const streamResult = await fetchStreaming(
        { model: agent.model || AGENT_MODEL, messages: messagesToSend, tools: tools.length > 0 ? tools : undefined, max_tokens: 4096 },
        (token) => onProgress({ type: 'token', content: token })
      )
      msg = streamResult.message
      usage = streamResult.usage
    } else {
      // Non-streaming fallback
      const data = await fetchWithRetry({ model: agent.model || AGENT_MODEL, messages: messagesToSend, tools: tools.length > 0 ? tools : undefined, max_tokens: 4096 })
      msg = data.choices?.[0]?.message
      usage = data.usage
    }

    // Track cost/tokens
    if (usage) {
      totalTokens += (usage.prompt_tokens || 0) + (usage.completion_tokens || 0)
      totalCost += usage.total_cost || 0
    }

    if (msg?.tool_calls?.length > 0) {
      apiMessages.push(msg)
      for (const tc of msg.tool_calls || []) {
        let fnArgs: Record<string, unknown> = {}
        try { fnArgs = JSON.parse(tc.function.arguments || '{}') } catch {}

        // Stream progress: tool starting
        onProgress?.({ type: 'tool_start', tool: tc.function.name })

        const result = await executeTool(tc.function.name, aziendaId, fnArgs, permissions)
        allToolCalls.push({ tool: tc.function.name, result })

        // After execute_code, limit remaining iterations to avoid infinite loops
        // but allow enough for a follow-up action (e.g. send_whatsapp after generate_pdf)
        if (tc.function.name === 'execute_code' && loops > 3) {
          loops = 3  // enough for: 1 more tool call + 1 synthesis, with margin
        }

        // Track reasoning step
        let summary = ''
        if (Array.isArray(result)) summary = `${result.length} risultati`
        else if (result && typeof result === 'object') {
          const r = result as any
          if (r.errore) summary = r.errore
          else if (r.successo) summary = r.messaggio || 'OK'
          else if (r.output) summary = r.output.substring(0, 100)
          else summary = Object.keys(r).slice(0, 3).join(', ')
        } else summary = String(result || '').substring(0, 60)

        // Stream progress: tool completed
        onProgress?.({ type: 'tool_done', tool: tc.function.name, summary })
        reasoningSteps.push({ tool: tc.function.name, description: tc.function.name, result_summary: summary })

        let toolContent: string
        if (tc.function.name === 'generate_image' && (result as any)?.successo) {
          const r = result as any
          toolContent = JSON.stringify({ successo: true, messaggio: 'Immagine generata con successo', file_path: r.file_path, api_url: r.api_url })
        } else {
          toolContent = JSON.stringify(result)
        }
        apiMessages.push({ role: 'tool', tool_call_id: tc.id, content: toolContent })
      }
      continue
    }

    const agentResult: AgentResult = {
      text: msg?.content ?? '',
      toolCalls: allToolCalls,
      agentName: agent.name,
      agentDomain: agent.domain,
      agentColor: agent.color,
      totalCost,
      totalTokens,
    }
    if (reasoningSteps.length > 0) {
      agentResult.reasoning = {
        steps: reasoningSteps,
        domain: agent.domain,
        thinking: '',
        latencyMs: Date.now() - agentStart,
      }
    }
    return agentResult
  }

  const fallbackResult: AgentResult = {
    text: 'Troppi passaggi.',
    toolCalls: allToolCalls,
    agentName: agent.name,
    agentDomain: agent.domain,
    agentColor: agent.color,
    totalCost,
    totalTokens,
  }
  if (reasoningSteps.length > 0) {
    fallbackResult.reasoning = {
      steps: reasoningSteps,
      domain: agent.domain,
      thinking: '',
      latencyMs: Date.now() - agentStart,
    }
  }
  return fallbackResult
}

// Direct LLM response (no tools) for general/minimal responses
export async function directLLMResponse(
  message: string,
  context: string,
  conversationHistory?: ConversationMessage[],
  onProgress?: ProgressCallback
): Promise<string> {
  let systemPrompt =
    "Sei l'assistente AI di " + getSetting('company_name') + ". " +
    'Rispondi sempre in italiano, in modo professionale e conciso. ' +
    'Puoi rispondere a saluti e domande conversazionali generiche. ' +
    'Per qualsiasi domanda su dati, documenti, persone, progetti o informazioni specifiche, ' +
    'rispondi: "Fammi cercare nel sistema" — NON rispondere con conoscenze tue.'

  if (context) {
    systemPrompt += '\n\n' + context
  }

  const messages: any[] = [
    { role: 'system', content: systemPrompt },
  ]

  if (conversationHistory && conversationHistory.length > 0) {
    for (const m of conversationHistory.slice(-6)) {
      messages.push({ role: m.role, content: m.content })
    }
  }

  messages.push({ role: 'user', content: message })

  if (onProgress) {
    const streamResult = await fetchStreaming(
      { model: AGENT_MODEL, messages, max_tokens: 4096 },
      (token) => onProgress({ type: 'token', content: token })
    )
    return streamResult.message.content ?? ''
  }

  const data = await fetchWithRetry({ model: AGENT_MODEL, messages, max_tokens: 4096 })
  return data.choices?.[0]?.message?.content ?? ''
}
