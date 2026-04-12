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
  "categoria": una tra "legale", "pubblicita", "documentazione_tecnica", "normative", "atti", "contratti", "amministrazione", "hr", "altro",
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

// ── Generate Search Query Variants ──────────────────────

export async function generateSearchQueries(originalQuery: string): Promise<string[]> {
  const systemPrompt = `Genera 3 varianti di query di ricerca full-text (FTS5) per la seguente richiesta utente.
Le query devono essere ottimizzate per SQLite FTS5. Restituisci SOLO un array JSON di 3 stringhe.
Esempio: ["contratto fornitura", "accordo fornitore servizi", "contratti approvvigionamento"]
Non usare operatori speciali FTS5, solo parole chiave semplici.`

  const messages: OpenRouterMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: originalQuery },
  ]

  try {
    const response = await callLLM(messages)
    const jsonMatch = response.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return [originalQuery]
    const queries = JSON.parse(jsonMatch[0]) as string[]
    return queries.length > 0 ? queries.slice(0, 3) : [originalQuery]
  } catch {
    return [originalQuery]
  }
}

// ── Synthesize Answer from Documents ────────────────────

export async function synthesizeFromDocuments(query: string, docs: { nome?: string; descrizione?: string; contenuto_testo?: string; categoria?: string }[]): Promise<string> {
  if (docs.length === 0) return 'Nessun documento trovato per la ricerca.'

  const docSummaries = docs.slice(0, 5).map((d, i) => {
    const content = d.contenuto_testo ? d.contenuto_testo.substring(0, 2000) : ''
    return `--- Documento ${i + 1}: ${d.nome || 'Senza nome'} (${d.categoria || 'n/d'}) ---\nDescrizione: ${d.descrizione || 'N/D'}\nContenuto: ${content || 'Non disponibile'}`
  }).join('\n\n')

  const systemPrompt = `Sei un assistente documentale aziendale. Data una query e i documenti trovati, fornisci una sintesi chiara e utile.
Rispondi in italiano. Cita i nomi dei documenti quando fai riferimento a contenuti specifici.
Se i documenti non contengono informazioni rilevanti per la query, dillo chiaramente.`

  const messages: OpenRouterMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Query: "${query}"\n\nDocumenti trovati:\n${docSummaries}` },
  ]

  try {
    return await callLLM(messages)
  } catch {
    return 'Impossibile generare la sintesi dei documenti.'
  }
}

// ── Summarize Document Text ─────────────────────────────

export async function summarizeText(text: string, docName: string): Promise<{ summary: string; keyInfo: Record<string, string> }> {
  const systemPrompt = `Sei un esperto nell'analisi documentale. Dato il testo di un documento, genera:
1. Un riassunto chiaro e conciso (max 500 parole)
2. Le informazioni chiave estratte

Restituisci SOLO un oggetto JSON con questa struttura:
{
  "summary": "riassunto del documento",
  "keyInfo": {
    "date": "date rilevanti trovate",
    "parti": "parti coinvolte",
    "importi": "importi e valori monetari",
    "obblighi": "obblighi e scadenze principali",
    "oggetto": "oggetto/tema principale"
  }
}
Ometti i campi keyInfo che non sono presenti nel documento. Rispondi in italiano.`

  const messages: OpenRouterMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Documento: "${docName}"\n\nTesto:\n${text.substring(0, 12000)}` },
  ]

  try {
    const response = await callLLM(messages)
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { summary: 'Impossibile generare il riassunto.', keyInfo: {} }
    return JSON.parse(jsonMatch[0])
  } catch {
    return { summary: 'Errore nella generazione del riassunto.', keyInfo: {} }
  }
}

// ── Compare Two Documents ───────────────────────────────

