import { useState, useEffect, useCallback } from 'react'
import { Users, Shield, Plus, Trash2, Check, X, ChevronDown, ChevronRight, Bot, Activity, Database, RefreshCw, Save, AlertTriangle, Settings, Eye, EyeOff, Key, Cpu, Copy, Clock, Wifi, WifiOff, Power, Terminal } from 'lucide-react'
import { getAuthToken } from '../../lib/supabase'
import toast from 'react-hot-toast'

interface User { id: string; display_name: string; email: string; telefono: string; ruolo: string; cognome: string; tts_voice: string; whatsapp_phone: string; whatsapp_active: boolean; groups: { id: string; name: string }[]; created_at: string }
interface Group { id: string; name: string; permissions: Record<string, string[]>; agentPermissions: Record<string, string[]>; members: { id: string; display_name: string; email: string }[] }
interface Agent { domain: string; name: string; color: string; model: string; toolCount: number; toolNames: string[]; promptLength: number; promptPreview: string; systemPrompt: string; hasSkillOverride: boolean; skillRules: string[]; skillModel: string | null }
interface AuditEntry { id: string; entity_id: string; entity_type: string; action: string; entity_name: string; before_data: string; after_data: string; created_at: string }
interface SystemStats { totalEntities: number; typeCounts: { type: string; count: number }[]; documents: number; chunks: number; embeddedEntities: number; users: number; recentAudits: number; recentSessions: number; dbSizeMB: number }
interface SystemSetting { key: string; category: string; envVar: string; description: string; sensitive: boolean; defaultValue: string; requiresRestart: boolean; value: string; source: 'db' | 'env' | 'default' }
interface ApiToken { id: string; token_preview: string; name: string; expires_at: string | null; revoked_at: string | null; last_used_at: string | null; created_at: string }

const ACTIONS = ['read', 'create', 'update', 'delete', 'send'] as const
const AGENT_ACTIONS = ['chat', 'configure'] as const
const ENTITY_TYPES = ['commerciale', 'fattura', 'fattura_passiva', 'preventivo', 'ordine', 'progetto', 'documento', 'contratto', 'conto', 'movimento', 'rimborso', 'annuncio', 'evento']
const TYPE_ALIASES: Record<string, string[]> = { 'commerciale': ['organizzazione', 'persona'] }
const AGENT_SETTINGS_MAP: Record<string, string> = { email: 'email', tts: 'tts', general: 'api', it: 'api' }
const CATEGORY_LABELS: Record<string, string> = { api: 'API & Modelli', email: 'Email (IMAP/SMTP)', whatsapp: 'WhatsApp', tts: 'Text-to-Speech', storage: 'Archiviazione', auth: 'Autenticazione', system: 'Sistema' }

function api(path: string, method = 'GET', body?: any) {
  const token = getAuthToken()
  return fetch(`/api/admin${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }).then(r => r.json())
}

function vpnApi(path: string, method = 'GET', body?: any) {
  const token = getAuthToken()
  return fetch(`/api/vpn${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }).then(r => r.json())
}

