import { Router, Response } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { AuthRequest, authMiddleware } from './middleware.js'
import { analyzeInvoice, analyzeDocument } from './ai.js'

const router = Router()

const UPLOADS_DIR = process.env.UPLOADS_DIR || '/app/data/uploads'

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
    const allowed = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.txt', '.doc', '.docx']
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
    res.json({
      url: fileUrl,
      originalName: req.file.originalname,
      size: req.file.size,
      mimeType: req.file.mimetype,
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
        const pdfParse = (await import('pdf-parse')).default
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

    res.json({ fileUrl, recognizedData })
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
        const pdfParse = (await import('pdf-parse')).default
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

export default router
