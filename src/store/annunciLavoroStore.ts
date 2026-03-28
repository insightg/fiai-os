import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import type { AnnuncioLavoro } from '../types'

interface AnnunciLavoroState {
  annunci: AnnuncioLavoro[]
  loading: boolean
  error: string | null
  fetch: (aziendaId: string) => Promise<void>
  create: (a: Omit<AnnuncioLavoro, 'id' | 'created_at' | 'updated_at'>) => Promise<AnnuncioLavoro | null>
  update: (id: string, data: Partial<AnnuncioLavoro>) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const useAnnunciLavoroStore = create<AnnunciLavoroState>((set, get) => ({
  annunci: [],
  loading: false,
  error: null,

  fetch: async (aziendaId: string) => {
    set({ loading: true, error: null })
    const { data, error } = await supabase
      .from('annunci_lavoro')
      .select('*')
      .eq('azienda_id', aziendaId)
      .order('created_at', { ascending: false })
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({ annunci: (data ?? []) as AnnuncioLavoro[], loading: false })
  },

  create: async (annuncio) => {
    set({ loading: true, error: null })
    const { data, error } = await supabase.from('annunci_lavoro').insert(annuncio).select().single()
    if (error) {
      set({ loading: false, error: error.message })
      return null
    }
    const created = data as AnnuncioLavoro
    set({ annunci: [created, ...get().annunci], loading: false })
    return created
  },

  update: async (id, updates) => {
    set({ loading: true, error: null })
    const { error } = await supabase.from('annunci_lavoro').update(updates).eq('id', id)
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({
      annunci: get().annunci.map((a) => (a.id === id ? { ...a, ...updates } : a)),
      loading: false,
    })
  },

  remove: async (id) => {
    set({ loading: true, error: null })
    const { error } = await supabase.from('annunci_lavoro').delete().eq('id', id)
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({ annunci: get().annunci.filter((a) => a.id !== id), loading: false })
  },
}))
