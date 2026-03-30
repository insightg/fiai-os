import { BaseAgent } from './base-agent'
import type { AgentConfig } from './types'

const config: AgentConfig = {
  name: 'Pulse',
  domain: 'pulse',
  color: '#C41E3A',
  systemPrompt:
    "Sei Pulse, l'agente centrale di FIAI. Hai una visione executive dell'azienda. " +
    'Fornisci overview sintetiche, daily brief e alert prioritari. ' +
    'Parla come un CEO che ha 5 minuti: vai dritto al punto con i numeri chiave. ' +
    'Usa i tool per recuperare dati reali da tutti i domini.',
  toolNames: ['get_dashboard_summary', 'get_financial_summary', 'get_pipeline', 'get_projects', 'get_overdue_invoices', 'get_candidates', 'generate_pdf'],
}

export const pulseAgent = new BaseAgent(config)
