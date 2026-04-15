/**
 * Email Service Module — IMAP (ImapFlow) + SMTP (Nodemailer)
 *
 * Mirrors the WhatsApp module pattern: connection management,
 * send/receive, Express router, and agent tool integration.
 */

import { Router, Response } from 'express'
import { ImapFlow } from 'imapflow'
import nodemailer from 'nodemailer'
import { simpleParser, type ParsedMail } from 'mailparser'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { AuthRequest, authMiddleware } from './middleware.js'
import { handleChatMessage } from './agents/index.js'
import db from './db.js'

// ── Configuration ─────────────────────────────────────────

const EMAIL_USER = process.env.EMAIL_USER || 'fiaios@insightg.it'
const EMAIL_PASSWORD = process.env.EMAIL_PASSWORD || 'gg.Giobbe7'
const EMAIL_IMAP_HOST = process.env.EMAIL_IMAP_HOST || 'imaps.aruba.it'
const EMAIL_IMAP_PORT = parseInt(process.env.EMAIL_IMAP_PORT || '993')
const EMAIL_SMTP_HOST = process.env.EMAIL_SMTP_HOST || 'smtps.aruba.it'
const EMAIL_SMTP_PORT = parseInt(process.env.EMAIL_SMTP_PORT || '465')
const UPLOADS_DIR = process.env.UPLOADS_DIR || '/app/data/uploads'
const PROCESS_UNKNOWN = process.env.EMAIL_PROCESS_UNKNOWN === 'true'

// ── State ─────────────────────────────────────────────────

let imapClient: ImapFlow | null = null
let smtpTransport: nodemailer.Transporter | null = null
let connectionStatus: 'disconnected' | 'connecting' | 'connected' = 'disconnected'
let lastSeenUid = 0
let monitorActive = false

// ── SMTP Transport (lazy singleton) ──────────────────────

function getSmtpTransport(): nodemailer.Transporter {
  if (!smtpTransport) {
    smtpTransport = nodemailer.createTransport({
      host: EMAIL_SMTP_HOST,
      port: EMAIL_SMTP_PORT,
      secure: true,
      auth: { user: EMAIL_USER, pass: EMAIL_PASSWORD },
      tls: { minVersion: 'TLSv1.2' },
    })
  }
  return smtpTransport
}

// ── IMAP Connection ──────────────────────────────────────

async function connectImap(): Promise<ImapFlow> {
  const client = new ImapFlow({
    host: EMAIL_IMAP_HOST,
    port: EMAIL_IMAP_PORT,
    secure: true,
    auth: { user: EMAIL_USER, pass: EMAIL_PASSWORD },
    tls: { minVersion: 'TLSv1.2' },
    logger: false,
  })

  await client.connect()
  return client
}

// ── Start Email Service ──────────────────────────────────

export async function startEmail(): Promise<void> {
  if (connectionStatus === 'connecting') return
  connectionStatus = 'connecting'

  try {
    imapClient = await connectImap()
    connectionStatus = 'connected'
    console.log(`[Email] Connected to ${EMAIL_IMAP_HOST} as ${EMAIL_USER}`)

    // Verify SMTP
    try {
      await getSmtpTransport().verify()
      console.log(`[Email] SMTP verified on ${EMAIL_SMTP_HOST}`)
    } catch (err) {
      console.warn(`[Email] SMTP verification failed (will retry on send):`, (err as Error).message)
    }

    // Start inbox monitoring
    monitorInbox().catch(err => console.error('[Email] Monitor error:', err))

    // Handle disconnect
    imapClient.on('close', () => {
      console.warn('[Email] IMAP connection closed, reconnecting in 10s...')
      connectionStatus = 'disconnected'
      monitorActive = false
      setTimeout(() => startEmail().catch(() => {}), 10000)
    })

    imapClient.on('error', (err: Error) => {
      console.error('[Email] IMAP error:', err.message)
    })

  } catch (err) {
    connectionStatus = 'disconnected'
    console.error('[Email] Connection failed:', (err as Error).message)
    console.log('[Email] Retrying in 30s...')
    setTimeout(() => startEmail().catch(() => {}), 30000)
  }
}

// ── Send Email ───────────────────────────────────────────

