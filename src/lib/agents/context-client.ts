import { getAuthToken } from '../supabase'

const API_URL = '/api/context'

async function fetchContext(path: string): Promise<string> {
  try {
    const token = getAuthToken()
    const res = await fetch(`${API_URL}/${path}`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    })
    if (!res.ok) return ''
    const data = await res.json()
    return data.content ?? ''
  } catch {
    return ''
  }
}

export async function getGlobalContext(): Promise<string> {
  return fetchContext('global')
}

export async function getAgentContext(domain: string): Promise<string> {
  return fetchContext(`agent/${domain}`)
}

export async function getUserProfile(): Promise<string> {
  return fetchContext('profile')
}

export async function getSessionContext(sessionId: string): Promise<string> {
  return fetchContext(`session/${sessionId}`)
}

export async function saveSessionContext(sessionId: string, summary: string): Promise<void> {
  try {
    const token = getAuthToken()
    await fetch(`${API_URL}/session/${sessionId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ content: summary }),
    })
  } catch {
    // Non-critical: session context save failure should not break anything
  }
}

export async function refreshContexts(): Promise<void> {
  try {
    const token = getAuthToken()
    await fetch(`${API_URL}/refresh`, {
      method: 'POST',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    })
  } catch {
    // Non-critical
  }
}

export async function captureSignal(signal: Record<string, unknown>): Promise<void> {
  try {
    const token = getAuthToken()
    await fetch('/api/signals/capture', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(signal),
    })
  } catch { /* fire-and-forget */ }
}

export async function rateMessage(messageId: string, sessionId: string, domain: string, rating: 'up' | 'down'): Promise<void> {
  try {
    const token = getAuthToken()
    await fetch('/api/signals/rate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ messageId, sessionId, domain, rating }),
    })
  } catch { /* fire-and-forget */ }
}

export async function getPreferences(): Promise<string> {
  return fetchContext('preferences')
}

export async function buildFullContext(domain: string, sessionId?: string): Promise<string> {
  const [global, profile, agent, session, preferences] = await Promise.all([
    getGlobalContext(),
    getUserProfile(),
    getAgentContext(domain),
    sessionId ? getSessionContext(sessionId) : Promise.resolve(''),
    getPreferences(),
  ])

  const parts: string[] = []
  if (global) parts.push(global)
  if (profile) parts.push(profile)
  if (agent) parts.push(agent)
  if (session) parts.push(`## Sessione Precedente\n${session}`)
  if (preferences) parts.push(preferences)

  return parts.join('\n\n---\n\n')
}
