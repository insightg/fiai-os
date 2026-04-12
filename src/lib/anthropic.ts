import { supabase, getAuthToken } from './supabase'
import type { ChatMessage } from '../types'

// ── Message Types ───────────────────────────────────────────
export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string | object[]
}

export interface ToolUseEvent {
  toolName: string
  status: 'running' | 'done'
}

// ── Main Send Message Function (thin client → backend API) ──
export async function sendMessage(
  messages: ConversationMessage[],
  sessionId: string,
  onToolUse?: (event: ToolUseEvent) => void,
  onTextChunk?: (chunk: string) => void,
  attachedImageBase64?: string,
  attachedAudioBase64?: string
): Promise<{ text: string; toolCalls: Record<string, unknown>[]; agentName?: string; agentDomain?: string; agentColor?: string; suggestions?: string[]; reasoning?: any; sessionId?: string }> {
  const token = getAuthToken()
  const lastMsg = messages[messages.length - 1]
  const message = typeof lastMsg.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg.content)

  const body = JSON.stringify({
    message,
    sessionId,
    history: messages.slice(0, -1).map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    })),
    attachedImageBase64,
    attachedAudioBase64,
  })

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  // Use SSE streaming endpoint for real-time token delivery
  const res = await fetch('/api/chat/message/stream', { method: 'POST', headers, body })

  if (!res.ok) {
    // Fallback to non-streaming on error
    const fallback = await fetch('/api/chat/message', { method: 'POST', headers, body })
    return await fallback.json()
  }

  // Parse SSE stream
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''
  const result: any = { text: '', toolCalls: [], agentName: '', agentDomain: '', agentColor: '', suggestions: [] }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data: ')) continue
      try {
        const event = JSON.parse(trimmed.slice(6))

        switch (event.type) {
          case 'token':
            fullText += event.content
            onTextChunk?.(event.content)
            break
          case 'tool_start':
            onToolUse?.({ type: 'tool_start', tool: event.tool } as any)
            break
          case 'tool_done':
            onToolUse?.({ type: 'tool_done', tool: event.tool, summary: event.summary } as any)
            break
          case 'status':
          case 'agent':
            // Agent selection events — can update UI header
            if (event.agentName) result.agentName = event.agentName
            if (event.agentDomain) result.agentDomain = event.agentDomain
            if (event.agentColor) result.agentColor = event.agentColor
            break
          case 'done':
            // Final result with metadata
            result.agentName = event.agentName || result.agentName
            result.agentDomain = event.agentDomain || result.agentDomain
            result.agentColor = event.agentColor || result.agentColor
            result.toolCalls = event.toolCalls || []
            result.suggestions = event.suggestions || []
            result.sessionId = event.sessionId
            result.totalTokens = event.totalTokens
            break
          case 'error':
            throw new Error(event.message)
        }
      } catch (e) {
        if (e instanceof Error && e.message !== 'Unexpected end of JSON input') throw e
      }
    }
  }

  result.text = fullText || result.text
  return result
}

// ── Session Management (stays frontend-side) ────────────────
export async function createChatSession(title: string): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('entity')
    .select('azienda_id')
    .eq('id', user.id)
    .single()

  if (!profile) return null

  const { data, error } = await supabase
    .from('chat_sessions')
    .insert({
      azienda_id: (profile as { azienda_id: string }).azienda_id,
      user_id: user.id,
      titolo: title,
    })
    .select('id')
    .single()

  if (error) return null
  return (data as { id: string }).id
}

export async function fetchChatSessions(): Promise<
  { id: string; titolo: string; created_at: string; updated_at: string }[]
> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from('chat_sessions')
    .select('id, titolo, created_at, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })

  return (data ?? []) as { id: string; titolo: string; created_at: string; updated_at: string }[]
}

export async function fetchSessionMessages(sessionId: string): Promise<ChatMessage[]> {
  const { data } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })

  return (data ?? []) as ChatMessage[]
}

export async function updateSessionTitle(sessionId: string, title: string): Promise<void> {
  await supabase
    .from('chat_sessions')
    .update({ titolo: title, updated_at: new Date().toISOString() })
    .eq('id', sessionId)
}
