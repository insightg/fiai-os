import { Router, Response } from 'express'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { execSync } from 'child_process'
import { AuthRequest, authMiddleware } from './middleware.js'
import db from './db.js'

const router = Router()

// Local TTS server (OpenAI-compatible API on fiai-tts container)
const TTS_API_URL = process.env.TTS_API_URL || 'http://fiai-tts:8880/v1/audio/speech'
const UPLOADS_DIR = process.env.UPLOADS_DIR || '/app/data/uploads'

const AVAILABLE_VOICES = ['Vivian', 'Serena', 'Ryan', 'Dylan', 'Eric', 'Aiden'] as const

// POST /api/tts/speak — Generate speech from text
router.post('/speak', authMiddleware(true), async (req: AuthRequest, res: Response) => {
  try {
    const { text, voice = 'Vivian', language = 'it' } = req.body

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      res.status(400).json({ error: 'Il campo "text" è obbligatorio.' })
      return
    }

    const selectedVoice = AVAILABLE_VOICES.includes(voice as any) ? voice : 'Vivian'

    // Map language names to ISO codes for model suffix
    const langMap: Record<string, string> = {
      Italian: 'it', it: 'it', italiano: 'it',
      English: 'en', en: 'en', inglese: 'en',
      French: 'fr', fr: 'fr', francese: 'fr',
      Spanish: 'es', es: 'es', spagnolo: 'es',
      German: 'de', de: 'de', tedesco: 'de',
      Chinese: 'zh', zh: 'zh', cinese: 'zh',
      Japanese: 'ja', ja: 'ja', giapponese: 'ja',
      Korean: 'ko', ko: 'ko', coreano: 'ko',
    }
    const langCode = langMap[language] || 'it'
    const model = langCode === 'it' ? 'tts-1' : `tts-1-${langCode}`

    const response = await fetch(TTS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        voice: selectedVoice,
        input: text.trim(),
        response_format: 'mp3',
        speed: 1.0,
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error('TTS error:', response.status, errText)
      res.status(502).json({ error: `Errore TTS: ${response.status}` })
      return
    }

    // Save audio to user's uploads directory
    const aziendaId = req.aziendaId || 'unknown'
    const userId = req.userId || 'unknown'
    const audioDir = path.join(UPLOADS_DIR, aziendaId, userId, 'audio')
    fs.mkdirSync(audioDir, { recursive: true })

    const filename = `tts-${crypto.randomUUID()}.mp3`
    const filePath = path.join(audioDir, filename)

    const arrayBuffer = await response.arrayBuffer()
    fs.writeFileSync(filePath, Buffer.from(arrayBuffer))

    const audioUrl = `/api/uploads/${aziendaId}/${userId}/audio/${filename}`
    res.json({ audioUrl, voice: selectedVoice, language })
  } catch (err: any) {
    console.error('TTS speak error:', err)
    res.status(500).json({ error: err.message || 'Errore interno TTS' })
  }
})

