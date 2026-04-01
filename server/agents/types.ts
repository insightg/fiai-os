export type AgentDomain = 'pulse' | 'commerciale' | 'produzione' | 'marketing' | 'amministrazione' | 'hr' | 'legal' | 'documents' | 'infra' | 'image' | 'tts' | 'general'

export interface AgentConfig {
  name: string
  domain: AgentDomain
  color: string
  systemPrompt: string
  toolNames: string[]
}

export interface AgentResult {
  text: string
  toolCalls: Record<string, unknown>[]
  agentName: string
  agentDomain: AgentDomain | string
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
