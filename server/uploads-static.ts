import { Router, Response } from 'express'
import path from 'path'
import fs from 'fs'
import { AuthRequest, authMiddleware } from './middleware.js'

const router = Router()
const UPLOADS_DIR = process.env.UPLOADS_DIR || '/app/data/uploads'

const MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.txt': 'text/plain',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

// Serve uploaded files with auth check
router.get('/:aziendaId/{*subPath}', authMiddleware(true), (req: AuthRequest, res: Response) => {
  const aziendaId = req.params.aziendaId as string
  const rawSubPath = req.params.subPath
  const subPath = (Array.isArray(rawSubPath) ? rawSubPath.join('/') : rawSubPath) as string

  // Security: user can only access files from their own azienda
  if (req.aziendaId && req.aziendaId !== aziendaId) {
    res.status(403).json({ error: { message: 'Accesso non autorizzato' } })
    return
  }

  // Prevent directory traversal
  const safePath = path.normalize(subPath).replace(/^(\.\.(\/|\\|$))+/, '')
  const filePath = path.join(UPLOADS_DIR, aziendaId, safePath)

  if (!filePath.startsWith(path.join(UPLOADS_DIR, aziendaId))) {
    res.status(403).json({ error: { message: 'Percorso non valido' } })
    return
  }

  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: { message: 'File non trovato' } })
    return
  }

  const ext = path.extname(filePath).toLowerCase()
  const contentType = MIME_TYPES[ext] || 'application/octet-stream'

  res.setHeader('Content-Type', contentType)
  res.setHeader('Content-Disposition', `inline; filename="${path.basename(filePath)}"`)
  fs.createReadStream(filePath).pipe(res)
})

export default router
