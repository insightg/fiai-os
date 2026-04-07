/**
 * FIAI OS — Chunk Auto-Tagger
 *
 * Generates topic tags for document chunks automatically.
 * Two strategies based on document structure:
 *   - Structural: extract from heading_path + first lines (free, instant)
 *   - LLM-assisted: ask model for key concepts (costs, more precise)
 */
import db from './db.js'

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''

// Templates that have good structure → structural tagging
const STRUCTURAL_TEMPLATES = new Set(['legge_it', 'contratto', 'libro_sacro', 'manuale', 'cv'])

// Italian stopwords to filter out
const STOPWORDS = new Set([
  'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'uno', 'una', 'di', 'del', 'della', 'dei', 'delle',
  'a', 'al', 'alla', 'ai', 'alle', 'da', 'dal', 'dalla', 'in', 'nel', 'nella', 'con', 'su', 'sul',
  'per', 'tra', 'fra', 'che', 'chi', 'cui', 'non', 'più', 'anche', 'come', 'dove', 'quando',
  'se', 'ma', 'ed', 'è', 'sono', 'ha', 'hanno', 'essere', 'avere', 'suo', 'sua', 'suoi', 'sue',
  'questo', 'questa', 'quello', 'quella', 'ogni', 'tutto', 'tutti', 'altro', 'altri', 'stesso',
  'si', 'ci', 'ne', 'lo', 'gli', 'li', 'le', 'mi', 'ti', 'vi', 'me', 'te', 'lui', 'lei', 'noi',
  'voi', 'loro', 'dal', 'dello', 'degli', 'allo', 'agli', 'dallo', 'dagli', 'nello', 'negli',
  'sullo', 'sugli', 'col', 'coi', 'articolo', 'comma', 'lettera', 'numero', 'caso', 'norma',
  'disposizione', 'presente', 'seguente', 'primo', 'secondo', 'terzo', 'quanto', 'ovvero',
])

/**
 * Extract tags from heading_path structure.
 * "Libro II - Delle successioni > Titolo I > Capo III > Art. 467"
 * → ["successioni", "libro_II", "capo_III"]
 */
