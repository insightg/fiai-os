import type { AgentDomain } from './types'
import { BaseAgent } from './base-agent'
import { crmAgent } from './crm-agent'
import { financeAgent } from './finance-agent'
import { salesAgent } from './sales-agent'
import { hrAgent } from './hr-agent'
import { documentsAgent } from './documents-agent'
import { analyticsAgent } from './analytics-agent'

const agents = new Map<AgentDomain, BaseAgent>([
  ['crm', crmAgent],
  ['finance', financeAgent],
  ['sales', salesAgent],
  ['hr', hrAgent],
  ['documents', documentsAgent],
  ['analytics', analyticsAgent],
])

export function getAgent(domain: AgentDomain): BaseAgent | undefined {
  return agents.get(domain)
}

export const AGENT_COLORS: Record<AgentDomain, string> = {
  crm: '#1976D2',
  finance: '#2D8B56',
  sales: '#E68A00',
  hr: '#7B1FA2',
  documents: '#C41E3A',
  analytics: '#00838F',
  general: '#6B7280',
  image: '#E91E63',
  tts: '#FF6F00',
}

export { imageAgent } from './image-agent'
export { ttsAgent } from './tts-agent'
