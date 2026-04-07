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
- find(query?, type?, tags?:[], stato?, name_id?, doc_id?, limit?) — cerca QUALSIASI cosa. Motore automatico: SQL per filtri, FTS5 per contenuto documenti, semantico per similarità. Un solo tool per tutto. — cerca in names (persone/aziende) o entity (fatture, ordini, progetti, documenti, conti, etc.)
- create(table, type?, tags?:[], display_name, email?, telefono?, stato?, name_id?, parent_id?, metadata?:{}) — crea
- update(id, table, display_name?, stato?, tags?, metadata?:{}) — aggiorna
- delete_record(id, table) — elimina
- relate(from_id, to_id, tipo) — collega
- get_tree(id) — record + figli + relazioni
- render_view(layout:{view, title, source, columns, kanban, chart}) — vista dinamica
- retrieve(query, doc_id?, limit?) — cerca DENTRO il contenuto dei documenti (articoli, clausole, definizioni)
- list_documents(categoria?) — lista documenti con info chunking e classificazione
- explore_document(doc_id, limit?) — mostra struttura interna (capitoli, sezioni, heading path)
- rechunk_document(doc_id) — ri-indicizza un documento (ri-estrae testo e ri-chunka)
- reclassify_document(doc_id, categoria?, tags?, display_name?) — cambia classificazione
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
- create_autonomous_agent(name, promptTemplate, trigger_type:"cron"|"event", cron?, event?, agentDomain?, notify?) — crea agente autonomo.
  CRON COMUNI: "* * * * *"=ogni minuto, "*/5 * * * *"=ogni 5min, "0 8 * * *"=ogni giorno 8:00, "0 9 * * 1"=lunedì 9:00
  EVENTI: "entity_created:documento", "name_created:lead", "entity_created:fattura", "name_created:cliente"
- create_job, create_workflow, list_autonomous_agents, list_workflows, get_jobs, get_api_costs, get_whatsapp_status

DATI (tutto in una sola tabella entity):
- Persone/aziende: type=persona|utente|organizzazione con tags (cliente, lead, fornitore, candidato) — hanno email, telefono
- Oggetti: type=fattura|preventivo|ordine|progetto|documento|report|conto|rimborso|annuncio|board|evento — hanno name_id, parent_id, numero, data, totale

