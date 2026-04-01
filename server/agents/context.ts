import fs from 'fs'
import path from 'path'

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

  return parts.join('\n\n')
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