export async function sendEmail(options: {
  to: string
  cc?: string
  bcc?: string
  subject: string
  html: string
  text?: string
  attachments?: { filename: string; path: string }[]
  inReplyTo?: string
  references?: string
}): Promise<{ messageId: string; accepted: string[] }> {
  const transport = getSmtpTransport()

  // Resolve attachment paths
  const attachments = (options.attachments || []).map(att => {
    let filePath = att.path
    if (filePath.startsWith('/api/uploads/')) {
      filePath = filePath.replace('/api/uploads/', UPLOADS_DIR + '/')
    }
    if (!fs.existsSync(filePath)) {
      throw new Error(`Allegato non trovato: ${att.path}`)
    }
    return { filename: att.filename, path: filePath }
  })

  const info = await transport.sendMail({
    from: `"FIAI OS" <${EMAIL_USER}>`,
    to: options.to,
    cc: options.cc || undefined,
    bcc: options.bcc || undefined,
    subject: options.subject,
    html: options.html,
    text: options.text || undefined,
    attachments,
    inReplyTo: options.inReplyTo || undefined,
    references: options.references || undefined,
  })

  console.log(`[Email] Sent to ${options.to}: "${options.subject}" (${info.messageId})`)
  return { messageId: info.messageId, accepted: info.accepted as string[] }
}

// ── List Emails ──────────────────────────────────────────

export async function listEmails(options?: {
  folder?: string
  limit?: number
}): Promise<any[]> {
  if (!imapClient || connectionStatus !== 'connected') throw new Error('Email non connessa')

  const folder = options?.folder || 'INBOX'
  const limit = options?.limit || 15

  const lock = await imapClient.getMailboxLock(folder)
  try {
    const mailbox = imapClient.mailbox
    if (!mailbox || !mailbox.exists || mailbox.exists === 0) return []

    const total = mailbox.exists
    const startSeq = Math.max(1, total - limit + 1)
    const range = `${startSeq}:*`

    const emails: any[] = []
    for await (const msg of imapClient.fetch(range, {
      envelope: true,
      bodyStructure: true,
      uid: true,
    })) {
      const env = msg.envelope
      const hasAttachments = checkHasAttachments(msg.bodyStructure)
      emails.push({
        uid: msg.uid,
        seq: msg.seq,
        from: env.from?.[0] ? `${env.from[0].name || ''} <${env.from[0].address}>`.trim() : 'sconosciuto',
        fromAddress: env.from?.[0]?.address || '',
        to: env.to?.map(t => t.address).join(', ') || '',
        subject: env.subject || '(nessun oggetto)',
        date: env.date?.toISOString() || '',
        messageId: env.messageId || '',
        hasAttachments,
      })
    }

    // Sort newest first
    emails.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    return emails
  } finally {
    lock.release()
  }
}

function checkHasAttachments(structure: any): boolean {
  if (!structure) return false
  if (structure.disposition === 'attachment') return true
  if (structure.childNodes) {
    return structure.childNodes.some((child: any) => checkHasAttachments(child))
  }
  return false
}

// ── Read Full Email ──────────────────────────────────────

export async function readEmail(uid: number): Promise<any> {
  if (!imapClient || connectionStatus !== 'connected') throw new Error('Email non connessa')

  const lock = await imapClient.getMailboxLock('INBOX')
  try {
    const msg = await imapClient.fetchOne(String(uid), { source: true, uid: true }, { uid: true })
    if (!msg?.source) throw new Error(`Email UID ${uid} non trovata`)

    const parsed: ParsedMail = await simpleParser(msg.source)

    const attachments = (parsed.attachments || []).map((att, i) => ({
      partId: String(i),
      filename: att.filename || `allegato_${i}`,
      contentType: att.contentType,
      size: att.size,
    }))

    // Truncate body for AI context
    const textBody = parsed.text || ''
    const htmlBody = parsed.html || ''
    const truncatedText = textBody.substring(0, 10000)

    return {
      uid,
      from: parsed.from?.text || '',
      fromAddress: parsed.from?.value?.[0]?.address || '',
      to: parsed.to ? (Array.isArray(parsed.to) ? parsed.to.map(t => t.text).join(', ') : parsed.to.text) : '',
      cc: parsed.cc ? (Array.isArray(parsed.cc) ? parsed.cc.map(c => c.text).join(', ') : parsed.cc.text) : '',
      subject: parsed.subject || '(nessun oggetto)',
      date: parsed.date?.toISOString() || '',
      text: truncatedText,
      html: htmlBody.substring(0, 15000),
      messageId: parsed.messageId || '',
      inReplyTo: parsed.inReplyTo || '',
      references: parsed.references ? (Array.isArray(parsed.references) ? parsed.references.join(' ') : parsed.references) : '',
      attachments,
      hasMore: textBody.length > 10000,
    }
  } finally {
    lock.release()
  }
}

