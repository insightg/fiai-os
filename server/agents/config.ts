import type { AgentConfig } from './types.js'
import db from '../db.js'
export { GENERIC_TOOLS } from './tools.js'

// ── Import domain configs — BERNARDINI S.R.L. ──────────
import direzione from './domains/direzione/index.js'
import commerciale from './domains/commerciale-bernardini/index.js'
import amministrazione from './domains/amministrazione-hr/index.js'
import contabilita from './domains/contabilita-industriale/index.js'
import produzione from './domains/logistica-produzione/index.js'
import officina from './domains/officina/index.js'
import legal from './domains/legale-assicurazioni/index.js'
import qualita from './domains/qualita-sicurezza/index.js'

// ── Import shared agents ────────────────────────────────
import documentale from './domains/documentale/index.js'
import whatsapp from './domains/whatsapp/index.js'
import it from './domains/it/index.js'
import doctor from './domains/doctor/index.js'
import tts from './domains/tts/index.js'
import general from './domains/general/index.js'

const DEFAULT_AGENTS: Record<string, AgentConfig> = {
  // Bernardini departments
  direzione, commerciale, amministrazione, contabilita,
  produzione, officina, legal, qualita,
  // Shared
  documentale, whatsapp, it, doctor, tts, general,
}

// ── Load skills from VFS (entity type='skill') ──────────
function loadSkillsFromDB(): Record<string, AgentConfig> {
  const agents = { ...DEFAULT_AGENTS }

  try {
    const skills = db.prepare("SELECT display_name, metadata FROM entity WHERE type = 'skill'").all() as any[]
    for (const skill of skills) {
      const m = typeof skill.metadata === 'string' ? JSON.parse(skill.metadata) : skill.metadata
      const domain = m.domain as string
      if (!domain || !agents[domain]) continue

      const base = agents[domain]
      agents[domain] = {
        ...base,
        name: m.name || base.name,
        systemPrompt: m.system_prompt || base.systemPrompt,
        model: m.model || base.model,
        color: m.color || base.color,
        ...(m.rules?.length ? {
          systemPrompt: (m.system_prompt || base.systemPrompt) + '\n\nRegole specifiche:\n' + m.rules.map((r: string) => `- ${r}`).join('\n')
        } : {}),
      }
      console.log(`[Skills] Loaded skill override for "${domain}" from DB`)
    }
  } catch {}

  return agents
}

export const AGENTS: Record<string, AgentConfig> = loadSkillsFromDB()

export const AGENT_COLORS: Record<string, string> = {
  direzione: '#1a1a2e',
  commerciale: '#1976D2',
  amministrazione: '#2D8B56',
  contabilita: '#6A1B9A',
  produzione: '#E68A00',
  officina: '#795548',
  legal: '#D32F2F',
  qualita: '#00796B',
  documentale: '#795548',
  whatsapp: '#25D366',
  it: '#455A64',
  doctor: '#00ACC1',
  tts: '#FF6F00',
  general: '#607D8B',
}
