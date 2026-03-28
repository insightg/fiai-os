const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const MODEL = 'z-ai/glm-5'

interface OpenRouterMessage {
  role: 'system' | 'user'
  content: string | { type: string; text?: string; image_url?: { url: string } }[]
}

async function callLLM(messages: OpenRouterMessage[], jsonMode = false): Promise<string> {
  const body: Record<string, unknown> = {
    model: MODEL,
    messages,
    max_tokens: 4096,
  }
  if (jsonMode) {
    body.response_format = { type: 'json_object' }
  }

  const res = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenRouter error ${res.status}: ${err}`)
  }

  const data = await res.json()
  return data.choices?.[0]?.message?.content ?? ''
}

// ── Invoice Analysis ─────────────────────────────────────

export interface InvoiceRecognitionResult {
  numero_fattura: string
  data: string
  scadenza: string | null
  imponibile: number
  iva: number
  totale: number
  fornitore_ragione_sociale: string
  fornitore_piva: string | null
}

export async function analyzeInvoice(content: string, isImage: boolean, mimeType?: string): Promise<InvoiceRecognitionResult> {
  const systemPrompt = `Sei un esperto nell'analisi di fatture italiane. Estrai i dati dalla fattura e restituisci SOLO un oggetto JSON valido con questa struttura:
{
  "numero_fattura": "stringa",
  "data": "YYYY-MM-DD",
  "scadenza": "YYYY-MM-DD o null",
  "imponibile": numero,
  "iva": numero,
  "totale": numero,
  "fornitore_ragione_sociale": "stringa",
  "fornitore_piva": "stringa o null"
}
Se un campo non è riconoscibile, usa un valore predefinito ragionevole. I numeri devono essere senza simbolo valuta.`

  let messages: OpenRouterMessage[]

  if (isImage) {
    messages = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Analizza questa fattura ed estrai i dati richiesti.' },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${content}` } },
        ],
      },
    ]
  } else {
    messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Analizza questa fattura ed estrai i dati richiesti:\n\n${content}` },
    ]
  }

  const response = await callLLM(messages)
  const jsonMatch = response.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('LLM non ha restituito JSON valido')
  return JSON.parse(jsonMatch[0])
}

// ── Document Analysis ────────────────────────────────────

export interface DocumentAnalysisResult {
  categoria: string
  tags: string[]
  descrizione: string
}

export async function analyzeDocument(text: string, fileName: string): Promise<DocumentAnalysisResult> {
  const systemPrompt = `Analizza il seguente documento e restituisci SOLO un oggetto JSON con:
{
  "categoria": una tra "legale", "pubblicita", "documentazione_tecnica", "normative", "atti", "contratti", "altro",
  "tags": array di 3-5 parole chiave rilevanti,
  "descrizione": breve descrizione del contenuto (max 200 caratteri)
}
Nome file: ${fileName}`

  const messages: OpenRouterMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: text.substring(0, 8000) },
  ]

  const response = await callLLM(messages)
  const jsonMatch = response.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    return { categoria: 'altro', tags: [], descrizione: '' }
  }
  return JSON.parse(jsonMatch[0])
}

// ── Document Search (Agentic) ────────────────────────────

interface DocMetadata {
  id: string
  nome: string
  categoria: string
  descrizione: string | null
  tags: string[] | null
}

export async function searchDocumentsAI(query: string, documents: DocMetadata[]): Promise<string[]> {
  const systemPrompt = `L'utente cerca documenti nel suo archivio aziendale. Data la query e la lista di documenti disponibili, restituisci SOLO un array JSON con gli ID dei documenti rilevanti, ordinati per rilevanza.
Se nessun documento corrisponde, restituisci un array vuoto [].`

  const messages: OpenRouterMessage[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `Query: "${query}"\n\nDocumenti disponibili:\n${JSON.stringify(documents, null, 2)}`,
    },
  ]

  const response = await callLLM(messages)
  const jsonMatch = response.match(/\[[\s\S]*\]/)
  if (!jsonMatch) return []
  return JSON.parse(jsonMatch[0])
}
