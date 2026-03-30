export type AgentDomain = 'pulse' | 'commerciale' | 'produzione' | 'marketing' | 'amministrazione' | 'hr' | 'legal' | 'documents' | 'infra' | 'image' | 'tts' | 'general'

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
  totalCost?: number
  totalTokens?: number
}

export interface ClassificationResult {
  domain: AgentDomain
  confidence: number
  needsMultiAgent: boolean
  secondaryDomains?: AgentDomain[]
}
