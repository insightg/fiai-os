/**
 * Light Planner Plugin — Direct SQL access to BERLINK and TIR databases
 *
 * Bypasses the ai-planner Python service. The LLM agent writes SQL queries
 * and executes them directly on the BERLINK (.12:9095) and TIR (.12:9090)
 * databases via the API proxy on .14:8603.
 *
 * Two tools:
 * - berlink_query: SQL on BERLINK (fleet, employees, planning, GPS)
 * - tir_query: SQL on TIR (trips, orders, costs)
 */

import type { PluginDefinition, PluginToolDefinition } from '../types.js'
import { getSetting } from '../../settings.js'

const PROXY_URL_DEFAULT = 'http://192.168.0.14:8603'

function getProxyUrl(): string {
  return getSetting('light_planner_proxy_url') || PROXY_URL_DEFAULT
}

async function executeQuery(db: 'berlink' | 'tir', query: string): Promise<any> {
  const url = `${getProxyUrl()}/${db}/api/Query/execute`

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(30000),
    })

    if (!res.ok) {
      const err = await res.text().catch(() => '')
      return { errore: `Query error ${res.status}: ${err.substring(0, 200)}` }
    }

    const data = await res.json()
    return {
      righe: data.rowCount || data.data?.length || 0,
      colonne: data.columns?.map((c: any) => c.name) || [],
      dati: data.data || [],
      tempo_ms: data.executionTimeMs,
    }
  } catch (err: any) {
    if (err.name === 'TimeoutError') return { errore: 'Timeout query (30s)' }
    return { errore: `Proxy non raggiungibile: ${err.message}. Verificare VPN.` }
  }
}

const tools: PluginToolDefinition[] = [
  {
    name: 'berlink_query',
    description: `Esegui una query SQL sul database BERLINK (PostgreSQL).
Tabelle principali (schema public):
- emp_employees: dipendenti/autisti (id_employee, name, surname, flag_driver, flag_external_driver, flag_carrier)
- flt_trailers: semirimorchi (id_trailer, plate, id_trailer_type, id_vehicle_status)
- flt_vehicles: veicoli (id_vehicle, plate, id_vehicle_type, id_vehicle_status)
- pl_trailer_planning: pianificazione giornaliera (id_trailer, id_employee, planning, planning_date, note, info_maintenance)
- pl_planning_missions: missioni pianificate
- evt_unit_last_position: ultima posizione GPS (unit_code, latitude, longitude, address, speed, timestamp)
- gb_customers: clienti
- tfp_drivers: autisti trazionisti esterni
- tfp_units: unita' trazionisti
- c_trailer_types: tipi semirimorchio
- c_vehicle_status: stati veicolo
- emp_driver_skills: skill autisti

Date: formato 'YYYY-MM-DD'. Per filtro data planning: WHERE planning_date >= '2026-04-16' AND planning_date < '2026-04-17'
Usa sempre schema public: public.emp_employees, public.flt_trailers, etc.`,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Query SQL PostgreSQL da eseguire su BERLINK' },
      },
      required: ['query'],
    },
    permission: 'read',
    execute: async (input) => executeQuery('berlink', input.query as string),
  },
  {
    name: 'tir_query',
    description: `Esegui una query SQL sul database TIR (SQL Server).
Tabelle principali:
- btr.Viaggi: viaggi (ViaggioId, TripId, NumViaggio, DataInizio, DataFine)
- btr.DettagliViaggi: dettagli viaggi
- dbo.Abbinamento: abbinamenti autista-mezzo
- dbo.Addetti: dipendenti
- dbo.Agente: agenti

Viste utili: 'CD Planning', 'VPresenza_Autista', 'VSpesa_Viaggo'
Per paginazione: usa TOP N oppure OFFSET/FETCH.`,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Query SQL da eseguire su TIR' },
      },
      required: ['query'],
    },
    permission: 'read',
    execute: async (input) => executeQuery('tir', input.query as string),
  },
]

const plugin: PluginDefinition = {
  name: 'light_planner',
  description: 'Accesso diretto ai database BERLINK e TIR via query SQL — pianificazione, flotta, GPS, viaggi',
  tools,
  settings: [{
    key: 'light_planner_proxy_url',
    category: 'planning',
    envVar: 'LIGHT_PLANNER_PROXY_URL',
    description: 'URL proxy API per BERLINK/TIR (sul server .14)',
    sensitive: false,
    defaultValue: PROXY_URL_DEFAULT,
    requiresRestart: false,
  }],
}

export default plugin
