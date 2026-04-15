/**
 * FIAI OS Admin Dashboard — Backend API
 *
 * Manages instances, agents, plugins, and monitoring.
 * Reads/writes instance configs from instances/ directory.
 * Proxies to individual FIAI OS instances for real-time data.
 */

import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

const app = express()
const PORT = parseInt(process.env.ADMIN_PORT || '3002', 10)
const JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'fiai-admin-secret'
const INSTANCES_DIR = process.env.INSTANCES_DIR || path.join(import.meta.dirname, '..', '..', 'instances')
const PLUGINS_DIR = process.env.PLUGINS_DIR || path.join(import.meta.dirname, '..', '..', 'server', 'plugins')

app.use(cors({ origin: true, credentials: true }))
app.use(express.json({ limit: '5mb' }))

// ── Auth ─────────────────────────────────────────────────

interface AdminUser { id: string; email: string; name: string }

// Simple file-based admin users (admin/data/admins.json)
const ADMINS_FILE = path.join(import.meta.dirname, '..', 'data', 'admins.json')

function loadAdmins(): { id: string; email: string; name: string; password_hash: string }[] {
  try {
    if (fs.existsSync(ADMINS_FILE)) return JSON.parse(fs.readFileSync(ADMINS_FILE, 'utf-8'))
  } catch {}
  // Default admin
  const hash = bcrypt.hashSync('admin', 10)
  const admins = [{ id: crypto.randomUUID(), email: 'admin@fiai.it', name: 'Admin', password_hash: hash }]
  fs.mkdirSync(path.dirname(ADMINS_FILE), { recursive: true })
  fs.writeFileSync(ADMINS_FILE, JSON.stringify(admins, null, 2))
  return admins
}

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body
  const admins = loadAdmins()
  const admin = admins.find(a => a.email === email)
  if (!admin || !(await bcrypt.compare(password, admin.password_hash))) {
    res.status(401).json({ error: 'Credenziali non valide' }); return
  }
  const token = jwt.sign({ id: admin.id, email: admin.email }, JWT_SECRET, { expiresIn: '24h' })
  res.json({ token, user: { id: admin.id, email: admin.email, name: admin.name } })
})

function authMiddleware(req: any, res: any, next: any) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) { res.status(401).json({ error: 'Token mancante' }); return }
  try {
    req.user = jwt.verify(token, JWT_SECRET) as AdminUser
    next()
  } catch { res.status(401).json({ error: 'Token non valido' }); return }
}

app.use('/api', (req, res, next) => {
  if (req.path === '/auth/login' || req.path === '/health') return next()
  authMiddleware(req, res, next)
})

// ── Instance Registry (remote instances) ────────────────

const REGISTRY_FILE = path.join(import.meta.dirname, '..', 'data', 'instances-registry.yaml')

interface RegistryEntry {
  id: string; name?: string; url: string; api_key?: string
  location: 'local' | 'remote'; server_ip?: string; ssh_user?: string; notes?: string
}

function loadRegistry(): RegistryEntry[] {
  try {
    if (fs.existsSync(REGISTRY_FILE)) {
      const data = yaml.load(fs.readFileSync(REGISTRY_FILE, 'utf-8')) as any
      return data?.instances || []
    }
  } catch {}
  return []
}

function saveRegistry(entries: RegistryEntry[]): void {
  fs.mkdirSync(path.dirname(REGISTRY_FILE), { recursive: true })
  fs.writeFileSync(REGISTRY_FILE, yaml.dump({ instances: entries }, { lineWidth: 120 }))
}

// ── Instances CRUD ──────────────────────────────────────

