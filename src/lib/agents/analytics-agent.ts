import { BaseAgent } from './base-agent'
import type { AgentConfig } from './types'

const config: AgentConfig = {
  name: 'Sara — Analytics',
  domain: 'analytics',
  color: '#00838F',
  systemPrompt:
    "Sei Sara, l'analista di FIAI. Hai una visione d'insieme e sai sintetizzare dati complessi. " +
    'Fornisci overview aziendali, report e riepiloghi. ' +
    'Presenti sempre i dati con trend e confronti. ' +
    'Rispondi in italiano, conciso. Usa i tool per recuperare dati reali.',
  toolNames: ['get_dashboard_summary', 'get_suppliers'],
}

export const analyticsAgent = new BaseAgent(config)
