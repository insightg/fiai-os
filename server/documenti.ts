import { Router, Response } from 'express'
import { AuthRequest, authMiddleware } from './middleware.js'
import db from './db.js'
import { searchDocumentsAI } from './ai.js'

const router = Router()

// ── Full-text + Agentic Search ──────────────────────────

router.post('/search', authMiddleware(true), async (req: AuthRequest, res: Response) => {
  try {
    const { query } = req.body
    const aziendaId = req.aziendaId

    if (!query || !aziendaId) {
      res.status(400).json({ data: null, error: { message: 'Query e azienda_id richiesti' } })
      return
    }

    // Step 1: FTS5 full-text search
    try {
      const ftsSql = `
        SELECT d.id, d.nome, d.categoria, d.descrizione, d.tags, d.file_url, d.file_size, d.tipo_file, d.created_at,
               rank
        FROM documenti_fts fts
        JOIN documenti d ON d.rowid = fts.rowid
        WHERE documenti_fts MATCH ?
          AND d.azienda_id = ?
        ORDER BY rank
        LIMIT 20
      `
      const ftsRows = db.prepare(ftsSql).all(query, aziendaId) as Record<string, unknown>[]

      if (ftsRows.length > 0) {
        res.json({ data: ftsRows, error: null, method: 'fts' })
        return
      }
    } catch {
      // FTS match can throw on invalid syntax; fall through to AI search
    }

    // Step 2: Fallback to AI-powered search
    const allDocsSql = `
      SELECT id, nome, categoria, descrizione, tags
      FROM documenti
      WHERE azienda_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    `
    const allDocs = db.prepare(allDocsSql).all(aziendaId) as Record<string, unknown>[]

    if (allDocs.length === 0) {
      res.json({ data: [], error: null, method: 'empty' })
      return
    }

    const matchedIds = await searchDocumentsAI(query, allDocs as any)

    if (matchedIds.length === 0) {
      res.json({ data: [], error: null, method: 'ai' })
      return
    }

    const placeholders = matchedIds.map(() => '?').join(', ')
    const resultSql = `
      SELECT id, nome, categoria, descrizione, tags, file_url, file_size, tipo_file, created_at
      FROM documenti
      WHERE id IN (${placeholders})
    `
    const result = db.prepare(resultSql).all(...matchedIds)
    res.json({ data: result, error: null, method: 'ai' })
  } catch (err) {
    console.error('Document search error:', err)
    res.status(500).json({ data: null, error: { message: (err as Error).message } })
  }
})

export default router
