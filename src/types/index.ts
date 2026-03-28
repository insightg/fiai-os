// ── Azienda ──────────────────────────────────────────────
export interface Azienda {
  id: string
  nome: string
  piva: string
  codice_sdi: string | null
  pec: string | null
  indirizzo: string | null
  cap: string | null
  citta: string | null
  provincia: string | null
  email: string | null
  telefono: string | null
  iban: string | null
  banca: string | null
  logo_url: string | null
  created_at: string
  updated_at: string
}

// ── User ─────────────────────────────────────────────────
export interface UserProfile {
  id: string
  azienda_id: string
  email: string
  nome: string
  cognome: string
  ruolo: 'admin' | 'collaboratore' | 'viewer'
  avatar_url: string | null
  created_at: string
}

// ── CRM ──────────────────────────────────────────────────
export type LeadStato = 'nuovo' | 'contattato' | 'qualificato' | 'proposta' | 'perso' | 'convertito'

export interface Lead {
  id: string
  azienda_id: string
  nome: string
  cognome: string
  email: string | null
  telefono: string | null
  azienda_lead: string | null
  fonte: string | null
  stato: LeadStato
  valore_stimato: number | null
  note: string | null
  assegnato_a: string | null
  created_at: string
  updated_at: string
}

export interface Cliente {
  id: string
  azienda_id: string
  tipo: 'privato' | 'azienda'
  nome: string
  cognome: string | null
  ragione_sociale: string | null
  piva: string | null
  codice_fiscale: string | null
  email: string | null
  telefono: string | null
  indirizzo: string | null
  cap: string | null
  citta: string | null
  provincia: string | null
  codice_sdi: string | null
  pec: string | null
  note: string | null
  created_at: string
  updated_at: string
}

// ── Preventivi ───────────────────────────────────────────
export type PreventivoStato = 'bozza' | 'inviato' | 'accettato' | 'rifiutato' | 'scaduto'

export interface Preventivo {
  id: string
  azienda_id: string
  cliente_id: string
  numero: string
  data: string
  scadenza: string | null
  stato: PreventivoStato
  oggetto: string | null
  note: string | null
  imponibile: number
  iva: number
  totale: number
  created_at: string
  updated_at: string
  cliente?: Cliente
  righe?: PreventivoRiga[]
}

export interface PreventivoRiga {
  id: string
  preventivo_id: string
  descrizione: string
  quantita: number
  prezzo_unitario: number
  iva_percent: number
  totale: number
  ordine: number
}

// ── Ordini ───────────────────────────────────────────────
export type OrdineStato = 'confermato' | 'in_lavorazione' | 'completato' | 'annullato'

export interface Ordine {
  id: string
  azienda_id: string
  cliente_id: string
  preventivo_id: string | null
  numero: string
  data: string
  stato: OrdineStato
  imponibile: number
  iva: number
  totale: number
  note: string | null
  created_at: string
  updated_at: string
  cliente?: Cliente
}

// ── Progetti ─────────────────────────────────────────────
export type ProgettoStato = 'pianificato' | 'in_corso' | 'in_pausa' | 'completato' | 'annullato'

export interface Progetto {
  id: string
  azienda_id: string
  cliente_id: string
  ordine_id: string | null
  nome: string
  descrizione: string | null
  stato: ProgettoStato
  data_inizio: string | null
  data_fine_prevista: string | null
  data_fine_effettiva: string | null
  budget: number | null
  note: string | null
  created_at: string
  updated_at: string
  cliente?: Cliente
}

// ── Fatture ──────────────────────────────────────────────
export type FatturaStato = 'bozza' | 'emessa' | 'inviata_sdi' | 'pagata' | 'scaduta' | 'stornata'

export interface Fattura {
  id: string
  azienda_id: string
  cliente_id: string
  ordine_id: string | null
  numero: string
  data: string
  scadenza: string | null
  stato: FatturaStato
  oggetto: string | null
  imponibile: number
  iva: number
  totale: number
  pagata_il: string | null
  metodo_pagamento: string | null
  note: string | null
  created_at: string
  updated_at: string
  cliente?: Cliente
  righe?: FatturaRiga[]
}

export interface FatturaRiga {
  id: string
  fattura_id: string
  descrizione: string
  quantita: number
  prezzo_unitario: number
  iva_percent: number
  totale: number
  ordine: number
}

// ── Ricorrenti ───────────────────────────────────────────
export type FrequenzaRicorrente = 'mensile' | 'bimestrale' | 'trimestrale' | 'semestrale' | 'annuale'

export interface Ricorrente {
  id: string
  azienda_id: string
  cliente_id: string
  descrizione: string
  importo: number
  iva_percent: number
  frequenza: FrequenzaRicorrente
  prossima_emissione: string
  attivo: boolean
  created_at: string
  updated_at: string
  cliente?: Cliente
}

