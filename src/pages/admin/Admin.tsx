import { useState, useEffect, useCallback } from 'react'
import { Users, Shield, Plus, Trash2, Check, X, ChevronDown, ChevronRight, Bot, Activity, Database, ArrowLeft, Settings, RefreshCw, Save, AlertTriangle } from 'lucide-react'
import { getAuthToken } from '../../lib/supabase'
import toast from 'react-hot-toast'

interface User { id: string; display_name: string; email: string; ruolo: string; cognome: string; groups: { id: string; name: string }[]; created_at: string }
interface Group { id: string; name: string; permissions: Record<string, string[]>; members: { id: string; display_name: string; email: string }[] }
interface Agent { domain: string; name: string; color: string; model: string; toolCount: number; toolNames: string[]; promptLength: number; promptPreview: string; hasSkillOverride: boolean; skillRules: string[]; skillModel: string | null }
interface AuditEntry { id: string; entity_id: string; entity_type: string; action: string; entity_name: string; before_data: string; after_data: string; created_at: string }
interface SystemStats { totalEntities: number; typeCounts: { type: string; count: number }[]; documents: number; chunks: number; embeddedEntities: number; users: number; recentAudits: number; recentSessions: number; dbSizeMB: number }

const ACTIONS = ['read', 'create', 'update', 'delete', 'send'] as const
const ENTITY_TYPES = ['commerciale', 'fattura', 'fattura_passiva', 'preventivo', 'ordine', 'progetto', 'documento', 'contratto', 'conto', 'movimento', 'rimborso', 'annuncio', 'evento']
const TYPE_ALIASES: Record<string, string[]> = { 'commerciale': ['organizzazione', 'persona'] }

