/**
 * FIAI OS — Safety Gate (3-point defense)
 *
 * 1. Input: check for prompt injection, abuse
 * 2. Retrieval: filter sensitive content for external channels
 * 3. Output: mask PII, block inappropriate content
 */

// ── PII Patterns ─────────────────────────────────────────

const PII_PATTERNS = {
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  phone: /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g,
  codice_fiscale: /[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]/gi,
  iban: /IT\d{2}[A-Z]\d{22}/gi,
  piva: /\b\d{11}\b/g,
  carta_credito: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
}

// ── Prompt Injection Patterns ────────────────────────────

const INJECTION_PATTERNS = [
  /ignora\s+(tutte\s+le\s+)?istruzioni/i,
  /ignore\s+(all\s+)?instructions/i,
  /system\s*prompt/i,
  /dimentica\s+(le\s+)?regole/i,
  /forget\s+(your\s+)?rules/i,
  /sei\s+ora\s+un/i,
  /you\s+are\s+now\s+a/i,
  /act\s+as\s+if/i,
  /pretend\s+you/i,
  /fingi\s+di\s+essere/i,
  /\]\]\s*\}\}/,  // JSON injection attempts
  /<<\s*SYS/i,    // system prompt injection
]

// ── Input Check ──────────────────────────────────────────

export interface SafetyResult {
  safe: boolean
  reason?: string
  severity?: 'low' | 'medium' | 'high'
}

export function checkInput(message: string): SafetyResult {
  // Check for prompt injection
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(message)) {
      return {
        safe: false,
        reason: 'Richiesta non consentita: tentativo di manipolazione rilevato.',
        severity: 'high',
      }
    }
  }

  // Check for excessively long messages (possible attack vector)
  if (message.length > 10000) {
    return {
      safe: false,
      reason: 'Messaggio troppo lungo. Limite: 10.000 caratteri.',
      severity: 'low',
    }
  }

  return { safe: true }
}

// ── Retrieval Check ──────────────────────────────────────

export function checkRetrieval(
  chunks: any[],
  channel: 'web' | 'whatsapp'
): any[] {
  if (channel === 'web') return chunks // No filtering for web UI

  // For WhatsApp: filter out chunks marked as confidential
  return chunks.filter(chunk => {
    const meta = chunk.metadata || {}
    if (meta.confidential || meta.riservato) return false
    return true
  })
}

// ── Output Check ─────────────────────────────────────────

export function checkOutput(
  text: string,
  channel: 'web' | 'whatsapp'
): { safe: boolean; filtered: string; masked: string[] } {
  const masked: string[] = []
  let filtered = text

  if (channel === 'whatsapp') {
    // Mask PII in WhatsApp output
    for (const [type, pattern] of Object.entries(PII_PATTERNS)) {
      const matches = filtered.match(pattern)
      if (matches) {
        for (const match of matches) {
          // Keep first 3 and last 2 chars, mask the rest
          const maskLen = Math.max(match.length - 5, 3)
          const maskedValue = match.substring(0, 3) + '*'.repeat(maskLen) + match.substring(match.length - 2)
          filtered = filtered.replace(match, maskedValue)
          masked.push(`${type}: ${match} → ${maskedValue}`)
        }
      }
    }
  }

  return { safe: true, filtered, masked }
}

// ── Mask PII utility ─────────────────────────────────────

export function maskPII(text: string): string {
  let result = text
  for (const [, pattern] of Object.entries(PII_PATTERNS)) {
    result = result.replace(pattern, (match) => {
      if (match.length <= 4) return '***'
      return match.substring(0, 2) + '*'.repeat(match.length - 4) + match.substring(match.length - 2)
    })
  }
  return result
}
