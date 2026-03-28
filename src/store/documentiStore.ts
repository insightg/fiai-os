import { create } from 'zustand'
import { supabase, getAuthToken } from '../lib/supabase'
import type { Documento } from '../types'

interface DocumentiState {
  documenti: Documento[]
  searchResults: Documento[] | null
  loading: boolean
  searching: boolean
  error: string | null
  fetch: (aziendaId: string) => Promise<void>
  create: (d: Omit<Documento, 'id' | 'created_at' | 'updated_at'>) => Promise<Documento | null>
  update: (id: string, data: Partial<Documento>) => Promise<void>
  remove: (id: string) => Promise<void>
  search: (query: string, aziendaId: string) => Promise<void>
  clearSearch: () => void
}

export const useDocumentiStore = create<DocumentiState>((set, get) => ({
  documenti: [],
  searchResults: null,
  loading: false,
  searching: false,
  error: null,

  fetch: async (aziendaId: string) => {
    set({ loading: true, error: null })
    const { data, error } = await supabase
      .from('documenti')
      .select('*')
      .eq('azienda_id', aziendaId)
      .order('created_at', { ascending: false })
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({ documenti: (data ?? []) as Documento[], loading: false })
  },

  create: async (documento) => {
    set({ loading: true, error: null })
    const { data, error } = await supabase.from('documenti').insert(documento).select().single()
    if (error) {
      set({ loading: false, error: error.message })
      return null
    }
    const created = data as Documento
    set({ documenti: [created, ...get().documenti], loading: false })
    return created
  },

  update: async (id, updates) => {
    set({ loading: true, error: null })
    const { error } = await supabase.from('documenti').update(updates).eq('id', id)
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({
      documenti: get().documenti.map((d) => (d.id === id ? { ...d, ...updates } : d)),
      loading: false,
    })
  },

  remove: async (id) => {
    set({ loading: true, error: null })
    const { error } = await supabase.from('documenti').delete().eq('id', id)
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({ documenti: get().documenti.filter((d) => d.id !== id), loading: false })
  },

  search: async (query: string, aziendaId: string) => {
    set({ searching: true, error: null })
    try {
      const token = getAuthToken()
      const res = await fetch('/api/documenti/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ query, aziendaId }),
      })
      const result = await res.json()
      set({ searchResults: (result.data ?? []) as Documento[], searching: false })
    } catch (err) {
      set({ searching: false, error: (err as Error).message })
    }
  },

  clearSearch: () => set({ searchResults: null }),
}))
