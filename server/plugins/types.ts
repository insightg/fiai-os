/**
 * FIAI OS Plugin System — Type Definitions
 *
 * A plugin is a directory in plugins/ with an index.ts that exports a PluginDefinition.
 * Plugins can provide: tools, settings, Express routes, and startup hooks.
 */

import type { Router } from 'express'

export interface PluginToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  /** Permission action required to use this tool: 'read', 'create', 'update', 'delete', 'send' */
  permission: 'read' | 'create' | 'update' | 'delete' | 'send'
  /** Tool executor function */
  execute: (input: Record<string, unknown>, context: PluginToolContext) => Promise<unknown>
}

export interface PluginToolContext {
  aziendaId: string
  userId?: string
  db: any  // better-sqlite3 Database
  getSetting: (key: string) => string
}

export interface PluginSettingDefinition {
  key: string
  category: string
  envVar: string
  description: string
  sensitive: boolean
  defaultValue: string
  requiresRestart: boolean
}

export interface PluginDefinition {
  /** Unique plugin name (matches directory name) */
  name: string
  /** Human-readable description */
  description: string
  /** Tool definitions provided by this plugin */
  tools: PluginToolDefinition[]
  /** Settings this plugin needs */
  settings?: PluginSettingDefinition[]
  /** Express router for custom API routes (mounted at /api/plugins/{name}/) */
  router?: Router
  /** Called once on startup — use for connections, auto-connect, etc. */
  startup?: () => Promise<void>
  /** Called on shutdown */
  shutdown?: () => Promise<void>
}