// POST /api/tts/stream — Stream audio directly to browser (for playback while generating)
router.post('/stream', authMiddleware(true), async (req: AuthRequest, res: Response) => {
  try {
    const { text, voice, language = 'it', voiceName } = req.body

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      res.status(400).json({ error: 'Il campo "text" è obbligatorio.' })
      return
    }

    const aziendaId = req.aziendaId || 'unknown'
    const userId = req.userId || 'unknown'

    // Use user's preferred voice if not explicitly specified
    let selectedVoiceForStream = voice
    if (!selectedVoiceForStream) {
      try {
        const name = db.prepare("SELECT json_extract(metadata, '$.tts_voice') as tts_voice FROM entity WHERE id = ?").get(userId) as any
        selectedVoiceForStream = name?.tts_voice || 'Vivian'
      } catch {
        selectedVoiceForStream = 'Vivian'
      }
    }

    // Check if selected voice (explicit or user preference) is a cloned voice
    const cloneVoiceToCheck = voiceName || selectedVoiceForStream
    if (cloneVoiceToCheck) {
      const voicePath = path.join(UPLOADS_DIR, aziendaId, userId, 'voices', `${cloneVoiceToCheck.replace(/[^a-zA-Z0-9_-]/g, '_')}.wav`)
      if (fs.existsSync(voicePath)) {
        const refAudio = fs.readFileSync(voicePath).toString('base64')
        const cloneUrl = TTS_API_URL.replace('/v1/audio/speech', '/v1/audio/voice-clone')
        const response = await fetch(cloneUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            input: text.trim(),
            ref_audio: refAudio,
            x_vector_only_mode: true,
            language: language === 'it' ? 'Italian' : language,
            response_format: 'pcm',
            speed: 1.0,
            stream: true,
          }),
        })
        if (!response.ok) {
          res.status(502).json({ error: 'Errore clonazione streaming' })
          return
        }
        res.setHeader('Content-Type', 'application/octet-stream')
        res.setHeader('X-Audio-Format', 'pcm-s16le')
        res.setHeader('X-Sample-Rate', '24000')
        res.setHeader('Transfer-Encoding', 'chunked')
        res.setHeader('Cache-Control', 'no-cache')
        if (response.body) {
          const reader = (response.body as any).getReader?.()
          if (reader) {
            const pump = async () => {
              while (true) {
                const { done, value } = await reader.read()
                if (done) { res.end(); break }
                res.write(Buffer.from(value))
              }
            }
            pump().catch(() => res.end())
          } else if ((response.body as any).pipe) {
            ;(response.body as any).pipe(res)
          } else {
            res.end(Buffer.from(await response.arrayBuffer()))
          }
        } else {
          res.end(Buffer.from(await response.arrayBuffer()))
        }
        return
      }
    }

    // Standard TTS with real-time PCM streaming
    const selectedVoice = AVAILABLE_VOICES.includes(selectedVoiceForStream as any) ? selectedVoiceForStream : selectedVoiceForStream
    const langMap: Record<string, string> = { Italian: 'it', it: 'it', English: 'en', en: 'en', French: 'fr', fr: 'fr', Spanish: 'es', es: 'es', German: 'de', de: 'de' }
    const langCode = langMap[language] || 'it'
    const model = langCode === 'it' ? 'tts-1' : `tts-1-${langCode}`

    const response = await fetch(TTS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        voice: selectedVoice,
        input: text.trim(),
        response_format: 'pcm',
        speed: 1.0,
        stream: true,
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error('TTS stream error:', response.status, errText)
      res.status(502).json({ error: `Errore TTS streaming: ${response.status}` })
      return
    }

    // Stream raw PCM (16-bit signed LE, 24kHz mono) to browser
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('X-Audio-Format', 'pcm-s16le')
    res.setHeader('X-Sample-Rate', '24000')
    res.setHeader('Transfer-Encoding', 'chunked')
    res.setHeader('Cache-Control', 'no-cache')

    if (response.body) {
      const reader = (response.body as any).getReader?.()
      if (reader) {
        const pump = async () => {
          while (true) {
            const { done, value } = await reader.read()
            if (done) { res.end(); break }
            res.write(Buffer.from(value))
          }
        }
        pump().catch(() => res.end())
      } else if ((response.body as any).pipe) {
        ;(response.body as any).pipe(res)
      } else {
        const buf = Buffer.from(await response.arrayBuffer())
        res.end(buf)
      }
    } else {
      const buf = Buffer.from(await response.arrayBuffer())
      res.end(buf)
    }
  } catch (err: any) {
    console.error('TTS stream error:', err)
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'Errore streaming' })
    }
  }
})

// POST /api/tts/clone — Clone voice and speak
router.post('/clone', authMiddleware(true), async (req: AuthRequest, res: Response) => {
  try {
    const { text, referenceAudioBase64, voiceName, language = 'it' } = req.body
    const aziendaId = req.aziendaId || 'unknown'
    const userId = req.userId || 'unknown'

    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'Il campo "text" è obbligatorio.' })
      return
    }

    // If voiceName is provided, load from saved voices
    let audioToUse = referenceAudioBase64
    if (voiceName && !audioToUse) {
      const voicePath = path.join(UPLOADS_DIR, aziendaId, userId, 'voices', `${voiceName.replace(/[^a-zA-Z0-9_-]/g, '_')}.wav`)
      if (fs.existsSync(voicePath)) {
        audioToUse = fs.readFileSync(voicePath).toString('base64')
      } else {
        res.status(404).json({ error: `Voce "${voiceName}" non trovata` })
        return
      }
    }

    if (!audioToUse) {
      res.status(400).json({ error: 'Audio di riferimento o nome voce richiesto.' })
      return
    }

    // Voice cloning via dedicated endpoint
    const cloneUrl = TTS_API_URL.replace('/v1/audio/speech', '/v1/audio/voice-clone')

    // Strip data URL prefix if present (e.g., "data:audio/webm;base64,...")
    let cleanBase64 = audioToUse
    if (cleanBase64.includes(',')) {
      cleanBase64 = cleanBase64.split(',')[1]
    }
    // Fix padding
    while (cleanBase64.length % 4 !== 0) {
      cleanBase64 += '='
    }

    // Convert webm/opus to WAV using ffmpeg (TTS server only accepts WAV/MP3)
    try {
      const tmpDir = path.join(UPLOADS_DIR, 'tmp')
      fs.mkdirSync(tmpDir, { recursive: true })
      const inputFile = path.join(tmpDir, `ref-${crypto.randomUUID()}.webm`)
      const outputFile = inputFile.replace('.webm', '.wav')
      fs.writeFileSync(inputFile, Buffer.from(cleanBase64, 'base64'))
      execSync(`ffmpeg -y -i "${inputFile}" -ar 16000 -ac 1 "${outputFile}" 2>/dev/null`, { timeout: 15000 })
      cleanBase64 = fs.readFileSync(outputFile).toString('base64')
      // Cleanup
      fs.unlinkSync(inputFile)
      fs.unlinkSync(outputFile)
    } catch (convErr) {
      console.warn('Audio conversion failed, using original:', (convErr as Error).message)
    }

    const response = await fetch(cloneUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: text.trim(),
        ref_audio: cleanBase64,
        x_vector_only_mode: true,
        language: language === 'Italian' ? 'Italian' : language,
        response_format: 'mp3',
        speed: 1.0,
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error('TTS clone error:', response.status, errText)
      res.status(502).json({ error: `Errore clonazione vocale: ${response.status}` })
      return
    }

    // aziendaId and userId already declared above
    const audioDir = path.join(UPLOADS_DIR, aziendaId, userId, 'audio')
    fs.mkdirSync(audioDir, { recursive: true })

    const filename = `clone-${crypto.randomUUID()}.mp3`
    const filePath = path.join(audioDir, filename)

    const arrayBuffer = await response.arrayBuffer()
    fs.writeFileSync(filePath, Buffer.from(arrayBuffer))

    const audioUrl = `/api/uploads/${aziendaId}/${userId}/audio/${filename}`
    res.json({ audioUrl, language, cloned: true })
  } catch (err: any) {
    console.error('TTS clone error:', err)
    res.status(500).json({ error: err.message || 'Errore interno clonazione vocale' })
  }
})

