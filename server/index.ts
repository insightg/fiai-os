import express from 'express'
import crypto from 'crypto'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import fs from 'fs'
import path from 'path'
import db from './db.js'
import authRouter from './auth.js'
import queryRouter from './query.js'
import uploadRouter from './upload.js'
import uploadsStaticRouter from './uploads-static.js'
import documentiRouter from './documenti.js'
import contextRouter from './context.js'
import filesRouter from './files.js'
import ttsRouter from './tts.js'
import signalsRouter from './signals.js'
import pdfRouter from './pdf.js'
import { startWhatsApp, whatsappRouter } from './whatsapp.js'
import { startEmail, emailRouter } from './email.js'
import vpnRouter, { autoConnectVPN } from './vpn.js'
import chatRouter from './agents/index.js'
import adminRouter from './admin.js'
import openaiCompatRouter from './openai-compat.js'
import { startJobWorker } from './jobs.js'
import { initEmbeddings } from './embeddings.js'
import { initAutonomousAgents } from './agents/autonomous.js'
import { initWorkflows } from './agents/workflows.js'
import { loadPlugins, mountPluginRoutes, startPlugins } from './plugins/loader.js'
import { initPluginTools } from './agents/tool-registry.js'

// Pre-migration: fix legacy foreign key constraints on chat tables
// The old schema referenced aziende(id) and user_profiles(id) which don't exist in VFS model
try {
  const sessSchema = (db.prepare("SELECT sql FROM sqlite_master WHERE name = 'chat_sessions'").get() as any)?.sql || ''
  if (sessSchema.includes('REFERENCES aziende') || sessSchema.includes('REFERENCES user_profiles')) {
    console.log('[Migration] Recreating chat_sessions without legacy foreign keys...')
    db.exec(`
      CREATE TABLE chat_sessions_new (id TEXT PRIMARY KEY, azienda_id TEXT, user_id TEXT, titolo TEXT NOT NULL DEFAULT 'Nuova conversazione', channel TEXT DEFAULT 'web', agent_domain TEXT, deleted_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
      INSERT INTO chat_sessions_new SELECT id, azienda_id, user_id, titolo, channel, agent_domain, deleted_at, created_at, updated_at FROM chat_sessions;
      DROP TABLE chat_sessions;
      ALTER TABLE chat_sessions_new RENAME TO chat_sessions;
    `)
    console.log('[Migration] chat_sessions recreated without FK constraints')
  }
  const msgSchema = (db.prepare("SELECT sql FROM sqlite_master WHERE name = 'chat_messages'").get() as any)?.sql || ''
  if (msgSchema.includes('REFERENCES chat_sessions') || msgSchema.includes('CHECK')) {
    console.log('[Migration] Recreating chat_messages without legacy constraints...')
    db.exec(`
      CREATE TABLE chat_messages_new (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, user_id TEXT, ruolo TEXT NOT NULL, contenuto TEXT NOT NULL, tool_calls TEXT, agent_domain TEXT, agent_name TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
      INSERT INTO chat_messages_new SELECT id, session_id, user_id, ruolo, contenuto, tool_calls, agent_domain, agent_name, created_at FROM chat_messages;
      DROP TABLE chat_messages;
      ALTER TABLE chat_messages_new RENAME TO chat_messages;
    `)
    console.log('[Migration] chat_messages recreated without FK/CHECK constraints')
  }
} catch (err) { console.warn('[Migration] Chat table fix error:', (err as Error).message) }

// Pre-migration: add columns to existing tables (idempotent, must run BEFORE schema SQL)
try { db.exec("ALTER TABLE user_profiles ADD COLUMN tts_voice TEXT DEFAULT 'Vivian'") } catch {}
try { db.exec("ALTER TABLE chat_sessions ADD COLUMN channel TEXT DEFAULT 'web'") } catch {}
try { db.exec("ALTER TABLE chat_sessions ADD COLUMN agent_domain TEXT") } catch {}
try { db.exec("ALTER TABLE chat_sessions ADD COLUMN deleted_at TEXT") } catch {}
try { db.exec("ALTER TABLE chat_messages ADD COLUMN user_id TEXT") } catch {}
try { db.exec("ALTER TABLE chat_messages ADD COLUMN agent_domain TEXT") } catch {}
try { db.exec("ALTER TABLE chat_messages ADD COLUMN agent_name TEXT") } catch {}
try { db.exec("ALTER TABLE entity ADD COLUMN deleted_at TEXT") } catch {}
try { db.exec("CREATE TABLE IF NOT EXISTS api_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, azienda_id TEXT NOT NULL, token_hash TEXT NOT NULL, token_preview TEXT NOT NULL, name TEXT DEFAULT 'API Key', expires_at TEXT, revoked_at TEXT, last_used_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))") } catch {}

