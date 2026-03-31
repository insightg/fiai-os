import type { AgentDomain, ClassificationResult, ChatResponse } from './types.js'
import { AGENTS, AGENT_COLORS } from './config.js'
import { buildContext, saveSessionContext, captureSignal } from './context.js'
import { runHooks, type HookContext } from './hooks.js'
import { getSuggestions } from './suggestions.js'
import { executeAgent, directLLMResponse } from './base-agent.js'
import db from '../db.js'

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const CLASSIFIER_MODEL = 'anthropic/claude-haiku-4.5'
const GEMINI_MODEL = 'google/gemini-3.1-flash-image-preview'

const VALID_DOMAINS: AgentDomain[] = ['pulse', 'commerciale', 'produzione', 'marketing', 'amministrazione', 'hr', 'legal', 'documents', 'infra', 'general', 'image', 'tts']

interface ConversationMessage {
  role: string
  content: string
}

type ResponseMode = 'minimal' | 'iteration' | 'full'

// ── Caches ─────────────────────────────────────────────
const sessionDomainCache = new Map<string, AgentDomain>()
const contextCache = new Map<string, { content: string; ts: number }>()

// ── Image History (for analysis/rework) ────────────────
const imageHistory = new Map<string, string[]>()

// ── Quick Classify Keywords (instant, no LLM call) ─────