function authApi(path: string, method = 'GET', body?: any) {
  const token = getAuthToken()
  return fetch(`/api/auth${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }).then(r => r.json())
}

type Tab = 'users' | 'groups' | 'agents' | 'api' | 'vpn' | 'audit' | 'settings'

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('users')
  const [users, setUsers] = useState<User[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([])
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [u, g] = await Promise.all([api('/users'), api('/groups')])
      if (u.error) { setError(u.error); return }
      setUsers(Array.isArray(u) ? u : [])
      setGroups(Array.isArray(g) ? g : [])
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  const loadAgents = useCallback(async () => {
    try { const a = await api('/agents'); setAgents(Array.isArray(a) ? a : []) } catch {}
  }, [])

  const loadAudit = useCallback(async () => {
    try { const r = await api('/audit-log?limit=100'); setAuditLogs(r.logs || []) } catch {}
  }, [])

  const loadSystem = useCallback(async () => {
    try { const s = await api('/system'); setSystemStats(s) } catch {}
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (tab === 'agents') loadAgents() }, [tab, loadAgents])
  useEffect(() => { if (tab === 'audit') loadAudit() }, [tab, loadAudit])
  useEffect(() => { if (tab === 'settings') loadSystem() }, [tab, loadSystem])
  useEffect(() => { if (tab === 'groups') { loadAgents(); load() } }, [tab, loadAgents, load])

  if (error) return <div className="p-8 text-red text-sm">{error}</div>

  const tabs: { id: Tab; label: string; icon: any; count?: number }[] = [
    { id: 'users', label: 'Utenti', icon: Users, count: users.length },
    { id: 'groups', label: 'Gruppi', icon: Shield, count: groups.length },
    { id: 'agents', label: 'Agenti', icon: Bot, count: agents.length },
    { id: 'api', label: 'API & Devices', icon: Key },
    { id: 'vpn', label: 'VPN', icon: Wifi },
    { id: 'audit', label: 'Audit Log', icon: Activity },
    { id: 'settings', label: 'Impostazioni', icon: Settings },
  ]

  return (
    <div className="min-h-screen bg-bg p-4 sm:p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-4">
          <p className="text-[11px] text-text3">Gestione utenti, agenti, permessi e sistema</p>
        </div>

        <div className="flex gap-1 mb-4 overflow-x-auto pb-1">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg whitespace-nowrap transition-colors ${
                tab === t.id ? 'bg-gold text-white' : 'bg-bg2 text-text2 hover:bg-bg3 border border-border'
              }`}
            >
              <t.icon size={14} />
              {t.label}
              {t.count !== undefined && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${tab === t.id ? 'bg-white/20' : 'bg-bg3'}`}>{t.count}</span>
              )}
            </button>
          ))}
        </div>

        {loading && tab === 'users' ? (
          <div className="text-text3 text-sm p-8 text-center">Caricamento...</div>
        ) : tab === 'users' ? (
          <UsersTab users={users} groups={groups} onReload={load} />
        ) : tab === 'groups' ? (
          <GroupsTab groups={groups} users={users} agents={agents} onReload={load} />
        ) : tab === 'agents' ? (
          <AgentsTab agents={agents} onReload={loadAgents} />
        ) : tab === 'api' ? (
          <ApiTab />
        ) : tab === 'vpn' ? (
          <VpnTab />
        ) : tab === 'audit' ? (
          <AuditTab logs={auditLogs} onReload={loadAudit} />
        ) : (
          <SettingsTab stats={systemStats} onReload={loadSystem} />
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════
// USERS TAB
// ═══════════════════════════════════════════════════════

function UsersTab({ users, groups, onReload }: { users: User[]; groups: Group[]; onReload: () => void }) {
  const [showNew, setShowNew] = useState(false)
  const [search, setSearch] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ nome: '', cognome: '', email: '', password: '', telefono: '', whatsapp_phone: '', ruolo: 'collaboratore', tts_voice: '', group_ids: [] as string[] })
  const [editForm, setEditForm] = useState({ nome: '', cognome: '', email: '', telefono: '', password: '', whatsapp_phone: '', whatsapp_active: false, ruolo: 'collaboratore', tts_voice: '', group_ids: [] as string[] })

  const TTS_VOICES = ['Vivian', 'Serena', 'Ryan', 'Luca', 'Isabella']

  const toggleFormGroup = (gid: string) => {
    setForm(f => ({ ...f, group_ids: f.group_ids.includes(gid) ? f.group_ids.filter(id => id !== gid) : [...f.group_ids, gid] }))
  }

  const toggleEditGroup = (gid: string) => {
    setEditForm(f => ({ ...f, group_ids: f.group_ids.includes(gid) ? f.group_ids.filter(id => id !== gid) : [...f.group_ids, gid] }))
  }

  const createUser = async () => {
    if (!form.nome || !form.email || !form.password) { toast.error('Compila nome, email e password'); return }
    const res = await api('/users', 'POST', {
      nome: form.nome, cognome: form.cognome, email: form.email, password: form.password,
      telefono: form.telefono, ruolo: form.ruolo, group_id: form.group_ids[0] || undefined,
      tts_voice: form.tts_voice || undefined, whatsapp_phone: form.whatsapp_phone || undefined, whatsapp_active: false,
    })
    if (res.error) { toast.error(res.error); return }
    toast.success(`Utente ${form.nome} creato`)
    setShowNew(false)
    setForm({ nome: '', cognome: '', email: '', password: '', telefono: '', whatsapp_phone: '', ruolo: 'collaboratore', tts_voice: '', group_ids: [] })
    onReload()
  }

  const startEdit = (u: User) => {
    setEditId(u.id)
    const nameParts = u.display_name.split(' ')
    setEditForm({
      nome: nameParts[0] || '', cognome: nameParts.slice(1).join(' ') || u.cognome || '',
      email: u.email, telefono: u.telefono || '', password: '',
      whatsapp_phone: u.whatsapp_phone || '', whatsapp_active: u.whatsapp_active || false,
      ruolo: u.ruolo || 'collaboratore', tts_voice: u.tts_voice || '',
      group_ids: u.groups.map(g => g.id),
    })
  }

  const saveEdit = async () => {
    if (!editId) return
    const body: any = {
      nome: editForm.nome, cognome: editForm.cognome, email: editForm.email, telefono: editForm.telefono,
      ruolo: editForm.ruolo, group_ids: editForm.group_ids,
      tts_voice: editForm.tts_voice || null, whatsapp_phone: editForm.whatsapp_phone || null,
      whatsapp_active: editForm.whatsapp_active,
    }
    if (editForm.password) body.password = editForm.password
    await api(`/users/${editId}`, 'PUT', body)
    toast.success('Utente aggiornato')
    setEditId(null)
    onReload()
  }

  const deleteUser = async (userId: string, name: string) => {
    if (!confirm(`Eliminare ${name}?`)) return
    await api(`/users/${userId}`, 'DELETE')
    toast.success('Utente eliminato')
    onReload()
  }

  const filtered = search
    ? users.filter(u => u.display_name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase()))
    : users

  const inputCls = "px-3 py-1.5 text-xs bg-bg3 border border-border rounded-lg text-text w-full"

  return (
    <div className="space-y-3">
      <div className="flex gap-2 justify-between">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cerca utente..." className="px-3 py-1.5 text-xs bg-bg2 border border-border rounded-lg text-text w-64" />
        <button onClick={() => setShowNew(!showNew)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gold hover:bg-gold-l text-white rounded-lg">
          <Plus size={14} /> Nuovo utente
        </button>
      </div>

      {showNew && (
        <div className="bg-bg2 border border-border rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold text-text">Nuovo utente</h3>
          <div className="grid grid-cols-2 gap-3">
            <input value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} placeholder="Nome *" className={inputCls} />
            <input value={form.cognome} onChange={e => setForm(f => ({ ...f, cognome: e.target.value }))} placeholder="Cognome" className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="Email *" type="email" className={inputCls} />
            <input value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="Password *" type="password" className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input value={form.telefono} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))} placeholder="Telefono (es. 393471234567)" className={inputCls} />
            <input value={form.whatsapp_phone} onChange={e => setForm(f => ({ ...f, whatsapp_phone: e.target.value }))} placeholder="WhatsApp (es. 393471234567)" className={inputCls} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] text-text3 block mb-0.5">Ruolo</label>
              <select value={form.ruolo} onChange={e => setForm(f => ({ ...f, ruolo: e.target.value }))} className={inputCls}>
                <option value="admin">admin</option>
                <option value="collaboratore">collaboratore</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-text3 block mb-0.5">Voce TTS</label>
              <select value={form.tts_voice} onChange={e => setForm(f => ({ ...f, tts_voice: e.target.value }))} className={inputCls}>
                <option value="">-- Nessuna --</option>
                {TTS_VOICES.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-text3 block mb-0.5">Gruppi</label>
              <div className="flex flex-wrap gap-1.5 mt-0.5">
                {groups.map(g => (
                  <label key={g.id} className="flex items-center gap-1 text-[10px] text-text2 cursor-pointer">
                    <input type="checkbox" checked={form.group_ids.includes(g.id)} onChange={() => toggleFormGroup(g.id)} className="rounded border-border" />
                    {g.name}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowNew(false)} className="px-3 py-1.5 text-xs text-text3 border border-border rounded-lg">Annulla</button>
            <button onClick={createUser} className="px-3 py-1.5 text-xs bg-gold text-white rounded-lg">Crea</button>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        {filtered.map(u => (
          <div key={u.id} className="bg-bg2 border border-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="min-w-0">
                  <span className="text-xs font-medium text-text">{u.display_name}</span>
                  <span className="text-[10px] text-text3 ml-2">{u.email}</span>
                </div>
                <div className="flex gap-1 flex-wrap items-center">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${u.ruolo === 'admin' ? 'bg-yellow/15 text-yellow' : 'bg-blue/15 text-blue'}`}>{u.ruolo || 'collaboratore'}</span>
                  {u.groups.map(g => (
                    <span key={g.id} className="px-1.5 py-0.5 rounded bg-gold/10 text-gold text-[10px]">{g.name}</span>
                  ))}
                  {u.groups.length === 0 && <span className="text-[10px] text-text3 italic">Nessun gruppo</span>}
                  {u.whatsapp_active && <span className="w-2 h-2 rounded-full bg-green inline-block" title="WhatsApp attivo" />}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => editId === u.id ? setEditId(null) : startEdit(u)} className="p-1 rounded hover:bg-bg3 text-text3 hover:text-gold">
                  {editId === u.id ? <ChevronDown size={14} /> : <Settings size={14} />}
                </button>
                <button onClick={() => deleteUser(u.id, u.display_name)} className="p-1 rounded hover:bg-red/10 text-text3 hover:text-red"><Trash2 size={14} /></button>
              </div>
            </div>

            {editId === u.id && (
              <div className="px-4 pb-3 pt-1 border-t border-border space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] text-text3 block mb-0.5">Nome</label>
                    <input value={editForm.nome} onChange={e => setEditForm(f => ({ ...f, nome: e.target.value }))} className={inputCls} />
                  </div>
                  <div>
                    <label className="text-[10px] text-text3 block mb-0.5">Cognome</label>
                    <input value={editForm.cognome} onChange={e => setEditForm(f => ({ ...f, cognome: e.target.value }))} className={inputCls} />
                  </div>
                  <div>
                    <label className="text-[10px] text-text3 block mb-0.5">Email</label>
                    <input value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} type="email" className={inputCls} />
                  </div>
                  <div>
                    <label className="text-[10px] text-text3 block mb-0.5">Telefono</label>
                    <input value={editForm.telefono} onChange={e => setEditForm(f => ({ ...f, telefono: e.target.value }))} placeholder="393471234567" className={inputCls} />
                  </div>
                  <div>
                    <label className="text-[10px] text-text3 block mb-0.5">Nuova password</label>
                    <input value={editForm.password} onChange={e => setEditForm(f => ({ ...f, password: e.target.value }))} type="password" placeholder="Lascia vuoto per non cambiare" className={inputCls} />
                  </div>
                  <div>
                    <label className="text-[10px] text-text3 block mb-0.5">WhatsApp</label>
                    <input value={editForm.whatsapp_phone} onChange={e => setEditForm(f => ({ ...f, whatsapp_phone: e.target.value }))} placeholder="393471234567" className={inputCls} />
                  </div>
                  <div>
                    <label className="text-[10px] text-text3 block mb-0.5">Ruolo</label>
                    <select value={editForm.ruolo} onChange={e => setEditForm(f => ({ ...f, ruolo: e.target.value }))} className={inputCls}>
                      <option value="admin">admin</option>
                      <option value="collaboratore">collaboratore</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-text3 block mb-0.5">Voce TTS</label>
                    <select value={editForm.tts_voice} onChange={e => setEditForm(f => ({ ...f, tts_voice: e.target.value }))} className={inputCls}>
                      <option value="">-- Nessuna --</option>
                      {TTS_VOICES.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                  <div className="flex items-center gap-2 pt-4">
                    <label className="flex items-center gap-1.5 text-[10px] text-text3 cursor-pointer">
                      <input type="checkbox" checked={editForm.whatsapp_active} onChange={e => setEditForm(f => ({ ...f, whatsapp_active: e.target.checked }))} className="rounded border-border" />
                      WhatsApp attivo
                    </label>
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-text3 block mb-1">Gruppi</label>
                  <div className="flex flex-wrap gap-2">
                    {groups.map(g => (
                      <label key={g.id} className="flex items-center gap-1 text-[10px] text-text2 cursor-pointer">
                        <input type="checkbox" checked={editForm.group_ids.includes(g.id)} onChange={() => toggleEditGroup(g.id)} className="rounded border-border" />
                        {g.name}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex justify-end">
                  <button onClick={saveEdit} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gold text-white rounded-lg">
                    <Save size={12} /> Salva
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════
// GROUPS TAB
// ═══════════════════════════════════════════════════════

function GroupsTab({ groups, users, agents, onReload }: { groups: Group[]; users: User[]; agents: Agent[]; onReload: () => void }) {
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [entityTypes, setEntityTypes] = useState<string[]>(ENTITY_TYPES)

  useEffect(() => {
    api('/entity-types').then(types => {
      if (Array.isArray(types)) setEntityTypes(types.map((t: any) => t.type))
    }).catch(() => {})
  }, [])

  const createGroup = async () => {
    if (!newName) return
    await api('/groups', 'POST', { name: newName, permissions: {}, agentPermissions: {} })
    toast.success(`Gruppo "${newName}" creato`)
    setNewName('')
    setShowNew(false)
    onReload()
  }

  const deleteGroup = async (id: string, name: string) => {
    if (!confirm(`Eliminare "${name}"?`)) return
    await api(`/groups/${id}`, 'DELETE')
    toast.success('Gruppo eliminato')
    onReload()
  }

  const togglePerm = async (groupId: string, group: Group, entityType: string, action: string) => {
    const perms = { ...group.permissions }
    const realTypes = TYPE_ALIASES[entityType] || [entityType]
    for (const rt of realTypes) {
      const current = perms[rt] || []
      if (current.includes(action)) { perms[rt] = current.filter(a => a !== action); if (perms[rt].length === 0) delete perms[rt] }
      else { perms[rt] = [...current, action] }
    }
    await api(`/groups/${groupId}`, 'PUT', { permissions: perms })
    onReload()
  }

  const toggleWildcard = async (groupId: string, group: Group) => {
    const hasWildcard = (group.permissions['*'] || []).length === ACTIONS.length
    const perms = { ...group.permissions }
    if (hasWildcard) {
      delete perms['*']
    } else {
      perms['*'] = [...ACTIONS]
    }
    await api(`/groups/${groupId}`, 'PUT', { permissions: perms })
    onReload()
  }

  const toggleAgentPerm = async (groupId: string, group: Group, domain: string, action: string) => {
    const agentPerms = { ...(group.agentPermissions || {}) }
    const current = agentPerms[domain] || []
    if (current.includes(action)) {
      agentPerms[domain] = current.filter(a => a !== action)
      if (agentPerms[domain].length === 0) delete agentPerms[domain]
    } else {
      agentPerms[domain] = [...current, action]
    }
    await api(`/groups/${groupId}`, 'PUT', { agentPermissions: agentPerms })
    onReload()
  }

  const addMember = async (groupId: string, userId: string) => {
    await api(`/groups/${groupId}/members`, 'POST', { user_id: userId })
    toast.success('Membro aggiunto')
    onReload()
  }

  const removeMember = async (groupId: string, userId: string) => {
    await api(`/groups/${groupId}/members/${userId}`, 'DELETE')
    toast.success('Membro rimosso')
    onReload()
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button onClick={() => setShowNew(!showNew)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gold hover:bg-gold-l text-white rounded-lg">
          <Plus size={14} /> Nuovo gruppo
        </button>
      </div>

      {showNew && (
        <div className="bg-bg2 border border-border rounded-xl p-4 flex gap-3 items-end">
          <div className="flex-1">
            <label className="text-[10px] text-text3 block mb-1">Nome gruppo</label>
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Es. Team Commerciale" className="w-full px-3 py-2 text-xs bg-bg3 border border-border rounded-lg text-text" />
          </div>
          <button onClick={() => setShowNew(false)} className="px-3 py-2 text-xs text-text3 border border-border rounded-lg">Annulla</button>
          <button onClick={createGroup} className="px-3 py-2 text-xs bg-gold text-white rounded-lg">Crea</button>
        </div>
      )}

      {groups.map(g => (
        <div key={g.id} className="bg-bg2 border border-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-bg3/50 cursor-pointer" onClick={() => setExpandedId(expandedId === g.id ? null : g.id)}>
            <div className="flex items-center gap-2">
              {expandedId === g.id ? <ChevronDown size={14} className="text-text3" /> : <ChevronRight size={14} className="text-text3" />}
              <Shield size={14} className="text-gold" />
              <span className="text-sm font-medium text-text">{g.name}</span>
              <span className="text-[10px] text-text3 bg-bg3 px-1.5 py-0.5 rounded">{g.members.length} membri</span>
            </div>
            <button onClick={e => { e.stopPropagation(); deleteGroup(g.id, g.name) }} className="p-1 rounded hover:bg-red/10 text-text3 hover:text-red"><Trash2 size={14} /></button>
          </div>

          {expandedId === g.id && (
            <div className="p-4 space-y-4">
              {/* Members */}
              <div>
                <h4 className="text-xs font-semibold text-text3 uppercase tracking-wider mb-2">Membri</h4>
                <div className="flex flex-wrap gap-2 mb-2">
                  {g.members.map(m => (
                    <div key={m.id} className="flex items-center gap-1.5 px-2 py-1 bg-bg3 rounded-lg text-xs text-text">
                      {m.display_name}
                      <button onClick={() => removeMember(g.id, m.id)} className="p-0.5 rounded hover:bg-red/10 text-text3 hover:text-red"><X size={12} /></button>
                    </div>
                  ))}
                </div>
                <select className="px-2 py-1 text-xs bg-bg3 border border-border rounded text-text" value="" onChange={e => { if (e.target.value) addMember(g.id, e.target.value); e.target.value = '' }}>
                  <option value="">+ Aggiungi membro...</option>
                  {users.filter(u => !g.members.some(m => m.id === u.id)).map(u => (
                    <option key={u.id} value={u.id}>{u.display_name} ({u.email})</option>
                  ))}
                </select>
              </div>

              {/* Entity Permissions */}
              <div>
                <h4 className="text-xs font-semibold text-text3 uppercase tracking-wider mb-2">Permessi Entita</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-[10px]">
                    <thead><tr className="bg-bg3">
                      <th className="px-2 py-1.5 text-left text-text3 font-medium w-28">Tipo</th>
                      {ACTIONS.map(a => <th key={a} className="px-2 py-1.5 text-center text-text3 font-medium w-14">{a}</th>)}
                    </tr></thead>
                    <tbody>
                      {/* Wildcard row */}
                      {(() => {
                        const hasWildcard = (g.permissions['*'] || []).length === ACTIONS.length
                        return (
                          <tr className="border-t border-border bg-yellow/5">
                            <td className="px-2 py-1 text-yellow font-bold text-[11px]">Tutti i permessi</td>
                            <td colSpan={ACTIONS.length} className="px-2 py-1 text-center">
                              <label className="flex items-center justify-center gap-1.5 cursor-pointer">
                                <input type="checkbox" checked={hasWildcard} onChange={() => toggleWildcard(g.id, g)} className="rounded border-border" />
                                <span className="text-[10px] text-yellow font-medium">{hasWildcard ? 'Attivo' : 'Disattivo'}</span>
                              </label>
                            </td>
                          </tr>
                        )
                      })()}
                      {entityTypes.map(et => (
                        <tr key={et} className="border-t border-border">
                          <td className="px-2 py-1 text-text font-medium">{et}</td>
                          {ACTIONS.map(a => {
                            const has = (TYPE_ALIASES[et] || [et]).some(rt => (g.permissions[rt] || []).includes(a))
                            return (
                              <td key={a} className="px-2 py-1 text-center">
                                <button onClick={() => togglePerm(g.id, g, et, a)} className={`w-5 h-5 rounded flex items-center justify-center transition-colors ${has ? 'bg-green/20 text-green' : 'bg-bg3 text-text3 hover:bg-bg4'}`}>
                                  {has && <Check size={12} />}
                                </button>
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Agent Permissions */}
              <div>
                <h4 className="text-xs font-semibold text-text3 uppercase tracking-wider mb-2">Accesso Agenti</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-[10px]">
                    <thead><tr className="bg-bg3">
                      <th className="px-2 py-1.5 text-left text-text3 font-medium w-40">Agente</th>
                      {AGENT_ACTIONS.map(a => <th key={a} className="px-2 py-1.5 text-center text-text3 font-medium w-20">{a}</th>)}
                    </tr></thead>
                    <tbody>
                      {agents.map(agent => {
                        const agentPerms = g.agentPermissions || {}
                        return (
                          <tr key={agent.domain} className="border-t border-border">
                            <td className="px-2 py-1 text-text font-medium">
                              <div className="flex items-center gap-1.5">
                                <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: agent.color }} />
                                {agent.name}
                              </div>
                            </td>
                            {AGENT_ACTIONS.map(a => {
                              const has = (agentPerms[agent.domain] || []).includes(a)
                              return (
                                <td key={a} className="px-2 py-1 text-center">
                                  <button onClick={() => toggleAgentPerm(g.id, g, agent.domain, a)} className={`w-5 h-5 rounded flex items-center justify-center transition-colors ${has ? 'bg-green/20 text-green' : 'bg-bg3 text-text3 hover:bg-bg4'}`}>
                                    {has && <Check size={12} />}
                                  </button>
                                </td>
                              )
                            })}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════
// AGENTS TAB
// ═══════════════════════════════════════════════════════

function AgentSettingsSection({ domain }: { domain: string }) {
  const [settings, setSettings] = useState<SystemSetting[]>([])
  const [editValues, setEditValues] = useState<Record<string, string>>({})
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set())
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const category = AGENT_SETTINGS_MAP[domain]

  useEffect(() => {
    if (!category) return
    setLoaded(false)
    api('/settings').then(res => {
      const grouped = res.grouped || {}
      const catSettings: SystemSetting[] = grouped[category] || []
      setSettings(catSettings)
      const vals: Record<string, string> = {}
      catSettings.forEach(s => { vals[s.key] = s.value || '' })
      setEditValues(vals)
      setLoaded(true)
    }).catch(() => setLoaded(true))
  }, [category])

  const saveSetting = async (key: string) => {
    setSavingKey(key)
    try {
      const res = await api(`/settings/${key}`, 'PUT', { value: editValues[key] })
      if (res.error) { toast.error(res.error) } else { toast.success('Impostazione salvata') }
    } catch (e: any) { toast.error(e.message) }
    finally { setSavingKey(null) }
  }

  const toggleVisible = (key: string) => {
    setVisibleKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  if (!category) {
    return (
      <div className="bg-bg3 rounded-lg p-3 text-xs text-text3 italic">
        Nessuna configurazione dinamica per questo agente.
      </div>
    )
  }

  if (!loaded) return <div className="text-text3 text-xs p-3">Caricamento impostazioni...</div>

  if (settings.length === 0) {
    return (
      <div className="bg-bg3 rounded-lg p-3 text-xs text-text3 italic">
        Nessuna impostazione trovata per la categoria "{CATEGORY_LABELS[category] || category}".
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {settings.map(s => (
        <div key={s.key} className="bg-bg3 rounded-lg p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs text-text font-medium">{s.description || s.key}</span>
              <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                s.source === 'db' ? 'bg-green/10 text-green' : s.source === 'env' ? 'bg-blue/10 text-blue' : 'bg-bg4 text-text3'
              }`}>{s.source.toUpperCase()}</span>
              {s.requiresRestart && <span className="text-[9px] px-1.5 py-0.5 rounded bg-yellow/10 text-yellow">restart</span>}
            </div>
          </div>
          <div className="flex gap-2 items-center">
            <div className="relative flex-1">
              <input
                type={s.sensitive && !visibleKeys.has(s.key) ? 'password' : 'text'}
                value={editValues[s.key] || ''}
                onChange={e => setEditValues(prev => ({ ...prev, [s.key]: e.target.value }))}
                placeholder={s.defaultValue || s.envVar}
                className="w-full px-3 py-1.5 text-xs bg-bg2 border border-border rounded-lg text-text pr-8"
              />
              {s.sensitive && (
                <button onClick={() => toggleVisible(s.key)} className="absolute right-2 top-1/2 -translate-y-1/2 text-text3 hover:text-text2">
                  {visibleKeys.has(s.key) ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              )}
            </div>
            <button
              onClick={() => saveSetting(s.key)}
              disabled={savingKey === s.key}
              className="px-2.5 py-1.5 text-xs bg-gold hover:bg-gold-l text-white rounded-lg disabled:opacity-50 shrink-0"
            >
              {savingKey === s.key ? '...' : <Save size={12} />}
            </button>
          </div>
          <div className="text-[10px] text-text3">{s.envVar}</div>
        </div>
      ))}
    </div>
  )
}

function AgentsTab({ agents, onReload }: { agents: Agent[]; onReload: () => void }) {
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null)
  const [editRules, setEditRules] = useState<string[]>([])
  const [editModel, setEditModel] = useState('')
  const [newRule, setNewRule] = useState('')
  const [saving, setSaving] = useState(false)
  const [editedPrompt, setEditedPrompt] = useState('')
  const [promptModified, setPromptModified] = useState(false)
  const [savingPrompt, setSavingPrompt] = useState(false)

  const MODEL_OPTIONS = [
    { value: '', label: '-- Default --' },
    { value: 'anthropic/claude-haiku-4.5-20251001', label: 'Claude Haiku 4.5' },
    { value: 'anthropic/claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
    { value: 'anthropic/claude-opus-4-20250514', label: 'Claude Opus 4' },
    { value: 'google/gemini-2.5-flash-preview', label: 'Gemini 2.5 Flash' },
  ]

  const selectAgent = (domain: string) => {
    if (expandedDomain === domain) { setExpandedDomain(null); return }
    setExpandedDomain(domain)
    const agent = agents.find(a => a.domain === domain)
    setEditRules(agent?.skillRules || [])
    setEditModel(agent?.skillModel || '')
    setEditedPrompt(agent?.systemPrompt || '')
    setPromptModified(false)
    setNewRule('')
  }

  const savePrompt = async () => {
    if (!expandedDomain) return
    setSavingPrompt(true)
    try {
      await api(`/agents/${expandedDomain}`, 'PUT', { system_prompt: editedPrompt })
      toast.success('Prompt salvato')
      setPromptModified(false)
      onReload()
    } catch (e: any) { toast.error(e.message) }
    finally { setSavingPrompt(false) }
  }

  const addRule = () => {
    if (!newRule.trim()) return
    setEditRules([...editRules, newRule.trim()])
    setNewRule('')
  }

  const removeRule = (idx: number) => {
    setEditRules(editRules.filter((_, i) => i !== idx))
  }

  const saveAgent = async () => {
    if (!expandedDomain) return
    setSaving(true)
    try {
      const body: any = { rules: editRules }
      if (editModel) body.model = editModel
      await api(`/agents/${expandedDomain}`, 'PUT', body)
      toast.success('Agente aggiornato')
      onReload()
    } catch (e: any) { toast.error(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-text3 mb-3">Configura regole, modello e comportamento degli agenti. Le modifiche alle regole si applicano subito; il prompt di sistema richiede un riavvio.</p>

      {agents.map(agent => (
        <div key={agent.domain} className="bg-bg2 border border-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-bg3/30 transition-colors" onClick={() => selectAgent(agent.domain)}>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: agent.color }} />
              <div>
                <span className="text-sm font-medium text-text">{agent.name}</span>
                <span className="text-[10px] text-text3 ml-2">{agent.domain}</span>
              </div>
              {agent.hasSkillOverride && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gold/10 text-gold">personalizzato</span>
              )}
            </div>
            <div className="flex items-center gap-3 text-[10px] text-text3">
              <span>{agent.toolCount} tool</span>
              <span>{Math.round(agent.promptLength / 100) / 10}k prompt</span>
              {expandedDomain === agent.domain ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </div>
          </div>

          {expandedDomain === agent.domain && (
            <div className="p-4 border-t border-border space-y-4">
              {/* Info */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-bg3 rounded-lg p-3">
                  <div className="text-[10px] text-text3 uppercase tracking-wider mb-1">Modello</div>
                  <div className="text-xs text-text font-medium">{agent.model}</div>
                </div>
                <div className="bg-bg3 rounded-lg p-3">
                  <div className="text-[10px] text-text3 uppercase tracking-wider mb-1">Tool</div>
                  <div className="text-xs text-text font-medium">{agent.toolCount} strumenti</div>
                </div>
                <div className="bg-bg3 rounded-lg p-3">
                  <div className="text-[10px] text-text3 uppercase tracking-wider mb-1">Prompt</div>
                  <div className="text-xs text-text font-medium">{agent.promptLength} caratteri</div>
                </div>
              </div>

              {/* Prompt editor */}
              <div>
                <h4 className="text-xs font-semibold text-text3 uppercase tracking-wider mb-1">Prompt di sistema</h4>
                {promptModified && (
                  <div className="flex items-center gap-2 mb-2 px-3 py-2 bg-yellow/10 border border-yellow/30 rounded-lg">
                    <AlertTriangle size={14} className="text-yellow shrink-0" />
                    <span className="text-[11px] text-yellow">Le modifiche al prompt richiedono un riavvio</span>
                  </div>
                )}
                <textarea
                  rows={12}
                  value={editedPrompt}
                  onChange={e => { setEditedPrompt(e.target.value); setPromptModified(true) }}
                  className="w-full px-3 py-2 text-xs bg-bg3 border border-border rounded-lg text-text font-mono leading-relaxed resize-y"
                />
                <div className="flex justify-end mt-1.5">
                  <button onClick={savePrompt} disabled={savingPrompt || !promptModified} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gold hover:bg-gold-l text-white rounded-lg disabled:opacity-50">
                    <Save size={12} /> {savingPrompt ? 'Salvataggio...' : 'Salva prompt'}
                  </button>
                </div>
              </div>

              {/* Tools list */}
              <div>
                <h4 className="text-xs font-semibold text-text3 uppercase tracking-wider mb-1">Strumenti</h4>
                <div className="flex flex-wrap gap-1">
                  {agent.toolNames.map(t => (
                    <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-bg3 text-text2">{t}</span>
                  ))}
                </div>
              </div>

              {/* Editable rules */}
              <div>
                <h4 className="text-xs font-semibold text-text3 uppercase tracking-wider mb-2">Regole personalizzate</h4>
                {editRules.length === 0 && <p className="text-[11px] text-text3 italic mb-2">Nessuna regola aggiuntiva</p>}
                <div className="space-y-1 mb-2">
                  {editRules.map((rule, i) => (
                    <div key={i} className="flex items-start gap-2 bg-bg3 rounded-lg px-3 py-2">
                      <span className="text-xs text-text flex-1">{rule}</span>
                      <button onClick={() => removeRule(i)} className="p-0.5 rounded hover:bg-red/10 text-text3 hover:text-red shrink-0"><X size={12} /></button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input value={newRule} onChange={e => setNewRule(e.target.value)} onKeyDown={e => e.key === 'Enter' && addRule()}
                    placeholder="Nuova regola..." className="flex-1 px-3 py-1.5 text-xs bg-bg3 border border-border rounded-lg text-text" />
                  <button onClick={addRule} className="px-3 py-1.5 text-xs bg-bg3 border border-border rounded-lg text-text2 hover:bg-bg4">Aggiungi</button>
                </div>
              </div>

              {/* Model override */}
              <div>
                <h4 className="text-xs font-semibold text-text3 uppercase tracking-wider mb-1">Override modello</h4>
                <select value={editModel} onChange={e => setEditModel(e.target.value)} className="w-full px-3 py-1.5 text-xs bg-bg3 border border-border rounded-lg text-text">
                  {MODEL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}{o.value ? ` (${o.value})` : ''}</option>)}
                </select>
              </div>

              {/* Agent-specific settings */}
              <div>
                <h4 className="text-xs font-semibold text-text3 uppercase tracking-wider mb-2">Configurazione</h4>
                <AgentSettingsSection domain={agent.domain} />
              </div>

              {/* Save */}
              <div className="flex justify-end">
                <button onClick={saveAgent} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 text-xs bg-gold hover:bg-gold-l text-white rounded-lg disabled:opacity-50">
                  <Save size={14} /> {saving ? 'Salvataggio...' : 'Salva modifiche'}
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════
// AUDIT LOG TAB
// ═══════════════════════════════════════════════════════

function AuditTab({ logs, onReload }: { logs: AuditEntry[]; onReload: () => void }) {
  const [filter, setFilter] = useState('')

  const actionColors: Record<string, string> = {
    create: 'bg-green/10 text-green',
    update: 'bg-blue/10 text-blue',
    soft_delete: 'bg-yellow/10 text-yellow',
    hard_delete: 'bg-red/10 text-red',
  }

  const filtered = filter
    ? logs.filter(l => l.action.includes(filter) || l.entity_type?.includes(filter) || l.entity_name?.toLowerCase().includes(filter.toLowerCase()))
    : logs

  return (
    <div className="space-y-3">
      <div className="flex gap-2 justify-between">
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filtra per tipo, azione o nome..." className="px-3 py-1.5 text-xs bg-bg2 border border-border rounded-lg text-text w-64" />
        <button onClick={onReload} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-bg2 border border-border rounded-lg text-text2 hover:bg-bg3">
          <RefreshCw size={12} /> Aggiorna
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-bg2 border border-border rounded-xl p-8 text-center text-text3 text-sm">Nessuna voce nel log di audit</div>
      ) : (
        <div className="bg-bg2 border border-border rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead><tr className="bg-bg3">
              <th className="px-3 py-2.5 text-left text-text3 font-medium w-36">Data</th>
              <th className="px-3 py-2.5 text-left text-text3 font-medium w-20">Azione</th>
              <th className="px-3 py-2.5 text-left text-text3 font-medium w-24">Tipo</th>
              <th className="px-3 py-2.5 text-left text-text3 font-medium">Entity</th>
              <th className="px-3 py-2.5 text-left text-text3 font-medium">Dettagli</th>
            </tr></thead>
            <tbody>
              {filtered.map(log => {
                const before = log.before_data ? JSON.parse(log.before_data) : null
                const after = log.after_data ? JSON.parse(log.after_data) : null
                const detail = after?.display_name || before?.display_name || log.entity_name || log.entity_id?.substring(0, 8)

                return (
                  <tr key={log.id} className="border-t border-border hover:bg-bg3/50">
                    <td className="px-3 py-2 text-text2 font-mono">{new Date(log.created_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
                    <td className="px-3 py-2"><span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${actionColors[log.action] || 'bg-bg3 text-text3'}`}>{log.action}</span></td>
                    <td className="px-3 py-2 text-text2">{log.entity_type || '-'}</td>
                    <td className="px-3 py-2 text-text font-medium">{detail}</td>
                    <td className="px-3 py-2 text-text3 truncate max-w-xs">{after ? JSON.stringify(after).substring(0, 80) : '-'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════
// SETTINGS TAB
// ═══════════════════════════════════════════════════════

function SettingsTab({ stats, onReload }: { stats: SystemStats | null; onReload: () => void }) {
  const [allSettings, setAllSettings] = useState<Record<string, SystemSetting[]>>({})
  const [editValues, setEditValues] = useState<Record<string, string>>({})
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set())
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set())
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [settingsLoaded, setSettingsLoaded] = useState(false)

  useEffect(() => {
    api('/settings').then(res => {
      const grouped: Record<string, SystemSetting[]> = res.grouped || {}
      setAllSettings(grouped)
      const vals: Record<string, string> = {}
      Object.values(grouped).flat().forEach(s => { vals[s.key] = s.value || '' })
      setEditValues(vals)
      setSettingsLoaded(true)
    }).catch(() => setSettingsLoaded(true))
  }, [])

  const saveSetting = async (key: string) => {
    setSavingKey(key)
    try {
      const res = await api(`/settings/${key}`, 'PUT', { value: editValues[key] })
      if (res.error) { toast.error(res.error) } else { toast.success('Impostazione salvata') }
    } catch (e: any) { toast.error(e.message) }
    finally { setSavingKey(null) }
  }

  const toggleVisible = (key: string) => {
    setVisibleKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const toggleCategory = (cat: string) => {
    setExpandedCats(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat); else next.add(cat)
      return next
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={onReload} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-bg2 border border-border rounded-lg text-text2 hover:bg-bg3">
          <RefreshCw size={12} /> Aggiorna
        </button>
      </div>

      {/* Stats cards */}
      {stats && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Entita totali', value: stats.totalEntities, icon: Database },
              { label: 'Utenti', value: stats.users, icon: Users },
              { label: 'Documenti', value: stats.documents, icon: Settings },
              { label: 'Chunk indicizzati', value: stats.chunks, icon: Activity },
              { label: 'Entita con embedding', value: stats.embeddedEntities, icon: Bot },
              { label: 'Sessioni (7gg)', value: stats.recentSessions, icon: Activity },
              { label: 'Audit (24h)', value: stats.recentAudits, icon: AlertTriangle },
              { label: 'DB size', value: `${stats.dbSizeMB} MB`, icon: Database },
            ].map((s, i) => (
              <div key={i} className="bg-bg2 border border-border rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <s.icon size={14} className="text-gold" />
                  <span className="text-[10px] text-text3 uppercase tracking-wider">{s.label}</span>
                </div>
                <div className="text-lg font-bold text-text">{s.value}</div>
              </div>
            ))}
          </div>

          {/* Entity type breakdown */}
          <div className="bg-bg2 border border-border rounded-xl p-4">
            <h3 className="text-xs font-semibold text-text3 uppercase tracking-wider mb-3">Entita per tipo</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {stats.typeCounts.map(tc => (
                <div key={tc.type} className="flex items-center justify-between bg-bg3 rounded-lg px-3 py-2">
                  <span className="text-xs text-text">{tc.type}</span>
                  <span className="text-xs font-bold text-gold">{tc.count}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Settings editor by category */}
      {settingsLoaded && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-text3 uppercase tracking-wider">Impostazioni di sistema</h3>

          {Object.entries(allSettings).map(([category, settings]) => (
            <div key={category} className="bg-bg2 border border-border rounded-xl overflow-hidden">
              <div
                className="flex items-center justify-between px-4 py-3 bg-bg3/50 cursor-pointer"
                onClick={() => toggleCategory(category)}
              >
                <div className="flex items-center gap-2">
                  {expandedCats.has(category) ? <ChevronDown size={14} className="text-text3" /> : <ChevronRight size={14} className="text-text3" />}
                  <Settings size={14} className="text-gold" />
                  <span className="text-sm font-medium text-text">{CATEGORY_LABELS[category] || category}</span>
                  <span className="text-[10px] text-text3 bg-bg3 px-1.5 py-0.5 rounded">{settings.length}</span>
                </div>
              </div>

              {expandedCats.has(category) && (
                <div className="p-4 space-y-3">
                  {settings.map(s => (
                    <div key={s.key} className="bg-bg3 rounded-lg p-3 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-text font-medium">{s.description || s.key}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                          s.source === 'db' ? 'bg-green/10 text-green' : s.source === 'env' ? 'bg-blue/10 text-blue' : 'bg-bg4 text-text3'
                        }`}>{s.source.toUpperCase()}</span>
                        {s.requiresRestart && <span className="text-[9px] px-1.5 py-0.5 rounded bg-yellow/10 text-yellow">restart</span>}
                      </div>
                      <div className="flex gap-2 items-center">
                        <div className="relative flex-1">
                          <input
                            type={s.sensitive && !visibleKeys.has(s.key) ? 'password' : 'text'}
                            value={editValues[s.key] || ''}
                            onChange={e => setEditValues(prev => ({ ...prev, [s.key]: e.target.value }))}
                            placeholder={s.defaultValue || s.envVar}
                            className="w-full px-3 py-1.5 text-xs bg-bg2 border border-border rounded-lg text-text pr-8"
                          />
                          {s.sensitive && (
                            <button onClick={() => toggleVisible(s.key)} className="absolute right-2 top-1/2 -translate-y-1/2 text-text3 hover:text-text2">
                              {visibleKeys.has(s.key) ? <EyeOff size={12} /> : <Eye size={12} />}
                            </button>
                          )}
                        </div>
                        <button
                          onClick={() => saveSetting(s.key)}
                          disabled={savingKey === s.key}
                          className="px-2.5 py-1.5 text-xs bg-gold hover:bg-gold-l text-white rounded-lg disabled:opacity-50 shrink-0"
                        >
                          {savingKey === s.key ? '...' : <Save size={12} />}
                        </button>
                      </div>
                      <div className="text-[10px] text-text3">{s.envVar}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!settingsLoaded && (
        <div className="text-text3 text-sm p-4 text-center">Caricamento impostazioni...</div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════
// API & DEVICES TAB
// ═══════════════════════════════════════════════════════

function ApiTab() {
  const [tokens, setTokens] = useState<ApiToken[]>([])
  const [newName, setNewName] = useState('')
  const [newExpiry, setNewExpiry] = useState('90')
  const [createdKey, setCreatedKey] = useState('')
  const [creating, setCreating] = useState(false)
  const [copied, setCopied] = useState('')

  const loadTokens = useCallback(async () => {
    const t = await authApi('/tokens')
    setTokens(Array.isArray(t) ? t : [])
  }, [])

  useEffect(() => { loadTokens() }, [loadTokens])

  const createToken = async () => {
    setCreating(true)
    try {
      const res = await authApi('/tokens', 'POST', {
        name: newName || 'API Key',
        expires_in_days: newExpiry ? parseInt(newExpiry) : null,
      })
      if (res.key) {
        setCreatedKey(res.key)
        setNewName('')
        loadTokens()
        toast.success('Token creato')
      } else {
        toast.error(res.error || 'Errore')
      }
    } finally { setCreating(false) }
  }

  const revokeToken = async (id: string, name: string) => {
    if (!confirm(`Revocare "${name}"? Le device che lo usano smetteranno di funzionare.`)) return
    await authApi(`/tokens/${id}`, 'DELETE')
    toast.success('Token revocato')
    loadTokens()
  }

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(''), 2000)
    toast.success('Copiato!')
  }

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://localhost:3000'

  return (
    <div className="space-y-4">
      {/* Header info */}
      <div className="bg-bg2 border border-border rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <Cpu size={16} className="text-gold" />
          <h3 className="text-sm font-semibold text-text">API OpenAI-Compatible</h3>
        </div>
        <p className="text-[11px] text-text3 mb-3">
          Qualsiasi device o applicazione che supporta lo standard OpenAI (ESP32, Home Assistant, app custom) puo collegarsi a {'{COMPANY_NAME}'} usando questi endpoint.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="bg-bg3 rounded-lg p-3">
            <div className="text-[10px] text-text3 uppercase tracking-wider mb-1">Base URL</div>
            <div className="flex items-center gap-2">
              <code className="text-xs text-gold font-mono flex-1">{baseUrl}/v1</code>
              <button onClick={() => copyToClipboard(`${baseUrl}/v1`, 'url')} className="p-1 rounded hover:bg-bg4 text-text3">
                {copied === 'url' ? <Check size={12} className="text-green" /> : <Copy size={12} />}
              </button>
            </div>
          </div>
          <div className="bg-bg3 rounded-lg p-3">
            <div className="text-[10px] text-text3 uppercase tracking-wider mb-1">Endpoint Chat</div>
            <code className="text-xs text-text2 font-mono">POST /v1/chat/completions</code>
          </div>
          <div className="bg-bg3 rounded-lg p-3">
            <div className="text-[10px] text-text3 uppercase tracking-wider mb-1">Lista Modelli (Agenti)</div>
            <code className="text-xs text-text2 font-mono">GET /v1/models</code>
          </div>
          <div className="bg-bg3 rounded-lg p-3">
            <div className="text-[10px] text-text3 uppercase tracking-wider mb-1">Auth Header</div>
            <code className="text-xs text-text2 font-mono">Authorization: Bearer brd-...</code>
          </div>
        </div>
      </div>

      {/* Token Management */}
      <div className="bg-bg2 border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Key size={16} className="text-gold" />
            <h3 className="text-sm font-semibold text-text">Token API</h3>
          </div>
          <button onClick={loadTokens} className="p-1 rounded hover:bg-bg3 text-text3"><RefreshCw size={14} /></button>
        </div>

        {/* Create new token */}
        <div className="bg-bg3 rounded-lg p-3 mb-3">
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="text-[10px] text-text3 block mb-1">Nome dispositivo</label>
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Es. ESP32 Ufficio, Home Assistant" className="w-full px-3 py-1.5 text-xs bg-bg border border-border rounded-lg text-text" />
            </div>
            <div className="w-28">
              <label className="text-[10px] text-text3 block mb-1">Scadenza (giorni)</label>
              <input value={newExpiry} onChange={e => setNewExpiry(e.target.value)} placeholder="90" type="number" className="w-full px-3 py-1.5 text-xs bg-bg border border-border rounded-lg text-text" />
            </div>
            <button onClick={createToken} disabled={creating} className="px-3 py-1.5 text-xs bg-gold hover:bg-gold-l text-white rounded-lg disabled:opacity-50 whitespace-nowrap">
              <Plus size={12} className="inline mr-1" /> Genera
            </button>
          </div>
        </div>

        {/* Show created key (only once) */}
        {createdKey && (
          <div className="bg-green/5 border border-green/20 rounded-lg p-3 mb-3">
            <div className="text-xs text-green font-medium mb-1">Token generato — copialo ora, non verra mostrato di nuovo!</div>
            <div className="flex items-center gap-2">
              <code className="text-xs text-text font-mono bg-bg3 px-2 py-1 rounded flex-1 select-all">{createdKey}</code>
              <button onClick={() => copyToClipboard(createdKey, 'key')} className="px-2 py-1 text-xs bg-green/10 text-green rounded hover:bg-green/20">
                {copied === 'key' ? <Check size={12} /> : <Copy size={12} />}
              </button>
              <button onClick={() => setCreatedKey('')} className="p-1 rounded hover:bg-bg3 text-text3"><X size={14} /></button>
            </div>
          </div>
        )}

        {/* Token list */}
        {tokens.length === 0 ? (
          <p className="text-[11px] text-text3 text-center py-4">Nessun token creato</p>
        ) : (
          <div className="space-y-1.5">
            {tokens.map(t => (
              <div key={t.id} className={`flex items-center gap-3 bg-bg3 rounded-lg px-3 py-2 ${t.revoked_at ? 'opacity-40' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-text">{t.name}</span>
                    <code className="text-[10px] text-text3 font-mono">{t.token_preview}</code>
                    {t.revoked_at && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red/10 text-red">revocato</span>}
                  </div>
                  <div className="flex gap-3 mt-0.5 text-[10px] text-text3">
                    <span>Creato: {new Date(t.created_at).toLocaleDateString('it-IT')}</span>
                    {t.expires_at && <span>Scade: {new Date(t.expires_at).toLocaleDateString('it-IT')}</span>}
                    {t.last_used_at && (
                      <span className="flex items-center gap-0.5"><Clock size={10} /> Ultimo uso: {new Date(t.last_used_at).toLocaleDateString('it-IT')}</span>
                    )}
                  </div>
                </div>
                {!t.revoked_at && (
                  <button onClick={() => revokeToken(t.id, t.name)} className="p-1.5 rounded hover:bg-red/10 text-text3 hover:text-red" title="Revoca">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Model options */}
      <div className="bg-bg2 border border-border rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Bot size={16} className="text-gold" />
          <h3 className="text-sm font-semibold text-text">Modelli disponibili</h3>
        </div>
        <p className="text-[11px] text-text3 mb-2">Usa il campo <code className="bg-bg3 px-1 rounded">model</code> per scegliere l'agente. Aggiungi un suffisso profilo (es. <code className="bg-bg3 px-1 rounded">-voice</code>, <code className="bg-bg3 px-1 rounded">-brief</code>, <code className="bg-bg3 px-1 rounded">-json</code>) per formati di risposta personalizzati.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead><tr className="bg-bg3">
              <th className="px-3 py-1.5 text-left text-text3 font-medium">Model ID</th>
              <th className="px-3 py-1.5 text-left text-text3 font-medium">Descrizione</th>
              <th className="px-3 py-1.5 text-left text-text3 font-medium">Voice</th>
            </tr></thead>
            <tbody>
              <tr className="border-t border-border">
                <td className="px-3 py-1.5"><code className="text-gold font-mono">fiai-os</code></td>
                <td className="px-3 py-1.5 text-text2">Auto-routing — il sistema sceglie l'agente giusto</td>
                <td className="px-3 py-1.5"><code className="text-text3 font-mono">fiai-os-voice</code></td>
              </tr>
              {['direzione', 'commerciale', 'amministrazione', 'produzione', 'email', 'whatsapp'].map(d => (
                <tr key={d} className="border-t border-border">
                  <td className="px-3 py-1.5"><code className="text-text font-mono">{d}</code></td>
                  <td className="px-3 py-1.5 text-text2">Forza agente {d}</td>
                  <td className="px-3 py-1.5"><code className="text-text3 font-mono">{d}-voice</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Response Profiles */}
      <ResponseProfilesSection />

      {/* ESP32 / Device Guide */}
      <div className="bg-bg2 border border-border rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Cpu size={16} className="text-gold" />
          <h3 className="text-sm font-semibold text-text">Guida Integrazione Device</h3>
        </div>

        <div className="space-y-3">
          {/* ESP32 */}
          <div className="bg-bg3 rounded-lg p-3">
            <h4 className="text-xs font-semibold text-text mb-2">ESP32 / Arduino</h4>
            <p className="text-[10px] text-text3 mb-2">Configura il tuo ESP32 come client OpenAI. Usa il modello <code className="bg-bg px-1 rounded">fiai-os-voice</code> per risposte ottimizzate per TTS.</p>
            <pre className="text-[10px] text-text2 font-mono bg-bg rounded-lg p-2 overflow-x-auto whitespace-pre">{`// Arduino / ESP32 — configurazione
#define API_BASE_URL "${baseUrl}/v1"
#define API_KEY      "brd-... (il tuo token)"
#define MODEL        "fiai-os-voice"

// Headers HTTP
// Authorization: Bearer brd-...
// Content-Type: application/json

// Body POST /v1/chat/completions
// {"model":"fiai-os-voice",
//  "messages":[{"role":"user","content":"..."}],
//  "stream":false}`}</pre>
          </div>

          {/* curl */}
          <div className="bg-bg3 rounded-lg p-3">
            <h4 className="text-xs font-semibold text-text mb-2">cURL (test rapido)</h4>
            <div className="flex items-start gap-2">
              <pre className="text-[10px] text-text2 font-mono bg-bg rounded-lg p-2 overflow-x-auto whitespace-pre flex-1">{`curl -X POST ${baseUrl}/v1/chat/completions \\
  -H "Authorization: Bearer brd-IL_TUO_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"fiai-os-voice",
       "messages":[{"role":"user",
                    "content":"Che ore sono?"}]}'`}</pre>
              <button onClick={() => copyToClipboard(`curl -X POST ${baseUrl}/v1/chat/completions -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d '{"model":"fiai-os-voice","messages":[{"role":"user","content":"Che ore sono?"}]}'`, 'curl')} className="p-1.5 rounded hover:bg-bg4 text-text3 shrink-0">
                {copied === 'curl' ? <Check size={12} className="text-green" /> : <Copy size={12} />}
              </button>
            </div>
          </div>

          {/* Python */}
          <div className="bg-bg3 rounded-lg p-3">
            <h4 className="text-xs font-semibold text-text mb-2">Python (openai SDK)</h4>
            <pre className="text-[10px] text-text2 font-mono bg-bg rounded-lg p-2 overflow-x-auto whitespace-pre">{`from openai import OpenAI

client = OpenAI(
    base_url="${baseUrl}/v1",
    api_key="brd-IL_TUO_TOKEN"
)

response = client.chat.completions.create(
    model="fiai-os",
    messages=[{"role": "user",
               "content": "Quanti clienti abbiamo?"}]
)
print(response.choices[0].message.content)`}</pre>
          </div>

          {/* Features */}
          <div className="bg-bg3 rounded-lg p-3">
            <h4 className="text-xs font-semibold text-text mb-2">Funzionalita supportate</h4>
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div className="flex items-center gap-1.5"><Check size={12} className="text-green" /><span className="text-text2">Chat completions (streaming + sync)</span></div>
              <div className="flex items-center gap-1.5"><Check size={12} className="text-green" /><span className="text-text2">Formato voice (-voice) per audio devices</span></div>
              <div className="flex items-center gap-1.5"><Check size={12} className="text-green" /><span className="text-text2">Selezione agente via model field</span></div>
              <div className="flex items-center gap-1.5"><Check size={12} className="text-green" /><span className="text-text2">Sessioni persistenti (cross-channel)</span></div>
              <div className="flex items-center gap-1.5"><Check size={12} className="text-green" /><span className="text-text2">Vision (immagini base64 in messages)</span></div>
              <div className="flex items-center gap-1.5"><Check size={12} className="text-green" /><span className="text-text2">Permessi utente (dal gruppo del proprietario token)</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════
// RESPONSE PROFILES SECTION
// ═══════════════════════════════════════════════════════

interface ResponseProfile { slug: string; name: string; description: string; prompt: string; source: 'db' | 'default' }

function ResponseProfilesSection() {
  const [profiles, setProfiles] = useState<ResponseProfile[]>([])
  const [editingSlug, setEditingSlug] = useState<string | null>(null)
  const [editPrompt, setEditPrompt] = useState('')
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [newSlug, setNewSlug] = useState('')
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newPrompt, setNewPrompt] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const p = await api('/response-profiles')
    setProfiles(Array.isArray(p) ? p : [])
  }, [])

  useEffect(() => { load() }, [load])

  const startEdit = (p: ResponseProfile) => {
    setEditingSlug(p.slug)
    setEditPrompt(p.prompt)
    setEditName(p.name)
    setEditDesc(p.description)
  }

  const saveEdit = async () => {
    if (!editingSlug) return
    setSaving(true)
    await api(`/response-profiles/${editingSlug}`, 'PUT', { name: editName, description: editDesc, prompt: editPrompt })
    toast.success('Profilo aggiornato')
    setEditingSlug(null)
    setSaving(false)
    load()
  }

  const createProfile = async () => {
    if (!newSlug || !newPrompt) { toast.error('Slug e prompt obbligatori'); return }
    setSaving(true)
    const res = await api('/response-profiles', 'POST', { slug: newSlug, name: newName || newSlug, description: newDesc, prompt: newPrompt })
    if (res.error) { toast.error(res.error); setSaving(false); return }
    toast.success('Profilo creato')
    setShowNew(false)
    setNewSlug(''); setNewName(''); setNewDesc(''); setNewPrompt('')
    setSaving(false)
    load()
  }

  const deleteProfile = async (slug: string) => {
    if (!confirm(`Eliminare il profilo "${slug}"?`)) return
    await api(`/response-profiles/${slug}`, 'DELETE')
    toast.success('Profilo eliminato')
    load()
  }

  return (
    <div className="bg-bg2 border border-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Settings size={16} className="text-gold" />
          <h3 className="text-sm font-semibold text-text">Profili di risposta</h3>
        </div>
        <button onClick={() => setShowNew(!showNew)} className="flex items-center gap-1 px-2 py-1 text-[10px] bg-gold hover:bg-gold-l text-white rounded-lg">
          <Plus size={12} /> Nuovo profilo
        </button>
      </div>

      <p className="text-[10px] text-text3 mb-3">
        I profili controllano come gli agenti formattano le risposte. Usali con suffisso nel model (es. <code className="bg-bg3 px-1 rounded">-voice</code>), header <code className="bg-bg3 px-1 rounded">X-Response-Format</code>, o campo <code className="bg-bg3 px-1 rounded">response_format</code>.
      </p>

      {showNew && (
        <div className="bg-bg3 rounded-lg p-3 mb-3 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] text-text3 block mb-0.5">Slug (suffisso) *</label>
              <input value={newSlug} onChange={e => setNewSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder="es. telegram" className="w-full px-2 py-1 text-xs bg-bg border border-border rounded text-text font-mono" />
            </div>
            <div>
              <label className="text-[10px] text-text3 block mb-0.5">Nome</label>
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="es. Telegram" className="w-full px-2 py-1 text-xs bg-bg border border-border rounded text-text" />
            </div>
            <div>
              <label className="text-[10px] text-text3 block mb-0.5">Descrizione</label>
              <input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Per..." className="w-full px-2 py-1 text-xs bg-bg border border-border rounded text-text" />
            </div>
          </div>
          <div>
            <label className="text-[10px] text-text3 block mb-0.5">Prompt (istruzioni agente) *</label>
            <textarea value={newPrompt} onChange={e => setNewPrompt(e.target.value)} rows={4} placeholder="FORMATO ... — Rispondi in modo ..." className="w-full px-2 py-1.5 text-xs bg-bg border border-border rounded text-text font-mono resize-y" />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowNew(false)} className="px-2 py-1 text-xs text-text3 border border-border rounded">Annulla</button>
            <button onClick={createProfile} disabled={saving} className="px-2 py-1 text-xs bg-gold text-white rounded disabled:opacity-50">Crea</button>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        {profiles.map(p => (
          <div key={p.slug} className="bg-bg3 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 cursor-pointer" onClick={() => editingSlug === p.slug ? setEditingSlug(null) : startEdit(p)}>
              <div className="flex items-center gap-2">
                <code className="text-xs text-gold font-mono">-{p.slug}</code>
                <span className="text-xs text-text font-medium">{p.name}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg2 text-text3">{p.source === 'db' ? 'personalizzato' : 'predefinito'}</span>
              </div>
              <div className="flex items-center gap-1">
                {p.source === 'db' && (
                  <button onClick={e => { e.stopPropagation(); deleteProfile(p.slug) }} className="p-1 rounded hover:bg-red/10 text-text3 hover:text-red"><Trash2 size={12} /></button>
                )}
                {editingSlug === p.slug ? <ChevronDown size={14} className="text-text3" /> : <ChevronRight size={14} className="text-text3" />}
              </div>
            </div>

            {editingSlug === p.slug && (
              <div className="px-3 pb-3 space-y-2 border-t border-border pt-2">
                <p className="text-[10px] text-text3">{p.description}</p>
                <div className="grid grid-cols-2 gap-2">
                  <input value={editName} onChange={e => setEditName(e.target.value)} placeholder="Nome" className="px-2 py-1 text-xs bg-bg border border-border rounded text-text" />
                  <input value={editDesc} onChange={e => setEditDesc(e.target.value)} placeholder="Descrizione" className="px-2 py-1 text-xs bg-bg border border-border rounded text-text" />
                </div>
                <textarea value={editPrompt} onChange={e => setEditPrompt(e.target.value)} rows={6} className="w-full px-2 py-1.5 text-xs bg-bg border border-border rounded text-text font-mono resize-y leading-relaxed" />
                <div className="flex justify-end">
                  <button onClick={saveEdit} disabled={saving} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gold text-white rounded-lg disabled:opacity-50">
                    <Save size={12} /> {saving ? 'Salvataggio...' : 'Salva'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════
// VPN TAB
// ═══════════════════════════════════════════════════════

interface VpnStatus { status: string; connectedAt: string | null; error: string; configFile: string; configExists: boolean; tunActive: boolean; log: string }

function VpnTab() {
  const [vpn, setVpn] = useState<VpnStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [showLog, setShowLog] = useState(false)

  const loadStatus = useCallback(async () => {
    try { const s = await vpnApi('/status'); setVpn(s) } catch {}
  }, [])

  useEffect(() => { loadStatus() }, [loadStatus])

  // Auto-refresh while connecting
  useEffect(() => {
    if (vpn?.status !== 'connecting') return
    const interval = setInterval(loadStatus, 2000)
    return () => clearInterval(interval)
  }, [vpn?.status, loadStatus])

  const connect = async () => {
    setLoading(true)
    try {
      await vpnApi('/connect', 'POST')
      toast.success('Connessione VPN avviata...')
    } catch (e: any) { toast.error(e.message) }
    finally { setLoading(false); loadStatus() }
  }

  const disconnect = async () => {
    setLoading(true)
    try {
      await vpnApi('/disconnect', 'POST')
      toast.success('VPN disconnessa')
    } catch (e: any) { toast.error(e.message) }
    finally { setLoading(false); loadStatus() }
  }

  const loadLog = async () => {
    const r = await vpnApi('/log')
    if (r.log && vpn) setVpn({ ...vpn, log: r.log })
    setShowLog(!showLog)
  }

  if (!vpn) return <div className="text-text3 text-sm p-8 text-center">Caricamento...</div>

  const statusConfig: Record<string, { color: string; icon: any; label: string }> = {
    connected: { color: 'text-green', icon: Wifi, label: 'Connessa' },
    connecting: { color: 'text-yellow', icon: RefreshCw, label: 'Connessione in corso...' },
    disconnected: { color: 'text-text3', icon: WifiOff, label: 'Disconnessa' },
    error: { color: 'text-red', icon: AlertTriangle, label: 'Errore' },
  }
  const sc = statusConfig[vpn.status] || statusConfig.disconnected

  return (
    <div className="space-y-4">
      {/* Status card */}
      <div className="bg-bg2 border border-border rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className={`p-3 rounded-xl ${vpn.status === 'connected' ? 'bg-green/10' : vpn.status === 'error' ? 'bg-red/10' : 'bg-bg3'}`}>
              <sc.icon size={24} className={`${sc.color} ${vpn.status === 'connecting' ? 'animate-spin' : ''}`} />
            </div>
            <div>
              <h3 className="text-base font-bold text-text">VPN OpenVPN</h3>
              <p className={`text-sm font-medium ${sc.color}`}>{sc.label}</p>
              {vpn.connectedAt && (
                <p className="text-[10px] text-text3 mt-0.5">Connessa dal: {new Date(vpn.connectedAt).toLocaleString('it-IT')}</p>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={loadStatus} className="p-2 rounded-lg bg-bg3 text-text3 hover:bg-bg4 transition-colors" title="Aggiorna">
              <RefreshCw size={16} />
            </button>
            {vpn.status === 'connected' || vpn.status === 'connecting' ? (
              <button onClick={disconnect} disabled={loading} className="flex items-center gap-2 px-4 py-2 text-sm bg-red/10 text-red border border-red/20 rounded-lg hover:bg-red/20 disabled:opacity-50">
                <Power size={16} /> Disconnetti
              </button>
            ) : (
              <button onClick={connect} disabled={loading || !vpn.configExists} className="flex items-center gap-2 px-4 py-2 text-sm bg-green/10 text-green border border-green/20 rounded-lg hover:bg-green/20 disabled:opacity-50">
                <Power size={16} /> Connetti
              </button>
            )}
          </div>
        </div>

        {vpn.error && (
          <div className="mt-3 p-3 bg-red/5 border border-red/20 rounded-lg text-xs text-red">
            {vpn.error}
          </div>
        )}
      </div>

      {/* Connection details */}
      <div className="bg-bg2 border border-border rounded-xl p-4">
        <h4 className="text-xs font-semibold text-text3 uppercase tracking-wider mb-3">Dettagli connessione</h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="bg-bg3 rounded-lg p-3">
            <div className="text-[10px] text-text3 mb-1">Config</div>
            <div className="text-xs text-text font-mono truncate">{vpn.configFile?.split('/').pop()}</div>
          </div>
          <div className="bg-bg3 rounded-lg p-3">
            <div className="text-[10px] text-text3 mb-1">Server</div>
            <div className="text-xs text-text font-mono">hjw0aqjff1h.sn.mynetname.net:1195</div>
          </div>
          <div className="bg-bg3 rounded-lg p-3">
            <div className="text-[10px] text-text3 mb-1">Rete</div>
            <div className="text-xs text-text font-mono">192.168.0.0/24</div>
          </div>
          <div className="bg-bg3 rounded-lg p-3">
            <div className="text-[10px] text-text3 mb-1">Interfaccia tun0</div>
            <div className={`text-xs font-medium ${vpn.tunActive ? 'text-green' : 'text-text3'}`}>{vpn.tunActive ? 'Attiva' : 'Non attiva'}</div>
          </div>
          <div className="bg-bg3 rounded-lg p-3">
            <div className="text-[10px] text-text3 mb-1">Protocollo</div>
            <div className="text-xs text-text">UDP / AES-256-GCM</div>
          </div>
          <div className="bg-bg3 rounded-lg p-3">
            <div className="text-[10px] text-text3 mb-1">Config presente</div>
            <div className={`text-xs font-medium ${vpn.configExists ? 'text-green' : 'text-red'}`}>{vpn.configExists ? 'Si' : 'No'}</div>
          </div>
        </div>
      </div>

      {/* Ping test */}
      <PingTest />

      {/* Log viewer */}
      <div className="bg-bg2 border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Terminal size={14} className="text-gold" />
            <h4 className="text-xs font-semibold text-text3 uppercase tracking-wider">Log OpenVPN</h4>
          </div>
          <button onClick={loadLog} className="text-[10px] text-text3 hover:text-gold">
            {showLog ? 'Nascondi' : 'Mostra log'}
          </button>
        </div>
        {showLog && (
          <pre className="text-[10px] text-text2 font-mono bg-bg3 rounded-lg p-3 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap leading-relaxed">
            {vpn.log || '(nessun log disponibile)'}
          </pre>
        )}
      </div>
    </div>
  )
}

function PingTest() {
  const [target, setTarget] = useState('192.168.0.1')
  const [result, setResult] = useState<{ success: boolean; latencyMs: number; packetLoss: number; output: string } | null>(null)
  const [pinging, setPinging] = useState(false)

  const runPing = async () => {
    setPinging(true)
    setResult(null)
    try {
      const r = await vpnApi('/ping', 'POST', { target })
      setResult(r)
    } catch { setResult({ success: false, latencyMs: 0, packetLoss: 100, output: 'Errore di rete' }) }
    finally { setPinging(false) }
  }

  return (
    <div className="bg-bg2 border border-border rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Wifi size={14} className="text-gold" />
        <h4 className="text-xs font-semibold text-text3 uppercase tracking-wider">Test connettivita</h4>
      </div>
      <div className="flex gap-2 items-end mb-3">
        <div className="flex-1">
          <label className="text-[10px] text-text3 block mb-1">IP destinazione</label>
          <input value={target} onChange={e => setTarget(e.target.value)} placeholder="192.168.0.1" className="w-full px-3 py-1.5 text-xs bg-bg3 border border-border rounded-lg text-text font-mono" />
        </div>
        <button onClick={runPing} disabled={pinging} className="flex items-center gap-1.5 px-4 py-1.5 text-xs bg-gold hover:bg-gold-l text-white rounded-lg disabled:opacity-50">
          {pinging ? <RefreshCw size={12} className="animate-spin" /> : <Wifi size={12} />}
          {pinging ? 'Ping...' : 'Ping'}
        </button>
      </div>
      {result && (
        <div className={`p-3 rounded-lg ${result.success ? 'bg-green/5 border border-green/20' : 'bg-red/5 border border-red/20'}`}>
          <div className="flex items-center gap-4 mb-2">
            <div className="flex items-center gap-1.5">
              {result.success ? <Check size={14} className="text-green" /> : <X size={14} className="text-red" />}
              <span className={`text-sm font-medium ${result.success ? 'text-green' : 'text-red'}`}>{result.success ? 'Raggiungibile' : 'Non raggiungibile'}</span>
            </div>
            {result.success && (
              <>
                <span className="text-xs text-text2">Latenza: <strong>{result.latencyMs.toFixed(1)}ms</strong></span>
                <span className="text-xs text-text2">Perdita: <strong>{result.packetLoss}%</strong></span>
              </>
            )}
          </div>
          <pre className="text-[10px] text-text3 font-mono">{result.output}</pre>
        </div>
      )}
    </div>
  )
}
