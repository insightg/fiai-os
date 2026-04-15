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
import { executeTool, TOOL_DEFINITIONS } from './tool-registry.js'

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

    // FIAI tools — ALL registered tools (core + plugins) exposed as async functions
    ...Object.fromEntries(
      Object.keys(TOOL_DEFINITIONS).map(name => [name, toolProxy(name)])
    ),
    // Aliases
    search: toolProxy('find'),

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
