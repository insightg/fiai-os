import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import type { Name } from '../types'

interface NamesState {
  names: Name[]
  loading: boolean
  error: string | null

  fetch: (aziendaId: string, tags?: string[]) => Promise<void>
  create: (name: Partial<Name> & { display_name: string; tags: string[] }) => Promise<Name | null>
  update: (id: string, data: Partial<Name>) => Promise<void>
  remove: (id: string) => Promise<void>
  addTag: (id: string, tag: string) => Promise<void>
  removeTag: (id: string, tag: string) => Promise<void>

  // Filtered views
  byTag: (tag: string) => Name[]
  clienti: () => Name[]
  leads: () => Name[]
  fornitori: () => Name[]
  candidati: () => Name[]
  utenti: () => Name[]
}

function parseNameRow(row: any): Name {
  return {
    ...row,
    tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : (row.tags || []),
    metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {}),
  }
}

export const useNamesStore = create<NamesState>((set, get) => ({
  names: [],
  loading: false,
  error: null,

  fetch: async (aziendaId: string, tags?: string[]) => {
    set({ loading: true, error: null })
    let query = supabase.from('names').select('*').eq('azienda_id', aziendaId)
    if (tags?.length) {
      // Filter by tags using LIKE (supabase QueryBuilder maps to server query.ts)
      for (const tag of tags) {
        query = query.like('tags', `%"${tag}"%`)
      }
    }
    const { data, error } = await query.order('display_name', { ascending: true })
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({ names: (data || []).map(parseNameRow), loading: false })
  },

  create: async (name) => {
    const { data, error } = await supabase.from('names').insert({
      ...name,
      tags: JSON.stringify(name.tags || ['contatto']),
      metadata: JSON.stringify(name.metadata || {}),
      slug: name.display_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 80),
      path: `/names/${name.display_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 80)}`,
    }).select('*').single()
    if (error || !data) return null
    const parsed = parseNameRow(data)
    set({ names: [parsed, ...get().names] })
    return parsed
  },

  update: async (id, data) => {
    const updateData: Record<string, unknown> = { ...data }
    if (data.tags) updateData.tags = JSON.stringify(data.tags)
    if (data.metadata) {
      // Merge with existing metadata
      const existing = get().names.find(n => n.id === id)
      if (existing) {
        updateData.metadata = JSON.stringify({ ...existing.metadata, ...data.metadata })
      } else {
        updateData.metadata = JSON.stringify(data.metadata)
      }
    }
    const { error } = await supabase.from('names').update(updateData).eq('id', id)
    if (error) return
    set({ names: get().names.map(n => n.id === id ? { ...n, ...data } : n) })
  },

  remove: async (id) => {
    const { error } = await supabase.from('names').delete().eq('id', id)
    if (error) return
    set({ names: get().names.filter(n => n.id !== id) })
  },

  addTag: async (id, tag) => {
    const name = get().names.find(n => n.id === id)
    if (!name || name.tags.includes(tag)) return
    const newTags = [...name.tags, tag]
    await get().update(id, { tags: newTags })
  },

  removeTag: async (id, tag) => {
    const name = get().names.find(n => n.id === id)
    if (!name) return
    const newTags = name.tags.filter(t => t !== tag)
    await get().update(id, { tags: newTags })
  },

  byTag: (tag) => get().names.filter(n => n.tags.includes(tag)),
  clienti: () => get().names.filter(n => n.tags.includes('cliente')),
  leads: () => get().names.filter(n => n.tags.includes('lead')),
  fornitori: () => get().names.filter(n => n.tags.includes('fornitore')),
  candidati: () => get().names.filter(n => n.tags.includes('candidato')),
  utenti: () => get().names.filter(n => n.tags.includes('utente')),
}))
