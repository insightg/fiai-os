import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import db from './db.js'

const router = Router()
const JWT_SECRET = process.env.JWT_SECRET || 'fiai-dev-secret'

function generateToken(userId: string, email: string): string {
  return jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: '7d' })
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[àáâã]/g, 'a').replace(/[èéêë]/g, 'e').replace(/[ìíîï]/g, 'i')
    .replace(/[òóôõ]/g, 'o').replace(/[ùúûü]/g, 'u')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 80) || 'unnamed'
}

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      res.status(400).json({ user: null, session: null, error: { message: 'Email e password richiesti' } })
      return
    }

    // Look up user in names table (tag: utente)
    const user = db.prepare(
      "SELECT id, email, metadata FROM names WHERE email = ? AND tags LIKE '%\"utente\"%'"
    ).get(email) as { id: string; email: string; metadata: string } | undefined

    if (!user) {
      res.status(400).json({ user: null, session: null, error: { message: 'Credenziali non valide' } })
      return
    }

    const metadata = JSON.parse(user.metadata)
    if (!metadata.password_hash) {
      res.status(400).json({ user: null, session: null, error: { message: 'Credenziali non valide' } })
      return
    }

    const passwordMatch = await bcrypt.compare(password, metadata.password_hash)
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

    // Check if user already exists in names
    const existing = db.prepare("SELECT id FROM names WHERE email = ?").get(email)
    if (existing) {
      res.status(400).json({ user: null, session: null, error: { message: 'Utente già esistente' } })
      return
    }

    const passwordHash = await bcrypt.hash(password, 10)

    const signupTx = db.transaction(() => {
      const userId = crypto.randomUUID()
      const displayName = nome ? `${nome} ${cognome || ''}`.trim() : email
      const slug = slugify(displayName)
      const tags = ['utente']
      if (ruolo === 'admin') tags.push('admin')

      // Resolve azienda_id
      let orgId = azienda_id
      if (!orgId) {
        const org = db.prepare("SELECT id FROM names WHERE tags LIKE '%\"organizzazione\"%' LIMIT 1").get() as any
        orgId = org?.id
      }

      // Create name with utente tag
      db.prepare(`INSERT INTO names (id, azienda_id, display_name, slug, email, tags, metadata, path)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        userId, orgId, displayName, slug, email,
        JSON.stringify(tags),
        JSON.stringify({
          password_hash: passwordHash,
          cognome: cognome || '',
          ruolo: ruolo || 'collaboratore',
          tts_voice: 'Vivian',
        }),
        `/names/${slug}`
      )

      // Legacy write (keeps users table in sync for any remaining references)
      try { db.prepare('INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, ?)').run(userId, email, passwordHash) } catch {}

      // Create membro_di relation
      if (orgId) {
        db.prepare(`INSERT OR IGNORE INTO relations (id, azienda_id, from_type, from_id, to_type, to_id, tipo)
          VALUES (?, ?, 'name', ?, 'name', ?, 'membro_di')`).run(
          crypto.randomUUID(), orgId, userId, orgId
        )
      }

      return { id: userId, email }
    })

    const user = signupTx()
    const token = generateToken(user.id, user.email)

    res.json({
      user: { id: user.id, email: user.email },
      session: { access_token: token },
      error: null,
    })
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
