/**
 * Planning Plugin — Dynamic tool discovery from remote planner
 *
 * Registers all 24 planner tools with planning_ prefix.
 * On first call, verifies connectivity via lazy discovery.
 * The executor forwards every call to the remote planner's /execute endpoint.
 */

import type { PluginDefinition, PluginToolDefinition } from '../types.js'
import { planningCall, planningHealth, fetchPlannerTools } from './proxy.js'

// ── Lazy discovery (verifies planner is reachable on first use) ──

let discovered = false

async function ensureDiscovery(): Promise<void> {
  if (discovered) return
  try {
    const defs = await fetchPlannerTools()
    console.log(`[Planning] Verified ${defs.length} tools on planner`)
    discovered = true
  } catch (err) {
    console.warn(`[Planning] Planner not yet reachable: ${(err as Error).message}`)
  }
}

// ── All 24 planner tools (names + descriptions from API docs) ──

const PLANNER_TOOLS: { name: string; desc: string; params: any; write?: boolean }[] = [
  { name: 'get_viaggi_da_pianificare', desc: 'Elenco viaggi/ordini da pianificare per una data', params: { type: 'object', properties: { data: { type: 'string', description: 'Data YYYY-MM-DD' }, solo_non_assegnati: { type: 'boolean', description: 'Solo non assegnati', default: false } }, required: ['data'] } },
  { name: 'get_semirimorchi_disponibili', desc: 'Semirimorchi disponibili, filtrabile per tipo (SILOS, ROTOCELLA, etc.)', params: { type: 'object', properties: { data: { type: 'string' }, tipo: { type: 'string', description: 'SILOS, ROTOCELLA, RIBALTABILE_9M, PORTACTR_9M, PORTACTR_13_6M, CENTINATO' } }, required: ['data'] } },
  { name: 'get_autisti_disponibili', desc: 'Autisti disponibili per data (esclude assenti/ferie)', params: { type: 'object', properties: { data: { type: 'string' } }, required: ['data'] } },
  { name: 'get_tutti_autisti', desc: 'Lista COMPLETA autisti interni e trazionisti esterni', params: { type: 'object', properties: { solo_interni: { type: 'boolean', default: false } } } },
  { name: 'get_pianificazione_corrente', desc: 'Pianificazione esistente per data con semirimorchi e autisti assegnati', params: { type: 'object', properties: { data: { type: 'string' } }, required: ['data'] } },
  { name: 'assegna_viaggio', desc: 'Assegna viaggio a semirimorchio e opzionalmente autista', params: { type: 'object', properties: { data: { type: 'string' }, targa_semirimorchio: { type: 'string' }, codice_viaggio: { type: 'string' }, nome_autista: { type: 'string' }, note: { type: 'string' } }, required: ['data', 'targa_semirimorchio', 'codice_viaggio'] }, write: true },
  { name: 'suggerisci_pianificazione', desc: 'Ottimizzazione automatica: assegna autisti e semirimorchi con scoring composito', params: { type: 'object', properties: { data: { type: 'string' } }, required: ['data'] }, write: true },
  { name: 'get_dettaglio_viaggio', desc: 'Dettagli completi di un viaggio specifico', params: { type: 'object', properties: { codice_bg: { type: 'string' }, data: { type: 'string' } }, required: ['codice_bg', 'data'] } },
  { name: 'get_dettaglio_semirimorchio', desc: 'Dettagli di un semirimorchio per targa', params: { type: 'object', properties: { targa: { type: 'string' } }, required: ['targa'] } },
  { name: 'cerca_autista', desc: 'Cerca autista per nome — dati anagrafici e posizione corrente', params: { type: 'object', properties: { nome: { type: 'string' }, data: { type: 'string' } }, required: ['nome'] } },
  { name: 'get_posizione_gps', desc: 'Posizione GPS tempo reale di un semirimorchio (WayTracker)', params: { type: 'object', properties: { targa: { type: 'string' } }, required: ['targa'] } },
  { name: 'get_statistiche_viaggi', desc: 'Statistiche aggregate viaggi per periodo (per cliente, destinazione, autista)', params: { type: 'object', properties: { data_inizio: { type: 'string' }, data_fine: { type: 'string' }, gruppo_per: { type: 'string', description: 'cliente, destinazione, partenza, giorno' } }, required: ['data_inizio', 'data_fine'] } },
  { name: 'calcola_distanza', desc: 'Distanza in km tra due localita\'', params: { type: 'object', properties: { origine: { type: 'string' }, destinazione: { type: 'string' } }, required: ['origine', 'destinazione'] } },
  { name: 'confronta_pianificazione', desc: 'Confronta proposta ottimizzatore vs assegnazioni finali', params: { type: 'object', properties: { data: { type: 'string' } }, required: ['data'] } },
  { name: 'spiega_assegnazione', desc: 'Spiega perche\' l\'ottimizzatore ha scelto questa coppia — candidati e motivi esclusione', params: { type: 'object', properties: { codice_bg: { type: 'string' }, data: { type: 'string' } }, required: ['codice_bg', 'data'] } },
  { name: 'valida_dati', desc: 'Valida dati prima dell\'ottimizzazione — anomalie GPS, impiego, coerenza', params: { type: 'object', properties: { data: { type: 'string' } }, required: ['data'] } },
  { name: 'genera_report', desc: 'Report aggregato pianificazione (giornaliero o settimanale)', params: { type: 'object', properties: { data: { type: 'string' }, tipo: { type: 'string', description: 'giornaliero o settimanale' } }, required: ['data'] } },
  { name: 'analizza_viaggio_non_assegnato', desc: 'Diagnostica perche\' un viaggio non e\' stato assegnato — filtri, swap, risorse', params: { type: 'object', properties: { codice_bg: { type: 'string' }, data: { type: 'string' } }, required: ['codice_bg', 'data'] } },
  { name: 'mostra_conflitti', desc: 'Conflitti di risorse: viaggi che competono per stessa coppia semi/autista', params: { type: 'object', properties: { data: { type: 'string' } }, required: ['data'] } },
  { name: 'ricalcola_scenario', desc: 'Simulazione what-if con vincoli modificati', params: { type: 'object', properties: { data: { type: 'string' }, escludi_autisti: { type: 'array', items: { type: 'string' } }, escludi_targhe: { type: 'array', items: { type: 'string' } }, max_distanza_km: { type: 'number' }, bg_fissi: { type: 'object' } }, required: ['data'] } },
  { name: 'get_contesto_storico', desc: 'Precedenti storici simili (RAG) per cliente/destinazione', params: { type: 'object', properties: { cliente: { type: 'string' }, destinazione: { type: 'string' }, genere: { type: 'string' } }, required: ['cliente'] } },
  { name: 'cerca_bg_da_targa', desc: 'Cerca BG associato a semirimorchio per data', params: { type: 'object', properties: { targa: { type: 'string' }, data: { type: 'string' } }, required: ['targa', 'data'] } },
  { name: 'get_eta_per_autista', desc: 'ETA di un autista cercando per nome — trova BG e targa automaticamente', params: { type: 'object', properties: { nome_autista: { type: 'string' }, data: { type: 'string' } }, required: ['nome_autista'] } },
  { name: 'calcola_eta_autista', desc: 'ETA dato BG e targa — cascata GPS, Mission API, DataS', params: { type: 'object', properties: { bg: { type: 'string' }, targa: { type: 'string' }, luogo_scarico: { type: 'string' }, data_scarico: { type: 'string' } }, required: ['bg', 'targa'] } },
  { name: 'localizza_entita', desc: 'Localizza un\'entita\' (autista, semirimorchio, cliente) con posizione GPS reale, planning corrente e stato. Restituisce coordinate, indirizzo, fonte GPS, eta\' del dato, velocita\', warning su assegnazioni multiple.', params: { type: 'object', properties: { tipo: { type: 'string', description: 'Tipo entita\': autista, semirimorchio, cliente' }, identificativo: { type: 'string', description: 'Nome autista, targa semirimorchio, o nome cliente' } }, required: ['tipo', 'identificativo'] } },
]

// ── Build tool list ─────────────────────────────────────

const tools: PluginToolDefinition[] = [
  {
    name: 'planning_health',
    description: 'Verifica connessione al planner trasporti e lista tool disponibili',
    parameters: { type: 'object', properties: {} },
    permission: 'read',
    execute: async () => {
      const health = await planningHealth()
      await ensureDiscovery()
      return { ...health, discovered }
    },
  },
]

for (const t of PLANNER_TOOLS) {
  tools.push({
    name: `planning_${t.name}`,
    description: t.desc,
    parameters: t.params,
    permission: t.write ? 'create' : 'read',
    execute: async (input) => {
      await ensureDiscovery()
      return planningCall('execute', { tool: t.name, args: input })
    },
  })
}

const plugin: PluginDefinition = {
  name: 'planning',
  description: `Pianificazione trasporti — ${PLANNER_TOOLS.length} tool + health check, discovery lazy dal planner remoto`,
  tools,
  settings: [{
    key: 'planning_api_url',
    category: 'planning',
    envVar: 'PLANNING_API_URL',
    description: 'URL API planner trasporti (via VPN)',
    sensitive: false,
    defaultValue: 'http://192.168.0.14:8602',
    requiresRestart: false,
  }],
}

export default plugin
