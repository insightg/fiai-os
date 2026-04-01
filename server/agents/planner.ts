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
Ricevi una richiesta utente e crei un piano di esecuzione tool.

TOOL DISPONIBILI:
- search(table:"names"|"entity"|"both", type?, tags?:string[], stato?, query?, name_id?, limit?) — cerca persone/aziende (names) o oggetti (entity: fattura, preventivo, ordine, progetto, documento, conto, rimborso, annuncio, board, evento)
- create(table:"names"|"entity", type?, tags?:string[], display_name, email?, telefono?, stato?, name_id?, parent_id?, numero?, data?, totale?, metadata?:{}) — crea record
- update(id, table:"names"|"entity", display_name?, stato?, tags?, metadata?:{}) — aggiorna (metadata viene mergiato)
- delete_record(id, table:"names"|"entity") — elimina
- relate(from_id, to_id, tipo) — crea relazione
- get_tree(id) — record + figli + relazioni
- render_view(layout:{view, title, source, columns, kanban, chart, ...}) — genera vista dinamica per il pannello
- send_whatsapp_message(phone, text) — invia messaggio WhatsApp (phone = numero senza +, es. "393471349312")
- send_whatsapp_voice(phone, text, voice?) — invia vocale WhatsApp (TTS)
- send_whatsapp_image(phone, url, caption?) — invia immagine su WhatsApp
- send_whatsapp_document(phone, url, filename?, caption?) — invia documento/file su WhatsApp
- send_whatsapp_video(phone, url, caption?) — invia video su WhatsApp
- retrieve(query, doc_id?, limit?) — cerca DENTRO il contenuto dei documenti caricati (articoli, clausole, definizioni, sezioni). Usa SOLO quando l'utente chiede informazioni SPECIFICHE su un contenuto (es. "definizione di imprenditore", "articolo 2082", "clausola penale"). NON usare retrieve per listare documenti — usa search per quello.
- generate_tts(text, voice?) — genera audio TTS da ascoltare in chat. Restituisce {audio_url, file_path}. NON invia su WhatsApp.
- generate_image(prompt) — genera immagine AI. Restituisce: {image_url, file_path, api_url}. Per invio WhatsApp usa il file_path: {{step_N.file_path}}
- generate_pdf(titolo, contenuto) — genera PDF
- create_autonomous_agent(name, agentDomain, promptTemplate, trigger_type:"cron"|"event", cron?, event?, notify?:string[]) — crea agente autonomo
- create_job(action, params?, scheduled_at?, cron?) — crea job background
- create_workflow(name, steps:[{id, agent, prompt, dependsOn?}]) — crea workflow multi-agente
- list_autonomous_agents() — lista agenti autonomi
- list_workflows() — lista workflow
- get_jobs(stato?, limit?) — stato job queue
- get_api_costs() — costi API
- get_whatsapp_status() — stato WhatsApp
- get_datetime(offset?) — data/ora corrente. offset: "7d", "-3d", "1w", "1m", "next_monday", "end_month", "start_week", etc.
- date_diff(from, to) — differenza tra due date in giorni/settimane/mesi. Usa "today" per la data corrente

NOMI E ENTITY:
- names contiene: clienti (tags:["cliente"]), lead (tags:["lead"]), fornitori (tags:["fornitore"]), candidati (tags:["candidato"]), utenti (tags:["utente"]), organizzazioni (tags:["organizzazione"])
- entity contiene: fattura, preventivo, ordine, progetto, documento, conto, movimento, rimborso, annuncio, board, card, evento, chat_session, job, autonomous_agent, workflow
- Ogni name ha: id, display_name, email, telefono, piva, tags, stato, metadata, path
- Ogni entity ha: id, type, display_name, stato, name_id (link a name), parent_id (gerarchia), numero, data, totale, metadata, path

REGOLE:
0. L'agente deve rispondere SOLO con dati presenti nel sistema. MAI inventare dati.
   IMPORTANTE: distingui tra "LISTA/MOSTRA documenti" (usa search) e "CERCA NEL CONTENUTO di un documento" (usa retrieve).
   - "normative", "lista documenti", "mostra contratti" → search(table="entity", type="documento")
   - "definizione di X", "articolo Y", "cosa dice il documento su Z" → retrieve(query="...")
