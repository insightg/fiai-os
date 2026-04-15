/**
 * VPN Management — OpenVPN client control via admin API
 *
 * Runs openvpn on the HOST machine (not inside Docker container).
 * The backend container calls the host via a simple HTTP API or
 * uses a mounted socket/script. For simplicity, the VPN endpoints
 * are served by a lightweight Express process on the host.
 *
 * This module provides the Express router mounted in the main app
 * and manages the openvpn process directly (since the backend
 * runs on the host via `npx tsx` in dev, or can be exposed via
 * Docker host networking).
 */

import { Router, Response } from 'express'
import { spawn, execSync, type ChildProcess } from 'child_process'
import path from 'path'
import fs from 'fs'
import { AuthRequest, authMiddleware } from './middleware.js'

const router = Router()

// VPN config directory — per-instance: /app/instances/{instance}/vpn/ or fallback /app/vpn
const INSTANCE_NAME = process.env.FIAI_INSTANCE || 'fiai'
const INSTANCE_VPN_DIR = `/app/instances/${INSTANCE_NAME}/vpn`
const VPN_DIR = fs.existsSync(INSTANCE_VPN_DIR) ? INSTANCE_VPN_DIR : (process.env.VPN_DIR || '/app/vpn')
// Find the .ovpn config file dynamically (each client may have a different filename)
const VPN_CONFIG = (() => {
  try {
    const ovpnFiles = fs.readdirSync(VPN_DIR).filter(f => f.endsWith('.ovpn'))
    return ovpnFiles.length > 0 ? path.join(VPN_DIR, ovpnFiles[0]) : path.join(VPN_DIR, 'client.ovpn')
  } catch { return path.join(VPN_DIR, 'client.ovpn') }
})()
const VPN_LOG = `/tmp/openvpn-${INSTANCE_NAME}.log`
const VPN_PID_FILE = `/tmp/openvpn-${INSTANCE_NAME}.pid`

let vpnProcess: ChildProcess | null = null
let vpnStatus: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected'
let vpnError: string = ''
let vpnConnectedAt: string | null = null

// Admin guard
function adminGuard(req: AuthRequest, res: Response, next: () => void) {
  if (!req.permissions?.isAdmin) {
    res.status(403).json({ error: 'Accesso riservato agli amministratori' })
    return
  }
  next()
}

router.use(authMiddleware(true), adminGuard as any)

// ── GET /api/vpn/status ──────────────────────────────────

router.get('/status', (_req: AuthRequest, res: Response) => {
  // Check if openvpn process is actually running
  if (vpnProcess && vpnProcess.exitCode !== null) {
    vpnStatus = 'disconnected'
    vpnProcess = null
    vpnConnectedAt = null
  }

  // Also check via PID file
  if (vpnStatus === 'connected' || vpnStatus === 'connecting') {
    try {
      const pid = fs.existsSync(VPN_PID_FILE) ? fs.readFileSync(VPN_PID_FILE, 'utf-8').trim() : null
      if (pid) {
        execSync(`kill -0 ${pid} 2>/dev/null`)
      } else if (!vpnProcess) {
        vpnStatus = 'disconnected'
      }
    } catch {
      vpnStatus = 'disconnected'
      vpnProcess = null
      vpnConnectedAt = null
    }
  }

  // Check tun interface (use /sys/class/net since `ip` may not be installed in slim containers)
  let tunActive = false
  try {
    tunActive = fs.existsSync('/sys/class/net/tun0')
    if (tunActive && vpnStatus !== 'connected') { vpnStatus = 'connected'; if (!vpnConnectedAt) vpnConnectedAt = new Date().toISOString() }
    if (!tunActive && vpnStatus === 'connected') { vpnStatus = 'disconnected'; vpnConnectedAt = null }
  } catch {}

  // Get recent log lines
  let recentLog = ''
  try {
    recentLog = execSync(`tail -20 ${VPN_LOG} 2>/dev/null || echo ""`, { encoding: 'utf-8' })
  } catch {}

  res.json({
    status: vpnStatus,
    connectedAt: vpnConnectedAt,
    error: vpnError,
    configFile: VPN_CONFIG,
    configExists: fs.existsSync(VPN_CONFIG),
    tunActive,
    log: recentLog,
  })
})

// ── POST /api/vpn/connect ────────────────────────────────

router.post('/connect', (_req: AuthRequest, res: Response) => {
  if (vpnStatus === 'connected' || vpnStatus === 'connecting') {
    res.json({ status: vpnStatus, message: 'VPN gia connessa o in connessione' })
    return
  }

  if (!fs.existsSync(VPN_CONFIG)) {
    res.status(400).json({ error: `Config non trovata: ${VPN_CONFIG}` })
    return
  }

  vpnStatus = 'connecting'
  vpnError = ''

  try {
    // Clear old log
    fs.writeFileSync(VPN_LOG, '')

    // Askpass file for encrypted private key (separate from auth password)
    const askpassFile = path.join(VPN_DIR, 'key-pass.txt')

    vpnProcess = spawn('openvpn', [
      '--config', VPN_CONFIG,
      '--cd', VPN_DIR,
      '--log', VPN_LOG,
      '--writepid', VPN_PID_FILE,
      '--askpass', askpassFile,
      '--daemon', 'fiai-vpn',
    ], {
      detached: true,
      stdio: 'ignore',
    })

    vpnProcess.unref()

    // Monitor connection
    let checks = 0
    const checkInterval = setInterval(() => {
      checks++
      try {
        const log = fs.readFileSync(VPN_LOG, 'utf-8')
        if (log.includes('Initialization Sequence Completed')) {
          vpnStatus = 'connected'
          vpnConnectedAt = new Date().toISOString()
          console.log('[VPN] Connected successfully')
          clearInterval(checkInterval)
        } else if (log.includes('AUTH_FAILED') || log.includes('Connection refused') || log.includes('TLS Error')) {
          vpnStatus = 'error'
          vpnError = log.split('\n').filter(l => /error|fail|refused/i.test(l)).slice(-1)[0] || 'Connessione fallita'
          console.error('[VPN] Connection failed:', vpnError)
          clearInterval(checkInterval)
        }
      } catch {}

      if (checks > 30) { // 30s timeout
        if (vpnStatus === 'connecting') {
          vpnStatus = 'error'
          vpnError = 'Timeout connessione (30s)'
        }
        clearInterval(checkInterval)
      }
    }, 1000)

    res.json({ status: 'connecting', message: 'Connessione VPN avviata' })
  } catch (err) {
    vpnStatus = 'error'
    vpnError = (err as Error).message
    res.status(500).json({ error: vpnError })
  }
})

