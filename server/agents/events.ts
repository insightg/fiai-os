/**
 * FIAI OS — Event Bus (in-process)
 *
 * Simple pub/sub for internal events. Autonomous agents
 * and workflows can subscribe to events and react.
 *
 * Event naming: "entity_created:fattura", "name_tag_added:cliente", etc.
 * Wildcard: "entity_created:*" matches all entity_created events.
 */

type EventHandler = (data: EventPayload) => Promise<void>

export interface EventPayload {
  event: string
  aziendaId: string
  userId?: string
  recordId: string
  recordType: 'name' | 'entity'
  entityType?: string    // for entity events: fattura, documento, etc.
  tags?: string[]        // for name events
  metadata?: Record<string, unknown>
  timestamp: string
}

const handlers = new Map<string, EventHandler[]>()
let eventLog: EventPayload[] = []
const MAX_LOG = 100

/**
 * Subscribe to an event.
 * Use exact match ("entity_created:fattura") or wildcard ("entity_created:*")
 */
export function on(event: string, handler: EventHandler): () => void {
  const existing = handlers.get(event) || []
  existing.push(handler)
  handlers.set(event, existing)
  // Return unsubscribe function
  return () => {
    const list = handlers.get(event)
    if (list) {
      const idx = list.indexOf(handler)
      if (idx >= 0) list.splice(idx, 1)
    }
  }
}

/**
 * Emit an event. Runs all matching handlers (exact + wildcard).
 * Non-blocking: errors are logged but don't propagate.
 */
export function emit(event: string, data: Omit<EventPayload, 'event' | 'timestamp'>): void {
  const payload: EventPayload = {
    ...data,
    event,
    timestamp: new Date().toISOString(),
  }

  // Log event
  eventLog.push(payload)
  if (eventLog.length > MAX_LOG) eventLog = eventLog.slice(-MAX_LOG)

  // Find matching handlers
  const matchingHandlers: EventHandler[] = []

  // Exact match
  const exact = handlers.get(event)
  if (exact) matchingHandlers.push(...exact)

  // Wildcard match: "entity_created:*" matches "entity_created:fattura"
  const [prefix] = event.split(':')
  const wildcard = handlers.get(`${prefix}:*`)
  if (wildcard) matchingHandlers.push(...wildcard)

  // Global wildcard "*"
  const global = handlers.get('*')
  if (global) matchingHandlers.push(...global)

  // Execute handlers (non-blocking)
  for (const handler of matchingHandlers) {
    handler(payload).catch(err => {
      console.error(`[Events] Handler error for "${event}":`, err)
    })
  }
}

/**
 * Get recent event log (for debugging/monitoring)
 */
export function getEventLog(limit = 20): EventPayload[] {
  return eventLog.slice(-limit)
}

/**
 * Clear all handlers (for testing)
 */
export function clearHandlers(): void {
  handlers.clear()
}

/**
 * List registered event subscriptions
 */
export function listSubscriptions(): { event: string; count: number }[] {
  return Array.from(handlers.entries()).map(([event, list]) => ({
    event,
    count: list.length,
  }))
}
