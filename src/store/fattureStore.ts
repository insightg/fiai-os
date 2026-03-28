import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import type { Fattura, FatturaRiga } from '../types'

interface FattureState {
  fatture: Fattura[]
  loading: boolean
  error: string | null
  fetch: (aziendaId: string) => Promise<void>
  fetchOne: (id: string) => Promise<Fattura | null>
  create: (fattura: Omit<Fattura, 'id' | 'created_at' | 'updated_at' | 'cliente' | 'righe'>) => Promise<Fattura | null>
  update: (id: string, data: Partial<Fattura>) => Promise<void>
  remove: (id: string) => Promise<void>
  addRiga: (riga: Omit<FatturaRiga, 'id'>) => Promise<FatturaRiga | null>
  updateRiga: (id: string, data: Partial<FatturaRiga>) => Promise<void>
  removeRiga: (id: string) => Promise<void>
}

export const useFattureStore = create<FattureState>((set, get) => ({
  fatture: [],
  loading: false,
  error: null,

  fetch: async (aziendaId: string) => {
    set({ loading: true, error: null })
    const { data, error } = await supabase
      .from('fatture')
      .select('*, cliente:clienti(*)')
      .eq('azienda_id', aziendaId)
      .order('created_at', { ascending: false })
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({ fatture: (data ?? []) as Fattura[], loading: false })
  },

  fetchOne: async (id: string) => {
    set({ loading: true, error: null })
    const { data, error } = await supabase
      .from('fatture')
      .select('*, cliente:clienti(*), righe:fattura_righe(*)')
      .eq('id', id)
      .single()
    if (error) {
      set({ loading: false, error: error.message })
      return null
    }
    set({ loading: false })
    return data as Fattura
  },

  create: async (fattura) => {
    set({ loading: true, error: null })
    const { data, error } = await supabase.from('fatture').insert(fattura).select('*, cliente:clienti(*)').single()
    if (error) {
      set({ loading: false, error: error.message })
      return null
    }
    const created = data as Fattura
    set({ fatture: [created, ...get().fatture], loading: false })
    return created
  },

  update: async (id: string, updates: Partial<Fattura>) => {
    set({ loading: true, error: null })
    const { error } = await supabase.from('fatture').update(updates).eq('id', id)
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({
      fatture: get().fatture.map((f) => (f.id === id ? { ...f, ...updates } : f)),
      loading: false,
    })
  },

  remove: async (id: string) => {
    set({ loading: true, error: null })
    const { error } = await supabase.from('fatture').delete().eq('id', id)
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({ fatture: get().fatture.filter((f) => f.id !== id), loading: false })
  },

  addRiga: async (riga) => {
    set({ loading: true, error: null })
    const { data, error } = await supabase.from('fattura_righe').insert(riga).select().single()
    if (error) {
      set({ loading: false, error: error.message })
      return null
    }
    set({ loading: false })
    return data as FatturaRiga
  },

  updateRiga: async (id: string, updates: Partial<FatturaRiga>) => {
    set({ error: null })
    const { error } = await supabase.from('fattura_righe').update(updates).eq('id', id)
    if (error) {
      set({ error: error.message })
    }
  },

  removeRiga: async (id: string) => {
    set({ error: null })
    const { error } = await supabase.from('fattura_righe').delete().eq('id', id)
    if (error) {
      set({ error: error.message })
    }
  },
}))
