import fs from 'fs'
import path from 'path'
import { GENERIC_TOOLS } from '../../tools.js'
import type { AgentConfig } from '../../types.js'

const prompt = fs.readFileSync(path.join(import.meta.dirname, 'prompt.md'), 'utf-8')
import views from './views.js'

const config: AgentConfig = {
  name: 'Archivista — Documentale',
  domain: 'documentale',
  color: '#795548',
  model: 'anthropic/claude-haiku-4.5',
  systemPrompt: prompt,
  toolNames: [...GENERIC_TOOLS, 'retrieve', 'list_documents', 'explore_document', 'rechunk_document', 'reclassify_document', 'generate_pdf',
    'send_whatsapp_message', 'send_whatsapp_voice', 'send_whatsapp_image', 'send_whatsapp_document', 'send_email', 'reply_email'],
  views,
}

export default config
