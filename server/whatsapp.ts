import makeWASocket, { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, WAMessage } from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import P from 'pino'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import db from './db.js'
import { Router, Response } from 'express'
import { AuthRequest, authMiddleware } from './middleware.js'

const AUTH_DIR = process.env.WHATSAPP_AUTH_DIR || '/app/data/whatsapp-auth'
const UPLOADS_DIR = process.env.UPLOADS_DIR || '/app/data/uploads'

let sock: any = null
let qrCode: string | null = null
let connectionStatus: 'disconnected' | 'connecting' | 'connected' = 'disconnected'

// ── WhatsApp Connection ──────────────────────────────────

export async function startWhatsApp() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.log('WhatsApp: OPENROUTER_API_KEY not set, skipping')
    return
  }

  fs.mkdirSync(AUTH_DIR, { recursive: true })
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
  const { version } = await fetchLatestBaileysVersion()

  connectionStatus = 'connecting'

  sock = makeWASocket({
    version,
    auth: state,
    logger: P({ level: 'silent' }),
    browser: ['FIAI OS', 'Chrome', '131.0.0'],
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', (update: any) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      qrCode = qr
      console.log('WhatsApp: QR code generated, scan with your phone')
    }

    if (connection === 'close') {
      connectionStatus = 'disconnected'
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut
      console.log('WhatsApp: connection closed, reconnect:', shouldReconnect)
      if (shouldReconnect) {
        setTimeout(() => startWhatsApp(), 5000)
      }
    } else if (connection === 'open') {
      connectionStatus = 'connected'
      qrCode = null
      console.log('WhatsApp: Connected!')
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }: { messages: WAMessage[] }) => {
    for (const msg of messages) {
      try {
        await handleIncomingMessage(msg)
      } catch (err) {
        console.error('WhatsApp message handler error:', err)
      }
    }
  })
}

// ── Message Handler ──────────────────────────────────────

async function handleIncomingMessage(msg: WAMessage) {
  if (msg.key.fromMe) return
  const sender = msg.key.remoteJid
  if (!sender) return

  // Extract text from various message types
  const text = msg.message?.conversation
    || msg.message?.extendedTextMessage?.text
    || msg.message?.imageMessage?.caption
    || msg.message?.documentMessage?.caption
    || ''

  // Check for document/image attachments
  const hasDocument = !!msg.message?.documentMessage
  const hasImage = !!msg.message?.imageMessage

  if (!text.trim() && !hasDocument && !hasImage) return

  console.log(`WhatsApp message from ${sender}: ${text.substring(0, 50)}${hasDocument ? ' [+doc]' : ''}${hasImage ? ' [+img]' : ''}`)

  // Check if user is authorized — lookup in unified user_profiles
  const phone = sender.replace('@s.whatsapp.net', '').replace('@lid', '')
  const waUser = db.prepare(
    'SELECT up.id as user_id, up.nome, up.cognome, up.ruolo, up.azienda_id, up.email FROM user_profiles up WHERE up.whatsapp_phone = ? AND up.whatsapp_active = 1'
  ).get(phone) as any

  if (!waUser) {
    await sock.sendMessage(sender, { text: '⚠️ Numero non riconosciuto.\n\nChiedi al tuo amministratore di collegare questo numero al tuo profilo FIAI.' })
    return
  }

  // Handle document uploads
  if (hasDocument || hasImage) {
    await handleDocumentUpload(msg, sender, waUser, text)
    return
  }

  // Check for pending document archive confirmation
  if (checkPendingArchive(sender, text)) return

  // Handle special commands
  if (text.startsWith('!')) {
    await handleSpecialCommand(sender, text, waUser)
    return
  }

  // Send to AI agent
  await sock.sendMessage(sender, { text: '⏳ _Elaboro la tua richiesta..._' })

  try {
    const response = await callAgent(text, waUser.user_id, sender)

    // Check if response has media to send
    let mediaSent = false
    for (const tc of response.toolCalls || []) {
      const result = tc.result as any
      if (!result) continue

      if (tc.tool === 'generate_image' && result.image_url) {
        try {
          const imageUrl = result.image_url
          if (imageUrl.startsWith('data:')) {
            const base64Data = imageUrl.split(',')[1]
            const buffer = Buffer.from(base64Data, 'base64')
            await sock.sendMessage(sender, { image: buffer, caption: `🎨 ${response.agentName || 'AI'}` })
            mediaSent = true
          }
        } catch (imgErr) {
          console.error('WhatsApp image send error:', imgErr)
        }
      }
    }

    // Send text only if no media was sent (avoid duplicate messages)
    if (!mediaSent) {
      // Filter out tool results with large data (images, base64)
      const cleanToolCalls = (response.toolCalls || []).filter((tc: any) => {
        if (tc.tool === 'generate_image') return false
        return true
      })
      const waText = formatForWhatsApp(response.text, cleanToolCalls)
      if (waText.trim()) {
        await sock.sendMessage(sender, { text: waText })
      }
    }
  } catch (err: any) {
    await sock.sendMessage(sender, { text: `❌ Errore: ${err.message}` })
  }
}

