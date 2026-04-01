/**
 * FIAI OS — Planner LLM
 *
 * Decomposes user requests into executable tool steps.
 * The planner decides WHICH tools to call and in WHAT order,
 * then the executor runs them, then the domain agent synthesizes.
 */
import { executeTool } from './tool-registry.js'

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const PLANNER_MODEL = 'anthropic/claude-haiku-4.5'

// ── Types ────────────────────────────────────────────────

export interface PlanStep {
  tool: string
  params: Record<string, unknown>
  description: string
}

export interface Plan {
  steps: PlanStep[]
  domain: string
  reasoning: string
}

export interface StepResult {
  step: PlanStep
  result: unknown
  error?: string
}

// ── Planner Prompt ──────────────────────────────────────

const PLANNER_PROMPT = `Sei il planner di FIAI OS, un gestionale aziendale italiano.
Ricevi una richiesta utente e crei un piano di esecuzione tool. Ragiona autonomamente su quali tool usare e in che ordine — non seguire pattern rigidi.

TOOL DISPONIBILI:
- search(table:"names"|"entity"|"both", type?, tags?:[], stato?, query?, name_id?, limit?) — cerca in names (persone/aziende) o entity (fatture, ordini, progetti, documenti, conti, etc.)
- create(table, type?, tags?:[], display_name, email?, telefono?, stato?, name_id?, parent_id?, metadata?:{}) — crea
- update(id, table, display_name?, stato?, tags?, metadata?:{}) — aggiorna
- delete_record(id, table) — elimina
- relate(from_id, to_id, tipo) — collega
- get_tree(id) — record + figli + relazioni
- render_view(layout:{view, title, source, columns, kanban, chart}) — vista dinamica
- retrieve(query, doc_id?, limit?) — cerca DENTRO il contenuto dei documenti (articoli, clausole, definizioni)
- send_whatsapp_message(phone, text) — messaggio WhatsApp
- send_whatsapp_voice(phone, text, voice?) — vocale WhatsApp (TTS + invio)
- send_whatsapp_image(phone, url, caption?) — immagine WhatsApp
- send_whatsapp_document(phone, url, filename?, caption?) — documento WhatsApp
- send_whatsapp_video(phone, url, caption?) — video WhatsApp
- generate_tts(text, voice?) — genera audio TTS per la chat (NON invia)
- generate_image(prompt) — genera immagine AI (restituisce file_path per invio WhatsApp)
- generate_pdf(titolo, contenuto) — genera PDF
- get_datetime(offset?) — data/ora corrente
- date_diff(from, to) — differenza tra date
- create_autonomous_agent, create_job, create_workflow, list_autonomous_agents, list_workflows, get_jobs, get_api_costs, get_whatsapp_status

DATI:
- names: persone/aziende con tags (cliente, lead, fornitore, candidato, utente, organizzazione) — hanno email, telefono, piva
- entity: oggetti con type (fattura, preventivo, ordine, progetto, documento, conto, rimborso, annuncio, board, evento) — hanno name_id, parent_id, numero, data, totale

REGOLE:
1. Se serve un dato (telefono, id), cercalo con search prima di usarlo
2. "lista/mostra X" = search. "cosa dice/definizione/articolo/contenuto" = retrieve
3. "leggi X" = generate_tts (audio in chat). "invia X a Y" = send_whatsapp_* (invio effettivo)
4. Referenzia risultati precedenti: {{step_0.0.telefono}} = campo telefono del primo risultato dello step 0
5. Saluti/chiacchiere = steps:[], domain:"general"
6. domain = agente: pulse, commerciale, produzione, marketing, amministrazione, hr, legal, infra, general
7. Rispondi SOLO JSON: {"steps":[...], "domain":"...", "reasoning":"..."}

ESEMPI:

User: "manda messaggio a Gab Ciao"
{"steps":[{"tool":"search","params":{"table":"names","query":"Gab"},"description":"Cerca Gab"},{"tool":"send_whatsapp_message","params":{"phone":"{{step_0.0.telefono}}","text":"Ciao"},"description":"Invia WhatsApp"}],"domain":"infra","reasoning":"Cerco telefono poi invio"}

User: "invia a Brando un immagine di un tramonto con scritto buonasera"
{"steps":[{"tool":"search","params":{"table":"names","query":"Brando"},"description":"Cerca Brando"},{"tool":"generate_image","params":{"prompt":"tramonto"},"description":"Genera immagine"},{"tool":"send_whatsapp_image","params":{"phone":"{{step_0.0.telefono}}","url":"{{step_1.file_path}}","caption":"buonasera"},"description":"Invia"}],"domain":"infra","reasoning":"Cerca contatto, genera immagine, invia con caption"}

User: "definizione imprenditore nel codice civile"
{"steps":[{"tool":"search","params":{"table":"entity","type":"documento","query":"codice civile"},"description":"Trova il documento"},{"tool":"retrieve","params":{"query":"definizione imprenditore","doc_id":"{{step_0.0.id}}"},"description":"Cerca nel contenuto"}],"domain":"legal","reasoning":"Trovo il doc, poi cerco dentro"}

User: "ciao"
{"steps":[],"domain":"general","reasoning":"Saluto"}`

// ── Planner Function ────────────────────────────────────

