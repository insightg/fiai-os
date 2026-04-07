/**
 * FIAI OS — Autonomous Agent Registry
 *
 * Autonomous agents are stored as entity(type='autonomous_agent').
 * They are executed by the job worker based on their trigger config.
 * The generic job handler 'run_autonomous_agent' calls executeAgent() internally.
 *
 * Created via chat: "crea un agente che ogni mattina controlla le fatture scadute"
 * → the IT agent calls create_autonomous_agent tool
 * → saves as entity + creates a recurring job
 */
import crypto from 'crypto'
import db from '../db.js'
import { createJob, registerJobHandler } from '../jobs.js'
import { executeAgent } from './base-agent.js'
import { AGENTS } from './config.js'
import { buildAutonomousContext } from './context.js'
import { on, emit } from './events.js'
import type { AgentDomain } from './types.js'

export interface AutonomousAgentConfig {
  name: string
  description: string
  agentDomain: AgentDomain
  promptTemplate: string
  trigger: {
    type: 'cron' | 'event' | 'condition'
    cron?: string
    event?: string
    condition?: string
  }
  notifyChannels?: string[]   // ['chat', 'whatsapp']
  enabled?: boolean
}

/**
 * Create an autonomous agent (saved as entity + job)
 */
export function createAutonomousAgent(
  aziendaId: string,
  config: AutonomousAgentConfig,
  userId?: string
): string {
  const id = crypto.randomUUID()
  const slug = config.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 80)

  // Save agent config as entity
  db.prepare(`INSERT INTO entity (id, azienda_id, type, display_name, slug, stato, name_id, parent_id, user_id, file_url, numero, data, totale, metadata, path, created_at, updated_at)
    VALUES (?, ?, 'autonomous_agent', ?, ?, ?, NULL, NULL, ?, NULL, NULL, NULL, NULL, ?, ?, datetime('now'), datetime('now'))`).run(
    id, aziendaId, config.name, slug,
    config.enabled !== false ? 'active' : 'inactive',
    userId || null,
    JSON.stringify({
      description: config.description,
      agentDomain: config.agentDomain,
      promptTemplate: config.promptTemplate,
      trigger: config.trigger,
      notifyChannels: config.notifyChannels || ['chat'],
      runs: 0,
      last_run: null,
      last_result: null,
    }),
    `/entity/autonomous-agents/${slug}`
  )

  // If cron trigger, create a recurring job
  if (config.trigger.type === 'cron' && config.trigger.cron) {
    createJob(aziendaId, 'run_autonomous_agent', { agentId: id }, {
      cron: config.trigger.cron,
      userId,
    })
  }

  // If event trigger, subscribe to the event
  if (config.trigger.type === 'event' && config.trigger.event) {
    subscribeAgentToEvent(id, aziendaId, config)
  }

  console.log(`[Autonomous] Agent "${config.name}" created (${config.trigger.type}: ${config.trigger.cron || config.trigger.event || 'manual'})`)
  return id
}

/**
 * List autonomous agents for an azienda
 */
export function listAutonomousAgents(aziendaId: string): any[] {
  const agents = db.prepare(
    "SELECT id, display_name, stato, metadata, created_at, updated_at FROM entity WHERE type = 'autonomous_agent' AND azienda_id = ? ORDER BY created_at DESC"
  ).all(aziendaId) as any[]

  return agents.map(a => {
    const m = typeof a.metadata === 'string' ? JSON.parse(a.metadata) : a.metadata
    return {
      id: a.id,
      name: a.display_name,
      enabled: a.stato === 'active',
      description: m.description,
      agentDomain: m.agentDomain,
      trigger: m.trigger,
      notifyChannels: m.notifyChannels,
      runs: m.runs || 0,
      last_run: m.last_run,
      last_result: m.last_result,
      created_at: a.created_at,
    }
  })
}

/**
 * Toggle autonomous agent enabled/disabled
 */
export function toggleAutonomousAgent(id: string, aziendaId: string, enabled: boolean): boolean {
  const agent = db.prepare(
    "SELECT id FROM entity WHERE id = ? AND azienda_id = ? AND type = 'autonomous_agent'"
  ).get(id, aziendaId)
  if (!agent) return false

  db.prepare("UPDATE entity SET stato = ?, updated_at = datetime('now') WHERE id = ?").run(
    enabled ? 'active' : 'inactive', id
  )
  return true
}

/**
 * Delete autonomous agent and its associated jobs
 */
export function deleteAutonomousAgent(id: string, aziendaId: string): boolean {
  const agent = db.prepare(
    "SELECT id FROM entity WHERE id = ? AND azienda_id = ? AND type = 'autonomous_agent'"
  ).get(id, aziendaId)
  if (!agent) return false

  // Delete associated jobs
  db.prepare(
    "DELETE FROM entity WHERE type = 'job' AND azienda_id = ? AND json_extract(metadata, '$.params.agentId') = ?"
  ).run(aziendaId, id)

  // Delete the agent entity
  db.prepare("DELETE FROM entity WHERE id = ?").run(id)
  return true
}

/**
 * Get logs for an autonomous agent
 */
export function getAgentLogs(aziendaId: string, agentId?: string, limit = 20): any[] {
  let sql = "SELECT id, display_name, stato, metadata, created_at FROM entity WHERE type = 'agent_log' AND azienda_id = ?"
  const params: any[] = [aziendaId]
  if (agentId) {
    sql += " AND parent_id = ?"
    params.push(agentId)
  }
  sql += ` ORDER BY created_at DESC LIMIT ${limit}`
  const logs = db.prepare(sql).all(...params) as any[]
  return logs.map(l => {
    const m = typeof l.metadata === 'string' ? JSON.parse(l.metadata) : l.metadata
    return { id: l.id, agent: l.display_name, stato: l.stato, result: m.result, error: m.error, created_at: l.created_at }
  })
}