function extractStructuralTags(headingPath: string, text: string): string[] {
  const tags: string[] = []

  // Extract meaningful words from heading path
  const parts = headingPath.split(/[>–\-]/).map(p => p.trim()).filter(Boolean)
  for (const part of parts) {
    // Skip pure numbering like "Art. 467", "Capo III"
    const cleaned = part
      .replace(/^(Art|Libro|Titolo|Capo|Sezione|Capitolo|Cap|Parte)\.\s*/i, '')
      .replace(/^[IVXLCDM]+\s*[-–]\s*/i, '')
      .replace(/^\d+\.\s*/, '')
      .trim()

    if (cleaned.length > 2) {
      // Extract significant words
      const words = cleaned.toLowerCase()
        .split(/\s+/)
        .filter(w => w.length > 3 && !STOPWORDS.has(w))
      tags.push(...words.slice(0, 3))
    }

    // Keep structural markers
    const libroMatch = part.match(/Libro\s+([IVXLCDM]+)/i)
    if (libroMatch) tags.push(`libro_${libroMatch[1]}`)
    const capoMatch = part.match(/Capo\s+([IVXLCDM]+)/i)
    if (capoMatch) tags.push(`capo_${capoMatch[1]}`)
    const titoloMatch = part.match(/Titolo\s+([IVXLCDM]+)/i)
    if (titoloMatch) tags.push(`titolo_${titoloMatch[1]}`)
  }

  // Extract keywords from first 200 chars of text
  const firstLine = text.substring(0, 200).toLowerCase()
  const significantWords = firstLine
    .replace(/[^a-zà-ü\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 4 && !STOPWORDS.has(w))

  // Take top 3 most "interesting" words from the text
  const wordFreq = new Map<string, number>()
  for (const w of significantWords) {
    wordFreq.set(w, (wordFreq.get(w) || 0) + 1)
  }
  const topWords = [...wordFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([w]) => w)
  tags.push(...topWords)

  // Deduplicate
  return [...new Set(tags)].slice(0, 8)
}

/**
 * Generate tags via LLM for unstructured documents.
 * Batch: send N chunks at once to reduce API calls.
 */
async function generateLLMTags(chunks: { id: string; text: string }[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>()
  if (!OPENROUTER_API_KEY) return result

  // Batch chunks into groups of 10
  for (let i = 0; i < chunks.length; i += 10) {
    const batch = chunks.slice(i, i + 10)
    const prompt = batch.map((c, idx) =>
      `[${idx}] ${c.text.substring(0, 300)}`
    ).join('\n\n')

    try {
      const res = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENROUTER_API_KEY}` },
        body: JSON.stringify({
          model: 'anthropic/claude-haiku-4.5',
          messages: [
            { role: 'system', content: 'Per ogni chunk numerato, genera 3-5 tag di concetti chiave in italiano (singole parole, lowercase). Rispondi SOLO con JSON: {"0":["tag1","tag2"],"1":["tag1","tag2"]}' },
            { role: 'user', content: prompt },
          ],
          max_tokens: 500,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        const text = data.choices?.[0]?.message?.content || ''
        const jsonMatch = text.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0])
          for (const [idx, tags] of Object.entries(parsed)) {
            const chunk = batch[parseInt(idx)]
            if (chunk && Array.isArray(tags)) {
              result.set(chunk.id, (tags as string[]).slice(0, 5))
            }
          }
        }
      }
    } catch {}

    // Rate limit
    await new Promise(r => setTimeout(r, 200))
  }

  return result
}

/**
 * Tag all chunks of a document.
 * Called after chunking during upload or re-chunking.
 */
export async function tagDocumentChunks(docId: string): Promise<number> {
  // Get document info to determine template
  const doc = db.prepare("SELECT id, metadata FROM entity WHERE id = ?").get(docId) as any
  if (!doc) return 0

  // Get chunks first (needed for auto-detect)
  const chunks = db.prepare(
    "SELECT id, display_name, body, metadata FROM entity WHERE type = 'chunk' AND parent_id = ?"
  ).all(docId) as any[]
  if (chunks.length === 0) return 0

  const meta = typeof doc.metadata === 'string' ? JSON.parse(doc.metadata) : (doc.metadata || {})
  let templateId = meta.chunk_template || ''

  // Auto-detect template from content if not saved
  if (!templateId) {
    const sampleChunk = chunks[0]
    const sampleMeta = typeof sampleChunk.metadata === 'string' ? JSON.parse(sampleChunk.metadata) : (sampleChunk.metadata || {})
    const heading = sampleMeta.heading_path || sampleChunk.display_name || ''
    const body = sampleChunk.body || ''

    if (/Art\.\s*\d+/i.test(heading) || /LIBRO|TITOLO|CAPO/i.test(heading)) templateId = 'legge_it'
    else if (/Genesi|Esodo|Levitico|Matteo|Marco|Luca|Giovanni|Salmi|Apocalisse/i.test(heading)) templateId = 'libro_sacro'
    else if (/Clausola|Art\.\s*\d+.*contratto/i.test(heading)) templateId = 'contratto'
    else if (/Cap\.\s*\d+|Capitolo/i.test(heading)) templateId = 'manuale'
    else if (meta.categoria === 'legale' || meta.categoria === 'normativa') templateId = 'legge_it'
    else templateId = 'generico'
    console.log(`[Tagger] Auto-detected template: ${templateId} for doc ${doc.id}`)
  }

  const useStructural = STRUCTURAL_TEMPLATES.has(templateId)

  let tagged = 0
  const updateStmt = db.prepare("UPDATE entity SET tags = ? WHERE id = ?")

  if (useStructural) {
    // Structural tagging — instant, free
    const tx = db.transaction(() => {
      for (const chunk of chunks) {
        const chunkMeta = typeof chunk.metadata === 'string' ? JSON.parse(chunk.metadata) : (chunk.metadata || {})
        const headingPath = chunkMeta.heading_path || chunk.display_name || ''
        const tags = extractStructuralTags(headingPath, chunk.body || '')
        if (tags.length > 0) {
          updateStmt.run(JSON.stringify(tags), chunk.id)
          tagged++
        }
      }
    })
    tx()
    console.log(`[Tagger] Structural: tagged ${tagged}/${chunks.length} chunks for doc ${docId} (template: ${templateId})`)
  } else {
    // LLM tagging — costs, but more precise
    const chunkTexts = chunks.map(c => ({
      id: c.id,
      text: (c.display_name || '') + ' ' + (c.body || '').substring(0, 300),
    }))

    const llmTags = await generateLLMTags(chunkTexts)

    const tx = db.transaction(() => {
      for (const chunk of chunks) {
        const tags = llmTags.get(chunk.id)
        if (tags && tags.length > 0) {
          updateStmt.run(JSON.stringify(tags), chunk.id)
          tagged++
        }
      }
    })
    tx()
    console.log(`[Tagger] LLM: tagged ${tagged}/${chunks.length} chunks for doc ${docId} (template: ${templateId})`)
  }

  return tagged
}

/**
 * Tag all untagged chunks in the system (batch job).
 */
export async function tagAllChunks(aziendaId: string): Promise<number> {
  const docs = db.prepare(
    "SELECT DISTINCT parent_id FROM entity WHERE type = 'chunk' AND azienda_id = ? AND (tags IS NULL OR tags = '[]')"
  ).all(aziendaId) as any[]

  let total = 0
  for (const doc of docs) {
    total += await tagDocumentChunks(doc.parent_id)
  }
  return total
}