// ── POST /api/vpn/disconnect ─────────────────────────────

router.post('/disconnect', (_req: AuthRequest, res: Response) => {
  try {
    // Kill by PID file
    if (fs.existsSync(VPN_PID_FILE)) {
      const pid = fs.readFileSync(VPN_PID_FILE, 'utf-8').trim()
      try { execSync(`kill ${pid} 2>/dev/null`) } catch {}
      fs.unlinkSync(VPN_PID_FILE)
    }

    // Kill by process name
    try { execSync('killall openvpn 2>/dev/null') } catch {}

    // Kill tracked process
    if (vpnProcess) {
      try { vpnProcess.kill() } catch {}
      vpnProcess = null
    }

    vpnStatus = 'disconnected'
    vpnConnectedAt = null
    vpnError = ''

    console.log('[VPN] Disconnected')
    res.json({ status: 'disconnected', message: 'VPN disconnessa' })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── GET /api/vpn/log ─────────────────────────────────────

router.get('/log', (_req: AuthRequest, res: Response) => {
  try {
    const log = fs.existsSync(VPN_LOG) ? fs.readFileSync(VPN_LOG, 'utf-8') : ''
    res.json({ log: log.split('\n').slice(-50).join('\n') })
  } catch {
    res.json({ log: '' })
  }
})

// ── GET /api/vpn/ping — Test VPN connectivity ───────────

router.post('/ping', async (req: AuthRequest, res: Response) => {
  const target = (req.body.target || '192.168.0.1') as string
  // Validate IP format
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(target)) {
    res.status(400).json({ error: 'IP non valido' }); return
  }

  try {
    const start = Date.now()
    const result = execSync(`ping -c 3 -W 2 ${target} 2>&1`, { encoding: 'utf-8', timeout: 10000 })
    const latency = Date.now() - start

    const success = result.includes('bytes from')
    const lossMatch = result.match(/(\d+)% packet loss/)
    const avgMatch = result.match(/= [\d.]+\/([\d.]+)\//)

    res.json({
      success,
      target,
      latencyMs: avgMatch ? parseFloat(avgMatch[1]) : latency / 3,
      packetLoss: lossMatch ? parseInt(lossMatch[1]) : (success ? 0 : 100),
      output: result.split('\n').slice(-3).join('\n'),
    })
  } catch (err: any) {
    res.json({
      success: false,
      target,
      latencyMs: 0,
      packetLoss: 100,
      output: err.stderr || err.message || 'Ping failed',
    })
  }
})

// ── Auto-connect on startup ──────────────────────────────

export async function autoConnectVPN(): Promise<void> {
  if (!fs.existsSync(VPN_CONFIG)) {
    console.log('[VPN] Config not found, skipping auto-connect')
    return
  }

  // Check if already connected
  if (fs.existsSync('/sys/class/net/tun0')) {
    vpnStatus = 'connected'
    vpnConnectedAt = new Date().toISOString()
    console.log('[VPN] Already connected (tun0 active)')
    return
  }

  console.log('[VPN] Auto-connecting...')
  vpnStatus = 'connecting'

  try {
    fs.writeFileSync(VPN_LOG, '')
    const askpassFile = path.join(VPN_DIR, 'key-pass.txt')

    spawn('openvpn', [
      '--config', VPN_CONFIG, '--cd', VPN_DIR,
      '--log', VPN_LOG, '--writepid', VPN_PID_FILE,
      '--askpass', askpassFile, '--daemon', 'fiai-vpn',
    ], { detached: true, stdio: 'ignore' }).unref()

    // Wait up to 15s for connection
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 1000))
      if (fs.existsSync('/sys/class/net/tun0')) {
        vpnStatus = 'connected'
        vpnConnectedAt = new Date().toISOString()
        console.log('[VPN] Auto-connected successfully')
        return
      }
      try {
        const log = fs.readFileSync(VPN_LOG, 'utf-8')
        if (log.includes('Exiting due to fatal error')) {
          vpnStatus = 'error'
          console.error('[VPN] Auto-connect failed:', log.split('\n').filter(l => /error|fail/i.test(l)).pop())
          return
        }
      } catch {}
    }

    vpnStatus = fs.existsSync('/sys/class/net/tun0') ? 'connected' : 'error'
    if (vpnStatus === 'connected') {
      vpnConnectedAt = new Date().toISOString()
      console.log('[VPN] Auto-connected successfully')
    } else {
      console.warn('[VPN] Auto-connect timeout (15s)')
    }
  } catch (err) {
    vpnStatus = 'error'
    console.error('[VPN] Auto-connect error:', (err as Error).message)
  }
}

export default router
