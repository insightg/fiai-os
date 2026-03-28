import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import type { Preventivo, PreventivoRiga } from '../types'

interface PreventiviState {
  preventivi: Preventivo[]
  loading: boolean
  error: string | null
  fetch: (aziendaId: string) => Promise<void>
  fetchOne: (id: string) => Promise<Preventivo | null>
  create: (preventivo: Omit<Preventivo, 'id' | 'created_at' | 'updated_at' | 'cliente' | 'righe'>) => Promise<Preventivo | null>
  update: (id: string, data: Partial<Preventivo>) => Promise<void>
  remove: (id: string) => Promise<void>
  addRiga: (riga: Omit<PreventivoRiga, 'id'>) => Promise<PreventivoRiga | null>
  updateRiga: (id: string, data: Partial<PreventivoRiga>) => Promise<void>
  removeRiga: (id: string) => Promise<void>
}

export const usePreventiviStore = create<PreventiviState>((set, get) => ({
  preventivi: [],
  loading: false,
  error: null,

  fetch: async (aziendaId: string) => {
    set({ loading: true, error: null })
    const { data, error } = await supabase
      .from('preventivi')
      .select('*, cliente:clienti(*)')
      .eq('azienda_id', aziendaId)
      .order('created_at', { ascending: false })
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({ preventivi: (data ?? []) as Preventivo[], loading: false })
  },

  fetchOne: async (id: string) => {
    set({ loading: true, error: null })
    const { data, error } = await supabase
      .from('preventivi')
      .select('*, cliente:clienti(*), righe:preventivo_righe(*)')
      .eq('id', id)
      .single()
    if (error) {
      set({ loading: false, error: error.message })
      return null
    }
    set({ loading: false })
    return data as Preventivo
  },

  create: async (preventivo) => {
    set({ loading: true, error: null })
    const { data, error } = await supabase.from('preventivi').insert(preventivo).select('*, cliente:clienti(*)').single()
    if (error) {
      set({ loading: false, error: error.message })
      return null
    }
    const created = data as Preventivo
    set({ preventivi: [created, ...get().preventivi], loading: false })
    return created
  },

  update: async (id: string, updates: Partial<Preventivo>) => {
    set({ loading: true, error: null })
    const { error } = await supabase.from('preventivi').update(updates).eq('id', id)
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({
      preventivi: get().preventivi.map((p) => (p.id === id ? { ...p, ...updates } : p)),
      loading: false,
    })
  },

  remove: async (id: string) => {
    set({ loading: true, error: null })
    const { error } = await supabase.from('preventivi').delete().eq('id', id)
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({ preventivi: get().preventivi.filter((p) => p.id !== id), loading: false })
  },

  addRiga: async (riga) => {
    set({ loading: true, error: null })
    const { data, error } = await supabase.from('preventivo_righe').insert(riga).select().single()
    if (error) {
      set({ loading: false, error: error.message })
      return null
    }
    set({ loading: false })
    return data as PreventivoRiga
  },

  updateRiga: async (id: string, updates: Partial<PreventivoRiga>) => {
    set({ error: null })
    const { error } = await supabase.from('preventivo_righe').update(updates).eq('id', id)
    if (error) {
      set({ error: error.message })
    }
  },

  removeRiga: async (id: string) => {
    set({ error: null })
    const { error } = await supabase.from('preventivo_righe').delete().eq('id', id)
    if (error) {
      set({ error: error.message })
    }
  },
}))
