// ── Permissions ─────────────────────────────────────────

export type PermAction = 'read' | 'create' | 'update' | 'delete' | 'send'

export class UserPermissions {
  private perms: Map<string, Set<PermAction>>  // entityType → actions
  private groupNames: string[]

  constructor(groupPermissions: { name: string; permissions: Record<string, PermAction[]> }[]) {
    this.perms = new Map()
    this.groupNames = groupPermissions.map(g => g.name)

    // Merge all group permissions (union)
    for (const group of groupPermissions) {
      for (const [entityType, actions] of Object.entries(group.permissions)) {
        const existing = this.perms.get(entityType) || new Set()
        for (const a of actions) existing.add(a)
        this.perms.set(entityType, existing)
      }
    }

    // No groups → default read only
    if (groupPermissions.length === 0) {
      this.perms.set('*', new Set(['read']))
    }
  }

  // Type aliases: 'commerciale' covers organizzazione + persona
  private static TYPE_PARENTS: Record<string, string> = {
    'organizzazione': 'commerciale',
    'persona': 'commerciale',
  }

  can(action: PermAction, entityType?: string): boolean {
    // Check type-specific permissions first
    if (entityType) {
      const typePerms = this.perms.get(entityType)
      if (typePerms) return typePerms.has(action)
      // Check parent alias (organizzazione → commerciale)
      const parent = UserPermissions.TYPE_PARENTS[entityType]
      if (parent) {
        const parentPerms = this.perms.get(parent)
        if (parentPerms) return parentPerms.has(action)
      }
    }

    // Fallback to wildcard '*'
    const wildcard = this.perms.get('*')
    return wildcard ? wildcard.has(action) : false
  }

  get isAdmin(): boolean {
    // Admin = has wildcard with all actions including delete
    const wildcard = this.perms.get('*')
    return wildcard ? wildcard.has('delete') && wildcard.has('send') : false
  }

  get groups(): string[] { return this.groupNames }
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
