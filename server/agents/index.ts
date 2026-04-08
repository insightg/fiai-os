import { Router, Response } from 'express'
import { AuthRequest, authMiddleware } from '../middleware.js'
import type { ChatResponse } from './types.js'
import { orchestrate } from './orchestrator.js'
import { AGENTS } from './config.js'
import db from '../db.js'

// ── Public API ─────────────────────────────────────────

export async function handleChatMessage(
  message: string,
  userId: string,
  aziendaId: string,
  options?: {
    format?: 'web' | 'whatsapp'
    sessionId?: string
    history?: { role: string; content: string }[]
    attachedImageBase64?: string
    attachedAudioBase64?: string
    conversationHistory?: { role: string; content: string }[]
    permissions?: import('./types.js').UserPermissions
  }
): Promise<ChatResponse> {
  const history = options?.history || options?.conversationHistory
  return orchestrate(message, userId, aziendaId, {
    format: options?.format,
    sessionId: options?.sessionId,
    history,
    attachedImageBase64: options?.attachedImageBase64,
    attachedAudioBase64: options?.attachedAudioBase64,
    permissions: options?.permissions,
  })
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