// GET /api/tts/voices — List available voices (built-in + cloned)
router.get('/voices', authMiddleware(true), (req: AuthRequest, res: Response) => {
  const aziendaId = req.aziendaId || 'unknown'
  const userId = req.userId || 'unknown'

  // Get cloned voices
  const clonedDir = path.join(UPLOADS_DIR, aziendaId, userId, 'voices')
  const clonedVoices: { name: string; file: string }[] = []
  if (fs.existsSync(clonedDir)) {
    const files = fs.readdirSync(clonedDir).filter(f => f.endsWith('.wav'))
    for (const file of files) {
      clonedVoices.push({ name: file.replace('.wav', ''), file })
    }
  }

  res.json({ builtin: [...AVAILABLE_VOICES], cloned: clonedVoices })
})

// POST /api/tts/save-voice — Save a cloned voice reference audio
router.post('/save-voice', authMiddleware(true), (req: AuthRequest, res: Response) => {
  try {
    const { name, audioBase64 } = req.body
    const aziendaId = req.aziendaId || 'unknown'
    const userId = req.userId || 'unknown'

    if (!name || !audioBase64) {
      res.status(400).json({ error: 'name e audioBase64 sono richiesti' })
      return
    }

    // Sanitize name
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 30)

    // Strip data URL prefix
    let cleanBase64 = audioBase64
    if (cleanBase64.includes(',')) cleanBase64 = cleanBase64.split(',')[1]
    while (cleanBase64.length % 4 !== 0) cleanBase64 += '='

    // Convert to WAV
    const tmpDir = path.join(UPLOADS_DIR, 'tmp')
    fs.mkdirSync(tmpDir, { recursive: true })
    const inputFile = path.join(tmpDir, `voice-${crypto.randomUUID()}.webm`)
    const outputFile = inputFile.replace('.webm', '.wav')
    fs.writeFileSync(inputFile, Buffer.from(cleanBase64, 'base64'))

    try {
      execSync(`ffmpeg -y -i "${inputFile}" -ar 16000 -ac 1 "${outputFile}" 2>/dev/null`, { timeout: 15000 })
    } catch {
      // Maybe already WAV, try using as-is
      fs.copyFileSync(inputFile, outputFile)
    }

    // Save to voices directory
    const voicesDir = path.join(UPLOADS_DIR, aziendaId, userId, 'voices')
    fs.mkdirSync(voicesDir, { recursive: true })
    const destPath = path.join(voicesDir, `${safeName}.wav`)
    fs.renameSync(outputFile, destPath)

    // Cleanup
    try { fs.unlinkSync(inputFile) } catch {}

    res.json({ success: true, name: safeName })
  } catch (err: any) {
    console.error('Save voice error:', err)
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/tts/voice/:name — Delete a cloned voice
router.delete('/voice/:name', authMiddleware(true), (req: AuthRequest, res: Response) => {
  try {
    const aziendaId = req.aziendaId || 'unknown'
    const userId = req.userId || 'unknown'
    const name = req.params.name.replace(/[^a-zA-Z0-9_-]/g, '_')

    const filePath = path.join(UPLOADS_DIR, aziendaId, userId, 'voices', `${name}.wav`)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
      res.json({ success: true })
    } else {
      res.status(404).json({ error: 'Voce non trovata' })
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/tts/health — Check if TTS service is available
router.get('/health', async (_req, res) => {
  try {
    const healthUrl = TTS_API_URL.replace('/v1/audio/speech', '/health')
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) })
    res.json({ available: response.ok })
  } catch {
    res.json({ available: false })
  }
})

export default router
