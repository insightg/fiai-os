import type { AgentResult } from './types'
import { getAuthToken } from '../supabase'

const API_BASE = import.meta.env.VITE_API_URL || '/api'

const BUILTIN_VOICES = ['Vivian', 'Serena', 'Ryan', 'Dylan', 'Eric', 'Aiden'] as const
const DEFAULT_VOICE = 'Vivian'
const DEFAULT_LANGUAGE = 'Italian'

interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string | object[]
}

interface ClonedVoice {
  name: string
  file?: string
}

interface TTSPreferences {
  defaultVoice: string
  defaultLanguage: string
  clonedVoices: ClonedVoice[]
}

// ── Intent Detection ─────────────────────────────────────

function detectTTSIntent(text: string): 'speak' | 'list_voices' | 'set_voice' | 'clone_start' | 'clone_name' | 'show_settings' | 'delete_voice' {
  const t = text.toLowerCase()
  if (/lista voci|voci disponibili|quali voci|mostra.*voci|elenca.*voci|voices/i.test(t)) return 'list_voices'
  if (/imposta voce|voce predefinita|cambia voce default|default voice|setta voce|usa voce/i.test(t)) return 'set_voice'
  if (/elimina voce|rimuovi voce|cancella voce|delete voice/i.test(t)) return 'delete_voice'
  if (/clona.*voce|voice clon|wizard.*voce|registra.*voce/i.test(t)) return 'clone_start'
  if (/impostazioni tts|settings tts|preferenze voce|configurazione voce/i.test(t)) return 'show_settings'
  if (/con la mia voce|mia voce/i.test(t)) return 'speak' // handled as clone-speak in execute
  return 'speak'
}

function extractVoice(text: string, defaultVoice: string, clonedVoices: ClonedVoice[]): { voice: string; isCloned: boolean } {
  const lower = text.toLowerCase()

  // Check cloned voices first
  for (const cv of clonedVoices) {
    if (lower.includes(cv.name.toLowerCase())) return { voice: cv.name, isCloned: true }
  }

  // Check builtin voices
  for (const voice of BUILTIN_VOICES) {
    if (lower.includes(voice.toLowerCase())) return { voice, isCloned: false }
  }

  // Check if default is a cloned voice
  const isDefaultCloned = clonedVoices.some(cv => cv.name === defaultVoice)
  return { voice: defaultVoice, isCloned: isDefaultCloned }
}

function extractTextToSpeak(userMsg: string, previousAssistantMsg?: string): string {
  const quotedMatch = userMsg.match(/["'«"](.+?)["'»"]/)
  if (quotedMatch) return quotedMatch[1]

  const colonMatch = userMsg.match(/(?:leggi|pronuncia|dì|dire|say|speak|read|con la mia voce)[:\s]+(.{5,})/i)
  if (colonMatch) {
    let text = colonMatch[1]
    text = text.replace(/\s*(?:con voce|voce)\s+\w+\s*/gi, '').trim()
    if (text.length > 3) return text
  }

  const shortCommand = /^(?:leggi(?:lo|la)?|pronuncia(?:lo|la)?|ripeti)\b/i.test(userMsg.trim())
  if (shortCommand && previousAssistantMsg) return previousAssistantMsg.substring(0, 2000)

  let cleaned = userMsg
    .replace(/^(?:leggi|pronuncia|dì|dire|genera audio|sintesi vocale|text.to.speech|tts|leggi ad alta voce|con la mia voce|parla)[:\s]*/i, '')
    .replace(/\s*(?:con voce|voce)\s+\w+\s*/gi, '')
    .replace(/\s*(?:in italiano|in inglese|in francese)\s*/gi, '')
    .trim()

  if (cleaned.length > 3) return cleaned
  if (previousAssistantMsg) return previousAssistantMsg.substring(0, 2000)
  return userMsg
}

