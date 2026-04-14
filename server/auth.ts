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

    // Look up user in entity table (type: utente)
    // Support login by email or by display_name (e.g. "admin")
    const user = db.prepare(
      "SELECT id, email, metadata FROM entity WHERE (email = ? OR LOWER(display_name) = LOWER(?)) AND type = 'utente'"
    ).get(email, email) as { id: string; email: string; metadata: string } | undefined

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
    const ruolo = metadata.ruolo || 'collaboratore'

    res.json({
      user: { id: user.id, email: user.email, ruolo },
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
    const existing = db.prepare("SELECT id FROM entity WHERE email = ?").get(email)
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

      // Resolve azienda_id — auto-create org if none exists
      let orgId = azienda_id
      if (!orgId) {
        const org = db.prepare("SELECT id FROM entity WHERE type = 'organizzazione' LIMIT 1").get() as any
        orgId = org?.id
      }
      if (!orgId) {
        // First signup: auto-create default organization
        orgId = crypto.randomUUID()
        db.prepare(`INSERT INTO entity (id, azienda_id, type, display_name, slug, tags, metadata, path)
          VALUES (?, ?, 'organizzazione', 'FIAI', 'fiai', '["organizzazione"]', '{}', '/entity/organizzazione/fiai')`).run(orgId, orgId)
      }

      // Create utente entity
      db.prepare(`INSERT INTO entity (id, azienda_id, type, display_name, slug, email, tags, metadata, path)
        VALUES (?, ?, 'utente', ?, ?, ?, ?, ?, ?)`).run(
        userId, orgId, displayName, slug, email,
        JSON.stringify(tags),
        JSON.stringify({
          password_hash: passwordHash,
          cognome: cognome || '',
          ruolo: ruolo || 'collaboratore',
          tts_voice: 'Vivian',
        }),
        `/entity/utente/${slug}`
      )

      // Create membro_di relation
      db.prepare(`INSERT OR IGNORE INTO relations (id, azienda_id, from_id, to_id, tipo)
        VALUES (?, ?, ?, ?, 'membro_di')`).run(
        crypto.randomUUID(), orgId, userId, orgId
      )

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

// ── CONVERSATION SESSIONS ────────────────────────────────

import { AuthRequest, authMiddleware } from './middleware.js'

// GET /api/auth/sessions — list user's conversations
router.get('/sessions', authMiddleware(true), (req: AuthRequest, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 50
  const channel = req.query.channel as string
  let sql = `SELECT id, titolo, channel, agent_domain, created_at, updated_at,
    (SELECT COUNT(*) FROM chat_messages WHERE session_id = s.id) as message_count
    FROM chat_sessions s WHERE s.user_id = ? AND s.deleted_at IS NULL`
  const params: any[] = [req.userId]
  if (channel) { sql += ' AND s.channel = ?'; params.push(channel) }
  sql += ' ORDER BY s.updated_at DESC LIMIT ?'
  params.push(limit)
  const sessions = db.prepare(sql).all(...params)
  res.json(sessions)
})

// POST /api/auth/sessions — create new session
router.post('/sessions', authMiddleware(true), (req: AuthRequest, res: Response) => {
  const { titolo, channel } = req.body
  const id = crypto.randomUUID()
  db.prepare("INSERT INTO chat_sessions (id, azienda_id, user_id, titolo, channel) VALUES (?,?,?,?,?)").run(
    id, req.aziendaId || '', req.userId, titolo || 'Nuova conversazione', channel || 'web'
  )
  res.json({ id, titolo: titolo || 'Nuova conversazione', channel: channel || 'web' })
})

// GET /api/auth/sessions/:id/messages — get session messages
router.get('/sessions/:id/messages', authMiddleware(true), (req: AuthRequest, res: Response) => {
  const session = db.prepare("SELECT user_id FROM chat_sessions WHERE id = ? AND deleted_at IS NULL").get(req.params.id) as any
  if (!session || session.user_id !== req.userId) {
    res.status(404).json({ error: 'Sessione non trovata' }); return
  }
  const limit = parseInt(req.query.limit as string) || 200
  const messages = db.prepare(
    "SELECT id, ruolo, contenuto, tool_calls, agent_domain, agent_name, created_at FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?"
  ).all(req.params.id, limit)
  res.json(messages)
})

// DELETE /api/auth/sessions/:id — soft delete session
router.delete('/sessions/:id', authMiddleware(true), (req: AuthRequest, res: Response) => {
  const session = db.prepare("SELECT user_id FROM chat_sessions WHERE id = ? AND deleted_at IS NULL").get(req.params.id) as any
  if (!session || session.user_id !== req.userId) {
    res.status(404).json({ error: 'Sessione non trovata' }); return
  }
  db.prepare("UPDATE chat_sessions SET deleted_at = datetime('now') WHERE id = ?").run(req.params.id)
  res.json({ successo: true })
})

// PUT /api/auth/sessions/:id — rename session
router.put('/sessions/:id', authMiddleware(true), (req: AuthRequest, res: Response) => {
  const session = db.prepare("SELECT user_id FROM chat_sessions WHERE id = ? AND deleted_at IS NULL").get(req.params.id) as any
  if (!session || session.user_id !== req.userId) {
    res.status(404).json({ error: 'Sessione non trovata' }); return
  }
  const { titolo } = req.body
  if (titolo) db.prepare("UPDATE chat_sessions SET titolo = ?, updated_at = datetime('now') WHERE id = ?").run(titolo, req.params.id)
  res.json({ successo: true })
})

// ── API TOKENS (per-user) ───────────────────────────────

router.post('/tokens', authMiddleware(true), async (req: AuthRequest, res: Response) => {
  const { name, expires_in_days } = req.body
  const rawKey = `fiai-${crypto.randomBytes(32).toString('hex')}`
  const tokenHash = await bcrypt.hash(rawKey, 10)
  const preview = `fiai-****${rawKey.slice(-8)}`
  const id = crypto.randomUUID()
  const expiresAt = expires_in_days ? new Date(Date.now() + expires_in_days * 86400000).toISOString() : null

  db.prepare("INSERT INTO api_tokens (id, user_id, azienda_id, token_hash, token_preview, name, expires_at) VALUES (?,?,?,?,?,?,?)").run(
    id, req.userId, req.aziendaId || '', tokenHash, preview, name || 'API Key', expiresAt
  )

  res.json({ id, key: rawKey, preview, name: name || 'API Key', expires_at: expiresAt, note: 'Salva questa chiave — non verra mostrata di nuovo.' })
})

router.get('/tokens', authMiddleware(true), (req: AuthRequest, res: Response) => {
  const tokens = db.prepare(
    "SELECT id, token_preview, name, expires_at, revoked_at, last_used_at, created_at FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC"
  ).all(req.userId)
  res.json(tokens)
})

router.delete('/tokens/:id', authMiddleware(true), (req: AuthRequest, res: Response) => {
  const token = db.prepare("SELECT user_id FROM api_tokens WHERE id = ?").get(req.params.id) as any
  if (!token || token.user_id !== req.userId) {
    res.status(404).json({ error: 'Token non trovato' }); return
  }
  db.prepare("UPDATE api_tokens SET revoked_at = datetime('now') WHERE id = ?").run(req.params.id)
  res.json({ successo: true })
})

export default router
