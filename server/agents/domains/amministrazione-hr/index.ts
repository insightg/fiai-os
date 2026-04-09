import fs from 'fs'
import path from 'path'
import { GENERIC_TOOLS } from '../../tools.js'
import type { AgentConfig } from '../../types.js'

const prompt = fs.readFileSync(path.join(import.meta.dirname, 'prompt.md'), 'utf-8')
import views from './views.js'

const config: AgentConfig = {
  name: 'Amministrazione & HR',
  domain: 'amministrazione',
  color: '#2D8B56',
  systemPrompt: prompt,
  toolNames: [...GENERIC_TOOLS, 'send_whatsapp_message', 'send_whatsapp_voice', 'send_whatsapp_image', 'send_whatsapp_document'],
  views,
}

export default config
