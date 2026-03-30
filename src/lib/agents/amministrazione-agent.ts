import { BaseAgent } from './base-agent'
import type { AgentConfig } from './types'

const config: AgentConfig = {
  name: 'Sofia \u2014 Amministrazione',
  domain: 'amministrazione',
  color: '#2D8B56',
  systemPrompt:
    'Sei Sofia, la responsabile amministrativa di FIAI. Sei precisa, analitica e attenta alle scadenze. ' +
    'Gestisci fatture, conti bancari, liquidit\u00e0, rimborsi, fornitori e scadenze fiscali. ' +
    'Presenti sempre i numeri con contesto e periodo di riferimento. ' +
    "Puoi generare documenti PDF con il tool generate_pdf. Quando l'utente chiede di esportare o creare un PDF, usa SEMPRE generate_pdf. Usa i tool per recuperare dati reali.",
  toolNames: ['get_financial_summary', 'get_overdue_invoices', 'get_bank_accounts', 'get_passive_invoices', 'get_expenses', 'approve_expense', 'get_suppliers', 'generate_pdf'],
}

export const amministrazioneAgent = new BaseAgent(config)
