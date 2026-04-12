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
  _onToolUse?: (event: ToolUseEvent) => void,
  _onTextChunk?: (chunk: string) => void,
  attachedImageBase64?: string,
  attachedAudioBase64?: string
): Promise<{ text: string; toolCalls: Record<string, unknown>[]; agentName?: string; agentDomain?: string; agentColor?: string; suggestions?: string[]; reasoning?: any }> {
  const token = getAuthToken()
  const lastMsg = messages[messages.length - 1]
  const message = typeof lastMsg.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg.content)

  const res = await fetch('/api/chat/message', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      message,
      sessionId,
      history: messages.slice(0, -1).map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      })),
      attachedImageBase64,
      attachedAudioBase64,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error(err.error || `Errore ${res.status}`)
  }

  const result = await res.json()

  // Save messages to DB
  try {
    const userContent = typeof lastMsg.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg.content)
    await supabase.from('chat_messages').insert({
      session_id: sessionId,
      ruolo: 'user',
      contenuto: userContent,
      tool_calls: null,
    })

    await supabase.from('chat_messages').insert({
      session_id: sessionId,
      ruolo: 'assistant',
      contenuto: result.text,
      tool_calls: result.toolCalls?.length > 0 ? result.toolCalls : null,
    })
  } catch {
    console.warn('Errore nel salvataggio messaggi chat')
  }

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
