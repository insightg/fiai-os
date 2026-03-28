import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import type { Fornitore } from '../types'

interface FornitoriState {
  fornitori: Fornitore[]
  loading: boolean
  error: string | null
  fetch: (aziendaId: string) => Promise<void>
  create: (fornitore: Omit<Fornitore, 'id' | 'created_at' | 'updated_at'>) => Promise<Fornitore | null>
  update: (id: string, data: Partial<Fornitore>) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const useFornitoriStore = create<FornitoriState>((set, get) => ({
  fornitori: [],
  loading: false,
  error: null,

  fetch: async (aziendaId: string) => {
    set({ loading: true, error: null })
    const { data, error } = await supabase
      .from('fornitori')
      .select('*')
      .eq('azienda_id', aziendaId)
      .order('ragione_sociale', { ascending: true })
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({ fornitori: (data ?? []) as Fornitore[], loading: false })
  },

  create: async (fornitore) => {
    set({ loading: true, error: null })
    const { data, error } = await supabase.from('fornitori').insert(fornitore).select().single()
    if (error) {
      set({ loading: false, error: error.message })
      return null
    }
    const created = data as Fornitore
    set({ fornitori: [created, ...get().fornitori], loading: false })
    return created
  },

  update: async (id: string, updates: Partial<Fornitore>) => {
    set({ loading: true, error: null })
    const { error } = await supabase.from('fornitori').update(updates).eq('id', id)
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({
      fornitori: get().fornitori.map((f) => (f.id === id ? { ...f, ...updates } : f)),
      loading: false,
    })
  },

  remove: async (id: string) => {
    set({ loading: true, error: null })
    const { error } = await supabase.from('fornitori').delete().eq('id', id)
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({ fornitori: get().fornitori.filter((f) => f.id !== id), loading: false })
  },
}))
