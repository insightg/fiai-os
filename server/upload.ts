import { Router, Response } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { AuthRequest, authMiddleware } from './middleware.js'
import { analyzeInvoice, analyzeDocument, analyzeUpload } from './ai.js'
import { needsOcr } from './ocr.js'
import { chunkDocument } from './chunker.js'
import db from './db.js'

const router = Router()

const UPLOADS_DIR = process.env.UPLOADS_DIR || '/app/data/uploads'

// Pending uploads cache — holds analysis results until user confirms
const pendingUploads = new Map<string, {
  aziendaId: string; userId: string; fileUrl: string; fileName: string; fileSize: number; pageCount: number
  extractedText: string; mimeType: string; ext: string
  analysis: any; matchedNameId: string | null; matchedNameDisplay: string | null
  createdAt: number
}>()

// Multer storage config
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(UPLOADS_DIR, 'tmp')
    fs.mkdirSync(dir, { recursive: true })
    cb(null, dir)
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    cb(null, `${crypto.randomUUID()}${ext}`)
  },
})

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.txt', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.mp3', '.wav', '.ogg', '.m4a', '.webm', '.mp4', '.mov', '.avi', '.zip', '.pptx']
    const ext = path.extname(file.originalname).toLowerCase()
    if (allowed.includes(ext)) {
      cb(null, true)
    } else {
      cb(new Error(`Tipo file non supportato: ${ext}`))
    }
  },
})

function moveFile(tmpPath: string, destDir: string, filename: string): string {
  fs.mkdirSync(destDir, { recursive: true })
  const destPath = path.join(destDir, filename)
  fs.renameSync(tmpPath, destPath)
  return destPath
}

// ── Generic Upload ─────────────────────────────────────

router.post('/', authMiddleware(true), upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: { message: 'Nessun file caricato' } })
      return
    }

    const aziendaId = req.aziendaId || 'unknown'
    const userId = req.userId || 'unknown'
    const destDir = path.join(UPLOADS_DIR, aziendaId, userId, 'general')
    moveFile(req.file.path, destDir, req.file.filename)

    const fileUrl = `/api/uploads/${aziendaId}/${userId}/general/${req.file.filename}`

    // Try to extract text and categorize for document archiving
    const ext = path.extname(req.file.originalname).toLowerCase()
    const filePath = path.join(destDir, req.file.filename)
    let extractedText = ''
    let aiSuggestions: { categoria?: string; tags?: string[]; descrizione?: string } | null = null

    try {
      if (ext === '.pdf') {
        const { PDFParse: pdfParse } = await import('pdf-parse')
        const pdfBuffer = fs.readFileSync(filePath)
        const pdfData = await pdfParse(pdfBuffer)
        extractedText = pdfData.text
      } else if (ext === '.txt') {
        extractedText = fs.readFileSync(filePath, 'utf-8')
      } else if (['.doc', '.docx'].includes(ext)) {
        extractedText = `[Documento: ${req.file.originalname}]`
      }

      if (extractedText) {
        aiSuggestions = await analyzeDocument(extractedText, req.file.originalname)
      } else if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
        // Images: categorize based on context
        aiSuggestions = { categoria: 'altro', tags: [], descrizione: `Immagine: ${req.file.originalname}` }
      }
    } catch (aiErr) {
      console.error('AI categorization error (generic upload):', aiErr)
    }

    res.json({
      url: fileUrl,
      originalName: req.file.originalname,
      size: req.file.size,
      mimeType: req.file.mimetype,
      extractedText: extractedText ? extractedText.substring(0, 50000) : '',
      suggestedCategoria: aiSuggestions?.categoria || 'altro',
      suggestedTags: aiSuggestions?.tags || [],
      suggestedDescrizione: aiSuggestions?.descrizione || '',
    })
  } catch (err) {
    console.error('Upload error:', err)
    res.status(500).json({ error: { message: (err as Error).message } })
  }
})

