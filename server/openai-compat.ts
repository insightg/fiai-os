/**
 * OpenAI-Compatible API Endpoint for FIAI OS
 *
 * Allows any device/client that speaks the OpenAI standard
 * (e.g. ESP32, Home Assistant, custom apps) to interact with
 * FIAI agents via /v1/chat/completions.
 *
 * Auth: Bearer token — either a JWT or an API key from api_tokens table.
 * Streaming: supports both stream:true (SSE) and stream:false.
 */

import { Router, Request, Response } from 'express'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import db from './db.js'
import { UserPermissions } from './agents/types.js'
import { handleChatMessage } from './agents/index.js'
import { AGENTS } from './agents/config.js'

const router = Router()
const JWT_SECRET = process.env.JWT_SECRET || 'fiai-dev-secret'

// ── Auth helper: resolve Bearer token (JWT or API key) ────

interface ResolvedAuth {
  userId: string
  aziendaId: string
  permissions: UserPermissions
}

async function resolveAuth(req: Request): Promise<ResolvedAuth | null> {
  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return null

  // 1) Try JWT
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; email: string }
    const rel = db.prepare(
      "SELECT r.to_id FROM relations r WHERE r.from_id = ? AND r.tipo = 'membro_di' LIMIT 1"
    ).get(decoded.userId) as { to_id: string } | undefined
    let aziendaId = rel?.to_id || ''
    if (!aziendaId) {
      const rec = db.prepare("SELECT azienda_id FROM entity WHERE id = ?").get(decoded.userId) as any
      if (rec?.azienda_id) aziendaId = rec.azienda_id
    }

    // Load group permissions
    let permissions: UserPermissions
    try {
      const groups = db.prepare(
        "SELECT e.display_name, e.metadata FROM relations r JOIN entity e ON e.id = r.to_id WHERE r.from_id = ? AND r.tipo = 'membro_di_gruppo'"
      ).all(decoded.userId) as any[]
      const groupData = groups.map(g => {
        const m = typeof g.metadata === 'string' ? JSON.parse(g.metadata) : (g.metadata || {})
        return { name: g.display_name, permissions: m.permissions || {} }
      })
      permissions = new UserPermissions(groupData)
    } catch {
      permissions = new UserPermissions([])
    }

    return { userId: decoded.userId, aziendaId, permissions }
  } catch { /* not a valid JWT, try API key */ }

  // 2) Try API key — check api_tokens table (hashed) then legacy entity table
  try {
    const bcryptMod = await import('bcryptjs')
    // Check new api_tokens table
    const allTokens = db.prepare(
      "SELECT id, user_id, azienda_id, token_hash FROM api_tokens WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > datetime('now'))"
    ).all() as any[]
    for (const t of allTokens) {
      if (await bcryptMod.compare(token, t.token_hash)) {
        // Update last_used_at
        db.prepare("UPDATE api_tokens SET last_used_at = datetime('now') WHERE id = ?").run(t.id)
        // Load user permissions from groups
        let permissions: UserPermissions
        try {
          const groups = db.prepare(
            "SELECT e.display_name, e.metadata FROM relations r JOIN entity e ON e.id = r.to_id WHERE r.from_id = ? AND r.tipo = 'membro_di_gruppo'"
          ).all(t.user_id) as any[]
          const groupData = groups.map((g: any) => {
            const m = typeof g.metadata === 'string' ? JSON.parse(g.metadata) : (g.metadata || {})
            return { name: g.display_name, permissions: m.permissions || {}, agentPermissions: m.agentPermissions || undefined }
          })
          permissions = new UserPermissions(groupData)
        } catch {
          permissions = new UserPermissions([])
        }
        return { userId: t.user_id, aziendaId: t.azienda_id, permissions }
      }
    }

    // Fallback: legacy entity-based API keys (plaintext slug match)
    const keyEntity = db.prepare(
      "SELECT id, azienda_id, metadata FROM entity WHERE type = 'api_key' AND slug = ? AND (stato IS NULL OR stato = 'active')"
    ).get(token) as any
    if (keyEntity) {
      const meta = typeof keyEntity.metadata === 'string' ? JSON.parse(keyEntity.metadata) : (keyEntity.metadata || {})
      const userId = meta.user_id || keyEntity.id
      const aziendaId = keyEntity.azienda_id || ''
      const permissions = new UserPermissions([
        { name: 'api_key', permissions: { '*': ['read', 'create', 'update', 'delete', 'send'] } }
      ])
      return { userId, aziendaId, permissions }
    }
  } catch { /* not a valid API key */ }

  return null
}

// ── POST /v1/chat/completions ─────────────────────────────