// ── AI Agent Call (server-side) ───────────────────────────

// ── Pending document archival confirmations ──────────────

const pendingArchive = new Map<string, {
  fileName: string
  fileUrl: string
  categoria: string
  tags: string[]
  descrizione: string
  extractedText: string
  aziendaId: string
  userId: string
  timestamp: number
}>()

// ── Handle Document Upload via WhatsApp ──────────────────

async function handleDocumentUpload(msg: WAMessage, sender: string, waUser: any, caption: string) {
  const docMsg = msg.message?.documentMessage
  const imgMsg = msg.message?.imageMessage

  try {
    await sock.sendMessage(sender, { text: '📄 _Ricevo e analizzo il documento..._' })

    // Download the file
    const { downloadMediaMessage } = await import('@whiskeysockets/baileys')
    const buffer = await downloadMediaMessage(msg, 'buffer', {}) as Buffer

    const fileName = docMsg?.fileName || `whatsapp-${Date.now()}.${imgMsg ? 'jpg' : 'pdf'}`
    const mimeType = docMsg?.mimetype || imgMsg?.mimetype || 'application/octet-stream'

    // Save to disk
    const uploadDir = path.join(UPLOADS_DIR, waUser.azienda_id, waUser.user_id, 'documenti')
    fs.mkdirSync(uploadDir, { recursive: true })
    const safeFileName = `${crypto.randomUUID()}${path.extname(fileName)}`
    const filePath = path.join(uploadDir, safeFileName)
    fs.writeFileSync(filePath, buffer)

    const fileUrl = `/api/uploads/${waUser.azienda_id}/${waUser.user_id}/documenti/${safeFileName}`

    // Extract text
    let extractedText = ''
    const ext = path.extname(fileName).toLowerCase()
    if (ext === '.pdf') {
      try {
        const { PDFParse: pdfParse } = await import('pdf-parse')
        const pdfData = await pdfParse(buffer)
        extractedText = pdfData.text
      } catch { /* silent */ }
    } else if (ext === '.txt') {
      extractedText = buffer.toString('utf-8')
    }

    // AI categorization
    let categoria = 'altro'
    let tags: string[] = []
    let descrizione = caption || ''
    try {
      const { analyzeDocument: analyzeDoc } = await import('./ai.js')
      const textToAnalyze = extractedText || `File: ${fileName}`
      const analysis = await analyzeDoc(textToAnalyze.substring(0, 5000), fileName)
      categoria = analysis.categoria || 'altro'
      tags = analysis.tags || []
      descrizione = analysis.descrizione || descrizione
    } catch { /* silent */ }

    // Store pending archive and ask for confirmation
    pendingArchive.set(sender, {
      fileName, fileUrl, categoria, tags, descrizione,
      extractedText: extractedText.substring(0, 50000),
      aziendaId: waUser.azienda_id,
      userId: waUser.user_id,
      timestamp: Date.now(),
    })

    const tagsStr = tags.length > 0 ? tags.join(', ') : 'nessuno'
    await sock.sendMessage(sender, {
      text: `📄 *Documento ricevuto: ${fileName}*\n\n` +
        `*Categoria:* ${categoria}\n` +
        `*Tags:* ${tagsStr}\n` +
        `*Descrizione:* ${descrizione || '(nessuna)'}\n\n` +
        `${extractedText ? `_Testo estratto (anteprima):_ ${extractedText.substring(0, 200)}...\n\n` : ''}` +
        `Vuoi archiviarlo? Rispondi:\n` +
        `✅ *sì* — archivia con questi dati\n` +
        `✏️ *sì come [categoria]* — archivia con categoria diversa\n` +
        `❌ *no* — non archiviare`
    })
  } catch (err: any) {
    console.error('WhatsApp document upload error:', err)
    await sock.sendMessage(sender, { text: `❌ Errore ricezione documento: ${err.message}` })
  }
}

