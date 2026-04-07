import fs from 'fs'
import path from 'path'
import { GENERIC_TOOLS } from '../../tools.js'
import type { AgentConfig } from '../../types.js'

const prompt = fs.readFileSync(path.join(import.meta.dirname, 'prompt.md'), 'utf-8')
import views from './views.js'

const config: AgentConfig = {
  name: 'Avv. Rossi — Legal',
  domain: 'legal',
  color: '#D32F2F',
  model: 'mistralai/mistral-small-2603',
  systemPrompt: prompt,
  toolNames: [...GENERIC_TOOLS, 'retrieve'],
  views,
}

export default config
