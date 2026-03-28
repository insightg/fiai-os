import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import pool from './db.js'

const router = Router()
const JWT_SECRET = process.env.JWT_SECRET || 'fiai-dev-secret'

function generateToken(userId: string, email: string): string {
  return jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: '7d' })
}

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      res.status(400).json({ user: null, session: null, error: { message: 'Email e password richiesti' } })
      return
    }

    const result = await pool.query('SELECT id, email, password_hash FROM users WHERE email = $1', [email])
    if (result.rows.length === 0) {
      res.status(400).json({ user: null, session: null, error: { message: 'Credenziali non valide' } })
      return
    }

    const user = result.rows[0]
    const passwordMatch = await bcrypt.compare(password, user.password_hash)
    if (!passwordMatch) {
      res.status(400).json({ user: null, session: null, error: { message: 'Credenziali non valide' } })
      return
    }

    const token = generateToken(user.id, user.email)

    res.json({
      user: { id: user.id, email: user.email },
      session: { access_token: token },
      error: null,
    })
  } catch (err) {
    console.error('Login error:', err)
    res.status(500).json({ user: null, session: null, error: { message: 'Errore interno del server' } })
  }
})

// POST /api/auth/signup
router.post('/signup', async (req: Request, res: Response) => {
  try {
    const { email, password, nome, cognome, ruolo, azienda_id } = req.body

    if (!email || !password) {
      res.status(400).json({ user: null, session: null, error: { message: 'Email e password richiesti' } })
      return
    }

    // Check if user already exists
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email])
    if (existing.rows.length > 0) {
      res.status(400).json({ user: null, session: null, error: { message: 'Utente già esistente' } })
      return
    }

    const passwordHash = await bcrypt.hash(password, 10)

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const userResult = await client.query(
        'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
        [email, passwordHash]
      )
      const user = userResult.rows[0]

      // Use the provided azienda_id, or find the first one
      let profileAziendaId = azienda_id
      if (!profileAziendaId) {
        const aziendaResult = await client.query('SELECT id FROM aziende LIMIT 1')
        if (aziendaResult.rows.length > 0) {
          profileAziendaId = aziendaResult.rows[0].id
        }
      }

      if (profileAziendaId) {
        await client.query(
          `INSERT INTO user_profiles (id, azienda_id, email, nome, cognome, ruolo)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [user.id, profileAziendaId, email, nome || '', cognome || '', ruolo || 'collaboratore']
        )
      }

      await client.query('COMMIT')

      const token = generateToken(user.id, user.email)

      res.json({
        user: { id: user.id, email: user.email },
        session: { access_token: token },
        error: null,
      })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  } catch (err) {
    console.error('Signup error:', err)
    res.status(500).json({ user: null, session: null, error: { message: 'Errore interno del server' } })
  }
})

// POST /api/auth/logout
router.post('/logout', (_req: Request, res: Response) => {
  res.json({ error: null })
})

// GET /api/auth/session
router.get('/session', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (!token) {
      res.json({ user: null, session: null })
      return
    }

    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; email: string }

    res.json({
      user: { id: decoded.userId, email: decoded.email },
      session: { access_token: token },
    })
  } catch {
    res.json({ user: null, session: null })
  }
})

export default router