REGOLE:
1. Se serve un dato (telefono, id), cercalo con search prima di usarlo
2. "lista/mostra X" = search. "cosa dice/definizione/articolo/contenuto/descrivimi/parlami di" = retrieve
3. IMPORTANTE: se l'utente menziona un documento specifico (bibbia, codice civile, contratto, report, etc.) o chiede informazioni su un argomento che POTREBBE essere in un documento caricato, USA SEMPRE retrieve. NON rispondere da conoscenze generali — cerca nei documenti!
4. Quando cerchi per NOME (persona, azienda, progetto, etc.), NON specificare type né tags — cerca in modo ampio con find(query="nome"). L'entità potrebbe essere un'organizzazione, un progetto, una persona, etc. Se trovi più risultati, usa get_tree sull'id trovato per vedere il dettaglio completo con figli e relazioni.
5. "leggi X" = generate_tts (audio in chat). "invia X a Y" = send_whatsapp_* (invio effettivo)
6. Referenzia risultati precedenti: {{step_0.0.telefono}} = campo telefono del primo risultato dello step 0
7. Saluti/chiacchiere = steps:[], domain:"general"
8. domain = agente: pulse, commerciale, produzione, marketing, amministrazione, hr, legal, documentale, it, doctor, whatsapp, tts, general
   - WhatsApp (invio/ricezione messaggi) → "whatsapp"
   - Documenti (cerca contenuto, riassumi, confronta, esplora struttura, classificazione) → "documentale"
   - Legale (analisi giuridica, compliance, interpretazione normativa) → "legal"
   - Creazione/gestione agenti autonomi, workflow, utenti, configurazione → "it" (anche se l'agente autonomo invierà WhatsApp)
   - Diagnostica sistema, salute dati, performance, problemi, errori, check-up → "doctor"
9. "manda/invia a [persona]" = SEMPRE search contatto + send_whatsapp_message. Se l'utente dice "questo testo" o "l'ultimo messaggio", usa il testo dalla conversazione precedente (history assistant)
10. Rispondi SOLO JSON: {"steps":[...], "domain":"...", "reasoning":"..."}

ESEMPI:

User: "manda messaggio a Gab Ciao"
{"steps":[{"tool":"find","params":{"query":"Gab"},"description":"Cerca Gab"},{"tool":"send_whatsapp_message","params":{"phone":"{{step_0.0.telefono}}","text":"Ciao"},"description":"Invia WhatsApp"}],"domain":"whatsapp","reasoning":"Cerco telefono poi invio"}

User: "invia a Brando un immagine di un tramonto con scritto buonasera"
{"steps":[{"tool":"find","params":{"query":"Brando"},"description":"Cerca Brando"},{"tool":"generate_image","params":{"prompt":"tramonto"},"description":"Genera immagine"},{"tool":"send_whatsapp_image","params":{"phone":"{{step_0.0.telefono}}","url":"{{step_1.file_path}}","caption":"buonasera"},"description":"Invia"}],"domain":"whatsapp","reasoning":"Cerca contatto, genera immagine, invia con caption"}

User: "definizione imprenditore nel codice civile"
{"steps":[{"tool":"find","params":{"type":"documento","query":"codice civile"},"description":"Trova il documento"},{"tool":"retrieve","params":{"query":"definizione imprenditore","doc_id":"{{step_0.0.id}}"},"description":"Cerca nel contenuto"}],"domain":"documentale","reasoning":"Trovo il doc, poi cerco dentro"}

User: "ciao"
{"steps":[],"domain":"general","reasoning":"Saluto"}`

// ── Planner Function ────────────────────────────────────

export async function createPlan(
  message: string,
  conversationHistory?: { role: string; content: string }[],
  systemSummary?: string
): Promise<Plan> {
  try {
    // Build context with recent conversation
    let contextText = message
    if (conversationHistory && conversationHistory.length > 0) {
      const recent = conversationHistory.slice(-4)
      contextText = recent.map(m => {
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        return `${m.role}: ${content.substring(0, 800)}`
      }).join('\n') + '\nuser: ' + message
    }
    // Append system summary so planner knows what data is available
    if (systemSummary) contextText = systemSummary + '\n\n' + contextText

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

      // For other arrays: show detailed summary
      const preview = data.slice(0, 8).map((item: any) => {
        const name = item.display_name || item.name || item.nome || item.action || item.messaggio || ''
        const extra: string[] = []
        if (item.stato) extra.push(item.stato)
        if (item.enabled !== undefined) extra.push(item.enabled ? 'attivo' : 'inattivo')
        if (item.agentDomain) extra.push(item.agentDomain)
        if (item.description) extra.push(item.description)
        if (item.trigger?.cron) extra.push(`cron: ${item.trigger.cron}`)
        if (item.trigger?.event) extra.push(`event: ${item.trigger.event}`)
        if (item.runs != null) extra.push(`${item.runs} esecuzioni`)
        if (item.totale != null) extra.push(`€ ${item.totale}`)
        if (item.email) extra.push(item.email)
        if (item.telefono) extra.push(item.telefono)
        const extraStr = extra.length > 0 ? ` (${extra.join(', ')})` : ''
        return `- ${name}${extraStr}` || JSON.stringify(item).substring(0, 200)
      }).join('\n')
      return `[Step ${i + 1}: ${desc}] ${data.length} risultati:\n${preview}`
    }

    if (typeof data === 'object' && data !== null) {
      return `[Step ${i + 1}: ${desc}] ${JSON.stringify(data).substring(0, 500)}`
    }

    return `[Step ${i + 1}: ${desc}] ${String(data)}`
  }).join('\n')
}