// ── Search Emails ────────────────────────────────────────

export async function searchEmails(options: {
  subject?: string
  from?: string
  since?: string
  before?: string
  text?: string
  limit?: number
}): Promise<any[]> {
  if (!imapClient || connectionStatus !== 'connected') throw new Error('Email non connessa')

  const lock = await imapClient.getMailboxLock('INBOX')
  try {
    // Build IMAP search criteria
    const criteria: any = {}
    if (options.subject) criteria.subject = options.subject
    if (options.from) criteria.from = options.from
    if (options.since) criteria.since = new Date(options.since)
    if (options.before) criteria.before = new Date(options.before)
    if (options.text) criteria.body = options.text

    const uids = await imapClient.search(criteria, { uid: true })
    if (!uids || uids.length === 0) return []

    const limit = options.limit || 10
    // Take most recent UIDs
    const selectedUids = uids.slice(-limit)
    const uidRange = selectedUids.join(',')

    const emails: any[] = []
    for await (const msg of imapClient.fetch(uidRange, {
      envelope: true,
      bodyStructure: true,
      uid: true,
    }, { uid: true })) {
      const env = msg.envelope
      emails.push({
        uid: msg.uid,
        from: env.from?.[0] ? `${env.from[0].name || ''} <${env.from[0].address}>`.trim() : 'sconosciuto',
        fromAddress: env.from?.[0]?.address || '',
        to: env.to?.map(t => t.address).join(', ') || '',
        subject: env.subject || '(nessun oggetto)',
        date: env.date?.toISOString() || '',
        hasAttachments: checkHasAttachments(msg.bodyStructure),
      })
    }

    emails.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    return emails
  } finally {
    lock.release()
  }
}

// ── Download Attachment ──────────────────────────────────

export async function downloadAttachment(uid: number, partId: string): Promise<{
  filename: string; path: string; fileUrl: string; size: number
}> {
  if (!imapClient || connectionStatus !== 'connected') throw new Error('Email non connessa')

  const lock = await imapClient.getMailboxLock('INBOX')
  try {
    const msg = await imapClient.fetchOne(String(uid), { source: true, uid: true }, { uid: true })
    if (!msg?.source) throw new Error(`Email UID ${uid} non trovata`)

    const parsed = await simpleParser(msg.source)
    const partIndex = parseInt(partId)
    const attachment = parsed.attachments?.[partIndex]
    if (!attachment) throw new Error(`Allegato ${partId} non trovato nell'email UID ${uid}`)

    // Save to uploads directory
    const dir = path.join(UPLOADS_DIR, 'email-attachments')
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    const ext = path.extname(attachment.filename || '') || '.bin'
    const fileId = crypto.randomUUID()
    const filename = attachment.filename || `allegato_${partId}${ext}`
    const filePath = path.join(dir, `${fileId}${ext}`)

    fs.writeFileSync(filePath, attachment.content)

    const aziendaId = (db.prepare("SELECT id FROM entity WHERE type = 'organizzazione' LIMIT 1").get() as any)?.id || ''
    const fileUrl = `/api/uploads/${aziendaId}/email-attachments/${fileId}${ext}`

    console.log(`[Email] Attachment saved: ${filename} → ${filePath}`)
    return { filename, path: filePath, fileUrl, size: attachment.size }
  } finally {
    lock.release()
  }
}

// ── Inbox Monitor (IDLE) ─────────────────────────────────

async function monitorInbox(): Promise<void> {
  if (!imapClient || monitorActive) return
  monitorActive = true

  try {
    const lock = await imapClient.getMailboxLock('INBOX')
    try {
      // Get current highest UID
      const mailbox = imapClient.mailbox
      if (mailbox?.uidNext) {
        lastSeenUid = mailbox.uidNext - 1
      }
    } finally {
      lock.release()
    }

    // Listen for new messages
    imapClient.on('exists', async (data: { path: string; count: number; prevCount: number }) => {
      if (data.path !== 'INBOX') return
      console.log(`[Email] New message(s) in INBOX: ${data.prevCount} → ${data.count}`)

      try {
        const lock = await imapClient!.getMailboxLock('INBOX')
        try {
          const range = `${lastSeenUid + 1}:*`
          for await (const msg of imapClient!.fetch(range, { source: true, uid: true }, { uid: true })) {
            if (msg.uid <= lastSeenUid) continue
            lastSeenUid = msg.uid

            const parsed = await simpleParser(msg.source)
            await handleIncomingEmail(parsed, msg.uid)
          }
        } finally {
          lock.release()
        }
      } catch (err) {
        console.error('[Email] Error processing new message:', (err as Error).message)
      }
    })

    // Keep IDLE alive
    console.log('[Email] IDLE monitoring started on INBOX')

  } catch (err) {
    console.error('[Email] Monitor setup error:', (err as Error).message)
    monitorActive = false
  }
}

