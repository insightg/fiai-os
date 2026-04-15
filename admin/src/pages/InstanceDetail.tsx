import { useEffect, useState } from 'react'
import { api } from '../lib/api'

interface Agent { domain: string; name: string; color: string; model?: string; tools: string[]; prompt: string; promptPreview?: string }

type Tab = 'agents' | 'users' | 'groups' | 'settings' | 'tokens' | 'vpn' | 'config' | 'yaml'

export function InstanceDetail({ instanceId, onBack, onEditAgent }: {
  instanceId: string; onBack: () => void; onEditAgent: (domain: string) => void
}) {
  const [instance, setInstance] = useState<any>(null)
  const [agents, setAgents] = useState<Agent[]>([])
  const [tab, setTab] = useState<Tab>('agents')
  const [yamlContent, setYamlContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [plugins, setPlugins] = useState<any[]>([])

  // Proxied data
  const [users, setUsers] = useState<any[]>([])
  const [groups, setGroups] = useState<any[]>([])
  const [settings, setSettings] = useState<any>(null)
  const [tokens, setTokens] = useState<any[]>([])
  const [health, setHealth] = useState<any>(null)
  const [stats, setStats] = useState<any>(null)
  const [vpn, setVpn] = useState<any>(null)
  const [vpnStatus, setVpnStatus] = useState<any>(null)

  useEffect(() => {
    api.getInstance(instanceId).then(data => { setInstance(data); setYamlContent(data.rawYaml || '') })
    api.getAgents(instanceId).then(setAgents)
    api.getPlugins().then(setPlugins)
    api.getInstanceHealth(instanceId).then(setHealth).catch(() => {})
    api.getInstanceStats(instanceId).then(setStats).catch(() => {})
  }, [instanceId])

  // Load tab data on demand
  useEffect(() => {
    if (tab === 'users') api.proxyGet(instanceId, '/api/admin/users').then(setUsers).catch(() => setUsers([]))
    if (tab === 'groups') api.proxyGet(instanceId, '/api/admin/groups').then(setGroups).catch(() => setGroups([]))
    if (tab === 'settings') api.proxyGet(instanceId, '/api/admin/settings').then(setSettings).catch(() => setSettings(null))
    if (tab === 'tokens') api.proxyGet(instanceId, '/api/auth/tokens').then(setTokens).catch(() => setTokens([]))
    if (tab === 'vpn') {
      api.getVpn(instanceId).then(setVpn).catch(() => setVpn(null))
      api.proxyGet(instanceId, '/api/vpn/status').then(setVpnStatus).catch(() => setVpnStatus(null))
    }
  }, [tab, instanceId])

  const saveYaml = async () => {
    setSaving(true)
    try {
      await api.updateInstanceYaml(instanceId, yamlContent)
      try { await api.reloadInstance(instanceId) } catch {}
      alert('Config salvata e applicata.')
    } catch (err: any) { alert('Errore: ' + err.message) }
    setSaving(false)
  }

  const deleteInstance = async () => {
    if (!confirm(`Eliminare l'istanza "${instanceId}"?`)) return
    try { await api.deleteInstance(instanceId); onBack() } catch (err: any) { alert(err.message) }
  }

  if (!instance) return <div className="p-8 text-gray-500">Caricamento...</div>

  const config = instance.config || {}
  const company = config.company || {}

  const TABS: { key: Tab; label: string }[] = [
    { key: 'agents', label: `🤖 Agenti (${agents.length})` },
    { key: 'users', label: '👥 Utenti' },
    { key: 'groups', label: '🔐 Gruppi' },
    { key: 'settings', label: '⚙️ Settings' },
    { key: 'tokens', label: '🔑 Token API' },
    { key: 'vpn', label: '🔒 VPN' },
    { key: 'config', label: '📊 Sistema' },
    { key: 'yaml', label: '📄 YAML' },
  ]

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={onBack} className="text-gray-500 hover:text-white text-sm">← Istanze</button>
        <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold"
          style={{ backgroundColor: company.color || '#607D8B' }}>
          {(company.short_name || instanceId).substring(0, 2).toUpperCase()}
        </div>
        <div>
          <h2 className="text-2xl font-bold">{company.name || instanceId}</h2>
          <p className="text-gray-500 text-sm font-mono">{instanceId}</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {health && (
            <span className={`text-xs px-2 py-1 rounded ${health.status === 'ok' ? 'bg-green-900/40 text-green-400' : 'bg-red-900/40 text-red-400'}`}>
              {health.status === 'ok' ? '● Online' : '○ Offline'}
            </span>
          )}
          {stats?.users && <span className="text-xs text-gray-500">{stats.users} utenti</span>}
          {stats?.dbSizeMB && <span className="text-xs text-gray-500">{stats.dbSizeMB} MB</span>}
          {instanceId !== 'fiai' && (
            <button onClick={deleteInstance} className="text-red-400 hover:text-red-300 text-xs px-3 py-1 border border-red-800 rounded">Elimina</button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-800 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${tab === t.key ? 'border-red-500 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Agents Tab ── */}
      {tab === 'agents' && (
        <div className="space-y-3">
          {agents.map(agent => (
            <div key={agent.domain} onClick={() => onEditAgent(agent.domain)}
              className="bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-gray-600 cursor-pointer transition-colors flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-xs"
                style={{ backgroundColor: agent.color }}>
                {agent.domain.substring(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="font-medium text-white">{agent.name}</h4>
                  <span className="text-xs text-gray-500 font-mono">{agent.domain}</span>
                  {agent.model && <span className="text-xs bg-purple-900/40 text-purple-300 px-2 py-0.5 rounded">{agent.model.split('/').pop()}</span>}
                </div>
                <p className="text-xs text-gray-500 truncate mt-0.5">{agent.promptPreview || '—'}</p>
              </div>
              <div className="text-xs text-gray-500">{agent.tools?.length || 0} tool</div>
            </div>
          ))}
          <button onClick={() => onEditAgent('_new')} className="w-full bg-gray-900/50 border border-dashed border-gray-700 rounded-xl p-4 text-gray-500 hover:text-white hover:border-gray-500 text-sm">+ Aggiungi Agente</button>
        </div>
      )}

      {/* ── Users Tab ── */}
      {tab === 'users' && (
        <div className="space-y-3">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold">Utenti ({users.length})</h3>
          </div>
          {users.length === 0 ? <p className="text-gray-500 text-sm">Nessun utente o istanza non raggiungibile</p> : (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-gray-800 text-gray-400 text-xs">
                  <th className="text-left px-4 py-3">Nome</th>
                  <th className="text-left px-4 py-3">Email</th>
                  <th className="text-left px-4 py-3">Ruolo</th>
                  <th className="text-left px-4 py-3">Gruppi</th>
                  <th className="text-left px-4 py-3">WhatsApp</th>
                </tr></thead>
                <tbody>
                  {users.map((u: any) => (
                    <tr key={u.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                      <td className="px-4 py-3 font-medium text-white">{u.display_name}</td>
                      <td className="px-4 py-3 text-gray-400">{u.email}</td>
                      <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded ${u.ruolo === 'admin' ? 'bg-red-900/40 text-red-300' : 'bg-gray-700 text-gray-300'}`}>{u.ruolo}</span></td>
                      <td className="px-4 py-3 text-xs text-gray-500">{u.groups?.map((g: any) => g.name).join(', ') || '—'}</td>
                      <td className="px-4 py-3">{u.whatsapp_active ? <span className="text-green-400 text-xs">● attivo</span> : <span className="text-gray-600 text-xs">○</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Groups Tab ── */}
      {tab === 'groups' && (
        <div className="space-y-4">
          <h3 className="font-semibold">Gruppi Permessi ({groups.length})</h3>
          {groups.map((g: any) => (
            <div key={g.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="flex justify-between items-center mb-3">
                <h4 className="font-medium text-white">{g.name}</h4>
                <span className="text-xs text-gray-500">{g.members?.length || 0} membri</span>
              </div>
              <div className="text-xs text-gray-400 space-y-1">
                {Object.entries(g.permissions || {}).map(([type, actions]: [string, any]) => (
                  <div key={type} className="flex gap-2">
                    <span className="text-gray-500 w-24">{type}:</span>
                    <span>{Array.isArray(actions) ? actions.join(', ') : String(actions)}</span>
                  </div>
                ))}
              </div>
              {g.members?.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-800 flex flex-wrap gap-2">
                  {g.members.map((m: any) => (
                    <span key={m.id} className="text-xs bg-gray-800 text-gray-300 px-2 py-1 rounded">{m.display_name}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Settings Tab ── */}
      {tab === 'settings' && (
        <div className="space-y-4">
          <h3 className="font-semibold">Impostazioni Sistema</h3>
          {settings?.grouped ? Object.entries(settings.grouped as Record<string, any[]>).map(([category, items]) => (
            <div key={category} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <h4 className="font-medium text-white mb-3 capitalize">{category}</h4>
              <div className="space-y-2">
                {items.map((s: any) => (
                  <div key={s.key} className="flex items-center justify-between text-sm">
                    <div>
                      <span className="text-gray-300">{s.description}</span>
                      <span className="text-xs text-gray-600 ml-2 font-mono">{s.key}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${s.source === 'db' ? 'bg-green-900/30 text-green-400' : s.source === 'env' ? 'bg-blue-900/30 text-blue-400' : 'bg-gray-700 text-gray-400'}`}>{s.source}</span>
                      <code className="text-xs text-gray-400 bg-gray-800 px-2 py-0.5 rounded max-w-48 truncate">{s.value || '—'}</code>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )) : <p className="text-gray-500 text-sm">Settings non disponibili o istanza non raggiungibile</p>}
        </div>
      )}

      {/* ── Tokens Tab ── */}
      {tab === 'tokens' && (
        <div className="space-y-4">
          <h3 className="font-semibold">API Token ({tokens.length})</h3>
          {tokens.length === 0 ? <p className="text-gray-500 text-sm">Nessun token o istanza non raggiungibile</p> : (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-gray-800 text-gray-400 text-xs">
                  <th className="text-left px-4 py-3">Nome</th>
                  <th className="text-left px-4 py-3">Preview</th>
                  <th className="text-left px-4 py-3">Scadenza</th>
                  <th className="text-left px-4 py-3">Ultimo uso</th>
                  <th className="text-left px-4 py-3">Stato</th>
                </tr></thead>
                <tbody>
                  {tokens.map((t: any) => (
                    <tr key={t.id} className="border-b border-gray-800/50">
                      <td className="px-4 py-3 text-white">{t.name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-400">{t.token_preview}</td>
                      <td className="px-4 py-3 text-xs text-gray-400">{t.expires_at?.slice(0, 10) || 'Mai'}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{t.last_used_at?.slice(0, 16) || '—'}</td>
                      <td className="px-4 py-3">{t.revoked_at ? <span className="text-red-400 text-xs">Revocato</span> : <span className="text-green-400 text-xs">Attivo</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── VPN Tab ── */}
      {tab === 'vpn' && (
        <div className="space-y-4">
          {/* VPN Status (from instance) */}
          {vpnStatus && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h3 className="font-semibold mb-4">Stato Connessione</h3>
              <div className="flex items-center gap-4">
                <span className={`text-2xl ${vpnStatus.status === 'connected' ? 'text-green-400' : vpnStatus.status === 'connecting' ? 'text-yellow-400' : 'text-red-400'}`}>
                  {vpnStatus.status === 'connected' ? '●' : vpnStatus.status === 'connecting' ? '◐' : '○'}
                </span>
                <div>
                  <p className="font-medium text-white capitalize">{vpnStatus.status || 'sconosciuto'}</p>
                  {vpnStatus.connectedAt && <p className="text-xs text-gray-500">Connesso da: {vpnStatus.connectedAt}</p>}
                  {vpnStatus.error && <p className="text-xs text-red-400">{vpnStatus.error}</p>}
                </div>
                <div className="ml-auto flex gap-2">
                  <button onClick={() => api.proxyPost(instanceId, '/api/vpn/connect').then(() => setTimeout(() => api.proxyGet(instanceId, '/api/vpn/status').then(setVpnStatus), 3000))}
                    className="text-xs bg-green-900/40 text-green-300 px-3 py-1.5 rounded hover:bg-green-900/60">Connetti</button>
                  <button onClick={() => api.proxyPost(instanceId, '/api/vpn/disconnect').then(() => api.proxyGet(instanceId, '/api/vpn/status').then(setVpnStatus))}
                    className="text-xs bg-red-900/40 text-red-300 px-3 py-1.5 rounded hover:bg-red-900/60">Disconnetti</button>
                </div>
              </div>
            </div>
          )}

          {/* VPN Files */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-semibold">Credenziali VPN</h3>
              <label className="text-xs bg-blue-900/40 text-blue-300 px-3 py-1.5 rounded cursor-pointer hover:bg-blue-900/60">
                + Carica file
                <input type="file" className="hidden" onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  const reader = new FileReader()
                  reader.onload = async () => {
                    const base64 = (reader.result as string).split(',')[1] || btoa(reader.result as string)
                    await api.uploadVpnFile(instanceId, file.name, base64)
                    api.getVpn(instanceId).then(setVpn)
                  }
                  reader.readAsDataURL(file)
                }} />
              </label>
            </div>
            {!vpn?.configured ? (
              <p className="text-gray-500 text-sm">Nessuna credenziale VPN configurata per questa istanza.</p>
            ) : (
              <div className="space-y-2">
                {vpn.files.map((f: any) => (
                  <div key={f.name} className="flex items-center justify-between bg-gray-800 rounded-lg px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="text-lg">{f.isConfig ? '🔐' : '📄'}</span>
                      <div>
                        <span className="text-sm text-white font-mono">{f.name}</span>
                        <span className="text-xs text-gray-500 ml-2">{(f.size / 1024).toFixed(1)} KB</span>
                      </div>
                    </div>
                    <button onClick={async () => { await api.deleteVpnFile(instanceId, f.name); api.getVpn(instanceId).then(setVpn) }}
                      className="text-xs text-red-400 hover:text-red-300">Elimina</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Config/System Tab ── */}
      {tab === 'config' && (
        <div className="space-y-6">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h3 className="font-semibold mb-4">🏢 Azienda</h3>
            <div className="grid grid-cols-3 gap-4">
              <div><label className="text-xs text-gray-400 block mb-1">Nome</label><div className="bg-gray-800 rounded-lg px-3 py-2 text-sm">{company.name || '—'}</div></div>
              <div><label className="text-xs text-gray-400 block mb-1">Nome Breve</label><div className="bg-gray-800 rounded-lg px-3 py-2 text-sm">{company.short_name || '—'}</div></div>
              <div><label className="text-xs text-gray-400 block mb-1">Colore</label><div className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2"><div className="w-5 h-5 rounded" style={{ backgroundColor: company.color }} /><span className="text-sm font-mono">{company.color}</span></div></div>
            </div>
          </div>

          {stats && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h3 className="font-semibold mb-4">📊 Statistiche</h3>
              <div className="grid grid-cols-4 gap-4">
                {[
                  { label: 'Entity totali', value: stats.totalEntities },
                  { label: 'Utenti', value: stats.users },
                  { label: 'Documenti', value: stats.documents },
                  { label: 'Chunks', value: stats.chunks },
                  { label: 'Con embedding', value: stats.embeddedEntities },
                  { label: 'Sessioni (7gg)', value: stats.recentSessions },
                  { label: 'DB', value: `${stats.dbSizeMB} MB` },
                ].map(s => (
                  <div key={s.label} className="bg-gray-800 rounded-lg p-3">
                    <div className="text-xs text-gray-400">{s.label}</div>
                    <div className="text-lg font-semibold text-white mt-1">{s.value ?? '—'}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h3 className="font-semibold mb-4">🔌 Plugin</h3>
            <div className="space-y-2">
              {plugins.map(p => {
                const isActive = config.plugins && p.name in config.plugins
                return (
                  <div key={p.name} className="flex items-center justify-between bg-gray-800 rounded-lg px-4 py-3">
                    <div><span className="text-sm font-medium">{p.name}</span><span className="text-xs text-gray-500 ml-2">{p.description}</span></div>
                    <span className={`text-xs px-2 py-1 rounded ${isActive ? 'bg-green-900/40 text-green-400' : 'bg-gray-700 text-gray-500'}`}>{isActive ? 'Attivo' : 'Disattivo'}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── YAML Tab ── */}
      {tab === 'yaml' && (
        <div className="space-y-4">
          <textarea value={yamlContent} onChange={e => setYamlContent(e.target.value)}
            className="w-full h-[600px] bg-gray-900 border border-gray-800 rounded-xl p-4 text-sm font-mono text-green-300 focus:border-red-500 focus:outline-none resize-none"
            spellCheck={false} />
          <div className="flex gap-2">
            <button onClick={saveYaml} disabled={saving} className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50">{saving ? 'Salvando...' : 'Salva e Applica'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