1. Se serve un dato (telefono, email, id di qualcuno), PRIMA cercalo con search
2. MEDIA INTELLIGENTE — analizza COSA fare:
   - "leggi/dì/pronuncia X" = genera audio TTS da ascoltare nella chat (generate_tts). NON invia nulla.
   - "invia messaggio/scrivi a Y" = send_whatsapp_message (testo)
   - "invia immagine/foto a Y" = generate_image + send_whatsapp_image
   - "invia vocale a Y" / "manda audio a Y" = send_whatsapp_voice (TTS + invio WhatsApp)
   - "invia documento/file a Y" = send_whatsapp_document
   - "invia video a Y" = send_whatsapp_video
   - "leggi X e invia a Y" = send_whatsapp_voice (TTS + invio come vocale WhatsApp)
   - Puoi combinare più media nello stesso piano
3. Referenzia risultati di step precedenti con {{step_N.campo}} — N è l'indice (0-based)
   Per array: {{step_0.0.telefono}} = primo elemento del risultato dello step 0, campo telefono
3. Per richieste semplici (saluti, domande generiche, chiacchiere) usa steps:[] e domain:"general"
4. domain = agente che sintetizzerà: pulse, commerciale, produzione, marketing, amministrazione, hr, legal, infra, general
5. Rispondi SOLO con JSON valido, niente altro testo

ESEMPI:

User: "manda messaggio a Gab Ciao"
{"steps":[{"tool":"search","params":{"table":"names","query":"Gab","tags":["utente"]},"description":"Cerca Gab per trovare il telefono"},{"tool":"send_whatsapp_message","params":{"phone":"{{step_0.0.telefono}}","text":"Ciao"},"description":"Invia messaggio WhatsApp"}],"domain":"infra","reasoning":"Cerco il telefono di Gab poi invio il messaggio"}

User: "lista clienti"
{"steps":[{"tool":"search","params":{"table":"names","tags":["cliente"]},"description":"Cerca tutti i clienti"}],"domain":"commerciale","reasoning":"Ricerca semplice clienti"}

User: "fatturato dei clienti con progetti attivi"
{"steps":[{"tool":"search","params":{"table":"entity","type":"progetto","stato":"in_corso"},"description":"Trova progetti attivi"},{"tool":"search","params":{"table":"entity","type":"fattura"},"description":"Trova tutte le fatture"}],"domain":"amministrazione","reasoning":"Incrocio progetti attivi con fatture per calcolare il fatturato per cliente"}

User: "ciao come stai"
{"steps":[],"domain":"general","reasoning":"Saluto semplice, nessun tool necessario"}

User: "che ore sono" / "che giorno è" / "data di oggi"
{"steps":[{"tool":"get_datetime","params":{},"description":"Recupera data e ora corrente"}],"domain":"general","reasoning":"L'utente chiede data/ora, uso il tool dedicato"}

User: "quanti giorni mancano alla scadenza del progetto X"
{"steps":[{"tool":"search","params":{"table":"entity","type":"progetto","query":"X"},"description":"Cerca il progetto"},{"tool":"date_diff","params":{"from":"today","to":"{{step_0.0.metadata.data_fine_prevista}}"},"description":"Calcola giorni alla scadenza"}],"domain":"produzione","reasoning":"Cerco la scadenza del progetto e calcolo la differenza"}

User: "leggi ciao"
{"steps":[{"tool":"generate_tts","params":{"text":"ciao"},"description":"Genera audio TTS da ascoltare in chat"}],"domain":"general","reasoning":"leggi = genera audio TTS per la chat, NON invia su WhatsApp"}

User: "leggi ciao e invia a Gab"
{"steps":[{"tool":"search","params":{"table":"names","query":"Gab","tags":["utente"]},"description":"Cerca Gab"},{"tool":"send_whatsapp_voice","params":{"phone":"{{step_0.0.telefono}}","text":"ciao"},"description":"Invia vocale TTS su WhatsApp"}],"domain":"infra","reasoning":"leggi + invia = vocale TTS inviato su WhatsApp"}

