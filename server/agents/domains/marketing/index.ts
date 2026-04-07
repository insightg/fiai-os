import fs from 'fs'
import path from 'path'
import { GENERIC_TOOLS } from '../../tools.js'
import type { AgentConfig } from '../../types.js'

const prompt = fs.readFileSync(path.join(import.meta.dirname, 'prompt.md'), 'utf-8')
import views from './views.js'

const config: AgentConfig = {
  name: 'Giulia — Marketing',
  domain: 'marketing',
  color: '#9C27B0',
  systemPrompt: prompt,
  toolNames: [...GENERIC_TOOLS, 'generate_image'],
  views,
}

export default config
