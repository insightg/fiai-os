import type { AgentResult } from './types'

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'
const OPENROUTER_API_KEY = import.meta.env.VITE_OPENROUTER_API_KEY ?? ''
const GEMINI_MODEL = 'google/gemini-3.1-flash-image-preview'

interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string | object[]
}

async function callGemini(messages: any[], retries = 3): Promise<any> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: GEMINI_MODEL,
        messages,
        max_tokens: 4096,
      }),
    })

    if (res.status === 429 && attempt < retries - 1) {
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)))
      continue
    }

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Errore Gemini: ${err}`)
    }

    const data = await res.json()
    if (data.error && attempt < retries - 1) {
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)))
      continue
    }
    return data
  }
  throw new Error('Gemini: troppi tentativi falliti')
}

// Detect if the user wants to analyze an existing image vs generate a new one
function isAnalysisRequest(text: string): boolean {
  const t = text.toLowerCase()
  return /analizz|descri|cosa (vedi|c'è|contiene)|spiega.*immag|interpreta|riconosc|identifica|leggi.*immag|esamina/i.test(t)
}

export class ImageAgent {
  // Store generated images per session for context
  private imageHistory: Map<string, string[]> = new Map()

  addImageToHistory(sessionId: string, imageUrl: string) {
    const existing = this.imageHistory.get(sessionId) || []
    existing.push(imageUrl)
    this.imageHistory.set(sessionId, existing)
  }

  getLastImage(sessionId: string): string | null {
    const images = this.imageHistory.get(sessionId)
    return images && images.length > 0 ? images[images.length - 1] : null
  }

  async execute(
    messages: ConversationMessage[],
    onTextChunk?: (chunk: string) => void,
    sessionId?: string
  ): Promise<AgentResult> {
    const lastMsg = messages[messages.length - 1]
    const prompt = typeof lastMsg.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg.content)

    const analyzing = isAnalysisRequest(prompt)
    const lastImage = sessionId ? this.getLastImage(sessionId) : null

    if (analyzing && lastImage) {
      // ── ANALYSIS MODE: send image to Gemini for vision analysis ──
      return this.analyzeImage(prompt, lastImage, onTextChunk)
    }

    // ── GENERATION MODE: create new image ──
    return this.generateImage(prompt, messages, onTextChunk, sessionId)
  }

  private async analyzeImage(
    prompt: string,
    imageUrl: string,
    onTextChunk?: (chunk: string) => void
  ): Promise<AgentResult> {
    const geminiMessages = [
      {
        role: 'system',
        content: "Sei un analista visivo esperto. Analizza l'immagine fornita e rispondi in italiano in modo dettagliato e professionale.",
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      },
    ]

    const data = await callGemini(geminiMessages)
    const text = data.choices?.[0]?.message?.content ?? 'Non sono riuscito ad analizzare l\'immagine.'

    if (onTextChunk) {
      for (let i = 0; i < text.length; i += 3) {
        onTextChunk(text.slice(i, i + 3))
        await new Promise(r => setTimeout(r, 8))
      }
    }

    return {
      text,
      toolCalls: [{ tool: 'analyze_image', result: { analyzed: true } }],
      agentName: 'Vision Analyst',
      agentDomain: 'image',
      agentColor: '#9C27B0', // purple for analysis
    }
  }

  private async generateImage(
    prompt: string,
    messages: ConversationMessage[],
    onTextChunk?: (chunk: string) => void,
    sessionId?: string
  ): Promise<AgentResult> {
    // Check if this is a rework request referencing a previous image
    const lastImage = sessionId ? this.getLastImage(sessionId) : null
    const isRework = lastImage && /modifica|cambia|rifai|migliora|aggiungi|togli|rielabora|trasforma/i.test(prompt)

    let geminiMessages: any[]

    if (isRework && lastImage) {
      // Rework: send the previous image + modification request
      geminiMessages = [
        {
          role: 'system',
          content: "Sei un generatore e editor di immagini. Modifica l'immagine esistente secondo le istruzioni dell'utente.",
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: lastImage } },
          ],
        },
      ]
    } else {
      // Fresh generation
      geminiMessages = [
        {
          role: 'system',
          content: "Sei un generatore di immagini. Crea l'immagine richiesta dall'utente.",
        },
        { role: 'user', content: prompt },
      ]
    }

    const data = await callGemini(geminiMessages)
    const msg = data.choices?.[0]?.message
    const images = msg?.images ?? []
    const textContent = msg?.content ?? ''

    const imageUrls: string[] = images.map((img: any) => {
      if (img.image_url?.url) return img.image_url.url
      if (typeof img === 'string') return img
      return ''
    }).filter(Boolean)

    // Store generated images for future analysis/rework
    if (sessionId && imageUrls.length > 0) {
      for (const url of imageUrls) {
        this.addImageToHistory(sessionId, url)
      }
    }

    const responseText = textContent || (isRework ? 'Ecco l\'immagine modificata:' : 'Ecco l\'immagine generata:')

    const toolCalls = imageUrls.map((url, i) => ({
      tool: 'generate_image',
      result: { image_url: url, index: i },
    }))

    if (onTextChunk && responseText) {
      onTextChunk(responseText)
    }

    return {
      text: responseText,
      toolCalls,
      agentName: isRework ? 'Image Editor' : 'Image Generator',
      agentDomain: 'image',
      agentColor: '#E91E63',
    }
  }
}

export const imageAgent = new ImageAgent()