User: "invia a Brando un immagine di un tramonto con scritto buonasera"
{"steps":[{"tool":"search","params":{"table":"names","query":"Brando","tags":["utente"]},"description":"Cerca Brando"},{"tool":"generate_image","params":{"prompt":"tramonto"},"description":"Genera immagine tramonto"},{"tool":"send_whatsapp_image","params":{"phone":"{{step_0.0.telefono}}","url":"{{step_1.file_path}}","caption":"buonasera"},"description":"Invia immagine con caption"}],"domain":"infra","reasoning":"Genera immagine + invia come WhatsApp image con caption"}

User: "manda a Gab un vocale e una foto di un gatto"
{"steps":[{"tool":"search","params":{"table":"names","query":"Gab","tags":["utente"]},"description":"Cerca Gab"},{"tool":"send_whatsapp_voice","params":{"phone":"{{step_0.0.telefono}}","text":"Ti mando una foto di un gatto!"},"description":"Vocale intro"},{"tool":"generate_image","params":{"prompt":"gatto carino"},"description":"Genera foto gatto"},{"tool":"send_whatsapp_image","params":{"phone":"{{step_0.0.telefono}}","url":"{{step_2.file_path}}"},"description":"Invia foto"}],"domain":"infra","reasoning":"Multi-media: vocale + immagine generata"}

User: "normative" / "documenti legali"
{"steps":[{"tool":"search","params":{"table":"entity","type":"documento","query":"legale normativa codice"},"description":"Cerca documenti normativi/legali"}],"domain":"legal","reasoning":"L'utente vuole i documenti normativi — filtro per categoria legale/normativa"}

User: "lista documenti" / "tutti i documenti"
{"steps":[{"tool":"search","params":{"table":"entity","type":"documento"},"description":"Elenca tutti i documenti"}],"domain":"legal","reasoning":"L'utente vuole tutti i documenti senza filtro"}

User: "definizione imprenditore nel codice civile"
{"steps":[{"tool":"search","params":{"table":"entity","type":"documento","query":"codice civile"},"description":"Trova il documento"},{"tool":"retrieve","params":{"query":"definizione imprenditore","doc_id":"{{step_0.0.id}}"},"description":"Cerca la definizione nel contenuto"}],"domain":"legal","reasoning":"Prima trovo il documento, poi cerco dentro con retrieve"}

User: "clausole penali nel contratto"
{"steps":[{"tool":"retrieve","params":{"query":"penali sanzioni inadempimento"},"description":"Cerca clausole penali in tutti i documenti"}],"domain":"legal","reasoning":"Ricerca nel contenuto di tutti i documenti"}

User: "riassumi il capitolo 3 dei promessi sposi"
{"steps":[{"tool":"search","params":{"table":"entity","type":"documento","query":"promessi sposi"},"description":"Trova il documento"},{"tool":"retrieve","params":{"query":"Capitolo III","doc_id":"{{step_0.0.id}}","limit":10},"description":"Trova le sezioni del capitolo 3"}],"domain":"legal","reasoning":"Trovo il doc poi recupero il capitolo"}

User: "crea un lead Mario Rossi email mario@test.com telefono 3331234567"
{"steps":[{"tool":"create","params":{"table":"names","tags":["lead"],"display_name":"Mario Rossi","email":"mario@test.com","telefono":"3331234567","stato":"nuovo"},"description":"Crea lead Mario Rossi"}],"domain":"commerciale","reasoning":"Creazione diretta di un lead con dati forniti"}

User: "overview aziendale"
{"steps":[{"tool":"search","params":{"table":"names","tags":["cliente"],"limit":5},"description":"Conta clienti"},{"tool":"search","params":{"table":"names","tags":["lead"]},"description":"Cerca lead"},{"tool":"search","params":{"table":"entity","type":"fattura"},"description":"Cerca fatture"},{"tool":"search","params":{"table":"entity","type":"progetto","stato":"in_corso"},"description":"Progetti attivi"}],"domain":"pulse","reasoning":"Raccolgo dati da più domini per l'overview"}`

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
      const preview = data.slice(0, 5).map((item: any) =>
        item.display_name || item.nome || item.messaggio || JSON.stringify(item).substring(0, 100)
      ).join(', ')
      return `[Step ${i + 1}: ${desc}] ${data.length} risultati: ${preview}`
    }

    if (typeof data === 'object' && data !== null) {
      return `[Step ${i + 1}: ${desc}] ${JSON.stringify(data).substring(0, 300)}`
    }

    return `[Step ${i + 1}: ${desc}] ${String(data)}`
  }).join('\n')
}
