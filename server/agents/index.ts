import { Router, Response } from 'express'
import { AuthRequest, authMiddleware } from '../middleware.js'
import type { ChatResponse } from './types.js'
import { orchestrate } from './orchestrator.js'

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
  }
): Promise<ChatResponse> {
  // Support both `history` and `conversationHistory` for backward compat
  const history = options?.history || options?.conversationHistory
  return orchestrate(message, userId, aziendaId, {
    format: options?.format,
    sessionId: options?.sessionId,
    history,
    attachedImageBase64: options?.attachedImageBase64,
    attachedAudioBase64: options?.attachedAudioBase64,
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
      }
    )

    res.json(result)
  } catch (err) {
    console.error('Chat API error:', err)
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router