// Run migrations on startup
const migrationPath = path.join(import.meta.dirname || '.', 'migrations', 'init-sqlite.sql')
if (fs.existsSync(migrationPath)) {
  const sql = fs.readFileSync(migrationPath, 'utf-8')
  db.exec(sql)
  console.log('SQLite migrations applied.')
}
// FTS triggers: only INSERT triggers (standalone FTS5 can't do delete/update safely)
try {
  db.exec("DROP TRIGGER IF EXISTS chunk_fts_au")
  db.exec("DROP TRIGGER IF EXISTS chunk_fts_ad")
  db.exec("DROP TRIGGER IF EXISTS entity_fts_au")
  db.exec("DROP TRIGGER IF EXISTS entity_fts_ad")
  // Keep only INSERT triggers — they're created in init-sqlite.sql
  console.log('FTS triggers cleaned (INSERT only).')
} catch {}

// Create vec0 vector index for semantic chunk search (sqlite-vec)
try {
  db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vec USING vec0(chunk_id TEXT PRIMARY KEY, embedding float[1536])')
  // Sync existing embeddings into vec0 index
  const embeddedChunks = db.prepare("SELECT id, embedding FROM entity WHERE type = 'chunk' AND embedding IS NOT NULL").all() as any[]
  if (embeddedChunks.length > 0) {
    // Drop and recreate to ensure clean state
    try { db.exec('DROP TABLE IF EXISTS chunk_vec') } catch {}
    db.exec('CREATE VIRTUAL TABLE chunk_vec USING vec0(chunk_id TEXT PRIMARY KEY, embedding float[1536])')
    const insert = db.prepare('INSERT INTO chunk_vec(chunk_id, embedding) VALUES (?, ?)')
    const tx = db.transaction(() => {
      for (const c of embeddedChunks) insert.run(c.id, c.embedding)
    })
    tx()
    console.log(`[VecIndex] Synced ${embeddedChunks.length} chunk embeddings to vec0 index`)
  }
} catch (err) {
  console.warn('[VecIndex] Vec index setup skipped:', (err as Error).message)
}

// Run v5 VFS migration (idempotent)
import { migrateToVFS } from './migrations/migrate-vfs.js'
try {
  const migrated = migrateToVFS()
  if (migrated) console.log('VFS migration completed successfully.')
} catch (err) {
  console.warn('VFS migration skipped or failed:', (err as Error).message)
}

