-- ══════════════════════════════════════════════════════════
-- FIAI OS — Database Schema (Plain PostgreSQL)
-- ══════════════════════════════════════════════════════════

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Users (replaces auth.users) ─────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ── Aziende ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS aziende (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        text NOT NULL,
  piva        text NOT NULL,
  codice_sdi  text,
  pec         text,
  indirizzo   text,
  cap         text,
  citta       text,
  provincia   text,
  email       text,
  telefono    text,
  iban        text,
  banca       text,
  logo_url    text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ── User Profiles ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_profiles (
  id          uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  azienda_id  uuid NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
  email       text NOT NULL,
  nome        text NOT NULL,
  cognome     text NOT NULL,
  ruolo       text NOT NULL DEFAULT 'collaboratore' CHECK (ruolo IN ('admin','collaboratore','viewer')),
  avatar_url  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Clienti ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clienti (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  azienda_id      uuid NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
  tipo            text NOT NULL DEFAULT 'azienda' CHECK (tipo IN ('privato','azienda')),
  nome            text NOT NULL,
  cognome         text,
  ragione_sociale text,
  piva            text,
  codice_fiscale  text,
  email           text,
  telefono        text,
  indirizzo       text,
  cap             text,
  citta           text,
  provincia       text,
  codice_sdi      text,
  pec             text,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ── Leads ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  azienda_id      uuid NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
  nome            text NOT NULL,
  cognome         text NOT NULL,
  email           text,
  telefono        text,
  azienda_lead    text,
  fonte           text,
  stato           text NOT NULL DEFAULT 'nuovo' CHECK (stato IN ('nuovo','contattato','qualificato','proposta','perso','convertito')),
  valore_stimato  numeric(12,2),
  note            text,
  assegnato_a     uuid REFERENCES user_profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ── Preventivi ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS preventivi (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  azienda_id  uuid NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
  cliente_id  uuid NOT NULL REFERENCES clienti(id) ON DELETE CASCADE,
  numero      text NOT NULL,
  data        date NOT NULL DEFAULT current_date,
  scadenza    date,
  stato       text NOT NULL DEFAULT 'bozza' CHECK (stato IN ('bozza','inviato','accettato','rifiutato','scaduto')),
  oggetto     text,
  note        text,
  imponibile  numeric(12,2) NOT NULL DEFAULT 0,
  iva         numeric(12,2) NOT NULL DEFAULT 0,
  totale      numeric(12,2) NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Preventivo Righe ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS preventivo_righe (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  preventivo_id    uuid NOT NULL REFERENCES preventivi(id) ON DELETE CASCADE,
  descrizione      text NOT NULL,
  quantita         numeric(10,2) NOT NULL DEFAULT 1,
  prezzo_unitario  numeric(12,2) NOT NULL DEFAULT 0,
  iva_percent      numeric(5,2) NOT NULL DEFAULT 22,
  totale           numeric(12,2) NOT NULL DEFAULT 0,
  ordine           integer NOT NULL DEFAULT 0
);

-- ── Ordini ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ordini (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  azienda_id      uuid NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
  cliente_id      uuid NOT NULL REFERENCES clienti(id) ON DELETE CASCADE,
  preventivo_id   uuid REFERENCES preventivi(id),
  numero          text NOT NULL,
  data            date NOT NULL DEFAULT current_date,
  stato           text NOT NULL DEFAULT 'confermato' CHECK (stato IN ('confermato','in_lavorazione','completato','annullato')),
  imponibile      numeric(12,2) NOT NULL DEFAULT 0,
  iva             numeric(12,2) NOT NULL DEFAULT 0,
  totale          numeric(12,2) NOT NULL DEFAULT 0,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ── Progetti ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS progetti (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  azienda_id           uuid NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
  cliente_id           uuid NOT NULL REFERENCES clienti(id) ON DELETE CASCADE,
  ordine_id            uuid REFERENCES ordini(id),
  nome                 text NOT NULL,
  descrizione          text,
  stato                text NOT NULL DEFAULT 'pianificato' CHECK (stato IN ('pianificato','in_corso','in_pausa','completato','annullato')),
  data_inizio          date,
  data_fine_prevista   date,
  data_fine_effettiva  date,
  budget               numeric(12,2),
  note                 text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- ── Fatture ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fatture (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  azienda_id          uuid NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
  cliente_id          uuid NOT NULL REFERENCES clienti(id) ON DELETE CASCADE,
  ordine_id           uuid REFERENCES ordini(id),
  numero              text NOT NULL,
  data                date NOT NULL DEFAULT current_date,
  scadenza            date,
  stato               text NOT NULL DEFAULT 'bozza' CHECK (stato IN ('bozza','emessa','inviata_sdi','pagata','scaduta','stornata')),
  oggetto             text,
  imponibile          numeric(12,2) NOT NULL DEFAULT 0,
  iva                 numeric(12,2) NOT NULL DEFAULT 0,
  totale              numeric(12,2) NOT NULL DEFAULT 0,
  pagata_il           date,
  metodo_pagamento    text,
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ── Fattura Righe ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fattura_righe (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fattura_id       uuid NOT NULL REFERENCES fatture(id) ON DELETE CASCADE,
  descrizione      text NOT NULL,
  quantita         numeric(10,2) NOT NULL DEFAULT 1,
  prezzo_unitario  numeric(12,2) NOT NULL DEFAULT 0,
  iva_percent      numeric(5,2) NOT NULL DEFAULT 22,
  totale           numeric(12,2) NOT NULL DEFAULT 0,
  ordine           integer NOT NULL DEFAULT 0
);

-- ── Ricorrenti ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ricorrenti (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  azienda_id           uuid NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
  cliente_id           uuid NOT NULL REFERENCES clienti(id) ON DELETE CASCADE,
  descrizione          text NOT NULL,
  importo              numeric(12,2) NOT NULL,
  iva_percent          numeric(5,2) NOT NULL DEFAULT 22,
  frequenza            text NOT NULL DEFAULT 'mensile' CHECK (frequenza IN ('mensile','bimestrale','trimestrale','semestrale','annuale')),
  prossima_emissione   date NOT NULL,
  attivo               boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- ── Fornitori ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fornitori (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  azienda_id       uuid NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
  ragione_sociale  text NOT NULL,
  piva             text,
  email            text,
  telefono         text,
  indirizzo        text,
  cap              text,
  citta            text,
  provincia        text,
  iban             text,
  note             text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ── Fatture Passive ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS fatture_passive (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  azienda_id      uuid NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
  fornitore_id    uuid NOT NULL REFERENCES fornitori(id) ON DELETE CASCADE,
  numero          text NOT NULL,
  data            date NOT NULL DEFAULT current_date,
  scadenza        date,
  stato           text NOT NULL DEFAULT 'da_pagare' CHECK (stato IN ('da_pagare','pagata','contestata')),
  imponibile      numeric(12,2) NOT NULL DEFAULT 0,
  iva             numeric(12,2) NOT NULL DEFAULT 0,
  totale          numeric(12,2) NOT NULL DEFAULT 0,
  pagata_il       date,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ── Conti ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conti (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  azienda_id  uuid NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
  nome        text NOT NULL,
  tipo        text NOT NULL DEFAULT 'banca' CHECK (tipo IN ('banca','cassa','carta')),
  saldo       numeric(14,2) NOT NULL DEFAULT 0,
  iban        text,
  banca       text,
  colore      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Movimenti ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS movimenti (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conto_id            uuid NOT NULL REFERENCES conti(id) ON DELETE CASCADE,
  azienda_id          uuid NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
  tipo                text NOT NULL CHECK (tipo IN ('entrata','uscita','giroconto')),
  categoria           text NOT NULL DEFAULT 'altro' CHECK (categoria IN ('fattura_attiva','fattura_passiva','stipendio','tasse','rimborso','altro')),
  importo             numeric(14,2) NOT NULL,
  descrizione         text,
  data                date NOT NULL DEFAULT current_date,
  fattura_id          uuid REFERENCES fatture(id),
  fattura_passiva_id  uuid REFERENCES fatture_passive(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- ── Rimborsi ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rimborsi (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  azienda_id       uuid NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
  richiedente_id   uuid NOT NULL REFERENCES user_profiles(id),
  descrizione      text NOT NULL,
  importo          numeric(12,2) NOT NULL,
  data_spesa       date NOT NULL,
  categoria        text,
  stato            text NOT NULL DEFAULT 'richiesto' CHECK (stato IN ('richiesto','approvato','rifiutato','rimborsato')),
  allegato_url     text,
  approvato_da     uuid REFERENCES user_profiles(id),
  approvato_il     timestamptz,
  note             text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ── Chat Sessions ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  azienda_id  uuid NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES user_profiles(id),
  titolo      text NOT NULL DEFAULT 'Nuova conversazione',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Chat Messages ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  ruolo       text NOT NULL CHECK (ruolo IN ('user','assistant')),
  contenuto   text NOT NULL,
  tool_calls  jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
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
