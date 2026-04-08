/**
 * FIAI OS — Admin API
 * REST endpoints for user/group/permission management.
 * All endpoints require admin role.
 */
import { Router, Response } from 'express'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { AuthRequest, authMiddleware } from './middleware.js'
import db from './db.js'

const router = Router()

// Admin guard — all routes require admin role
function adminGuard(req: AuthRequest, res: Response, next: () => void) {
  if (!req.permissions?.isAdmin) {
    res.status(403).json({ error: 'Accesso riservato agli amministratori' })
    return
  }
  next()
}

router.use(authMiddleware(true), adminGuard as any)

// ── USERS ────────────────────────────────────────────────

router.get('/users', (req: AuthRequest, res: Response) => {
  const users = db.prepare(`
    SELECT e.id, e.display_name, e.email, e.tags, e.metadata, e.created_at
    FROM entity e WHERE e.type = 'utente' AND e.azienda_id = ?
    ORDER BY e.display_name
  `).all(req.aziendaId) as any[]

  const result = users.map(u => {
    const meta = typeof u.metadata === 'string' ? JSON.parse(u.metadata) : (u.metadata || {})
    const tags = typeof u.tags === 'string' ? JSON.parse(u.tags) : (u.tags || [])
    // Get user's groups
    const groups = db.prepare(`
      SELECT e.id, e.display_name FROM relations r
      JOIN entity e ON e.id = r.to_id
      WHERE r.from_id = ? AND r.tipo = 'membro_di_gruppo'
    `).all(u.id) as any[]

    return {
      id: u.id,
      display_name: u.display_name,
      email: u.email,
      ruolo: meta.ruolo || (tags.includes('admin') ? 'admin' : 'collaboratore'),
      cognome: meta.cognome || '',
      groups: groups.map(g => ({ id: g.id, name: g.display_name })),
      created_at: u.created_at,
    }
  })

  res.json(result)
})

router.post('/users', async (req: AuthRequest, res: Response) => {
  const { email, password, nome, cognome, ruolo } = req.body
  if (!email || !password || !nome) {
    res.status(400).json({ error: 'email, password e nome obbligatori' })
    return
  }

  const existing = db.prepare("SELECT id FROM entity WHERE email = ?").get(email)
  if (existing) {
    res.status(400).json({ error: 'Email gia in uso' })
    return
  }

  const userId = crypto.randomUUID()
  const displayName = `${nome} ${cognome || ''}`.trim()
  const slug = displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 80)
  const passwordHash = await bcrypt.hash(password, 10)
  const tags = ['utente']
  if (ruolo === 'admin') tags.push('admin')

  db.prepare(`INSERT INTO entity (id, azienda_id, type, display_name, slug, email, tags, metadata, path)
    VALUES (?, ?, 'utente', ?, ?, ?, ?, ?, ?)`).run(
    userId, req.aziendaId, displayName, slug, email,
    JSON.stringify(tags),
    JSON.stringify({ password_hash: passwordHash, cognome: cognome || '', ruolo: ruolo || 'collaboratore', tts_voice: 'Vivian' }),
    `/entity/utente/${slug}`
  )

  // Create membro_di relation
  db.prepare(`INSERT OR IGNORE INTO relations (id, azienda_id, from_id, to_id, tipo)
    VALUES (?, ?, ?, ?, 'membro_di')`).run(crypto.randomUUID(), req.aziendaId, userId, req.aziendaId)

  res.json({ id: userId, display_name: displayName, email, ruolo: ruolo || 'collaboratore' })
})

router.put('/users/:id', (req: AuthRequest, res: Response) => {
  const { ruolo, nome, cognome } = req.body
  const user = db.prepare("SELECT metadata, tags FROM entity WHERE id = ? AND type = 'utente'").get(req.params.id) as any
  if (!user) { res.status(404).json({ error: 'Utente non trovato' }); return }

  const meta = typeof user.metadata === 'string' ? JSON.parse(user.metadata) : (user.metadata || {})
  let tags = typeof user.tags === 'string' ? JSON.parse(user.tags) : (user.tags || [])

  if (ruolo) {
    meta.ruolo = ruolo
    if (ruolo === 'admin' && !tags.includes('admin')) tags.push('admin')
    if (ruolo !== 'admin') tags = tags.filter((t: string) => t !== 'admin')
  }
  if (cognome !== undefined) meta.cognome = cognome

  const updates: string[] = ['metadata = ?', 'tags = ?']
  const params: any[] = [JSON.stringify(meta), JSON.stringify(tags)]

  if (nome) {
    const displayName = `${nome} ${cognome || meta.cognome || ''}`.trim()
    updates.push('display_name = ?')
    params.push(displayName)
  }

  params.push(req.params.id)
  db.prepare(`UPDATE entity SET ${updates.join(', ')} WHERE id = ?`).run(...params)

  res.json({ successo: true })
})

