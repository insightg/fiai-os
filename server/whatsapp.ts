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

// Map LID → phone number (WhatsApp uses LID format in newer versions)
const lidPhoneMap = new Map<string, string>()
// Pending login attempts: LID → user record (waiting for password)
const pendingLogins = new Map<string, any>()
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
    browser: ['BERNARDINI', 'Chrome', '131.0.0'],
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

  // Resolve phone number — handle both @s.whatsapp.net and @lid formats
  let phone = ''
  if (sender.endsWith('@s.whatsapp.net')) {
    phone = sender.replace('@s.whatsapp.net', '').replace(/^\+/, '')
  } else if (sender.endsWith('@lid')) {
    // LID format: resolve via in-memory cache or DB lookup
    const lidId = sender.replace('@lid', '')
    phone = lidPhoneMap.get(lidId) || ''
    if (!phone) {
      const byLid = db.prepare(
        "SELECT telefono FROM entity WHERE json_extract(metadata, '$.whatsapp_lid') = ? AND telefono IS NOT NULL LIMIT 1"
      ).get(lidId) as any
      if (byLid?.telefono) {
        phone = byLid.telefono.replace(/^\+/, '')
        lidPhoneMap.set(lidId, phone)
      }
    }
  } else {
    phone = sender.replace(/[^0-9]/g, '')
  }

  // No phone resolved — check if this is a pending login attempt
  if (!phone && sender.endsWith('@lid')) {
    const lidId = sender.replace('@lid', '')
    const pending = pendingLogins.get(lidId)

    if (pending) {
      // Second message: expecting password
      const bcrypt = await import('bcryptjs')
      const password = text.trim()
      const meta = typeof pending.metadata === 'string' ? JSON.parse(pending.metadata) : pending.metadata
      const match = await bcrypt.compare(password, meta.password_hash || '')
      pendingLogins.delete(lidId)

      if (match) {
        // Login OK — save LID mapping + auth timestamp
        const userPhone = pending.telefono?.replace(/^\+/, '') || lidId
        db.prepare("UPDATE entity SET metadata = json_set(metadata, '$.whatsapp_lid', ?, '$.whatsapp_active', 1, '$.whatsapp_auth_at', ?) WHERE id = ?").run(lidId, new Date().toISOString(), pending.id)
        lidPhoneMap.set(lidId, userPhone)
        const { getSetting } = await import('./settings.js')
        await sock.sendMessage(sender, { text: `✅ Autenticato come *${pending.display_name}*!\n\nOra puoi usare ${getSetting('company_short_name') || 'il sistema'} da WhatsApp. La sessione scade dopo 1 ora.` })
      } else {
        await sock.sendMessage(sender, { text: '❌ Password errata. Riprova scrivendo la tua email.' })
      }
      return
    }

    // Check if text looks like an email — start login flow
    const emailMatch = text.trim().match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
    if (emailMatch) {
      const email = emailMatch[0].toLowerCase()
      const user = db.prepare("SELECT id, display_name, telefono, metadata FROM entity WHERE email = ? AND tags LIKE '%\"utente\"%'").get(email) as any
      if (user) {
        pendingLogins.set(lidId, user)
        await sock.sendMessage(sender, { text: `👤 *${user.display_name}*\n\nInvia la tua password per autenticarti:` })
      } else {
        await sock.sendMessage(sender, { text: `❌ Email "${email}" non trovata.` })
      }
      return
    }

    // First contact — ask for email
    const { getSetting } = await import('./settings.js')
    await sock.sendMessage(sender, { text: `👋 Benvenuto in *${getSetting('company_short_name') || 'il sistema'}*!\n\nPer autenticarti, invia la tua *email* di accesso:` })
    return
  }

  if (!phone) {
    await sock.sendMessage(sender, { text: '⚠️ Numero non riconosciuto. Contatta l\'amministratore.' })
    return
  }

  let waUser: any = null

  // VFS: search in names by telefono
  const nameUser = db.prepare(
    "SELECT id as user_id, display_name as nome, '' as cognome, metadata, azienda_id, email FROM entity WHERE (telefono = ? OR telefono = ?) AND tags LIKE '%\"utente\"%'"
  ).get(phone, '+' + phone) as any
  if (nameUser) {
    const meta = typeof nameUser.metadata === 'string' ? JSON.parse(nameUser.metadata) : nameUser.metadata
    waUser = { ...nameUser, ruolo: meta?.ruolo || 'collaboratore', azienda_id: nameUser.azienda_id }
    // Resolve azienda_id from relation if null
    if (!waUser.azienda_id) {
      const rel = db.prepare("SELECT to_id FROM relations WHERE from_id = ? AND tipo = 'membro_di' LIMIT 1").get(nameUser.user_id) as any
      if (rel) waUser.azienda_id = rel.to_id
    }
  }

  // No fallback — VFS only

  if (!waUser) {
    await sock.sendMessage(sender, { text: '⚠️ Numero non riconosciuto.\n\nChiedi al tuo amministratore di collegare questo numero al tuo profilo.' })
    return
  }

  // Check if phone user has pending re-auth (BEFORE auth expiry check — otherwise expiry re-triggers every message)
  const phonePending = pendingLogins.get(phone)
  if (phonePending) {
    if (phonePending._awaitingEmail) {
      // Expecting email
      const emailMatch = text.trim().match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
      if (emailMatch) {
        // Verify email matches the user's email
        const userEmail = (phonePending.email || '').toLowerCase()
        if (!userEmail || emailMatch[0].toLowerCase() === userEmail) {
          phonePending._awaitingEmail = false
          pendingLogins.set(phone, phonePending)
          await sock.sendMessage(sender, { text: `👤 *${phonePending.nome || phonePending.display_name}*\n\nInvia la tua *password*:` })
        } else {
          await sock.sendMessage(sender, { text: '❌ Email non corrisponde al tuo profilo. Riprova.' })
        }
      } else {
        await sock.sendMessage(sender, { text: '📧 Invia la tua *email* di accesso per continuare:' })
      }
      return
    } else {
      // Expecting password
      const bcryptMod = await import('bcryptjs')
      const meta = typeof phonePending.metadata === 'string' ? JSON.parse(phonePending.metadata) : phonePending.metadata
      const match = await bcryptMod.compare(text.trim(), meta?.password_hash || '')
      pendingLogins.delete(phone)
      if (match) {
        db.prepare("UPDATE entity SET metadata = json_set(metadata, '$.whatsapp_auth_at', ?) WHERE id = ?").run(new Date().toISOString(), phonePending.user_id)
        await sock.sendMessage(sender, { text: `✅ Riautenticato come *${phonePending.nome || phonePending.display_name}*! Sessione valida per 1 ora.` })
      } else {
        await sock.sendMessage(sender, { text: '❌ Password errata. Scrivi la tua email per riprovare.' })
      }
      return
    }
  }

  // Check WhatsApp auth expiry (1 hour)
  const waMeta = typeof waUser.metadata === 'string' ? JSON.parse(waUser.metadata) : (waUser.metadata || {})
  const authAt = waMeta.whatsapp_auth_at ? new Date(waMeta.whatsapp_auth_at).getTime() : 0
  const AUTH_TTL = 3600000 // 1 hour
  if (Date.now() - authAt > AUTH_TTL) {
    // Auth expired or never authenticated — start login flow
    pendingLogins.set(phone, { ...waUser, _awaitingEmail: true })
    const { getSetting } = await import('./settings.js')
    await sock.sendMessage(sender, { text: `🔒 *Sessione scaduta*\n\nPer continuare a usare ${getSetting('company_short_name') || 'il sistema'}, invia la tua *email* di accesso:` })
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
      // Don't append tool results — the agent text already contains the summary
      const waText = formatForWhatsApp(response.text, [])
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
  useOcr?: boolean
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
      useOcr: isScanned,
    })

    // Check if PDF needs OCR
    const ext2 = path.extname(fileName).toLowerCase()
    let isScanned = false
    if (ext2 === '.pdf') {
      const { needsOcr: checkOcr } = await import('./ocr.js')
      isScanned = checkOcr(extractedText, buffer.length, 0)
    }

    const tagsStr = tags.length > 0 ? tags.join(', ') : 'nessuno'
    await sock.sendMessage(sender, {
      text: `📄 *Documento ricevuto: ${fileName}*\n\n` +
        `*Categoria:* ${categoria}\n` +
        `*Tags:* ${tagsStr}\n` +
        `*Descrizione:* ${descrizione || '(nessuna)'}\n\n` +
        `${extractedText ? `_Testo estratto (anteprima):_ ${extractedText.substring(0, 200)}...\n\n` : ''}` +
        `${isScanned ? '⚠️ *PDF scannerizzato rilevato* — il testo verra\' estratto con OCR (Riconoscitore AI)\n\n' : ''}` +
        `Vuoi archiviarlo? Rispondi:\n` +
        `✅ *sì* — archivia con questi dati${isScanned ? ' + OCR' : ''}\n` +
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
    const entityId = crypto.randomUUID()
    const slug = pending.fileName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 80)

    // Save as entity (same as web upload)
    db.prepare(`INSERT INTO entity (id, azienda_id, type, display_name, slug, stato, user_id, file_url, body, categoria, metadata, path)
      VALUES (?, ?, 'documento', ?, ?, 'processing', ?, ?, ?, ?, ?, ?)`).run(
      entityId, pending.aziendaId,
      pending.fileName, slug,
      pending.userId, pending.fileUrl,
      pending.extractedText || null,
      pending.categoria,
      JSON.stringify({
        tipo_file: path.extname(pending.fileName).replace('.', '') || 'pdf',
        tags: pending.tags,
        descrizione: pending.descrizione,
        uploaded_via: 'whatsapp',
      }),
      `/entity/documento/${slug}`
    )

    // Create background job for chunking + tagging + embedding (+ OCR if needed)
    const jobId = crypto.randomUUID()
    db.prepare(`INSERT INTO entity (id, azienda_id, type, display_name, slug, stato, data, metadata, path)
      VALUES (?, ?, 'job', ?, ?, 'queued', datetime('now'), ?, ?)`).run(
      jobId, pending.aziendaId,
      `Processa: ${pending.fileName}`, `process-doc-${entityId.substring(0, 8)}`,
      JSON.stringify({
        action: 'process_document',
        params: { entityId, fileName: pending.fileName, use_ocr: pending.useOcr || false },
      }),
      `/entity/job/process-doc-${entityId.substring(0, 8)}`
    )

    pendingArchive.delete(sender)
    const ocrNote = pending.useOcr ? '\n🔍 OCR in corso — il testo verra\' estratto dalle immagini.' : ''
    await sock.sendMessage(sender, {
      text: `✅ *${pending.fileName}* archiviato come *${pending.categoria}*.${ocrNote}\n\nOra è ricercabile nel sistema documentale.`
    })
  } catch (err: any) {
    await sock.sendMessage(sender, { text: `❌ Errore archiviazione: ${err.message}` })
    pendingArchive.delete(sender)
  }
}

