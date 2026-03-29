export type AgentDomain = 'crm' | 'finance' | 'sales' | 'hr' | 'documents' | 'analytics' | 'general' | 'image' | 'tts'

export interface AgentToolDefinition {
  domain: AgentDomain
  definition: { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }
  executor: (input: Record<string, unknown>) => Promise<unknown>
}

export interface AgentConfig {
  name: string
  domain: AgentDomain
  color: string  // For UI display (hex color)
  systemPrompt: string
  toolNames: string[]
}

export interface AgentResult {
  text: string
  toolCalls: Record<string, unknown>[]
  agentName: string
  agentDomain: AgentDomain
  agentColor: string
}

export interface ClassificationResult {
  domain: AgentDomain
  confidence: number
  needsMultiAgent: boolean
  secondaryDomains?: AgentDomain[]
}
