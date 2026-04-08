import type { AgentConfig, AgentResult, ToolDefinition, UserPermissions } from './types.js'
import { TOOL_DEFINITIONS, executeTool } from './tool-registry.js'
import db from '../db.js'

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

export async function executeAgent(
  message: string,
  agent: AgentConfig,
  aziendaId: string,
  userId: string,
  context: string,
  format: 'web' | 'whatsapp',
  conversationHistory?: ConversationMessage[],
  onProgress?: ProgressCallback,
  permissions?: UserPermissions
): Promise<AgentResult> {
  // Build tools from agent config
  const tools = agent.toolNames
    .map(name => TOOL_DEFINITIONS[name])
    .filter(Boolean) as ToolDefinition[]

  // Build system prompt with context
  let systemPrompt = agent.systemPrompt +
    '\n\nREGOLE FONDAMENTALI:' +
    '\n1. CERCA PRIMA, RISPONDI DOPO: usa SEMPRE i tool per cercare prima di rispondere. Per dati interni: find, retrieve, execute_code. Per informazioni dal web: web_search. Se l\'utente chiede "cerca sul web/online/internet" o informazioni che non possono essere nel sistema (es. elenchi aziende, notizie, informazioni generali), USA web_search. Basa la risposta sui risultati dei tool.' +
    '\n2. DIVIETO DI ALLUCINAZIONE: non aggiungere fatti non presenti nei risultati dei tool. Se non trovi nulla: "Non ho trovato questa informazione." In caso di dubbio, non scriverlo.' +
    '\n3. Quando citi dati o testi da documenti, riporta il testo LETTERALMENTE come trovato nel sistema — non riformulare, non parafrasare, non interpretare. Usa virgolette e indica la fonte esatta (nome documento, articolo, sezione).' +
    '\n4. I risultati dei tool vengono visualizzati AUTOMATICAMENTE come card nella chat. NON ripetere i dati in tabelle o liste markdown — sono già visibili. Il tuo compito è SOLO aggiungere commenti, analisi, contesto o suggerire prossimi passi. Mai duplicare dati già mostrati.' +
    '\n5. EXECUTE_CODE FIRST: per operazioni che richiedono piu\' di 1 tool call (cercare + elaborare + agire), usa execute_code per fare tutto in un unico script. Questo e\' PIU\' VELOCE di chiamare tool uno alla volta. Esempio: invece di chiamare find, poi find, poi send_whatsapp — scrivi uno script che fa tutto insieme. Le funzioni disponibili nello script: find, create, update, delete_record, relate, get_tree, retrieve, list_documents, get_datetime, date_diff, generate_pdf, render_view. Per azioni WhatsApp nello script: send_whatsapp_message, send_whatsapp_voice, send_whatsapp_image. Usa print() per l\'output.' +
    '\n   Usa tool singoli SOLO per operazioni semplici (1 sola chiamata) o quando devi mostrare risultati intermedi all\'utente.' +
    '\n6. DISAMBIGUAZIONE: se una ricerca restituisce risultati ambigui o multipli, NON scegliere arbitrariamente. Presenta le opzioni all\'utente.' +
    '\n7. CONFERMA OBBLIGATORIA prima di azioni irreversibili o di invio:' +
    '\n   - INVIO MESSAGGI (WhatsApp): PRIMA raccogli i dati (usa execute_code per cercare contatto + comporre messaggio), POI mostra all\'utente cosa invierai e a chi. Chiedi "Confermo l\'invio?". Solo dopo la conferma, esegui l\'invio (con execute_code o tool diretto).' +
    '\n   - ELIMINAZIONE: mostra cosa cancelli, chiedi conferma.' +
    '\n   - MODIFICA DATI: mostra prima/dopo, chiedi conferma.' +
    '\n   Eccezione: gli agenti autonomi (background) non chiedono conferma.' +
    '\n8. NON MENTIRE sulle azioni: se non hai il tool per fare qualcosa, NON dire che l\'hai fatto. Dì chiaramente che non puoi.'

  if (context) {
    systemPrompt += '\n\n' + context
  }

  if (format === 'whatsapp') {
    systemPrompt += '\nFormatta per WhatsApp: *grassetto*, liste con -, niente tabelle markdown. Sii conciso.'
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

  // Include conversation history
  if (conversationHistory && conversationHistory.length > 0) {
    for (const m of conversationHistory.slice(-8)) {
      apiMessages.push({ role: m.role, content: m.content })
    }
  }

  apiMessages.push({ role: 'user', content: message })

  const agentStart = Date.now()
  const allToolCalls: any[] = []
  const reasoningSteps: { tool: string; description: string; result_summary: string }[] = []
  let totalCost = 0
  let totalTokens = 0
  let loops = 10

  while (loops-- > 0) {
    const data = await fetchWithRetry({
      model: agent.model || AGENT_MODEL,
      messages: apiMessages,
      tools: tools.length > 0 ? tools : undefined,
      max_tokens: 4096,
    })

    // Track cost/tokens
    if (data.usage) {
      totalTokens += (data.usage.prompt_tokens || 0) + (data.usage.completion_tokens || 0)
      totalCost += data.usage.total_cost || 0
    }

    const choice = data.choices?.[0]
    const msg = choice?.message

    if (choice?.finish_reason === 'tool_calls' || msg?.tool_calls) {
      apiMessages.push(msg)
      for (const tc of msg.tool_calls || []) {
        let fnArgs: Record<string, unknown> = {}
        try { fnArgs = JSON.parse(tc.function.arguments || '{}') } catch {}

        // Stream progress: tool starting
        onProgress?.({ type: 'tool_start', tool: tc.function.name })

        const result = await executeTool(tc.function.name, aziendaId, fnArgs, permissions)
        allToolCalls.push({ tool: tc.function.name, result })

        // After execute_code, force the agent to synthesize — no more tool calls
        if (tc.function.name === 'execute_code') {
          loops = 1  // one more iteration to synthesize, then stop
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
        if (tc.function.name === 'generate_image' && (result as any)?.image_url) {
          toolContent = JSON.stringify({ successo: true, messaggio: 'Immagine generata con successo' })
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
  conversationHistory?: ConversationMessage[]
): Promise<string> {
  let systemPrompt =
    "Sei l'assistente AI di FIAI (Fabbrica Italiana Agenti Intelligenti). " +
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

  const data = await fetchWithRetry({
    model: AGENT_MODEL,
    messages,
    max_tokens: 4096,
  })

  return data.choices?.[0]?.message?.content ?? ''
}
