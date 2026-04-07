import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import db from '../db.js'

const CONTEXT_DIR = process.env.CONTEXT_DIR || '/app/data/context'

function readContextFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8')
  } catch {
    return ''
  }
}

export function buildContext(domain: string, aziendaId: string, userId: string, sessionId?: string): string {
  const parts: string[] = []

  // 1. Global context
  const globalPath = path.join(CONTEXT_DIR, 'aziende', aziendaId, 'CONTEXT.md')
  const globalCtx = readContextFile(globalPath)
  if (globalCtx) parts.push('--- CONTESTO AZIENDALE ---\n' + globalCtx)

  // 2. Agent/skill context
  const agentPath = path.join(CONTEXT_DIR, 'aziende', aziendaId, 'skills', `${domain}.md`)
  let agentCtx = readContextFile(agentPath)
  if (!agentCtx) {
    const templatePath = path.join(CONTEXT_DIR, '_templates', 'skills', `${domain}.md`)
    agentCtx = readContextFile(templatePath)
  }
  if (agentCtx) parts.push('--- CONTESTO AGENTE ---\n' + agentCtx)

  // 3. User profile
  const profilePath = path.join(CONTEXT_DIR, 'aziende', aziendaId, 'users', userId, 'profile.md')
  const profileCtx = readContextFile(profilePath)
  if (profileCtx) parts.push('--- PROFILO UTENTE ---\n' + profileCtx)

  // 4. Session context
  if (sessionId) {
    const sessionPath = path.join(CONTEXT_DIR, 'aziende', aziendaId, 'users', userId, 'sessions', `${sessionId}.md`)
    const sessionCtx = readContextFile(sessionPath)
    if (sessionCtx) parts.push('--- SESSIONE CORRENTE ---\n' + sessionCtx)
  }

  // 5. User preferences
  const prefsPath = path.join(CONTEXT_DIR, 'aziende', aziendaId, 'users', userId, 'preferences.md')
  const prefsCtx = readContextFile(prefsPath)
  if (prefsCtx) parts.push('--- PREFERENZE ---\n' + prefsCtx)

  // 6. Steering rules
  const steeringPath = path.join(CONTEXT_DIR, 'aziende', aziendaId, 'steering-rules.md')
  const steeringCtx = readContextFile(steeringPath)
  if (steeringCtx) parts.push('--- REGOLE DI STEERING ---\n' + steeringCtx)

  // 7. Agent memory (lessons learned from interactions)
  try {
    const memory = db.prepare(
      "SELECT metadata FROM entity WHERE type = 'agent_memory' AND json_extract(metadata, '$.domain') = ? AND azienda_id = ? LIMIT 1"
    ).get(domain, aziendaId) as any
    if (memory) {
      const m = typeof memory.metadata === 'string' ? JSON.parse(memory.metadata) : memory.metadata
      if (m.lessons?.length > 0) {
        const lessonsText = m.lessons.slice(-10).map((l: any) => `- ${l.rule}`).join('\n')
        parts.push('--- MEMORIA AGENTE (lezioni apprese) ---\n' + lessonsText)
      }
    }
  } catch {}

  return parts.join('\n\n')
}

// ── Planner Context (compact system summary) ─────────────

export function generatePlannerContext(aziendaId: string): string {
  try {
    const namesByTag: Record<string, number> = {}
    const nameRows = db.prepare("SELECT tags FROM entity WHERE azienda_id = ?").all(aziendaId) as any[]
    for (const n of nameRows) {
      const tags = typeof n.tags === 'string' ? JSON.parse(n.tags) : (n.tags || [])
      for (const t of tags) namesByTag[t] = (namesByTag[t] || 0) + 1
    }

    const entityByType: Record<string, number> = {}
    const entityRows = db.prepare(
      "SELECT type, COUNT(*) as c FROM entity WHERE azienda_id = ? AND type NOT IN ('chunk','chat_message','chat_session','agent_log','job','workflow_log','category_template') GROUP BY type"
    ).all(aziendaId) as any[]
    for (const e of entityRows) entityByType[e.type] = e.c

    const docs = db.prepare(
      "SELECT display_name, json_extract(metadata,'$.chunk_count') as chunks FROM entity WHERE azienda_id = ? AND json_extract(metadata,'$.chunked') = 1"
    ).all(aziendaId) as any[]

    const autonomousCount = db.prepare(
      "SELECT COUNT(*) as c FROM entity WHERE type = 'autonomous_agent' AND azienda_id = ? AND stato = 'active'"
    ).get(aziendaId) as any

    const namesSummary = Object.entries(namesByTag).map(([t, c]) => `${c} ${t}`).join(', ')
    const entitySummary = Object.entries(entityByType).filter(([t]) => !['autonomous_agent','agent_memory','skill'].includes(t)).map(([t, c]) => `${c} ${t}`).join(', ')
    const docsSummary = docs.map((d: any) => `${d.display_name} (${d.chunks} chunk)`).join(', ')

    return `\nSTATO SISTEMA:\n` +
      `- Names: ${nameRows.length} (${namesSummary || 'nessuno'})\n` +
      `- Entity: ${entitySummary || 'nessuna'}\n` +
      `- Documenti indicizzati: ${docsSummary || 'nessuno'}\n` +
      `- Agenti autonomi attivi: ${autonomousCount?.c || 0}`
  } catch {
    return ''
  }
}

