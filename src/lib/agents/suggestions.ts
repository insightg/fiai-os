// Rule-based suggestions by domain + tool used (instant, no LLM call)
const TOOL_SUGGESTIONS: Record<string, string[]> = {
  // Finance
  get_financial_summary: ['Fatture scadute', 'Saldo conti bancari', 'Confronto mese precedente', 'Cash flow previsionale'],
  get_overdue_invoices: ['Sollecita fattura', 'Riepilogo finanziario', 'Dettaglio per cliente'],
  get_bank_accounts: ['Movimenti recenti', 'Riepilogo finanziario', 'Fatture da pagare'],
  get_passive_invoices: ['Scadenze prossime', 'Totale da pagare', 'Fornitori principali'],
  get_expenses: ['Approva rimborso', 'Riepilogo spese mensili', 'Dettaglio per categoria'],
  approve_expense: ['Lista rimborsi pendenti', 'Riepilogo spese', 'Budget residuo'],

  // CRM
  get_pipeline: ['Lead caldi in proposta', 'Crea nuovo lead', 'Converti lead in cliente'],
  get_clients: ['Crea nuovo cliente', 'Lead attivi', 'Preventivi per cliente'],
  create_lead: ['Lista lead', 'Pipeline commerciale', 'Crea preventivo'],
  create_client: ['Crea preventivo', 'Lista clienti', 'Assegna progetto'],

  // Sales
  get_quotes: ['Crea preventivo', 'Converti in ordine', 'Preventivi scaduti'],
  get_orders: ['Stato progetti', 'Crea fattura', 'Ordini in lavorazione'],
  get_projects: ['Dettaglio progetto', 'Budget vs speso', 'Scadenze progetti'],

  // HR
  get_candidates: ['Candidati in colloquio', 'Crea candidato', 'Annunci aperti'],
  get_job_postings: ['Crea annuncio', 'Candidati per posizione', 'Chiudi annuncio'],
  create_candidate: ['Lista candidati', 'Annunci aperti', 'Pianifica colloquio'],

  // Documents
  get_documents: ['Cerca documento', 'Carica documento', 'Documenti recenti'],
  search_documents: ['Carica documento', 'Lista per categoria', 'Cerca altro'],

  // Analytics
  get_dashboard_summary: ['Dettaglio finanziario', 'Pipeline commerciale', 'Progetti attivi', 'Candidati HR'],
  get_suppliers: ['Fatture passive', 'Nuovo fornitore', 'Dettaglio fornitore'],

  // Image
  generate_image: ['Modifica immagine', 'Genera variante', 'Analizza immagine', 'Scarica'],
  analyze_image: ['Genera immagine simile', 'Riepilogo visivo', 'Altro'],
}

// Domain-level fallback suggestions (when no specific tool match)
const DOMAIN_SUGGESTIONS: Record<string, string[]> = {
  finance: ['Riepilogo finanziario', 'Fatture scadute', 'Saldo conti', 'Rimborsi pendenti'],
  crm: ['Lista clienti', 'Pipeline lead', 'Crea lead', 'Crea cliente'],
  sales: ['Preventivi aperti', 'Ordini attivi', 'Stato progetti'],
  hr: ['Candidati attivi', 'Annunci lavoro', 'Crea candidato'],
  documents: ['Cerca documento', 'Carica documento', 'Lista documenti'],
  analytics: ['Dashboard aziendale', 'Riepilogo completo', 'Fornitori'],
  image: ['Genera immagine', 'Analizza immagine'],
  general: ['Riepilogo aziendale', 'Lista clienti', 'Fatturato', 'Progetti attivi'],
}

export function getSuggestions(domain: string, toolsUsed: string[]): string[] {
  // Try tool-specific suggestions first
  for (const tool of toolsUsed.reverse()) { // most recent tool first
    const suggestions = TOOL_SUGGESTIONS[tool]
    if (suggestions) return suggestions.slice(0, 4)
  }

  // Fallback to domain-level
  return (DOMAIN_SUGGESTIONS[domain] || DOMAIN_SUGGESTIONS.general).slice(0, 4)
}
