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

interface FileEntry {
  name: string
  path: string
  url: string
  size: number
  type: string
  category: string
  createdAt: string
}

function scanDir(dir: string, base: string): FileEntry[] {
  const results: FileEntry[] = []
  if (!fs.existsSync(dir)) return results

  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...scanDir(fullPath, base))
    } else if (entry.isFile()) {
      const relativePath = path.relative(base, fullPath)
      const ext = path.extname(entry.name).toLowerCase()
      const stat = fs.statSync(fullPath)
      const parts = relativePath.split(path.sep)
      const category = parts.length > 1 ? parts[0] : 'general'

      results.push({
        name: entry.name,
        path: relativePath,
        url: '', // filled in by caller with correct prefix
        size: stat.size,
        type: MIME_TYPES[ext] || 'application/octet-stream',
        category,
        createdAt: stat.mtime.toISOString(),
      })
    }
  }
  return results
}

// GET /api/files — list all files for the current user
router.get('/', authMiddleware(true), (req: AuthRequest, res: Response) => {
  try {
    const aziendaId = req.aziendaId || 'unknown'
    const userId = req.userId || 'unknown'
    const userDir = path.join(UPLOADS_DIR, aziendaId, userId)

    const files = scanDir(userDir, userDir)

    // Build URLs
    for (const f of files) {
      f.url = `/api/uploads/${aziendaId}/${userId}/${f.path}`
    }

    // Sort by createdAt descending
    files.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    res.json(files)
  } catch (err) {
    console.error('File listing error:', err)
    res.status(500).json({ error: { message: (err as Error).message } })
  }
})

// DELETE /api/files/:category/:filename — delete a specific file
router.delete('/:category/:filename', authMiddleware(true), (req: AuthRequest, res: Response) => {
  try {
    const aziendaId = req.aziendaId || 'unknown'
    const userId = req.userId || 'unknown'
    const userDir = path.join(UPLOADS_DIR, aziendaId, userId)

    const filePath = `${req.params.category}/${req.params.filename}`
    if (!filePath) {
      res.status(400).json({ error: { message: 'Percorso file mancante' } })
      return
    }

    // Prevent directory traversal
    const safePath = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '')
    const fullPath = path.join(userDir, safePath)

    if (!fullPath.startsWith(userDir)) {
      res.status(403).json({ error: { message: 'Percorso non valido' } })
      return
    }

    if (!fs.existsSync(fullPath)) {
      res.status(404).json({ error: { message: 'File non trovato' } })
      return
    }

    fs.unlinkSync(fullPath)
    res.json({ success: true })
  } catch (err) {
    console.error('File deletion error:', err)
    res.status(500).json({ error: { message: (err as Error).message } })
  }
})

export default router
