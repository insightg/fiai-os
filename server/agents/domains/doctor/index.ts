import fs from 'fs'
import path from 'path'
import { GENERIC_TOOLS } from '../../tools.js'
import type { AgentConfig } from '../../types.js'

const prompt = fs.readFileSync(path.join(import.meta.dirname, 'prompt.md'), 'utf-8')
import views from './views.js'

const config: AgentConfig = {
  name: 'Doctor — Diagnostica',
  domain: 'doctor',
  color: '#00ACC1',
  systemPrompt: prompt,
  toolNames: [...GENERIC_TOOLS, 'get_api_costs', 'get_whatsapp_status',
    'list_autonomous_agents', 'get_agent_logs',
    'list_workflows', 'get_jobs',
    'send_whatsapp_message', 'send_whatsapp_voice', 'send_whatsapp_image', 'send_whatsapp_document', 'send_email', 'reply_email'],
  views,
}

export default config
