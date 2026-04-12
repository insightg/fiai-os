/**
 * Dynamic Settings System — DB persistence with env var fallback
 *
 * Settings are stored as entity(type='setting') in SQLite.
 * Loaded into memory at startup, updated via admin API.
 * Falls back to process.env, then to hardcoded defaults.
 */

import crypto from 'crypto'
import db from './db.js'

// ── Settings Registry ────────────────────────────────────

export interface SettingDef {
  key: string
  category: string
  envVar: string
  description: string
  sensitive: boolean
  defaultValue: string
  requiresRestart: boolean
}

export const SETTINGS_REGISTRY: SettingDef[] = [
  // Azienda
  { key: 'company_name', category: 'azienda', envVar: 'COMPANY_NAME', description: 'Nome azienda (usato nei prompt degli agenti)', sensitive: false, defaultValue: 'BERNARDINI S.R.L.', requiresRestart: false },
  { key: 'company_short_name', category: 'azienda', envVar: 'COMPANY_SHORT_NAME', description: 'Nome breve azienda', sensitive: false, defaultValue: 'BERNARDINI', requiresRestart: false },

  // API
  { key: 'openrouter_api_key', category: 'api', envVar: 'OPENROUTER_API_KEY', description: 'API key OpenRouter (LLM)', sensitive: true, defaultValue: '', requiresRestart: false },
  { key: 'embedding_model', category: 'api', envVar: 'EMBEDDING_MODEL', description: 'Modello embedding (es. openai/text-embedding-3-small)', sensitive: false, defaultValue: 'openai/text-embedding-3-small', requiresRestart: false },

  // Email
  { key: 'email_user', category: 'email', envVar: 'EMAIL_USER', description: 'Indirizzo email (IMAP/SMTP)', sensitive: false, defaultValue: '', requiresRestart: false },
  { key: 'email_password', category: 'email', envVar: 'EMAIL_PASSWORD', description: 'Password email', sensitive: true, defaultValue: '', requiresRestart: false },
  { key: 'email_imap_host', category: 'email', envVar: 'EMAIL_IMAP_HOST', description: 'Server IMAP', sensitive: false, defaultValue: 'imaps.aruba.it', requiresRestart: false },
  { key: 'email_imap_port', category: 'email', envVar: 'EMAIL_IMAP_PORT', description: 'Porta IMAP', sensitive: false, defaultValue: '993', requiresRestart: false },
  { key: 'email_smtp_host', category: 'email', envVar: 'EMAIL_SMTP_HOST', description: 'Server SMTP', sensitive: false, defaultValue: 'smtps.aruba.it', requiresRestart: false },
  { key: 'email_smtp_port', category: 'email', envVar: 'EMAIL_SMTP_PORT', description: 'Porta SMTP', sensitive: false, defaultValue: '465', requiresRestart: false },
  { key: 'email_process_unknown', category: 'email', envVar: 'EMAIL_PROCESS_UNKNOWN', description: 'Processa email da mittenti sconosciuti', sensitive: false, defaultValue: 'false', requiresRestart: false },

  // WhatsApp
  { key: 'whatsapp_auth_dir', category: 'whatsapp', envVar: 'WHATSAPP_AUTH_DIR', description: 'Directory autenticazione WhatsApp', sensitive: false, defaultValue: '/app/data/whatsapp-auth', requiresRestart: true },

  // TTS
  { key: 'tts_api_url', category: 'tts', envVar: 'TTS_API_URL', description: 'URL API Text-to-Speech', sensitive: false, defaultValue: 'http://host.docker.internal:7777/v1/audio/speech', requiresRestart: false },

  // Storage
  { key: 'uploads_dir', category: 'storage', envVar: 'UPLOADS_DIR', description: 'Directory uploads', sensitive: false, defaultValue: '/app/data/uploads', requiresRestart: true },
  { key: 'context_dir', category: 'storage', envVar: 'CONTEXT_DIR', description: 'Directory contesto agenti', sensitive: false, defaultValue: '/app/data/context', requiresRestart: true },

  // Auth
  { key: 'jwt_secret', category: 'auth', envVar: 'JWT_SECRET', description: 'Chiave segreta JWT', sensitive: true, defaultValue: 'fiai-dev-secret', requiresRestart: true },

  // System
  { key: 'default_agent_model', category: 'system', envVar: 'DEFAULT_AGENT_MODEL', description: 'Modello LLM default per agenti', sensitive: false, defaultValue: 'anthropic/claude-haiku-4.5-20251001', requiresRestart: false },
]

// ── In-memory cache ──────────────────────────────────────

const settingsCache = new Map<string, string>()
const registryMap = new Map<string, SettingDef>()

// Initialize registry map
for (const def of SETTINGS_REGISTRY) {
  registryMap.set(def.key, def)
}

// ── Core Functions ───────────────────────────────────────

export function loadSettings(): void {
  settingsCache.clear()
  try {
    const rows = db.prepare("SELECT slug, body FROM entity WHERE type = 'setting' AND deleted_at IS NULL").all() as any[]
    for (const row of rows) {
      if (row.slug && row.body != null) {
        settingsCache.set(row.slug, row.body)
      }
    }
    console.log(`[Settings] Loaded ${settingsCache.size} settings from DB`)
  } catch (err) {
    console.warn('[Settings] Failed to load from DB:', (err as Error).message)
  }
}

export function getSetting(key: string): string {
  // 1. DB cache
  const dbValue = settingsCache.get(key)
  if (dbValue !== undefined) return dbValue

  // 2. Environment variable
  const def = registryMap.get(key)
  if (def) {
    const envValue = process.env[def.envVar]
    if (envValue !== undefined) return envValue
    return def.defaultValue
  }

  return ''
}

export function setSetting(aziendaId: string, key: string, value: string): void {
  const def = registryMap.get(key)
  const existing = db.prepare("SELECT id FROM entity WHERE type = 'setting' AND slug = ? AND azienda_id = ?").get(key, aziendaId) as any

  if (existing) {
    db.prepare("UPDATE entity SET body = ?, updated_at = datetime('now') WHERE id = ?").run(value, existing.id)
  } else {
    const id = crypto.randomUUID()
    db.prepare("INSERT INTO entity (id, azienda_id, type, display_name, slug, body, metadata, path) VALUES (?,?,'setting',?,?,?,?,?)").run(
      id, aziendaId,
      def?.description || key,
      key, value,
      JSON.stringify({ category: def?.category || 'custom', envVar: def?.envVar || '', sensitive: def?.sensitive || false }),
      `/entity/setting/${key}`
    )
  }

  settingsCache.set(key, value)
}

export function getSettingsDiscovery(aziendaId: string): Array<SettingDef & { value: string; source: 'db' | 'env' | 'default' }> {
  return SETTINGS_REGISTRY.map(def => {
    const dbValue = settingsCache.get(def.key)
    const envValue = process.env[def.envVar]

    let value: string
    let source: 'db' | 'env' | 'default'

    if (dbValue !== undefined) {
      value = dbValue
      source = 'db'
    } else if (envValue !== undefined) {
      value = envValue
      source = 'env'
    } else {
      value = def.defaultValue
      source = 'default'
    }

    // Mask sensitive values
    if (def.sensitive && value) {
      value = value.length > 4 ? '****' + value.slice(-4) : '****'
    }

    return { ...def, value, source }
  })
}

// Load on import
loadSettings()
