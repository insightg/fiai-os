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
import { getSettingsDiscovery, setSetting, loadSettings, listResponseProfiles, getResponseProfile, DEFAULT_RESPONSE_PROFILES } from './settings.js'

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
    SELECT e.id, e.display_name, e.email, e.telefono, e.tags, e.metadata, e.created_at
    FROM entity e WHERE e.type = 'utente' AND e.azienda_id = ? AND e.deleted_at IS NULL
    ORDER BY e.display_name
  `).all(req.aziendaId) as any[]

  const result = users.map(u => {
    const meta = typeof u.metadata === 'string' ? JSON.parse(u.metadata) : (u.metadata || {})
    const tags = typeof u.tags === 'string' ? JSON.parse(u.tags) : (u.tags || [])
    const groups = db.prepare(`
      SELECT e.id, e.display_name FROM relations r
      JOIN entity e ON e.id = r.to_id
      WHERE r.from_id = ? AND r.tipo = 'membro_di_gruppo'
    `).all(u.id) as any[]

    return {
      id: u.id,
      display_name: u.display_name,
      email: u.email,
      telefono: u.telefono || '',
      ruolo: meta.ruolo || (tags.includes('admin') ? 'admin' : 'collaboratore'),
      cognome: meta.cognome || '',
      tts_voice: meta.tts_voice || 'Vivian',
      whatsapp_phone: meta.whatsapp_phone || u.telefono || '',
      whatsapp_active: meta.whatsapp_active ? true : false,
      groups: groups.map(g => ({ id: g.id, name: g.display_name })),
      created_at: u.created_at,
    }
  })

  res.json(result)
})

router.post('/users', async (req: AuthRequest, res: Response) => {
  const { email, password, nome, cognome, ruolo, telefono, group_id, tts_voice, whatsapp_phone, whatsapp_active } = req.body
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

  db.prepare(`INSERT INTO entity (id, azienda_id, type, display_name, slug, email, telefono, tags, metadata, path)
    VALUES (?, ?, 'utente', ?, ?, ?, ?, ?, ?, ?)`).run(
    userId, req.aziendaId, displayName, slug, email, telefono || null,
    JSON.stringify(tags),
    JSON.stringify({
      password_hash: passwordHash, cognome: cognome || '', ruolo: ruolo || 'collaboratore',
      tts_voice: tts_voice || 'Vivian',
      whatsapp_phone: whatsapp_phone || telefono || '',
      whatsapp_active: whatsapp_active ? 1 : 0,
    }),
    `/entity/utente/${slug}`
  )

  // Create membro_di relation (to org)
  db.prepare(`INSERT OR IGNORE INTO relations (id, azienda_id, from_id, to_id, tipo)
    VALUES (?, ?, ?, ?, 'membro_di')`).run(crypto.randomUUID(), req.aziendaId, userId, req.aziendaId)

  // Assign to group if specified
  if (group_id) {
    db.prepare(`INSERT OR IGNORE INTO relations (id, azienda_id, from_id, to_id, tipo)
      VALUES (?, ?, ?, ?, 'membro_di_gruppo')`).run(crypto.randomUUID(), req.aziendaId, userId, group_id)
  }

  res.json({ id: userId, display_name: displayName, email, ruolo: ruolo || 'collaboratore' })
})

router.put('/users/:id', async (req: AuthRequest, res: Response) => {
  const { ruolo, nome, cognome, email, telefono, password, group_id, group_ids, tts_voice, whatsapp_phone, whatsapp_active } = req.body
  const user = db.prepare("SELECT metadata, tags, email as current_email FROM entity WHERE id = ? AND type = 'utente'").get(req.params.id) as any
  if (!user) { res.status(404).json({ error: 'Utente non trovato' }); return }

  const meta = typeof user.metadata === 'string' ? JSON.parse(user.metadata) : (user.metadata || {})
  let tags = typeof user.tags === 'string' ? JSON.parse(user.tags) : (user.tags || [])

  if (ruolo) {
    meta.ruolo = ruolo
    if (ruolo === 'admin' && !tags.includes('admin')) tags.push('admin')
    if (ruolo !== 'admin') tags = tags.filter((t: string) => t !== 'admin')
  }
  if (cognome !== undefined) meta.cognome = cognome
  if (password) meta.password_hash = await bcrypt.hash(password, 10)
  if (tts_voice !== undefined) meta.tts_voice = tts_voice
  if (whatsapp_phone !== undefined) meta.whatsapp_phone = whatsapp_phone
  if (whatsapp_active !== undefined) meta.whatsapp_active = whatsapp_active ? 1 : 0

  const updates: string[] = ['metadata = ?', 'tags = ?']
  const params: any[] = [JSON.stringify(meta), JSON.stringify(tags)]

  if (nome) {
    const displayName = `${nome} ${cognome || meta.cognome || ''}`.trim()
    updates.push('display_name = ?')
    params.push(displayName)
  }
  if (email !== undefined) { updates.push('email = ?'); params.push(email) }
  if (telefono !== undefined) { updates.push('telefono = ?'); params.push(telefono || null) }

  params.push(req.params.id)
  db.prepare(`UPDATE entity SET ${updates.join(', ')} WHERE id = ?`).run(...params)

  // Update group membership if specified
  const newGroups = group_ids || (group_id !== undefined ? (group_id ? [group_id] : []) : null)
  if (newGroups !== null) {
    db.prepare("DELETE FROM relations WHERE from_id = ? AND tipo = 'membro_di_gruppo'").run(req.params.id)
    for (const gid of newGroups) {
      if (gid) {
        db.prepare(`INSERT OR IGNORE INTO relations (id, azienda_id, from_id, to_id, tipo)
          VALUES (?, ?, ?, ?, 'membro_di_gruppo')`).run(crypto.randomUUID(), req.aziendaId, req.params.id, gid)
      }
    }
  }

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
      agentPermissions: meta.agentPermissions || {},
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
  const { name, permissions, agentPermissions } = req.body
  const group = db.prepare("SELECT id, metadata FROM entity WHERE id = ? AND type = 'gruppo'").get(req.params.id) as any
  if (!group) { res.status(404).json({ error: 'Gruppo non trovato' }); return }

  const oldMeta = typeof group.metadata === 'string' ? JSON.parse(group.metadata) : (group.metadata || {})
  const newMeta = { ...oldMeta }
  if (permissions !== undefined) newMeta.permissions = permissions
  if (agentPermissions !== undefined) newMeta.agentPermissions = agentPermissions

  const updates: string[] = ['metadata = ?']
  const params: any[] = [JSON.stringify(newMeta)]
  if (name) { updates.push('display_name = ?'); params.push(name) }

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

// ── AGENTS ──────────────────────────────────────────────

router.get('/agents', (_req: AuthRequest, res: Response) => {
  import('./agents/config.js').then(({ AGENTS, AGENT_COLORS }) => {
    const agents = Object.entries(AGENTS).map(([domain, agent]: [string, any]) => {
      const skill = db.prepare("SELECT metadata FROM entity WHERE type = 'skill' AND json_extract(metadata, '$.domain') = ?").get(domain) as any
      const skillMeta = skill ? (typeof skill.metadata === 'string' ? JSON.parse(skill.metadata) : skill.metadata) : null

      return {
        domain,
        name: agent.name,
        color: AGENT_COLORS[domain] || agent.color,
        model: agent.model || 'default (haiku-4.5)',
        toolCount: agent.toolNames?.length || 0,
        toolNames: agent.toolNames || [],
        promptLength: agent.systemPrompt?.length || 0,
        promptPreview: agent.systemPrompt?.substring(0, 200) || '',
        systemPrompt: agent.systemPrompt || '',
        hasSkillOverride: !!skillMeta,
        skillRules: skillMeta?.rules || [],
        skillModel: skillMeta?.model || null,
      }
    })
    res.json(agents)
  }).catch(err => res.status(500).json({ error: err.message }))
})

router.get('/agents/:domain', (_req: AuthRequest, res: Response) => {
  import('./agents/config.js').then(({ AGENTS, AGENT_COLORS }) => {
    const agent = (AGENTS as any)[_req.params.domain]
    if (!agent) { res.status(404).json({ error: 'Agente non trovato' }); return }

    const skill = db.prepare("SELECT metadata FROM entity WHERE type = 'skill' AND json_extract(metadata, '$.domain') = ?").get(_req.params.domain) as any
    const skillMeta = skill ? (typeof skill.metadata === 'string' ? JSON.parse(skill.metadata) : skill.metadata) : null

    res.json({
      domain: _req.params.domain,
      name: agent.name,
      color: AGENT_COLORS[_req.params.domain] || agent.color,
      model: agent.model || 'default (haiku-4.5)',
      toolNames: agent.toolNames || [],
      systemPrompt: agent.systemPrompt || '',
      hasSkillOverride: !!skillMeta,
      skillRules: skillMeta?.rules || [],
      skillModel: skillMeta?.model || null,
      skillPrompt: skillMeta?.system_prompt || null,
    })
  }).catch(err => res.status(500).json({ error: err.message }))
})

router.put('/agents/:domain', (req: AuthRequest, res: Response) => {
  const { rules, model, system_prompt } = req.body
  const domain = req.params.domain

  const existing = db.prepare("SELECT id, metadata FROM entity WHERE type = 'skill' AND json_extract(metadata, '$.domain') = ? AND azienda_id = ?").get(domain, req.aziendaId) as any

  const meta = {
    domain,
    ...(rules !== undefined ? { rules } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(system_prompt !== undefined ? { system_prompt } : {}),
  }

  if (existing) {
    const oldMeta = typeof existing.metadata === 'string' ? JSON.parse(existing.metadata) : existing.metadata
    const merged = { ...oldMeta, ...meta }
    db.prepare("UPDATE entity SET metadata = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(merged), existing.id)
  } else {
    const id = crypto.randomUUID()
    db.prepare("INSERT INTO entity (id, azienda_id, type, display_name, slug, metadata, path) VALUES (?,?,'skill',?,?,?,?)").run(
      id, req.aziendaId, `Skill: ${domain}`, `skill-${domain}`,
      JSON.stringify(meta), `/entity/skill/skill-${domain}`
    )
  }

  res.json({ successo: true, messaggio: `Agente "${domain}" aggiornato. Riavvia il backend per applicare.` })
})

// ── SETTINGS ─────────────────────────────────────────────

router.get('/settings', (req: AuthRequest, res: Response) => {
  const settings = getSettingsDiscovery(req.aziendaId || '')
  const grouped: Record<string, typeof settings> = {}
  for (const s of settings) {
    if (!grouped[s.category]) grouped[s.category] = []
    grouped[s.category].push(s)
  }
  res.json({ settings, grouped })
})

router.put('/settings/:key', (req: AuthRequest, res: Response) => {
  const { value } = req.body
  if (value === undefined) { res.status(400).json({ error: 'value obbligatorio' }); return }
  setSetting(req.aziendaId || '', req.params.key, value)
  res.json({ successo: true, key: req.params.key })
})

router.post('/settings/bulk', (req: AuthRequest, res: Response) => {
  const { settings } = req.body
  if (!settings || typeof settings !== 'object') { res.status(400).json({ error: 'settings object obbligatorio' }); return }
  for (const [key, value] of Object.entries(settings)) {
    setSetting(req.aziendaId || '', key, value as string)
  }
  res.json({ successo: true, count: Object.keys(settings).length })
})

// ── RESPONSE PROFILES ────────────────────────────────────

router.get('/response-profiles', (req: AuthRequest, res: Response) => {
  const profiles = listResponseProfiles(req.aziendaId)
  const enriched = profiles.map(p => {
    const prompt = getResponseProfile(p.slug, req.aziendaId) || ''
    return { ...p, prompt }
  })
  res.json(enriched)
})

router.put('/response-profiles/:slug', (req: AuthRequest, res: Response) => {
  const { name, description, prompt } = req.body
  if (!prompt) { res.status(400).json({ error: 'prompt obbligatorio' }); return }
  const slug = req.params.slug

  const existing = db.prepare("SELECT id FROM entity WHERE type = 'response_profile' AND slug = ? AND azienda_id = ?").get(slug, req.aziendaId) as any
  if (existing) {
    db.prepare("UPDATE entity SET display_name = ?, body = ?, metadata = ?, updated_at = datetime('now') WHERE id = ?").run(
      name || slug, prompt, JSON.stringify({ description: description || '' }), existing.id
    )
  } else {
    const id = crypto.randomUUID()
    db.prepare("INSERT INTO entity (id, azienda_id, type, display_name, slug, body, metadata, path) VALUES (?,?,'response_profile',?,?,?,?,?)").run(
      id, req.aziendaId, name || slug, slug, prompt,
      JSON.stringify({ description: description || '' }),
      `/entity/response_profile/${slug}`
    )
  }
  res.json({ successo: true })
})

router.post('/response-profiles', (req: AuthRequest, res: Response) => {
  const { slug, name, description, prompt } = req.body
  if (!slug || !prompt) { res.status(400).json({ error: 'slug e prompt obbligatori' }); return }
  if (!/^[a-z][a-z0-9_-]*$/.test(slug)) { res.status(400).json({ error: 'slug deve essere lowercase alfanumerico (es. my-profile)' }); return }

  const existing = db.prepare("SELECT id FROM entity WHERE type = 'response_profile' AND slug = ? AND azienda_id = ?").get(slug, req.aziendaId)
  if (existing) { res.status(400).json({ error: 'Profilo con questo slug gia esistente' }); return }

  const id = crypto.randomUUID()
  db.prepare("INSERT INTO entity (id, azienda_id, type, display_name, slug, body, metadata, path) VALUES (?,?,'response_profile',?,?,?,?,?)").run(
    id, req.aziendaId, name || slug, slug, prompt,
    JSON.stringify({ description: description || '' }),
    `/entity/response_profile/${slug}`
  )
  res.json({ successo: true, id, slug })
})

router.delete('/response-profiles/:slug', (req: AuthRequest, res: Response) => {
  db.prepare("UPDATE entity SET deleted_at = datetime('now') WHERE type = 'response_profile' AND slug = ? AND azienda_id = ?").run(req.params.slug, req.aziendaId)
  res.json({ successo: true })
})

// ── SYSTEM STATS ─────────────────────────────────────────

router.get('/system', (req: AuthRequest, res: Response) => {
  try {
    const typeCounts = db.prepare(`
      SELECT type, COUNT(*) as count FROM entity
      WHERE azienda_id = ? AND deleted_at IS NULL
      AND type NOT IN ('chat_message','chat_session','agent_log','workflow_log','chunk')
      GROUP BY type ORDER BY count DESC
    `).all(req.aziendaId) as any[]

    const totalEntities = db.prepare("SELECT COUNT(*) as c FROM entity WHERE azienda_id = ? AND deleted_at IS NULL").get(req.aziendaId) as any

    const docStats = db.prepare(`
      SELECT COUNT(DISTINCT parent_id) as docs, COUNT(*) as chunks
      FROM entity WHERE type = 'chunk' AND azienda_id = ?
    `).get(req.aziendaId) as any

    const embeddedCount = db.prepare("SELECT COUNT(*) as c FROM entity WHERE embedding IS NOT NULL AND azienda_id = ?").get(req.aziendaId) as any

    const userCount = db.prepare("SELECT COUNT(*) as c FROM entity WHERE type = 'utente' AND azienda_id = ?").get(req.aziendaId) as any

    const recentSessions = db.prepare("SELECT COUNT(*) as c FROM chat_sessions WHERE azienda_id = ? AND created_at > datetime('now', '-7 days')").get(req.aziendaId) as any

    const dbSize = db.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()").get() as any

    res.json({
      totalEntities: totalEntities.c,
      typeCounts,
      documents: docStats.docs || 0,
      chunks: docStats.chunks || 0,
      embeddedEntities: embeddedCount.c,
      users: userCount.c,
      recentSessions: recentSessions.c,
      dbSizeMB: Math.round((dbSize?.size || 0) / 1024 / 1024 * 10) / 10,
    })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router
