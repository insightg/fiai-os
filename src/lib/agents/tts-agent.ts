import type { AgentResult } from './types'

const API_BASE = import.meta.env.VITE_API_URL || '/api'

const AVAILABLE_VOICES = ['Cherry', 'Serena', 'Ethan', 'Chelsie', 'Vivian', 'Ryan', 'Bella', 'Jennifer', 'Kai', 'Moon', 'Maia'] as const

interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string | object[]
}

/** Detect if user wants voice cloning */
function isCloneRequest(text: string): boolean {
  return /clon[ao]|con la mia voce|mia voce|voce personalizzat|imitare|imita la voce|voice clon/i.test(text)
}

/** Extract requested voice from text, default Cherry */
function extractVoice(text: string): string {
  const lower = text.toLowerCase()
  for (const voice of AVAILABLE_VOICES) {
    if (lower.includes(voice.toLowerCase())) return voice
  }
  return 'Cherry'
}

/** Extract the text-to-speak from the user message.
 *  Supports patterns like:
 *  - "leggi: testo qui"
 *  - "pronuncia 'testo qui'"
 *  - "dì ad alta voce: testo"
 *  - Falls back to using the previous assistant message if just "leggi" / "pronuncia"
 */
function extractTextToSpeak(userMsg: string, previousAssistantMsg?: string): string {
  // Check for quoted text
  const quotedMatch = userMsg.match(/["'«"](.+?)["'»"]/)
  if (quotedMatch) return quotedMatch[1]

  // Check for "leggi:" or "pronuncia:" with colon
  const colonMatch = userMsg.match(/(?:leggi|pronuncia|dì|dire|say|speak|read)[:\s]+(.{10,})/i)
  if (colonMatch) {
    // Remove voice instructions from the text
    let text = colonMatch[1]
    text = text.replace(/\s*(?:con voce|voce)\s+\w+\s*/gi, '').trim()
    if (text.length > 5) return text
  }

  // If it's a short command like "leggi" / "pronuncia" with no substantial text,
  // use the previous assistant message
  const shortCommand = /^(?:leggi(?:lo|la|melo|mela)?|pronuncia(?:lo|la)?|dì(?:llo|lla)?|leggilo|ripeti)\b/i.test(userMsg.trim())
  if (shortCommand && previousAssistantMsg) {
    return previousAssistantMsg.substring(0, 2000)
  }

  // Fallback: strip common command prefixes and use the rest
  let cleaned = userMsg
    .replace(/^(?:leggi|pronuncia|dì|dire|genera audio|sintesi vocale|text.to.speech|tts)[:\s]*/i, '')
    .replace(/\s*(?:con voce|voce)\s+\w+\s*/gi, '')
    .replace(/\s*(?:in italiano|in inglese|in francese)\s*/gi, '')
    .trim()

  if (cleaned.length > 5) return cleaned

  // Last resort: use previous assistant message
  if (previousAssistantMsg) {
    return previousAssistantMsg.substring(0, 2000)
  }

  return userMsg
}

/** Extract language from text */
function extractLanguage(text: string): string {
  const lower = text.toLowerCase()
  if (/in inglese|english/i.test(lower)) return 'English'
  if (/in francese|french/i.test(lower)) return 'French'
  if (/in spagnolo|spanish/i.test(lower)) return 'Spanish'
  if (/in tedesco|german/i.test(lower)) return 'German'
  if (/in cinese|chinese/i.test(lower)) return 'Chinese'
  if (/in giapponese|japanese/i.test(lower)) return 'Japanese'
  if (/in coreano|korean/i.test(lower)) return 'Korean'
  return 'Italian'
}

export class TTSAgent {
  /** Store reference audio per session for voice cloning */
  private referenceAudio: Map<string, string> = new Map()

  /** Store reference audio base64 for a session */
  setReferenceAudio(sessionId: string, base64Audio: string) {
    this.referenceAudio.set(sessionId, base64Audio)
  }

