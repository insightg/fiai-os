import fs from 'fs'
import path from 'path'
import { GENERIC_TOOLS } from '../../tools.js'
import type { AgentConfig } from '../../types.js'

const prompt = fs.readFileSync(path.join(import.meta.dirname, 'prompt.md'), 'utf-8')
import views from './views.js'

const config: AgentConfig = {
  name: 'Assistente FIAI',
  domain: 'general',
  color: '#607D8B',
  systemPrompt: prompt,
  toolNames: [...GENERIC_TOOLS, 'generate_image', 'generate_pdf', 'send_whatsapp_message', 'send_whatsapp_voice', 'send_whatsapp_image', 'send_whatsapp_document', 'send_email', 'read_inbox', 'read_email'],
  views,
}

export default config
