import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import pool from './db.js'

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

      // Fetch azienda_id from user_profiles
      const profileResult = await pool.query(
        'SELECT azienda_id FROM user_profiles WHERE id = $1',
        [decoded.userId]
      )
      if (profileResult.rows.length > 0) {
        req.aziendaId = profileResult.rows[0].azienda_id
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
