import fs from 'fs'
import path from 'path'
import { GENERIC_TOOLS } from '../../tools.js'
import type { AgentConfig } from '../../types.js'

const prompt = fs.readFileSync(path.join(import.meta.dirname, 'prompt.md'), 'utf-8')
import views from './views.js'

const config: AgentConfig = {
  name: 'Direzione',
  domain: 'direzione',
  color: '#1a1a2e',
  systemPrompt: prompt,
  toolNames: [...GENERIC_TOOLS, 'send_whatsapp_message', 'send_whatsapp_voice', 'send_whatsapp_image', 'send_whatsapp_document'],
  views,
}

export default config
