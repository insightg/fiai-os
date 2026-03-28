import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import type { FatturaPassiva } from '../types'

interface FatturePassiveState {
  fatturePassive: FatturaPassiva[]
  loading: boolean
  error: string | null
  fetch: (aziendaId: string) => Promise<void>
  create: (fp: Omit<FatturaPassiva, 'id' | 'created_at' | 'updated_at' | 'fornitore'>) => Promise<FatturaPassiva | null>
  update: (id: string, data: Partial<FatturaPassiva>) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const useFatturePassiveStore = create<FatturePassiveState>((set, get) => ({
  fatturePassive: [],
  loading: false,
  error: null,

  fetch: async (aziendaId: string) => {
    set({ loading: true, error: null })
    const { data, error } = await supabase
      .from('fatture_passive')
      .select('*, fornitore:fornitori(*)')
      .eq('azienda_id', aziendaId)
      .order('created_at', { ascending: false })
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({ fatturePassive: (data ?? []) as FatturaPassiva[], loading: false })
  },

  create: async (fp) => {
    set({ loading: true, error: null })
    const { data, error } = await supabase.from('fatture_passive').insert(fp).select('*, fornitore:fornitori(*)').single()
    if (error) {
      set({ loading: false, error: error.message })
      return null
    }
    const created = data as FatturaPassiva
    set({ fatturePassive: [created, ...get().fatturePassive], loading: false })
    return created
  },

  update: async (id: string, updates: Partial<FatturaPassiva>) => {
    set({ loading: true, error: null })
    const { error } = await supabase.from('fatture_passive').update(updates).eq('id', id)
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({
      fatturePassive: get().fatturePassive.map((f) => (f.id === id ? { ...f, ...updates } : f)),
      loading: false,
    })
  },

  remove: async (id: string) => {
    set({ loading: true, error: null })
    const { error } = await supabase.from('fatture_passive').delete().eq('id', id)
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({ fatturePassive: get().fatturePassive.filter((f) => f.id !== id), loading: false })
  },
}))
