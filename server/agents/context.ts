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

export function captureSignal(aziendaId: string, userId: string, signal: Record<string, unknown>): void {
  try {
    const signalsDir = path.join(CONTEXT_DIR, 'aziende', aziendaId, 'users', userId, 'signals')
    fs.mkdirSync(signalsDir, { recursive: true })
    const line = JSON.stringify({ ...signal, ts: new Date().toISOString() }) + '\n'
    fs.appendFileSync(path.join(signalsDir, 'interactions.jsonl'), line)
  } catch (err) {
    console.error('Signal capture error:', err)
  }
}
