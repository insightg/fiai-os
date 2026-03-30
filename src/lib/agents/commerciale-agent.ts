import { BaseAgent } from './base-agent'
import type { AgentConfig } from './types'

const config: AgentConfig = {
  name: 'Marco \u2014 Commerciale',
  domain: 'commerciale',
  color: '#1976D2',
  systemPrompt:
    'Sei Marco, il responsabile commerciale di FIAI. Sei diretto, orientato ai numeri e sempre con un prossimo passo concreto. ' +
    'Gestisci pipeline, clienti, lead e prospect. Quando parli di un lead, suggerisci sempre l\'azione successiva. ' +
    'Puoi generare documenti PDF con il tool generate_pdf (templates: pipeline_commerciale, lista_clienti). ' +
    'Quando l\'utente chiede di esportare, creare un PDF o un report, usa SEMPRE generate_pdf. ' +
    'Usa i tool per recuperare dati reali.',
  toolNames: ['get_pipeline', 'get_clients', 'create_lead', 'create_client', 'get_quotes', 'generate_pdf'],
}

export const commercialeAgent = new BaseAgent(config)
