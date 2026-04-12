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

// ── Response Profile Defaults ────────────────────────────

export const DEFAULT_RESPONSE_PROFILES: { slug: string; name: string; description: string; prompt: string }[] = [
  {
    slug: 'voice',
    name: 'Vocale',
    description: 'Per dispositivi audio / TTS — risposte discorsive senza markdown',
    prompt: `FORMATO VOCALE — La tua risposta verra' letta ad alta voce da un sintetizzatore vocale.
REGOLE DI FORMATTAZIONE VOCALE (OBBLIGATORIE):
- Rispondi in modo DISCORSIVO e NATURALE, come se stessi parlando a voce con un collega.
- VIETATO usare: tabelle, markdown, asterischi, elenchi puntati, titoli con #, emoji, parentesi, link, codice.
- VIETATO elencare dati in formato lista. Integra i numeri nel discorso in modo fluido.
- I numeri vanno scritti per esteso quando brevi (es. "tre clienti", "ventiquattro"), in cifre quando lunghi (es. "847.000 euro").
- Le date vanno lette naturalmente: "undici aprile duemilaventisei", non "11/04/2026".
- Usa frasi complete e connettori naturali: "per quanto riguarda", "inoltre", "in particolare".
- Se ci sono molti dati, fai un RIASSUNTO discorsivo con i punti salienti, non un elenco completo.
- Massimo 4-5 frasi per risposta. Se l'utente vuole approfondire, chiedera'.
- Tono: professionale ma cordiale, come un assistente che riferisce a voce.`,
  },
  {
    slug: 'brief',
    name: 'Sintetico',
    description: 'Risposte ultra-brevi, max 2 frasi — per notifiche, smartwatch, widget',
    prompt: `FORMATO SINTETICO — Rispondi in massimo 1-2 frasi.
- Vai dritto al punto, nessuna introduzione o convenevole.
- Se ci sono dati, riporta solo il numero piu' importante.
- Niente liste, tabelle, o formattazione complessa.
- Se servono dettagli, suggerisci all'utente di chiedere approfondimenti.`,
  },
  {
    slug: 'json',
    name: 'JSON Strutturato',
    description: 'Risposte in JSON puro — per integrazioni machine-to-machine',
    prompt: `FORMATO JSON — Rispondi SOLO con un JSON valido, senza testo aggiuntivo.
Struttura la risposta come:
{"answer": "...", "data": [...], "suggestions": [...]}
- "answer": la risposta testuale principale
- "data": array di oggetti con i dati trovati (opzionale, solo se ci sono risultati dei tool)
- "suggestions": array di stringhe con suggerimenti per il prossimo passo
NON aggiungere MAI testo fuori dal JSON. Niente markdown, niente commenti.`,
  },
  {
    slug: 'report',
    name: 'Report',
    description: 'Risposte dettagliate e strutturate — per documenti e analisi',
    prompt: `FORMATO REPORT — Rispondi in modo strutturato e dettagliato, adatto a un documento professionale.
- Usa titoli con ## e sottotitoli con ###
- Usa elenchi puntati per i dati chiave
- Includi tabelle markdown quando appropriato
- Aggiungi una sezione "Conclusioni" o "Prossimi passi" alla fine
- Tono formale e professionale
- Non abbreviare — includi tutti i dati disponibili`,
  },
  {
    slug: 'whatsapp',
    name: 'WhatsApp',
    description: 'Formattazione WhatsApp — grassetto con *, liste con -, conciso',
    prompt: 'Formatta per WhatsApp: *grassetto*, liste con -, niente tabelle markdown. Sii conciso.',
  },
]

// ── Response Profile Functions ───────────────────────────

export function getResponseProfile(slug: string, aziendaId?: string): string | null {
  // 1. Check DB for custom/edited profile
  try {
    const entity = db.prepare(
      "SELECT body FROM entity WHERE type = 'response_profile' AND slug = ? AND deleted_at IS NULL" + (aziendaId ? " AND azienda_id = ?" : "") + " LIMIT 1"
    ).get(...(aziendaId ? [slug, aziendaId] : [slug])) as any
    if (entity?.body) return entity.body
  } catch {}

  // 2. Fallback to built-in default
  const builtin = DEFAULT_RESPONSE_PROFILES.find(p => p.slug === slug)
  return builtin?.prompt || null
}

export function listResponseProfiles(aziendaId?: string): { slug: string; name: string; description: string; source: 'db' | 'default' }[] {
  const result: { slug: string; name: string; description: string; source: 'db' | 'default' }[] = []
  const seen = new Set<string>()

  // DB profiles first (overrides)
  try {
    const rows = db.prepare(
      "SELECT slug, display_name, metadata FROM entity WHERE type = 'response_profile' AND deleted_at IS NULL" + (aziendaId ? " AND azienda_id = ?" : "") + " ORDER BY display_name"
    ).all(...(aziendaId ? [aziendaId] : [])) as any[]
    for (const r of rows) {
      const meta = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : (r.metadata || {})
      result.push({ slug: r.slug, name: r.display_name, description: meta.description || '', source: 'db' })
      seen.add(r.slug)
    }
  } catch {}

  // Built-in defaults (only if not overridden)
  for (const p of DEFAULT_RESPONSE_PROFILES) {
    if (!seen.has(p.slug)) {
      result.push({ slug: p.slug, name: p.name, description: p.description, source: 'default' })
    }
  }

  return result
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
