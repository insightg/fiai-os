/**
 * FIAI OS Instance Configuration
 *
 * Loads instance-specific config from instances/{name}/config.yaml
 * Defines agents, branding, plugins, and settings for this deployment.
 *
 * The instance is selected via FIAI_INSTANCE env var (default: auto-detect or 'fiai').
 */

import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import type { AgentConfig } from './agents/types.js'
import { GENERIC_TOOLS } from './agents/tools.js'

// ── Types ───────────────────────────────────────────────

export interface InstanceAgentConfig {
  domain: string
  name: string
  color: string
  model?: string
  prompt: string  // path to .md file (relative to instance dir) or inline text
  tools: string[] // tool names or wildcards: 'generic', 'planning_*', 'send_whatsapp_*'
  views?: any[]   // AgentView[] — app views for this agent
}

export interface InstanceConfig {
  company: {
    name: string
    short_name: string
    color: string  // primary brand color
  }
  agents: InstanceAgentConfig[]
  plugins?: Record<string, Record<string, unknown>>  // plugin_name → config
  settings?: Record<string, string>  // key → value overrides
  classifier?: {
    model?: string
    keywords?: Record<string, { words: string[]; weight: number }[]>
  }
}

// ── Globals ─────────────────────────────────────────────

let instanceConfig: InstanceConfig | null = null
let instanceDir: string = ''

// ── Resolve tools from config patterns ──────────────────

function resolveToolNames(patterns: string[], availableTools: string[]): string[] {
  const resolved = new Set<string>()

  for (const pattern of patterns) {
    if (pattern === 'generic') {
      for (const t of GENERIC_TOOLS) resolved.add(t)
    } else if (pattern.endsWith('*')) {
      // Wildcard: 'planning_*' matches all planning_xxx tools
      const prefix = pattern.slice(0, -1)
      for (const t of availableTools) {
        if (t.startsWith(prefix)) resolved.add(t)
      }
    } else {
      resolved.add(pattern)
    }
  }

  return Array.from(resolved)
}

// ── Load Instance Config ────────────────────────────────

export function loadInstanceConfig(): InstanceConfig | null {
  const instanceName = process.env.FIAI_INSTANCE || 'fiai'

  // Look for instance dir
  const possiblePaths = [
    path.join(process.cwd(), 'instances', instanceName),
    path.join(import.meta.dirname, '..', 'instances', instanceName),
    path.join('/app', 'instances', instanceName),
  ]

  for (const p of possiblePaths) {
    const configPath = path.join(p, 'config.yaml')
    if (fs.existsSync(configPath)) {
      instanceDir = p
      const raw = fs.readFileSync(configPath, 'utf-8')
      instanceConfig = yaml.load(raw) as InstanceConfig
      console.log(`[Instance] Loaded config from ${configPath} (${instanceConfig.company?.name || instanceName})`)
      return instanceConfig
    }
    // Also check .yml extension
    const ymlPath = path.join(p, 'config.yml')
    if (fs.existsSync(ymlPath)) {
      instanceDir = p
      const raw = fs.readFileSync(ymlPath, 'utf-8')
      instanceConfig = yaml.load(raw) as InstanceConfig
      console.log(`[Instance] Loaded config from ${ymlPath} (${instanceConfig.company?.name || instanceName})`)
      return instanceConfig
    }
  }

  console.log(`[Instance] No config.yaml found for "${instanceName}" — using hardcoded agents`)
  return null
}

// ── Build AgentConfig[] from instance config ────────────

export function buildAgentsFromConfig(availableToolNames: string[]): Record<string, AgentConfig> | null {
  if (!instanceConfig || !instanceConfig.agents?.length) return null

  const agents: Record<string, AgentConfig> = {}

  for (const agentDef of instanceConfig.agents) {
    // Load prompt
    let prompt = ''
    if (agentDef.prompt.endsWith('.md')) {
      // Relative path to instance dir
      const promptPath = path.join(instanceDir, agentDef.prompt)
      if (fs.existsSync(promptPath)) {
        prompt = fs.readFileSync(promptPath, 'utf-8')
      } else {
        console.warn(`[Instance] Prompt file not found: ${promptPath}`)
        prompt = `Sei l'agente ${agentDef.name}. Rispondi in italiano.`
      }
    } else {
      // Inline prompt text
      prompt = agentDef.prompt
    }

    // Resolve tool names
    const toolNames = resolveToolNames(agentDef.tools, availableToolNames)

    agents[agentDef.domain] = {
      name: agentDef.name,
      domain: agentDef.domain as any,
      color: agentDef.color,
      model: agentDef.model,
      systemPrompt: prompt,
      toolNames,
      views: agentDef.views,
    }
  }

  console.log(`[Instance] Built ${Object.keys(agents).length} agents from config: ${Object.keys(agents).join(', ')}`)
  return agents
}

// ── Accessors ───────────────────────────────────────────

export function getInstanceConfig(): InstanceConfig | null {
  return instanceConfig
}

export function getInstanceDir(): string {
  return instanceDir
}

export function getCompanyName(): string {
  return instanceConfig?.company?.name || process.env.COMPANY_NAME || 'FIAI'
}

export function getCompanyColor(): string {
  return instanceConfig?.company?.color || '#C41E3A'
}

export function getInstancePluginConfig(pluginName: string): Record<string, unknown> | null {
  return instanceConfig?.plugins?.[pluginName] || null
}

export function getInstanceClassifierKeywords(): Record<string, { words: string[]; weight: number }[]> | null {
  return instanceConfig?.classifier?.keywords || null
}

export function getInstanceDomains(): string[] {
  if (!instanceConfig?.agents) return []
  return instanceConfig.agents.map(a => a.domain)
}
