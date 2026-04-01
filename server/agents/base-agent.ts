import type { AgentConfig, AgentResult, ToolDefinition } from './types.js'
import { TOOL_DEFINITIONS, executeTool } from './tool-registry.js'
import db from '../db.js'

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const AGENT_MODEL = 'anthropic/claude-haiku-4.5'

interface ConversationMessage {
  role: string
  content: string
}

async function fetchWithRetry(body: Record<string, unknown>, retries = 3): Promise<any> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify(body),
    })

    if (res.status === 429 && attempt < retries - 1) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '2', 10)
      await new Promise(r => setTimeout(r, retryAfter * 1000 * (attempt + 1)))
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

    return data
  }
  throw new Error('OpenRouter: too many retries')
}

export async function executeAgent(
  message: string,
  agent: AgentConfig,
  aziendaId: string,
  userId: string,
  context: string,
  format: 'web' | 'whatsapp',
  conversationHistory?: ConversationMessage[]
): Promise<AgentResult> {
  // Build tools from agent config
  const tools = agent.toolNames
    .map(name => TOOL_DEFINITIONS[name])
    .filter(Boolean) as ToolDefinition[]

  // Build system prompt with context
  let systemPrompt = agent.systemPrompt +
    '\n\nREGOLE FONDAMENTALI:' +
    '\n1. FONTI: Rispondi ESCLUSIVAMENTE in base ai dati presenti nel sistema (names, entity, documenti caricati). NON inventare dati, NON usare conoscenze esterne a meno che l\'utente non lo chieda esplicitamente.' +
    '\n2. Se NON trovi l\'informazione nei dati del sistema, dillo chiaramente: "Non ho trovato questa informazione nell\'archivio." NON inventare contenuti, NON suggerire siti web, NON fornire informazioni da fonti esterne. Se pensi che una ricerca web possa aiutare, chiedi: "Vuoi che cerchi sul web?" — ma non farlo autonomamente e non suggerire URL specifici.' +
    '\n3. Quando citi dati o testi da documenti, riporta il testo LETTERALMENTE come trovato nel sistema — non riformulare, non parafrasare, non interpretare. Usa virgolette e indica la fonte esatta (nome documento, articolo, sezione).' +
    '\n4. NON ripetere in formato tabella markdown i dati che il tool renderer mostra già automaticamente. Aggiungi solo commenti, analisi e prossimi passi.' +
    '\n5. Se ricevi RISULTATI TOOL già eseguiti dal planner, NON richiamare gli stessi tool. I dati sono già disponibili — usali direttamente nella risposta.'

  if (context) {
    systemPrompt += '\n\n' + context
  }

  if (format === 'whatsapp') {
    systemPrompt += '\nFormatta per WhatsApp: *grassetto*, liste con -, niente tabelle markdown. Sii conciso.'
  }
  systemPrompt += '\nNon ripetere i dati grezzi dei tool nella risposta. Sintetizza in modo leggibile.'

  // Profile context from names (VFS)
  const nameProfile = db.prepare("SELECT display_name, metadata FROM names WHERE id = ?").get(userId) as any
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

  const allToolCalls: any[] = []
  let totalCost = 0
  let totalTokens = 0
  let loops = 5

  while (loops-- > 0) {
    const data = await fetchWithRetry({
      model: AGENT_MODEL,
      messages: apiMessages,
      tools: tools.length > 0 ? tools : undefined,
      max_tokens: 1024,
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
        const result = await executeTool(tc.function.name, aziendaId, fnArgs)
        allToolCalls.push({ tool: tc.function.name, result })

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

    return {
      text: msg?.content ?? '',
      toolCalls: allToolCalls,
      agentName: agent.name,
      agentDomain: agent.domain,
      agentColor: agent.color,
      totalCost,
      totalTokens,
    }
  }

  return {
    text: 'Troppi passaggi.',
    toolCalls: allToolCalls,
    agentName: agent.name,
    agentDomain: agent.domain,
    agentColor: agent.color,
    totalCost,
    totalTokens,
  }
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
    'Non hai accesso a tool in questo momento, rispondi con le tue conoscenze generali.'

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
