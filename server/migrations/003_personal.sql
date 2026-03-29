-- ═══════════════════════════════════════════════════════
-- FIAI OS — Personal Workspace Migration 003
-- ═══════════════════════════════════════════════════════

-- Personal notes/tasks (Trello-like)
CREATE TABLE IF NOT EXISTS note_boards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  nome text NOT NULL DEFAULT 'La mia board',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS note_columns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES note_boards(id) ON DELETE CASCADE,
  nome text NOT NULL,
  ordine integer NOT NULL DEFAULT 0,
  colore text DEFAULT '#C41E3A',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS note_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  column_id uuid NOT NULL REFERENCES note_columns(id) ON DELETE CASCADE,
  titolo text NOT NULL,
  contenuto text,
  colore text,
  priorita text DEFAULT 'media' CHECK (priorita IN ('bassa','media','alta','urgente')),
  scadenza date,
  completata boolean DEFAULT false,
  ordine integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Calendar events
CREATE TABLE IF NOT EXISTS eventi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  titolo text NOT NULL,
  descrizione text,
  data_inizio timestamptz NOT NULL,
  data_fine timestamptz,
  tutto_il_giorno boolean DEFAULT false,
  colore text DEFAULT '#C41E3A',
  tipo text DEFAULT 'evento' CHECK (tipo IN ('evento','riunione','scadenza','promemoria')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_note_boards_user ON note_boards(user_id);
CREATE INDEX IF NOT EXISTS idx_note_columns_board ON note_columns(board_id);
CREATE INDEX IF NOT EXISTS idx_note_cards_column ON note_cards(column_id);
CREATE INDEX IF NOT EXISTS idx_eventi_user ON eventi(user_id);
CREATE INDEX IF NOT EXISTS idx_eventi_data ON eventi(data_inizio);
