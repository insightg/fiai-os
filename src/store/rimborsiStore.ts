import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import type { Rimborso } from '../types'

interface RimborsiState {
  rimborsi: Rimborso[]
  loading: boolean
  error: string | null
  fetch: (aziendaId: string) => Promise<void>
  create: (rimborso: Omit<Rimborso, 'id' | 'created_at' | 'updated_at'>) => Promise<Rimborso | null>
  update: (id: string, data: Partial<Rimborso>) => Promise<void>
  approve: (id: string, approvatoDa: string) => Promise<void>
  reject: (id: string, approvatoDa: string, note: string) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const useRimborsiStore = create<RimborsiState>((set, get) => ({
  rimborsi: [],
  loading: false,
  error: null,

  fetch: async (aziendaId: string) => {
    set({ loading: true, error: null })
    const { data, error } = await supabase
      .from('rimborsi')
      .select('*')
      .eq('azienda_id', aziendaId)
      .order('created_at', { ascending: false })
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({ rimborsi: (data ?? []) as Rimborso[], loading: false })
  },

  create: async (rimborso) => {
    set({ loading: true, error: null })
    const { data, error } = await supabase.from('rimborsi').insert(rimborso).select().single()
    if (error) {
      set({ loading: false, error: error.message })
      return null
    }
    const created = data as Rimborso
    set({ rimborsi: [created, ...get().rimborsi], loading: false })
    return created
  },

  update: async (id: string, updates: Partial<Rimborso>) => {
    set({ loading: true, error: null })
    const { error } = await supabase.from('rimborsi').update(updates).eq('id', id)
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({
      rimborsi: get().rimborsi.map((r) => (r.id === id ? { ...r, ...updates } : r)),
      loading: false,
    })
  },

  approve: async (id: string, approvatoDa: string) => {
    const now = new Date().toISOString()
    await get().update(id, {
      stato: 'approvato',
      approvato_da: approvatoDa,
      approvato_il: now,
    })
  },

  reject: async (id: string, approvatoDa: string, note: string) => {
    const now = new Date().toISOString()
    await get().update(id, {
      stato: 'rifiutato',
      approvato_da: approvatoDa,
      approvato_il: now,
      note,
    })
  },

  remove: async (id: string) => {
    set({ loading: true, error: null })
    const { error } = await supabase.from('rimborsi').delete().eq('id', id)
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({ rimborsi: get().rimborsi.filter((r) => r.id !== id), loading: false })
  },
}))