router.delete('/users/:id', (req: AuthRequest, res: Response) => {
  if (req.params.id === req.userId) {
    res.status(400).json({ error: 'Non puoi eliminare te stesso' })
    return
  }
  db.prepare("DELETE FROM relations WHERE from_id = ? OR to_id = ?").run(req.params.id, req.params.id)
  db.prepare("DELETE FROM entity WHERE id = ? AND type = 'utente'").run(req.params.id)
  res.json({ successo: true })
})

// ── GROUPS ───────────────────────────────────────────────

router.get('/groups', (req: AuthRequest, res: Response) => {
  const groups = db.prepare("SELECT id, display_name, metadata FROM entity WHERE type = 'gruppo' AND azienda_id = ?").all(req.aziendaId) as any[]

  const result = groups.map(g => {
    const meta = typeof g.metadata === 'string' ? JSON.parse(g.metadata) : (g.metadata || {})
    const members = db.prepare(`
      SELECT e.id, e.display_name, e.email FROM relations r
      JOIN entity e ON e.id = r.from_id
      WHERE r.to_id = ? AND r.tipo = 'membro_di_gruppo'
    `).all(g.id) as any[]

    return {
      id: g.id,
      name: g.display_name,
      permissions: meta.permissions || {},
      members,
    }
  })

  res.json(result)
})

router.post('/groups', (req: AuthRequest, res: Response) => {
  const { name, permissions } = req.body
  if (!name) { res.status(400).json({ error: 'name obbligatorio' }); return }

  const groupId = crypto.randomUUID()
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 80)
  db.prepare(`INSERT INTO entity (id, azienda_id, type, display_name, slug, metadata, path)
    VALUES (?, ?, 'gruppo', ?, ?, ?, ?)`).run(
    groupId, req.aziendaId, name, slug,
    JSON.stringify({ permissions: permissions || {} }),
    `/entity/gruppo/${slug}`
  )

  res.json({ id: groupId, name })
})

router.put('/groups/:id', (req: AuthRequest, res: Response) => {
  const { name, permissions } = req.body
  const group = db.prepare("SELECT id FROM entity WHERE id = ? AND type = 'gruppo'").get(req.params.id)
  if (!group) { res.status(404).json({ error: 'Gruppo non trovato' }); return }

  const updates: string[] = []
  const params: any[] = []
  if (name) { updates.push('display_name = ?'); params.push(name) }
  if (permissions) { updates.push('metadata = ?'); params.push(JSON.stringify({ permissions })) }
  if (updates.length === 0) { res.json({ successo: true }); return }

  params.push(req.params.id)
  db.prepare(`UPDATE entity SET ${updates.join(', ')} WHERE id = ?`).run(...params)

  res.json({ successo: true })
})

router.delete('/groups/:id', (req: AuthRequest, res: Response) => {
  db.prepare("DELETE FROM relations WHERE to_id = ? AND tipo = 'membro_di_gruppo'").run(req.params.id)
  db.prepare("DELETE FROM entity WHERE id = ? AND type = 'gruppo'").run(req.params.id)
  res.json({ successo: true })
})

// ── GROUP MEMBERSHIP ─────────────────────────────────────

router.post('/groups/:id/members', (req: AuthRequest, res: Response) => {
  const { user_id } = req.body
  if (!user_id) { res.status(400).json({ error: 'user_id obbligatorio' }); return }

  db.prepare(`INSERT OR IGNORE INTO relations (id, azienda_id, from_id, to_id, tipo)
    VALUES (?, ?, ?, ?, 'membro_di_gruppo')`).run(crypto.randomUUID(), req.aziendaId, user_id, req.params.id)

  res.json({ successo: true })
})

router.delete('/groups/:id/members/:userId', (req: AuthRequest, res: Response) => {
  db.prepare("DELETE FROM relations WHERE from_id = ? AND to_id = ? AND tipo = 'membro_di_gruppo'")
    .run(req.params.userId, req.params.id)
  res.json({ successo: true })
})

// ── ENTITY TYPES (for permission matrix) ─────────────────

router.get('/entity-types', (req: AuthRequest, res: Response) => {
  const types = db.prepare(`
    SELECT type, COUNT(*) as count FROM entity
    WHERE azienda_id = ? AND type NOT IN ('chat_message','chat_session','agent_log','job','workflow_log','chunk','category_template')
    GROUP BY type ORDER BY count DESC
  `).all(req.aziendaId) as any[]
  res.json(types)
})

export default router
