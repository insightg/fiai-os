-- ══════════════════════════════════════════════════════════
-- FIAI OS — Database Schema
-- ══════════════════════════════════════════════════════════

-- Extensions
create extension if not exists "uuid-ossp";

-- ── Aziende ──────────────────────────────────────────────
create table aziende (
  id          uuid primary key default uuid_generate_v4(),
  nome        text not null,
  piva        text not null,
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
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table aziende enable row level security;

create policy "aziende_select" on aziende for select to authenticated
  using (id in (select azienda_id from user_profiles where id = auth.uid()));
create policy "aziende_update" on aziende for update to authenticated
  using (id in (select azienda_id from user_profiles where id = auth.uid()));

-- ── User Profiles ────────────────────────────────────────
create table user_profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  azienda_id  uuid not null references aziende(id) on delete cascade,
  email       text not null,
  nome        text not null,
  cognome     text not null,
  ruolo       text not null default 'collaboratore' check (ruolo in ('admin','collaboratore','viewer')),
  avatar_url  text,
  created_at  timestamptz not null default now()
);

alter table user_profiles enable row level security;

create policy "profiles_select" on user_profiles for select to authenticated
  using (azienda_id in (select azienda_id from user_profiles where id = auth.uid()));
create policy "profiles_update" on user_profiles for update to authenticated
  using (id = auth.uid());

