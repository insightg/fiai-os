// ══════════════════════════════════════════════════════════
// FIAI OS Types — Unified VFS Entity Model
// ══════════════════════════════════════════════════════════

// ── User ─────────────────────────────────────────────────
export interface UserProfile {
  id: string
  azienda_id: string
  email: string
  nome: string
  cognome: string
  ruolo: 'admin' | 'collaboratore' | 'viewer'
  avatar_url: string | null
  whatsapp_phone: string | null
  whatsapp_active: boolean
  tts_voice?: string
  created_at: string
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

// ── AI Chat ──────────────────────────────────────────────
export interface ChatSession {
  id: string
  azienda_id: string
  user_id: string
  titolo: string
  channel?: string
  agent_domain?: string
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
  agent_domain?: string
  agent_name?: string
  created_at: string
}

// ══════════════════════════════════════════════════════════
// VFS — Virtual Filesystem Types (unified entity model)
// ══════════════════════════════════════════════════════════

export interface Entity {
  id: string
  azienda_id: string
  type: string
  display_name: string
  slug: string
  stato: string | null
  email: string | null
  telefono: string | null
  tags: string[] | null
  piva: string | null
  categoria: string | null
  body: string | null
  name_id: string | null
  parent_id: string | null
  user_id: string | null
  file_url: string | null
  numero: string | null
  data: string | null
  totale: number | null
  metadata: Record<string, unknown>
  path: string
  ordine: number
  created_at: string
  updated_at: string
}

export interface Relation {
  id: string
  azienda_id: string | null
  from_id: string
  to_id: string
  tipo: string
  metadata?: Record<string, unknown>
  created_at: string
}

// ── Layout Descriptor for Dynamic UI ─────────────────────

export interface LayoutColumn {
  key: string
  label: string
  type?: 'text' | 'number' | 'currency' | 'date' | 'badge' | 'email' | 'phone' | 'tags' | 'percent'
  width?: string
}

export interface LayoutField {
  key: string
  label: string
  type?: 'text' | 'email' | 'phone' | 'number' | 'currency' | 'date' | 'select' | 'textarea' | 'tags' | 'file'
  required?: boolean
  options?: { value: string; label: string }[]
  placeholder?: string
  defaultValue?: unknown
}

export interface LayoutDescriptor {
  view: 'list' | 'kanban' | 'detail' | 'form' | 'chart' | 'calendar' | 'grid' | 'tree'
  title: string
  source?: {
    table: 'names' | 'entity'
    type?: string
    tags?: string[]
    filters?: Record<string, unknown>
    sort?: string
    limit?: number
  }
  columns?: LayoutColumn[]
  kanban?: {
    groupBy: string
    groups: { value: string; label: string; color: string }[]
    cardTitle: string
    cardSubtitle?: string
    cardValue?: string
  }
  sections?: { title: string; fields: { key: string; label: string; type?: string }[] }[]
  tabs?: { id: string; label: string; source: { table: string; type?: string; filters?: Record<string, unknown> }; columns?: LayoutColumn[] }[]
  fields?: LayoutField[]
  chart?: {
    type: 'bar' | 'pie' | 'line' | 'donut'
    data: { label: string; value: number; color?: string }[]
  }
  calendar?: { dateField: string; endDateField?: string; titleField: string; colorField?: string }
  actions?: ('create' | 'edit' | 'delete' | 'export' | 'convert' | 'relate')[]
  createForm?: { fields: LayoutField[] }
  editForm?: { fields: LayoutField[] }
  data?: unknown[]
}
