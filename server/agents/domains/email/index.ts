import fs from 'fs'
import path from 'path'
import { GENERIC_TOOLS } from '../../tools.js'
import type { AgentConfig } from '../../types.js'

const prompt = fs.readFileSync(path.join(import.meta.dirname, 'prompt.md'), 'utf-8')
import views from './views.js'

const config: AgentConfig = {
  name: 'Email Agent',
  domain: 'email',
  color: '#D44638',
  systemPrompt: prompt,
  toolNames: [...GENERIC_TOOLS,
    'get_email_status',
    'send_email', 'read_inbox', 'read_email',
    'search_emails', 'reply_email',
    'download_email_attachment'],
  views,
}

export default config