// ── Create default permission groups (idempotent) ────────
try {
  const defaultGroups = [
    { name: 'Amministratori', slug: 'amministratori', permissions: { '*': ['read', 'create', 'update', 'delete', 'send'] } },
    { name: 'Operatori', slug: 'operatori', permissions: { '*': ['read', 'create', 'update'] } },
    { name: 'Lettori', slug: 'lettori', permissions: { '*': ['read'] } },
  ]
  const aziendaId = (db.prepare("SELECT id FROM entity WHERE type = 'organizzazione' LIMIT 1").get() as any)?.id
    || (db.prepare("SELECT DISTINCT azienda_id FROM entity LIMIT 1").get() as any)?.azienda_id
  if (aziendaId) {
    for (const g of defaultGroups) {
      const exists = db.prepare("SELECT id FROM entity WHERE type = 'gruppo' AND slug = ? AND azienda_id = ?").get(g.slug, aziendaId)
      if (!exists) {
        const id = crypto.randomUUID()
        db.prepare("INSERT INTO entity (id, azienda_id, type, display_name, slug, metadata, path) VALUES (?,?,'gruppo',?,?,?,?)").run(
          id, aziendaId, g.name, g.slug, JSON.stringify({ permissions: g.permissions }), `/entity/gruppo/${g.slug}`
        )
        console.log(`[Groups] Created default group: ${g.name}`)
      }
    }

    // Migrate existing users: assign to groups based on metadata.ruolo
    const users = db.prepare("SELECT id, metadata FROM entity WHERE type = 'utente' AND azienda_id = ?").all(aziendaId) as any[]
    for (const u of users) {
      // Skip if user already has groups
      const hasGroups = db.prepare("SELECT 1 FROM relations WHERE from_id = ? AND tipo = 'membro_di_gruppo' LIMIT 1").get(u.id)
      if (hasGroups) continue

      const meta = typeof u.metadata === 'string' ? JSON.parse(u.metadata) : (u.metadata || {})
      const ruolo = meta.ruolo || 'collaboratore'
      const groupSlug = ruolo === 'admin' ? 'amministratori' : ruolo === 'viewer' ? 'lettori' : 'operatori'
      const group = db.prepare("SELECT id FROM entity WHERE type = 'gruppo' AND slug = ? AND azienda_id = ?").get(groupSlug, aziendaId) as any
      if (group) {
        db.prepare("INSERT OR IGNORE INTO relations (id, azienda_id, from_id, to_id, tipo) VALUES (?,?,?,?,'membro_di_gruppo')").run(
          crypto.randomUUID(), aziendaId, u.id, group.id
        )
        console.log(`[Groups] Migrated ${u.id} → ${groupSlug}`)
      }
    }
  }
} catch (err) {
  console.warn('[Groups] Setup error:', (err as Error).message)
}

// ── Load plugins ────────────────────────────────────────
await loadPlugins()
initPluginTools()

const app = express()
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001

// CORS configured for Vite dev server
app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true,
}))

// Body parser
app.use(express.json({ limit: '10mb' }))

// Cookie parser
app.use(cookieParser())

// Routes
app.use('/api/auth', authRouter)
app.use('/api/query', queryRouter)
app.use('/api/upload', uploadRouter)
app.use('/api/uploads', uploadsStaticRouter)
app.use('/api/documenti', documentiRouter)
app.use('/api/context', contextRouter)
app.use('/api/files', filesRouter)
app.use('/api/tts', ttsRouter)
app.use('/api/signals', signalsRouter)
app.use('/api/pdf', pdfRouter)
app.use('/api/whatsapp', whatsappRouter)
app.use('/api/email', emailRouter)
app.use('/api/vpn', vpnRouter)
app.use('/api/chat', chatRouter)
app.use('/api/admin', adminRouter)
app.use('/v1', openaiCompatRouter)
mountPluginRoutes(app)

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Error handling middleware
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err)
  res.status(500).json({ error: { message: 'Errore interno del server', code: 'INTERNAL_ERROR' } })
})

app.listen(PORT, () => {
  console.log(`FIAI OS server running on http://localhost:${PORT}`)
  startWhatsApp().catch(err => console.error('WhatsApp startup error:', err))
  startEmail().catch(err => console.error('Email startup error:', err))
  autoConnectVPN().catch(err => console.error('VPN auto-connect error:', err))
  startPlugins().catch(err => console.error('Plugin startup error:', err))
  initAutonomousAgents()
  initWorkflows()
  initEmbeddings()
  startJobWorker()

  // Auto-create embedding job if unembedded entities exist
  setTimeout(() => {
    try {
      const unembedded = db.prepare("SELECT COUNT(*) as c FROM entity WHERE embedding IS NULL AND type NOT IN ('chat_message','chat_session','agent_log','job','workflow_log','chunk','board','board_column','category_template','skill','agent_memory')").get() as any
      if (unembedded?.c > 0) {
        const existingJob = db.prepare("SELECT id FROM entity WHERE type = 'job' AND json_extract(metadata, '$.action') = 'generate_embeddings' AND stato = 'queued'").get()
        if (!existingJob) {
          const { createJob } = require('./jobs.js')
          const azId = db.prepare("SELECT id FROM entity WHERE type = 'organizzazione' LIMIT 1").get() as any
          if (azId) {
            createJob(azId.id, 'generate_embeddings', {}, {})
            console.log(`[Embedding] Scheduled batch embedding for ${unembedded.c} unembedded entities`)
          }
        }
      }
    } catch {}
  }, 5000)
})

export default app