function quickClassifyKeywords(text: string): AgentDomain | null {
  const t = text.toLowerCase().trim()
  // TTS — HIGHEST PRIORITY
  if (/con la mia voce|mia voce|\bleggi\b|leggi.*alta|pronuncia|text.to.speech|\btts\b|\bparla\b|sintesi vocale|genera.*audio|voce.*clona|lista voci|voci disponibili|imposta voce|voce predefinita|impostazioni tts|clona.*voce|wizard.*voce|crea.*voce|registra.*voce/.test(t)) return 'tts'
  // Commerciale
  if (/client[ie]|lead[s]?|pipeline|prospect|contatt[io]/.test(t)) return 'commerciale'
  // Amministrazione
  if (/fattur|finanz|fatturato|incass|liquid|scadut|conto|saldo|rimbors|spese|pagament|fornitor/.test(t)) return 'amministrazione'
  // Produzione
  if (/progett[io]|ordin[ie]|milestone|delivery|avanzament/.test(t)) return 'produzione'
  // HR
  if (/candidat|annunci.*lavoro|recruiting|assunzion|cv|curriculum|onboarding/.test(t)) return 'hr'
  // Documents
  if (/\[documento caricato|\[documento allegato|archivia.*documento|cataloga|classifica.*file/.test(t)) return 'documents'
  // Legal
  if (/\bcontratt|clausol|normativ|compliance|gdpr|\blegal\b|riassumi.*document|confronta.*document|cerca.*document|contenuto.*document/.test(t)) return 'legal'
  // Marketing
  if (/immag|disegna|illustra|logo|grafica|\bpost\b|newsletter|contenut|campagna|brand/.test(t)) return 'marketing'
  // Infra
  if (/costi? api|performance|monitoring|agenti.*config|utenti.*sistema|gestione utenti|lista utenti|crea utente|nuovo utente|modifica utente|elimina utente|ruolo utente|utenti|health|agentops|whatsapp|qr code/.test(t)) return 'infra'
  // Pulse
  if (/overview|riepilog|come va|stato general|daily brief|panoramic|dashboard/.test(t)) return 'pulse'
  return null
}

// ── Response Mode Detection ────────────────────────────

function detectResponseMode(message: string, historyLength: number): ResponseMode {
  const t = message.trim().toLowerCase()

  // MINIMAL: greetings, thanks, ratings, very short acks
  if (t.length < 25 && /^(ok|va bene|grazie|thanks|ciao|buon[a-z]*|salve|perfetto|ottimo|capito|chiaro|si|si|no|bene|bravo|fantastico|eccellente)[\s!.]*$/i.test(t)) {
    return 'minimal'
  }
  // Explicit numeric rating
  if (/^\d{1,2}[\s\-:!.]/.test(t) || /^\d{1,2}$/.test(t)) {
    return 'minimal'
  }

  // ITERATION: continues previous context
  if (historyLength > 2 && /^(ora|adesso|invece|piuttosto|prova|modifica|cambia|aggiungi|togli|rimuovi|rifai|migliora|correggi|aggiorna|continua|e anche|inoltre|poi)/i.test(t)) {
    return 'iteration'
  }

  return 'full'
}

// ── Classify Intent (LLM-based) ────────────────────────

const CLASSIFICATION_PROMPT =
  'Sei un classificatore di intenti per FIAI, un gestionale aziendale italiano. ' +
  "Analizza il messaggio dell'utente e classifica il dominio principale. " +
  'I domini disponibili sono:\n' +
  "- pulse: overview aziendale, briefing, riepilogo generale, daily brief, come va l'azienda, stato generale\n" +
  '- commerciale: clienti, lead, pipeline, prospect, vendita, contatti commerciali, brief pre-call, nuovo cliente\n' +
  '- produzione: progetti, ordini, milestone, avanzamento, delivery, deadline, rischi progetto, stato progetto\n' +
  '- marketing: contenuti, campagne, lead scoring, brand, social, immagini, grafiche, genera immagine, crea logo, illustra, post, newsletter\n' +
  '- amministrazione: fatture, conti, liquidita, scadenze fiscali, rimborsi, budget, fornitori, cash flow, pagamenti, fatturato\n' +
  '- hr: candidati, annunci lavoro, recruiting, onboarding, costo aziendale, curriculum, selezione\n' +
  '- legal: contratti, clausole, normative, compliance, documenti legali, privacy, GDPR, analisi contratto, ricerca documenti, riassumi documento, confronta documenti, contenuto documento\n' +
  '- infra: costi API, performance sistema, monitoring agenti, utenti, ruoli, configurazione, AgentOps\n' +
  '- tts: sintesi vocale, text-to-speech, leggi ad alta voce, pronuncia, voce, audio, parla, clona voce\n' +
  '- general: saluti, domande generiche, conversazione\n\n' +
  'IMPORTANTE: Le richieste di generazione immagini vanno SEMPRE a "marketing".\n' +
  'Le richieste di leggere, pronunciare o generare audio vanno SEMPRE a "tts".\n' +
  'Rispondi SOLO con un JSON valido: {"domain": "...", "confidence": 0.0-1.0, "needsMultiAgent": false, "secondaryDomains": []}'

async function classifyIntent(message: string, conversationHistory?: ConversationMessage[]): Promise<ClassificationResult> {
  try {
    let contextText = message
    if (conversationHistory && conversationHistory.length > 0) {
      const recent = conversationHistory.slice(-3)
      contextText = recent.map(m => `${m.role}: ${m.content}`).join('\n') + '\nuser: ' + message
    }

    const res = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENROUTER_API_KEY}` },
      body: JSON.stringify({
        model: CLASSIFIER_MODEL,
        messages: [
          { role: 'system', content: CLASSIFICATION_PROMPT },
          { role: 'user', content: contextText },
        ],
        max_tokens: 80,
      }),
    })

    if (!res.ok) return { domain: 'pulse', confidence: 0.5, needsMultiAgent: false }

    const data = await res.json()
    const text = data.choices?.[0]?.message?.content ?? ''
    const reasoning = data.choices?.[0]?.message?.reasoning ?? ''
    const fullText = text || reasoning

    const jsonMatch = fullText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.warn('Classification: no JSON found, falling back to pulse')
      return { domain: 'pulse', confidence: 0.5, needsMultiAgent: false }
    }

    const parsed = JSON.parse(jsonMatch[0]) as ClassificationResult
    if (!VALID_DOMAINS.includes(parsed.domain)) {
      return { domain: 'pulse', confidence: 0.5, needsMultiAgent: false }
    }

    console.log(`Classification: ${parsed.domain} (confidence: ${parsed.confidence})`)
    return parsed
  } catch (err) {
    console.warn('Classification error, falling back to pulse:', err)
    return { domain: 'pulse', confidence: 0.5, needsMultiAgent: false }
  }
}

// ── Image Handling (Gemini — server-side) ──────────────

function isImageAnalysisRequest(text: string): boolean {
  return /analizz|descri|cosa (vedi|c'e|contiene)|spiega.*immag|interpreta|riconosc|identifica|leggi.*immag|esamina/i.test(text)
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

async function handleImageRequest(
  message: string,
  sessionId: string,
  attachedImageBase64?: string
): Promise<ChatResponse> {
  // If image is attached, analyze it
  if (attachedImageBase64) {
    const existing = imageHistory.get(sessionId) || []
    existing.push(attachedImageBase64)
    imageHistory.set(sessionId, existing)

    if (isImageAnalysisRequest(message)) {
      const geminiMessages = [
        { role: 'system', content: "Sei un analista visivo esperto. Analizza l'immagine fornita e rispondi in italiano in modo dettagliato e professionale." },
        { role: 'user', content: [{ type: 'text', text: message }, { type: 'image_url', image_url: { url: attachedImageBase64 } }] },
      ]
      const data = await callGemini(geminiMessages)
      const text = data.choices?.[0]?.message?.content ?? "Non sono riuscito ad analizzare l'immagine."
      return {
        text,
        toolCalls: [{ tool: 'analyze_image', result: { analyzed: true } }],
        agentName: 'Vision Analyst',
        agentDomain: 'marketing',
        agentColor: '#9C27B0',
      }
    }

    // Generate with reference
    const geminiMessages = [
      { role: 'system', content: "Sei un generatore e editor di immagini. Modifica l'immagine esistente secondo le istruzioni dell'utente." },
      { role: 'user', content: [{ type: 'text', text: message }, { type: 'image_url', image_url: { url: attachedImageBase64 } }] },
    ]
    const data = await callGemini(geminiMessages)
    const msg = data.choices?.[0]?.message
    const images = msg?.images ?? []
    const imageUrls = images.map((img: any) => img?.image_url?.url || img).filter(Boolean) as string[]

    if (sessionId && imageUrls.length > 0) {
      for (const url of imageUrls) {
        const existing = imageHistory.get(sessionId) || []
        existing.push(url)
        imageHistory.set(sessionId, existing)
      }
    }

    return {
      text: msg?.content || "Ecco l'immagine modificata:",
      toolCalls: imageUrls.map((url: string, i: number) => ({ tool: 'generate_image', result: { image_url: url, index: i } })),
      agentName: 'Image Editor',
      agentDomain: 'marketing',
      agentColor: '#E91E63',
    }
  }

  // Check if rework of previous image
  const lastImages = imageHistory.get(sessionId)
  const lastImage = lastImages && lastImages.length > 0 ? lastImages[lastImages.length - 1] : null
  const isRework = lastImage && /modifica|cambia|rifai|migliora|aggiungi|togli|rielabora|trasforma/i.test(message)

  let geminiMessages: any[]
  if (isRework && lastImage) {
    geminiMessages = [
      { role: 'system', content: "Sei un generatore e editor di immagini. Modifica l'immagine esistente secondo le istruzioni dell'utente." },
      { role: 'user', content: [{ type: 'text', text: message }, { type: 'image_url', image_url: { url: lastImage } }] },
    ]
  } else {
    geminiMessages = [
      { role: 'system', content: "Sei un generatore di immagini. Crea l'immagine richiesta dall'utente." },
      { role: 'user', content: message },
    ]
  }

  const data = await callGemini(geminiMessages)
  const msg = data.choices?.[0]?.message
  const images = msg?.images ?? []
  const imageUrls = images.map((img: any) => img?.image_url?.url || img).filter(Boolean) as string[]

  if (sessionId && imageUrls.length > 0) {
    for (const url of imageUrls) {
      const existing = imageHistory.get(sessionId) || []
      existing.push(url)
      imageHistory.set(sessionId, existing)
    }
  }

  const responseText = msg?.content || (isRework ? "Ecco l'immagine modificata:" : "Ecco l'immagine generata:")

  return {
    text: responseText,
    toolCalls: imageUrls.map((url: string, i: number) => ({ tool: 'generate_image', result: { image_url: url, index: i } })),
    agentName: isRework ? 'Image Editor' : 'Image Generator',
    agentDomain: 'marketing',
    agentColor: '#E91E63',
  }
}

// ── Synthesize Multi-Agent Results ─────────────────────

async function synthesizeResults(
  message: string,
  agentResults: { agentName: string; text: string }[]
): Promise<string> {
  const systemPrompt =
    "Sei l'assistente AI di FIAI. Hai ricevuto risposte da diversi agenti specializzati. " +
    'Sintetizza le risposte in un unico messaggio coerente e completo in italiano. ' +
    'Mantieni tutte le informazioni importanti e presenta i dati in modo chiaro.'

  const agentSummary = agentResults
    .map(r => `--- ${r.agentName} ---\n${r.text}`)
    .join('\n\n')

  try {
    const res = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENROUTER_API_KEY}` },
      body: JSON.stringify({
        model: CLASSIFIER_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Domanda originale: ${message}\n\nRisposte degli agenti:\n${agentSummary}` },
        ],
        max_tokens: 4096,
      }),
    })

    if (!res.ok) {
      return agentResults.map(r => `**${r.agentName}:**\n${r.text}`).join('\n\n')
    }

    const data = await res.json()
    return data.choices?.[0]?.message?.content ?? ''
  } catch {
    return agentResults.map(r => `**${r.agentName}:**\n${r.text}`).join('\n\n')
  }
}

// ── Main Orchestrator ──────────────────────────────────

export async function orchestrate(
  message: string,
  userId: string,
  aziendaId: string,
  options?: {
    format?: 'web' | 'whatsapp'
    sessionId?: string
    history?: ConversationMessage[]
    attachedImageBase64?: string
    attachedAudioBase64?: string
  }
): Promise<ChatResponse> {
  const startTime = Date.now()
  const format = options?.format ?? 'web'
  const sessionId = options?.sessionId ?? ''
  const conversationHistory = options?.history
  const attachedImageBase64 = options?.attachedImageBase64
  const attachedAudioBase64 = options?.attachedAudioBase64

  const historyLength = (conversationHistory?.length ?? 0) + 1

  // Helper: finalize result with signal capture, hooks, and suggestions
  const finalizeResult = async (result: ChatResponse, classification?: ClassificationResult): Promise<ChatResponse> => {
    const latencyMs = Date.now() - startTime
    const toolsUsed = result.toolCalls.map(t => (t as Record<string, unknown>).tool).filter(Boolean) as string[]

    // Capture signal (fire-and-forget)
    captureSignal(aziendaId, userId, {
      sessionId,
      domain: result.agentDomain,
      confidence: classification?.confidence ?? 1.0,
      tools: toolsUsed,
      latencyMs,
      agentName: result.agentName,
      cost: result.totalCost ?? 0,
      tokens: result.totalTokens ?? 0,
    })

    // Run post_execute hook
    const hookCtx: HookContext = {
      messages: conversationHistory ? [...conversationHistory, { role: 'user', content: message }] : [{ role: 'user', content: message }],
      domain: result.agentDomain,
      confidence: classification?.confidence,
      agentName: result.agentName,
      toolCalls: result.toolCalls,
      result: { text: result.text, toolCalls: result.toolCalls },
      sessionId,
      startTime,
    }
    await runHooks('post_execute', hookCtx)

    // Get rule-based suggestions
    const suggestions = getSuggestions(result.agentDomain, toolsUsed)

    // Save session context (fire-and-forget)
    if (sessionId) {
      const summary = `Dominio: ${result.agentDomain}\nAgente: ${result.agentName}\nTools usati: ${toolsUsed.join(', ')}\nRisposta: ${result.text.substring(0, 200)}...`
      try { saveSessionContext(aziendaId, userId, sessionId, summary) } catch {}
    }

    // Cache domain for ITERATION mode
    if (sessionId && result.agentDomain !== 'general') {
      sessionDomainCache.set(sessionId, result.agentDomain as AgentDomain)
    }

    return { ...result, suggestions }
  }

  // ── If an image is attached, handle image analysis/generation ──
  if (attachedImageBase64) {
    const result = await handleImageRequest(message, sessionId, attachedImageBase64)
    return finalizeResult(result)
  }

  // ── Response Mode Routing ──
  const responseMode = detectResponseMode(message, historyLength)

  if (responseMode === 'minimal') {
    // Check for explicit numeric rating (1-10)
    const ratingMatch = message.trim().match(/^(\d{1,2})/)
    if (ratingMatch) {
      const rating = parseInt(ratingMatch[1])
      if (rating >= 1 && rating <= 10) {
        captureSignal(aziendaId, userId, {
          sessionId,
          type: 'explicit_rating',
          rating,
          domain: sessionDomainCache.get(sessionId) || 'general',
        })
        const response = rating >= 7
          ? 'Grazie per il feedback positivo!'
          : rating >= 4
            ? 'Grazie, terro conto del tuo feedback per migliorare.'
            : 'Mi dispiace. Cerchero di fare meglio la prossima volta.'
        return {
          text: response, toolCalls: [], agentName: 'Assistente FIAI',
          agentDomain: 'general', agentColor: AGENT_COLORS.general,
          suggestions: getSuggestions('general', []),
        }
      }
    }

    // Quick minimal response, no classification, no tools
    const context = buildContext('pulse', aziendaId, userId, sessionId)
    const minimalText = await directLLMResponse(message, context, conversationHistory)
    return {
      text: minimalText, toolCalls: [], agentName: 'Assistente FIAI',
      agentDomain: 'general', agentColor: AGENT_COLORS.general,
      suggestions: getSuggestions('general', []),
    }
  }

  // ── ITERATION mode: reuse last domain ──
  if (responseMode === 'iteration' && sessionId) {
    const lastDomain = sessionDomainCache.get(sessionId)
    if (lastDomain && lastDomain !== 'general' && lastDomain !== 'image' && lastDomain !== 'tts') {
      const agent = AGENTS[lastDomain]
      if (agent) {
        const context = buildContext(lastDomain, aziendaId, userId, sessionId)
        const result = await executeAgent(message, agent, aziendaId, userId, context, format, conversationHistory)
        return finalizeResult(result)
      }
    }
    // fallback to full classification
  }

  // ── FULL classification ──
  let classification: ClassificationResult
  const kwDomain = quickClassifyKeywords(message)
  if (kwDomain) {
    classification = { domain: kwDomain, confidence: 0.95, needsMultiAgent: false }
  } else {
    classification = await classifyIntent(message, conversationHistory)
  }

  // Run post_classify hook
  const hookCtx: HookContext = {
    messages: conversationHistory ? [...conversationHistory, { role: 'user', content: message }] : [{ role: 'user', content: message }],
    domain: classification.domain,
    confidence: classification.confidence,
    sessionId,
  }
  await runHooks('post_classify', hookCtx)

  // Normalize image domain to marketing
  if (classification.domain === 'image') {
    classification.domain = 'marketing' as AgentDomain
  }

  // documents -> legal fallback
  if (classification.domain === 'documents') {
    classification.domain = 'legal' as AgentDomain
  }

  // ── TTS — voice commands ──
  if (classification.domain === 'tts') {
    let ttsText = ''
    const tLower = message.toLowerCase()
    const TTS_API_URL = process.env.TTS_API_URL || 'http://host.docker.internal:7777/v1/audio/speech'
    const TTS_BASE = TTS_API_URL.replace('/v1/audio/speech', '')
    console.log(`[TTS] message="${tLower}", hasAudio=${!!attachedAudioBase64}, audioLen=${attachedAudioBase64?.length || 0}`)
    const UPLOADS_DIR = process.env.UPLOADS_DIR || '/app/data/uploads'

    // Get available voices
    let availableVoices = 'Vivian, Serena, Ryan, Dylan, Eric, Aiden'
    try {
      const vRes = await fetch(`${TTS_BASE}/v1/voices`, { signal: AbortSignal.timeout(5000) })
      if (vRes.ok) {
        const voices = await vRes.json()
        const names = (voices.voices || voices || []).map((v: any) => v.name || v)
        if (names.length > 0) availableVoices = names.join(', ')
      }
    } catch {}

    // Get current user voice preference
    const currentVoice = db.prepare('SELECT tts_voice FROM user_profiles WHERE id = ?').get(userId) as any
    const userVoice = currentVoice?.tts_voice || 'Vivian'

    // Voice cloning: user attached audio + clone command
    if (attachedAudioBase64 && /clona|crea voce|salva voce|registra voce|wizard voce|con la mia voce|mia voce|audio.*voce|voce.*audio/.test(tLower)) {
      // Extract voice name from message
      const nameMatch = tLower.match(/(?:clona|crea|salva|registra|chiama(?:la)?)\s+(?:voce\s+)?(?:come\s+)?["']?(\w+)["']?/i)
        || tLower.match(/voce\s+["']?(\w+)["']?/i)
      const voiceName = nameMatch ? nameMatch[1].charAt(0).toUpperCase() + nameMatch[1].slice(1).toLowerCase() : `Clone_${Date.now()}`

      try {
        const fs = await import('fs')
        const path = await import('path')
        const crypto = await import('crypto')
        const { execSync } = await import('child_process')

        // Clean base64
        let cleanBase64 = attachedAudioBase64
        if (cleanBase64.includes(',')) cleanBase64 = cleanBase64.split(',')[1]
        while (cleanBase64.length % 4 !== 0) cleanBase64 += '='

        // Convert to WAV
        const tmpDir = path.default.join(UPLOADS_DIR, 'tmp')
        fs.default.mkdirSync(tmpDir, { recursive: true })
        const inputFile = path.default.join(tmpDir, `clone-${crypto.default.randomUUID()}.webm`)
        const outputFile = inputFile.replace('.webm', '.wav')
        fs.default.writeFileSync(inputFile, Buffer.from(cleanBase64, 'base64'))
        try {
          execSync(`ffmpeg -y -i "${inputFile}" -ar 16000 -ac 1 "${outputFile}" 2>/dev/null`, { timeout: 15000 })
          cleanBase64 = fs.default.readFileSync(outputFile).toString('base64')
        } catch { /* use original */ }

        // Save voice file
        const safeName = voiceName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 30)
        const voicesDir = path.default.join(UPLOADS_DIR, aziendaId, userId, 'voices')
        fs.default.mkdirSync(voicesDir, { recursive: true })
        const destPath = path.default.join(voicesDir, `${safeName}.wav`)

        if (fs.default.existsSync(outputFile)) {
          fs.default.renameSync(outputFile, destPath)
        } else {
          fs.default.writeFileSync(destPath, Buffer.from(cleanBase64, 'base64'))
        }

        // Cleanup
        try { fs.default.unlinkSync(inputFile) } catch {}

        // Test clone with a short phrase
        const cloneUrl = TTS_API_URL.replace('/v1/audio/speech', '/v1/audio/voice-clone')
        const testRes = await fetch(cloneUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            input: 'Ciao, questa è la mia voce clonata.',
            ref_audio: cleanBase64,
            x_vector_only_mode: true,
            language: 'Italian',
            response_format: 'mp3',
            speed: 1.0,
          }),
          signal: AbortSignal.timeout(60000),
        })

        if (testRes.ok) {
          // Save test audio
          const audioDir = path.default.join(UPLOADS_DIR, aziendaId, userId, 'audio')
          fs.default.mkdirSync(audioDir, { recursive: true })
          const testFilename = `clone-test-${crypto.default.randomUUID()}.mp3`
          const testPath = path.default.join(audioDir, testFilename)
          fs.default.writeFileSync(testPath, Buffer.from(await testRes.arrayBuffer()))
          const audioUrl = `/api/uploads/${aziendaId}/${userId}/audio/${testFilename}`

          ttsText = `Voce **${safeName}** clonata con successo! Il campione di riferimento e stato salvato.\n\n` +
            `[Ascolta il test della voce clonata](${audioUrl})\n\n` +
            `Per usarla scrivi: *imposta voce ${safeName}*`
        } else {
          ttsText = `Voce **${safeName}** salvata, ma il test di clonazione ha avuto un problema. ` +
            `Il modello Base potrebbe essere in fase di caricamento — riprova tra qualche secondo.`
        }
      } catch (err: any) {
        ttsText = `Errore nella clonazione: ${err.message || 'errore sconosciuto'}. Assicurati di allegare un audio chiaro di almeno 5 secondi.`
      }

      const result: ChatResponse = {
        text: ttsText,
        toolCalls: [], agentName: 'Assistente FIAI', agentDomain: 'tts', agentColor: AGENT_COLORS.tts,
        suggestions: [`Imposta voce ${voiceName}`, 'Lista voci', 'Registra altra voce'],
      }
      return finalizeResult(result, classification)
    }

    if (/lista voci|voci disponibili|quali voci|elenco voci/.test(tLower)) {
      // Check for cloned voices
      let clonedVoicesList = ''
      try {
        const fs = await import('fs')
        const path = await import('path')
        const voicesDir = path.default.join(UPLOADS_DIR, aziendaId, userId, 'voices')
        if (fs.default.existsSync(voicesDir)) {
          const cloned = fs.default.readdirSync(voicesDir).filter((f: string) => f.endsWith('.wav')).map((f: string) => f.replace('.wav', ''))
          if (cloned.length > 0) clonedVoicesList = `\n\n**Voci clonate:** ${cloned.join(', ')}`
        }
      } catch {}
      ttsText = `**Voci predefinite:** ${availableVoices}${clonedVoicesList}\n\n**Voce attuale:** ${userVoice}\n\nPer cambiare voce scrivi: *usa [nome] come voce* o *imposta voce [nome]*\nPer clonare: allega un audio e scrivi *clona voce [nome]*`

    } else if (/imposta voce|usa.*come voce|cambia voce|voce di default|voce predefinita|setta voce|set voice/.test(tLower)) {
      // Extract voice name from message
      const voiceMatch = tLower.match(/(?:imposta voce|usa|cambia voce(?:.*?in)?|setta voce|set voice)\s+(\w+)/i)
        || tLower.match(/(\w+)\s+come voce/)
      if (voiceMatch) {
        const requested = voiceMatch[1].charAt(0).toUpperCase() + voiceMatch[1].slice(1).toLowerCase()
        // Check built-in voices
        const allVoices = availableVoices.split(', ').map(v => v.trim())
        // Also check cloned voices
        let clonedNames: string[] = []
        try {
          const fs = await import('fs')
          const path = await import('path')
          const voicesDir = path.default.join(UPLOADS_DIR, aziendaId, userId, 'voices')
          if (fs.default.existsSync(voicesDir)) {
            clonedNames = fs.default.readdirSync(voicesDir).filter((f: string) => f.endsWith('.wav')).map((f: string) => f.replace('.wav', ''))
          }
        } catch {}
        const allAvailable = [...allVoices, ...clonedNames]
        const matched = allAvailable.find(v => v.toLowerCase() === requested.toLowerCase())
        if (matched) {
          try {
            db.prepare('ALTER TABLE user_profiles ADD COLUMN tts_voice TEXT DEFAULT \'Vivian\'').run()
          } catch {}
          db.prepare('UPDATE user_profiles SET tts_voice = ? WHERE id = ?').run(matched, userId)
          const isCloned = clonedNames.some(c => c.toLowerCase() === matched.toLowerCase())
          ttsText = `Voce impostata su **${matched}**${isCloned ? ' (clonata)' : ''}. Tutte le risposte vocali useranno questa voce.`
        } else {
          const clonedInfo = clonedNames.length > 0 ? `\n**Clonate:** ${clonedNames.join(', ')}` : ''
          ttsText = `Voce "${requested}" non trovata.\n**Predefinite:** ${availableVoices}${clonedInfo}`
        }
      } else {
        ttsText = `**Voce attuale:** ${userVoice}\n\nPer cambiare, scrivi: *usa Serena come voce* o *imposta voce Ryan*\n\n**Disponibili:** ${availableVoices}`
      }

    } else if (/qual.*voce|voce attuale|che voce/.test(tLower)) {
      ttsText = `La voce attuale e **${userVoice}**.\n\n**Disponibili:** ${availableVoices}`

    } else if (!attachedAudioBase64 && /clona|crea voce|registra voce|wizard voce/.test(tLower)) {
      ttsText = `Per clonare una voce devi **allegare un audio** di almeno 5 secondi.\n\n` +
        `1. Clicca il bottone **microfono** per registrare\n` +
        `2. Parla per almeno 5 secondi in modo chiaro\n` +
        `3. Scrivi: *clona voce [nome]* insieme all'audio allegato`

    } else {
      ttsText = `**Comandi vocali disponibili:**\n` +
        `- **Lista voci** — mostra le voci disponibili\n` +
        `- **Imposta voce [nome]** — cambia voce (es. *usa Serena come voce*)\n` +
        `- **Voce attuale** — mostra la voce in uso\n` +
        `- **Clona voce [nome]** — clona la tua voce (allega un audio di almeno 5 secondi)\n\n` +
        `**Voce attuale:** ${userVoice}\n` +
        `Per la conversazione vocale, clicca il bottone altoparlante nell'area di input.`
    }

    const result: ChatResponse = {
      text: ttsText,
      toolCalls: [], agentName: 'Assistente FIAI', agentDomain: 'tts', agentColor: AGENT_COLORS.tts,
      suggestions: ['Lista voci', 'Voce attuale', 'Clona voce'],
    }
    return finalizeResult(result, classification)
  }

  // ── General — direct LLM response (no tools) ──
  if (classification.domain === 'general') {
    const context = buildContext('pulse', aziendaId, userId, sessionId)
    const text = await directLLMResponse(message, context, conversationHistory)
    const result: ChatResponse = {
      text, toolCalls: [], agentName: 'Assistente FIAI',
      agentDomain: 'general', agentColor: AGENT_COLORS.general,
    }
    return finalizeResult(result, classification)
  }

  // ── Multi-agent execution ──
  if (classification.needsMultiAgent && classification.secondaryDomains && classification.secondaryDomains.length > 0) {
    const allDomains: AgentDomain[] = [classification.domain, ...classification.secondaryDomains]
    const uniqueDomains = [...new Set(allDomains)].filter(d => d !== 'general')

    const agentPromises = uniqueDomains
      .map(async (domain) => {
        const agent = AGENTS[domain]
        if (!agent) return null
        const context = buildContext(domain, aziendaId, userId, sessionId)
        return executeAgent(message, agent, aziendaId, userId, context, format, conversationHistory)
      })
      .filter(p => p !== null)

    const results = await Promise.all(agentPromises)
    const validResults = results.filter(r => r !== null)

    if (validResults.length === 0) {
      const context = buildContext('pulse', aziendaId, userId, sessionId)
      const text = await directLLMResponse(message, context, conversationHistory)
      return finalizeResult({ text, toolCalls: [], agentName: 'Assistente FIAI', agentDomain: 'general', agentColor: AGENT_COLORS.general }, classification)
    }

    const allToolCalls = validResults.flatMap(r => r.toolCalls)
    const synthesized = await synthesizeResults(message, validResults.map(r => ({ agentName: r.agentName, text: r.text })))

    const result: ChatResponse = {
      text: synthesized,
      toolCalls: allToolCalls,
      agentName: validResults.map(r => r.agentName).join(' + '),
      agentDomain: classification.domain,
      agentColor: AGENT_COLORS[classification.domain] || AGENT_COLORS.general,
    }
    return finalizeResult(result, classification)
  }

  // ── Single-agent execution ──
  const agent = AGENTS[classification.domain] || AGENTS.pulse

  // Context with 60s cache
  const cacheKey = `${classification.domain}:${aziendaId}:${sessionId}`
  const cached = contextCache.get(cacheKey)
  let context: string
  if (cached && Date.now() - cached.ts < 60000) {
    context = cached.content
  } else {
    context = buildContext(classification.domain, aziendaId, userId, sessionId)
    contextCache.set(cacheKey, { content: context, ts: Date.now() })
  }

  const result = await executeAgent(message, agent, aziendaId, userId, context, format, conversationHistory)
  return finalizeResult(result, classification)
}
