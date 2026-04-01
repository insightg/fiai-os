import { Router, Response } from 'express'
import { AuthRequest, authMiddleware } from './middleware.js'
import db from './db.js'
import { searchDocumentsAI, generateSearchQueries, synthesizeFromDocuments, summarizeText, compareDocuments } from './ai.js'
import fs from 'fs'
import path from 'path'

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
        SELECT d.id, d.display_name as nome, json_extract(d.metadata,'$.categoria') as categoria, json_extract(d.metadata,'$.descrizione') as descrizione, json_extract(d.metadata,'$.tags') as tags, d.file_url, json_extract(d.metadata,'$.file_size') as file_size, json_extract(d.metadata,'$.tipo_file') as tipo_file, d.created_at,
               rank
        FROM entity_fts fts
        JOIN entity d ON d.rowid = fts.rowid
        WHERE entity_fts MATCH ?
          AND d.azienda_id = ? AND d.type = 'documento'
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
      FROM v_documenti
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
      FROM v_documenti
      WHERE id IN (${placeholders})
    `
    const result = db.prepare(resultSql).all(...matchedIds)
    res.json({ data: result, error: null, method: 'ai' })
  } catch (err) {
    console.error('Document search error:', err)
    res.status(500).json({ data: null, error: { message: (err as Error).message } })
  }
})

// ── Helper: extract text from file on disk ──────────────

const UPLOADS_DIR = process.env.UPLOADS_DIR || '/app/data/uploads'

async function extractTextFromFile(fileUrl: string, tipoFile: string | null): Promise<string> {
  // fileUrl is like /api/uploads/azienda/user/documenti/filename.pdf
  const relativePath = fileUrl.replace(/^\/api\/uploads\//, '')
  const filePath = path.join(UPLOADS_DIR, relativePath)

  if (!fs.existsSync(filePath)) return ''

  const ext = path.extname(filePath).toLowerCase()

  if (ext === '.pdf') {
    try {
      const { PDFParse: pdfParse } = await import('pdf-parse')
      const pdfBuffer = fs.readFileSync(filePath)
      const pdfData = await pdfParse(pdfBuffer)
      return pdfData.text
    } catch {
      return ''
    }
  } else if (ext === '.txt') {
    return fs.readFileSync(filePath, 'utf-8')
  }

  return ''
}

// ── Deep Search (Agentic multi-turn) ─────────────────────

router.post('/search-deep', authMiddleware(true), async (req: AuthRequest, res: Response) => {
  try {
    const { query } = req.body
    const aziendaId = req.aziendaId

    if (!query || !aziendaId) {
      res.status(400).json({ data: null, error: { message: 'Query e azienda_id richiesti' } })
      return
    }

    // Step 1: Generate search query variants using LLM
    const queries = await generateSearchQueries(query)

    // Step 2: Run FTS5 for each query, collect unique results
    const allResults = new Map<string, Record<string, unknown>>()
    for (const q of queries) {
      try {
        const rows = db.prepare(
          `SELECT d.id, d.display_name as nome, json_extract(d.metadata,'$.categoria') as categoria, json_extract(d.metadata,'$.descrizione') as descrizione, json_extract(d.metadata,'$.tags') as tags, d.file_url, json_extract(d.metadata,'$.file_size') as file_size, json_extract(d.metadata,'$.tipo_file') as tipo_file, json_extract(d.metadata,'$.contenuto_testo') as contenuto_testo, d.created_at
           FROM entity_fts fts
           JOIN entity d ON d.rowid = fts.rowid
           WHERE entity_fts MATCH ?
             AND d.azienda_id = ? AND d.type = 'documento'
           LIMIT 10`
        ).all(q, aziendaId) as Record<string, unknown>[]
        for (const row of rows) allResults.set(row.id as string, row)
      } catch { /* skip invalid FTS syntax */ }
    }

    // Step 3: LIKE search for broader coverage
    const likePattern = `%${query}%`
    const likeRows = db.prepare(
      `SELECT id, nome, categoria, descrizione, tags, file_url, file_size, tipo_file, contenuto_testo, created_at
       FROM v_documenti
       WHERE azienda_id = ?
         AND (nome LIKE ? OR descrizione LIKE ? OR contenuto_testo LIKE ?)
       LIMIT 10`
    ).all(aziendaId, likePattern, likePattern, likePattern) as Record<string, unknown>[]
    for (const row of likeRows) allResults.set(row.id as string, row)

    const docs = Array.from(allResults.values())

    // Step 4: Generate RAG synthesis
    const summary = await synthesizeFromDocuments(query, docs as any)

    // Strip contenuto_testo from response to keep it small
    const docsClean = docs.map(({ contenuto_testo, ...rest }) => rest)

    res.json({ data: docsClean, summary, queryVariants: queries, method: 'deep' })
  } catch (err) {
    console.error('Deep search error:', err)
    res.status(500).json({ data: null, error: { message: (err as Error).message } })
  }
})

// ── Summarize Document ───────────────────────────────────

router.post('/summarize', authMiddleware(true), async (req: AuthRequest, res: Response) => {
  try {
    const { documentId } = req.body

    if (!documentId) {
      res.status(400).json({ error: { message: 'documentId richiesto' } })
      return
    }

    const doc = db.prepare('SELECT * FROM v_documenti WHERE id = ?').get(documentId) as Record<string, unknown> | undefined
    if (!doc) {
      res.status(404).json({ error: 'Documento non trovato' })
      return
    }

    let text = doc.contenuto_testo as string | null

    // If no text, try to extract it
    if (!text && doc.file_url) {
      text = await extractTextFromFile(doc.file_url as string, doc.tipo_file as string | null)
      if (text) {
        db.prepare('UPDATE documenti SET contenuto_testo = ? WHERE id = ?').run(text, documentId)
      }
    }

    if (!text) {
      res.json({ summary: 'Impossibile estrarre testo dal documento.', keyInfo: {} })
      return
    }

    const result = await summarizeText(text, doc.nome as string)
    res.json(result)
  } catch (err) {
    console.error('Summarize error:', err)
    res.status(500).json({ error: { message: (err as Error).message } })
  }
})

// ── Get Document Content ─────────────────────────────────

router.get('/content/:id', authMiddleware(true), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params

    const doc = db.prepare('SELECT id, nome, contenuto_testo, file_url, tipo_file FROM v_documenti WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!doc) {
      res.status(404).json({ error: 'Documento non trovato' })
      return
    }

    let text = doc.contenuto_testo as string | null

    if (!text && doc.file_url) {
      text = await extractTextFromFile(doc.file_url as string, doc.tipo_file as string | null)
      if (text) {
        db.prepare('UPDATE documenti SET contenuto_testo = ? WHERE id = ?').run(text, id)
      }
    }

    res.json({ id: doc.id, nome: doc.nome, contenuto_testo: text || '' })
  } catch (err) {
    console.error('Get content error:', err)
    res.status(500).json({ error: { message: (err as Error).message } })
  }
})

// ── Compare Two Documents ────────────────────────────────

router.post('/compare', authMiddleware(true), async (req: AuthRequest, res: Response) => {
  try {
    const { docId1, docId2 } = req.body

    if (!docId1 || !docId2) {
      res.status(400).json({ error: { message: 'docId1 e docId2 richiesti' } })
      return
    }

    const doc1 = db.prepare('SELECT id, nome, contenuto_testo, file_url, tipo_file FROM v_documenti WHERE id = ?').get(docId1) as Record<string, unknown> | undefined
    const doc2 = db.prepare('SELECT id, nome, contenuto_testo, file_url, tipo_file FROM v_documenti WHERE id = ?').get(docId2) as Record<string, unknown> | undefined

    if (!doc1 || !doc2) {
      res.status(404).json({ error: 'Uno o entrambi i documenti non trovati' })
      return
    }

    // Extract text if needed
    let text1 = doc1.contenuto_testo as string | null
    if (!text1 && doc1.file_url) {
      text1 = await extractTextFromFile(doc1.file_url as string, doc1.tipo_file as string | null)
      if (text1) db.prepare('UPDATE documenti SET contenuto_testo = ? WHERE id = ?').run(text1, docId1)
    }

    let text2 = doc2.contenuto_testo as string | null
    if (!text2 && doc2.file_url) {
      text2 = await extractTextFromFile(doc2.file_url as string, doc2.tipo_file as string | null)
      if (text2) db.prepare('UPDATE documenti SET contenuto_testo = ? WHERE id = ?').run(text2, docId2)
    }

    if (!text1 || !text2) {
      res.json({ similarities: [], differences: [], summary: 'Impossibile confrontare: uno o entrambi i documenti non hanno contenuto testuale.' })
      return
    }

    const result = await compareDocuments(
      { nome: doc1.nome as string, contenuto_testo: text1 },
      { nome: doc2.nome as string, contenuto_testo: text2 }
    )

    res.json({
      ...result,
      doc1: { id: doc1.id, nome: doc1.nome },
      doc2: { id: doc2.id, nome: doc2.nome },
    })
  } catch (err) {
    console.error('Compare error:', err)
    res.status(500).json({ error: { message: (err as Error).message } })
  }
})

export default router
