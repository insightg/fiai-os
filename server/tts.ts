import { Router, Response } from 'express'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { AuthRequest, authMiddleware } from './middleware.js'

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

    // Use language-suffixed model for correct language output
    const model = `tts-1-${language}`

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

// POST /api/tts/clone — Clone voice and speak
router.post('/clone', authMiddleware(true), async (req: AuthRequest, res: Response) => {
  try {
    const { text, referenceAudioBase64, language = 'it' } = req.body

    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'Il campo "text" è obbligatorio.' })
      return
    }

    if (!referenceAudioBase64) {
      res.status(400).json({ error: 'Audio di riferimento obbligatorio per la clonazione.' })
      return
    }

    // For voice cloning, use the clone: prefix if supported
    const model = `tts-1-${language}`

    const response = await fetch(TTS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        voice: `clone:reference`,
        input: text.trim(),
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

    const aziendaId = req.aziendaId || 'unknown'
    const userId = req.userId || 'unknown'
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

// GET /api/tts/voices — List available voices
router.get('/voices', (_req, res) => {
  res.json({ voices: AVAILABLE_VOICES })
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
