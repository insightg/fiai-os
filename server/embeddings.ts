/**
 * FIAI OS — Embedding Pipeline
 *
 * Generates vector embeddings for entity records via OpenRouter API.
 * Stored in entity.embedding as BLOB (Float32Array).
 * Used by the `find` tool for semantic search.
 */
import crypto from 'crypto'
import db from './db.js'
import { registerJobHandler } from './jobs.js'

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'openai/text-embedding-3-small'
const EMBEDDING_DIM = 1536 // text-embedding-3-small dimension

// ── Generate embedding via OpenRouter ────────────────────

async function getEmbedding(text: string): Promise<number[]> {
  const truncated = text.substring(0, 8000) // limit input tokens

  const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: truncated,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Embedding API error ${res.status}: ${err}`)
  }

  const data = await res.json()
  return data.data?.[0]?.embedding || []
}

// ── Build text to embed per entity type ──────────────────

function buildEmbeddingText(entity: any): string {
  const meta = typeof entity.metadata === 'string' ? JSON.parse(entity.metadata) : (entity.metadata || {})
  const parts: string[] = []

  // Display name is always included
  if (entity.display_name) parts.push(entity.display_name)

  // Type-specific text
  switch (entity.type) {
    case 'persona':
    case 'utente':
    case 'organizzazione':
      if (entity.email) parts.push(entity.email)
      if (meta.ragione_sociale) parts.push(meta.ragione_sociale)
      if (meta.cognome) parts.push(meta.cognome)
      if (entity.tags) {
        const tags = typeof entity.tags === 'string' ? JSON.parse(entity.tags) : entity.tags
        if (tags.length) parts.push(tags.join(' '))
      }
      break

    case 'chunk':
      // Use body (the actual text content) for chunk embedding
      if (entity.body) parts.push(entity.body.substring(0, 2000))
      if (meta.heading_path) parts.push(meta.heading_path)
      break

    case 'documento':
    case 'report':
    case 'contratto':
    case 'cv':
      if (meta.descrizione) parts.push(meta.descrizione)
      if (entity.categoria) parts.push(entity.categoria)
      if (entity.body) parts.push(entity.body.substring(0, 2000))
      break

    case 'fattura':
    case 'fattura_passiva':
      if (entity.numero) parts.push('fattura ' + entity.numero)
      if (meta.oggetto) parts.push(meta.oggetto)
      break

    case 'progetto':
      if (meta.descrizione) parts.push(meta.descrizione)
      break

    case 'preventivo':
    case 'ordine':
      if (entity.numero) parts.push(entity.numero)
      if (meta.note) parts.push(meta.note)
      break

    default:
      if (meta.descrizione) parts.push(meta.descrizione)
      break
  }

  return parts.filter(Boolean).join(' ').substring(0, 8000)
}

// ── Embed a single entity ────────────────────────────────

export async function embedEntity(entityId: string): Promise<boolean> {
  const entity = db.prepare('SELECT * FROM entity WHERE id = ?').get(entityId) as any
  if (!entity) return false

  const text = buildEmbeddingText(entity)
  if (text.length < 5) return false

  try {
    const embedding = await getEmbedding(text)
    if (embedding.length === 0) return false

    const buffer = Buffer.from(new Float32Array(embedding).buffer)
    db.prepare('UPDATE entity SET embedding = ? WHERE id = ?').run(buffer, entityId)
    // Sync to vec0 index for fast vector search
    if (entity.type === 'chunk') {
      try { db.prepare('INSERT OR REPLACE INTO chunk_vec(chunk_id, embedding) VALUES (?, ?)').run(entityId, buffer) } catch {}
    }
    return true
  } catch (err) {
    console.error(`[Embedding] Error for ${entityId}:`, (err as Error).message)
    return false
  }
}

// ── Batch embed unembedded entities ──────────────────────

export async function embedBatch(aziendaId: string, limit = 50): Promise<number> {
  // Skip types that don't need embedding
  const skipTypes = ['chat_message', 'chat_session', 'agent_log', 'job', 'workflow_log',
    'category_template', 'skill', 'agent_memory', 'board', 'board_column']

  const rows = db.prepare(
    `SELECT id, type, display_name, body, email, tags, categoria, metadata
     FROM entity
     WHERE azienda_id = ? AND embedding IS NULL
       AND type NOT IN (${skipTypes.map(() => '?').join(',')})
     LIMIT ?`
  ).all(aziendaId, ...skipTypes, limit) as any[]

  let embedded = 0
  for (const row of rows) {
    const text = buildEmbeddingText(row)
    if (text.length < 5) continue

    try {
      const embedding = await getEmbedding(text)
      if (embedding.length > 0) {
        const buffer = Buffer.from(new Float32Array(embedding).buffer)
        db.prepare('UPDATE entity SET embedding = ? WHERE id = ?').run(buffer, row.id)
        // Sync to vec0 index
        if (row.type === 'chunk') {
          try { db.prepare('INSERT OR REPLACE INTO chunk_vec(chunk_id, embedding) VALUES (?, ?)').run(row.id, buffer) } catch {}
        }
        embedded++
      }
      // Rate limit: small delay between API calls
      await new Promise(r => setTimeout(r, 100))
    } catch (err) {
      console.error(`[Embedding] Batch error for ${row.id}:`, (err as Error).message)
    }
  }

  if (embedded > 0) console.log(`[Embedding] Embedded ${embedded}/${rows.length} entities`)
  return embedded
}

// ── Parallel batch embedding ─────────────────────────────

export async function embedBatchParallel(aziendaId: string, total: number, concurrency = 20): Promise<number> {
  const skipTypes = ['chat_message', 'chat_session', 'agent_log', 'job', 'workflow_log',
    'category_template', 'skill', 'agent_memory', 'board', 'board_column']

  let embedded = 0
  let processed = 0

  while (processed < total + 100) {  // safety margin
    const rows = db.prepare(
      `SELECT id, type, display_name, body, email, tags, categoria, metadata
       FROM entity
       WHERE azienda_id = ? AND embedding IS NULL
         AND type NOT IN (${skipTypes.map(() => '?').join(',')})
       LIMIT ?`
    ).all(aziendaId, ...skipTypes, concurrency * 2) as any[]

    if (rows.length === 0) break

    // Process in parallel batches
    const batch = rows.slice(0, concurrency)
    const results = await Promise.allSettled(
      batch.map(async (row) => {
        const text = buildEmbeddingText(row)
        if (text.length < 5) return false

        const embedding = await getEmbedding(text)
        if (embedding.length === 0) return false

        const buffer = Buffer.from(new Float32Array(embedding).buffer)
        db.prepare('UPDATE entity SET embedding = ? WHERE id = ?').run(buffer, row.id)
        if (row.type === 'chunk') {
          try { db.prepare('INSERT OR REPLACE INTO chunk_vec(chunk_id, embedding) VALUES (?, ?)').run(row.id, buffer) } catch {}
        }
        return true
      })
    )

    const batchEmbedded = results.filter(r => r.status === 'fulfilled' && r.value === true).length
    embedded += batchEmbedded
    processed += batch.length

    if (processed % 100 === 0 || rows.length < concurrency) {
      console.log(`[Embedding] Progress: ${embedded}/${processed} embedded (${concurrency} parallel)`)
    }
  }

  console.log(`[Embedding] Parallel batch complete: ${embedded} embedded total`)
  return embedded
}

// ── Cosine similarity search ─────────────────────────────

export async function semanticSearch(
  query: string,
  aziendaId: string,
  type?: string,
  limit = 10
): Promise<any[]> {
  // Get query embedding
  const queryEmbedding = await getEmbedding(query)
  if (queryEmbedding.length === 0) return []

  // Get all entities with embeddings (for small datasets, brute-force is fine)
  let sql = 'SELECT id, type, display_name, email, telefono, tags, stato, categoria, body, metadata, embedding FROM entity WHERE azienda_id = ? AND embedding IS NOT NULL'
  const params: any[] = [aziendaId]
  if (type) { sql += ' AND type = ?'; params.push(type) }
  // Exclude internal types
  sql += " AND type NOT IN ('chat_message','chat_session','agent_log','job','chunk')"

  const rows = db.prepare(sql).all(...params) as any[]

  // Calculate cosine similarity
  const scored = rows.map(row => {
    const embedding = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4)
    const similarity = cosineSimilarity(queryEmbedding, Array.from(embedding))
    return { ...row, similarity, embedding: undefined } // don't return the blob
  })

  // Sort by similarity (highest first) and limit
  scored.sort((a, b) => b.similarity - a.similarity)
  return scored.slice(0, limit).filter(r => r.similarity > 0.3) // threshold
}

// ── Semantic chunk search (for retrieve) — uses sqlite-vec ──

export async function semanticChunkSearch(
  query: string,
  aziendaId: string,
  docId?: string,
  limit = 10
): Promise<any[]> {
  const queryEmbedding = await getEmbedding(query)
  if (queryEmbedding.length === 0) return []

  const queryBuffer = Buffer.from(new Float32Array(queryEmbedding).buffer)

  try {
    // Use vec0 index for fast ANN search
    let sql = `SELECT v.chunk_id, v.distance,
      e.display_name, e.parent_id, e.body,
      json_extract(e.metadata, '$.heading_path') as heading_path,
      json_extract(e.metadata, '$.chunk_index') as chunk_index,
      parent.display_name as document_name
      FROM chunk_vec v
      JOIN entity e ON e.id = v.chunk_id
      JOIN entity parent ON e.parent_id = parent.id
      WHERE v.embedding MATCH ? AND k = ?
        AND parent.azienda_id = ?`
    const params: any[] = [queryBuffer, limit * 3, aziendaId]  // fetch more, filter later
    if (docId) { sql += ' AND e.parent_id = ?'; params.push(docId) }
    sql += ' ORDER BY v.distance'

    const rows = db.prepare(sql).all(...params) as any[]
    // Convert distance to similarity (lower distance = higher similarity)
    return rows.slice(0, limit).map(r => ({
      ...r,
      similarity: 1 - r.distance,
      contenuto_testo: r.body,
    }))
  } catch {
    // Fallback to brute-force if vec0 not available
    let sql = `SELECT e.id, e.display_name, e.parent_id, e.body,
      json_extract(e.metadata, '$.heading_path') as heading_path,
      json_extract(e.metadata, '$.chunk_index') as chunk_index,
      parent.display_name as document_name, e.embedding
      FROM entity e
      JOIN entity parent ON e.parent_id = parent.id
      WHERE e.type = 'chunk' AND e.embedding IS NOT NULL AND parent.azienda_id = ?`
    const params: any[] = [aziendaId]
    if (docId) { sql += ' AND e.parent_id = ?'; params.push(docId) }

    const rows = db.prepare(sql).all(...params) as any[]
    const scored = rows.map(row => {
      const embedding = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4)
      const similarity = cosineSimilarity(queryEmbedding, Array.from(embedding))
      return { ...row, similarity, embedding: undefined, contenuto_testo: row.body }
    })
    scored.sort((a, b) => b.similarity - a.similarity)
    return scored.slice(0, limit).filter(r => r.similarity > 0.35)
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

// ── Register job handler + auto-embed on create ─────────

export function initEmbeddings(): void {
  // Job handler for batch embedding
  registerJobHandler('generate_embeddings', async (_params, _jobId, aziendaId) => {
    const total = await embedBatchParallel(aziendaId, 10000, 20)
    return { embedded: total }
  })

  // Job handler for processing a confirmed document (chunk + tag + embed)
  registerJobHandler('process_document', async (params, _jobId, aziendaId) => {
    const { entityId, fileName, chunk_strategy, use_ocr } = params
    if (!entityId) return { error: 'Missing entityId' }

    const { chunkDocument } = await import('./chunker.js')
    const { tagDocumentChunks } = await import('./chunk-tagger.js')

    const entity = db.prepare('SELECT type, display_name, body, file_url FROM entity WHERE id = ?').get(entityId) as any
    if (!entity) return { error: 'Entity not found' }

    // Resolve file path
    const fs = await import('fs')
    const path = await import('path')
    const UPLOADS_DIR = process.env.UPLOADS_DIR || '/app/data/uploads'
    const relativePath = entity.file_url ? entity.file_url.replace(/^\/api\/uploads\//, '') : ''
    const filePath = relativePath ? path.join(UPLOADS_DIR, relativePath) : ''
    const ext = filePath ? path.extname(filePath).toLowerCase() : ''

    // Read extracted text: try body first, then re-extract from file
    let extractedText = entity.body || ''
    if (!extractedText && filePath) {
      if (ext === '.pdf' && fs.existsSync(filePath)) {
        try {
          const { PDFParse } = await import('pdf-parse')
          const uint8 = new Uint8Array(fs.readFileSync(filePath))
          const parser = new PDFParse(uint8)
          const parsed = await parser.getText()
          extractedText = parsed.text || ''
          console.log(`[ProcessDoc] Re-extracted ${extractedText.length} chars from PDF`)
        } catch (e) { console.error('[ProcessDoc] PDF extract error:', (e as Error).message) }
      } else if (ext === '.txt' && fs.existsSync(filePath)) {
        extractedText = fs.readFileSync(filePath, 'utf-8')
      } else if (ext === '.docx' && fs.existsSync(filePath)) {
        try {
          const mammoth = await import('mammoth')
          const result = await mammoth.default.extractRawText({ path: filePath })
          extractedText = result.value || ''
        } catch {}
      }
    }

    // OCR: if requested and PDF has little/no text, use vision model
    if (use_ocr && ext === '.pdf' && filePath && fs.existsSync(filePath)) {
      console.log(`[ProcessDoc] OCR requested for "${fileName}" — starting Riconoscitore`)
      try {
        const { ocrPdf } = await import('./ocr.js')
        const ocrResult = await ocrPdf(filePath, {
          onProgress: (page, total) => {
            // Update job status with progress
            db.prepare("UPDATE entity SET metadata = json_set(metadata, '$.ocr_progress', ?) WHERE id = ?")
              .run(`${page}/${total}`, _jobId)
          },
        })
        if (ocrResult.text.length > extractedText.length) {
          console.log(`[ProcessDoc] OCR produced ${ocrResult.text.length} chars (was ${extractedText.length}) from ${ocrResult.pages} pages`)
          extractedText = ocrResult.text
          // Update entity body with OCR text
          db.prepare("UPDATE entity SET body = ? WHERE id = ?").run(extractedText, entityId)
        } else {
          console.log(`[ProcessDoc] OCR produced less text (${ocrResult.text.length}) than extraction (${extractedText.length}), keeping original`)
        }
      } catch (ocrErr: any) {
        console.error(`[ProcessDoc] OCR error: ${ocrErr.message}`)
      }
    }

    if (!extractedText) return { error: 'No text available' }

    // 1. Chunk the document
    const chunks = chunkDocument(extractedText, entity.type, fileName, chunk_strategy)
    const isChunked = chunks.length > 0

    if (isChunked) {
      const insertChunk = db.prepare(`INSERT INTO entity (id, azienda_id, type, display_name, slug, parent_id, body, metadata, path, ordine)
        VALUES (?, ?, 'chunk', ?, ?, ?, ?, ?, ?, ?)`)

      for (const chunk of chunks) {
        const chunkId = crypto.randomUUID()
        const chunkSlug = `chunk-${chunk.chunk_index}`
        insertChunk.run(
          chunkId, aziendaId,
          chunk.display_name.substring(0, 200), chunkSlug,
          entityId,
          chunk.content,
          JSON.stringify({
            chunk_index: chunk.chunk_index,
            chunk_total: chunk.chunk_total,
            heading_path: chunk.heading_path,
            char_offset_start: chunk.char_offset_start,
            char_offset_end: chunk.char_offset_end,
            ...(chunk.extracted || {}),
          }),
          `/entity/chunks/${chunkSlug}`,
          chunk.chunk_index
        )
      }
      console.log(`[ProcessDoc] Chunked "${fileName}" into ${chunks.length} chunks`)

      // Update parent: clear body (text is in chunks now), set metadata
      const meta = db.prepare('SELECT metadata FROM entity WHERE id = ?').get(entityId) as any
      const existingMeta = typeof meta?.metadata === 'string' ? JSON.parse(meta.metadata) : {}
      db.prepare('UPDATE entity SET stato = NULL, body = NULL, metadata = ? WHERE id = ?').run(
        JSON.stringify({ ...existingMeta, chunked: true, chunk_count: chunks.length, total_chars: extractedText.length }),
        entityId
      )
    } else {
      // Small doc: save full text as body
      db.prepare('UPDATE entity SET body = ?, stato = NULL WHERE id = ?').run(extractedText, entityId)
    }

    // 2. Tag chunks
    if (isChunked) {
      const tagged = await tagDocumentChunks(entityId)
      console.log(`[ProcessDoc] Tagged ${tagged} chunks`)
    }

    // 3. Embed chunks — parallel batches for speed
    if (isChunked) {
      const total = await embedBatchParallel(aziendaId, chunks.length)
      console.log(`[ProcessDoc] Embedded ${total} chunks`)
    } else {
      await embedEntity(entityId)
    }

    // 4. Extract structured data from text for invoices/documents
    if (entity.type === 'fattura_passiva' || entity.type === 'fattura') {
      try {
        const updates: string[] = []
        const params: any[] = []
        // Extract totale from text (patterns: $100.00, €100.00, TOTAL 100.00, Totale 100,00)
        const totaleMatch = extractedText.match(/(?:TOTAL(?:\s+PAID)?|Totale|Amount|Importo)[:\s]*[$€]?\s*([\d.,]+)/i)
        if (totaleMatch) {
          const totale = parseFloat(totaleMatch[1].replace(/,/g, '.').replace(/\.(?=.*\.)/g, ''))
          if (totale > 0) { updates.push('totale = ?'); params.push(totale) }
        }
        // Extract invoice number
        const numMatch = extractedText.match(/(?:Invoice\s*(?:ID|#|No)?|Fattura\s*(?:n|nr|num)?)[.:\s]*([A-Za-z0-9_-]+)/i)
        if (numMatch) { updates.push('numero = ?'); params.push(numMatch[1]) }
        // Extract date
        const dateMatch = extractedText.match(/(?:Date|Data)[:\s]*(\w+ \d{1,2},? \d{4}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/i)
        if (dateMatch) {
          try {
            const d = new Date(dateMatch[1])
            if (!isNaN(d.getTime())) { updates.push('data = ?'); params.push(d.toISOString().split('T')[0]) }
          } catch {}
        }
        if (updates.length > 0) {
          params.push(entityId)
          db.prepare(`UPDATE entity SET ${updates.join(', ')} WHERE id = ?`).run(...params)
          console.log(`[ProcessDoc] Extracted structured data: ${updates.map(u => u.split(' ')[0]).join(', ')}`)
        }
      } catch {}
    }

    return { chunked: isChunked, chunks: chunks.length }
  })

  // Job handler for batch chunk tagging
  registerJobHandler('tag_chunks', async (_params, _jobId, aziendaId) => {
    const { tagAllChunks } = await import('./chunk-tagger.js')
    const count = await tagAllChunks(aziendaId)
    return { tagged: count }
  })

  // Auto-embed on entity creation (fire-and-forget, non-blocking)
  const skipTypes = new Set(['chat_message', 'chat_session', 'agent_log', 'job', 'workflow_log',
    'category_template', 'skill', 'agent_memory', 'board', 'board_column'])

  import('./agents/events.js').then(({ on }) => {
    on('entity_created:*', async (payload) => {
      if (skipTypes.has(payload.entityType || '')) return
      try {
        await embedEntity(payload.recordId)
      } catch {}
    })
  }).catch(() => {})

  console.log('[Embedding] Pipeline initialized (auto-embed on create)')
}