// ── Check for pending archive confirmation ───────────────

function checkPendingArchive(sender: string, text: string): boolean {
  const pending = pendingArchive.get(sender)
  if (!pending) return false

  // Expire after 5 minutes
  if (Date.now() - pending.timestamp > 5 * 60 * 1000) {
    pendingArchive.delete(sender)
    return false
  }

  const t = text.toLowerCase().trim()

  if (t === 'no' || t === 'annulla' || t.startsWith('❌')) {
    pendingArchive.delete(sender)
    sock.sendMessage(sender, { text: '👌 Documento non archiviato.' })
    return true
  }

  if (t === 'sì' || t === 'si' || t === 'ok' || t.startsWith('✅')) {
    // Archive with current data
    archivePendingDocument(sender, pending)
    return true
  }

  // "sì come contratto" → change category
  const catMatch = t.match(/^(?:sì|si|ok)\s+(?:come|categoria)\s+(.+)/)
  if (catMatch) {
    pending.categoria = catMatch[1].trim()
    archivePendingDocument(sender, pending)
    return true
  }

  return false
}

async function archivePendingDocument(sender: string, pending: typeof pendingArchive extends Map<string, infer V> ? V : never) {
  try {
    const id = crypto.randomUUID()
    const tagsJson = JSON.stringify(pending.tags)

    db.prepare(
      'INSERT INTO documenti (id, azienda_id, nome, tipo_file, categoria, descrizione, file_url, tags, contenuto_testo, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      id, pending.aziendaId, pending.fileName,
      path.extname(pending.fileName).replace('.', '') || 'pdf',
      pending.categoria, pending.descrizione, pending.fileUrl,
      tagsJson, pending.extractedText, pending.userId
    )

    pendingArchive.delete(sender)
    await sock.sendMessage(sender, {
      text: `✅ *${pending.fileName}* archiviato come *${pending.categoria}*.\n\nOra è ricercabile nel sistema documentale.`
    })
  } catch (err: any) {
    await sock.sendMessage(sender, { text: `❌ Errore archiviazione: ${err.message}` })
    pendingArchive.delete(sender)
  }
}

// ── Conversation History per sender (for multi-turn WhatsApp) ──

const conversationHistory = new Map<string, { role: string; content: string }[]>()
const senderSessions = new Map<string, string>()

function getConversationHistory(sender: string): { role: string; content: string }[] {
  if (!conversationHistory.has(sender)) {
    conversationHistory.set(sender, [])
  }
  return conversationHistory.get(sender)!
}

function addToHistory(sender: string, role: string, content: string): void {
  const history = getConversationHistory(sender)
  history.push({ role, content })
  // Keep last 10 messages
  if (history.length > 10) {
    history.splice(0, history.length - 10)
  }
}

function getSessionId(sender: string): string {
  if (!senderSessions.has(sender)) {
    senderSessions.set(sender, `wa-${sender.replace(/\D/g, '')}-${Date.now()}`)
  }
  return senderSessions.get(sender)!
}

// ── Use shared server-side orchestrator ──────────────────

import { handleChatMessage } from './agents/index.js'

async function callAgent(userMessage: string, userId: string, sender: string): Promise<{ text: string; toolCalls: any[]; agentName?: string }> {
  const profile = db.prepare('SELECT * FROM user_profiles WHERE id = ?').get(userId) as any
  const aziendaId = profile?.azienda_id || ''

  const history = getConversationHistory(sender)
  const sessionId = getSessionId(sender)

  // Add user message to history
  addToHistory(sender, 'user', userMessage)

  const result = await handleChatMessage(userMessage, userId, aziendaId, {
    format: 'whatsapp',
    sessionId,
    history: history.slice(0, -1), // exclude current message (already passed as `message`)
  })

  // Add assistant response to history
  addToHistory(sender, 'assistant', result.text)

  return result
}

