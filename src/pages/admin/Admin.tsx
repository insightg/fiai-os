import { useState, useEffect, useCallback } from 'react'
import { Users, Shield, Plus, Trash2, Pencil, Check, X, ChevronDown, ChevronRight } from 'lucide-react'
import { getAuthToken } from '../../lib/supabase'
import toast from 'react-hot-toast'

interface User { id: string; display_name: string; email: string; ruolo: string; cognome: string; groups: { id: string; name: string }[]; created_at: string }
interface Group { id: string; name: string; permissions: Record<string, string[]>; members: { id: string; display_name: string; email: string }[] }

const ACTIONS = ['read', 'create', 'update', 'delete', 'send'] as const
const ENTITY_TYPES = ['organizzazione', 'persona', 'fattura', 'fattura_passiva', 'preventivo', 'ordine', 'progetto', 'documento', 'contratto', 'conto', 'movimento', 'rimborso', 'annuncio', 'evento']

function api(path: string, method = 'GET', body?: any) {
  const token = getAuthToken()
  return fetch(`/api/admin${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }).then(r => r.json())
}

export default function AdminPage() {
  const [tab, setTab] = useState<'users' | 'groups'>('users')
  const [users, setUsers] = useState<User[]>([])
  const [groups, setGroups] = useState<Group[]>([])
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

  useEffect(() => { load() }, [load])

  if (error) return <div className="p-8 text-red text-sm">{error}</div>

  return (
    <div className="min-h-screen bg-bg p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-text">Amministrazione</h1>
            <p className="text-xs text-text3 mt-0.5">Gestione utenti, gruppi e permessi</p>
          </div>
          <a href="/" className="text-xs text-text3 hover:text-gold">← Torna alla chat</a>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4">
          {[
            { id: 'users' as const, label: 'Utenti', icon: Users, count: users.length },
            { id: 'groups' as const, label: 'Gruppi & Permessi', icon: Shield, count: groups.length },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 text-sm rounded-lg transition-colors ${
                tab === t.id ? 'bg-gold text-white' : 'bg-bg2 text-text2 hover:bg-bg3 border border-border'
              }`}
            >
              <t.icon size={16} />
              {t.label}
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${tab === t.id ? 'bg-white/20' : 'bg-bg3'}`}>{t.count}</span>
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-text3 text-sm p-8 text-center">Caricamento...</div>
        ) : tab === 'users' ? (
          <UsersTab users={users} groups={groups} onReload={load} />
        ) : (
          <GroupsTab groups={groups} users={users} onReload={load} />
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
  const [editId, setEditId] = useState<string | null>(null)
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

  const updateRole = async (userId: string, ruolo: string) => {
    await api(`/users/${userId}`, 'PUT', { ruolo })
    toast.success('Ruolo aggiornato')
    onReload()
  }

  const deleteUser = async (userId: string, name: string) => {
    if (!confirm(`Eliminare ${name}?`)) return
    await api(`/users/${userId}`, 'DELETE')
    toast.success('Utente eliminato')
    onReload()
  }

  const roleColors: Record<string, string> = {
    admin: 'bg-gold/10 text-gold',
    collaboratore: 'bg-blue/10 text-blue',
    viewer: 'bg-bg3 text-text3',
  }

  return (
    <div className="space-y-4">
      {/* New user form */}
      <div className="flex justify-end">
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
              <option value="admin">Admin</option>
              <option value="collaboratore">Collaboratore</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowNew(false)} className="px-3 py-1.5 text-xs text-text3 border border-border rounded-lg">Annulla</button>
            <button onClick={createUser} className="px-3 py-1.5 text-xs bg-gold text-white rounded-lg">Crea</button>
          </div>
        </div>
      )}

      {/* Users table */}
      <div className="bg-bg2 border border-border rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-bg3">
              <th className="px-4 py-3 text-left text-text3 font-medium">Nome</th>
              <th className="px-4 py-3 text-left text-text3 font-medium">Email</th>
              <th className="px-4 py-3 text-left text-text3 font-medium">Ruolo</th>
              <th className="px-4 py-3 text-left text-text3 font-medium">Gruppi</th>
              <th className="px-4 py-3 w-20" />
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className="border-t border-border hover:bg-bg3/50">
                <td className="px-4 py-3 text-text font-medium">{u.display_name}</td>
                <td className="px-4 py-3 text-text2">{u.email}</td>
                <td className="px-4 py-3">
                  <select
                    value={u.ruolo}
                    onChange={e => updateRole(u.id, e.target.value)}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-medium border-0 cursor-pointer ${roleColors[u.ruolo] || roleColors.collaboratore}`}
                  >
                    <option value="admin">Admin</option>
                    <option value="collaboratore">Collaboratore</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-1 flex-wrap">
                    {u.groups.length === 0 ? <span className="text-text3">—</span> : u.groups.map(g => (
                      <span key={g.id} className="px-1.5 py-0.5 rounded bg-bg3 text-text2 text-[10px]">{g.name}</span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <button onClick={() => deleteUser(u.id, u.display_name)} className="p-1 rounded hover:bg-red/10 text-text3 hover:text-red">
                    <Trash2 size={14} />
                  </button>
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
    if (!confirm(`Eliminare il gruppo "${name}"?`)) return
    await api(`/groups/${id}`, 'DELETE')
    toast.success('Gruppo eliminato')
    onReload()
  }

  const togglePerm = async (groupId: string, group: Group, entityType: string, action: string) => {
    const perms = { ...group.permissions }
    const current = perms[entityType] || []
    if (current.includes(action)) {
      perms[entityType] = current.filter(a => a !== action)
      if (perms[entityType].length === 0) delete perms[entityType]
    } else {
      perms[entityType] = [...current, action]
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
    <div className="space-y-4">
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

      {groups.length === 0 ? (
        <div className="bg-bg2 border border-border rounded-xl p-8 text-center text-text3 text-sm">Nessun gruppo creato</div>
      ) : groups.map(g => (
        <div key={g.id} className="bg-bg2 border border-border rounded-xl overflow-hidden">
          {/* Group header */}
          <div className="flex items-center justify-between px-4 py-3 bg-bg3/50 cursor-pointer" onClick={() => setExpandedId(expandedId === g.id ? null : g.id)}>
            <div className="flex items-center gap-2">
              {expandedId === g.id ? <ChevronDown size={14} className="text-text3" /> : <ChevronRight size={14} className="text-text3" />}
              <Shield size={16} className="text-gold" />
              <span className="text-sm font-medium text-text">{g.name}</span>
              <span className="text-[10px] text-text3 bg-bg3 px-1.5 py-0.5 rounded">{g.members.length} membri</span>
            </div>
            <button onClick={e => { e.stopPropagation(); deleteGroup(g.id, g.name) }} className="p-1 rounded hover:bg-red/10 text-text3 hover:text-red">
              <Trash2 size={14} />
            </button>
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
                      <button onClick={() => removeMember(g.id, m.id)} className="p-0.5 rounded hover:bg-red/10 text-text3 hover:text-red">
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
                <select
                  className="px-2 py-1 text-xs bg-bg3 border border-border rounded text-text"
                  value=""
                  onChange={e => { if (e.target.value) addMember(g.id, e.target.value); e.target.value = '' }}
                >
                  <option value="">+ Aggiungi membro...</option>
                  {users.filter(u => !g.members.some(m => m.id === u.id)).map(u => (
                    <option key={u.id} value={u.id}>{u.display_name} ({u.email})</option>
                  ))}
                </select>
              </div>

              {/* Permission matrix */}
              <div>
                <h4 className="text-xs font-semibold text-text3 uppercase tracking-wider mb-2">Permessi per tipo entity</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-[10px]">
                    <thead>
                      <tr className="bg-bg3">
                        <th className="px-2 py-1.5 text-left text-text3 font-medium w-32">Tipo</th>
                        {ACTIONS.map(a => (
                          <th key={a} className="px-2 py-1.5 text-center text-text3 font-medium w-16">{a}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {ENTITY_TYPES.map(et => (
                        <tr key={et} className="border-t border-border">
                          <td className="px-2 py-1.5 text-text font-medium">{et}</td>
                          {ACTIONS.map(a => {
                            const has = (g.permissions[et] || []).includes(a)
                            return (
                              <td key={a} className="px-2 py-1.5 text-center">
                                <button
                                  onClick={() => togglePerm(g.id, g, et, a)}
                                  className={`w-5 h-5 rounded flex items-center justify-center transition-colors ${
                                    has ? 'bg-green/20 text-green' : 'bg-bg3 text-text3 hover:bg-bg4'
                                  }`}
                                >
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