// ── Invoice Upload with AI Recognition ──────────────────

router.post('/fattura-passiva', authMiddleware(true), upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: { message: 'Nessun file caricato' } })
      return
    }

    const aziendaId = req.aziendaId || 'unknown'
    const userId = req.userId || 'unknown'
    const destDir = path.join(UPLOADS_DIR, aziendaId, userId, 'fatture-passive')
    moveFile(req.file.path, destDir, req.file.filename)
    const fileUrl = `/api/uploads/${aziendaId}/${userId}/fatture-passive/${req.file.filename}`

    // Extract content for AI analysis
    const ext = path.extname(req.file.originalname).toLowerCase()
    const filePath = path.join(destDir, req.file.filename)
    let recognizedData = null

    try {
      if (ext === '.pdf') {
        const { PDFParse: pdfParse } = await import('pdf-parse')
        const pdfBuffer = fs.readFileSync(filePath)
        const pdfData = await pdfParse(pdfBuffer)
        recognizedData = await analyzeInvoice(pdfData.text, false)
      } else if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
        const imageBuffer = fs.readFileSync(filePath)
        const base64 = imageBuffer.toString('base64')
        recognizedData = await analyzeInvoice(base64, true, req.file.mimetype)
      }
    } catch (aiErr) {
      console.error('AI invoice analysis error:', aiErr)
      // Non-fatal: return file URL without recognized data
    }

    res.json({
      fileUrl,
      recognizedData,
      originalName: req.file.originalname,
      size: req.file.size,
      mimeType: req.file.mimetype,
      extractedText: '',
      suggestedCategoria: 'amministrazione',
      suggestedTags: ['fattura', 'passiva'],
      suggestedDescrizione: recognizedData
        ? `Fattura ${recognizedData.numero_fattura || ''} - ${recognizedData.fornitore_ragione_sociale || ''}`
        : `Fattura: ${req.file.originalname}`,
    })
  } catch (err) {
    console.error('Invoice upload error:', err)
    res.status(500).json({ error: { message: (err as Error).message } })
  }
})

// ── Document Upload with AI Categorization ──────────────

router.post('/documento', authMiddleware(true), upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: { message: 'Nessun file caricato' } })
      return
    }

    const aziendaId = req.aziendaId || 'unknown'
    const userId = req.userId || 'unknown'
    const destDir = path.join(UPLOADS_DIR, aziendaId, userId, 'documenti')
    moveFile(req.file.path, destDir, req.file.filename)
    const fileUrl = `/api/uploads/${aziendaId}/${userId}/documenti/${req.file.filename}`

    // Extract text for AI analysis
    const ext = path.extname(req.file.originalname).toLowerCase()
    const filePath = path.join(destDir, req.file.filename)
    let extractedText = ''
    let aiSuggestions = null

    try {
      if (ext === '.pdf') {
        const { PDFParse: pdfParse } = await import('pdf-parse')
        const pdfBuffer = fs.readFileSync(filePath)
        const pdfData = await pdfParse(pdfBuffer)
        extractedText = pdfData.text
      } else if (ext === '.txt') {
        extractedText = fs.readFileSync(filePath, 'utf-8')
      } else if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
        // For images, we send to AI for OCR
        const imageBuffer = fs.readFileSync(filePath)
        const base64 = imageBuffer.toString('base64')
        extractedText = `[Immagine: ${req.file.originalname}]`
        // Use image analysis for categorization
        const { analyzeDocument: analyzeDoc } = await import('./ai.js')
        aiSuggestions = await analyzeDoc(`Immagine caricata: ${req.file.originalname}`, req.file.originalname)
      }

      if (extractedText && !aiSuggestions) {
        aiSuggestions = await analyzeDocument(extractedText, req.file.originalname)
      }
    } catch (aiErr) {
      console.error('AI document analysis error:', aiErr)
    }

    res.json({
      fileUrl,
      originalName: req.file.originalname,
      size: req.file.size,
      mimeType: req.file.mimetype,
      extractedText: extractedText.substring(0, 50000),
      suggestedCategoria: aiSuggestions?.categoria || 'altro',
      suggestedTags: aiSuggestions?.tags || [],
      suggestedDescrizione: aiSuggestions?.descrizione || '',
    })
  } catch (err) {
    console.error('Document upload error:', err)
    res.status(500).json({ error: { message: (err as Error).message } })
  }
})

