/**
 * Planning Proxy — bridge to ai-planner FastAPI on remote server (via VPN)
 */

import { getSetting } from './settings.js'

const DEFAULT_URL = 'http://192.168.0.14:8602'
const TIMEOUT = 60000 // 60s for optimization

function getBaseUrl(): string {
  return getSetting('planning_api_url') || DEFAULT_URL
}

export async function planningCall(endpoint: string, body?: Record<string, unknown>): Promise<any> {
  const url = `${getBaseUrl()}/api/planning/${endpoint}`

  try {
    const res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT),
    })

    if (!res.ok) {
      const err = await res.text().catch(() => '')
      return { errore: `Planner API error ${res.status}: ${err.substring(0, 200)}` }
    }

    let data = await res.json()

    // Post-process ETA results: remove unreliable position data
    if (endpoint === 'eta' && data && typeof data === 'object' && !data.errore) {
      if ((!data.posizione_gps || data.posizione_gps === '') && (data.affidabilita || 0) < 0.5) {
        data.posizione_corrente = null
        data._nota_posizione = 'Posizione GPS non disponibile. Usa luogo_carico (dal dettaglio viaggio) come partenza e luogo_scarico come destinazione.'
      }
    }

    return data
  } catch (err: any) {
    if (err.name === 'TimeoutError') return { errore: 'Timeout connessione al planner (60s). Verifica che la VPN sia attiva.' }
    return { errore: `Planner non raggiungibile: ${err.message}. Verifica che la VPN sia connessa e il server attivo.` }
  }
}

export async function planningHealth(): Promise<{ ok: boolean; tools?: number; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl()}/api/planning/health`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const data = await res.json()
    return { ok: true, tools: data.tools }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
}
