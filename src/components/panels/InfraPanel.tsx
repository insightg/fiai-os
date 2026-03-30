import { useState, useEffect, type FormEvent } from 'react'
import { Users, Bot, Server, Plus, Trash2 } from 'lucide-react'
import AgentPanel from './AgentPanel'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import { Input, Select } from '../ui/Form'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store'
import toast from 'react-hot-toast'

interface UserRow {
  id: string
  email: string
  nome: string
  cognome: string
  ruolo: string
  avatar_url: string | null
  whatsapp_phone: string | null
  whatsapp_active: number
}

const AGENTS_CONFIG = [
  { name: 'Pulse', domain: 'pulse', color: '#C41E3A', tools: 6 },
  { name: 'Commerciale', domain: 'commerciale', color: '#1976D2', tools: 8 },
  { name: 'Produzione', domain: 'produzione', color: '#E68A00', tools: 5 },
  { name: 'Marketing', domain: 'marketing', color: '#9C27B0', tools: 4 },
  { name: 'Amministrazione', domain: 'amministrazione', color: '#2D8B56', tools: 7 },
  { name: 'HR', domain: 'hr', color: '#7B1FA2', tools: 6 },
  { name: 'Legal', domain: 'legal', color: '#D32F2F', tools: 4 },
  { name: 'IT/Infra', domain: 'infra', color: '#455A64', tools: 3 },
  { name: 'Image Agent', domain: 'image', color: '#E91E63', tools: 2 },
  { name: 'TTS Agent', domain: 'tts', color: '#00BCD4', tools: 1 },
]

const RUOLO_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'collaboratore', label: 'Collaboratore' },
  { value: 'viewer', label: 'Viewer' },
]

const defaultUserForm = {
  email: '',
  password: '',
  nome: '',
  cognome: '',
  ruolo: 'collaboratore',
}

