import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import type { UserProfile } from '../types'

// Lightweight types replacing @supabase/supabase-js User / Session
interface User {
  id: string
  email?: string
  [key: string]: any
}

interface Session {
  access_token: string
  user: User
  [key: string]: any
}

interface AuthState {
  user: User | null
  session: Session | null
  profile: UserProfile | null
  loading: boolean
  error: string | null
  login: (account: string, password: string) => Promise<void>
  logout: () => Promise<void>
  fetchProfile: () => Promise<void>
  setSession: (session: Session | null) => void
  initialize: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  profile: null,
  loading: true,
  error: null,

  login: async (account: string, password: string) => {
    set({ loading: true, error: null })
    const email = account.includes('@') ? account : account
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    const user = data.user ?? data.data?.user
    const session = data.session ?? data.data?.session
    set({ user, session, loading: false })
    await get().fetchProfile()
  },

  logout: async () => {
    set({ loading: true })
    await supabase.auth.signOut()
    set({ user: null, session: null, profile: null, loading: false, error: null })
  },

  fetchProfile: async () => {
    const user = get().user
    if (!user) return
    // Load profile from entity table (unified VFS)
    const { data, error } = await supabase
      .from('entity')
      .select('*')
      .eq('id', user.id)
      .single()
    if (error || !data) {
      set({ error: error?.message || 'Profilo non trovato' })
      return
    }
    // Map entity fields to UserProfile format
    const meta = typeof data.metadata === 'string' ? JSON.parse(data.metadata) : (data.metadata || {})
    set({ profile: {
      id: data.id,
      azienda_id: data.azienda_id,
      email: data.email || '',
      nome: data.display_name?.split(' ')[0] || data.display_name || '',
      cognome: meta.cognome || data.display_name?.split(' ').slice(1).join(' ') || '',
      ruolo: meta.ruolo || 'collaboratore',
      avatar_url: meta.avatar_url || null,
      whatsapp_phone: meta.whatsapp_phone || data.telefono || null,
      whatsapp_active: meta.whatsapp_active ? 1 : 0,
      tts_voice: meta.tts_voice || 'Vivian',
      created_at: data.created_at,
    } as UserProfile })
  },

  setSession: (session: Session | null) => {
    set({ session, user: session?.user ?? null })
  },

  initialize: async () => {
    set({ loading: true })
    const { data: { session } } = await supabase.auth.getSession()
    if (session) {
      set({ session, user: session.user })
      await get().fetchProfile()
    }
    set({ loading: false })

    supabase.auth.onAuthStateChange((_event, session) => {
      set({ session, user: session?.user ?? null })
      if (session) {
        get().fetchProfile()
      } else {
        set({ profile: null })
      }
    })
  },
}))
