/**
 * OCR via Vision Model — "Riconoscitore"
 * Converts PDF pages to images, sends each to z-ai/glm-5v-turbo for text extraction
 */

import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const OCR_MODEL = 'z-ai/glm-5v-turbo'

const OCR_PROMPT = `Sei un sistema OCR. Estrai TUTTO il testo visibile in questa immagine di una pagina di documento.
Regole:
- Trascrivi il testo ESATTAMENTE come appare, mantenendo la struttura (titoli, paragrafi, elenchi, tabelle)
- Per le tabelle, usa formato a colonne separate da |
- Non aggiungere commenti, interpretazioni o testo non presente nell'immagine
- Se la pagina è vuota o illeggibile, rispondi con [PAGINA VUOTA]
- Mantieni la formattazione originale il più possibile`

/**
 * Convert PDF pages to PNG images using pdftoppm
 */
function pdfToImages(pdfPath: string, maxPages?: number): string[] {
  const tmpDir = path.join('/tmp', `ocr-${crypto.randomUUID()}`)
  fs.mkdirSync(tmpDir, { recursive: true })

  try {
    // Get page count first
    const pageInfo = execSync(`pdfinfo "${pdfPath}" 2>/dev/null | grep -a Pages`, { encoding: 'utf-8' }).trim()
    const totalPages = parseInt(pageInfo.replace(/\D/g, '')) || 1
    const pagesToProcess = maxPages ? Math.min(totalPages, maxPages) : totalPages

    // Convert pages to PNG (150 DPI is enough for OCR, keeps file size reasonable)
    execSync(`pdftoppm -png -r 150 -l ${pagesToProcess} "${pdfPath}" "${tmpDir}/page"`, { timeout: 120000 })

    // Collect generated images in order
    const images = fs.readdirSync(tmpDir)
      .filter(f => f.endsWith('.png'))
      .sort()
      .map(f => path.join(tmpDir, f))

    return images
  } catch (err: any) {
    console.error(`[OCR] pdftoppm error: ${err.message}`)
    // Cleanup on error
    try { fs.rmSync(tmpDir, { recursive: true }) } catch {}
    return []
  }
}

/**
 * Send a single page image to the vision model for OCR
 */
async function ocrPage(imagePath: string, pageNum: number): Promise<string> {
  const imageBuffer = fs.readFileSync(imagePath)
  const base64 = imageBuffer.toString('base64')
  const mimeType = 'image/png'

  try {
    const res = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: OCR_MODEL,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: OCR_PROMPT },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
          ],
        }],
        max_tokens: 4096,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error(`[OCR] Page ${pageNum} API error ${res.status}: ${err.substring(0, 200)}`)
      return `[ERRORE OCR PAGINA ${pageNum}]`
    }

    const data = await res.json()
    const text = data.choices?.[0]?.message?.content || ''
    return text.trim()
  } catch (err: any) {
    console.error(`[OCR] Page ${pageNum} error: ${err.message}`)
    return `[ERRORE OCR PAGINA ${pageNum}]`
  }
}

/**
 * OCR an entire PDF document page by page
 * Returns the concatenated text of all pages
 */
export async function ocrPdf(
  pdfPath: string,
  options?: {
    maxPages?: number
    onProgress?: (page: number, total: number) => void
    concurrency?: number
  }
): Promise<{ text: string; pages: number; errors: number }> {
  const { maxPages, onProgress, concurrency = 3 } = options || {}

  console.log(`[OCR] Starting OCR on "${path.basename(pdfPath)}" (max ${maxPages || 'all'} pages, concurrency ${concurrency})`)

  // Convert PDF to images
  const images = pdfToImages(pdfPath, maxPages)
  if (images.length === 0) {
    return { text: '', pages: 0, errors: 1 }
  }

  const totalPages = images.length
  console.log(`[OCR] Converted ${totalPages} pages to images`)

  // Process pages in parallel batches
  const results: string[] = new Array(totalPages)
  let errors = 0

  for (let i = 0; i < totalPages; i += concurrency) {
    const batch = images.slice(i, i + concurrency)
    const promises = batch.map((img, j) => {
      const pageNum = i + j + 1
      onProgress?.(pageNum, totalPages)
      return ocrPage(img, pageNum).then(text => {
        results[i + j] = text
        if (text.includes('[ERRORE OCR')) errors++
        console.log(`[OCR] Page ${pageNum}/${totalPages}: ${text.length} chars`)
      })
    })
    await Promise.all(promises)
  }

  // Cleanup temp images
  const tmpDir = path.dirname(images[0])
  try { fs.rmSync(tmpDir, { recursive: true }) } catch {}

  // Concatenate with page markers
  const fullText = results
    .map((text, i) => `--- Pagina ${i + 1} ---\n${text}`)
    .join('\n\n')

  console.log(`[OCR] Complete: ${totalPages} pages, ${fullText.length} chars, ${errors} errors`)
  return { text: fullText, pages: totalPages, errors }
}

/**
 * Check if a PDF likely needs OCR (scanned/image-based)
 * Heuristic: very little text relative to file size
 */
export function needsOcr(extractedText: string, fileSize: number, pageCount: number): boolean {
  const textLength = extractedText.trim().length
  const charsPerPage = pageCount > 0 ? textLength / pageCount : textLength

  // A normal text page has ~2000-4000 chars
  // If less than 100 chars per page, it's likely scanned
  if (pageCount > 0 && charsPerPage < 100) return true

  // Very small text relative to file size (>50KB file with <500 chars)
  if (fileSize > 50000 && textLength < 500) return true

  return false
}
