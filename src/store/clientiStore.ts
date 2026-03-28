import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import type { Cliente } from '../types'

interface ClientiState {
  clienti: Cliente[]
  loading: boolean
  error: string | null
  fetch: (aziendaId: string) => Promise<void>
  create: (cliente: Omit<Cliente, 'id' | 'created_at' | 'updated_at'>) => Promise<Cliente | null>
  update: (id: string, data: Partial<Cliente>) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const useClientiStore = create<ClientiState>((set, get) => ({
  clienti: [],
  loading: false,
  error: null,

  fetch: async (aziendaId: string) => {
    set({ loading: true, error: null })
    const { data, error } = await supabase
      .from('clienti')
      .select('*')
      .eq('azienda_id', aziendaId)
      .order('created_at', { ascending: false })
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({ clienti: (data ?? []) as Cliente[], loading: false })
  },

  create: async (cliente) => {
    set({ loading: true, error: null })
    const { data, error } = await supabase.from('clienti').insert(cliente).select().single()
    if (error) {
      set({ loading: false, error: error.message })
      return null
    }
    const created = data as Cliente
    set({ clienti: [created, ...get().clienti], loading: false })
    return created
  },

  update: async (id: string, updates: Partial<Cliente>) => {
    set({ loading: true, error: null })
    const { error } = await supabase.from('clienti').update(updates).eq('id', id)
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({
      clienti: get().clienti.map((c) => (c.id === id ? { ...c, ...updates } : c)),
      loading: false,
    })
  },

  remove: async (id: string) => {
    set({ loading: true, error: null })
    const { error } = await supabase.from('clienti').delete().eq('id', id)
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({ clienti: get().clienti.filter((c) => c.id !== id), loading: false })
  },
}))