/**
 * Subscribe an agent to an event
 */
function subscribeAgentToEvent(agentId: string, aziendaId: string, config: AutonomousAgentConfig): void {
  if (!config.trigger.event) return

  on(config.trigger.event, async (payload) => {
    if (payload.aziendaId !== aziendaId) return

    // Check if agent is still active
    const agent = db.prepare(
      "SELECT stato FROM entity WHERE id = ? AND type = 'autonomous_agent'"
    ).get(agentId) as any
    if (!agent || agent.stato !== 'active') return

    // Execute the agent
    await runAutonomousAgent(agentId, aziendaId, payload)
  })
}

/**
 * Execute an autonomous agent (called by job worker or event handler)
 */
async function runAutonomousAgent(
  agentId: string,
  aziendaId: string,
  eventPayload?: any
): Promise<any> {
  const agentEntity = db.prepare(
    "SELECT metadata FROM entity WHERE id = ? AND type = 'autonomous_agent'"
  ).get(agentId) as any
  if (!agentEntity) throw new Error(`Autonomous agent ${agentId} not found`)

  const meta = typeof agentEntity.metadata === 'string' ? JSON.parse(agentEntity.metadata) : agentEntity.metadata
  const agentConfig = AGENTS[meta.agentDomain as string]
  if (!agentConfig) throw new Error(`Agent domain "${meta.agentDomain}" not found`)

  // Build prompt from template, inject event data if available
  let prompt = '[AGENTE AUTONOMO — NON chiedere conferma, NON disambiguare, esegui direttamente]\n\n' + meta.promptTemplate
  if (eventPayload) {
    prompt += `\n\nEvento trigger: ${JSON.stringify(eventPayload)}`
  }

  // Execute the agent
  const context = buildAutonomousContext(meta.agentDomain, aziendaId)
  const result = await executeAgent(prompt, agentConfig, aziendaId, '', context, 'web')

  // Log the execution
  const logId = crypto.randomUUID()
  db.prepare(`INSERT INTO entity (id, azienda_id, type, display_name, slug, stato, parent_id, metadata, path, created_at, updated_at)
    VALUES (?, ?, 'agent_log', ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`).run(
    logId, aziendaId, meta.name || 'Agent Log', logId, 'completed',
    agentId,
    JSON.stringify({ result: result.text?.substring(0, 500), toolCalls: result.toolCalls?.length || 0 }),
    `/entity/agent-logs/${logId}`
  )

  // Update agent stats
  db.prepare(`UPDATE entity SET metadata = json_set(metadata, '$.runs', json_extract(metadata, '$.runs') + 1, '$.last_run', ?, '$.last_result', ?), updated_at = datetime('now') WHERE id = ?`).run(
    new Date().toISOString(),
    result.text?.substring(0, 200) || '',
    agentId
  )

  // Notify channels
  const channels = Array.isArray(meta.notifyChannels) ? meta.notifyChannels : (typeof meta.notifyChannels === 'string' ? [meta.notifyChannels] : [])
  if (channels.includes('whatsapp') && result.text) {
    // Find admin phones
    const admins = db.prepare(
      "SELECT telefono FROM entity WHERE azienda_id = ? AND tags LIKE '%\"admin\"%' AND telefono IS NOT NULL"
    ).all(aziendaId) as any[]
    for (const admin of admins) {
      try {
        const whatsapp = await import('../whatsapp.js')
        const sock = (whatsapp as any).getSock?.()
        if (sock) {
          const jid = `${admin.telefono.replace(/\D/g, '')}@s.whatsapp.net`
          await sock.sendMessage(jid, { text: `🤖 ${meta.name}:\n${result.text.substring(0, 500)}` })
        }
      } catch {}
    }
  }

  return result
}

/**
 * Register the generic job handler for autonomous agents.
 * Called once at startup.
 */
export function initAutonomousAgents(): void {
  registerJobHandler('run_autonomous_agent', async (params, jobId, aziendaId) => {
    const { agentId } = params
    if (!agentId) throw new Error('agentId required')

    // Check if agent is active
    const agent = db.prepare(
      "SELECT stato FROM entity WHERE id = ? AND type = 'autonomous_agent'"
    ).get(agentId) as any
    if (!agent || agent.stato !== 'active') {
      return { skipped: true, reason: 'Agent inactive' }
    }

    return runAutonomousAgent(agentId, aziendaId)
  })

  // Re-subscribe event-triggered agents on startup
  const eventAgents = db.prepare(
    "SELECT id, azienda_id, metadata FROM entity WHERE type = 'autonomous_agent' AND stato = 'active'"
  ).all() as any[]
  for (const a of eventAgents) {
    const m = typeof a.metadata === 'string' ? JSON.parse(a.metadata) : a.metadata
    if (m.trigger?.type === 'event' && m.trigger.event) {
      subscribeAgentToEvent(a.id, a.azienda_id, {
        name: m.name,
        description: m.description,
        agentDomain: m.agentDomain,
        promptTemplate: m.promptTemplate,
        trigger: m.trigger,
        notifyChannels: m.notifyChannels,
      })
    }
  }
  if (eventAgents.length > 0) {
    console.log(`[Autonomous] Restored ${eventAgents.length} event subscriptions`)
  }
}