// ── Special Commands ─────────────────────────────────────

async function handleSpecialCommand(sender: string, text: string, waUser: any) {
  const cmd = text.toLowerCase().trim()

  // Voice message to a user
  if (cmd.startsWith('!voce ') || cmd.startsWith('!parla ')) {
    await handleVoiceMessage(sender, text, waUser)
    return
  }

  if (cmd === '!help') {
    await sock.sendMessage(sender, {
      text: '*FIAI AI - Comandi WhatsApp*\n\n' +
        '!help — Questo messaggio\n' +
        '!stato — Overview aziendale\n' +
        '!clienti — Lista clienti\n' +
        '!fatture — Fatture scadute\n' +
        '!progetti — Stato progetti\n' +
        '!lead — Pipeline lead\n' +
        '!voce <numero> <testo> — Invia vocale\n\n' +
        'Oppure scrivi qualsiasi domanda!'
    })
    return
  }

  // Map commands to queries
  const cmdMap: Record<string, string> = {
    '!stato': 'Dammi una overview rapida dell\'azienda',
    '!clienti': 'Lista clienti',
    '!fatture': 'Ci sono fatture scadute?',
    '!progetti': 'Stato dei progetti in corso',
    '!lead': 'Stato della pipeline commerciale',
  }

  const query = cmdMap[cmd]
  if (query) {
    await sock.sendMessage(sender, { text: '⏳ _Recupero dati..._' })
    const response = await callAgent(query, waUser.user_id, sender)
    await sock.sendMessage(sender, { text: formatForWhatsApp(response.text, []) })
    return
  }

  // Unknown command — treat as normal message
  await sock.sendMessage(sender, { text: '⏳ _Elaboro..._' })
  const response = await callAgent(text.substring(1), waUser.user_id, sender)
  await sock.sendMessage(sender, { text: formatForWhatsApp(response.text, []) })
}

// ── Voice Message Command ────────────────────────────────

async function handleVoiceMessage(sender: string, text: string, _waUser: any) {
  // Format: !voce <numero> <messaggio> OR !parla <numero> <messaggio>
  const match = text.match(/^!(?:voce|parla)\s+(\d+)\s+(.+)/i)
  if (!match) {
    await sock.sendMessage(sender, { text: 'Formato: *!voce 3331234567 Benvenuto in FIAI*\nOppure: *!parla 3331234567 il tuo messaggio*' })
    return
  }

  const targetPhone = match[1]
  const message = match[2]
  const targetJid = targetPhone.includes('@') ? targetPhone : `${targetPhone}@s.whatsapp.net`

  await sock.sendMessage(sender, { text: `⏳ _Genero il messaggio vocale..._` })

  try {
    await sendVoiceNote(targetJid, message)
    await sock.sendMessage(sender, { text: `✅ Messaggio vocale inviato a ${targetPhone}` })
  } catch (err: any) {
    await sock.sendMessage(sender, { text: `❌ Errore: ${err.message}` })
  }
}

async function sendVoiceNote(targetJid: string, text: string, voice: string = 'Vivian') {
  const TTS_API_URL = process.env.TTS_API_URL || 'http://host.docker.internal:7777/v1/audio/speech'

  // Generate audio from TTS
  const ttsRes = await fetch(TTS_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'tts-1',
      voice,
      input: text,
      response_format: 'mp3',
      speed: 1.0,
    }),
  })

  if (!ttsRes.ok) throw new Error(`TTS error: ${ttsRes.status}`)

  const audioBuffer = Buffer.from(await ttsRes.arrayBuffer())

  // Send as voice note (ptt = push-to-talk = voice note bubble)
  await sock.sendMessage(targetJid, {
    audio: audioBuffer,
    mimetype: 'audio/mpeg',
    ptt: true, // This makes it appear as a voice note, not an audio file
  })
}

