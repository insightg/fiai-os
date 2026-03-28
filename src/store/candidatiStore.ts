import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import type { Candidato } from '../types'

interface CandidatiState {
  candidati: Candidato[]
  loading: boolean
  error: string | null
  fetch: (aziendaId: string) => Promise<void>
  create: (c: Omit<Candidato, 'id' | 'created_at' | 'updated_at'>) => Promise<Candidato | null>
  update: (id: string, data: Partial<Candidato>) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const useCandidatiStore = create<CandidatiState>((set, get) => ({
  candidati: [],
  loading: false,
  error: null,

  fetch: async (aziendaId: string) => {
    set({ loading: true, error: null })
    const { data, error } = await supabase
      .from('candidati')
      .select('*')
      .eq('azienda_id', aziendaId)
      .order('created_at', { ascending: false })
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({ candidati: (data ?? []) as Candidato[], loading: false })
  },

  create: async (candidato) => {
    set({ loading: true, error: null })
    const { data, error } = await supabase.from('candidati').insert(candidato).select().single()
    if (error) {
      set({ loading: false, error: error.message })
      return null
    }
    const created = data as Candidato
    set({ candidati: [created, ...get().candidati], loading: false })
    return created
  },

  update: async (id, updates) => {
    set({ loading: true, error: null })
    const { error } = await supabase.from('candidati').update(updates).eq('id', id)
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({
      candidati: get().candidati.map((c) => (c.id === id ? { ...c, ...updates } : c)),
      loading: false,
    })
  },

  remove: async (id) => {
    set({ loading: true, error: null })
    const { error } = await supabase.from('candidati').delete().eq('id', id)
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({ candidati: get().candidati.filter((c) => c.id !== id), loading: false })
  },
}))
