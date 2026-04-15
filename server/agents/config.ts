import type { AgentConfig } from './types.js'
import db from '../db.js'
import { loadInstanceConfig, buildAgentsFromConfig } from '../instance-config.js'
import { TOOL_DEFINITIONS } from './tool-registry.js'
export { GENERIC_TOOLS } from './tools.js'

// ── Try loading agents from instance config.yaml ────────

const instanceConfig = loadInstanceConfig()
let configAgents: Record<string, AgentConfig> | null = null

if (instanceConfig) {
  // Available tool names = built-in + plugin (loaded before this)
  const availableTools = Object.keys(TOOL_DEFINITIONS)
  configAgents = buildAgentsFromConfig(availableTools)
}

// ── Fallback: hardcoded domain agents ───────────────────

let DEFAULT_AGENTS: Record<string, AgentConfig>

if (configAgents && Object.keys(configAgents).length > 0) {
  DEFAULT_AGENTS = configAgents
} else {
  // Hardcoded agents (backward compat — used when no config.yaml exists)
  const pulse = (await import('./domains/pulse/index.js')).default
  const commerciale = (await import('./domains/commerciale/index.js')).default
  const produzione = (await import('./domains/produzione/index.js')).default
  const marketing = (await import('./domains/marketing/index.js')).default
  const amministrazione = (await import('./domains/amministrazione/index.js')).default
  const hr = (await import('./domains/hr/index.js')).default
  const legal = (await import('./domains/legal/index.js')).default
  const documentale = (await import('./domains/documentale/index.js')).default
  const whatsapp = (await import('./domains/whatsapp/index.js')).default
  const it = (await import('./domains/it/index.js')).default
  const doctor = (await import('./domains/doctor/index.js')).default
  const tts = (await import('./domains/tts/index.js')).default
  const email = (await import('./domains/email/index.js')).default
  const pianificazione = (await import('./domains/pianificazione/index.js')).default
  const general = (await import('./domains/general/index.js')).default

  DEFAULT_AGENTS = {
    pulse, commerciale, produzione, marketing,
    amministrazione, hr, legal, documentale,
    whatsapp, email, pianificazione, it, doctor, tts, general,
  }
}

// ── Load skills from VFS (entity type='skill') ──────────
// Overrides agent configs with DB-stored skill definitions

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

// Build color map from loaded agents
export const AGENT_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(AGENTS).map(([domain, agent]) => [domain, agent.color])
)
