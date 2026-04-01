/**
 * FIAI OS — Workflow Engine
 *
 * Workflows are multi-step agent chains saved as entity(type='workflow').
 * Each step runs an agent with a prompt, optionally depending on previous steps.
 * Executed by the job worker via 'run_workflow' handler.
 */
import crypto from 'crypto'
import db from '../db.js'
import { createJob, registerJobHandler } from '../jobs.js'
import { executeAgent } from './base-agent.js'
import { AGENTS } from './config.js'
import { buildContext } from './context.js'

export interface WorkflowStep {
  id: string
  agent: string           // domain name (commerciale, amministrazione, etc.)
  prompt: string           // message to send to the agent
  dependsOn?: string[]     // step IDs that must complete first
  condition?: string       // simple condition: "previous.toolCalls.length > 0"
}

export interface WorkflowConfig {
  name: string
  description?: string
  steps: WorkflowStep[]
}

/**
 * Create a workflow (saved as entity)
 */
export function createWorkflow(
  aziendaId: string,
  config: WorkflowConfig,
  userId?: string
): string {
  const id = crypto.randomUUID()
  const slug = config.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 80)

  db.prepare(`INSERT INTO entity (id, azienda_id, type, display_name, slug, stato, user_id, metadata, path, created_at, updated_at)
    VALUES (?, ?, 'workflow', ?, ?, 'ready', ?, ?, ?, datetime('now'), datetime('now'))`).run(
    id, aziendaId, config.name, slug, userId || null,
    JSON.stringify({
      description: config.description,
      steps: config.steps,
      runs: 0,
      last_run: null,
    }),
    `/entity/workflows/${slug}`
  )

  console.log(`[Workflow] "${config.name}" created with ${config.steps.length} steps`)
  return id
}

/**
 * Run a workflow (execute steps in dependency order)
 */
export async function runWorkflow(
  workflowId: string,
  aziendaId: string
): Promise<{ results: Record<string, any>; synthesized: string }> {
  const wf = db.prepare(
    "SELECT metadata FROM entity WHERE id = ? AND type = 'workflow'"
  ).get(workflowId) as any
  if (!wf) throw new Error(`Workflow ${workflowId} not found`)

  const meta = typeof wf.metadata === 'string' ? JSON.parse(wf.metadata) : wf.metadata
  const steps: WorkflowStep[] = meta.steps

  // Track results per step
  const results: Record<string, any> = {}
  const completed = new Set<string>()

  // Topological execution: process steps whose dependencies are all met
  let iterations = 0
  const maxIterations = steps.length * 2 // safety limit

  while (completed.size < steps.length && iterations++ < maxIterations) {
    let progress = false

    for (const step of steps) {
      if (completed.has(step.id)) continue

      // Check dependencies
      const depsOk = !step.dependsOn || step.dependsOn.every(d => completed.has(d))
      if (!depsOk) continue

      // Check condition
      if (step.condition && step.dependsOn?.length) {
        const previousResults = step.dependsOn.map(d => results[d])
        // Simple condition eval: skip if no data from dependencies
        if (previousResults.some(r => !r || r.error)) continue
      }

      // Execute step
      const agentConfig = AGENTS[step.agent]
      if (!agentConfig) {
        results[step.id] = { error: `Agent "${step.agent}" not found` }
        completed.add(step.id)
        progress = true
        continue
      }

      // Build prompt: inject previous results if this step depends on others
      let prompt = step.prompt
      if (step.dependsOn?.length) {
        const prevData = step.dependsOn.map(d => {
          const r = results[d]
          return `[${d}]: ${r?.text?.substring(0, 300) || 'nessun dato'}`
        }).join('\n')
        prompt += `\n\nRisultati degli step precedenti:\n${prevData}`
      }

      try {
        const context = buildContext(step.agent, aziendaId, '', '')
        const result = await executeAgent(prompt, agentConfig, aziendaId, '', context, 'web')
        results[step.id] = {
          text: result.text,
          toolCalls: result.toolCalls,
          agentName: result.agentName,
        }
      } catch (err: any) {
        results[step.id] = { error: err.message }
      }

      completed.add(step.id)
      progress = true
    }

    if (!progress) break // deadlock or circular dependency
  }

  // Synthesize all results
  const allTexts = steps
    .filter(s => results[s.id]?.text)
    .map(s => `**${AGENTS[s.agent]?.name || s.agent}:**\n${results[s.id].text}`)
    .join('\n\n---\n\n')

  const synthesized = allTexts || 'Nessun risultato dal workflow.'

  // Update workflow stats
  db.prepare(`UPDATE entity SET metadata = json_set(metadata, '$.runs', json_extract(metadata, '$.runs') + 1, '$.last_run', ?), updated_at = datetime('now') WHERE id = ?`).run(
    new Date().toISOString(), workflowId
  )

  // Log execution
  const logId = crypto.randomUUID()
  db.prepare(`INSERT INTO entity (id, azienda_id, type, display_name, slug, stato, parent_id, metadata, path, created_at, updated_at)
    VALUES (?, ?, 'workflow_log', ?, ?, 'completed', ?, ?, ?, datetime('now'), datetime('now'))`).run(
    logId, aziendaId, `Workflow Run`, logId, workflowId,
    JSON.stringify({ steps_completed: completed.size, steps_total: steps.length }),
    `/entity/workflow-logs/${logId}`
  )

  return { results, synthesized }
}

/**
 * List workflows
 */
export function listWorkflows(aziendaId: string): any[] {
  const wfs = db.prepare(
    "SELECT id, display_name, stato, metadata, created_at FROM entity WHERE type = 'workflow' AND azienda_id = ? ORDER BY created_at DESC"
  ).all(aziendaId) as any[]

  return wfs.map(w => {
    const m = typeof w.metadata === 'string' ? JSON.parse(w.metadata) : w.metadata
    return {
      id: w.id,
      name: w.display_name,
      description: m.description,
      steps: m.steps?.length || 0,
      runs: m.runs || 0,
      last_run: m.last_run,
      created_at: w.created_at,
    }
  })
}

/**
 * Register the workflow job handler. Called once at startup.
 */
export function initWorkflows(): void {
  registerJobHandler('run_workflow', async (params, _jobId, aziendaId) => {
    const { workflowId } = params
    if (!workflowId) throw new Error('workflowId required')
    return runWorkflow(workflowId, aziendaId)
  })
}
