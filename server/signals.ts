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

// GET /api/signals/analytics — Aggregate signal analytics
router.get('/analytics', authMiddleware(true), (req: AuthRequest, res: Response) => {
  try {
    const aziendaId = req.aziendaId || 'unknown'
    const aziendaDir = path.join(CONTEXT_DIR, 'aziende', aziendaId)
    const usersDir = path.join(aziendaDir, 'users')

    if (!fs.existsSync(usersDir)) {
      res.json({ totalInteractions: 0, byAgent: {}, byDomain: {}, avgLatency: 0, totalCost: 0 })
      return
    }

    let totalInteractions = 0
    let totalLatency = 0
    let totalCost = 0
    let totalTokens = 0
    const byAgent: Record<string, number> = {}
    const byDomain: Record<string, { count: number; cost: number; tokens: number }> = {}

    const userDirs = fs.readdirSync(usersDir, { withFileTypes: true }).filter(d => d.isDirectory())
    for (const userDir of userDirs) {
      const interactionsFile = path.join(usersDir, userDir.name, 'signals', 'interactions.jsonl')
      if (!fs.existsSync(interactionsFile)) continue

      const lines = fs.readFileSync(interactionsFile, 'utf-8').trim().split('\n').filter(Boolean)
      for (const line of lines) {
        try {
          const s = JSON.parse(line)
          totalInteractions++
          totalLatency += s.latencyMs ?? 0
          totalCost += s.cost ?? 0
          totalTokens += s.tokens ?? 0

          const agent = s.agentName || 'unknown'
          byAgent[agent] = (byAgent[agent] || 0) + 1

          const domain = s.domain || 'general'
          if (!byDomain[domain]) byDomain[domain] = { count: 0, cost: 0, tokens: 0 }
          byDomain[domain].count++
          byDomain[domain].cost += s.cost ?? 0
          byDomain[domain].tokens += s.tokens ?? 0
        } catch { /* skip */ }
      }
    }

    res.json({
      totalInteractions,
      avgLatency: totalInteractions > 0 ? Math.round(totalLatency / totalInteractions) : 0,
      totalCost: totalCost.toFixed(4),
      totalTokens,
      byAgent,
      byDomain,
    })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router
