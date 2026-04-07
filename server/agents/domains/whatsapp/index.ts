import fs from 'fs'
import path from 'path'
import { GENERIC_TOOLS } from '../../tools.js'
import type { AgentConfig } from '../../types.js'

const prompt = fs.readFileSync(path.join(import.meta.dirname, 'prompt.md'), 'utf-8')
import views from './views.js'

const config: AgentConfig = {
  name: 'WhatsApp Agent',
  domain: 'whatsapp',
  color: '#25D366',
  systemPrompt: prompt,
  toolNames: [...GENERIC_TOOLS,
    'get_whatsapp_status',
    'send_whatsapp_message', 'send_whatsapp_voice',
    'send_whatsapp_image', 'send_whatsapp_document', 'send_whatsapp_video',
    'generate_image', 'generate_tts'],
  views,
}

export default config
