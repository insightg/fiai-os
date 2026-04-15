/**
 * Planning Plugin — Transport planning tools via VPN proxy
 *
 * Provides 19 tools for trip management, driver assignment,
 * GPS tracking, optimization, and EU 561 compliance.
 */

import type { PluginDefinition, PluginToolDefinition } from '../types.js'
import { planningCall, planningHealth } from './proxy.js'

// ── Endpoint mapping ────────────────────────────────────

const ENDPOINT_MAP: Record<string, string> = {
  planning_viaggi: 'viaggi', planning_suggerisci: 'suggerisci', planning_assegna: 'assegna',
  planning_autisti: 'autisti', planning_semirimorchi: 'semirimorchi', planning_gps: 'gps',
  planning_distanza: 'distanza', planning_statistiche: 'statistiche', planning_confronta: 'confronta',
  planning_scenario: 'scenario', planning_eta: 'eta', planning_conflitti: 'conflitti',
  planning_storico: 'storico', planning_dettaglio: 'dettaglio', planning_analizza: 'analizza',
  planning_pianificazione_corrente: 'pianificazione_corrente', planning_cerca_autista: 'cerca_autista',
}

// ── Generic executor for most planning tools ────────────

async function genericPlanningExecutor(name: string, input: Record<string, unknown>): Promise<unknown> {
  // Safety: if LLM passed a string instead of object, wrap it
  if (typeof input === 'string') {
    const key = name === 'planning_eta' ? 'nome_autista' : name === 'planning_gps' ? 'targa' : name === 'planning_cerca_autista' ? 'nome' : 'data'
    return planningCall(ENDPOINT_MAP[name] || name.replace('planning_', ''), { [key]: input })
  }
  return planningCall(ENDPOINT_MAP[name] || name.replace('planning_', ''), input)
}

// ── Tool definitions ────────────────────────────────────

