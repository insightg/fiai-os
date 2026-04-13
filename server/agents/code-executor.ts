/**
 * FIAI OS — Code Execution Sandbox
 *
 * Inspired by Anthropic's programmatic tool calling.
 * Allows agents to write JavaScript that calls FIAI tools in loops,
 * with conditional logic and data filtering.
 * Only the final output (stdout) goes back to the agent's context.
 *
 * Uses Node.js `vm` module for isolation.
 */
import vm from 'vm'
import { executeTool } from './tool-registry.js'

const TIMEOUT_MS = 60000  // 60s max execution
const MAX_OUTPUT = 8000   // max stdout chars

export interface CodeResult {
  stdout: string
  stderr: string
  return_code: number
}

/**
 * Execute JavaScript code in a sandboxed VM with FIAI tools exposed as async functions.
 *
 * Available in sandbox:
 *   find(params)         — search entities
 *   create(params)       — create entity
 *   update(params)       — update entity
 *   delete_record(params)— delete entity
 *   relate(params)       — create relation
 *   get_tree(params)     — get record + children
 *   retrieve(params)     — search document content
 *   print(...)           — output to stdout
 *   console.log(...)     — alias for print
 *   JSON                 — JSON parse/stringify
 *   Math                 — Math utilities
 */
export async function executeCode(code: string, aziendaId: string): Promise<CodeResult> {
  const output: string[] = []
  const errors: string[] = []

  // Capture print/console.log
  const print = (...args: any[]) => {
    const line = args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')
    output.push(line)
  }

  // Expose FIAI tools as async functions
  const toolProxy = (name: string) => async (params?: Record<string, unknown>) => {
    try {
      return await executeTool(name, aziendaId, params || {})
    } catch (err: any) {
      errors.push(`${name}: ${err.message}`)
      return { errore: err.message }
    }
  }

  const sandbox: Record<string, any> = {
    // Output
    print,
    console: { log: print, error: (...args: any[]) => errors.push(args.map(String).join(' ')) },

    // FIAI tools — all tools available to agents
    find: toolProxy('find'),
    search: toolProxy('find'),
    create: toolProxy('create'),
    update: toolProxy('update'),
    delete_record: toolProxy('delete_record'),
    relate: toolProxy('relate'),
    get_tree: toolProxy('get_tree'),
    retrieve: toolProxy('retrieve'),
    list_documents: toolProxy('list_documents'),
    explore_document: toolProxy('explore_document'),
    get_datetime: toolProxy('get_datetime'),
    date_diff: toolProxy('date_diff'),
    generate_pdf: toolProxy('generate_pdf'),
    render_view: toolProxy('render_view'),
    // WhatsApp
    send_whatsapp_message: toolProxy('send_whatsapp_message'),
    send_whatsapp_voice: toolProxy('send_whatsapp_voice'),
    send_whatsapp_image: toolProxy('send_whatsapp_image'),
    send_whatsapp_document: toolProxy('send_whatsapp_document'),
    send_whatsapp_video: toolProxy('send_whatsapp_video'),
    get_whatsapp_status: toolProxy('get_whatsapp_status'),
    // Email
    send_email: toolProxy('send_email'),
    read_inbox: toolProxy('read_inbox'),
    read_email: toolProxy('read_email'),
    search_emails: toolProxy('search_emails'),
    reply_email: toolProxy('reply_email'),
    download_email_attachment: toolProxy('download_email_attachment'),
    get_email_status: toolProxy('get_email_status'),
    // Planning
    planning_health: toolProxy('planning_health'),
    planning_viaggi: toolProxy('planning_viaggi'),
    planning_suggerisci: toolProxy('planning_suggerisci'),
    planning_assegna: toolProxy('planning_assegna'),
    planning_autisti: toolProxy('planning_autisti'),
    planning_semirimorchi: toolProxy('planning_semirimorchi'),
    planning_gps: toolProxy('planning_gps'),
    planning_distanza: toolProxy('planning_distanza'),
    planning_statistiche: toolProxy('planning_statistiche'),
    planning_confronta: toolProxy('planning_confronta'),
    planning_scenario: toolProxy('planning_scenario'),
    planning_eta: toolProxy('planning_eta'),
    planning_conflitti: toolProxy('planning_conflitti'),
    planning_storico: toolProxy('planning_storico'),
    planning_dettaglio: toolProxy('planning_dettaglio'),
    planning_analizza: toolProxy('planning_analizza'),
    planning_pianificazione_corrente: toolProxy('planning_pianificazione_corrente'),
    planning_cerca_autista: toolProxy('planning_cerca_autista'),
    planning_tutti_autisti: toolProxy('planning_tutti_autisti'),
    // Media
    generate_image: toolProxy('generate_image'),
    generate_tts: toolProxy('generate_tts'),
    // Infra
    list_autonomous_agents: toolProxy('list_autonomous_agents'),
    get_jobs: toolProxy('get_jobs'),
    get_api_costs: toolProxy('get_api_costs'),

    // Safe builtins
    JSON,
    Math,
    Date,
    Array,
    Object,
    String,
    Number,
    Boolean,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    setTimeout: undefined,  // blocked
    setInterval: undefined, // blocked
    fetch: undefined,       // blocked
    require: undefined,     // blocked
    process: undefined,     // blocked
    global: undefined,      // blocked
    globalThis: undefined,  // blocked
  }

  try {
    // Wrap in async IIFE so await works at top level
    const wrappedCode = `(async () => {\n${code}\n})()`

    const context = vm.createContext(sandbox)
    const script = new vm.Script(wrappedCode, { filename: 'agent-code.js', timeout: TIMEOUT_MS })

    // Run and await the async IIFE
    const promise = script.runInContext(context, { timeout: TIMEOUT_MS })
    await promise

    const stdout = output.join('\n').substring(0, MAX_OUTPUT)
    const stderr = errors.join('\n').substring(0, 2000)

    return { stdout, stderr, return_code: 0 }
  } catch (err: any) {
    const stdout = output.join('\n').substring(0, MAX_OUTPUT)
    const errMsg = err.message || String(err)

    // Friendly error messages
    let stderr = errMsg
    if (errMsg.includes('Script execution timed out')) {
      stderr = 'Timeout: lo script ha superato il limite di 30 secondi'
    }

    return { stdout, stderr, return_code: 1 }
  }
}
