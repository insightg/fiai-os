import { Router, Response } from 'express'
import fs from 'fs'
import path from 'path'
import { AuthRequest, authMiddleware } from './middleware.js'

const router = Router()
const CONTEXT_DIR = process.env.CONTEXT_DIR || '/app/data/context'

// POST /api/signals/capture — Save interaction signal
router.post('/capture', authMiddleware(true), (req: AuthRequest, res: Response) => {
  try {
    const signal = req.body
    const aziendaId = req.aziendaId || 'unknown'
    const userId = req.userId || 'unknown'

    const signalsDir = path.join(CONTEXT_DIR, 'aziende', aziendaId, 'users', userId, 'signals')
    fs.mkdirSync(signalsDir, { recursive: true })

    const line = JSON.stringify({ ...signal, ts: new Date().toISOString() }) + '\n'
    fs.appendFileSync(path.join(signalsDir, 'interactions.jsonl'), line)

    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// POST /api/signals/rate — Save user rating
router.post('/rate', authMiddleware(true), (req: AuthRequest, res: Response) => {
  try {
    const { messageId, sessionId, domain, rating } = req.body
    const aziendaId = req.aziendaId || 'unknown'
    const userId = req.userId || 'unknown'

    const signalsDir = path.join(CONTEXT_DIR, 'aziende', aziendaId, 'users', userId, 'signals')
    fs.mkdirSync(signalsDir, { recursive: true })

    const line = JSON.stringify({ ts: new Date().toISOString(), messageId, sessionId, domain, rating }) + '\n'
    fs.appendFileSync(path.join(signalsDir, 'ratings.jsonl'), line)

    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router
