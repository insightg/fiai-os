export type HookEvent = 'pre_classify' | 'post_classify' | 'pre_execute' | 'post_execute' | 'on_error'

export interface HookContext {
  messages: { role: string; content: string | object[] }[]
  domain?: string
  confidence?: number
  agentName?: string
  toolCalls?: Record<string, unknown>[]
  result?: { text: string; toolCalls: Record<string, unknown>[] }
  error?: Error
  sessionId?: string
  startTime?: number
  [key: string]: unknown
}

type HookHandler = (ctx: HookContext) => Promise<HookContext>

const hookRegistry = new Map<HookEvent, HookHandler[]>()

export function registerHook(event: HookEvent, handler: HookHandler) {
  const existing = hookRegistry.get(event) || []
  existing.push(handler)
  hookRegistry.set(event, existing)
}

export async function runHooks(event: HookEvent, ctx: HookContext): Promise<HookContext> {
  const handlers = hookRegistry.get(event) || []
  let current = ctx
  for (const handler of handlers) {
    try {
      current = await handler(current)
    } catch (err) {
      console.warn(`Hook error [${event}]:`, err)
    }
  }
  return current
}

// ── Built-in Hooks ────────────────────────────────────

// Post-classify: warn on low confidence
registerHook('post_classify', async (ctx) => {
  if (ctx.confidence !== undefined && ctx.confidence < 0.6) {
    console.warn(`Low confidence classification: ${ctx.domain} (${ctx.confidence})`)
  }
  return ctx
})

// Post-execute: log execution time
registerHook('post_execute', async (ctx) => {
  if (ctx.startTime) {
    const duration = Date.now() - ctx.startTime
    console.log(`Agent ${ctx.agentName || ctx.domain} completed in ${duration}ms`)
  }
  return ctx
})

// Pre-execute: security validation — block write tools for viewer role
registerHook('pre_execute', async (ctx) => {
  const userRole = (ctx.userRole as string) || 'collaboratore'
  if (userRole === 'viewer' && ctx.toolCalls) {
    const writeTools = new Set(['create_lead', 'create_client', 'create_candidate', 'approve_expense'])
    for (const tc of ctx.toolCalls) {
      const toolName = (tc as Record<string, unknown>).tool as string
      if (writeTools.has(toolName)) {
        console.warn(`Security: blocked write tool ${toolName} for viewer role`)
        ctx.blocked = true
        ctx.blockReason = `Operazione "${toolName}" non consentita per il ruolo ${userRole}`
      }
    }
  }
  return ctx
})
