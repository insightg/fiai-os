import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import db from './db.js'
import { UserPermissions, type PermAction } from './agents/types.js'

const JWT_SECRET = process.env.JWT_SECRET || 'fiai-dev-secret'

export interface AuthRequest extends Request {
  userId?: string
  aziendaId?: string
  permissions?: UserPermissions
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
      const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; email: string; platform?: boolean }

      // Platform admin token — full access, resolve azienda from DB
      if (decoded.platform) {
        req.userId = 'platform-admin'
        // Find the org that has utente entities (the active org, not legacy imports)
        const org = db.prepare("SELECT azienda_id, COUNT(*) as c FROM entity WHERE type = 'utente' GROUP BY azienda_id ORDER BY c DESC LIMIT 1").get() as any
        req.aziendaId = org?.azienda_id || (db.prepare("SELECT id FROM entity WHERE type = 'organizzazione' LIMIT 1").get() as any)?.id || ''
        req.permissions = new UserPermissions([{ name: 'platform-admin', permissions: { '*': ['read', 'create', 'update', 'delete', 'send'] } }])
        return next()
      }

      req.userId = decoded.userId

      // Resolve azienda_id from names relation membro_di → organizzazione
      const rel = db.prepare(
        "SELECT r.to_id FROM relations r WHERE r.from_id = ? AND r.tipo = 'membro_di' LIMIT 1"
      ).get(decoded.userId) as { to_id: string } | undefined

      if (rel) {
        req.aziendaId = rel.to_id
      } else {
        // Fallback: try azienda_id directly from entity
        const nameRec = db.prepare("SELECT azienda_id FROM entity WHERE id = ?").get(decoded.userId) as any
        if (nameRec?.azienda_id) req.aziendaId = nameRec.azienda_id
      }

      // Load user permissions from groups (unified — no separate roles)
      try {
        const groups = db.prepare(
          "SELECT e.display_name, e.metadata FROM relations r JOIN entity e ON e.id = r.to_id WHERE r.from_id = ? AND r.tipo = 'membro_di_gruppo'"
        ).all(decoded.userId) as any[]
        const groupData = groups.map(g => {
          const m = typeof g.metadata === 'string' ? JSON.parse(g.metadata) : (g.metadata || {})
          return { name: g.display_name, permissions: m.permissions || {}, agentPermissions: m.agentPermissions || undefined }
        })
        req.permissions = new UserPermissions(groupData)
      } catch {
        req.permissions = new UserPermissions([])  // default: read only
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
