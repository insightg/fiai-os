import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import db from './db.js'

const JWT_SECRET = process.env.JWT_SECRET || 'fiai-dev-secret'

export interface AuthRequest extends Request {
  userId?: string
  aziendaId?: string
}

export function authMiddleware(required = true) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (!token) {
      if (required) {
        res.status(401).json({ error: { message: 'Token mancante', code: 'AUTH_REQUIRED' } })
        return
      }
      return next()
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; email: string }
      req.userId = decoded.userId

      // Resolve azienda_id from names relation membro_di → organizzazione
      const rel = db.prepare(
        "SELECT r.to_id FROM relations r WHERE r.from_id = ? AND r.tipo = 'membro_di' LIMIT 1"
      ).get(decoded.userId) as { to_id: string } | undefined

      if (rel) {
        req.aziendaId = rel.to_id
      } else {
        // Fallback: try azienda_id directly from names
        const nameRec = db.prepare("SELECT azienda_id FROM names WHERE id = ?").get(decoded.userId) as any
        if (nameRec?.azienda_id) req.aziendaId = nameRec.azienda_id
      }

      next()
    } catch {
      if (required) {
        res.status(401).json({ error: { message: 'Token non valido', code: 'INVALID_TOKEN' } })
        return
      }
      next()
    }
  }
}

/**
 * Sanitize metadata: remove sensitive fields (password_hash) from API responses.
 * Call this on any names record before sending to client.
 */
export function sanitizeMetadata(metadata: string | Record<string, unknown>): Record<string, unknown> {
  const obj = typeof metadata === 'string' ? JSON.parse(metadata) : { ...metadata }
  delete obj.password_hash
  return obj
}