// Exported for external use (e.g., from agents/tool-registry)
export { sendVoiceNote }
export function getSock() { return sock }

// ── Link Command ─────────────────────────────────────────

async function handleLinkCommand(sender: string, text: string) {
  const email = text.replace('!collega ', '').trim().toLowerCase()
  const phone = sender.replace('@s.whatsapp.net', '')

  // Find user by email
  const user = db.prepare('SELECT up.id, up.nome, up.cognome FROM user_profiles up JOIN users u ON u.id = up.id WHERE u.email = ?').get(email) as any

  if (!user) {
    await sock.sendMessage(sender, { text: `❌ Email "${email}" non trovata nel sistema FIAI.` })
    return
  }

  // Check if already linked
  const existing = db.prepare('SELECT id FROM whatsapp_users WHERE phone = ?').get(phone) as any
  if (existing) {
    db.prepare('UPDATE whatsapp_users SET user_id = ?, active = 1 WHERE phone = ?').run(user.id, phone)
  } else {
    db.prepare('INSERT INTO whatsapp_users (id, phone, user_id, active) VALUES (?, ?, ?, 1)').run(crypto.randomUUID(), phone, user.id)
  }

  await sock.sendMessage(sender, {
    text: `✅ Collegato come *${user.nome} ${user.cognome}*!\n\nScrivi !help per vedere i comandi disponibili.`
  })
}

// ── Format for WhatsApp ──────────────────────────────────

function formatForWhatsApp(text: string, toolCalls: any[]): string {
  let wa = text
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/#{1,3}\s(.+)/gm, '*$1*\n')
    .replace(/\|[^\n]+\|/gm, '')
    .replace(/\|-+\|/gm, '')
    .replace(/---+/g, '———')
    .replace(/\n{3,}/g, '\n\n')

  // Append tool results
  for (const tc of toolCalls) {
    if (tc.result && typeof tc.result === 'object') {
      if (Array.isArray(tc.result)) {
        const items = tc.result.slice(0, 10).map((item: any, i: number) => {
          const name = item.nome || item.ragione_sociale || item.titolo || `#${i + 1}`
          const stato = item.stato ? ` (${item.stato})` : ''
          return `${i + 1}. ${name}${stato}`
        }).join('\n')
        if (items) wa += '\n\n' + items
      } else {
        const entries = Object.entries(tc.result)
          .filter(([k]) => !k.startsWith('_') && k !== 'errore')
          .slice(0, 10)
          .map(([k, v]) => `• *${k}*: ${v}`)
          .join('\n')
        if (entries) wa += '\n\n' + entries
      }
    }
  }

  return wa.substring(0, 4096)
}

// ── Admin API Routes ─────────────────────────────────────

export const whatsappRouter = Router()

// GET /api/whatsapp/qr — Serve QR code as PNG image (no auth, for quick scan)
whatsappRouter.get('/qr', async (_req, res: Response) => {
  if (!qrCode) {
    if (connectionStatus === 'connected') {
      res.setHeader('Content-Type', 'text/html')
      res.send('<html><body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background:#111;color:#4CAF50"><h1>WhatsApp Connesso</h1></body></html>')
    } else {
      res.setHeader('Content-Type', 'text/html')
      res.send('<html><body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background:#111;color:#FFA000"><h1>In attesa del QR code... Ricarica tra qualche secondo.</h1><script>setTimeout(()=>location.reload(),3000)</script></body></html>')
    }
    return
  }
  try {
    const QRCode = (await import('qrcode')).default
    const png = await QRCode.toBuffer(qrCode, { width: 400, margin: 2 })
    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Cache-Control', 'no-cache, no-store')
    res.send(png)
  } catch {
    res.status(500).send('Errore generazione QR')
  }
})

// GET /api/whatsapp/qr-page — Full page with auto-refresh QR
whatsappRouter.get('/qr-page', (_req, res: Response) => {
  res.setHeader('Content-Type', 'text/html')
  res.send(`<!DOCTYPE html>
<html><head><title>FIAI WhatsApp QR</title>
<meta http-equiv="refresh" content="5">
<style>
  body { display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; margin:0; font-family:sans-serif; background:#111; color:#fff; }
  img { border-radius:16px; border:3px solid #C41E3A; }
  h2 { color:#C41E3A; margin-bottom:8px; }
  p { color:#888; font-size:14px; }
</style></head>
<body>
  <h2>FIAI — WhatsApp</h2>
  <p>Scansiona con WhatsApp → Dispositivi collegati</p>
  <img src="/api/whatsapp/qr" width="400" height="400" />
  <p style="margin-top:16px;font-size:12px;color:#555">Pagina si aggiorna ogni 5 secondi</p>
</body></html>`)
})