router.post('/chat/completions', async (req: Request, res: Response) => {
  const auth = await resolveAuth(req)
  if (!auth) {
    res.status(401).json({
      error: { message: 'Invalid authentication. Provide a valid Bearer token (JWT or API key).', type: 'invalid_request_error', code: 'invalid_api_key' }
    })
    return
  }

  const { messages, model, stream } = req.body

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({
      error: { message: '`messages` is required and must be a non-empty array.', type: 'invalid_request_error', code: 'invalid_request' }
    })
    return
  }

  // Extract last user message + conversation history
  const lastUserMsg = [...messages].reverse().find((m: any) => m.role === 'user')
  if (!lastUserMsg) {
    res.status(400).json({
      error: { message: 'At least one message with role "user" is required.', type: 'invalid_request_error', code: 'invalid_request' }
    })
    return
  }

  // Build history from prior messages (exclude the last user message)
  const lastUserIndex = messages.lastIndexOf(lastUserMsg)
  const history = messages.slice(0, lastUserIndex).map((m: any) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
  }))

  // Handle image attachments (OpenAI vision format)
  let attachedImageBase64: string | undefined
  if (Array.isArray(lastUserMsg.content)) {
    const imageBlock = lastUserMsg.content.find((b: any) => b.type === 'image_url')
    if (imageBlock?.image_url?.url?.startsWith('data:image')) {
      attachedImageBase64 = imageBlock.image_url.url.split(',')[1]
    }
  }

  const userText = typeof lastUserMsg.content === 'string'
    ? lastUserMsg.content
    : lastUserMsg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')

  // Detect response profile from:
  //   1. Header: X-Response-Format: voice|brief|json|report|custom
  //   2. Model name suffix: fiai-os-voice, commerciale-brief, etc.
  //   3. OpenAI modalities field: ["audio"] → voice
  //   4. Body field: response_format: "voice"
  const headerFormat = req.headers['x-response-format'] as string | undefined
  const modalities = req.body.modalities as string[] | undefined
  const bodyFormat = req.body.response_format as string | undefined

  let responseFormat = 'web'
  let cleanModel = (model && typeof model === 'string') ? model : ''

  // Check for profile suffix in model name (e.g. "fiai-os-voice" → profile "voice", model "fiai-os")
  const suffixMatch = cleanModel.match(/^(.+)-([a-z]+)$/)
  if (suffixMatch) {
    const { getResponseProfile: checkProfile } = await import('./settings.js')
    if (checkProfile(suffixMatch[2])) {
      responseFormat = suffixMatch[2]
      cleanModel = suffixMatch[1]
    }
  }

  // Header/body/modalities override model suffix
  if (headerFormat) responseFormat = headerFormat
  else if (bodyFormat) responseFormat = bodyFormat
  else if (Array.isArray(modalities) && modalities.includes('audio')) responseFormat = 'voice'

  // Session ID: use custom from body, or generate persistent one per user
  const sessionId = req.body.session_id || `api-${auth.userId}-${cleanModel || 'default'}`

  const completionId = `chatcmpl-${crypto.randomUUID().replace(/-/g, '').slice(0, 29)}`
  const created = Math.floor(Date.now() / 1000)
  const modelName = cleanModel || 'fiai-os'

  try {
    if (stream) {
      // ── Streaming SSE response ────────────────────────
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      res.setHeader('X-Accel-Buffering', 'no')
      res.flushHeaders()

      // Send initial chunk with role
      res.write(`data: ${JSON.stringify({
        id: completionId, object: 'chat.completion.chunk', created, model: modelName,
        choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
      })}\n\n`)

      // Real streaming: orchestrator emits tokens via onProgress
      const { orchestrate } = await import('./agents/orchestrator.js')
      const result = await orchestrate(userText, auth.userId, auth.aziendaId, {
        format: responseFormat,
        sessionId,
        history,
        attachedImageBase64,
        permissions: auth.permissions,
        onProgress: (event) => {
          if (event.type === 'token' && event.content) {
            res.write(`data: ${JSON.stringify({
              id: completionId, object: 'chat.completion.chunk', created, model: modelName,
              choices: [{ index: 0, delta: { content: event.content }, finish_reason: null }],
            })}\n\n`)
          }
        },
      })

      // Send finish chunk
      res.write(`data: ${JSON.stringify({
        id: completionId, object: 'chat.completion.chunk', created, model: modelName,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: {
          prompt_tokens: result.totalTokens ? Math.floor(result.totalTokens * 0.7) : 0,
          completion_tokens: result.totalTokens ? Math.ceil(result.totalTokens * 0.3) : 0,
          total_tokens: result.totalTokens || 0,
        },
      })}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()

    } else {
      // ── Non-streaming response ────────────────────────
      const result = await handleChatMessage(userText, auth.userId, auth.aziendaId, {
        format: responseFormat,
        sessionId,
        channel: 'api',
        history,
        attachedImageBase64,
        permissions: auth.permissions,
      })

      const promptTokens = result.totalTokens ? Math.floor(result.totalTokens * 0.7) : 0
      const completionTokens = result.totalTokens ? Math.ceil(result.totalTokens * 0.3) : 0

      res.json({
        id: completionId,
        object: 'chat.completion',
        created,
        model: modelName,
        choices: [{
          index: 0,
          message: { role: 'assistant', content: result.text || '' },
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: result.totalTokens || 0,
        },
        // FIAI-specific metadata (extra, ignored by standard clients)
        _fiai: {
          agentName: result.agentName,
          agentDomain: result.agentDomain,
          agentColor: result.agentColor,
          toolCalls: result.toolCalls,
          suggestions: result.suggestions,
        },
      })
    }
  } catch (err) {
    console.error('[OpenAI Compat] Error:', err)
    if (!res.headersSent) {
      res.status(500).json({
        error: { message: (err as Error).message, type: 'server_error', code: 'internal_error' }
      })
    } else {
      // Streaming already started — send error as SSE
      const errorChunk = {
        id: completionId,
        object: 'chat.completion.chunk',
        created,
        model: modelName,
        choices: [{ index: 0, delta: { content: `\n\n[Errore: ${(err as Error).message}]` }, finish_reason: 'stop' }],
      }
      res.write(`data: ${JSON.stringify(errorChunk)}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
    }
  }
})

