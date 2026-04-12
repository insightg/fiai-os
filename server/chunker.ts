/**
 * FIAI OS — Document Chunker
 *
 * Splits documents into chunks using template-based strategies.
 * Templates are matched by entity_type, filename patterns, and content patterns.
 */

// ── Types ────────────────────────────────────────────────

export interface ChunkResult {
  display_name: string
  content: string
  chunk_index: number
  chunk_total?: number  // filled after chunking
  heading_path: string
  char_offset_start: number
  char_offset_end: number
  extracted?: Record<string, string>
}

interface HeadingLevel {
  pattern: RegExp
  name: string
}

interface ChunkTemplate {
  id: string
  name: string
  match: {
    entity_types?: string[]
    content_patterns?: RegExp[]
  }
  split: {
    primary: RegExp | 'paragraph' | 'heading' | 'page' | 'none'
    min_chunk_size: number
    max_chunk_size: number
    overlap: number
  }
  heading: {
    levels: HeadingLevel[]
  }
  extract?: Record<string, RegExp>
}

// ── Templates ────────────────────────────────────────────

const TEMPLATES: ChunkTemplate[] = [
  // ── Legislazione italiana ──
  {
    id: 'legge_it',
    name: 'Legislazione italiana',
    match: {
      entity_types: ['normativa'],
      content_patterns: [/^Art\.\s*\d+/m, /TITOLO\s+[IVXLCDM]+/m],
    },
    split: {
      primary: /^Art\.\s*\d+[.\s\-–]/m,
      min_chunk_size: 50,
      max_chunk_size: 3000,
      overlap: 0,
    },
    heading: {
      levels: [
        { pattern: /LIBRO\s+([IVXLCDM]+[^\n]*)/i, name: 'Libro' },
        { pattern: /TITOLO\s+([IVXLCDM]+[^\n]*)/i, name: 'Titolo' },
        { pattern: /CAPO\s+([IVXLCDM]+[^\n]*)/i, name: 'Capo' },
        { pattern: /SEZIONE\s+([IVXLCDM]+[^\n]*)/i, name: 'Sezione' },
        { pattern: /Art\.\s*(\d+[^\n]*)/i, name: 'Art.' },
      ],
    },
    extract: { numero: /Art\.\s*(\d+)/ },
  },

  // ── Contratto ──
  {
    id: 'contratto',
    name: 'Contratto',
    match: {
      entity_types: ['contratto'],
      content_patterns: [/(?:^|\n)\d+\.\s+[A-Z]/m, /PREMESSO|TRA LE PARTI|CLAUSOL/i],
    },
    split: {
      primary: /(?:^|\n)(?:\d+\.\s+[A-Z]|Art(?:icolo)?\.\s*\d+)/m,
      min_chunk_size: 100,
      max_chunk_size: 3000,
      overlap: 0,
    },
    heading: {
      levels: [
        { pattern: /(?:PREMESS[OA]|TRA LE PARTI|OGGETTO|DURATA|CORRISPETTIVO|RECESSO|CLAUSOL[AE])\s*([^\n]*)/i, name: 'Sezione' },
        { pattern: /(?:^|\n)(\d+\.)\s+/m, name: 'Clausola' },
      ],
    },
  },

  // ── CV / Curriculum ──
  {
    id: 'cv',
    name: 'Curriculum Vitae',
    match: {
      entity_types: ['cv'],
      content_patterns: [/ESPERIENZA|FORMAZIONE|COMPETENZE|ISTRUZIONE/i],
    },
    split: {
      primary: /(?:^|\n)(?:ESPERIENZA|FORMAZIONE|COMPETENZE|ISTRUZIONE|LINGUE|CERTIFICAZIONI|PROFILO|OBIETTIVI?)\s*(?:PROFESSIONALE|LAVORATIVA)?/im,
      min_chunk_size: 100,
      max_chunk_size: 2000,
      overlap: 0,
    },
    heading: {
      levels: [
        { pattern: /(ESPERIENZA[^\n]*|FORMAZIONE[^\n]*|COMPETENZE[^\n]*|ISTRUZIONE[^\n]*|LINGUE[^\n]*|PROFILO[^\n]*)/i, name: '' },
      ],
    },
  },

  // ── Libro sacro ──
  {
    id: 'libro_sacro',
    name: 'Testo sacro',
    match: {
      content_patterns: [/Genesi|Esodo|Levitico|Salmo|Vangelo|Capitolo\s+\d+/i],
    },
    split: {
      primary: /(?:^|\n)(?:Capitolo|Cap\.)\s+\d+/im,
      min_chunk_size: 200,
      max_chunk_size: 2000,
      overlap: 100,
    },
    heading: {
      levels: [
        { pattern: /(Genesi|Esodo|Levitico|Numeri|Deuteronomio|Salm[oi]|Proverbi|Vangelo[^\n]*|Atti[^\n]*|Lettera[^\n]*|Apocalisse)/i, name: 'Libro' },
        { pattern: /(?:Capitolo|Cap\.)\s+(\d+)/i, name: 'Capitolo' },
      ],
    },
  },

  // ── Versetti (Bibbia, testi sacri con numerazione) ──
  {
    id: 'versetto',
    name: 'Per versetto',
    match: {
      // Don't auto-match — only used when explicitly selected via by_verse strategy
    },
    split: {
      // Split on verse numbers: "1 In principio", "15 E il Signore"
      // Matches a number at start of line followed by text
      primary: /(?:^|\n)\s*(\d{1,3})\s+(?=[A-ZÀ-Ü])/m,
      min_chunk_size: 30,
      max_chunk_size: 1500,
      overlap: 0,
    },
    heading: {
      levels: [
        { pattern: /(Genesi|Esodo|Levitico|Numeri|Deuteronomio|Giosuè|Giudici|Rut|Samuele|Re|Cronache|Esdra|Neemia|Tobia|Giuditta|Ester|Maccabei|Giobbe|Salm[oi]|Proverbi|Qoelet|Cantico|Sapienza|Siracide|Isaia|Geremia|Lamentazioni|Baruc|Ezechiele|Daniele|Osea|Gioele|Amos|Abdia|Giona|Michea|Naum|Abacuc|Sofonia|Aggeo|Zaccaria|Malachia|Matteo|Marco|Luca|Giovanni|Atti|Romani|Corinzi|Galati|Efesini|Filippesi|Colossesi|Tessalonicesi|Timoteo|Tito|Filemone|Ebrei|Giacomo|Pietro|Giuda|Apocalisse)[^\n]*/i, name: '' },
        { pattern: /(?:Capitolo|Cap\.)\s+(\d+)/i, name: 'Cap.' },
      ],
    },
  },

  // ── Narrativa (romanzi) ──
  {
    id: 'narrativa',
    name: 'Narrativa',
    match: {
      content_patterns: [/(?:CAPITOLO|Capitolo|Cap\.)\s+[IVXLCDM\d]+/m],
    },
    split: {
      primary: 'paragraph',
      min_chunk_size: 500,
      max_chunk_size: 2000,
      overlap: 200,
    },
    heading: {
      levels: [
        { pattern: /(?:CAPITOLO|Capitolo|Cap\.)\s+([IVXLCDM\d]+[^\n]*)/m, name: 'Capitolo' },
      ],
    },
  },

  // ── Poesia / Divina Commedia ──
  {
    id: 'poesia',
    name: 'Poesia',
    match: {
      content_patterns: [/Canto\s+[IVXLCDM]+/i, /strofa|verso\s+\d+/i],
    },
    split: {
      primary: /(?:^|\n)(?:Canto|CANTO)\s+[IVXLCDM]+/m,
      min_chunk_size: 200,
      max_chunk_size: 1500,
      overlap: 0,
    },
    heading: {
      levels: [
        { pattern: /(Inferno|Purgatorio|Paradiso)/i, name: 'Cantica' },
        { pattern: /(?:Canto|CANTO)\s+([IVXLCDM]+)/i, name: 'Canto' },
      ],
    },
  },

  // ── Manuale / documentazione tecnica ──
  {
    id: 'manuale',
    name: 'Documentazione tecnica',
    match: {
      entity_types: ['documentazione_tecnica', 'manuale'],
      content_patterns: [/^#{1,3}\s+/m],
    },
    split: {
      primary: 'heading',
      min_chunk_size: 200,
      max_chunk_size: 2000,
      overlap: 100,
    },
    heading: {
      levels: [
        { pattern: /^#\s+(.+)/m, name: '' },
        { pattern: /^##\s+(.+)/m, name: '' },
        { pattern: /^###\s+(.+)/m, name: '' },
      ],
    },
  },
]

// ── Generic fallback template ────────────────────────────

const GENERIC_TEMPLATE: ChunkTemplate = {
  id: 'generico',
  name: 'Generico',
  match: {},
  split: {
    primary: 'paragraph',
    min_chunk_size: 300,
    max_chunk_size: 2000,
    overlap: 200,
  },
  heading: { levels: [] },
}

// ── Page template ───────────────────────────────────────

const PAGE_TEMPLATE: ChunkTemplate = {
  id: 'pagina',
  name: 'Per pagina',
  match: {},
  split: { primary: 'page', min_chunk_size: 50, max_chunk_size: 5000, overlap: 0 },
  heading: { levels: [] },
}

// ── Strategy → Template mapping ─────────────────────────

function getTemplateForStrategy(strategy: string): ChunkTemplate {
  const map: Record<string, string> = {
    'by_article': 'legge_it',
    'by_chapter': 'libro_sacro',
    'by_section': 'contratto',
    'by_verse': 'versetto',
    'by_heading': 'manuale',
  }
  if (strategy === 'by_page') return PAGE_TEMPLATE
  if (strategy === 'by_paragraph') return GENERIC_TEMPLATE
  if (strategy === 'none') return { ...GENERIC_TEMPLATE, split: { ...GENERIC_TEMPLATE.split, primary: 'none' } }
  const templateId = map[strategy]
  if (templateId) {
    const found = TEMPLATES.find(t => t.id === templateId)
    if (found) return found
  }
  return GENERIC_TEMPLATE
}

// ── Page chunker ────────────────────────────────────────

function chunkByPage(text: string): ChunkResult[] {
  const pages = text.split(/\f/).filter(p => p.trim().length > 0)
  if (pages.length <= 1) return []

  let offset = 0
  return pages.map((pageContent, i) => {
    const start = offset
    offset += pageContent.length + 1 // +1 for \f
    return {
      display_name: `Pagina ${i + 1}`,
      content: pageContent.trim(),
      chunk_index: i,
      heading_path: `Pagina ${i + 1}`,
      char_offset_start: start,
      char_offset_end: start + pageContent.length,
    }
  })
}

// ── Main Chunker ─────────────────────────────────────────

export function chunkDocument(text: string, entityType: string, filename: string, strategy?: string): ChunkResult[] {
  // Select template: explicit strategy or auto-detect
  let template: ChunkTemplate

  if (strategy && strategy !== 'auto') {
    if (strategy === 'none') return []
    template = getTemplateForStrategy(strategy)
    console.log(`[Chunker] Using strategy "${strategy}" → template "${template.id}"`)
  } else {
    if (text.length < 50) return [] // Too short to chunk at all (basically empty)
    if (text.length < 10000) {
      // Small document: single chunk with full content
      console.log(`[Chunker] Small doc (${text.length} chars), creating single chunk`)
      return [{
        display_name: filename?.replace(/\.[^.]+$/, '') || 'Documento',
        content: text,
        chunk_index: 0,
        chunk_total: 1,
        heading_path: '',
        char_offset_start: 0,
        char_offset_end: text.length,
      }]
    }
    template = findTemplate(text, entityType)
    console.log(`[Chunker] Auto-detected template "${template.id}"`)
  }

  let chunks: ChunkResult[]

  if (template.split.primary === 'none') {
    return []
  } else if (template.split.primary === 'page') {
    chunks = chunkByPage(text)
  } else if (template.split.primary === 'paragraph') {
    chunks = chunkByParagraph(text, template)
  } else if (template.split.primary === 'heading') {
    chunks = chunkByHeading(text, template)
  } else {
    chunks = chunkByRegex(text, template)
  }

  // Set chunk_total
  for (const c of chunks) c.chunk_total = chunks.length

  return chunks
}

export function findTemplate(text: string, entityType: string): ChunkTemplate {
  for (const t of TEMPLATES) {
    // Check entity_type match
    if (t.match.entity_types?.includes(entityType)) return t

    // Check content patterns
    if (t.match.content_patterns) {
      const matches = t.match.content_patterns.filter(p => p.test(text))
      if (matches.length >= 1) return t
    }
  }
  return GENERIC_TEMPLATE
}

// ── Chunking strategies ──────────────────────────────────

function chunkByRegex(text: string, template: ChunkTemplate): ChunkResult[] {
  const regex = template.split.primary as RegExp
  const results: ChunkResult[] = []

  // Find all split points
  const matches: number[] = []
  let m: RegExpExecArray | null
  const globalRegex = new RegExp(regex.source, 'gm')
  while ((m = globalRegex.exec(text)) !== null) {
    matches.push(m.index)
  }

  if (matches.length === 0) return chunkByParagraph(text, template)

  // Add end of text
  matches.push(text.length)

  // Track current heading context
  const headingContext: Record<string, string> = {}

  for (let i = 0; i < matches.length - 1; i++) {
    const start = matches[i]
    const end = matches[i + 1]
    let content = text.substring(start, end).trim()

    if (content.length < template.split.min_chunk_size && i < matches.length - 2) {
      // Too small — will be merged with next chunk
      continue
    }

    // Update heading context from content
    updateHeadingContext(text.substring(0, end), template.heading.levels, headingContext)

    // Extract display_name from first line
    const firstLine = content.split('\n')[0].trim().substring(0, 80)

    // Extract metadata
    const extracted: Record<string, string> = {}
    if (template.extract) {
      for (const [key, pattern] of Object.entries(template.extract)) {
        const em = content.match(pattern)
        if (em) extracted[key] = em[1]
      }
    }

    // Split if too large
    if (content.length > template.split.max_chunk_size) {
      const subChunks = splitLargeChunk(content, template.split.max_chunk_size, template.split.overlap)
      for (let j = 0; j < subChunks.length; j++) {
        results.push({
          display_name: j === 0 ? firstLine : `${firstLine} (parte ${j + 1})`,
          content: subChunks[j],
          chunk_index: results.length,
          heading_path: buildHeadingPath(headingContext),
          char_offset_start: start,
          char_offset_end: end,
          extracted: j === 0 ? extracted : undefined,
        })
      }
    } else {
      results.push({
        display_name: firstLine,
        content,
        chunk_index: results.length,
        heading_path: buildHeadingPath(headingContext),
        char_offset_start: start,
        char_offset_end: end,
        extracted,
      })
    }
  }

  return results
}

function chunkByParagraph(text: string, template: ChunkTemplate): ChunkResult[] {
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0)
  const results: ChunkResult[] = []
  let buffer = ''
  let bufferStart = 0
  let charPos = 0

  const headingContext: Record<string, string> = {}

  for (const para of paragraphs) {
    // Update heading context
    updateHeadingContext(para, template.heading.levels, headingContext)

    if (buffer.length + para.length > template.split.max_chunk_size && buffer.length >= template.split.min_chunk_size) {
      // Flush buffer as chunk
      results.push({
        display_name: buffer.split('\n')[0].trim().substring(0, 80) || `Sezione ${results.length + 1}`,
        content: buffer.trim(),
        chunk_index: results.length,
        heading_path: buildHeadingPath(headingContext),
        char_offset_start: bufferStart,
        char_offset_end: charPos,
      })

      // Start new buffer with overlap
      if (template.split.overlap > 0) {
        buffer = buffer.substring(buffer.length - template.split.overlap) + '\n\n' + para
      } else {
        buffer = para
      }
      bufferStart = charPos
    } else {
      if (buffer.length === 0) bufferStart = charPos
      buffer += (buffer ? '\n\n' : '') + para
    }

    charPos += para.length + 2 // account for \n\n
  }

  // Flush remaining
  if (buffer.trim().length >= template.split.min_chunk_size) {
    results.push({
      display_name: buffer.split('\n')[0].trim().substring(0, 80) || `Sezione ${results.length + 1}`,
      content: buffer.trim(),
      chunk_index: results.length,
      heading_path: buildHeadingPath(headingContext),
      char_offset_start: bufferStart,
      char_offset_end: charPos,
    })
  } else if (results.length > 0) {
    // Append to last chunk
    results[results.length - 1].content += '\n\n' + buffer.trim()
    results[results.length - 1].char_offset_end = charPos
  }

  return results
}

function chunkByHeading(text: string, template: ChunkTemplate): ChunkResult[] {
  // Split by markdown headings
  const headingRegex = /^(#{1,3})\s+(.+)/gm
  const matches: { index: number; level: number; title: string }[] = []
  let m: RegExpExecArray | null

  while ((m = headingRegex.exec(text)) !== null) {
    matches.push({ index: m.index, level: m[1].length, title: m[2].trim() })
  }

  if (matches.length === 0) return chunkByParagraph(text, template)

  matches.push({ index: text.length, level: 0, title: '' })

  const results: ChunkResult[] = []
  for (let i = 0; i < matches.length - 1; i++) {
    const content = text.substring(matches[i].index, matches[i + 1].index).trim()
    if (content.length < template.split.min_chunk_size) continue

    if (content.length > template.split.max_chunk_size) {
      const subChunks = splitLargeChunk(content, template.split.max_chunk_size, template.split.overlap)
      for (let j = 0; j < subChunks.length; j++) {
        results.push({
          display_name: j === 0 ? matches[i].title : `${matches[i].title} (parte ${j + 1})`,
          content: subChunks[j],
          chunk_index: results.length,
          heading_path: matches[i].title,
          char_offset_start: matches[i].index,
          char_offset_end: matches[i + 1].index,
        })
      }
    } else {
      results.push({
        display_name: matches[i].title,
        content,
        chunk_index: results.length,
        heading_path: matches[i].title,
        char_offset_start: matches[i].index,
        char_offset_end: matches[i + 1].index,
      })
    }
  }

  return results
}

// ── Helpers ──────────────────────────────────────────────

function updateHeadingContext(text: string, levels: HeadingLevel[], context: Record<string, string>) {
  for (const level of levels) {
    const m = text.match(level.pattern)
    if (m) context[level.name] = m[1]?.trim() || m[0]?.trim()
  }
}

function buildHeadingPath(context: Record<string, string>): string {
  return Object.entries(context)
    .filter(([, v]) => v)
    .map(([k, v]) => k ? `${k} ${v}` : v)
    .join(' > ')
}

function splitLargeChunk(text: string, maxSize: number, overlap: number): string[] {
  const parts: string[] = []
  let pos = 0
  while (pos < text.length) {
    let end = pos + maxSize
    if (end < text.length) {
      // Try to break at paragraph boundary
      const paraBreak = text.lastIndexOf('\n\n', end)
      if (paraBreak > pos + maxSize / 2) end = paraBreak
      else {
        // Try sentence boundary
        const sentBreak = text.lastIndexOf('. ', end)
        if (sentBreak > pos + maxSize / 2) end = sentBreak + 1
      }
    } else {
      end = text.length
    }
    parts.push(text.substring(pos, end).trim())
    pos = end - overlap
    if (pos >= text.length) break
  }
  return parts
}
