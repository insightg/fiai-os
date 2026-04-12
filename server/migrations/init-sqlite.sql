-- ══════════════════════════════════════════════════════════
-- BERNARDINI OS — SQLite Schema (clean VFS)
-- ══════════════════════════════════════════════════════════

-- ── Legacy auth tables (kept for frontend compat) ─────────
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS aziende (
  id          TEXT PRIMARY KEY,
  nome        TEXT NOT NULL,
  piva        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_profiles (
  id          TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  azienda_id  TEXT NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  nome        TEXT NOT NULL,
  cognome     TEXT NOT NULL DEFAULT '',
  ruolo       TEXT NOT NULL DEFAULT 'collaboratore',
  avatar_url       TEXT,
  whatsapp_phone   TEXT,
  whatsapp_active  INTEGER DEFAULT 0,
  tts_voice        TEXT DEFAULT 'Vivian',
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Chat (legacy frontend tables) ─────────────────────────
CREATE TABLE IF NOT EXISTS chat_sessions (
  id          TEXT PRIMARY KEY,
  azienda_id  TEXT,
  user_id     TEXT,
  titolo      TEXT NOT NULL DEFAULT 'Nuova conversazione',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  ruolo       TEXT NOT NULL,
  contenuto   TEXT NOT NULL,
  tool_calls  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Entity (VFS — everything) ─────────────────────────────
CREATE TABLE IF NOT EXISTS entity (
  id            TEXT PRIMARY KEY,
  azienda_id    TEXT NOT NULL,
  type          TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  slug          TEXT NOT NULL,
  stato         TEXT,
  email         TEXT,
  telefono      TEXT,
  tags          TEXT DEFAULT '[]',
  piva          TEXT,
  categoria     TEXT,
  body          TEXT,
  embedding     BLOB,
  name_id       TEXT,
  parent_id     TEXT REFERENCES entity(id) ON DELETE CASCADE,
  user_id       TEXT,
  file_url      TEXT,
  numero        TEXT,
  data          TEXT,
  totale        REAL,
  metadata      TEXT NOT NULL DEFAULT '{}',
  path          TEXT NOT NULL DEFAULT '',
  ordine        INTEGER DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_entity_azienda ON entity(azienda_id);
CREATE INDEX IF NOT EXISTS idx_entity_type ON entity(azienda_id, type);
CREATE INDEX IF NOT EXISTS idx_entity_name ON entity(name_id);
CREATE INDEX IF NOT EXISTS idx_entity_parent ON entity(parent_id);
CREATE INDEX IF NOT EXISTS idx_entity_user ON entity(user_id);
CREATE INDEX IF NOT EXISTS idx_entity_stato ON entity(azienda_id, type, stato);
CREATE INDEX IF NOT EXISTS idx_entity_numero ON entity(azienda_id, type, numero);
CREATE INDEX IF NOT EXISTS idx_entity_data ON entity(azienda_id, type, data);
CREATE INDEX IF NOT EXISTS idx_entity_email ON entity(email);
CREATE INDEX IF NOT EXISTS idx_entity_tags ON entity(tags);
CREATE INDEX IF NOT EXISTS idx_entity_piva ON entity(piva);
CREATE INDEX IF NOT EXISTS idx_entity_categoria ON entity(categoria);
CREATE INDEX IF NOT EXISTS idx_entity_slug ON entity(slug);

-- ── Relations ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS relations (
  id         TEXT PRIMARY KEY,
  azienda_id TEXT,
  from_id    TEXT NOT NULL,
  to_id      TEXT NOT NULL,
  tipo       TEXT NOT NULL,
  metadata   TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(from_id, to_id, tipo)
);

CREATE INDEX IF NOT EXISTS idx_relations_from ON relations(from_id);
CREATE INDEX IF NOT EXISTS idx_relations_to ON relations(to_id);
CREATE INDEX IF NOT EXISTS idx_relations_tipo ON relations(tipo);
CREATE INDEX IF NOT EXISTS idx_relations_from_tipo ON relations(from_id, tipo);
CREATE INDEX IF NOT EXISTS idx_relations_to_tipo ON relations(to_id, tipo);
CREATE INDEX IF NOT EXISTS idx_relations_azienda ON relations(azienda_id);

-- ── FTS for document chunks (standalone) ──────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(
  body, display_name,
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS chunk_fts_ai AFTER INSERT ON entity WHEN NEW.type = 'chunk' BEGIN
  INSERT INTO chunk_fts(rowid, body, display_name)
  VALUES (NEW.rowid, NEW.body, NEW.display_name);
END;

-- ── FTS for entity search (standalone) ────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS entity_fts USING fts5(
  display_name, type, metadata
);

CREATE TRIGGER IF NOT EXISTS entity_fts_ai AFTER INSERT ON entity BEGIN
  INSERT INTO entity_fts(rowid, display_name, type, metadata)
  VALUES (NEW.rowid, NEW.display_name, NEW.type, NEW.metadata);
END;

-- ── Audit log ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS entity_audit (
  id          TEXT PRIMARY KEY,
  entity_id   TEXT NOT NULL,
  entity_type TEXT,
  action      TEXT NOT NULL,
  user_id     TEXT,
  before_data TEXT,
  after_data  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_entity ON entity_audit(entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_user ON entity_audit(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_date ON entity_audit(created_at);

-- ── Chat indexes ──────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