// ── Fornitori & Fatture Passive ──────────────────────────
export interface Fornitore {
  id: string
  azienda_id: string
  ragione_sociale: string
  piva: string | null
  email: string | null
  telefono: string | null
  indirizzo: string | null
  cap: string | null
  citta: string | null
  provincia: string | null
  iban: string | null
  note: string | null
  created_at: string
  updated_at: string
}

export type FatturaPassivaStato = 'da_pagare' | 'pagata' | 'contestata'

export interface FatturaPassiva {
  id: string
  azienda_id: string
  fornitore_id: string
  numero: string
  data: string
  scadenza: string | null
  stato: FatturaPassivaStato
  imponibile: number
  iva: number
  totale: number
  pagata_il: string | null
  note: string | null
  file_url: string | null
  created_at: string
  updated_at: string
  fornitore?: Fornitore
}

// ── Conti & Movimenti ────────────────────────────────────
export type TipoConto = 'banca' | 'cassa' | 'carta'

export interface Conto {
  id: string
  azienda_id: string
  nome: string
  tipo: TipoConto
  saldo: number
  iban: string | null
  banca: string | null
  colore: string | null
  created_at: string
  updated_at: string
}

export type TipoMovimento = 'entrata' | 'uscita' | 'giroconto'
export type CategoriaMovimento =
  | 'fattura_attiva'
  | 'fattura_passiva'
  | 'stipendio'
  | 'tasse'
  | 'rimborso'
  | 'altro'

export interface Movimento {
  id: string
  conto_id: string
  azienda_id: string
  tipo: TipoMovimento
  categoria: CategoriaMovimento
  importo: number
  descrizione: string | null
  data: string
  fattura_id: string | null
  fattura_passiva_id: string | null
  created_at: string
}

// ── Rimborsi ─────────────────────────────────────────────
export type RimborsoStato = 'richiesto' | 'approvato' | 'rifiutato' | 'rimborsato'

export interface Rimborso {
  id: string
  azienda_id: string
  richiedente_id: string
  descrizione: string
  importo: number
  data_spesa: string
  categoria: string | null
  stato: RimborsoStato
  allegato_url: string | null
  approvato_da: string | null
  approvato_il: string | null
  note: string | null
  created_at: string
  updated_at: string
}

// ── HR — Candidati ──────────────────────────────────────
export type CandidatoStato = 'nuovo' | 'screening' | 'colloquio' | 'offerta' | 'assunto' | 'scartato'

export interface Candidato {
  id: string
  azienda_id: string
  nome: string
  cognome: string
  email: string | null
  telefono: string | null
  ruolo_candidato: string | null
  stato: CandidatoStato
  cv_url: string | null
  note: string | null
  valutazione: number | null
  fonte: string | null
  data_candidatura: string
  created_at: string
  updated_at: string
}

// ── HR — Annunci Lavoro ─────────────────────────────────
export type AnnuncioLavoroStato = 'bozza' | 'pubblicato' | 'chiuso'

export interface AnnuncioLavoro {
  id: string
  azienda_id: string
  ruolo: string
  competenze: string | null
  tipo_contratto: string | null
  sede: string | null
  ral_min: number | null
  ral_max: number | null
  contenuto: string
  stato: AnnuncioLavoroStato
  created_at: string
  updated_at: string
}

// ── HR — Simulatore Costo ───────────────────────────────
export interface CostoSimulazioneInput {
  netto_desiderato: number
  tipo_contratto: 'indeterminato' | 'determinato' | 'apprendistato'
  livello_ccnl: string
  regione: string
  part_time_percent: number
}

export interface CostoSimulazioneResult {
  ral: number
  netto_mensile: number
  contributi_inps_dipendente: number
  contributi_inps_azienda: number
  inail: number
  tfr_annuo: number
  irap: number
  irpef: number
  addizionale_regionale: number
  addizionale_comunale: number
  costo_totale_azienda: number
  spiegazione: string
}

// ── Documenti ───────────────────────────────────────────
export type DocumentoCategoria = 'legale' | 'pubblicita' | 'documentazione_tecnica' | 'normative' | 'atti' | 'contratti' | 'altro'

export interface Documento {
  id: string
  azienda_id: string
  nome: string
  tipo_file: string
  categoria: DocumentoCategoria
  descrizione: string | null
  file_url: string
  file_size: number | null
  tags: string[] | null
  contenuto_testo: string | null
  uploaded_by: string | null
  created_at: string
  updated_at: string
}

// ── Invoice Recognition ─────────────────────────────────
export interface InvoiceRecognitionResult {
  numero_fattura: string
  data: string
  scadenza: string | null
  imponibile: number
  iva: number
  totale: number
  fornitore_ragione_sociale: string
  fornitore_piva: string | null
}

// ── AI Chat ──────────────────────────────────────────────
export interface ChatSession {
  id: string
  azienda_id: string
  user_id: string
  titolo: string
  created_at: string
  updated_at: string
}

export type ChatRole = 'user' | 'assistant'

export interface ChatMessage {
  id: string
  session_id: string
  ruolo: ChatRole
  contenuto: string
  tool_calls: Record<string, unknown>[] | null
  created_at: string
}