// ── Extract Text from Existing Document ──────────────────

router.post('/extract-text', authMiddleware(true), async (req: AuthRequest, res: Response) => {
  try {
    const { documentId } = req.body

    if (!documentId) {
      res.status(400).json({ error: { message: 'documentId richiesto' } })
      return
    }

    const doc = db.prepare('SELECT id, file_url, tipo_file FROM documenti WHERE id = ?').get(documentId) as Record<string, unknown> | undefined
    if (!doc) {
      res.status(404).json({ error: { message: 'Documento non trovato' } })
      return
    }

    const fileUrl = doc.file_url as string
    if (!fileUrl) {
      res.json({ success: false, textLength: 0, error: 'Nessun file associato' })
      return
    }

    // Resolve file path from URL
    const relativePath = fileUrl.replace(/^\/api\/uploads\//, '')
    const filePath = path.join(UPLOADS_DIR, relativePath)

    if (!fs.existsSync(filePath)) {
      res.json({ success: false, textLength: 0, error: 'File non trovato su disco' })
      return
    }

    const ext = path.extname(filePath).toLowerCase()
    let extractedText = ''

    if (ext === '.pdf') {
      const { PDFParse: pdfParse } = await import('pdf-parse')
      const pdfBuffer = fs.readFileSync(filePath)
      const pdfData = await pdfParse(pdfBuffer)
      extractedText = pdfData.text
    } else if (ext === '.txt') {
      extractedText = fs.readFileSync(filePath, 'utf-8')
    }

    if (extractedText) {
      db.prepare('UPDATE documenti SET contenuto_testo = ? WHERE id = ?').run(extractedText, documentId)
    }

    res.json({ success: true, textLength: extractedText.length })
  } catch (err) {
    console.error('Extract text error:', err)
    res.status(500).json({ error: { message: (err as Error).message } })
  }
})

// ══════════════════════════════════════════════════════════
// Smart Upload — unified intelligent upload endpoint
// ══════════════════════════════════════════════════════════

router.post('/smart', authMiddleware(true), upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Nessun file caricato' })
      return
    }

    const aziendaId = req.aziendaId || 'unknown'
    const userId = req.userId || 'unknown'
    const file = req.file
    const ext = path.extname(file.originalname).toLowerCase()
    const fileName = file.originalname
    const analysisMode = (req.body?.mode || 'full') as 'full' | 'compact' | 'none'

    // 1. Move file to permanent location
    const destDir = path.join(UPLOADS_DIR, aziendaId, userId, 'files')
    const destFilename = `${crypto.randomUUID()}${ext}`
    const destPath = moveFile(file.path, destDir, destFilename)
    const fileUrl = `/api/uploads/${aziendaId}/${userId}/files/${destFilename}`
    const fileSize = fs.statSync(destPath).size

    // 2. Extract content based on file type
    let extractedText = ''
    let isImage = false
    let imageBase64 = ''

    let isAudio = false
    let pageCount = 0

    if (ext === '.pdf') {
      try {
        const pdfParse = (await import('pdf-parse')).default
        const pdfBuffer = fs.readFileSync(destPath)
        const parsed = await pdfParse(pdfBuffer)
        const fullText = parsed.text || ''
        pageCount = parsed.numpages || 0

        if (analysisMode === 'compact' && pageCount > 10) {
          // Sample pages: first 5 (for TOC/index) + distributed samples
          const pages = fullText.split(/\f/) // form feed = page break in pdf-parse
          if (pages.length > 5) {
            const tocPages = [0, 1, 2, 3, 4].filter(i => i < pages.length)
            const distPages = [Math.floor(pages.length * 0.25), Math.floor(pages.length * 0.5), Math.floor(pages.length * 0.75), pages.length - 1]
            const sampleIndices = [...new Set([...tocPages, ...distPages])].sort((a, b) => a - b)
            const samples = sampleIndices.map(i => pages[Math.min(i, pages.length - 1)])
            extractedText = samples.join('\n\n--- [pagina campione] ---\n\n')
          } else {
            extractedText = fullText
          }
          // But for chunking we always use full text — store it separately
          ;(req as any).__fullText = fullText
        } else {
          extractedText = fullText
        }
      } catch { extractedText = '' }
    } else if (ext === '.txt' || ext === '.csv') {
      extractedText = fs.readFileSync(destPath, 'utf-8')
    } else if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
      isImage = true
      const imgBuffer = fs.readFileSync(destPath)
      imageBase64 = `data:image/${ext.replace('.', '')};base64,${imgBuffer.toString('base64')}`
    } else if (['.mp3', '.wav', '.ogg', '.m4a', '.webm'].includes(ext)) {
      isAudio = true
      extractedText = `[File audio: ${fileName}, ${(fileSize / 1024).toFixed(1)} KB]`
    } else if (['.mp4', '.mov', '.avi'].includes(ext)) {
      extractedText = `[File video: ${fileName}, ${(fileSize / (1024 * 1024)).toFixed(1)} MB]`
    } else if (ext === '.docx') {
      try {
        const mammoth = await import('mammoth')
        const result = await mammoth.default.extractRawText({ path: destPath })
        extractedText = result.value || ''
      } catch { extractedText = `[Documento DOCX: ${fileName}]` }
    } else if (['.doc', '.xls', '.xlsx', '.pptx'].includes(ext)) {
      extractedText = `[Documento Office: ${fileName}]`
    } else if (ext === '.zip') {
      extractedText = `[Archivio: ${fileName}, ${(fileSize / (1024 * 1024)).toFixed(1)} MB]`
    }

    // 3. AI Analysis
    let analysis
    if (analysisMode === 'none') {
      // No AI — basic classification from extension
      const typeMap: Record<string, string> = {
        '.pdf': 'documento', '.doc': 'documento', '.docx': 'documento', '.txt': 'documento',
        '.png': 'foto', '.jpg': 'foto', '.jpeg': 'foto', '.webp': 'foto',
        '.mp3': 'audio', '.wav': 'audio', '.ogg': 'audio', '.m4a': 'audio', '.webm': 'audio',
        '.mp4': 'video', '.mov': 'video', '.avi': 'video',
        '.xls': 'documento', '.xlsx': 'documento', '.csv': 'documento', '.pptx': 'documento',
        '.zip': 'documento',
      }
      analysis = {
        entity_type: typeMap[ext] || 'documento',
        display_name: fileName.replace(/\.[^.]+$/, ''),
        suggested_name: null,
        categoria: 'altro',
        tags: [],
        descrizione: `File ${ext.replace('.', '').toUpperCase()}, ${(fileSize / 1024).toFixed(0)} KB`,
        extracted_data: {},
      }
    } else if (isAudio) {
      analysis = {
        entity_type: 'audio',
        display_name: fileName.replace(/\.[^.]+$/, ''),
        suggested_name: null,
        categoria: 'altro',
        tags: ['audio'],
        descrizione: `File audio ${ext.replace('.', '').toUpperCase()}, ${(fileSize / 1024).toFixed(0)} KB`,
        extracted_data: { formato: ext.replace('.', ''), dimensione_kb: Math.round(fileSize / 1024) },
      }
    } else {
      // Load custom category templates for AI recognition
      const customTemplates = db.prepare(
        "SELECT display_name, metadata FROM entity WHERE type = 'category_template' AND azienda_id = ?"
      ).all(aziendaId) as any[]
      const customCategories = customTemplates.map((t: any) => {
        const m = typeof t.metadata === 'string' ? JSON.parse(t.metadata) : t.metadata
        return { name: t.display_name, description: m.descrizione || '', keywords: m.keywords || [] }
      })

      analysis = await analyzeUpload(
        isImage ? imageBase64 : extractedText,
        fileName,
        isImage,
        file.mimetype,
        customCategories.length > 0 ? customCategories : undefined
      )
    }

    // 4. Name matching — try to find related name in DB
    let matchedNameId: string | null = null
    let matchedNameDisplay: string | null = null

    const ed = analysis.extracted_data as Record<string, any>

    // Match by P.IVA
    if (ed.piva) {
      const byPiva = db.prepare("SELECT id, display_name FROM entity WHERE piva = ? AND azienda_id = ?").get(ed.piva, aziendaId) as any
      if (byPiva) { matchedNameId = byPiva.id; matchedNameDisplay = byPiva.display_name }
    }
    // Match by company name
    if (!matchedNameId && (ed.fornitore || analysis.suggested_name)) {
      const searchName = ed.fornitore || analysis.suggested_name
      const byName = db.prepare("SELECT id, display_name FROM entity WHERE display_name LIKE ? AND azienda_id = ?").get(`%${searchName}%`, aziendaId) as any
      if (byName) { matchedNameId = byName.id; matchedNameDisplay = byName.display_name }
    }
    // Match by email
    if (!matchedNameId && ed.email) {
      const byEmail = db.prepare("SELECT id, display_name FROM entity WHERE email = ?").get(ed.email) as any
      if (byEmail) { matchedNameId = byEmail.id; matchedNameDisplay = byEmail.display_name }
    }

    // 5. Save analysis in memory (NOT in DB yet) — wait for user confirmation
    const uploadId = crypto.randomUUID()
    const fullText = (req as any).__fullText || extractedText

    // Store pending upload in a temporary cache
    pendingUploads.set(uploadId, {
      aziendaId, userId, fileUrl, fileName, fileSize, pageCount,
      extractedText: fullText,
      mimeType: file.mimetype,
      ext,
      analysis,
      matchedNameId, matchedNameDisplay,
      createdAt: Date.now(),
    })

    // Clean old pending uploads (>30 min)
    for (const [id, pu] of pendingUploads.entries()) {
      if (Date.now() - pu.createdAt > 30 * 60 * 1000) pendingUploads.delete(id)
    }

    console.log(`[Upload] Analyzed "${fileName}" — waiting for confirmation (upload_id: ${uploadId})`)

    // Check if PDF needs OCR (scanned/image-based)
    const isScannedPdf = ext === '.pdf' && needsOcr(extractedText, fileSize, pageCount)
    if (isScannedPdf) {
      console.log(`[Upload] PDF "${fileName}" appears scanned (${extractedText.length} chars from ${pageCount} pages, ${fileSize} bytes) — OCR available`)
    }

    res.json({
      upload_id: uploadId,
      file_url: fileUrl,
      entity_type: analysis.entity_type,
      display_name: analysis.display_name,
      categoria: analysis.categoria,
      tags: analysis.tags,
      descrizione: analysis.descrizione,
      extracted_data: analysis.extracted_data,
      matched_name: matchedNameId ? { id: matchedNameId, display_name: matchedNameDisplay } : null,
      suggested_name: analysis.suggested_name,
      file_size: fileSize,
      page_count: pageCount || undefined,
      chunk_strategy: analysis.chunk_strategy || undefined,
      needs_ocr: isScannedPdf || undefined,
    })
  } catch (err: any) {
    console.error('Smart upload error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ══════════════════════════════════════════════════════════
// Confirm Upload — saves entity + launches background job
// ══════════════════════════════════════════════════════════

router.post('/confirm', authMiddleware(true), async (req: AuthRequest, res: Response) => {
  try {
    const { upload_id, categoria, display_name, autore, chunk_strategy, use_ocr } = req.body
    if (!upload_id) { res.status(400).json({ error: 'upload_id richiesto' }); return }

    const pending = pendingUploads.get(upload_id)
    if (!pending) { res.status(404).json({ error: 'Upload non trovato o scaduto' }); return }

    pendingUploads.delete(upload_id)

    const { aziendaId, userId, fileUrl, fileName, fileSize, extractedText, mimeType, analysis, matchedNameId } = pending
    const finalCategoria = categoria || analysis.categoria
    const finalDisplayName = display_name || analysis.display_name
    const ed = analysis.extracted_data || {}
    if (autore) ed.autore = autore

    // Save entity
    const entityId = crypto.randomUUID()
    const slug = fileName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 80)
    const nameSlug = matchedNameId
      ? (db.prepare("SELECT slug FROM entity WHERE id = ?").get(matchedNameId) as any)?.slug || '_'
      : null
    const entityPath = nameSlug
      ? `/names/${nameSlug}/${analysis.entity_type}/${slug}`
      : `/entity/${analysis.entity_type}/${slug}`
    const uploaderName = (db.prepare("SELECT display_name FROM entity WHERE id = ?").get(userId) as any)?.display_name || userId

    db.prepare(`INSERT INTO entity (id, azienda_id, type, display_name, slug, stato, tags, name_id, parent_id, user_id, file_url, numero, data, totale, body, categoria, metadata, path)
      VALUES (?, ?, ?, ?, ?, 'processing', ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      entityId, aziendaId, analysis.entity_type, finalDisplayName, slug,
      JSON.stringify(analysis.tags || []),
      matchedNameId, userId, fileUrl,
      ed.numero || null, ed.data || null, ed.totale || null,
      extractedText || null,  // body: store full text temporarily, job will process it
      finalCategoria,
      JSON.stringify({
        tipo_file: mimeType,
        uploaded_by_name: uploaderName,
        tags: analysis.tags,
        descrizione: analysis.descrizione,
        file_size: fileSize,
        original_name: fileName,
        extracted_data: ed,
      }),
      entityPath
    )

    // Create background job for chunking + tagging + embedding
    const jobId = crypto.randomUUID()
    db.prepare(`INSERT INTO entity (id, azienda_id, type, display_name, slug, stato, data, metadata, path)
      VALUES (?, ?, 'job', ?, ?, 'queued', datetime('now'), ?, ?)`).run(
      jobId, aziendaId,
      `Processa: ${analysis.display_name}`, `process-doc-${entityId.substring(0, 8)}`,
      JSON.stringify({
        action: 'process_document',
        params: { entityId, fileName, chunk_strategy: chunk_strategy || undefined, use_ocr: use_ocr || false },
      }),
      `/entity/job/process-doc-${entityId.substring(0, 8)}`
    )

    console.log(`[Upload] Confirmed "${fileName}" → entity ${entityId}, job ${jobId}`)

    res.json({
      entity_id: entityId,
      job_id: jobId,
      display_name: analysis.display_name,
      categoria: finalCategoria,
      status: 'processing',
    })
  } catch (err: any) {
    console.error('Upload confirm error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ══════════════════════════════════════════════════════════
// Cancel Upload — deletes file, clears pending
// ══════════════════════════════════════════════════════════

router.post('/cancel', authMiddleware(true), (req: AuthRequest, res: Response) => {
  const { upload_id } = req.body
  if (!upload_id) { res.status(400).json({ error: 'upload_id richiesto' }); return }

  const pending = pendingUploads.get(upload_id)
  if (pending) {
    // Delete the uploaded file
    try {
      const relativePath = pending.fileUrl.replace(/^\/api\/uploads\//, '')
      const filePath = path.join(UPLOADS_DIR, relativePath)
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    } catch {}
    pendingUploads.delete(upload_id)
    console.log(`[Upload] Cancelled "${pending.fileName}"`)
  }

  res.json({ success: true })
})

export default router