  getReferenceAudio(sessionId: string): string | null {
    return this.referenceAudio.get(sessionId) || null
  }

  async execute(
    messages: ConversationMessage[],
    onTextChunk?: (chunk: string) => void,
    sessionId?: string
  ): Promise<AgentResult> {
    const lastMsg = messages[messages.length - 1]
    const userText = typeof lastMsg.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg.content)

    // Find previous assistant message for context
    const previousAssistant = [...messages].reverse().find(m => m.role === 'assistant')
    const previousAssistantText = previousAssistant
      ? (typeof previousAssistant.content === 'string' ? previousAssistant.content : '')
      : undefined

    const isClone = isCloneRequest(userText)
    const voice = extractVoice(userText)
    const language = extractLanguage(userText)
    const textToSpeak = extractTextToSpeak(userText, previousAssistantText)

    try {
      if (isClone) {
        return await this.handleClone(textToSpeak, language, sessionId, onTextChunk)
      }
      return await this.handleSpeak(textToSpeak, voice, language, onTextChunk)
    } catch (err: any) {
      const errorMsg = `Errore nella sintesi vocale: ${err.message || 'errore sconosciuto'}`
      if (onTextChunk) onTextChunk(errorMsg)
      return {
        text: errorMsg,
        toolCalls: [],
        agentName: 'TTS Agent',
        agentDomain: 'tts',
        agentColor: '#FF6F00',
      }
    }
  }

  private async handleSpeak(
    text: string,
    voice: string,
    language: string,
    onTextChunk?: (chunk: string) => void
  ): Promise<AgentResult> {
    const statusMsg = `Genero audio con voce ${voice}...`
    if (onTextChunk) onTextChunk(statusMsg)

    const res = await fetch(`${API_BASE}/tts/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ text, voice, language }),
    })

    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      throw new Error(errData.error || `Errore ${res.status}`)
    }

    const data = await res.json()
    const audioUrl = data.audioUrl

    const responseText = `Audio generato con voce **${voice}** (${language}).`
    if (onTextChunk) {
      onTextChunk('\n\n' + responseText)
    }

    return {
      text: responseText,
      toolCalls: [{
        tool: 'generate_speech',
        result: { audioUrl, voice, language, text: text.substring(0, 100) },
      }],
      agentName: 'TTS Agent',
      agentDomain: 'tts',
      agentColor: '#FF6F00',
    }
  }

  private async handleClone(
    text: string,
    language: string,
    sessionId?: string,
    onTextChunk?: (chunk: string) => void
  ): Promise<AgentResult> {
    const referenceAudio = sessionId ? this.getReferenceAudio(sessionId) : null

    if (!referenceAudio) {
      const msg = 'Per clonare una voce, devi prima allegare un file audio di riferimento. ' +
        'Allega un file audio (MP3, WAV, ecc.) e poi riprova.'
      if (onTextChunk) onTextChunk(msg)
      return {
        text: msg,
        toolCalls: [],
        agentName: 'TTS Agent',
        agentDomain: 'tts',
        agentColor: '#FF6F00',
      }
    }

    const statusMsg = 'Clono la voce dal riferimento audio...'
    if (onTextChunk) onTextChunk(statusMsg)

    const res = await fetch(`${API_BASE}/tts/clone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ text, referenceAudioBase64: referenceAudio, language }),
    })

    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      throw new Error(errData.error || `Errore ${res.status}`)
    }

    const data = await res.json()
    const audioUrl = data.audioUrl

    const responseText = `Audio generato con **voce clonata** (${language}).`
    if (onTextChunk) {
      onTextChunk('\n\n' + responseText)
    }

    return {
      text: responseText,
      toolCalls: [{
        tool: 'generate_speech',
        result: { audioUrl, language, cloned: true, text: text.substring(0, 100) },
      }],
      agentName: 'TTS Agent',
      agentDomain: 'tts',
      agentColor: '#FF6F00',
    }
  }
}

export const ttsAgent = new TTSAgent()