-- ── Clienti ──────────────────────────────────────────────
create table clienti (
  id              uuid primary key default uuid_generate_v4(),
  azienda_id      uuid not null references aziende(id) on delete cascade,
  tipo            text not null default 'azienda' check (tipo in ('privato','azienda')),
  nome            text not null,
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
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table clienti enable row level security;

create policy "clienti_all" on clienti for all to authenticated
  using (azienda_id in (select azienda_id from user_profiles where id = auth.uid()))
  with check (azienda_id in (select azienda_id from user_profiles where id = auth.uid()));

-- ── Leads ────────────────────────────────────────────────
create table leads (
  id              uuid primary key default uuid_generate_v4(),
  azienda_id      uuid not null references aziende(id) on delete cascade,
  nome            text not null,
  cognome         text not null,
  email           text,
  telefono        text,
  azienda_lead    text,
  fonte           text,
  stato           text not null default 'nuovo' check (stato in ('nuovo','contattato','qualificato','proposta','perso','convertito')),
  valore_stimato  numeric(12,2),
  note            text,
  assegnato_a     uuid references user_profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table leads enable row level security;

create policy "leads_all" on leads for all to authenticated
  using (azienda_id in (select azienda_id from user_profiles where id = auth.uid()))
  with check (azienda_id in (select azienda_id from user_profiles where id = auth.uid()));

-- ── Preventivi ───────────────────────────────────────────
create table preventivi (
  id          uuid primary key default uuid_generate_v4(),
  azienda_id  uuid not null references aziende(id) on delete cascade,
  cliente_id  uuid not null references clienti(id) on delete cascade,
  numero      text not null,
  data        date not null default current_date,
  scadenza    date,
  stato       text not null default 'bozza' check (stato in ('bozza','inviato','accettato','rifiutato','scaduto')),
  oggetto     text,
  note        text,
  imponibile  numeric(12,2) not null default 0,
  iva         numeric(12,2) not null default 0,
  totale      numeric(12,2) not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table preventivi enable row level security;

create policy "preventivi_all" on preventivi for all to authenticated
  using (azienda_id in (select azienda_id from user_profiles where id = auth.uid()))
  with check (azienda_id in (select azienda_id from user_profiles where id = auth.uid()));

-- ── Preventivo Righe ─────────────────────────────────────
create table preventivo_righe (
  id               uuid primary key default uuid_generate_v4(),
  preventivo_id    uuid not null references preventivi(id) on delete cascade,
  descrizione      text not null,
  quantita         numeric(10,2) not null default 1,
  prezzo_unitario  numeric(12,2) not null default 0,
  iva_percent      numeric(5,2) not null default 22,
  totale           numeric(12,2) not null default 0,
  ordine           integer not null default 0
);

alter table preventivo_righe enable row level security;

create policy "prev_righe_all" on preventivo_righe for all to authenticated
  using (preventivo_id in (select id from preventivi where azienda_id in (select azienda_id from user_profiles where id = auth.uid())))
  with check (preventivo_id in (select id from preventivi where azienda_id in (select azienda_id from user_profiles where id = auth.uid())));

-- ── Ordini ───────────────────────────────────────────────
create table ordini (
  id              uuid primary key default uuid_generate_v4(),
  azienda_id      uuid not null references aziende(id) on delete cascade,
  cliente_id      uuid not null references clienti(id) on delete cascade,
  preventivo_id   uuid references preventivi(id),
  numero          text not null,
  data            date not null default current_date,
  stato           text not null default 'confermato' check (stato in ('confermato','in_lavorazione','completato','annullato')),
  imponibile      numeric(12,2) not null default 0,
  iva             numeric(12,2) not null default 0,
  totale          numeric(12,2) not null default 0,
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table ordini enable row level security;

create policy "ordini_all" on ordini for all to authenticated
  using (azienda_id in (select azienda_id from user_profiles where id = auth.uid()))
  with check (azienda_id in (select azienda_id from user_profiles where id = auth.uid()));

-- ── Progetti ─────────────────────────────────────────────
create table progetti (
  id                   uuid primary key default uuid_generate_v4(),
  azienda_id           uuid not null references aziende(id) on delete cascade,
  cliente_id           uuid not null references clienti(id) on delete cascade,
  ordine_id            uuid references ordini(id),
  nome                 text not null,
  descrizione          text,
  stato                text not null default 'pianificato' check (stato in ('pianificato','in_corso','in_pausa','completato','annullato')),
  data_inizio          date,
  data_fine_prevista   date,
  data_fine_effettiva  date,
  budget               numeric(12,2),
  note                 text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

alter table progetti enable row level security;

create policy "progetti_all" on progetti for all to authenticated
  using (azienda_id in (select azienda_id from user_profiles where id = auth.uid()))
  with check (azienda_id in (select azienda_id from user_profiles where id = auth.uid()));

-- ── Fatture ──────────────────────────────────────────────
create table fatture (
  id                  uuid primary key default uuid_generate_v4(),
  azienda_id          uuid not null references aziende(id) on delete cascade,
  cliente_id          uuid not null references clienti(id) on delete cascade,
  ordine_id           uuid references ordini(id),
  numero              text not null,
  data                date not null default current_date,
  scadenza            date,
  stato               text not null default 'bozza' check (stato in ('bozza','emessa','inviata_sdi','pagata','scaduta','stornata')),
  oggetto             text,
  imponibile          numeric(12,2) not null default 0,
  iva                 numeric(12,2) not null default 0,
  totale              numeric(12,2) not null default 0,
  pagata_il           date,
  metodo_pagamento    text,
  note                text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table fatture enable row level security;

create policy "fatture_all" on fatture for all to authenticated
  using (azienda_id in (select azienda_id from user_profiles where id = auth.uid()))
  with check (azienda_id in (select azienda_id from user_profiles where id = auth.uid()));

-- ── Fattura Righe ────────────────────────────────────────
create table fattura_righe (
  id               uuid primary key default uuid_generate_v4(),
  fattura_id       uuid not null references fatture(id) on delete cascade,
  descrizione      text not null,
  quantita         numeric(10,2) not null default 1,
  prezzo_unitario  numeric(12,2) not null default 0,
  iva_percent      numeric(5,2) not null default 22,
  totale           numeric(12,2) not null default 0,
  ordine           integer not null default 0
);

alter table fattura_righe enable row level security;

create policy "fatt_righe_all" on fattura_righe for all to authenticated
  using (fattura_id in (select id from fatture where azienda_id in (select azienda_id from user_profiles where id = auth.uid())))
  with check (fattura_id in (select id from fatture where azienda_id in (select azienda_id from user_profiles where id = auth.uid())));

-- ── Ricorrenti ───────────────────────────────────────────
create table ricorrenti (
  id                   uuid primary key default uuid_generate_v4(),
  azienda_id           uuid not null references aziende(id) on delete cascade,
  cliente_id           uuid not null references clienti(id) on delete cascade,
  descrizione          text not null,
  importo              numeric(12,2) not null,
  iva_percent          numeric(5,2) not null default 22,
  frequenza            text not null default 'mensile' check (frequenza in ('mensile','bimestrale','trimestrale','semestrale','annuale')),
  prossima_emissione   date not null,
  attivo               boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

alter table ricorrenti enable row level security;

create policy "ricorrenti_all" on ricorrenti for all to authenticated
  using (azienda_id in (select azienda_id from user_profiles where id = auth.uid()))
  with check (azienda_id in (select azienda_id from user_profiles where id = auth.uid()));

-- ── Fornitori ────────────────────────────────────────────
create table fornitori (
  id               uuid primary key default uuid_generate_v4(),
  azienda_id       uuid not null references aziende(id) on delete cascade,
  ragione_sociale  text not null,
  piva             text,
  email            text,
  telefono         text,
  indirizzo        text,
  cap              text,
  citta            text,
  provincia        text,
  iban             text,
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table fornitori enable row level security;

create policy "fornitori_all" on fornitori for all to authenticated
  using (azienda_id in (select azienda_id from user_profiles where id = auth.uid()))
  with check (azienda_id in (select azienda_id from user_profiles where id = auth.uid()));

-- ── Fatture Passive ──────────────────────────────────────
create table fatture_passive (
  id              uuid primary key default uuid_generate_v4(),
  azienda_id      uuid not null references aziende(id) on delete cascade,
  fornitore_id    uuid not null references fornitori(id) on delete cascade,
  numero          text not null,
  data            date not null default current_date,
  scadenza        date,
  stato           text not null default 'da_pagare' check (stato in ('da_pagare','pagata','contestata')),
  imponibile      numeric(12,2) not null default 0,
  iva             numeric(12,2) not null default 0,
  totale          numeric(12,2) not null default 0,
  pagata_il       date,
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table fatture_passive enable row level security;

create policy "fatt_passive_all" on fatture_passive for all to authenticated
  using (azienda_id in (select azienda_id from user_profiles where id = auth.uid()))
  with check (azienda_id in (select azienda_id from user_profiles where id = auth.uid()));

-- ── Conti ────────────────────────────────────────────────
create table conti (
  id          uuid primary key default uuid_generate_v4(),
  azienda_id  uuid not null references aziende(id) on delete cascade,
  nome        text not null,
  tipo        text not null default 'banca' check (tipo in ('banca','cassa','carta')),
  saldo       numeric(14,2) not null default 0,
  iban        text,
  banca       text,
  colore      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table conti enable row level security;

create policy "conti_all" on conti for all to authenticated
  using (azienda_id in (select azienda_id from user_profiles where id = auth.uid()))
  with check (azienda_id in (select azienda_id from user_profiles where id = auth.uid()));

-- ── Movimenti ────────────────────────────────────────────
create table movimenti (
  id                  uuid primary key default uuid_generate_v4(),
  conto_id            uuid not null references conti(id) on delete cascade,
  azienda_id          uuid not null references aziende(id) on delete cascade,
  tipo                text not null check (tipo in ('entrata','uscita','giroconto')),
  categoria           text not null default 'altro' check (categoria in ('fattura_attiva','fattura_passiva','stipendio','tasse','rimborso','altro')),
  importo             numeric(14,2) not null,
  descrizione         text,
  data                date not null default current_date,
  fattura_id          uuid references fatture(id),
  fattura_passiva_id  uuid references fatture_passive(id),
  created_at          timestamptz not null default now()
);

alter table movimenti enable row level security;

create policy "movimenti_all" on movimenti for all to authenticated
  using (azienda_id in (select azienda_id from user_profiles where id = auth.uid()))
  with check (azienda_id in (select azienda_id from user_profiles where id = auth.uid()));

-- ── Rimborsi ─────────────────────────────────────────────
create table rimborsi (
  id               uuid primary key default uuid_generate_v4(),
  azienda_id       uuid not null references aziende(id) on delete cascade,
  richiedente_id   uuid not null references user_profiles(id),
  descrizione      text not null,
  importo          numeric(12,2) not null,
  data_spesa       date not null,
  categoria        text,
  stato            text not null default 'richiesto' check (stato in ('richiesto','approvato','rifiutato','rimborsato')),
  allegato_url     text,
  approvato_da     uuid references user_profiles(id),
  approvato_il     timestamptz,
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table rimborsi enable row level security;

create policy "rimborsi_all" on rimborsi for all to authenticated
  using (azienda_id in (select azienda_id from user_profiles where id = auth.uid()))
  with check (azienda_id in (select azienda_id from user_profiles where id = auth.uid()));

-- ── Chat Sessions ────────────────────────────────────────
create table chat_sessions (
  id          uuid primary key default uuid_generate_v4(),
  azienda_id  uuid not null references aziende(id) on delete cascade,
  user_id     uuid not null references user_profiles(id),
  titolo      text not null default 'Nuova conversazione',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table chat_sessions enable row level security;

create policy "chat_sessions_all" on chat_sessions for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── Chat Messages ────────────────────────────────────────
create table chat_messages (
  id          uuid primary key default uuid_generate_v4(),
  session_id  uuid not null references chat_sessions(id) on delete cascade,
  ruolo       text not null check (ruolo in ('user','assistant')),
  contenuto   text not null,
  tool_calls  jsonb,
  created_at  timestamptz not null default now()
);

alter table chat_messages enable row level security;

create policy "chat_messages_all" on chat_messages for all to authenticated
  using (session_id in (select id from chat_sessions where user_id = auth.uid()))
  with check (session_id in (select id from chat_sessions where user_id = auth.uid()));

-- ── Indexes ──────────────────────────────────────────────
create index idx_leads_azienda on leads(azienda_id);
create index idx_clienti_azienda on clienti(azienda_id);
create index idx_preventivi_azienda on preventivi(azienda_id);
create index idx_preventivi_cliente on preventivi(cliente_id);
create index idx_ordini_azienda on ordini(azienda_id);
create index idx_progetti_azienda on progetti(azienda_id);
create index idx_fatture_azienda on fatture(azienda_id);
create index idx_fatture_cliente on fatture(cliente_id);
create index idx_fatture_passive_azienda on fatture_passive(azienda_id);
create index idx_fornitori_azienda on fornitori(azienda_id);
create index idx_conti_azienda on conti(azienda_id);
create index idx_movimenti_conto on movimenti(conto_id);
create index idx_movimenti_azienda on movimenti(azienda_id);
create index idx_rimborsi_azienda on rimborsi(azienda_id);
create index idx_chat_sessions_user on chat_sessions(user_id);
create index idx_chat_messages_session on chat_messages(session_id);
