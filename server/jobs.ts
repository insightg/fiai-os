/**
 * FIAI OS — Job Queue (SQLite-based)
 *
 * Jobs are entity records with type='job'.
 * A background worker polls and processes them.
 *
 * Job metadata schema:
 * {
 *   action: string          — what to do (e.g. 'generate_recurring_invoices')
 *   params: object          — action-specific parameters
 *   retry_count: number     — current retry count
 *   max_retries: number     — max retries (default 3)
 *   error: string           — last error message (if failed)
 *   result: any             — result data (if completed)
 *   scheduled_at: string    — ISO date for delayed/scheduled jobs
 *   cron: string            — cron expression for recurring jobs (e.g. '0 8 * * 1')
 * }
 *
 * Job stati: queued → running → completed | failed | dead
 */
import crypto from 'crypto'
import db from './db.js'

const POLL_INTERVAL = 5000  // 5 seconds
const MAX_RETRIES_DEFAULT = 3

type JobHandler = (params: any, jobId: string, aziendaId: string) => Promise<any>

// ── Job Handler Registry ──────────────────────────────────

const handlers: Record<string, JobHandler> = {}

export function registerJobHandler(action: string, handler: JobHandler) {
  handlers[action] = handler
  console.log(`[Jobs] Registered handler: ${action}`)
}

// ── Create Job ────────────────────────────────────────────

export function createJob(
  aziendaId: string,
  action: string,
  params: Record<string, unknown> = {},
  options?: {
    scheduledAt?: string     // ISO date — delay execution
    cron?: string            // Cron expression — recurring
    priority?: number        // Lower = higher priority (default 0)
    maxRetries?: number
    userId?: string
  }
): string {
  const id = crypto.randomUUID()
  const slug = `job-${action}-${id.substring(0, 8)}`
  const now = new Date().toISOString()
  const scheduledAt = options?.scheduledAt || now

  db.prepare(`INSERT INTO entity (id, azienda_id, type, display_name, slug, stato, name_id, parent_id, user_id, file_url, numero, data, totale, metadata, path, ordine, created_at, updated_at)
    VALUES (?, ?, 'job', ?, ?, 'queued', NULL, NULL, ?, NULL, NULL, ?, NULL, ?, ?, ?, ?, ?)`).run(
    id, aziendaId,
    `Job: ${action}`, slug,
    options?.userId || null,
    scheduledAt,
    JSON.stringify({
      action,
      params,
      retry_count: 0,
      max_retries: options?.maxRetries ?? MAX_RETRIES_DEFAULT,
      cron: options?.cron || null,
      scheduled_at: scheduledAt,
    }),
    `/entity/jobs/${slug}`,
    options?.priority ?? 0,
    now, now
  )

  return id
}

// ── Process Jobs ──────────────────────────────────────────

