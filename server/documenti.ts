import { Router, Response } from 'express'
import { AuthRequest, authMiddleware } from './middleware.js'
import pool from './db.js'
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

    // Step 1: PostgreSQL full-text search
    const ftsSql = `
      SELECT id, nome, categoria, descrizione, tags, file_url, file_size, tipo_file, created_at,
             ts_rank(
               to_tsvector('italian', COALESCE(nome,'') || ' ' || COALESCE(descrizione,'') || ' ' || COALESCE(contenuto_testo,'')),
               plainto_tsquery('italian', $1)
             ) AS rank
      FROM documenti
      WHERE azienda_id = $2
        AND to_tsvector('italian', COALESCE(nome,'') || ' ' || COALESCE(descrizione,'') || ' ' || COALESCE(contenuto_testo,''))
            @@ plainto_tsquery('italian', $1)
      ORDER BY rank DESC
      LIMIT 20
    `
    const ftsResult = await pool.query(ftsSql, [query, aziendaId])

    if (ftsResult.rows.length > 0) {
      res.json({ data: ftsResult.rows, error: null, method: 'fts' })
      return
    }

    // Step 2: Fallback to AI-powered search
    const allDocsSql = `
      SELECT id, nome, categoria, descrizione, tags
      FROM documenti
      WHERE azienda_id = $1
      ORDER BY created_at DESC
      LIMIT 100
    `
    const allDocs = await pool.query(allDocsSql, [aziendaId])

    if (allDocs.rows.length === 0) {
      res.json({ data: [], error: null, method: 'empty' })
      return
    }

    const matchedIds = await searchDocumentsAI(query, allDocs.rows)

    if (matchedIds.length === 0) {
      res.json({ data: [], error: null, method: 'ai' })
      return
    }

    const placeholders = matchedIds.map((_, i) => `$${i + 1}`).join(', ')
    const resultSql = `
      SELECT id, nome, categoria, descrizione, tags, file_url, file_size, tipo_file, created_at
      FROM documenti
      WHERE id IN (${placeholders})
    `
    const result = await pool.query(resultSql, matchedIds)
    res.json({ data: result.rows, error: null, method: 'ai' })
  } catch (err) {
    console.error('Document search error:', err)
    res.status(500).json({ data: null, error: { message: (err as Error).message } })
  }
})

export default router
