import type { AgentConfig } from './types.js'
import db from '../db.js'
export { GENERIC_TOOLS } from './tools.js'

// ── Import domain configs ───────────────────────────────
import pulse from './domains/pulse/index.js'
import commerciale from './domains/commerciale/index.js'
import produzione from './domains/produzione/index.js'
import marketing from './domains/marketing/index.js'
import amministrazione from './domains/amministrazione/index.js'
import hr from './domains/hr/index.js'
import legal from './domains/legal/index.js'
import documentale from './domains/documentale/index.js'
import whatsapp from './domains/whatsapp/index.js'
import it from './domains/it/index.js'
import doctor from './domains/doctor/index.js'
import tts from './domains/tts/index.js'
import email from './domains/email/index.js'
import pianificazione from './domains/pianificazione/index.js'
import general from './domains/general/index.js'

const DEFAULT_AGENTS: Record<string, AgentConfig> = {
  pulse, commerciale, produzione, marketing,
  amministrazione, hr, legal, documentale,
  whatsapp, email, pianificazione, it, doctor, tts, general,
}

// ── Load skills from VFS (entity type='skill') ──────────
// Overrides default agent configs with DB-stored skill definitions

function loadSkillsFromDB(): Record<string, AgentConfig> {
  const agents = { ...DEFAULT_AGENTS }

  try {
    const skills = db.prepare("SELECT display_name, metadata FROM entity WHERE type = 'skill'").all() as any[]
    for (const skill of skills) {
      const m = typeof skill.metadata === 'string' ? JSON.parse(skill.metadata) : skill.metadata
      const domain = m.domain as string
      if (!domain || !agents[domain]) continue

      // Merge: DB skill overrides hardcoded defaults
      const base = agents[domain]
      agents[domain] = {
        ...base,
        name: m.name || base.name,
        systemPrompt: m.system_prompt || base.systemPrompt,
        model: m.model || base.model,
        color: m.color || base.color,
        // Append rules to system prompt
        ...(m.rules?.length ? {
          systemPrompt: (m.system_prompt || base.systemPrompt) + '\n\nRegole specifiche:\n' + m.rules.map((r: string) => `- ${r}`).join('\n')
        } : {}),
        // toolNames are NOT overridden from DB (security — tools stay hardcoded)
      }
      console.log(`[Skills] Loaded skill override for "${domain}" from DB`)
    }
  } catch {
    // DB might not be ready yet — use defaults
  }

  return agents
}

export const AGENTS: Record<string, AgentConfig> = loadSkillsFromDB()

export const AGENT_COLORS: Record<string, string> = {
  pulse: '#C41E3A',
  commerciale: '#1976D2',
  produzione: '#E68A00',
  marketing: '#9C27B0',
  amministrazione: '#2D8B56',
  hr: '#7B1FA2',
  legal: '#D32F2F',
  documents: '#D32F2F',
  documentale: '#795548',
  whatsapp: '#25D366',
  email: '#1565C0',
  pianificazione: '#FF5722',
  it: '#455A64',
  doctor: '#00ACC1',
  image: '#E91E63',
  tts: '#FF6F00',
  general: '#607D8B',
}
