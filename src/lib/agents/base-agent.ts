import type { AgentConfig, AgentResult } from './types'
import { getToolDefinitions, executeTool } from './tool-registry'

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'
const OPENROUTER_API_KEY = import.meta.env.VITE_OPENROUTER_API_KEY ?? ''
const MODEL = 'z-ai/glm-5'

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}

interface ToolUseEvent {
  toolName: string
  status: 'running' | 'done'
}

interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string | object[]
}

// Non-streaming call (for tool-use loop)
async function callOpenRouter(
  messages: OpenRouterMessage[],
  tools?: Record<string, unknown>[],
  retries = 3
): Promise<any> {
  const body: Record<string, unknown> = {
    model: MODEL,
    messages,
    max_tokens: 4096,
  }
  if (tools && tools.length > 0) body.tools = tools

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
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)))
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
  throw new Error('OpenRouter: troppi tentativi falliti')
}

// Streaming call (for final response)
async function streamOpenRouter(
  messages: OpenRouterMessage[],
  onChunk: (text: string) => void
): Promise<string> {
  const res = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: 4096,
      stream: true,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenRouter error ${res.status}: ${err}`)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let fullText = ''
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    // Parse SSE lines
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? '' // keep incomplete line in buffer

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed === 'data: [DONE]') continue
      if (!trimmed.startsWith('data: ')) continue

      try {
        const json = JSON.parse(trimmed.slice(6))
        const delta = json.choices?.[0]?.delta
        if (delta?.content) {
          fullText += delta.content
          onChunk(delta.content)
        }
      } catch {
        // skip malformed chunks
      }
    }
  }

  return fullText
}

export class BaseAgent {
  config: AgentConfig
  constructor(config: AgentConfig) {
    this.config = config
  }

  async execute(
    messages: ConversationMessage[],
    onToolUse?: (event: ToolUseEvent) => void,
    context?: string,
    onTextChunk?: (chunk: string) => void
  ): Promise<AgentResult> {
    const tools = getToolDefinitions(this.config.toolNames)

    // Build system prompt with optional context injection
    let systemPrompt = this.config.systemPrompt
    if (context) {
      systemPrompt += '\n\n' + context
    }

    const apiMessages: OpenRouterMessage[] = [
      { role: 'system', content: systemPrompt },
      ...messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      })),
    ]

    let response = await callOpenRouter(apiMessages, tools)
    const allToolCalls: Record<string, unknown>[] = []

    // Handle tool use loop (non-streaming — need full response for tool_calls)
    while (
      response.choices?.[0]?.finish_reason === 'tool_calls' ||
      response.choices?.[0]?.message?.tool_calls
    ) {
      const assistantMessage = response.choices[0].message
      apiMessages.push(assistantMessage)

      const toolCallsList = assistantMessage.tool_calls ?? []

      for (const toolCall of toolCallsList) {
        const fnName = toolCall.function.name
        let fnArgs: Record<string, unknown> = {}
        try {
          fnArgs = JSON.parse(toolCall.function.arguments || '{}')
        } catch {
          // empty args
        }

        onToolUse?.({ toolName: fnName, status: 'running' })

        const toolEntry: Record<string, unknown> = { tool: fnName, input: fnArgs }

        try {
          const result = await executeTool(fnName, fnArgs)
          toolEntry.result = result
          apiMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result),
          })
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Errore sconosciuto'
          toolEntry.error = errorMessage
          toolEntry.result = { successo: false, messaggio: errorMessage }
          apiMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ errore: errorMessage }),
          })
        }

        allToolCalls.push(toolEntry)
        onToolUse?.({ toolName: fnName, status: 'done' })
      }

      // Next call: if we have a streaming callback, check if this might be the final call
      response = await callOpenRouter(apiMessages, tools)
    }

    // Extract final text — if there are no tool calls and we got a non-streaming response, use it
    let text = response.choices?.[0]?.message?.content ?? ''

    // If we have a streaming callback and the response was short or empty,
    // re-do the final call with streaming for better UX
    if (onTextChunk && allToolCalls.length > 0) {
      // After tool execution, stream the final synthesis
      // Add the last assistant message to continue from
      if (text) {
        // Already got a non-streaming response with text, stream it character by character
        for (let i = 0; i < text.length; i += 3) {
          onTextChunk(text.slice(i, i + 3))
          await new Promise(r => setTimeout(r, 10))
        }
      }
    } else if (onTextChunk && allToolCalls.length === 0) {
      // No tools were used — re-do with streaming for real token-by-token
      text = await streamOpenRouter(apiMessages, onTextChunk)
    }

    return {
      text,
      toolCalls: allToolCalls,
      agentName: this.config.name,
      agentDomain: this.config.domain,
      agentColor: this.config.color,
    }
  }
}
