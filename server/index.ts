import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import fs from 'fs'
import path from 'path'
import db from './db.js'
import authRouter from './auth.js'
import queryRouter from './query.js'
import uploadRouter from './upload.js'
import uploadsStaticRouter from './uploads-static.js'
import documentiRouter from './documenti.js'
import contextRouter from './context.js'
import filesRouter from './files.js'
import ttsRouter from './tts.js'
import signalsRouter from './signals.js'
import pdfRouter from './pdf.js'
import { startWhatsApp, whatsappRouter } from './whatsapp.js'
import chatApiRouter from './chat-api.js'

// Run migrations on startup
const migrationPath = path.join(import.meta.dirname || '.', 'migrations', 'init-sqlite.sql')
if (fs.existsSync(migrationPath)) {
  const sql = fs.readFileSync(migrationPath, 'utf-8')
  db.exec(sql)
  console.log('SQLite migrations applied.')
}

const app = express()
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001

// CORS configured for Vite dev server
app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true,
}))

// Body parser
app.use(express.json({ limit: '10mb' }))

// Cookie parser
app.use(cookieParser())

// Routes
app.use('/api/auth', authRouter)
app.use('/api/query', queryRouter)
app.use('/api/upload', uploadRouter)
app.use('/api/uploads', uploadsStaticRouter)
app.use('/api/documenti', documentiRouter)
app.use('/api/context', contextRouter)
app.use('/api/files', filesRouter)
app.use('/api/tts', ttsRouter)
app.use('/api/signals', signalsRouter)
app.use('/api/pdf', pdfRouter)
app.use('/api/whatsapp', whatsappRouter)
app.use('/api/chat', chatApiRouter)

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Error handling middleware
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err)
  res.status(500).json({ error: { message: 'Errore interno del server', code: 'INTERNAL_ERROR' } })
})

app.listen(PORT, () => {
  console.log(`FIAI OS server running on http://localhost:${PORT}`)
  startWhatsApp().catch(err => console.error('WhatsApp startup error:', err))
})

export default app