// ── Autonomous Agent Context ─────────────────────────────

export function buildAutonomousContext(domain: string, aziendaId: string): string {
  const parts: string[] = []

  // 1. Global context
  const globalPath = path.join(CONTEXT_DIR, 'aziende', aziendaId, 'CONTEXT.md')
  const globalCtx = readContextFile(globalPath)
  if (globalCtx) parts.push('--- CONTESTO AZIENDALE ---\n' + globalCtx)

  // 2. Skill context
  const agentPath = path.join(CONTEXT_DIR, 'aziende', aziendaId, 'skills', `${domain}.md`)
  let agentCtx = readContextFile(agentPath)
  if (!agentCtx) {
    const templatePath = path.join(CONTEXT_DIR, '_templates', 'skills', `${domain}.md`)
    agentCtx = readContextFile(templatePath)
  }
  if (agentCtx) parts.push('--- CONTESTO AGENTE ---\n' + agentCtx)

  // 3. Agent memory
  try {
    const memory = db.prepare(
      "SELECT metadata FROM entity WHERE type = 'agent_memory' AND json_extract(metadata, '$.domain') = ? AND azienda_id = ? LIMIT 1"
    ).get(domain, aziendaId) as any
    if (memory) {
      const m = typeof memory.metadata === 'string' ? JSON.parse(memory.metadata) : memory.metadata
      if (m.lessons?.length > 0) {
        parts.push('--- MEMORIA AGENTE ---\n' + m.lessons.slice(-10).map((l: any) => `- ${l.rule}`).join('\n'))
      }
    }
  } catch {}

  // 4. Steering rules
  const steeringPath = path.join(CONTEXT_DIR, 'aziende', aziendaId, 'steering-rules.md')
  const steeringCtx = readContextFile(steeringPath)
  if (steeringCtx) parts.push('--- REGOLE ---\n' + steeringCtx)

  return parts.join('\n\n')
}

// ── Agent Memory: add lesson ─────────────────────────────