// ── Handle Incoming Email ────────────────────────────────

async function handleIncomingEmail(email: ParsedMail, uid: number): Promise<void> {
  const senderAddress = email.from?.value?.[0]?.address
  if (!senderAddress) return

  console.log(`[Email] Incoming from ${senderAddress}: "${email.subject}"`)

  // Look up sender in VFS
  const sender = db.prepare(
    "SELECT id, azienda_id, display_name FROM entity WHERE email = ? AND type IN ('utente', 'persona') LIMIT 1"
  ).get(senderAddress) as any

  if (!sender && !PROCESS_UNKNOWN) {
    console.log(`[Email] Ignoring email from unknown sender: ${senderAddress}`)
    return
  }

  const userId = sender?.id || 'unknown'
  const aziendaId = sender?.azienda_id ||
    (db.prepare("SELECT id FROM entity WHERE type = 'organizzazione' LIMIT 1").get() as any)?.id || ''
  const senderName = sender?.display_name || senderAddress

  // Build message for orchestrator
  const emailBody = email.text?.substring(0, 5000) || '(email vuota)'
  const message = `[Email da ${senderName}] Oggetto: ${email.subject}\n\n${emailBody}`

  try {
    const result = await handleChatMessage(message, userId, aziendaId, {
      format: 'web',
      sessionId: `email-${senderAddress}-${Date.now()}`,
    })

    // Reply with AI response
    if (result.text && sender) {
      await sendEmail({
        to: senderAddress,
        subject: `Re: ${email.subject || ''}`,
        html: result.text.replace(/\n/g, '<br>'),
        inReplyTo: email.messageId || undefined,
        references: email.messageId || undefined,
      })
      console.log(`[Email] Auto-replied to ${senderAddress}`)
    }
  } catch (err) {
    console.error(`[Email] Error handling incoming email:`, (err as Error).message)
  }
}

// ── Express Router ───────────────────────────────────────

export const emailRouter = Router()

emailRouter.get('/status', authMiddleware(true), (_req: AuthRequest, res: Response) => {
  res.json({
    status: connectionStatus,
    user: EMAIL_USER,
    imapHost: EMAIL_IMAP_HOST,
    smtpHost: EMAIL_SMTP_HOST,
  })
})

emailRouter.get('/inbox', authMiddleware(true), async (_req: AuthRequest, res: Response) => {
  try {
    const limit = parseInt(_req.query.limit as string) || 15
    const folder = (_req.query.folder as string) || 'INBOX'
    const emails = await listEmails({ folder, limit })
    res.json({ emails, count: emails.length })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

emailRouter.get('/message/:uid', authMiddleware(true), async (req: AuthRequest, res: Response) => {
  try {
    const uid = parseInt(req.params.uid)
    const email = await readEmail(uid)
    res.json(email)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

emailRouter.post('/send', authMiddleware(true), async (req: AuthRequest, res: Response) => {
  try {
    const result = await sendEmail(req.body)
    res.json({ successo: true, ...result })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

emailRouter.post('/search', authMiddleware(true), async (req: AuthRequest, res: Response) => {
  try {
    const emails = await searchEmails(req.body)
    res.json({ emails, count: emails.length })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

emailRouter.get('/attachment/:uid/:partId', authMiddleware(true), async (req: AuthRequest, res: Response) => {
  try {
    const uid = parseInt(req.params.uid)
    const result = await downloadAttachment(uid, req.params.partId)
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

emailRouter.post('/restart', authMiddleware(true), async (_req: AuthRequest, res: Response) => {
  try {
    if (imapClient) {
      await imapClient.logout().catch(() => {})
      imapClient = null
    }
    smtpTransport = null
    connectionStatus = 'disconnected'
    monitorActive = false
    await startEmail()
    res.json({ status: connectionStatus })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})
