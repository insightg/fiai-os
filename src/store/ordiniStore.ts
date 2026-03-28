import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import type { Ordine } from '../types'

interface OrdiniState {
  ordini: Ordine[]
  loading: boolean
  error: string | null
  fetch: (aziendaId: string) => Promise<void>
  create: (ordine: Omit<Ordine, 'id' | 'created_at' | 'updated_at' | 'cliente'>) => Promise<Ordine | null>
  update: (id: string, data: Partial<Ordine>) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const useOrdiniStore = create<OrdiniState>((set, get) => ({
  ordini: [],
  loading: false,
  error: null,

  fetch: async (aziendaId: string) => {
    set({ loading: true, error: null })
    const { data, error } = await supabase
      .from('ordini')
      .select('*, cliente:clienti(*)')
      .eq('azienda_id', aziendaId)
      .order('created_at', { ascending: false })
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({ ordini: (data ?? []) as Ordine[], loading: false })
  },

  create: async (ordine) => {
    set({ loading: true, error: null })
    const { data, error } = await supabase.from('ordini').insert(ordine).select('*, cliente:clienti(*)').single()
    if (error) {
      set({ loading: false, error: error.message })
      return null
    }
    const created = data as Ordine
    set({ ordini: [created, ...get().ordini], loading: false })
    return created
  },

  update: async (id: string, updates: Partial<Ordine>) => {
    set({ loading: true, error: null })
    const { error } = await supabase.from('ordini').update(updates).eq('id', id)
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({
      ordini: get().ordini.map((o) => (o.id === id ? { ...o, ...updates } : o)),
      loading: false,
    })
  },

  remove: async (id: string) => {
    set({ loading: true, error: null })
    const { error } = await supabase.from('ordini').delete().eq('id', id)
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({ ordini: get().ordini.filter((o) => o.id !== id), loading: false })
  },
}))
