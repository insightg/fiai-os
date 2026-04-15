/**
 * FIAI OS Plugin Loader
 *
 * Discovers and loads plugins from the plugins/ directory.
 * Each plugin exports a PluginDefinition with tools, settings, routes, and startup hooks.
 *
 * Plugins are loaded dynamically at startup. The tool-registry calls registerPluginTools()
 * to merge plugin tools into the global TOOL_DEFINITIONS and executors.
 */

import fs from 'fs'
import path from 'path'
import type { PluginDefinition, PluginToolDefinition, PluginToolContext } from './types.js'
import db from '../db.js'
import { getSetting, SETTINGS_REGISTRY, type SettingDef } from '../settings.js'

// ── Loaded plugins registry ─────────────────────────────

const loadedPlugins = new Map<string, PluginDefinition>()
const pluginExecutors = new Map<string, PluginToolDefinition['execute']>()
const pluginPermissions = new Map<string, string>()

// ── Plugin Discovery & Loading ──────────────────────────

export async function loadPlugins(pluginsDir?: string): Promise<void> {
  const dir = pluginsDir || path.join(import.meta.dirname, '..', 'plugins')

  if (!fs.existsSync(dir)) {
    console.log('[Plugins] No plugins directory found, skipping')
    return
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name !== 'types.ts' && !e.name.startsWith('.'))

  for (const entry of entries) {
    const pluginDir = path.join(dir, entry.name)
    const indexPath = path.join(pluginDir, 'index.ts')
    const indexJsPath = path.join(pluginDir, 'index.js')

    const modulePath = fs.existsSync(indexPath) ? indexPath :
                       fs.existsSync(indexJsPath) ? indexJsPath : null

    if (!modulePath) {
      console.warn(`[Plugins] Skipping ${entry.name}: no index.ts or index.js found`)
      continue
    }

    try {
      const mod = await import(modulePath)
      const plugin: PluginDefinition = mod.default || mod

      if (!plugin.name || !plugin.tools) {
        console.warn(`[Plugins] Skipping ${entry.name}: missing name or tools`)
        continue
      }

      // Register plugin
      loadedPlugins.set(plugin.name, plugin)

      // Register tool executors
      for (const tool of plugin.tools) {
        pluginExecutors.set(tool.name, tool.execute)
        pluginPermissions.set(tool.name, tool.permission)
      }

      // Register settings
      if (plugin.settings) {
        for (const setting of plugin.settings) {
          // Add to global settings registry (if not already there)
          if (!SETTINGS_REGISTRY.find(s => s.key === setting.key)) {
            SETTINGS_REGISTRY.push(setting)
          }
        }
      }

      console.log(`[Plugins] Loaded "${plugin.name}": ${plugin.tools.length} tools${plugin.settings ? `, ${plugin.settings.length} settings` : ''}${plugin.router ? ', routes' : ''}${plugin.startup ? ', startup hook' : ''}`)
    } catch (err) {
      console.error(`[Plugins] Failed to load ${entry.name}:`, (err as Error).message)
    }
  }

  console.log(`[Plugins] ${loadedPlugins.size} plugins loaded, ${pluginExecutors.size} tools registered`)
}

// ── Tool Integration ────────────────────────────────────

/**
 * Get OpenAI-format tool definitions for all plugin tools.
 * Called by tool-registry to merge into TOOL_DEFINITIONS.
 */
export function getPluginToolDefinitions(): Record<string, any> {
  const defs: Record<string, any> = {}

  for (const plugin of loadedPlugins.values()) {
    for (const tool of plugin.tools) {
      defs[tool.name] = {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }
    }
  }

  return defs
}

/**
 * Get permission actions for all plugin tools.
 */
export function getPluginToolPermissions(): Record<string, string> {
  return Object.fromEntries(pluginPermissions)
}

/**
 * Execute a plugin tool by name.
 * Returns null if the tool is not a plugin tool (fall through to built-in executor).
 */
export async function executePluginTool(
  name: string,
  aziendaId: string,
  input: Record<string, unknown>
): Promise<{ handled: true; result: unknown } | { handled: false }> {
  const executor = pluginExecutors.get(name)
  if (!executor) return { handled: false }

  const context: PluginToolContext = {
    aziendaId,
    db,
    getSetting,
  }

  const result = await executor(input, context)
  return { handled: true, result }
}

// ── Express Routes ──────────────────────────────────────

import type { Express } from 'express'

/**
 * Mount plugin Express routes on the app.
 */
export function mountPluginRoutes(app: Express): void {
  for (const plugin of loadedPlugins.values()) {
    if (plugin.router) {
      const mountPath = `/api/plugins/${plugin.name}`
      app.use(mountPath, plugin.router)
      console.log(`[Plugins] Mounted routes for "${plugin.name}" at ${mountPath}`)
    }
  }
}

// ── Lifecycle ───────────────────────────────────────────

/**
 * Run startup hooks for all loaded plugins.
 */
export async function startPlugins(): Promise<void> {
  for (const plugin of loadedPlugins.values()) {
    if (plugin.startup) {
      try {
        await plugin.startup()
        console.log(`[Plugins] Started "${plugin.name}"`)
      } catch (err) {
        console.error(`[Plugins] Startup failed for "${plugin.name}":`, (err as Error).message)
      }
    }
  }
}

/**
 * Run shutdown hooks for all loaded plugins.
 */
export async function stopPlugins(): Promise<void> {
  for (const plugin of loadedPlugins.values()) {
    if (plugin.shutdown) {
      try { await plugin.shutdown() } catch {}
    }
  }
}

// ── Introspection ───────────────────────────────────────

export function getLoadedPlugins(): { name: string; description: string; toolCount: number }[] {
  return Array.from(loadedPlugins.values()).map(p => ({
    name: p.name,
    description: p.description,
    toolCount: p.tools.length,
  }))
}
