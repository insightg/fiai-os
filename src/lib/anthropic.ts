import { supabase } from './supabase'
import type { ChatMessage } from '../types'
import { orchestrate } from './agents/orchestrator'

// ── Message Types ───────────────────────────────────────────
export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string | object[]
}

export interface ToolUseEvent {
  toolName: string
  status: 'running' | 'done'
}

// ── Main Send Message Function ──────────────────────────────
export async function sendMessage(
  messages: ConversationMessage[],
  sessionId: string,
  onToolUse?: (event: ToolUseEvent) => void,
  onTextChunk?: (chunk: string) => void,
  attachedImageBase64?: string
): Promise<{ text: string; toolCalls: Record<string, unknown>[]; agentName?: string; agentDomain?: string; agentColor?: string; suggestions?: string[] }> {
  const result = await orchestrate(messages, sessionId, onToolUse, onTextChunk, attachedImageBase64)

  // Save messages to DB
  try {
    const lastUserMsg = messages[messages.length - 1]
    if (lastUserMsg && lastUserMsg.role === 'user') {
      const userContent =
        typeof lastUserMsg.content === 'string'
          ? lastUserMsg.content
          : JSON.stringify(lastUserMsg.content)

      await supabase.from('chat_messages').insert({
        session_id: sessionId,
        ruolo: 'user',
        contenuto: userContent,
        tool_calls: null,
      })
    }

    await supabase.from('chat_messages').insert({
      session_id: sessionId,
      ruolo: 'assistant',
      contenuto: result.text,
      tool_calls: result.toolCalls.length > 0 ? result.toolCalls : null,
    })
  } catch {
    console.warn('Errore nel salvataggio messaggi chat')
  }

  return {
    text: result.text,
    toolCalls: result.toolCalls,
    agentName: result.agentName,
    agentDomain: result.agentDomain,
    agentColor: result.agentColor,
    suggestions: result.suggestions,
  }
}

// ── Session Management ──────────────────────────────────────
export async function createChatSession(
  title: string
): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('user_profiles')
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
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from('chat_sessions')
    .select('id, titolo, created_at, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })

  return (data ?? []) as {
    id: string
    titolo: string
    created_at: string
    updated_at: string
  }[]
}

export async function fetchSessionMessages(
  sessionId: string
): Promise<ChatMessage[]> {
  const { data } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })

  return (data ?? []) as ChatMessage[]
}

export async function updateSessionTitle(
  sessionId: string,
  title: string
): Promise<void> {
  await supabase
    .from('chat_sessions')
    .update({ titolo: title, updated_at: new Date().toISOString() })
    .eq('id', sessionId)
}
