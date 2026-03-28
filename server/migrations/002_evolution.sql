-- ═══════════════════════════════════════════════════════
-- FIAI OS — Evolution Migration 002
-- ═══════════════════════════════════════════════════════

-- Add file_url column to fatture_passive
ALTER TABLE fatture_passive ADD COLUMN IF NOT EXISTS file_url text;

-- ── Candidati ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS candidati (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  azienda_id        uuid NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
  nome              text NOT NULL,
  cognome           text NOT NULL,
  email             text,
  telefono          text,
  ruolo_candidato   text,
  stato             text NOT NULL DEFAULT 'nuovo'
                    CHECK (stato IN ('nuovo','screening','colloquio','offerta','assunto','scartato')),
  cv_url            text,
  note              text,
  valutazione       integer CHECK (valutazione IS NULL OR (valutazione >= 1 AND valutazione <= 5)),
  fonte             text,
  data_candidatura  date NOT NULL DEFAULT current_date,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ── Annunci di Lavoro ──────────────────────────────────
CREATE TABLE IF NOT EXISTS annunci_lavoro (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  azienda_id        uuid NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
  ruolo             text NOT NULL,
  competenze        text,
  tipo_contratto    text,
  sede              text,
  ral_min           numeric(12,2),
  ral_max           numeric(12,2),
  contenuto         text NOT NULL,
  stato             text NOT NULL DEFAULT 'bozza'
                    CHECK (stato IN ('bozza','pubblicato','chiuso')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ── Documenti ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documenti (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  azienda_id      uuid NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
  nome            text NOT NULL,
  tipo_file       text NOT NULL,
  categoria       text NOT NULL DEFAULT 'altro'
                  CHECK (categoria IN ('legale','pubblicita','documentazione_tecnica','normative','atti','contratti','altro')),
  descrizione     text,
  file_url        text NOT NULL,
  file_size       bigint,
  tags            text[],
  contenuto_testo text,
  uploaded_by     uuid REFERENCES user_profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_candidati_azienda ON candidati(azienda_id);
CREATE INDEX IF NOT EXISTS idx_candidati_stato ON candidati(stato);
CREATE INDEX IF NOT EXISTS idx_annunci_lavoro_azienda ON annunci_lavoro(azienda_id);
CREATE INDEX IF NOT EXISTS idx_documenti_azienda ON documenti(azienda_id);
CREATE INDEX IF NOT EXISTS idx_documenti_categoria ON documenti(categoria);
CREATE INDEX IF NOT EXISTS idx_documenti_tags ON documenti USING gin(tags);

-- Full-text search index on document content (Italian)
CREATE INDEX IF NOT EXISTS idx_documenti_contenuto_fts
  ON documenti USING gin(to_tsvector('italian', COALESCE(nome, '') || ' ' || COALESCE(descrizione, '') || ' ' || COALESCE(contenuto_testo, '')));