function api(path: string, method = 'GET', body?: any) {
  const token = getAuthToken()
  return fetch(`/api/admin${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }).then(r => r.json())
}

type Tab = 'users' | 'groups' | 'agents' | 'audit' | 'system'

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
  useEffect(() => { if (tab === 'system') loadSystem() }, [tab, loadSystem])

  if (error) return <div className="p-8 text-red text-sm">{error}</div>

  const tabs: { id: Tab; label: string; icon: any; count?: number }[] = [
    { id: 'users', label: 'Utenti', icon: Users, count: users.length },
    { id: 'groups', label: 'Gruppi', icon: Shield, count: groups.length },
    { id: 'agents', label: 'Agenti', icon: Bot, count: agents.length },
    { id: 'audit', label: 'Audit Log', icon: Activity },
    { id: 'system', label: 'Sistema', icon: Database },
  ]

  return (
    <div className="min-h-screen bg-bg p-4 sm:p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-lg font-bold text-text">Amministrazione</h1>
            <p className="text-[11px] text-text3 mt-0.5">Gestione utenti, agenti, permessi e sistema</p>
          </div>
          <a href="/" className="flex items-center gap-1 text-xs text-text3 hover:text-gold transition-colors">
            <ArrowLeft size={14} /> Chat
          </a>
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
          <GroupsTab groups={groups} users={users} onReload={load} />
        ) : tab === 'agents' ? (
          <AgentsTab agents={agents} onReload={loadAgents} />
        ) : tab === 'audit' ? (
          <AuditTab logs={auditLogs} onReload={loadAudit} />
        ) : (
          <SystemTab stats={systemStats} onReload={loadSystem} />
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
  const [form, setForm] = useState({ nome: '', cognome: '', email: '', password: '', ruolo: 'collaboratore' })

  const createUser = async () => {
    if (!form.nome || !form.email || !form.password) { toast.error('Compila nome, email e password'); return }
    const res = await api('/users', 'POST', form)
    if (res.error) { toast.error(res.error); return }
    toast.success(`Utente ${form.nome} creato`)
    setShowNew(false)
    setForm({ nome: '', cognome: '', email: '', password: '', ruolo: 'collaboratore' })
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
            <input value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} placeholder="Nome *" className="px-3 py-2 text-xs bg-bg3 border border-border rounded-lg text-text" />
            <input value={form.cognome} onChange={e => setForm(f => ({ ...f, cognome: e.target.value }))} placeholder="Cognome" className="px-3 py-2 text-xs bg-bg3 border border-border rounded-lg text-text" />
            <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="Email *" type="email" className="px-3 py-2 text-xs bg-bg3 border border-border rounded-lg text-text" />
            <input value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="Password *" type="password" className="px-3 py-2 text-xs bg-bg3 border border-border rounded-lg text-text" />
            <select value={form.ruolo} onChange={e => setForm(f => ({ ...f, ruolo: e.target.value }))} className="px-3 py-2 text-xs bg-bg3 border border-border rounded-lg text-text">
              {groups.map(g => <option key={g.id} value={g.name}>{g.name}</option>)}
              {groups.length === 0 && <option value="Operatori">Operatori</option>}
            </select>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowNew(false)} className="px-3 py-1.5 text-xs text-text3 border border-border rounded-lg">Annulla</button>
            <button onClick={createUser} className="px-3 py-1.5 text-xs bg-gold text-white rounded-lg">Crea</button>
          </div>
        </div>
      )}

      <div className="bg-bg2 border border-border rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <thead><tr className="bg-bg3">
            <th className="px-4 py-2.5 text-left text-text3 font-medium">Nome</th>
            <th className="px-4 py-2.5 text-left text-text3 font-medium">Email</th>
            <th className="px-4 py-2.5 text-left text-text3 font-medium">Gruppi</th>
            <th className="px-4 py-2.5 w-16" />
          </tr></thead>
          <tbody>
            {filtered.map(u => (
              <tr key={u.id} className="border-t border-border hover:bg-bg3/50">
                <td className="px-4 py-2.5 text-text font-medium">{u.display_name}</td>
                <td className="px-4 py-2.5 text-text2">{u.email}</td>
                <td className="px-4 py-2.5">
                  <div className="flex gap-1 flex-wrap">
                    {u.groups.length === 0 ? <span className="text-text3 italic">Nessuno</span> : u.groups.map(g => (
                      <span key={g.id} className="px-1.5 py-0.5 rounded bg-bg3 text-text2 text-[10px]">{g.name}</span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  <button onClick={() => deleteUser(u.id, u.display_name)} className="p-1 rounded hover:bg-red/10 text-text3 hover:text-red"><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════
// GROUPS TAB
// ═══════════════════════════════════════════════════════

function GroupsTab({ groups, users, onReload }: { groups: Group[]; users: User[]; onReload: () => void }) {
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const createGroup = async () => {
    if (!newName) return
    await api('/groups', 'POST', { name: newName, permissions: {} })
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

              <div>
                <h4 className="text-xs font-semibold text-text3 uppercase tracking-wider mb-2">Permessi</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-[10px]">
                    <thead><tr className="bg-bg3">
                      <th className="px-2 py-1.5 text-left text-text3 font-medium w-28">Tipo</th>
                      {ACTIONS.map(a => <th key={a} className="px-2 py-1.5 text-center text-text3 font-medium w-14">{a}</th>)}
                    </tr></thead>
                    <tbody>
                      {ENTITY_TYPES.map(et => (
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

function AgentsTab({ agents, onReload }: { agents: Agent[]; onReload: () => void }) {
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null)
  const [editRules, setEditRules] = useState<string[]>([])
  const [editModel, setEditModel] = useState('')
  const [newRule, setNewRule] = useState('')
  const [saving, setSaving] = useState(false)

  const selectAgent = (domain: string) => {
    if (expandedDomain === domain) { setExpandedDomain(null); return }
    setExpandedDomain(domain)
    const agent = agents.find(a => a.domain === domain)
    setEditRules(agent?.skillRules || [])
    setEditModel(agent?.skillModel || '')
    setNewRule('')
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

              {/* Prompt preview */}
              <div>
                <h4 className="text-xs font-semibold text-text3 uppercase tracking-wider mb-1">Prompt di sistema</h4>
                <div className="bg-bg3 rounded-lg p-3 text-xs text-text2 max-h-32 overflow-y-auto whitespace-pre-wrap font-mono leading-relaxed">{agent.promptPreview}...</div>
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
                <input value={editModel} onChange={e => setEditModel(e.target.value)}
                  placeholder="Es. anthropic/claude-sonnet-4 (vuoto = default)" className="w-full px-3 py-1.5 text-xs bg-bg3 border border-border rounded-lg text-text" />
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
// SYSTEM TAB
// ═══════════════════════════════════════════════════════

function SystemTab({ stats, onReload }: { stats: SystemStats | null; onReload: () => void }) {
  if (!stats) return <div className="text-text3 text-sm p-8 text-center">Caricamento statistiche...</div>

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={onReload} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-bg2 border border-border rounded-lg text-text2 hover:bg-bg3">
          <RefreshCw size={12} /> Aggiorna
        </button>
      </div>

      {/* Stats cards */}
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
    </div>
  )
}