app.get('/api/instances', (_req, res) => {
  try {
    const entries = fs.readdirSync(INSTANCES_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory())

    const instances = entries.map(e => {
      const configPath = path.join(INSTANCES_DIR, e.name, 'config.yaml')
      const configYml = path.join(INSTANCES_DIR, e.name, 'config.yml')
      const cfgPath = fs.existsSync(configPath) ? configPath : fs.existsSync(configYml) ? configYml : null

      let config: any = null
      if (cfgPath) {
        try { config = yaml.load(fs.readFileSync(cfgPath, 'utf-8')) } catch {}
      }

      const agentsDir = path.join(INSTANCES_DIR, e.name, 'agents')
      const agentCount = fs.existsSync(agentsDir)
        ? fs.readdirSync(agentsDir).filter(f => f.endsWith('.md')).length
        : 0

      return {
        id: e.name,
        name: config?.company?.name || e.name,
        short_name: config?.company?.short_name || e.name,
        color: config?.company?.color || '#607D8B',
        agent_count: config?.agents?.length || agentCount,
        plugins: config?.plugins ? Object.keys(config.plugins) : [],
        has_config: !!cfgPath,
      }
    })

    // Merge registry info (url, location, server_ip)
    const registry = loadRegistry()
    const enriched = instances.map(inst => {
      const reg = registry.find(r => r.id === inst.id)
      return { ...inst, url: reg?.url || '', location: reg?.location || 'local', server_ip: reg?.server_ip || '', notes: reg?.notes || '' }
    })

    // Add remote-only instances (in registry but no local config)
    for (const reg of registry) {
      if (!enriched.find(i => i.id === reg.id)) {
        enriched.push({
          id: reg.id, name: reg.name || reg.id, short_name: reg.id.toUpperCase(),
          color: '#607D8B', agent_count: 0, plugins: [], has_config: false,
          url: reg.url, location: reg.location, server_ip: reg.server_ip || '', notes: reg.notes || '',
        })
      }
    }

    res.json(enriched)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── Remote Instance Health Check ────────────────────────

app.get('/api/instances/:id/health', async (req, res) => {
  const registry = loadRegistry()
  const reg = registry.find(r => r.id === req.params.id)

  if (!reg?.url) {
    // Local instance — check Docker container
    try {
      const result = await fetch(`http://${req.params.id}-backend:3001/api/health`, { signal: AbortSignal.timeout(5000) })
      res.json(await result.json())
    } catch {
      res.json({ status: 'unreachable', error: 'Container not running or not accessible' })
    }
    return
  }

  // Remote instance — call via URL
  try {
    const headers: Record<string, string> = {}
    if (reg.api_key) headers['Authorization'] = `Bearer ${reg.api_key}`
    const result = await fetch(`${reg.url}/api/health`, { headers, signal: AbortSignal.timeout(10000) })
    const data = await result.json()
    res.json({ ...data, location: reg.location, url: reg.url })
  } catch (err: any) {
    res.json({ status: 'unreachable', error: err.message, location: reg.location, url: reg.url })
  }
})

// ── Remote Instance Stats (proxy to instance admin API) ─

app.get('/api/instances/:id/stats', async (req, res) => {
  const registry = loadRegistry()
  const reg = registry.find(r => r.id === req.params.id)
  if (!reg?.url) { res.json({}); return }

  try {
    const headers: Record<string, string> = {}
    if (reg.api_key) headers['Authorization'] = `Bearer ${reg.api_key}`
    const result = await fetch(`${reg.url}/api/admin/system`, { headers, signal: AbortSignal.timeout(10000) })
    res.json(await result.json())
  } catch (err: any) {
    res.json({ error: err.message })
  }
})

// ── Registry CRUD ───────────────────────────────────────

app.get('/api/registry', (_req, res) => { res.json(loadRegistry()) })

app.put('/api/registry', (req, res) => {
  const { instances } = req.body
  if (!Array.isArray(instances)) { res.status(400).json({ error: 'instances array required' }); return }
  saveRegistry(instances)
  res.json({ successo: true })
})

app.put('/api/registry/:id', (req, res) => {
  const registry = loadRegistry()
  const idx = registry.findIndex(r => r.id === req.params.id)
  if (idx === -1) {
    registry.push({ id: req.params.id, ...req.body })
  } else {
    registry[idx] = { ...registry[idx], ...req.body }
  }
  saveRegistry(registry)
  res.json({ successo: true })
})

app.get('/api/instances/:id', (req, res) => {
  const instanceDir = path.join(INSTANCES_DIR, req.params.id)
  if (!fs.existsSync(instanceDir)) { res.status(404).json({ error: 'Istanza non trovata' }); return }

  const configPath = path.join(instanceDir, 'config.yaml')
  const configYml = path.join(instanceDir, 'config.yml')
  const cfgPath = fs.existsSync(configPath) ? configPath : fs.existsSync(configYml) ? configYml : null

  let config: any = {}
  let rawYaml = ''
  if (cfgPath) {
    rawYaml = fs.readFileSync(cfgPath, 'utf-8')
    config = yaml.load(rawYaml)
  }

  // Load agent prompts
  const agentsDir = path.join(instanceDir, 'agents')
  const agentFiles: Record<string, string> = {}
  if (fs.existsSync(agentsDir)) {
    for (const f of fs.readdirSync(agentsDir).filter(f => f.endsWith('.md'))) {
      agentFiles[f.replace('.md', '')] = fs.readFileSync(path.join(agentsDir, f), 'utf-8')
    }
  }

  res.json({ id: req.params.id, config, rawYaml, agentFiles })
})

app.post('/api/instances', (req, res) => {
  const { id, company_name, company_color, template } = req.body
  if (!id || !/^[a-z0-9-]+$/.test(id)) { res.status(400).json({ error: 'ID deve essere lowercase alfanumerico' }); return }

  const instanceDir = path.join(INSTANCES_DIR, id)
  if (fs.existsSync(instanceDir)) { res.status(400).json({ error: 'Istanza gia\' esistente' }); return }

  // Create from template or blank
  fs.mkdirSync(path.join(instanceDir, 'agents'), { recursive: true })

  let templateConfig: any = null
  if (template && template !== 'blank') {
    const templateDir = path.join(INSTANCES_DIR, template)
    if (fs.existsSync(templateDir)) {
      // Copy config + agents from template
      const cfgPath = path.join(templateDir, 'config.yaml')
      if (fs.existsSync(cfgPath)) {
        templateConfig = yaml.load(fs.readFileSync(cfgPath, 'utf-8')) as any
      }
      // Copy agent prompts
      const agentsDir = path.join(templateDir, 'agents')
      if (fs.existsSync(agentsDir)) {
        for (const f of fs.readdirSync(agentsDir)) {
          fs.copyFileSync(path.join(agentsDir, f), path.join(instanceDir, 'agents', f))
        }
      }
    }
  }

  // Build config
  const config = templateConfig || {
    company: { name: company_name || id, short_name: id.toUpperCase(), color: company_color || '#607D8B' },
    agents: [],
    plugins: {},
  }
  config.company.name = company_name || config.company.name
  config.company.color = company_color || config.company.color

  fs.writeFileSync(path.join(instanceDir, 'config.yaml'), yaml.dump(config, { lineWidth: 120 }))

  res.json({ id, message: 'Istanza creata' })
})

app.put('/api/instances/:id/config', (req, res) => {
  const instanceDir = path.join(INSTANCES_DIR, req.params.id)
  if (!fs.existsSync(instanceDir)) { res.status(404).json({ error: 'Istanza non trovata' }); return }

  const { config, rawYaml } = req.body

  if (rawYaml) {
    // Raw YAML mode — validate and write
    try { yaml.load(rawYaml) } catch (e) { res.status(400).json({ error: 'YAML non valido: ' + (e as Error).message }); return }
    fs.writeFileSync(path.join(instanceDir, 'config.yaml'), rawYaml)
  } else if (config) {
    fs.writeFileSync(path.join(instanceDir, 'config.yaml'), yaml.dump(config, { lineWidth: 120 }))
  }

  res.json({ successo: true })
})

app.delete('/api/instances/:id', (req, res) => {
  const instanceDir = path.join(INSTANCES_DIR, req.params.id)
  if (!fs.existsSync(instanceDir)) { res.status(404).json({ error: 'Istanza non trovata' }); return }
  if (req.params.id === 'fiai') { res.status(400).json({ error: 'Non puoi eliminare l\'istanza FIAI di base' }); return }

  fs.rmSync(instanceDir, { recursive: true })
  res.json({ successo: true })
})

// ── Agents CRUD per Instance ────────────────────────────

app.get('/api/instances/:id/agents', (req, res) => {
  const instanceDir = path.join(INSTANCES_DIR, req.params.id)
  const configPath = path.join(instanceDir, 'config.yaml')
  if (!fs.existsSync(configPath)) { res.json([]); return }

  const config = yaml.load(fs.readFileSync(configPath, 'utf-8')) as any
  const agentsDir = path.join(instanceDir, 'agents')

  const agents = (config.agents || []).map((a: any) => {
    let promptPreview = ''
    if (a.prompt?.endsWith('.md')) {
      const promptPath = path.join(instanceDir, a.prompt)
      if (fs.existsSync(promptPath)) {
        const full = fs.readFileSync(promptPath, 'utf-8')
        promptPreview = full.substring(0, 200)
      }
    }
    return { ...a, promptPreview, promptLength: promptPreview.length }
  })

  res.json(agents)
})

app.get('/api/instances/:id/agents/:domain', (req, res) => {
  const instanceDir = path.join(INSTANCES_DIR, req.params.id)
  const configPath = path.join(instanceDir, 'config.yaml')
  if (!fs.existsSync(configPath)) { res.status(404).json({ error: 'Config non trovata' }); return }

  const config = yaml.load(fs.readFileSync(configPath, 'utf-8')) as any
  const agentDef = (config.agents || []).find((a: any) => a.domain === req.params.domain)
  if (!agentDef) { res.status(404).json({ error: 'Agente non trovato' }); return }

  let prompt = ''
  if (agentDef.prompt?.endsWith('.md')) {
    const promptPath = path.join(instanceDir, agentDef.prompt)
    if (fs.existsSync(promptPath)) prompt = fs.readFileSync(promptPath, 'utf-8')
  } else {
    prompt = agentDef.prompt || ''
  }

  res.json({ ...agentDef, prompt })
})

app.put('/api/instances/:id/agents/:domain', (req, res) => {
  const instanceDir = path.join(INSTANCES_DIR, req.params.id)
  const configPath = path.join(instanceDir, 'config.yaml')
  if (!fs.existsSync(configPath)) { res.status(404).json({ error: 'Config non trovata' }); return }

  const config = yaml.load(fs.readFileSync(configPath, 'utf-8')) as any
  const { name, color, model, tools, prompt } = req.body
  const domain = req.params.domain

  // Find or create agent entry
  let agentIdx = (config.agents || []).findIndex((a: any) => a.domain === domain)
  if (agentIdx === -1) {
    config.agents = config.agents || []
    config.agents.push({ domain, name: name || domain, color: color || '#607D8B', prompt: `agents/${domain}.md`, tools: tools || ['generic'] })
    agentIdx = config.agents.length - 1
  }

  // Update fields
  if (name) config.agents[agentIdx].name = name
  if (color) config.agents[agentIdx].color = color
  if (model !== undefined) config.agents[agentIdx].model = model || undefined
  if (tools) config.agents[agentIdx].tools = tools

  // Save config
  fs.writeFileSync(configPath, yaml.dump(config, { lineWidth: 120 }))

  // Save prompt if provided
  if (prompt !== undefined) {
    const promptFile = config.agents[agentIdx].prompt || `agents/${domain}.md`
    const promptPath = path.join(instanceDir, promptFile)
    fs.mkdirSync(path.dirname(promptPath), { recursive: true })
    fs.writeFileSync(promptPath, prompt)
  }

  res.json({ successo: true })
})

app.delete('/api/instances/:id/agents/:domain', (req, res) => {
  const instanceDir = path.join(INSTANCES_DIR, req.params.id)
  const configPath = path.join(instanceDir, 'config.yaml')
  if (!fs.existsSync(configPath)) { res.status(404).json({ error: 'Config non trovata' }); return }

  const config = yaml.load(fs.readFileSync(configPath, 'utf-8')) as any
  config.agents = (config.agents || []).filter((a: any) => a.domain !== req.params.domain)
  fs.writeFileSync(configPath, yaml.dump(config, { lineWidth: 120 }))

  // Optionally delete prompt file
  const promptFile = path.join(instanceDir, 'agents', `${req.params.domain}.md`)
  if (fs.existsSync(promptFile)) fs.unlinkSync(promptFile)

  res.json({ successo: true })
})

// ── Plugins ─────────────────────────────────────────────

app.get('/api/plugins', (_req, res) => {
  try {
    const entries = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory() && e.name !== 'types.ts')

    const plugins = entries.map(e => {
      let description = ''
      let toolCount = 0
      try {
        // Try to read plugin metadata from a manifest or index
        const indexPath = path.join(PLUGINS_DIR, e.name, 'index.ts')
        if (fs.existsSync(indexPath)) {
          const content = fs.readFileSync(indexPath, 'utf-8')
          const descMatch = content.match(/description:\s*['"](.+?)['"]/)
          if (descMatch) description = descMatch[1]
          const toolMatches = content.match(/name:\s*['"]/g)
          if (toolMatches) toolCount = toolMatches.length
        }
      } catch {}
      return { name: e.name, description, toolCount }
    })

    res.json(plugins)
  } catch { res.json([]) }
})

// ── Available Tools (for agent editor) ──────────────────

app.get('/api/tools', (_req, res) => {
  // Read tool definitions from tool-registry.ts
  try {
    const registryPath = path.join(import.meta.dirname, '..', '..', 'server', 'agents', 'tool-registry.ts')
    const content = fs.readFileSync(registryPath, 'utf-8')

    // Extract tool names from TOOL_DEFINITIONS
    const toolNames: string[] = []
    const nameMatches = content.matchAll(/^\s+(\w+):\s*\{\s*type:\s*'function'/gm)
    for (const m of nameMatches) toolNames.push(m[1])

    // Also get plugin tool names
    const pluginTools: string[] = []
    const entries = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true }).filter(e => e.isDirectory())
    for (const e of entries) {
      const indexPath = path.join(PLUGINS_DIR, e.name, 'index.ts')
      if (fs.existsSync(indexPath)) {
        const pc = fs.readFileSync(indexPath, 'utf-8')
        const ptMatches = pc.matchAll(/name:\s*'(\w+)'/g)
        for (const m of ptMatches) pluginTools.push(m[1])
      }
    }

    res.json({
      core: toolNames,
      plugins: pluginTools,
      wildcards: ['generic', 'planning_*', 'send_whatsapp_*'],
    })
  } catch (err) {
    res.json({ core: [], plugins: [], wildcards: [] })
  }
})

// ── Health / Status ─────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    instancesDir: INSTANCES_DIR,
    instanceCount: fs.existsSync(INSTANCES_DIR) ? fs.readdirSync(INSTANCES_DIR, { withFileTypes: true }).filter(e => e.isDirectory()).length : 0,
  })
})

// ── Start ───────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`FIAI OS Admin Dashboard running on http://localhost:${PORT}`)
  console.log(`Instances directory: ${INSTANCES_DIR}`)
  console.log(`Plugins directory: ${PLUGINS_DIR}`)
})
