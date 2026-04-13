import fs from 'fs'
import path from 'path'
import { GENERIC_TOOLS } from '../../tools.js'
import type { AgentConfig } from '../../types.js'

const prompt = fs.readFileSync(path.join(import.meta.dirname, 'prompt.md'), 'utf-8')
import views from './views.js'

const config: AgentConfig = {
  name: 'Pianificazione Trasporti',
  domain: 'pianificazione',
  color: '#FF5722',
  systemPrompt: prompt,
  toolNames: [...GENERIC_TOOLS,
    'planning_viaggi', 'planning_suggerisci', 'planning_assegna',
    'planning_autisti', 'planning_semirimorchi', 'planning_gps',
    'planning_distanza', 'planning_statistiche', 'planning_confronta',
    'planning_scenario', 'planning_eta', 'planning_conflitti',
    'planning_storico', 'planning_dettaglio', 'planning_analizza',
    'planning_pianificazione_corrente', 'planning_tutti_autisti',
    'planning_health',
    'send_whatsapp_message', 'send_whatsapp_document',
    'send_email', 'reply_email'],
  views,
}

export default config