// ── Session management (persistent in DB via handleChatMessage) ──

function getWhatsAppSessionId(userId: string): string {
  // One session per user per day (allows natural conversation continuity)
  const today = new Date().toISOString().split('T')[0]
  return `wa-${userId}-${today}`
}

// ── Use shared server-side orchestrator ──────────────────

import { handleChatMessage } from './agents/index.js'

async function callAgent(userMessage: string, userId: string, sender: string): Promise<{ text: string; toolCalls: any[]; agentName?: string }> {
  // Resolve azienda_id from relation membro_di
  const rel = db.prepare("SELECT to_id FROM relations WHERE from_id = ? AND tipo = 'membro_di' LIMIT 1").get(userId) as any
  const aziendaId = rel?.to_id || (db.prepare("SELECT azienda_id FROM entity WHERE id = ?").get(userId) as any)?.azienda_id || ''

  const sessionId = getWhatsAppSessionId(userId)

  // handleChatMessage now handles history loading from DB + persistence
  const result = await handleChatMessage(userMessage, userId, aziendaId, {
    format: 'whatsapp',
    sessionId,
    channel: 'whatsapp',
  })

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
      text: '*BERNARDINI AI - Comandi WhatsApp*\n\n' +
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
    await sock.sendMessage(sender, { text: 'Formato: *!voce 3331234567 Benvenuto in BERNARDINI*\nOppure: *!parla 3331234567 il tuo messaggio*' })
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
  // For LID senders, we need the user to provide their phone via the link
  const isLid = sender.endsWith('@lid')

  // Find user by email in names
  const user = db.prepare("SELECT id, display_name FROM entity WHERE email = ? AND tags LIKE '%\"utente\"%'").get(email) as any

  if (!user) {
    await sock.sendMessage(sender, { text: `❌ Email "${email}" non trovata nel sistema BERNARDINI.` })
    return
  }

  // Get user's phone from names
  const userRec = db.prepare("SELECT telefono FROM entity WHERE id = ?").get(user.id) as any
  const userPhone = userRec?.telefono?.replace(/^\+/, '') || ''

  // If LID, save the mapping
  if (isLid && userPhone) {
    const lidId = sender.replace('@lid', '')
    lidPhoneMap.set(lidId, userPhone)
  }

  // Ensure whatsapp_active is set
  db.prepare("UPDATE entity SET metadata = json_set(metadata, '$.whatsapp_active', 1) WHERE id = ?").run(user.id)

  await sock.sendMessage(sender, {
    text: `✅ Collegato come *${user.display_name}*!\n\nScrivi !help per vedere i comandi disponibili.`
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
          const name = item.display_name || item.nome || item.ragione_sociale || item.titolo || `#${i + 1}`
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
<html><head><title>BERNARDINI WhatsApp QR</title>
<meta http-equiv="refresh" content="5">
<style>
  body { display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; margin:0; font-family:sans-serif; background:#111; color:#fff; }
  img { border-radius:16px; border:3px solid #C41E3A; }
  h2 { color:#C41E3A; margin-bottom:8px; }
  p { color:#888; font-size:14px; }
</style></head>
<body>
  <h2>BERNARDINI — WhatsApp</h2>
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
    SELECT id, display_name, email, telefono, tags, metadata
    FROM entity
    WHERE tags LIKE '%"utente"%' AND telefono IS NOT NULL AND telefono != ''
    ORDER BY display_name
  `).all()
  res.json({ users })
})

whatsappRouter.post('/users', authMiddleware(true), (req: AuthRequest, res: Response) => {
  const { phone, userId } = req.body
  if (!phone || !userId) { res.status(400).json({ error: 'phone e userId richiesti' }); return }

  db.prepare("UPDATE entity SET telefono = ?, tags = json_insert(COALESCE(tags, '[]'), '$[#]', 'whatsapp_enabled'), metadata = json_set(COALESCE(metadata, '{}'), '$.whatsapp_enabled', 1) WHERE id = ?").run(phone, userId)
  res.json({ success: true })
})

whatsappRouter.delete('/users/:phone', authMiddleware(true), (req: AuthRequest, res: Response) => {
  db.prepare("UPDATE entity SET metadata = json_set(COALESCE(metadata, '{}'), '$.whatsapp_enabled', 0) WHERE telefono = ?").run(req.params.phone)
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