export async function createPlan(
  message: string,
  conversationHistory?: { role: string; content: string }[]
): Promise<Plan> {
  try {
    // Build context with recent conversation
    let contextText = message
    if (conversationHistory && conversationHistory.length > 0) {
      const recent = conversationHistory.slice(-3)
      contextText = recent.map(m => `${m.role}: ${m.content}`).join('\n') + '\nuser: ' + message
    }

    const res = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENROUTER_API_KEY}` },
      body: JSON.stringify({
        model: PLANNER_MODEL,
        messages: [
          { role: 'system', content: PLANNER_PROMPT },
          { role: 'user', content: contextText },
        ],
        max_tokens: 500,
      }),
    })

    if (!res.ok) {
      console.warn('Planner API error, falling back to general')
      return { steps: [], domain: 'general', reasoning: 'Planner unavailable' }
    }

    const data = await res.json()
    const text = data.choices?.[0]?.message?.content ?? ''
    const reasoning = data.choices?.[0]?.message?.reasoning ?? ''
    const fullText = text || reasoning

    const jsonMatch = fullText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.warn('Planner: no JSON found, falling back to general')
      return { steps: [], domain: 'general', reasoning: 'No plan generated' }
    }

    const plan = JSON.parse(jsonMatch[0]) as Plan
    if (!Array.isArray(plan.steps)) plan.steps = []
    if (!plan.domain) plan.domain = 'general'

    console.log(`[Planner] ${plan.steps.length} steps → ${plan.domain} (${plan.reasoning?.substring(0, 60)})`)
    return plan
  } catch (err) {
    console.error('Planner error:', err)
    return { steps: [], domain: 'general', reasoning: 'Planner error' }
  }
}

// ── Plan Executor ───────────────────────────────────────

export async function executePlan(plan: Plan, aziendaId: string): Promise<StepResult[]> {
  const results: StepResult[] = []

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i]
    try {
      // Resolve {{step_N.path}} references in params
      const resolvedParams = resolveReferences(step.params, results)

      const result = await executeTool(step.tool, aziendaId, resolvedParams)
      results.push({ step, result })
      console.log(`[Planner] Step ${i}: ${step.tool} → ${Array.isArray(result) ? result.length + ' results' : 'ok'}`)
    } catch (err: any) {
      console.error(`[Planner] Step ${i} error:`, err.message)
      results.push({ step, result: null, error: err.message })
    }
  }

  return results
}

// ── Reference Resolver ──────────────────────────────────

function resolveReferences(params: Record<string, unknown>, results: StepResult[]): Record<string, unknown> {
  const str = JSON.stringify(params)

  // Resolve {{step_N.path}} and {{step_N}} references
  const resolved = str.replace(/\{\{step_(\d+)(?:\.([^}]+))?\}\}/g, (match, stepIdxStr, path) => {
    const stepIdx = parseInt(stepIdxStr)
    if (stepIdx >= results.length) return match

    const stepResult = results[stepIdx].result

    // No path → stringify entire result
    if (!path) {
      if (stepResult === null || stepResult === undefined) return ''
      if (typeof stepResult === 'object') {
        // For objects, try to extract a readable summary
        const r = stepResult as any
        if (r.data) return r.data  // get_datetime → .data
        if (r.ora) return `${r.data} ${r.ora}`  // get_datetime full
        if (r.label) return r.label  // date_diff → .label
        if (r.messaggio) return r.messaggio
        return JSON.stringify(stepResult)
      }
      return String(stepResult)
    }

    const value = getNestedValue(stepResult, path)
    if (value === null || value === undefined) return ''
    return String(value)
  })

  try {
    return JSON.parse(resolved)
  } catch {
    return params // fallback to original if JSON parse fails
  }
}

function getNestedValue(obj: unknown, path: string): unknown {
  if (obj === null || obj === undefined) return null

  const parts = path.split('.')
  let current: any = obj

  for (const part of parts) {
    if (current === null || current === undefined) return null

    // Handle array index
    if (/^\d+$/.test(part)) {
      if (Array.isArray(current)) {
        current = current[parseInt(part)]
      } else {
        return null
      }
    } else {
      current = current[part]
    }
  }

  return current
}

// ── Format results for agent context ────────────────────

export function formatPlanResults(plan: Plan, results: StepResult[]): string {
  if (results.length === 0) return ''

  return results.map((r, i) => {
    const desc = r.step.description
    if (r.error) return `[Step ${i + 1}: ${desc}] ERRORE: ${r.error}`

    const data = r.result
    if (Array.isArray(data)) {
      // For retrieve results (chunks with testo): include full text so the agent can cite it
      const hasText = data.some((item: any) => item.testo)
      if (hasText) {
        const chunks = data.slice(0, 10).map((item: any) => {
          const sezione = item.sezione || item.display_name || ''
          const doc = item.documento || item.document || ''
          const testo = (item.testo || '').substring(0, 1000)
          return `--- ${sezione}${doc ? ' [' + doc + ']' : ''} ---\n${testo}`
        }).join('\n\n')
        return `[Step ${i + 1}: ${desc}] ${data.length} risultati:\n${chunks}`
      }

      // For other arrays: show summary
      const preview = data.slice(0, 8).map((item: any) => {
        const name = item.display_name || item.nome || item.messaggio || ''
        const extra = item.stato ? ` (${item.stato})` : ''
        const val = item.totale != null ? ` € ${item.totale}` : ''
        return `- ${name}${extra}${val}` || JSON.stringify(item).substring(0, 120)
      }).join('\n')
      return `[Step ${i + 1}: ${desc}] ${data.length} risultati:\n${preview}`
    }

    if (typeof data === 'object' && data !== null) {
      return `[Step ${i + 1}: ${desc}] ${JSON.stringify(data).substring(0, 500)}`
    }

    return `[Step ${i + 1}: ${desc}] ${String(data)}`
  }).join('\n')
}
