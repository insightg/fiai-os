-- ══════════════════════════════════════════════════════════
-- FIAI OS — Unified SQLite Schema
-- ══════════════════════════════════════════════════════════

-- ── Users ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Aziende ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS aziende (
  id          TEXT PRIMARY KEY,
  nome        TEXT NOT NULL,
  piva        TEXT NOT NULL,
  codice_sdi  TEXT,
  pec         TEXT,
  indirizzo   TEXT,
  cap         TEXT,
  citta       TEXT,
  provincia   TEXT,
  email       TEXT,
  telefono    TEXT,
  iban        TEXT,
  banca       TEXT,
  logo_url    TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── User Profiles ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_profiles (
  id          TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  azienda_id  TEXT NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  nome        TEXT NOT NULL,
  cognome     TEXT NOT NULL,
  ruolo       TEXT NOT NULL DEFAULT 'collaboratore' CHECK (ruolo IN ('admin','collaboratore','viewer')),
  avatar_url       TEXT,
  whatsapp_phone   TEXT,
  whatsapp_active  INTEGER DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Clienti ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clienti (
  id              TEXT PRIMARY KEY,
  azienda_id      TEXT NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
  tipo            TEXT NOT NULL DEFAULT 'azienda' CHECK (tipo IN ('privato','azienda')),
  nome            TEXT NOT NULL,
  cognome         TEXT,
  ragione_sociale TEXT,
  piva            TEXT,
  codice_fiscale  TEXT,
  email           TEXT,
  telefono        TEXT,
  indirizzo       TEXT,
  cap             TEXT,
  citta           TEXT,
  provincia       TEXT,
  codice_sdi      TEXT,
  pec             TEXT,
  note            TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Leads ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id              TEXT PRIMARY KEY,
  azienda_id      TEXT NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
  nome            TEXT NOT NULL,
  cognome         TEXT NOT NULL,
  email           TEXT,
  telefono        TEXT,
  azienda_lead    TEXT,
  fonte           TEXT,
  stato           TEXT NOT NULL DEFAULT 'nuovo' CHECK (stato IN ('nuovo','contattato','qualificato','proposta','perso','convertito')),
  valore_stimato  REAL,
  note            TEXT,
  assegnato_a     TEXT REFERENCES user_profiles(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Preventivi ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS preventivi (
  id          TEXT PRIMARY KEY,
  azienda_id  TEXT NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
  cliente_id  TEXT NOT NULL REFERENCES clienti(id) ON DELETE CASCADE,
  numero      TEXT NOT NULL,
  data        TEXT NOT NULL DEFAULT (date('now')),
  scadenza    TEXT,
  stato       TEXT NOT NULL DEFAULT 'bozza' CHECK (stato IN ('bozza','inviato','accettato','rifiutato','scaduto')),
  oggetto     TEXT,
  note        TEXT,
  imponibile  REAL NOT NULL DEFAULT 0,
  iva         REAL NOT NULL DEFAULT 0,
  totale      REAL NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Preventivo Righe ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS preventivo_righe (
  id               TEXT PRIMARY KEY,
  preventivo_id    TEXT NOT NULL REFERENCES preventivi(id) ON DELETE CASCADE,
  descrizione      TEXT NOT NULL,
  quantita         REAL NOT NULL DEFAULT 1,
  prezzo_unitario  REAL NOT NULL DEFAULT 0,
  iva_percent      REAL NOT NULL DEFAULT 22,
  totale           REAL NOT NULL DEFAULT 0,
  ordine           INTEGER NOT NULL DEFAULT 0
);

-- ── Ordini ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ordini (
  id              TEXT PRIMARY KEY,
  azienda_id      TEXT NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
  cliente_id      TEXT NOT NULL REFERENCES clienti(id) ON DELETE CASCADE,
  preventivo_id   TEXT REFERENCES preventivi(id),
  numero          TEXT NOT NULL,
  data            TEXT NOT NULL DEFAULT (date('now')),
  stato           TEXT NOT NULL DEFAULT 'confermato' CHECK (stato IN ('confermato','in_lavorazione','completato','annullato')),
  imponibile      REAL NOT NULL DEFAULT 0,
  iva             REAL NOT NULL DEFAULT 0,
  totale          REAL NOT NULL DEFAULT 0,
  note            TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Progetti ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS progetti (
  id                   TEXT PRIMARY KEY,
  azienda_id           TEXT NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
  cliente_id           TEXT NOT NULL REFERENCES clienti(id) ON DELETE CASCADE,
  ordine_id            TEXT REFERENCES ordini(id),
  nome                 TEXT NOT NULL,
  descrizione          TEXT,
  stato                TEXT NOT NULL DEFAULT 'pianificato' CHECK (stato IN ('pianificato','in_corso','in_pausa','completato','annullato')),
  data_inizio          TEXT,
  data_fine_prevista   TEXT,
  data_fine_effettiva  TEXT,
  budget               REAL,
  note                 TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Fatture ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fatture (
  id                  TEXT PRIMARY KEY,
  azienda_id          TEXT NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
  cliente_id          TEXT NOT NULL REFERENCES clienti(id) ON DELETE CASCADE,
  ordine_id           TEXT REFERENCES ordini(id),
  numero              TEXT NOT NULL,
  data                TEXT NOT NULL DEFAULT (date('now')),
  scadenza            TEXT,
  stato               TEXT NOT NULL DEFAULT 'bozza' CHECK (stato IN ('bozza','emessa','inviata_sdi','pagata','scaduta','stornata')),
  oggetto             TEXT,
  imponibile          REAL NOT NULL DEFAULT 0,
  iva                 REAL NOT NULL DEFAULT 0,
  totale              REAL NOT NULL DEFAULT 0,
  pagata_il           TEXT,
  metodo_pagamento    TEXT,
  note                TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Fattura Righe ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fattura_righe (
  id               TEXT PRIMARY KEY,
  fattura_id       TEXT NOT NULL REFERENCES fatture(id) ON DELETE CASCADE,
  descrizione      TEXT NOT NULL,
  quantita         REAL NOT NULL DEFAULT 1,
  prezzo_unitario  REAL NOT NULL DEFAULT 0,
  iva_percent      REAL NOT NULL DEFAULT 22,
  totale           REAL NOT NULL DEFAULT 0,
  ordine           INTEGER NOT NULL DEFAULT 0
);

-- ── Ricorrenti ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ricorrenti (
  id                   TEXT PRIMARY KEY,
  azienda_id           TEXT NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
  cliente_id           TEXT NOT NULL REFERENCES clienti(id) ON DELETE CASCADE,
  descrizione          TEXT NOT NULL,
  importo              REAL NOT NULL,
  iva_percent          REAL NOT NULL DEFAULT 22,
  frequenza            TEXT NOT NULL DEFAULT 'mensile' CHECK (frequenza IN ('mensile','bimestrale','trimestrale','semestrale','annuale')),
  prossima_emissione   TEXT NOT NULL,
  attivo               INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Fornitori ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fornitori (
  id               TEXT PRIMARY KEY,
  azienda_id       TEXT NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
  ragione_sociale  TEXT NOT NULL,
  piva             TEXT,
  email            TEXT,
  telefono         TEXT,
  indirizzo        TEXT,
  cap              TEXT,
  citta            TEXT,
  provincia        TEXT,
  iban             TEXT,
  note             TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Fatture Passive ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS fatture_passive (
  id              TEXT PRIMARY KEY,
  azienda_id      TEXT NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
  fornitore_id    TEXT NOT NULL REFERENCES fornitori(id) ON DELETE CASCADE,
  numero          TEXT NOT NULL,
  data            TEXT NOT NULL DEFAULT (date('now')),
  scadenza        TEXT,
  stato           TEXT NOT NULL DEFAULT 'da_pagare' CHECK (stato IN ('da_pagare','pagata','contestata')),
  imponibile      REAL NOT NULL DEFAULT 0,
  iva             REAL NOT NULL DEFAULT 0,
  totale          REAL NOT NULL DEFAULT 0,
  pagata_il       TEXT,
  note            TEXT,
  file_url        TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Conti ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conti (
  id          TEXT PRIMARY KEY,
  azienda_id  TEXT NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
  nome        TEXT NOT NULL,
  tipo        TEXT NOT NULL DEFAULT 'banca' CHECK (tipo IN ('banca','cassa','carta')),
  saldo       REAL NOT NULL DEFAULT 0,
  iban        TEXT,
  banca       TEXT,
  colore      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Movimenti ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS movimenti (
  id                  TEXT PRIMARY KEY,
  conto_id            TEXT NOT NULL REFERENCES conti(id) ON DELETE CASCADE,
  azienda_id          TEXT NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
  tipo                TEXT NOT NULL CHECK (tipo IN ('entrata','uscita','giroconto')),
  categoria           TEXT NOT NULL DEFAULT 'altro' CHECK (categoria IN ('fattura_attiva','fattura_passiva','stipendio','tasse','rimborso','altro')),
  importo             REAL NOT NULL,
  descrizione         TEXT,
  data                TEXT NOT NULL DEFAULT (date('now')),
  fattura_id          TEXT REFERENCES fatture(id),
  fattura_passiva_id  TEXT REFERENCES fatture_passive(id),
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Rimborsi ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rimborsi (
  id               TEXT PRIMARY KEY,
  azienda_id       TEXT NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
  richiedente_id   TEXT NOT NULL REFERENCES user_profiles(id),
  descrizione      TEXT NOT NULL,
  importo          REAL NOT NULL,
  data_spesa       TEXT NOT NULL,
  categoria        TEXT,
  stato            TEXT NOT NULL DEFAULT 'richiesto' CHECK (stato IN ('richiesto','approvato','rifiutato','rimborsato')),
  allegato_url     TEXT,
  approvato_da     TEXT REFERENCES user_profiles(id),
  approvato_il     TEXT,
  note             TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Chat Sessions ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_sessions (
  id          TEXT PRIMARY KEY,
  azienda_id  TEXT NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES user_profiles(id),
  titolo      TEXT NOT NULL DEFAULT 'Nuova conversazione',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Chat Messages ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_messages (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  ruolo       TEXT NOT NULL CHECK (ruolo IN ('user','assistant')),
  contenuto   TEXT NOT NULL,
  tool_calls  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Candidati ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS candidati (
  id                TEXT PRIMARY KEY,
  azienda_id        TEXT NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
  nome              TEXT NOT NULL,
  cognome           TEXT NOT NULL,
  email             TEXT,
  telefono          TEXT,
  ruolo_candidato   TEXT,
  stato             TEXT NOT NULL DEFAULT 'nuovo'
                    CHECK (stato IN ('nuovo','screening','colloquio','offerta','assunto','scartato')),
  cv_url            TEXT,
  note              TEXT,
  valutazione       INTEGER CHECK (valutazione IS NULL OR (valutazione >= 1 AND valutazione <= 5)),
  fonte             TEXT,
  data_candidatura  TEXT NOT NULL DEFAULT (date('now')),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Annunci di Lavoro ──────────────────────────────────
CREATE TABLE IF NOT EXISTS annunci_lavoro (
  id                TEXT PRIMARY KEY,
  azienda_id        TEXT NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
  ruolo             TEXT NOT NULL,
  competenze        TEXT,
  tipo_contratto    TEXT,
  sede              TEXT,
  ral_min           REAL,
  ral_max           REAL,
  contenuto         TEXT NOT NULL,
  stato             TEXT NOT NULL DEFAULT 'bozza'
                    CHECK (stato IN ('bozza','pubblicato','chiuso')),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Documenti ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documenti (
  id              TEXT PRIMARY KEY,
  azienda_id      TEXT NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
  nome            TEXT NOT NULL,
  tipo_file       TEXT NOT NULL,
  categoria       TEXT NOT NULL DEFAULT 'altro'
                  CHECK (categoria IN ('legale','pubblicita','documentazione_tecnica','normative','atti','contratti','altro')),
  descrizione     TEXT,
  file_url        TEXT NOT NULL,
  file_size       INTEGER,
  tags            TEXT,
  contenuto_testo TEXT,
  uploaded_by     TEXT REFERENCES user_profiles(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Note Boards ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS note_boards (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  nome       TEXT NOT NULL DEFAULT 'La mia board',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS note_columns (
  id         TEXT PRIMARY KEY,
  board_id   TEXT NOT NULL REFERENCES note_boards(id) ON DELETE CASCADE,
  nome       TEXT NOT NULL,
  ordine     INTEGER NOT NULL DEFAULT 0,
  colore     TEXT DEFAULT '#C41E3A',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS note_cards (
  id          TEXT PRIMARY KEY,
  column_id   TEXT NOT NULL REFERENCES note_columns(id) ON DELETE CASCADE,
  titolo      TEXT NOT NULL,
  contenuto   TEXT,
  colore      TEXT,
  priorita    TEXT DEFAULT 'media' CHECK (priorita IN ('bassa','media','alta','urgente')),
  scadenza    TEXT,
  completata  INTEGER DEFAULT 0,
  ordine      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Calendar Events ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS eventi (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  titolo          TEXT NOT NULL,
  descrizione     TEXT,
  data_inizio     TEXT NOT NULL,
  data_fine       TEXT,
  tutto_il_giorno INTEGER DEFAULT 0,
  colore          TEXT DEFAULT '#C41E3A',
  tipo            TEXT DEFAULT 'evento' CHECK (tipo IN ('evento','riunione','scadenza','promemoria')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Indexes ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_leads_azienda ON leads(azienda_id);
CREATE INDEX IF NOT EXISTS idx_clienti_azienda ON clienti(azienda_id);
CREATE INDEX IF NOT EXISTS idx_preventivi_azienda ON preventivi(azienda_id);
CREATE INDEX IF NOT EXISTS idx_preventivi_cliente ON preventivi(cliente_id);
CREATE INDEX IF NOT EXISTS idx_ordini_azienda ON ordini(azienda_id);
CREATE INDEX IF NOT EXISTS idx_progetti_azienda ON progetti(azienda_id);
CREATE INDEX IF NOT EXISTS idx_fatture_azienda ON fatture(azienda_id);
CREATE INDEX IF NOT EXISTS idx_fatture_cliente ON fatture(cliente_id);
CREATE INDEX IF NOT EXISTS idx_fatture_passive_azienda ON fatture_passive(azienda_id);
CREATE INDEX IF NOT EXISTS idx_fornitori_azienda ON fornitori(azienda_id);
CREATE INDEX IF NOT EXISTS idx_conti_azienda ON conti(azienda_id);
CREATE INDEX IF NOT EXISTS idx_movimenti_conto ON movimenti(conto_id);
CREATE INDEX IF NOT EXISTS idx_movimenti_azienda ON movimenti(azienda_id);
CREATE INDEX IF NOT EXISTS idx_rimborsi_azienda ON rimborsi(azienda_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_candidati_azienda ON candidati(azienda_id);
CREATE INDEX IF NOT EXISTS idx_candidati_stato ON candidati(stato);
CREATE INDEX IF NOT EXISTS idx_annunci_lavoro_azienda ON annunci_lavoro(azienda_id);
CREATE INDEX IF NOT EXISTS idx_documenti_azienda ON documenti(azienda_id);
CREATE INDEX IF NOT EXISTS idx_documenti_categoria ON documenti(categoria);
CREATE INDEX IF NOT EXISTS idx_note_boards_user ON note_boards(user_id);
CREATE INDEX IF NOT EXISTS idx_note_columns_board ON note_columns(board_id);
CREATE INDEX IF NOT EXISTS idx_note_cards_column ON note_cards(column_id);
CREATE INDEX IF NOT EXISTS idx_eventi_user ON eventi(user_id);
CREATE INDEX IF NOT EXISTS idx_eventi_data ON eventi(data_inizio);

-- ── FTS5 for document search ─────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS documenti_fts USING fts5(
  nome, descrizione, contenuto_testo,
  content='documenti', content_rowid='rowid'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS documenti_ai AFTER INSERT ON documenti BEGIN
  INSERT INTO documenti_fts(rowid, nome, descrizione, contenuto_testo)
  VALUES (NEW.rowid, NEW.nome, NEW.descrizione, NEW.contenuto_testo);
END;

CREATE TRIGGER IF NOT EXISTS documenti_ad AFTER DELETE ON documenti BEGIN
  INSERT INTO documenti_fts(documenti_fts, rowid, nome, descrizione, contenuto_testo)
  VALUES ('delete', OLD.rowid, OLD.nome, OLD.descrizione, OLD.contenuto_testo);
END;

CREATE TRIGGER IF NOT EXISTS documenti_au AFTER UPDATE ON documenti BEGIN
  INSERT INTO documenti_fts(documenti_fts, rowid, nome, descrizione, contenuto_testo)
  VALUES ('delete', OLD.rowid, OLD.nome, OLD.descrizione, OLD.contenuto_testo);
  INSERT INTO documenti_fts(rowid, nome, descrizione, contenuto_testo)
  VALUES (NEW.rowid, NEW.nome, NEW.descrizione, NEW.contenuto_testo);
END;

-- ── Prompt History ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS prompt_history (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  prompt     TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_prompt_history_user ON prompt_history(user_id);

-- ── WhatsApp Users ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_users (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  user_id TEXT REFERENCES user_profiles(id),
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_users_phone ON whatsapp_users(phone);