export default function InfraPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState('utenti')
  const profile = useAuthStore((s) => s.profile)
  const [users, setUsers] = useState<UserRow[]>([])
  const [loadingUsers, setLoadingUsers] = useState(false)

  // User CRUD
  const [editUser, setEditUser] = useState<UserRow | null>(null)
  const [userFormOpen, setUserFormOpen] = useState(false)
  const [userForm, setUserForm] = useState({ ...defaultUserForm })

  const fetchUsers = async () => {
    if (!profile?.azienda_id) return
    setLoadingUsers(true)
    const { data } = await supabase
      .from('user_profiles')
      .select('id, email, nome, cognome, ruolo, avatar_url')
      .eq('azienda_id', profile.azienda_id)
      .order('nome')
    setUsers((data ?? []) as UserRow[])
    setLoadingUsers(false)
  }

  useEffect(() => {
    if (!profile?.azienda_id || tab !== 'utenti') return
    fetchUsers()
  }, [profile?.azienda_id, tab])

  // User handlers
  const openCreateUser = () => {
    setEditUser(null)
    setUserForm({ ...defaultUserForm })
    setUserFormOpen(true)
  }
  const openEditUser = (item: UserRow) => {
    setEditUser(item)
    setUserForm({
      email: item.email,
      password: '',
      nome: item.nome,
      cognome: item.cognome,
      ruolo: item.ruolo,
      whatsapp_phone: item.whatsapp_phone || '',
    } as any)
    setUserFormOpen(true)
  }
  const handleSaveUser = async (e: FormEvent) => {
    e.preventDefault()
    if (!profile?.azienda_id) return

    if (editUser) {
      // Update existing user profile
      const waPhone = (userForm as any).whatsapp_phone?.trim() || null
      const { error } = await supabase
        .from('user_profiles')
        .update({
          nome: userForm.nome.trim(),
          cognome: userForm.cognome.trim(),
          ruolo: userForm.ruolo,
          whatsapp_phone: waPhone,
          whatsapp_active: waPhone ? 1 : 0,
        })
        .eq('id', editUser.id)
      if (error) {
        toast.error('Errore aggiornamento: ' + error.message)
        return
      }
      toast.success('Utente aggiornato')
    } else {
      // Create new user via API
      if (!userForm.email.trim() || !userForm.password.trim()) {
        toast.error('Email e password obbligatori')
        return
      }
      try {
        const res = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: userForm.email.trim(),
            password: userForm.password,
            nome: userForm.nome.trim(),
            cognome: userForm.cognome.trim(),
            ruolo: userForm.ruolo,
            azienda_id: profile.azienda_id,
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Errore creazione utente' }))
          toast.error(err.error ?? 'Errore creazione utente')
          return
        }
        toast.success('Utente creato')
      } catch {
        toast.error('Errore creazione utente')
        return
      }
    }
    setUserFormOpen(false)
    fetchUsers()
  }
  const handleDeleteUser = async (userId: string) => {
    if (profile?.ruolo !== 'admin') {
      toast.error('Solo gli admin possono eliminare utenti')
      return
    }
    if (!confirm('Eliminare questo utente?')) return
    const { error } = await supabase
      .from('user_profiles')
      .delete()
      .eq('id', userId)
    if (error) {
      toast.error('Errore eliminazione: ' + error.message)
      return
    }
    toast.success('Utente eliminato')
    fetchUsers()
  }

  const tabs = [
    { key: 'utenti', label: 'Utenti', icon: Users },
    { key: 'agenti', label: 'Agenti', icon: Bot },
    { key: 'sistema', label: 'Sistema', icon: Server },
  ]

  return (
    <AgentPanel title="IT / Infra" color="#455A64" tabs={tabs} activeTab={tab} onTabChange={setTab} onClose={onClose}>
      {tab === 'utenti' && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-text3 uppercase tracking-wider">Utenti</span>
            {profile?.ruolo === 'admin' && (
              <Button size="sm" variant="primary" onClick={openCreateUser}>
                <Plus size={13} />
              </Button>
            )}
          </div>
          <div className="space-y-0.5">
            {loadingUsers && <p className="text-xs text-text3 text-center py-4">Caricamento...</p>}
            {!loadingUsers && users.map((u) => (
              <div
                key={u.id}
                onClick={() => openEditUser(u)}
                className="flex items-center gap-2.5 bg-bg2 border border-border rounded-lg px-2.5 py-2 cursor-pointer hover:border-gold/20 transition-colors group"
              >
                <div className="w-7 h-7 rounded-full bg-gold/20 text-gold text-[10px] font-semibold flex items-center justify-center shrink-0">
                  {u.avatar_url ? (
                    <img src={u.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover" />
                  ) : (
                    `${u.nome.charAt(0)}${u.cognome.charAt(0)}`
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-text truncate">{u.nome} {u.cognome}</p>
                  <p className="text-[10px] text-text3 truncate">{u.email}</p>
                  {u.whatsapp_phone && (
                    <p className="text-[10px] text-green truncate">📱 {u.whatsapp_phone}</p>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge color={u.ruolo === 'admin' ? 'gold' : u.ruolo === 'collaboratore' ? 'blue' : 'gray'}>
                    {u.ruolo}
                  </Badge>
                  {u.whatsapp_active ? (
                    <Badge color="green">WA</Badge>
                  ) : null}
                  {profile?.ruolo === 'admin' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteUser(u.id) }}
                      className="p-0.5 rounded text-text3 hover:text-red opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {!loadingUsers && users.length === 0 && (
              <p className="text-xs text-text3 text-center py-4">Nessun utente trovato</p>
            )}
          </div>
        </div>
      )}

      {tab === 'agenti' && (
        <div className="space-y-1">
          {AGENTS_CONFIG.map((agent) => (
            <div key={agent.domain} className="flex items-center gap-2.5 bg-bg2 border border-border rounded-lg px-2.5 py-2">
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-[10px] font-bold shrink-0"
                style={{ backgroundColor: agent.color }}
              >
                {agent.name.charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-text">{agent.name}</p>
                <p className="text-[10px] text-text3">{agent.domain}</p>
              </div>
              <span className="text-[10px] text-text3">{agent.tools} tools</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'sistema' && (
        <div className="space-y-2">
          <InfoCard label="Database" value="Supabase PostgreSQL" detail="Cloud-hosted" />
          <InfoCard label="Storage" value="Supabase Storage" detail="File e documenti" />
          <InfoCard label="AI Provider" value="OpenRouter" detail="Multi-model routing" />
          <InfoCard label="Agenti configurati" value={`${AGENTS_CONFIG.length}`} detail="Attivi nel sistema" />
          <InfoCard label="Frontend" value="React + Vite" detail="TypeScript, Tailwind CSS" />
          <InfoCard label="Auth" value="Supabase Auth" detail="RLS attivo" />
        </div>
      )}

      {/* User Modal */}
      <Modal open={userFormOpen} onClose={() => setUserFormOpen(false)} title={editUser ? 'Modifica Utente' : 'Nuovo Utente'}>
        <form onSubmit={handleSaveUser} className="space-y-3">
          <Input
            label="Email"
            type="email"
            required
            value={userForm.email}
            onChange={(e) => setUserForm((f) => ({ ...f, email: e.target.value }))}
            disabled={!!editUser}
          />
          {!editUser && (
            <Input
              label="Password"
              type="password"
              required
              value={userForm.password}
              onChange={(e) => setUserForm((f) => ({ ...f, password: e.target.value }))}
            />
          )}
          <div className="grid grid-cols-2 gap-3">
            <Input label="Nome" required value={userForm.nome} onChange={(e) => setUserForm((f) => ({ ...f, nome: e.target.value }))} />
            <Input label="Cognome" required value={userForm.cognome} onChange={(e) => setUserForm((f) => ({ ...f, cognome: e.target.value }))} />
          </div>
          <Select label="Ruolo" options={RUOLO_OPTIONS} value={userForm.ruolo} onChange={(e) => setUserForm((f) => ({ ...f, ruolo: e.target.value }))} />
          <Input
            label="WhatsApp (numero telefono)"
            type="tel"
            placeholder="393331234567"
            value={(userForm as any).whatsapp_phone || ''}
            onChange={(e) => setUserForm((f) => ({ ...f, whatsapp_phone: e.target.value || null }))}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" onClick={() => setUserFormOpen(false)}>Annulla</Button>
            <Button type="submit" variant="primary">Salva</Button>
          </div>
        </form>
      </Modal>
    </AgentPanel>
  )
}

function InfoCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="bg-bg2 border border-border rounded-lg px-3 py-2">
      <p className="text-[10px] text-text3 uppercase tracking-wider">{label}</p>
      <p className="text-xs font-medium text-text">{value}</p>
      <p className="text-[10px] text-text3">{detail}</p>
    </div>
  )
}
