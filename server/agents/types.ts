// ── Permissions ─────────────────────────────────────────

export type PermAction = 'read' | 'create' | 'update' | 'delete' | 'send'

export class UserPermissions {
  private role: string
  private perms: Map<string, Set<PermAction>>  // entityType → actions

  constructor(role: string, groupPermissions: Record<string, PermAction[]>[] = []) {
    this.role = role
    this.perms = new Map()

    // Base role permissions
    if (role === 'admin') {
      // Admin can do everything — checked via role flag
    } else if (role === 'viewer') {
      this.perms.set('*', new Set(['read']))
    } else {
      // collaboratore (default)
      this.perms.set('*', new Set(['read', 'create', 'update']))
    }

    // Merge group permissions (additive)
    for (const gp of groupPermissions) {
      for (const [entityType, actions] of Object.entries(gp)) {
        const existing = this.perms.get(entityType) || new Set()
        for (const a of actions) existing.add(a)
        this.perms.set(entityType, existing)
      }
    }
  }

  // Type aliases: 'commerciale' covers organizzazione + persona
  private static TYPE_GROUPS: Record<string, string[]> = {
    'commerciale': ['organizzazione', 'persona'],
  }
  // Reverse: organizzazione → commerciale
  private static TYPE_PARENTS: Record<string, string> = {
    'organizzazione': 'commerciale',
    'persona': 'commerciale',
  }

  can(action: PermAction, entityType?: string): boolean {
    if (this.role === 'admin') return true

    // Check type-specific permissions first
    if (entityType) {
      const typePerms = this.perms.get(entityType)
      if (typePerms) return typePerms.has(action)
      // Check parent group (organizzazione → commerciale)
      const parent = UserPermissions.TYPE_PARENTS[entityType]
      if (parent) {
        const parentPerms = this.perms.get(parent)
        if (parentPerms) return parentPerms.has(action)
      }
    }

    // Fallback to wildcard
    const wildcard = this.perms.get('*')
    return wildcard ? wildcard.has(action) : false
  }

  get isAdmin(): boolean { return this.role === 'admin' }
  get userRole(): string { return this.role }
}

// ── Agent Types ─────────────────────────────────────────

export type AgentDomain = 'direzione' | 'commerciale' | 'produzione' | 'amministrazione' | 'contabilita' | 'officina' | 'legal' | 'qualita' | 'documentale' | 'it' | 'doctor' | 'whatsapp' | 'tts' | 'general'

export interface AgentView {
  id: string
  label: string
  icon: string
  trigger: 'auto' | 'on_get_tree' | 'manual' | string  // 'on_find:cliente', 'on_tool:retrieve', etc.
  layout: Record<string, unknown>  // LayoutDescriptor — defined fully in frontend types
}

export interface AgentConfig {
  name: string
  domain: AgentDomain
  color: string
  systemPrompt: string
  toolNames: string[]
  model?: string
  views?: AgentView[]
}

export interface AgentResult {
  text: string
  toolCalls: Record<string, unknown>[]
  agentName: string
  agentDomain: AgentDomain | string
  agentColor: string
  totalCost?: number
  totalTokens?: number
  reasoning?: {
    steps: { tool: string; description: string; result_summary: string }[]
    domain: string
    thinking: string
    latencyMs?: number
  }
}

export interface ClassificationResult {
  domain: AgentDomain
  confidence: number
  needsMultiAgent: boolean
  secondaryDomains?: AgentDomain[]
}

export interface ChatResponse {
  text: string
  toolCalls: Record<string, unknown>[]
  agentName: string
  agentDomain: string
  agentColor: string
  suggestions?: string[]
  totalCost?: number
  totalTokens?: number
  reasoning?: {
    steps: { tool: string; description: string; result_summary: string }[]
    domain: string
    thinking: string
    latencyMs?: number
    plannerMs?: number
    execMs?: number
  }
}

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}