whatsappRouter.get('/status', authMiddleware(true), async (_req: AuthRequest, res: Response) => {
  let qrImage: string | null = null
  if (qrCode) {
    try {
      const QRCode = (await import('qrcode')).default
      qrImage = await QRCode.toDataURL(qrCode, { width: 300, margin: 2 })
    } catch { /* qrcode not available */ }
  }
  res.json({
    status: connectionStatus,
    qrCode: qrCode,
    qrImage: qrImage,
    hasAuth: fs.existsSync(path.join(AUTH_DIR, 'creds.json')),
  })
})

whatsappRouter.get('/users', authMiddleware(true), (_req: AuthRequest, res: Response) => {
  const users = db.prepare(`
    SELECT wu.*, up.nome, up.cognome, up.email
    FROM whatsapp_users wu
    LEFT JOIN user_profiles up ON up.id = wu.user_id
    ORDER BY wu.created_at DESC
  `).all()
  res.json({ users })
})

whatsappRouter.post('/users', authMiddleware(true), (req: AuthRequest, res: Response) => {
  const { phone, userId } = req.body
  if (!phone || !userId) { res.status(400).json({ error: 'phone e userId richiesti' }); return }

  const id = crypto.randomUUID()
  db.prepare('INSERT OR REPLACE INTO whatsapp_users (id, phone, user_id, active) VALUES (?, ?, ?, 1)').run(id, phone, userId)
  res.json({ success: true, id })
})

whatsappRouter.delete('/users/:phone', authMiddleware(true), (req: AuthRequest, res: Response) => {
  db.prepare('DELETE FROM whatsapp_users WHERE phone = ?').run(req.params.phone)
  res.json({ success: true })
})

// POST /api/whatsapp/send-voice — Send voice note from chat UI
whatsappRouter.post('/send-voice', authMiddleware(true), async (req: AuthRequest, res: Response) => {
  try {
    const { phone, text, voice } = req.body
    if (!phone || !text) { res.status(400).json({ error: 'phone e text richiesti' }); return }
    const cleanPhone = phone.replace(/\D/g, '')
    const jid = `${cleanPhone}@s.whatsapp.net`
    await sendVoiceNote(jid, text, voice || 'Vivian')
    res.json({ successo: true, messaggio: `Vocale inviato a ${cleanPhone}` })
  } catch (err: any) {
    res.status(500).json({ successo: false, messaggio: err.message })
  }
})

// POST /api/whatsapp/send-message — Send text message from chat UI
whatsappRouter.post('/send-message', authMiddleware(true), async (req: AuthRequest, res: Response) => {
  try {
    const { phone, text: msgText } = req.body
    if (!phone || !msgText) { res.status(400).json({ error: 'phone e text richiesti' }); return }
    if (!sock) { res.status(503).json({ error: 'WhatsApp non connesso' }); return }
    const cleanPhone = phone.replace(/\D/g, '')
    const jid = `${cleanPhone}@s.whatsapp.net`
    await sock.sendMessage(jid, { text: msgText })
    res.json({ successo: true, messaggio: `Messaggio inviato a ${cleanPhone}` })
  } catch (err: any) {
    res.status(500).json({ successo: false, messaggio: err.message })
  }
})

whatsappRouter.post('/restart', authMiddleware(true), async (_req: AuthRequest, res: Response) => {
  try {
    if (sock) {
      await sock.logout().catch(() => {})
      sock = null
    }
    // Clear auth
    fs.rmSync(AUTH_DIR, { recursive: true, force: true })
    fs.mkdirSync(AUTH_DIR, { recursive: true })
    await startWhatsApp()
    res.json({ success: true, message: 'WhatsApp restarted, scan QR code' })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})