export async function compareDocuments(
  doc1: { nome: string; contenuto_testo: string },
  doc2: { nome: string; contenuto_testo: string }
): Promise<{ similarities: string[]; differences: string[]; summary: string }> {
  const systemPrompt = `Sei un esperto nell'analisi comparativa di documenti. Confronta i due documenti e restituisci SOLO un oggetto JSON:
{
  "similarities": ["elenco somiglianze principali"],
  "differences": ["elenco differenze principali"],
  "summary": "sintesi del confronto in 2-3 frasi"
}
Rispondi in italiano.`

  const messages: OpenRouterMessage[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `Documento 1: "${doc1.nome}"\n${doc1.contenuto_testo.substring(0, 6000)}\n\n---\n\nDocumento 2: "${doc2.nome}"\n${doc2.contenuto_testo.substring(0, 6000)}`,
    },
  ]

  try {
    const response = await callLLM(messages)
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { similarities: [], differences: [], summary: 'Impossibile confrontare i documenti.' }
    return JSON.parse(jsonMatch[0])
  } catch {
    return { similarities: [], differences: [], summary: 'Errore nel confronto documenti.' }
  }
}

// ── Retrieval Judge (Agentic RAG) ─────────────────────────

export async function judgeRetrieval(query: string, chunks: { display_name: string; content: string }[]): Promise<{ sufficient: boolean; score: number; refine_query?: string }> {
  if (chunks.length === 0) return { sufficient: false, score: 0, refine_query: query }

  try {
    const chunkSummary = chunks.slice(0, 5).map((c, i) =>
      `[${i}] ${c.display_name}: ${c.content.substring(0, 300)}`
    ).join('\n')

    const result = await callLLM([{
      role: 'user',
      content: `Query: "${query}"\n\nChunk trovati:\n${chunkSummary}\n\nI chunk rispondono alla query? Rispondi SOLO JSON:\n{"sufficient": true/false, "score": 1-5, "refine_query": "query migliorata se score < 3"}`
    }], true)

    const match = result.match(/\{[\s\S]*\}/)
    if (!match) return { sufficient: chunks.length > 0, score: 3 }
    const parsed = JSON.parse(match[0])
    return {
      sufficient: parsed.sufficient ?? (parsed.score >= 3),
      score: parsed.score ?? 3,
      refine_query: parsed.refine_query,
    }
  } catch {
    return { sufficient: chunks.length > 0, score: 3 }
  }
}

// ── Smart Upload Analysis ─────────────────────────────────

// ── Reranker (Retrieve-then-Rerank) ───────────────────────

export async function rerankChunks(
  query: string,
  chunks: { id: string; display_name: string; content: string; [key: string]: any }[],
  topK: number = 5
): Promise<typeof chunks> {
  if (chunks.length <= topK) return chunks

  try {
    const chunkSummary = chunks.map((c, i) =>
      `[${i}] ${c.display_name}: ${c.content.substring(0, 200)}`
    ).join('\n')

    const result = await callLLM([{
      role: 'user',
      content: `Query: "${query}"\n\nChunk:\n${chunkSummary}\n\nOrdina gli indici per rilevanza rispetto alla query. Rispondi SOLO con un array JSON di indici, dal più rilevante al meno: [2, 0, 4, ...]`
    }])

    const match = result.match(/\[[\d,\s]+\]/)
    if (match) {
      const indices: number[] = JSON.parse(match[0])
      return indices
        .filter(i => i >= 0 && i < chunks.length)
        .slice(0, topK)
        .map(i => chunks[i])
    }
  } catch {}

  // Fallback: return first topK
  return chunks.slice(0, topK)
}

export interface UploadAnalysis {
  entity_type: string        // fattura_passiva, contratto, cv, preventivo, report, foto, documento
  display_name: string       // nome suggerito
  suggested_name: string | null  // nome azienda/persona da collegare
  categoria: string
  tags: string[]
  descrizione: string
  extracted_data: Record<string, unknown>  // dati strutturati (numero, data, totale, piva...)
}