function extractLanguage(text: string): string {
  const lower = text.toLowerCase()
  if (/in inglese|english/i.test(lower)) return 'English'
  if (/in francese|french/i.test(lower)) return 'French'
  if (/in spagnolo|spanish/i.test(lower)) return 'Spanish'
  if (/in tedesco|german/i.test(lower)) return 'German'
  return DEFAULT_LANGUAGE
}

function extractVoiceName(text: string): string | null {
  // "imposta voce Gab" → "Gab"
  const match = text.match(/(?:imposta|usa|setta|seleziona|cambia.*(?:a|in))\s+(?:voce\s+)?(\w+)/i)
  if (match) return match[1]
  return null
}

function authHeaders(): Record<string, string> {
  const token = getAuthToken()
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
  }
}

// ── TTS Agent ────────────────────────────────────────────

export class TTSAgent {
  private referenceAudio: Map<string, string> = new Map()
  private pendingCloneName: Map<string, string> = new Map() // sessionId → waiting for name
  private prefs: TTSPreferences = { defaultVoice: DEFAULT_VOICE, defaultLanguage: DEFAULT_LANGUAGE, clonedVoices: [] }

  setReferenceAudio(sessionId: string, base64Audio: string) {
    this.referenceAudio.set(sessionId, base64Audio)
    this.pendingCloneName.set(sessionId, 'pending')
  }

  private async loadPrefs(): Promise<void> {
    try {
      const res = await fetch(`${API_BASE}/context/tts-preferences`, { headers: authHeaders() })
      if (res.ok) {
        const data = await res.json()
        if (data.content) {
          const lines = data.content.split('\n')
          for (const line of lines) {
            const vm = line.match(/Voce predefinita:\s*(.+)/)
            if (vm) this.prefs.defaultVoice = vm[1].trim()
            const lm = line.match(/Lingua predefinita:\s*(.+)/)
            if (lm) this.prefs.defaultLanguage = lm[1].trim()
          }
        }
      }
      // Load cloned voices from server
      const vRes = await fetch(`${API_BASE}/tts/voices`, { headers: authHeaders() })
      if (vRes.ok) {
        const vData = await vRes.json()
        this.prefs.clonedVoices = (vData.cloned || []) as ClonedVoice[]
      }
    } catch { /* silent */ }
  }