const tools: PluginToolDefinition[] = [
  {
    name: 'planning_health',
    description: 'Verifica connessione al planner trasporti (richiede VPN)',
    parameters: { type: 'object', properties: {} },
    permission: 'read',
    execute: async () => planningHealth(),
  },
  {
    name: 'planning_viaggi',
    description: 'Lista viaggi per una data. Ritorna {viaggi: [{bg, cliente, luogo_carico, luogo_scarico, data_carico, data_scarico, genere, targa, vettore, e_assegnato}], totale, assegnati, non_assegnati}',
    parameters: { type: 'object', properties: { data: { type: 'string', description: 'Data YYYY-MM-DD' }, solo_non_assegnati: { type: 'boolean', description: 'Solo non assegnati' } }, required: ['data'] },
    permission: 'read',
    execute: async (input) => genericPlanningExecutor('planning_viaggi', input),
  },
  {
    name: 'planning_suggerisci',
    description: 'Esegui ottimizzazione automatica: assegna autisti e semirimorchi ai viaggi con scoring composito',
    parameters: { type: 'object', properties: { data: { type: 'string', description: 'Data YYYY-MM-DD' }, template: { type: 'string', description: 'Template viaggi (opzionale)' } }, required: ['data'] },
    permission: 'create',
    execute: async (input) => genericPlanningExecutor('planning_suggerisci', input),
  },
  {
    name: 'planning_assegna',
    description: 'Assegna manualmente un viaggio a un autista/semirimorchio',
    parameters: { type: 'object', properties: { data: { type: 'string', description: 'Data YYYY-MM-DD' }, codice_viaggio: { type: 'string', description: 'Codice BG del viaggio' }, targa_semirimorchio: { type: 'string', description: 'Targa semirimorchio' }, nome_autista: { type: 'string', description: 'Nome autista' }, note: { type: 'string' } }, required: ['data', 'targa_semirimorchio', 'codice_viaggio'] },
    permission: 'create',
    execute: async (input) => genericPlanningExecutor('planning_assegna', input),
  },
  {
    name: 'planning_autisti',
    description: 'Lista autisti disponibili per una data (esclude assenti/ferie)',
    parameters: { type: 'object', properties: { data: { type: 'string', description: 'Data YYYY-MM-DD' } }, required: ['data'] },
    permission: 'read',
    execute: async (input) => genericPlanningExecutor('planning_autisti', input),
  },
  {
    name: 'planning_semirimorchi',
    description: 'Lista semirimorchi disponibili, filtrabili per tipo (SILOS, ROTOCELLA, CENTINATO, etc.)',
    parameters: { type: 'object', properties: { data: { type: 'string', description: 'Data YYYY-MM-DD' }, tipo: { type: 'string', description: 'Tipo: SILOS, ROTOCELLA, RIBALTABILE_9M, PORTACTR_9M, PORTACTR_13_6M, CENTINATO' } }, required: ['data'] },
    permission: 'read',
    execute: async (input) => genericPlanningExecutor('planning_semirimorchi', input),
  },
  {
    name: 'planning_gps',
    description: 'Posizione GPS in tempo reale di un semirimorchio',
    parameters: { type: 'object', properties: { targa: { type: 'string', description: 'Targa semirimorchio' } }, required: ['targa'] },
    permission: 'read',
    execute: async (input) => genericPlanningExecutor('planning_gps', input),
  },
  {
    name: 'planning_distanza',
    description: 'Calcola distanza stradale tra due localita',
    parameters: { type: 'object', properties: { origine: { type: 'string', description: 'Localita partenza' }, destinazione: { type: 'string', description: 'Localita arrivo' } }, required: ['origine', 'destinazione'] },
    permission: 'read',
    execute: async (input) => genericPlanningExecutor('planning_distanza', input),
  },
  {
    name: 'planning_statistiche',
    description: 'Statistiche viaggi per periodo (per cliente, destinazione, autista)',
    parameters: { type: 'object', properties: { data_inizio: { type: 'string' }, data_fine: { type: 'string' }, gruppo_per: { type: 'string', description: 'cliente, destinazione, autista, vettore' } }, required: ['data_inizio', 'data_fine'] },
    permission: 'read',
    execute: async (input) => genericPlanningExecutor('planning_statistiche', input),
  },
  {
    name: 'planning_confronta',
    description: 'Confronta piano proposto vs assegnazioni effettive per una data',
    parameters: { type: 'object', properties: { data: { type: 'string' } }, required: ['data'] },
    permission: 'read',
    execute: async (input) => genericPlanningExecutor('planning_confronta', input),
  },
  {
    name: 'planning_scenario',
    description: 'Simulazione what-if: ricalcola con vincoli diversi',
    parameters: { type: 'object', properties: { data: { type: 'string' }, escludi_autisti: { type: 'array', items: { type: 'string' }, description: 'Nomi autisti da escludere' }, escludi_targhe: { type: 'array', items: { type: 'string' } }, max_distanza_km: { type: 'number' }, bg_fissi: { type: 'array', items: { type: 'string' }, description: 'BG da mantenere assegnati' } }, required: ['data'] },
    permission: 'read',
    execute: async (input) => genericPlanningExecutor('planning_scenario', input),
  },
  {
    name: 'planning_eta',
    description: 'Calcola ETA di un autista in viaggio — cerca per nome, trova BG e targa automaticamente',
    parameters: { type: 'object', properties: { nome_autista: { type: 'string', description: 'Nome autista (anche parziale)' }, data: { type: 'string', description: 'Data YYYY-MM-DD (default oggi)' } }, required: ['nome_autista'] },
    permission: 'read',
    execute: async (input) => genericPlanningExecutor('planning_eta', input),
  },
  {
    name: 'planning_conflitti',
    description: 'Mostra conflitti di risorse (autisti/semirimorchi doppiamente assegnati)',
    parameters: { type: 'object', properties: { data: { type: 'string' } }, required: ['data'] },
    permission: 'read',
    execute: async (input) => genericPlanningExecutor('planning_conflitti', input),
  },
  {
    name: 'planning_storico',
    description: 'Cerca precedenti storici simili (RAG) per cliente/destinazione',
    parameters: { type: 'object', properties: { cliente: { type: 'string', description: 'Nome cliente' }, destinazione: { type: 'string', description: 'Localita destinazione' }, genere: { type: 'string', description: 'Genere merce' } }, required: ['cliente'] },
    permission: 'read',
    execute: async (input) => genericPlanningExecutor('planning_storico', input),
  },
  {
    name: 'planning_dettaglio',
    description: 'Dettaglio completo di un viaggio',
    parameters: { type: 'object', properties: { codice_bg: { type: 'string', description: 'Codice BG del viaggio' }, data: { type: 'string', description: 'Data YYYY-MM-DD' } }, required: ['codice_bg', 'data'] },
    permission: 'read',
    execute: async (input) => genericPlanningExecutor('planning_dettaglio', input),
  },
  {
    name: 'planning_analizza',
    description: 'Diagnostica perche un viaggio non e stato assegnato',
    parameters: { type: 'object', properties: { codice_bg: { type: 'string', description: 'Codice BG' }, data: { type: 'string', description: 'Data YYYY-MM-DD' } }, required: ['codice_bg', 'data'] },
    permission: 'read',
    execute: async (input) => genericPlanningExecutor('planning_analizza', input),
  },
  {
    name: 'planning_pianificazione_corrente',
    description: 'Assegnazioni correnti per una data',
    parameters: { type: 'object', properties: { data: { type: 'string' } }, required: ['data'] },
    permission: 'read',
    execute: async (input) => genericPlanningExecutor('planning_pianificazione_corrente', input),
  },
  {
    name: 'planning_cerca_autista',
    description: 'Cerca autista per nome — restituisce posizione, impegni, skill',
    parameters: { type: 'object', properties: { nome: { type: 'string' } }, required: ['nome'] },
    permission: 'read',
    execute: async (input) => genericPlanningExecutor('planning_cerca_autista', input),
  },
  {
    name: 'planning_tutti_autisti',
    description: 'Lista COMPLETA autisti interni e trazionisti',
    parameters: { type: 'object', properties: {} },
    permission: 'read',
    execute: async () => planningCall('execute', { tool: 'get_tutti_autisti', args: {} }),
  },
]

// ── Plugin export ───────────────────────────────────────

const plugin: PluginDefinition = {
  name: 'planning',
  description: 'Pianificazione trasporti — gestione viaggi, autisti, semirimorchi, GPS, ottimizzazione',
  tools,
  settings: [
    {
      key: 'planning_api_url',
      category: 'planning',
      envVar: 'PLANNING_API_URL',
      description: 'URL API planner trasporti (via VPN)',
      sensitive: false,
      defaultValue: 'http://192.168.0.14:8602',
      requiresRestart: false,
    },
  ],
}

export default plugin
