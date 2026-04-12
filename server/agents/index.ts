import { Router, Response } from 'express'
import crypto from 'crypto'
import { AuthRequest, authMiddleware } from '../middleware.js'
import type { ChatResponse } from './types.js'
import { orchestrate } from './orchestrator.js'
import { AGENTS } from './config.js'
import db from '../db.js'

// ── Session & Message Persistence ──────────────────────

function ensureSession(sessionId: string, userId: string, aziendaId: string, channel: string = 'web'): string {
  if (!sessionId) sessionId = crypto.randomUUID()
  const existing = db.prepare("SELECT id FROM chat_sessions WHERE id = ?").get(sessionId)
  if (!existing) {
    db.prepare("INSERT INTO chat_sessions (id, azienda_id, user_id, titolo, channel) VALUES (?,?,?,?,?)").run(
      sessionId, aziendaId, userId, 'Nuova conversazione', channel
    )
  }
  return sessionId
}

function saveMessage(sessionId: string, userId: string, role: string, content: string, agentDomain?: string, agentName?: string, toolCalls?: any) {
  try {
    db.prepare("INSERT INTO chat_messages (id, session_id, user_id, ruolo, contenuto, tool_calls, agent_domain, agent_name) VALUES (?,?,?,?,?,?,?,?)").run(
      crypto.randomUUID(), sessionId, userId, role, content,
      toolCalls ? JSON.stringify(toolCalls) : null,
      agentDomain || null, agentName || null
    )
    db.prepare("UPDATE chat_sessions SET updated_at = datetime('now'), agent_domain = ? WHERE id = ?").run(agentDomain || null, sessionId)
  } catch {}
}

function loadHistory(sessionId: string, limit: number = 20): { role: string; content: string }[] {
  try {
    const rows = db.prepare(
      "SELECT ruolo as role, contenuto as content FROM chat_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?"
    ).all(sessionId, limit) as any[]
    return rows.reverse()
  } catch { return [] }
}

// ── Public API ─────────────────────────────────────────

export async function handleChatMessage(
  message: string,
  userId: string,
  aziendaId: string,
  options?: {
    format?: string
    sessionId?: string
    channel?: string
    history?: { role: string; content: string }[]
    attachedImageBase64?: string
    attachedAudioBase64?: string
    conversationHistory?: { role: string; content: string }[]
    permissions?: import('./types.js').UserPermissions
  }
): Promise<ChatResponse> {
  const channel = options?.channel || (options?.format === 'whatsapp' ? 'whatsapp' : 'web')
  const sessionId = ensureSession(options?.sessionId || '', userId, aziendaId, channel)

  // Load history from DB if not provided by caller
  let history = options?.history || options?.conversationHistory
  if (!history || history.length === 0) {
    history = loadHistory(sessionId, 20)
  }

  // Save user message
  saveMessage(sessionId, userId, 'user', message)

  const result = await orchestrate(message, userId, aziendaId, {
    format: options?.format,
    sessionId,
    history,
    attachedImageBase64: options?.attachedImageBase64,
    attachedAudioBase64: options?.attachedAudioBase64,
    permissions: options?.permissions,
  })

  // Save assistant response
  saveMessage(sessionId, userId, 'assistant', result.text, result.agentDomain, result.agentName, result.toolCalls)

  // Auto-title session from first message
  try {
    const session = db.prepare("SELECT titolo FROM chat_sessions WHERE id = ?").get(sessionId) as any
    if (session?.titolo === 'Nuova conversazione' && message.length > 3) {
      const title = message.substring(0, 60) + (message.length > 60 ? '...' : '')
      db.prepare("UPDATE chat_sessions SET titolo = ? WHERE id = ?").run(title, sessionId)
    }
  } catch {}

  return { ...result, sessionId } as any
}

// ── Express Router ─────────────────────────────────────

const router = Router()

router.post('/message', authMiddleware(true), async (req: AuthRequest, res: Response) => {
  try {
    const { message, format, sessionId, conversationHistory, history, attachedImageBase64, attachedAudioBase64 } = req.body
    if (!message) { res.status(400).json({ error: 'message richiesto' }); return }

    const result = await handleChatMessage(
      message,
      req.userId || '',
      req.aziendaId || '',
      {
        format: format || 'web',
        sessionId: sessionId || '',
        history: history || conversationHistory || [],
        attachedImageBase64,
        attachedAudioBase64,
        permissions: req.permissions,
      }
    )

    res.json(result)
  } catch (err) {
    console.error('Chat API error:', err)
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── Agent Views API ───────────────────────────────────

router.get('/agent-views/:domain', authMiddleware(true), (req: AuthRequest, res: Response) => {
  const agent = AGENTS[req.params.domain]
  if (!agent) { res.json({ views: [] }); return }
  res.json({ views: agent.views || [], color: agent.color, name: agent.name })
})

// ── Active Jobs API ───────────────────────────────────

router.get('/jobs/active', authMiddleware(true), (req: AuthRequest, res: Response) => {
  try {
    const jobs = db.prepare(`
      SELECT id, display_name, stato, data, created_at, updated_at,
        json_extract(metadata, '$.action') as action,
        json_extract(metadata, '$.result') as result,
        json_extract(metadata, '$.error') as error,
        json_extract(metadata, '$.retry_count') as retry_count
      FROM entity
      WHERE type = 'job' AND azienda_id = ?
        AND stato IN ('queued', 'running')
      ORDER BY created_at DESC
      LIMIT 20
    `).all(req.aziendaId || '') as any[]

    // Also get recently completed (last 5 min)
    const recent = db.prepare(`
      SELECT id, display_name, stato, data, created_at, updated_at,
        json_extract(metadata, '$.action') as action,
        json_extract(metadata, '$.result') as result,
        json_extract(metadata, '$.error') as error
      FROM entity
      WHERE type = 'job' AND azienda_id = ?
        AND stato IN ('completed', 'failed', 'dead')
        AND updated_at > datetime('now', '-5 minutes')
      ORDER BY updated_at DESC
      LIMIT 10
    `).all(req.aziendaId || '') as any[]

    res.json({ active: jobs, recent })
  } catch {
    res.json({ active: [], recent: [] })
  }
})

export default router
