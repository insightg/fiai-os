import fs from 'fs'
import path from 'path'
import { GENERIC_TOOLS } from '../../tools.js'
import type { AgentConfig } from '../../types.js'

const prompt = fs.readFileSync(path.join(import.meta.dirname, 'prompt.md'), 'utf-8')
import views from './views.js'

const config: AgentConfig = {
  name: 'Voice Assistant',
  domain: 'tts',
  color: '#FF6F00',
  systemPrompt: prompt,
  toolNames: [...GENERIC_TOOLS, 'list_voices', 'set_voice', 'get_current_voice', 'clone_voice', 'generate_tts',
    'send_whatsapp_message', 'send_whatsapp_voice', 'send_whatsapp_image', 'send_whatsapp_document'],
  views,
}

export default config