// ── GET /v1/models ────────────────────────────────────────

router.get('/models', async (req: Request, res: Response) => {
  const auth = await resolveAuth(req)
  if (!auth) {
    res.status(401).json({
      error: { message: 'Invalid authentication.', type: 'invalid_request_error', code: 'invalid_api_key' }
    })
    return
  }

  // List all agents as "models"
  const models = Object.entries(AGENTS).map(([domain, agent]) => ({
    id: domain,
    object: 'model',
    created: Math.floor(Date.now() / 1000),
    owned_by: 'fiai-os',
    permission: [],
    root: domain,
    parent: null,
    _fiai: { name: agent.name, color: agent.color },
  }))

  // Add a default model
  models.unshift({
    id: 'fiai-os',
    object: 'model',
    created: Math.floor(Date.now() / 1000),
    owned_by: 'fiai-os',
    permission: [],
    root: 'fiai-os',
    parent: null,
    _fiai: { name: 'FIAI OS (Auto-routing)', color: '#C41E3A' },
  })

  res.json({ object: 'list', data: models })
})

// ── POST /v1/api-keys ─────────────────────────────────────
// Utility: generate an API key for device authentication

router.post('/api-keys', async (req: Request, res: Response) => {
  const auth = await resolveAuth(req)
  if (!auth || !auth.permissions.isAdmin) {
    res.status(403).json({
      error: { message: 'Admin access required to create API keys.', type: 'invalid_request_error', code: 'forbidden' }
    })
    return
  }

  const { name } = req.body
  const keyValue = `fiai-${crypto.randomBytes(32).toString('hex')}`
  const id = crypto.randomUUID()

  db.prepare(
    "INSERT INTO entity (id, azienda_id, type, display_name, slug, stato, metadata, path, created_at, updated_at) VALUES (?,?,'api_key',?,?,'active',?,?,datetime('now'),datetime('now'))"
  ).run(
    id, auth.aziendaId,
    name || 'API Key',
    keyValue,
    JSON.stringify({ user_id: auth.userId, created_by: auth.userId }),
    `/entity/api_key/${id}`
  )

  res.json({
    id,
    name: name || 'API Key',
    key: keyValue,
    created: Math.floor(Date.now() / 1000),
    note: 'Save this key — it will not be shown again.',
  })
})

// ── GET /v1/api-keys ──────────────────────────────────────

router.get('/api-keys', async (req: Request, res: Response) => {
  const auth = await resolveAuth(req)
  if (!auth || !auth.permissions.isAdmin) {
    res.status(403).json({
      error: { message: 'Admin access required.', type: 'invalid_request_error', code: 'forbidden' }
    })
    return
  }

  const keys = db.prepare(
    "SELECT id, display_name, slug, stato, created_at FROM entity WHERE type = 'api_key' AND azienda_id = ? ORDER BY created_at DESC"
  ).all(auth.aziendaId) as any[]

  res.json({
    data: keys.map(k => ({
      id: k.id,
      name: k.display_name,
      key_preview: `${k.slug.slice(0, 8)}...${k.slug.slice(-4)}`,
      status: k.stato,
      created: k.created_at,
    }))
  })
})

// ── DELETE /v1/api-keys/:id ───────────────────────────────

router.delete('/api-keys/:id', async (req: Request, res: Response) => {
  const auth = await resolveAuth(req)
  if (!auth || !auth.permissions.isAdmin) {
    res.status(403).json({
      error: { message: 'Admin access required.', type: 'invalid_request_error', code: 'forbidden' }
    })
    return
  }

  db.prepare("UPDATE entity SET stato = 'revoked' WHERE id = ? AND type = 'api_key' AND azienda_id = ?")
    .run(req.params.id, auth.aziendaId)

  res.json({ id: req.params.id, deleted: true })
})

export default router
