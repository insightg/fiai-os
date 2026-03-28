import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import type { Progetto } from '../types'

interface ProgettiState {
  progetti: Progetto[]
  loading: boolean
  error: string | null
  fetch: (aziendaId: string) => Promise<void>
  fetchOne: (id: string) => Promise<Progetto | null>
  create: (progetto: Omit<Progetto, 'id' | 'created_at' | 'updated_at' | 'cliente'>) => Promise<Progetto | null>
  update: (id: string, data: Partial<Progetto>) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const useProgettiStore = create<ProgettiState>((set, get) => ({
  progetti: [],
  loading: false,
  error: null,

  fetch: async (aziendaId: string) => {
    set({ loading: true, error: null })
    const { data, error } = await supabase
      .from('progetti')
      .select('*, cliente:clienti(*)')
      .eq('azienda_id', aziendaId)
      .order('created_at', { ascending: false })
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({ progetti: (data ?? []) as Progetto[], loading: false })
  },

  fetchOne: async (id: string) => {
    set({ loading: true, error: null })
    const { data, error } = await supabase
      .from('progetti')
      .select('*, cliente:clienti(*)')
      .eq('id', id)
      .single()
    if (error) {
      set({ loading: false, error: error.message })
      return null
    }
    set({ loading: false })
    return data as Progetto
  },

  create: async (progetto) => {
    set({ loading: true, error: null })
    const { data, error } = await supabase.from('progetti').insert(progetto).select('*, cliente:clienti(*)').single()
    if (error) {
      set({ loading: false, error: error.message })
      return null
    }
    const created = data as Progetto
    set({ progetti: [created, ...get().progetti], loading: false })
    return created
  },

  update: async (id: string, updates: Partial<Progetto>) => {
    set({ loading: true, error: null })
    const { error } = await supabase.from('progetti').update(updates).eq('id', id)
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({
      progetti: get().progetti.map((p) => (p.id === id ? { ...p, ...updates } : p)),
      loading: false,
    })
  },

  remove: async (id: string) => {
    set({ loading: true, error: null })
    const { error } = await supabase.from('progetti').delete().eq('id', id)
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({ progetti: get().progetti.filter((p) => p.id !== id), loading: false })
  },
}))
