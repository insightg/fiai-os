import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import type { Conto, Movimento } from '../types'

interface ContiState {
  conti: Conto[]
  movimenti: Movimento[]
  loading: boolean
  error: string | null
  fetchConti: (aziendaId: string) => Promise<void>
  createConto: (conto: Omit<Conto, 'id' | 'created_at' | 'updated_at'>) => Promise<Conto | null>
  updateConto: (id: string, data: Partial<Conto>) => Promise<void>
  removeConto: (id: string) => Promise<void>
  fetchMovimenti: (aziendaId: string) => Promise<void>
  fetchMovimentiConto: (contoId: string) => Promise<void>
  createMovimento: (mov: Omit<Movimento, 'id' | 'created_at'>) => Promise<Movimento | null>
  removeMovimento: (id: string) => Promise<void>
}

export const useContiStore = create<ContiState>((set, get) => ({
  conti: [],
  movimenti: [],
  loading: false,
  error: null,

  fetchConti: async (aziendaId: string) => {
    set({ loading: true, error: null })
    const { data, error } = await supabase
      .from('conti')
      .select('*')
      .eq('azienda_id', aziendaId)
      .order('nome', { ascending: true })
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({ conti: (data ?? []) as Conto[], loading: false })
  },

  createConto: async (conto) => {
    set({ loading: true, error: null })
    const { data, error } = await supabase.from('conti').insert(conto).select().single()
    if (error) {
      set({ loading: false, error: error.message })
      return null
    }
    const created = data as Conto
    set({ conti: [created, ...get().conti], loading: false })
    return created
  },

  updateConto: async (id: string, updates: Partial<Conto>) => {
    set({ loading: true, error: null })
    const { error } = await supabase.from('conti').update(updates).eq('id', id)
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({
      conti: get().conti.map((c) => (c.id === id ? { ...c, ...updates } : c)),
      loading: false,
    })
  },

  removeConto: async (id: string) => {
    set({ loading: true, error: null })
    const { error } = await supabase.from('conti').delete().eq('id', id)
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({ conti: get().conti.filter((c) => c.id !== id), loading: false })
  },

  fetchMovimenti: async (aziendaId: string) => {
    set({ loading: true, error: null })
    const { data, error } = await supabase
      .from('movimenti')
      .select('*')
      .eq('azienda_id', aziendaId)
      .order('data', { ascending: false })
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({ movimenti: (data ?? []) as Movimento[], loading: false })
  },

  fetchMovimentiConto: async (contoId: string) => {
    set({ loading: true, error: null })
    const { data, error } = await supabase
      .from('movimenti')
      .select('*')
      .eq('conto_id', contoId)
      .order('data', { ascending: false })
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({ movimenti: (data ?? []) as Movimento[], loading: false })
  },

  createMovimento: async (mov) => {
    set({ loading: true, error: null })
    const { data, error } = await supabase.from('movimenti').insert(mov).select().single()
    if (error) {
      set({ loading: false, error: error.message })
      return null
    }
    const created = data as Movimento
    set({ movimenti: [created, ...get().movimenti], loading: false })
    return created
  },

  removeMovimento: async (id: string) => {
    set({ loading: true, error: null })
    const { error } = await supabase.from('movimenti').delete().eq('id', id)
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({ movimenti: get().movimenti.filter((m) => m.id !== id), loading: false })
  },
}))
