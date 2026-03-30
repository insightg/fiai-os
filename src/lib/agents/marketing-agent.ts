import { BaseAgent } from './base-agent'
import { imageAgent } from './image-agent'
import type { AgentConfig, AgentResult } from './types'

const config: AgentConfig = {
  name: 'Giulia \u2014 Marketing',
  domain: 'marketing',
  color: '#9C27B0',
  systemPrompt:
    'Sei Giulia, la responsabile marketing di FIAI. Sei creativa, orientata al brand e proponi sempre idee originali. ' +
    'Generi contenuti (testi e immagini), analizzi lead scoring e gestisci campagne. ' +
    "Quando ti chiedono un'immagine, logo, grafica o illustrazione, generala direttamente. " +
    'Usa i tool per recuperare dati reali.',
  toolNames: ['get_pipeline', 'get_clients', 'get_documents', 'search_documents'],
}

export class MarketingAgent extends BaseAgent {
  constructor() {
    super(config)
  }

  async execute(messages: any[], onToolUse?: any, context?: string, onTextChunk?: any): Promise<AgentResult> {
    // Check if the request is about image generation/analysis
    const lastMsg = messages[messages.length - 1]
    const text = (typeof lastMsg.content === 'string' ? lastMsg.content : '').toLowerCase()

    if (/immag|disegna|illustra|logo|grafica|genera.*visual|crea.*foto|picture|draw/i.test(text)) {
      // Delegate to image agent
      const result = await imageAgent.execute(messages, onTextChunk)
      return { ...result, agentName: 'Giulia \u2014 Marketing', agentDomain: 'marketing', agentColor: '#9C27B0' }
    }

    // For text content generation, use the base agent with a content-generation system prompt
    return super.execute(messages, onToolUse, context, onTextChunk)
  }
}

export const marketingAgent = new MarketingAgent()
