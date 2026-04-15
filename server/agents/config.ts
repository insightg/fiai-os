import type { AgentConfig } from './types.js'
import db from '../db.js'
import { loadInstanceConfig, buildAgentsFromConfig } from '../instance-config.js'
import { TOOL_DEFINITIONS } from './tool-registry.js'
export { GENERIC_TOOLS } from './tools.js'

// ── Hardcoded fallback imports (static, no await) ───────
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

const HARDCODED_AGENTS: Record<string, AgentConfig> = {
  pulse, commerciale, produzione, marketing,
  amministrazione, hr, legal, documentale,
  whatsapp, email, pianificazione, it, doctor, tts, general,
}

// ── Mutable agent registry (supports hot reload) ────────

let _agents: Record<string, AgentConfig> = {}
let _colors: Record<string, string> = {}

function loadAgents(): Record<string, AgentConfig> {
  // 1. Try instance config.yaml
  const instanceConfig = loadInstanceConfig()
  let base: Record<string, AgentConfig> | null = null

  if (instanceConfig) {
    const availableTools = Object.keys(TOOL_DEFINITIONS)
    base = buildAgentsFromConfig(availableTools)
  }

  if (!base || Object.keys(base).length === 0) {
    // 2. Fallback: hardcoded domain agents
    base = { ...HARDCODED_AGENTS }
  }

  // 3. Apply DB skill overrides
  try {
    const skills = db.prepare("SELECT display_name, metadata FROM entity WHERE type = 'skill'").all() as any[]
    for (const skill of skills) {
      const m = typeof skill.metadata === 'string' ? JSON.parse(skill.metadata) : skill.metadata
      const domain = m.domain as string
      if (!domain || !base[domain]) continue

      const agent = base[domain]
      base[domain] = {
        ...agent,
        name: m.name || agent.name,
        systemPrompt: m.system_prompt || agent.systemPrompt,
        model: m.model || agent.model,
        color: m.color || agent.color,
        ...(m.rules?.length ? {
          systemPrompt: (m.system_prompt || agent.systemPrompt) + '\n\nRegole specifiche:\n' + m.rules.map((r: string) => `- ${r}`).join('\n')
        } : {}),
      }
      console.log(`[Skills] Loaded skill override for "${domain}" from DB`)
    }
  } catch {}

  return base
}

// Initial load
_agents = loadAgents()
_colors = Object.fromEntries(Object.entries(_agents).map(([d, a]) => [d, a.color]))

// ── Exported accessors (Proxy for live access) ──────────

export const AGENTS: Record<string, AgentConfig> = new Proxy({} as Record<string, AgentConfig>, {
  get: (_t, p: string) => _agents[p],
  set: (_t, p: string, v) => { _agents[p] = v; return true },
  has: (_t, p: string) => p in _agents,
  ownKeys: () => Object.keys(_agents),
  getOwnPropertyDescriptor: (_t, p: string) => {
    if (p in _agents) return { configurable: true, enumerable: true, value: _agents[p] }
  },
})

export const AGENT_COLORS: Record<string, string> = new Proxy({} as Record<string, string>, {
  get: (_t, p: string) => _colors[p],
  has: (_t, p: string) => p in _colors,
  ownKeys: () => Object.keys(_colors),
  getOwnPropertyDescriptor: (_t, p: string) => {
    if (p in _colors) return { configurable: true, enumerable: true, value: _colors[p] }
  },
})

// ── Hot Reload ──────────────────────────────────────────

export function reloadAgents(): { count: number; domains: string[] } {
  console.log('[Config] Reloading agents from config...')
  _agents = loadAgents()
  _colors = Object.fromEntries(Object.entries(_agents).map(([d, a]) => [d, a.color]))
  const domains = Object.keys(_agents)
  console.log(`[Config] Reloaded ${domains.length} agents: ${domains.join(', ')}`)
  return { count: domains.length, domains }
}
