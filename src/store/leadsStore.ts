import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import type { Lead } from '../types'

interface LeadsState {
  leads: Lead[]
  loading: boolean
  error: string | null
  fetch: (aziendaId: string) => Promise<void>
  create: (lead: Omit<Lead, 'id' | 'created_at' | 'updated_at'>) => Promise<Lead | null>
  update: (id: string, data: Partial<Lead>) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const useLeadsStore = create<LeadsState>((set, get) => ({
  leads: [],
  loading: false,
  error: null,

  fetch: async (aziendaId: string) => {
    set({ loading: true, error: null })
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .eq('azienda_id', aziendaId)
      .order('created_at', { ascending: false })
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({ leads: (data ?? []) as Lead[], loading: false })
  },

  create: async (lead) => {
    set({ loading: true, error: null })
    const { data, error } = await supabase.from('leads').insert(lead).select().single()
    if (error) {
      set({ loading: false, error: error.message })
      return null
    }
    const created = data as Lead
    set({ leads: [created, ...get().leads], loading: false })
    return created
  },

  update: async (id: string, updates: Partial<Lead>) => {
    set({ loading: true, error: null })
    const { error } = await supabase.from('leads').update(updates).eq('id', id)
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({
      leads: get().leads.map((l) => (l.id === id ? { ...l, ...updates } : l)),
      loading: false,
    })
  },

  remove: async (id: string) => {
    set({ loading: true, error: null })
    const { error } = await supabase.from('leads').delete().eq('id', id)
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({ leads: get().leads.filter((l) => l.id !== id), loading: false })
  },
}))