async function processJobs() {
  const now = new Date().toISOString()

  // Fetch queued jobs that are due
  const jobs = db.prepare(`
    SELECT id, azienda_id, metadata FROM entity
    WHERE type = 'job' AND stato = 'queued' AND data <= ?
    ORDER BY ordine ASC, created_at ASC
    LIMIT 5
  `).all(now) as any[]

  for (const job of jobs) {
    const meta = typeof job.metadata === 'string' ? JSON.parse(job.metadata) : job.metadata
    const handler = handlers[meta.action]

    if (!handler) {
      // No handler registered — mark as failed
      db.prepare("UPDATE entity SET stato = 'failed', metadata = ?, updated_at = datetime('now') WHERE id = ?").run(
        JSON.stringify({ ...meta, error: `No handler for action: ${meta.action}` }),
        job.id
      )
      continue
    }

    // Mark as running
    db.prepare("UPDATE entity SET stato = 'running', updated_at = datetime('now') WHERE id = ?").run(job.id)

    try {
      const result = await handler(meta.params, job.id, job.azienda_id)

      // If cron job, re-queue for next execution
      if (meta.cron) {
        const nextRun = getNextCronDate(meta.cron)
        db.prepare("UPDATE entity SET stato = 'queued', data = ?, metadata = ?, updated_at = datetime('now') WHERE id = ?").run(
          nextRun,
          JSON.stringify({ ...meta, retry_count: 0, result, last_run: now }),
          job.id
        )
      } else {
        db.prepare("UPDATE entity SET stato = 'completed', metadata = ?, updated_at = datetime('now') WHERE id = ?").run(
          JSON.stringify({ ...meta, result }),
          job.id
        )
      }
    } catch (err: any) {
      const retryCount = (meta.retry_count || 0) + 1
      const maxRetries = meta.max_retries ?? MAX_RETRIES_DEFAULT

      if (retryCount >= maxRetries) {
        // Dead — no more retries
        db.prepare("UPDATE entity SET stato = 'dead', metadata = ?, updated_at = datetime('now') WHERE id = ?").run(
          JSON.stringify({ ...meta, retry_count: retryCount, error: err.message }),
          job.id
        )
        console.error(`[Jobs] Job ${job.id} dead after ${retryCount} retries: ${err.message}`)
      } else {
        // Retry with exponential backoff
        const backoffMs = Math.min(1000 * Math.pow(2, retryCount), 300000) // max 5 min
        const retryAt = new Date(Date.now() + backoffMs).toISOString()
        db.prepare("UPDATE entity SET stato = 'queued', data = ?, metadata = ?, updated_at = datetime('now') WHERE id = ?").run(
          retryAt,
          JSON.stringify({ ...meta, retry_count: retryCount, error: err.message }),
          job.id
        )
        console.warn(`[Jobs] Job ${job.id} retry ${retryCount}/${maxRetries} at ${retryAt}: ${err.message}`)
      }
    }
  }
}

// ── Simple cron parser (minute hour day month weekday) ─────

function getNextCronDate(cron: string): string {
  // Basic implementation: supports "M H D MO WD" format
  // For now, just add the interval based on common patterns
  const parts = cron.split(' ')
  const now = new Date()

  if (cron === '0 8 * * 1') {
    // Every Monday at 8:00
    const next = new Date(now)
    next.setDate(next.getDate() + ((7 - next.getDay() + 1) % 7 || 7))
    next.setHours(8, 0, 0, 0)
    return next.toISOString()
  }

  if (parts[2] === '1' && parts[3] === '*') {
    // Monthly on the 1st
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    next.setHours(parseInt(parts[1]) || 0, parseInt(parts[0]) || 0, 0, 0)
    return next.toISOString()
  }

  // Default: next day same time
  const next = new Date(now.getTime() + 86400000)
  next.setHours(parseInt(parts[1]) || 0, parseInt(parts[0]) || 0, 0, 0)
  return next.toISOString()
}

// ── Worker ────────────────────────────────────────────────

let workerInterval: ReturnType<typeof setInterval> | null = null

export function startJobWorker() {
  if (workerInterval) return
  console.log(`[Jobs] Worker started (polling every ${POLL_INTERVAL / 1000}s)`)
  workerInterval = setInterval(() => {
    processJobs().catch(err => console.error('[Jobs] Worker error:', err))
  }, POLL_INTERVAL)
}

export function stopJobWorker() {
  if (workerInterval) {
    clearInterval(workerInterval)
    workerInterval = null
    console.log('[Jobs] Worker stopped')
  }
}

// ── Job Stats (for agents) ────────────────────────────────

export function getJobStats(aziendaId: string) {
  const stats = db.prepare(`
    SELECT stato, COUNT(*) as count FROM entity
    WHERE type = 'job' AND azienda_id = ?
    GROUP BY stato
  `).all(aziendaId) as any[]

  return stats.reduce((acc: Record<string, number>, s: any) => {
    acc[s.stato] = s.count
    return acc
  }, {})
}
