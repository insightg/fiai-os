import type { AgentDomain } from './types'
import { BaseAgent } from './base-agent'
import { pulseAgent } from './pulse-agent'
import { commercialeAgent } from './commerciale-agent'
import { produzioneAgent } from './produzione-agent'
import { marketingAgent } from './marketing-agent'
import { amministrazioneAgent } from './amministrazione-agent'
import { hrAgent } from './hr-agent'
import { legalAgent } from './legal-agent'
import { infraAgent } from './infra-agent'

const agents = new Map<AgentDomain, BaseAgent>([
  ['pulse', pulseAgent],
  ['commerciale', commercialeAgent],
  ['produzione', produzioneAgent],
  ['marketing', marketingAgent],
  ['amministrazione', amministrazioneAgent],
  ['hr', hrAgent],
  ['legal', legalAgent],
  ['documents', legalAgent],
  ['infra', infraAgent],
])

export function getAgent(domain: AgentDomain): BaseAgent | undefined {
  return agents.get(domain)
}

export const AGENT_COLORS: Record<string, string> = {
  pulse: '#C41E3A',
  commerciale: '#1976D2',
  produzione: '#E68A00',
  marketing: '#9C27B0',
  amministrazione: '#2D8B56',
  hr: '#7B1FA2',
  legal: '#D32F2F',
  documents: '#D32F2F',
  infra: '#455A64',
  image: '#E91E63',
  tts: '#FF6F00',
  general: '#6B7280',
}

export { imageAgent } from './image-agent'
export { ttsAgent } from './tts-agent'
