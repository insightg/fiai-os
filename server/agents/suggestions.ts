// Rule-based suggestions by domain + tool used (instant, no LLM call)
const TOOL_SUGGESTIONS: Record<string, string[]> = {
  // Pulse
  get_dashboard_summary: ['Fatturato del mese', 'Pipeline commerciale', 'Progetti attivi', 'Alert e scadenze'],

  // Commerciale
  get_pipeline: ['Lead caldi in proposta', 'Crea nuovo lead', 'Brief pre-call', 'Preventivi aperti'],
  get_clients: ['Nuovo cliente', 'Pipeline lead', 'Preventivi per cliente', 'Storico ordini'],
  create_lead: ['Pipeline commerciale', 'Stato lead', 'Converti lead'],
  create_client: ['Crea preventivo', 'Pipeline', 'Assegna progetto'],

  // Produzione
  get_projects: ['Milestone prossime', 'Rischi progetto', 'Budget vs speso', 'Ordini in corso'],
  get_orders: ['Stato progetti', 'Crea fattura', 'Avanzamento delivery'],

  // Marketing
  generate_image: ['Genera variante', 'Crea post LinkedIn', 'Score lead'],
  analyze_image: ['Genera immagine simile', 'Crea contenuto testuale'],

  // Amministrazione
  get_financial_summary: ['Fatture scadute', 'Saldo conti', 'Cash flow', 'Scadenze fiscali'],
  get_overdue_invoices: ['Sollecita fattura', 'Riepilogo finanziario', 'Dettaglio cliente'],
  get_bank_accounts: ['Movimenti recenti', 'Cash flow', 'Fatture da pagare'],
  get_passive_invoices: ['Scadenze fornitori', 'Totale da pagare', 'Budget residuo'],
  get_expenses: ['Approva rimborso', 'Spese mensili', 'Per categoria'],
  approve_expense: ['Rimborsi pendenti', 'Riepilogo spese'],
  get_suppliers: ['Fatture passive', 'Dettaglio fornitore'],

  // HR
  get_candidates: ['In colloquio', 'Nuovo candidato', 'Annunci aperti'],
  get_job_postings: ['Crea annuncio', 'Candidati per posizione'],
  create_candidate: ['Pipeline candidati', 'Annunci aperti'],

  // Documents/Legal
  get_documents: ['Cerca contratto', 'Normative recenti', 'Analizza documento'],
  search_documents: ['Carica documento', 'Per categoria'],

  // User Management
  get_users: ['Crea nuovo utente', 'Modifica ruolo', 'Utenti WhatsApp'],
  create_user: ['Lista utenti', 'Modifica utente', 'Assegna ruolo'],
  update_user: ['Lista utenti', 'Dettaglio utente'],
  delete_user: ['Lista utenti'],
}

// Domain-level fallback suggestions (when no specific tool match)
const DOMAIN_SUGGESTIONS: Record<string, string[]> = {
  pulse: ['Overview aziendale', 'Daily brief', 'Alert e priorita', 'Stato generale'],
  commerciale: ['Pipeline lead', 'Lista clienti', 'Nuovo lead', 'Brief pre-call'],
  produzione: ['Progetti attivi', 'Milestone prossime', 'Rischi', 'Ordini in corso'],
  marketing: ['Genera immagine', 'Crea post', 'Score lead', 'Contenuti campagna'],
  amministrazione: ['Riepilogo finanziario', 'Fatture scadute', 'Saldo conti', 'Rimborsi'],
  hr: ['Candidati attivi', 'Annunci lavoro', 'Simula costo', 'Screening CV'],
  legal: ['Cerca contratto', 'Analizza clausole', 'Normative', 'Scadenze contratti'],
  it: ['Costi API', 'Gestione utenti', 'Agenti autonomi', 'Workflow'],
  doctor: ['Salute sistema', 'Check-up dati', 'Job falliti', 'Diagnostica'],
  general: ['Overview aziendale', 'Lista clienti', 'Fatturato', 'Progetti attivi'],
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
