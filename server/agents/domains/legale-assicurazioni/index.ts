import fs from 'fs'
import path from 'path'
import { GENERIC_TOOLS } from '../../tools.js'
import type { AgentConfig } from '../../types.js'

const prompt = fs.readFileSync(path.join(import.meta.dirname, 'prompt.md'), 'utf-8')
import views from './views.js'

const config: AgentConfig = {
  name: 'Legale & Assicurazioni',
  domain: 'legal',
  color: '#D32F2F',
  systemPrompt: prompt,
  toolNames: [...GENERIC_TOOLS, 'retrieve', 'list_documents', 'send_whatsapp_message', 'send_whatsapp_voice', 'send_whatsapp_image', 'send_whatsapp_document'],
  views,
}

export default config