  private async savePrefs(): Promise<void> {
    try {
      const content = `# Preferenze TTS\n- Voce predefinita: ${this.prefs.defaultVoice}\n- Lingua predefinita: ${this.prefs.defaultLanguage}`
      await fetch(`${API_BASE}/context/tts-preferences`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ content }),
      })
    } catch { /* silent */ }
  }

  async execute(
    messages: ConversationMessage[],
    onTextChunk?: (chunk: string) => void,
    sessionId?: string
  ): Promise<AgentResult> {
    await this.loadPrefs()

    const lastMsg = messages[messages.length - 1]
    const userText = typeof lastMsg.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg.content)

    // Check if we're waiting for a clone name
    if (sessionId && this.pendingCloneName.get(sessionId) === 'pending') {
      const nameCandidate = userText.trim().replace(/[^a-zA-Z0-9àèìòùÀÈÌÒÙ_-\s]/g, '').trim()
      if (nameCandidate.length >= 2 && nameCandidate.length <= 30 && !/^(si|no|ok|ciao|grazie)$/i.test(nameCandidate)) {
        return await this.handleSaveClonedVoice(nameCandidate, sessionId, onTextChunk)
      }
    }

    const intent = detectTTSIntent(userText)
    const previousAssistant = [...messages].reverse().find(m => m.role === 'assistant')
    const previousText = previousAssistant ? (typeof previousAssistant.content === 'string' ? previousAssistant.content : '') : undefined

    try {
      switch (intent) {
        case 'list_voices': return this.handleListVoices(onTextChunk)
        case 'set_voice': return await this.handleSetVoice(userText, onTextChunk)
        case 'delete_voice': return await this.handleDeleteVoice(userText, onTextChunk)
        case 'clone_start': return this.handleCloneWizard(sessionId, userText, previousText, onTextChunk)
        case 'show_settings': return this.handleShowSettings(onTextChunk)
        case 'speak':
        default: {
          const { voice, isCloned } = extractVoice(userText, this.prefs.defaultVoice, this.prefs.clonedVoices)
          const language = extractLanguage(userText)
          const textToSpeak = extractTextToSpeak(userText, previousText)

          // "con la mia voce" uses session reference audio
          if (/con la mia voce|mia voce/i.test(userText) && sessionId) {
            const refAudio = this.referenceAudio.get(sessionId)
            if (refAudio) return await this.handleCloneSpeak(textToSpeak, language, refAudio, onTextChunk)
          }

          // Use saved cloned voice
          if (isCloned) return await this.handleClonedVoiceSpeak(textToSpeak, voice, language, onTextChunk)

          // Standard TTS
          return await this.handleSpeak(textToSpeak, voice, language, onTextChunk)
        }
      }
    } catch (err: any) {
      const errorMsg = `Errore TTS: ${err.message || 'errore sconosciuto'}`
      if (onTextChunk) onTextChunk(errorMsg)
      return this.result(errorMsg, [])
    }
  }

  private result(text: string, toolCalls: Record<string, unknown>[]): AgentResult {
    return { text, toolCalls, agentName: 'TTS Agent', agentDomain: 'tts', agentColor: '#FF6F00' }
  }

  // ── List Voices ────────────────────────────────────────

  private handleListVoices(onTextChunk?: (chunk: string) => void): AgentResult {
    const builtinList = BUILTIN_VOICES.map(v =>
      v === this.prefs.defaultVoice ? `- **${v}** ★ predefinita` : `- ${v}`
    ).join('\n')

    const clonedList = this.prefs.clonedVoices.length > 0
      ? '\n\n### Voci Clonate\n' + this.prefs.clonedVoices.map(v =>
          v.name === this.prefs.defaultVoice ? `- **${v.name}** ★ predefinita` : `- ${v.name}`
        ).join('\n')
      : ''

    const text = `## Voci Disponibili\n\n### Voci Standard\n${builtinList}${clonedList}\n\n` +
      `Voce attuale: **${this.prefs.defaultVoice}**\n\n` +
      `_"imposta voce Ryan"_ | _"clona voce"_ | _"elimina voce NomeVoce"_`

    if (onTextChunk) onTextChunk(text)
    return this.result(text, [])
  }

  // ── Set Default Voice ──────────────────────────────────

  private async handleSetVoice(userText: string, onTextChunk?: (chunk: string) => void): Promise<AgentResult> {
    const name = extractVoiceName(userText)
    if (!name) {
      const allVoices = [...BUILTIN_VOICES, ...this.prefs.clonedVoices.map(v => v.name)]
      const text = `Voci disponibili: ${allVoices.join(', ')}\n\nEsempio: _"imposta voce Ryan"_`
      if (onTextChunk) onTextChunk(text)
      return this.result(text, [])
    }

    // Check if voice exists (builtin or cloned)
    const allVoices = [...BUILTIN_VOICES.map(v => v.toLowerCase()), ...this.prefs.clonedVoices.map(v => v.name.toLowerCase())]
    const matched = [...BUILTIN_VOICES, ...this.prefs.clonedVoices.map(v => v.name)].find(v => v.toLowerCase() === name.toLowerCase())

    if (!matched) {
      const text = `Voce "${name}" non trovata. Disponibili: ${[...BUILTIN_VOICES, ...this.prefs.clonedVoices.map(v => v.name)].join(', ')}`
      if (onTextChunk) onTextChunk(text)
      return this.result(text, [])
    }

    this.prefs.defaultVoice = matched
    await this.savePrefs()
    const text = `Voce predefinita impostata su **${matched}**.`
    if (onTextChunk) onTextChunk(text)
    return this.result(text, [])
  }

  // ── Delete Voice ───────────────────────────────────────

  private async handleDeleteVoice(userText: string, onTextChunk?: (chunk: string) => void): Promise<AgentResult> {
    const name = extractVoiceName(userText)
    if (!name || !this.prefs.clonedVoices.some(v => v.name.toLowerCase() === name.toLowerCase())) {
      const text = this.prefs.clonedVoices.length > 0
        ? `Voci clonate eliminabili: ${this.prefs.clonedVoices.map(v => v.name).join(', ')}\n\nEsempio: _"elimina voce Gab"_`
        : 'Nessuna voce clonata da eliminare.'
      if (onTextChunk) onTextChunk(text)
      return this.result(text, [])
    }

    await fetch(`${API_BASE}/tts/voice/${name}`, { method: 'DELETE', headers: authHeaders() })
    if (this.prefs.defaultVoice.toLowerCase() === name.toLowerCase()) {
      this.prefs.defaultVoice = DEFAULT_VOICE
      await this.savePrefs()
    }
    const text = `Voce **${name}** eliminata.`
    if (onTextChunk) onTextChunk(text)
    return this.result(text, [])
  }

  // ── Clone Wizard ───────────────────────────────────────

  private handleCloneWizard(sessionId?: string, userText?: string, previousText?: string, onTextChunk?: (chunk: string) => void): AgentResult {
    const refAudio = sessionId ? this.referenceAudio.get(sessionId) : null

    if (refAudio && userText) {
      const textToSpeak = extractTextToSpeak(userText, previousText)
      if (textToSpeak && textToSpeak.length > 3 && !/clona.*voce|wizard/i.test(textToSpeak)) {
        // Has audio + text → do the clone
        return this.handleCloneSpeak(textToSpeak, extractLanguage(userText), refAudio, onTextChunk) as any
      }
    }

    let text: string
    if (refAudio) {
      text = `## Clonazione Voce\n\n` +
        `Audio di riferimento ricevuto.\n\n` +
        `**Come vuoi chiamare questa voce?** Scrivi un nome (es. "Gab", "Marco", "MiaVoce").\n\n` +
        `Il nome verrà salvato e potrai usare questa voce in futuro.`
    } else {
      text = `## Clonazione Voce\n\n` +
        `Per clonare una voce:\n\n` +
        `1. Clicca il **microfono** 🎤 e registra almeno 3 secondi di parlato\n` +
        `2. Conferma e invia la registrazione\n` +
        `3. Ti chiederò un **nome** per la voce\n` +
        `4. Poi potrai usarla: _"leggi con voce Gab: testo"_\n\n` +
        `**Requisiti:** parlato chiaro, senza rumori, una sola voce.`
    }

    if (onTextChunk) onTextChunk(text)
    return this.result(text, [])
  }

  // ── Save Cloned Voice ──────────────────────────────────

  private async handleSaveClonedVoice(name: string, sessionId: string, onTextChunk?: (chunk: string) => void): Promise<AgentResult> {
    const refAudio = this.referenceAudio.get(sessionId)
    if (!refAudio) {
      const text = 'Audio di riferimento non trovato. Registra prima un audio.'
      if (onTextChunk) onTextChunk(text)
      return this.result(text, [])
    }

    if (onTextChunk) onTextChunk(`Salvo la voce "${name}"...`)

    const res = await fetch(`${API_BASE}/tts/save-voice`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ name, audioBase64: refAudio }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Errore salvataggio' }))
      throw new Error(err.error)
    }

    const data = await res.json()
    this.pendingCloneName.delete(sessionId)

    const text = `Voce **${data.name}** salvata con successo!\n\n` +
      `Ora puoi usarla:\n` +
      `- _"leggi con voce ${data.name}: testo"_\n` +
      `- _"imposta voce ${data.name}"_ per renderla predefinita\n` +
      `- _"lista voci"_ per vedere tutte le voci`

    if (onTextChunk) onTextChunk('\n\n' + text)
    return this.result(text, [])
  }

  // ── Speak with cloned voice (from session ref audio) ───

  private async handleCloneSpeak(text: string, language: string, refAudio: string, onTextChunk?: (chunk: string) => void): Promise<AgentResult> {
    if (onTextChunk) onTextChunk('Genero audio con voce clonata...')

    const res = await fetch(`${API_BASE}/tts/clone`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ text, referenceAudioBase64: refAudio, language }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      throw new Error(err.error || `Errore ${res.status}`)
    }

    const data = await res.json()
    const responseText = 'Audio generato con **voce clonata**.'
    if (onTextChunk) onTextChunk('\n\n' + responseText)
    return this.result(responseText, [{ tool: 'generate_speech', result: { audioUrl: data.audioUrl, language, cloned: true, text: text.substring(0, 100) } }])
  }

  // ── Speak with saved cloned voice ──────────────────────

  private async handleClonedVoiceSpeak(text: string, voiceName: string, language: string, onTextChunk?: (chunk: string) => void): Promise<AgentResult> {
    const responseText = `Genero audio con voce **${voiceName}**...`
    if (onTextChunk) onTextChunk(responseText)

    return this.result(responseText, [{
      tool: 'generate_speech',
      result: {
        streamUrl: `${API_BASE}/tts/stream`,
        streamBody: { text, voiceName, language },
        voice: voiceName,
        language,
        cloned: true,
        streaming: true,
        text: text.substring(0, 100),
      },
    }])
  }

  // ── Standard Speak ─────────────────────────────────────

  private async handleSpeak(text: string, voice: string, language: string, onTextChunk?: (chunk: string) => void): Promise<AgentResult> {
    // Return IMMEDIATELY with streaming params — the AudioPlayer will do the actual fetch+streaming
    const responseText = `Genero audio con voce **${voice}**...`
    if (onTextChunk) onTextChunk(responseText)

    return this.result(responseText, [{
      tool: 'generate_speech',
      result: {
        // Pass stream config — AudioPlayer will POST to this endpoint itself
        streamUrl: `${API_BASE}/tts/stream`,
        streamBody: { text, voice, language },
        voice,
        language,
        streaming: true,
        text: text.substring(0, 100),
      },
    }])
  }

  // ── Show Settings ──────────────────────────────────────

  private handleShowSettings(onTextChunk?: (chunk: string) => void): AgentResult {
    const allVoices = [...BUILTIN_VOICES, ...this.prefs.clonedVoices.map(v => `${v.name} (clonata)`)]
    const text = `## Impostazioni TTS\n\n` +
      `- **Voce predefinita:** ${this.prefs.defaultVoice}\n` +
      `- **Lingua:** ${this.prefs.defaultLanguage}\n` +
      `- **Voci standard:** ${BUILTIN_VOICES.join(', ')}\n` +
      `- **Voci clonate:** ${this.prefs.clonedVoices.length > 0 ? this.prefs.clonedVoices.map(v => v.name).join(', ') : 'nessuna'}\n\n` +
      `**Comandi:**\n` +
      `- _"lista voci"_ — tutte le voci\n` +
      `- _"imposta voce NomeVoce"_ — cambia default\n` +
      `- _"clona voce"_ — crea voce da registrazione\n` +
      `- _"elimina voce NomeVoce"_ — rimuovi voce clonata\n` +
      `- _"leggi: testo"_ — genera audio\n` +
      `- _"leggi con voce Serena: testo"_ — voce specifica`

    if (onTextChunk) onTextChunk(text)
    return this.result(text, [])
  }
}

export const ttsAgent = new TTSAgent()
