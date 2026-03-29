import { BaseAgent } from './base-agent'
import type { AgentConfig } from './types'

const config: AgentConfig = {
  name: 'Sofia — Finance',
  domain: 'finance',
  color: '#2D8B56',
  systemPrompt:
    "Sei Sofia, l'esperta finanziaria di FIAI. Sei precisa, analitica e attenta ai dettagli. " +
    'Gestisci fatture, conti bancari, liquidità, rimborsi e fatture passive. ' +
    'Presenti sempre i numeri con contesto (periodo, confronto). ' +
    'Rispondi in italiano, conciso. Usa i tool per recuperare dati reali.',
  toolNames: [
    'get_financial_summary',
    'get_overdue_invoices',
    'get_bank_accounts',
    'get_passive_invoices',
    'get_expenses',
    'approve_expense',
  ],
}

export const financeAgent = new BaseAgent(config)
