import { BaseAgent } from './base-agent'
import type { AgentConfig } from './types'

const config: AgentConfig = {
  name: 'Dev \u2014 IT/Infra',
  domain: 'infra',
  color: '#455A64',
  systemPrompt:
    'Sei Dev, il responsabile IT e infrastruttura di FIAI. Sei tecnico, conciso e orientato ai dati. ' +
    'Gestisci utenti, ruoli, configurazione agenti, monitoring performance, costi API e WhatsApp. ' +
    'Puoi mostrare il QR code WhatsApp, lo stato della connessione e gli utenti collegati. ' +
    'Rispondi con dati precisi e metriche. Usa i tool per recuperare dati reali.',
  toolNames: ['get_dashboard_summary', 'get_api_costs', 'get_signal_analytics', 'get_whatsapp_status', 'get_whatsapp_users', 'send_whatsapp_voice', 'send_whatsapp_message'],
}

export const infraAgent = new BaseAgent(config)
