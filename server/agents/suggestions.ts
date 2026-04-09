// Rule-based suggestions by domain + tool used (instant, no LLM call)
// ── BERNARDINI S.R.L. ──────────────────────────────────
const TOOL_SUGGESTIONS: Record<string, string[]> = {
  // Commerciale
  get_pipeline: ['Lead caldi in proposta', 'Crea nuovo lead', 'Preventivi aperti', 'Clienti GDO/retail'],
  get_clients: ['Nuovo cliente', 'Pipeline lead', 'Preventivi per cliente', 'Storico ordini'],
  create_lead: ['Pipeline commerciale', 'Stato lead', 'Converti lead'],
  create_client: ['Crea preventivo', 'Pipeline', 'Ordini cliente'],

  // Logistica & Produzione
  get_projects: ['Ordini produzione', 'Pianificazione settimanale', 'Stato magazzino', 'Spedizioni in corso'],
  get_orders: ['Stato spedizioni', 'Crea fattura', 'Avanzamento produzione'],

  // Amministrazione & HR
  get_financial_summary: ['Fatture scadute', 'Saldo conti', 'Cash flow', 'Scadenze F24'],
  get_overdue_invoices: ['Sollecita fattura', 'Riepilogo finanziario', 'Dettaglio cliente'],
  get_bank_accounts: ['Movimenti recenti', 'Cash flow', 'Fatture da pagare'],
  get_passive_invoices: ['Scadenze fornitori', 'Totale da pagare', 'Budget residuo'],
  get_expenses: ['Approva rimborso', 'Spese mensili', 'Per categoria'],
  approve_expense: ['Rimborsi pendenti', 'Riepilogo spese'],
  get_suppliers: ['Fatture passive', 'Dettaglio fornitore'],
  get_candidates: ['In colloquio', 'Nuovo candidato', 'Annunci aperti'],
  get_job_postings: ['Crea annuncio', 'Candidati per posizione'],
  create_candidate: ['Pipeline candidati', 'Annunci aperti'],

  // Contabilita Industriale
  get_dashboard_summary: ['Margini per commessa', 'Scostamenti budget', 'Costi produzione', 'Report CdA'],

  // Officina
  generate_image: ['Genera variante', 'Foto intervento', 'Scheda ricambio'],
  analyze_image: ['Genera immagine simile', 'Analisi componente'],

  // Documentale / Legale
  get_documents: ['Cerca contratto', 'Polizze attive', 'Normative ISO', 'Analizza documento'],
  search_documents: ['Carica documento', 'Per categoria', 'Certificazioni'],

  // WhatsApp
  get_whatsapp_status: ['Invia messaggio', 'Contatti WhatsApp', 'Invia documento', 'Invia vocale'],
  send_whatsapp_message: ['Invia altro messaggio', 'Stato WhatsApp', 'Invia documento'],
  send_whatsapp_voice: ['Invia messaggio testo', 'Stato WhatsApp'],
  send_whatsapp_document: ['Invia altro documento', 'Invia messaggio'],

  // User Management
  get_users: ['Crea nuovo utente', 'Modifica ruolo', 'Utenti WhatsApp'],
  create_user: ['Lista utenti', 'Modifica utente', 'Assegna ruolo'],
  update_user: ['Lista utenti', 'Dettaglio utente'],
  delete_user: ['Lista utenti'],
}

// Domain-level fallback suggestions (when no specific tool match)
// ── Reparti BERNARDINI + Agenti condivisi ──────────────
const DOMAIN_SUGGESTIONS: Record<string, string[]> = {
  direzione: ['Overview aziendale', 'KPI strategici', 'Report CdA', 'Alert e priorita'],
  commerciale: ['Pipeline lead', 'Lista clienti', 'Nuovo lead', 'Preventivi aperti'],
  amministrazione: ['Riepilogo finanziario', 'Fatture scadute', 'Buste paga', 'Scadenze F24'],
  contabilita: ['Margini per commessa', 'Costi produzione', 'Scostamenti budget', 'Analisi costi'],
  produzione: ['Ordini produzione', 'Stato magazzino', 'Spedizioni', 'Pianificazione'],
  officina: ['Ordini lavoro aperti', 'Manutenzione mezzi', 'Ricambi disponibili', 'Interventi programmati'],
  legal: ['Polizze attive', 'Sinistri aperti', 'Scadenze contratti', 'Parco mezzi'],
  qualita: ['Audit programmati', 'Non conformita', 'Formazione sicurezza', 'Certificazioni ISO'],
  documentale: ['Cerca documento', 'Carica documento', 'Per categoria', 'Archivio recente'],
  whatsapp: ['Stato connessione', 'Invia messaggio', 'Contatti', 'Invia documento'],
  it: ['Costi API', 'Gestione utenti', 'Agenti autonomi', 'Diagnostica sistema'],
  doctor: ['Salute sistema', 'Check-up dati', 'Job falliti', 'Diagnostica'],
  tts: ['Genera vocale', 'Leggi documento', 'Cambia voce', 'Invia vocale WhatsApp'],
  general: ['Overview aziendale', 'Lista clienti', 'Fatturato', 'Reparti Bernardini'],
}

export function getSuggestions(domain: string, toolsUsed: string[]): string[] {
  // Try tool-specific suggestions first
  for (const tool of [...toolsUsed].reverse()) { // most recent tool first
    const suggestions = TOOL_SUGGESTIONS[tool]
    if (suggestions) return suggestions.slice(0, 4)
  }

  // Fallback to domain-level
  return (DOMAIN_SUGGESTIONS[domain] || DOMAIN_SUGGESTIONS.general).slice(0, 4)
}