export async function analyzeUpload(
  content: string,
  fileName: string,
  isImage: boolean,
  mimeType?: string,
  customCategories?: { name: string; description: string; keywords: string[] }[]
): Promise<UploadAnalysis> {
  const defaultResult: UploadAnalysis = {
    entity_type: 'documento',
    display_name: fileName,
    suggested_name: null,
    categoria: 'altro',
    tags: [],
    descrizione: '',
    extracted_data: {},
  }

  try {
    const prompt = `Analyze this file and classify it. The document may be in ANY language (Italian, English, German, French, etc.). Always respond in Italian with a valid JSON.

FILE: ${fileName}
MIME: ${mimeType || 'unknown'}
${isImage ? 'This is an image file.' : ''}

${customCategories?.length ? `\nCUSTOM CATEGORIES:\n${customCategories.map(c => `- ${c.name}: ${c.description} (keywords: ${c.keywords.join(', ')})`).join('\n')}\n` : ''}
${!isImage ? `CONTENT (first 3000 chars):
${content.substring(0, 3000)}` : ''}

Respond with ONLY this JSON (no other text):
{
  "entity_type": "fattura_passiva|contratto|cv|preventivo|report|foto|audio|documento",
  "display_name": "human-readable document name in Italian (e.g. 'Fattura RunPod - 04/03/2026')",
  "suggested_name": "main company or person name mentioned (null if not identifiable)",
  "categoria": "amministrazione|legale|hr|commerciale|marketing|produzione|normative|contratti|documentazione_tecnica|fatture|altro${customCategories?.length ? '|' + customCategories.map(c => c.name).join('|') : ''}",
  "tags": ["tag1", "tag2", "tag3"],
  "descrizione": "brief description of the content in Italian",
  "extracted_data": {
    "numero": "document/invoice number if present",
    "data": "date in YYYY-MM-DD format if present",
    "totale": 0.00,
    "fornitore": "supplier/vendor name if invoice",
    "piva": "VAT/Tax ID if present",
    "email": "email if present",
    "telefono": "phone if present",
    "nome_persona": "person name if CV/contact",
    "autore": "document author if identifiable"
  },
  "chunk_strategy": "by_article|by_chapter|by_section|by_paragraph|by_page|by_verse|by_heading|none"
}

CLASSIFICATION RULES:
- "fattura_passiva": invoices, receipts, bills with amounts (ANY language — look for: Invoice, Fattura, Rechnung, Facture, total, amount, $, €)
- "contratto": agreements, contracts with clauses
- "cv": resumes, CVs with skills/experience
- "preventivo": quotes, proposals, estimates
- "report": reports, analyses with data/charts
- "foto": images without significant text
- "documento": everything else
- extracted_data: include ONLY fields you can extract from content
- display_name: ALWAYS in Italian, translate if needed (e.g. "Invoice" → "Fattura")
- tags: mix of Italian and original language terms for searchability
- chunk_strategy:
  "by_article" for laws/codes with numbered articles
  "by_chapter" for books with chapters
  "by_section" for contracts/manuals with numbered sections
  "by_paragraph" for narrative/essay text
  "by_page" for reports/mixed documents
  "by_verse" for religious/poetic texts with verses
  "by_heading" for technical docs with markdown headings
  "none" for short documents (<5 pages) or images`

    const messages: OpenRouterMessage[] = isImage
      ? [{ role: 'user', content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: content } }
        ] }]
      : [{ role: 'user', content: prompt }]

    let result = await callLLM(messages, true)
    let jsonMatch = result.match(/\{[\s\S]*\}/)

    // Retry once if empty or no JSON
    if (!jsonMatch || !result.trim()) {
      console.warn(`[AnalyzeUpload] Empty/no-JSON response for "${fileName}", retrying...`)
      result = await callLLM(messages, false) // retry without json_mode
      jsonMatch = result.match(/\{[\s\S]*\}/)
    }

    if (!jsonMatch) {
      console.warn(`[AnalyzeUpload] Failed after retry for "${fileName}":`, result.substring(0, 200))
      return defaultResult
    }

    const parsed = JSON.parse(jsonMatch[0]) as UploadAnalysis
    return {
      entity_type: parsed.entity_type || 'documento',
      display_name: parsed.display_name || fileName,
      suggested_name: parsed.suggested_name || null,
      categoria: parsed.categoria || 'altro',
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      descrizione: parsed.descrizione || '',
      extracted_data: parsed.extracted_data || {},
    }
  } catch (err: any) {
    console.error(`[AnalyzeUpload] Error for "${fileName}":`, err.message?.substring(0, 100))
    return defaultResult
  }
}
