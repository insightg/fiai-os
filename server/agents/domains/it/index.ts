import fs from 'fs'
import path from 'path'
import { GENERIC_TOOLS } from '../../tools.js'
import type { AgentConfig } from '../../types.js'

const prompt = fs.readFileSync(path.join(import.meta.dirname, 'prompt.md'), 'utf-8')
import views from './views.js'

const config: AgentConfig = {
  name: 'Dev — IT',
  domain: 'it',
  color: '#455A64',
  systemPrompt: prompt,
  toolNames: [...GENERIC_TOOLS, 'get_api_costs', 'get_whatsapp_status',
    'create_autonomous_agent', 'list_autonomous_agents', 'toggle_autonomous_agent', 'delete_autonomous_agent', 'get_agent_logs',
    'create_workflow', 'run_workflow', 'list_workflows',
    'update_skill', 'list_skills', 'add_agent_lesson',
    'create_group', 'add_to_group', 'remove_from_group', 'list_groups', 'set_user_role'],
  views,
}

export default config