export function addAgentLesson(aziendaId: string, domain: string, rule: string, source: string): void {
  try {
    const existing = db.prepare(
      "SELECT id, metadata FROM entity WHERE type = 'agent_memory' AND json_extract(metadata, '$.domain') = ? AND azienda_id = ?"
    ).get(domain, aziendaId) as any

    const lesson = { rule, source, date: new Date().toISOString().split('T')[0] }

    if (existing) {
      const m = typeof existing.metadata === 'string' ? JSON.parse(existing.metadata) : existing.metadata
      m.lessons = [...(m.lessons || []), lesson].slice(-20) // keep last 20 lessons
      db.prepare("UPDATE entity SET metadata = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(m), existing.id)
    } else {
      db.prepare(
        "INSERT INTO entity (id, azienda_id, type, display_name, slug, metadata, path, created_at, updated_at) VALUES (?, ?, 'agent_memory', ?, ?, ?, ?, datetime('now'), datetime('now'))"
      ).run(
        crypto.randomUUID(), aziendaId,
        `Memory: ${domain}`, `memory-${domain}`,
        JSON.stringify({ domain, lessons: [lesson] }),
        `/entity/agent-memory/${domain}`
      )
    }
  } catch (err) {
    console.error('Add agent lesson error:', err)
  }
}

export function saveSessionContext(aziendaId: string, userId: string, sessionId: string, summary: string): void {
  try {
    const sessionDir = path.join(CONTEXT_DIR, 'aziende', aziendaId, 'users', userId, 'sessions')
    fs.mkdirSync(sessionDir, { recursive: true })
    const sessionPath = path.join(sessionDir, `${sessionId}.md`)

    const existing = readContextFile(sessionPath)
    const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
    const newContent = existing
      ? existing + `\n\n---\n[${timestamp}]\n${summary}`
      : `# Sessione ${sessionId}\n\n[${timestamp}]\n${summary}`
    fs.writeFileSync(sessionPath, newContent, 'utf-8')
  } catch (err) {
    console.error('Session save error:', err)
  }
}

const interactionCounter = new Map<string, number>()

export function captureSignal(aziendaId: string, userId: string, signal: Record<string, unknown>): void {
  try {
    const signalsDir = path.join(CONTEXT_DIR, 'aziende', aziendaId, 'users', userId, 'signals')
    fs.mkdirSync(signalsDir, { recursive: true })
    const line = JSON.stringify({ ...signal, ts: new Date().toISOString() }) + '\n'
    fs.appendFileSync(path.join(signalsDir, 'interactions.jsonl'), line)

    // Auto-update preferences every 5 interactions
    const key = `${aziendaId}:${userId}`
    const count = (interactionCounter.get(key) || 0) + 1
    interactionCounter.set(key, count)
    if (count % 5 === 0) {
      updatePreferencesFromSignals(aziendaId, userId)
    }
  } catch (err) {
    console.error('Signal capture error:', err)
  }
}

export function captureRating(aziendaId: string, userId: string, rating: { messageId: string; sessionId: string; domain: string; rating: 'up' | 'down' }): void {
  try {
    const signalsDir = path.join(CONTEXT_DIR, 'aziende', aziendaId, 'users', userId, 'signals')
    fs.mkdirSync(signalsDir, { recursive: true })
    const line = JSON.stringify({ ...rating, ts: new Date().toISOString() }) + '\n'
    fs.appendFileSync(path.join(signalsDir, 'ratings.jsonl'), line)
    // Update preferences immediately on rating
    updatePreferencesFromSignals(aziendaId, userId)
  } catch (err) {
    console.error('Rating capture error:', err)
  }
}

function updatePreferencesFromSignals(aziendaId: string, userId: string): void {
  try {
    const signalsDir = path.join(CONTEXT_DIR, 'aziende', aziendaId, 'users', userId, 'signals')
    const interactionsFile = path.join(signalsDir, 'interactions.jsonl')
    if (!fs.existsSync(interactionsFile)) return

    const lines = fs.readFileSync(interactionsFile, 'utf-8').trim().split('\n').filter(Boolean)
    const signals = lines.map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    if (signals.length === 0) return

    const domainCounts: Record<string, number> = {}
    const toolCounts: Record<string, number> = {}
    const hourCounts: Record<number, number> = {}

    for (const s of signals) {
      if (s.domain) domainCounts[s.domain] = (domainCounts[s.domain] || 0) + 1
      if (s.tools) for (const t of (s.tools as string[])) toolCounts[t] = (toolCounts[t] || 0) + 1
      if (s.ts) {
        const hour = new Date(s.ts).getHours()
        hourCounts[hour] = (hourCounts[hour] || 0) + 1
      }
    }

    const total = signals.length
    const topDomains = Object.entries(domainCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)
    const topTools = Object.entries(toolCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)
    const peakHour = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0]

    // Ratings
    let positiveRatings = 0, negativeRatings = 0
    const ratingsFile = path.join(signalsDir, 'ratings.jsonl')
    if (fs.existsSync(ratingsFile)) {
      const rLines = fs.readFileSync(ratingsFile, 'utf-8').trim().split('\n').filter(Boolean)
      for (const l of rLines) {
        try {
          const r = JSON.parse(l)
          if (r.rating === 'up') positiveRatings++
          else negativeRatings++
        } catch {}
      }
    }

    // Negative feedback domains (for steering)
    const negativeDomains: Record<string, number> = {}
    if (fs.existsSync(ratingsFile)) {
      const rLines = fs.readFileSync(ratingsFile, 'utf-8').trim().split('\n').filter(Boolean)
      for (const l of rLines) {
        try {
          const r = JSON.parse(l)
          if (r.rating === 'down' && r.domain) negativeDomains[r.domain] = (negativeDomains[r.domain] || 0) + 1
        } catch {}
      }
    }

    const md = `# Preferenze Utente
Aggiornato: ${new Date().toISOString().split('T')[0]}

## Utilizzo
- Interazioni totali: ${total}
- Domini usati: ${topDomains.map(([d, c]) => `${d} (${Math.round(c / total * 100)}%)`).join(', ')}
- Tools preferiti: ${topTools.map(([t, c]) => `${t} (${c}x)`).join(', ') || 'nessuno'}
- Orario tipico: ${peakHour ? `${peakHour[0]}:00` : 'N/D'}

## Feedback
- Positivi: ${positiveRatings}
- Negativi: ${negativeRatings}
${Object.keys(negativeDomains).length > 0 ? '- Domini con feedback negativo: ' + Object.entries(negativeDomains).map(([d, c]) => `${d} (${c}x)`).join(', ') : ''}

## Comportamento suggerito
${positiveRatings + negativeRatings > 0 ? `- Tasso soddisfazione: ${Math.round(positiveRatings / (positiveRatings + negativeRatings) * 100)}%` : '- Nessun feedback ancora'}
${Object.keys(negativeDomains).length > 0 ? '- Attenzione ai domini con feedback negativo: migliorare risposte per ' + Object.keys(negativeDomains).join(', ') : ''}
`

    const prefDir = path.join(CONTEXT_DIR, 'aziende', aziendaId, 'users', userId)
    fs.mkdirSync(prefDir, { recursive: true })
    fs.writeFileSync(path.join(prefDir, 'preferences.md'), md)
  } catch (err) {
    console.error('Preferences update error:', err)
  }
}
