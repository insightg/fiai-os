import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import type { Entity } from '../types'

interface EntityState {
  entities: Entity[]
  loading: boolean
  error: string | null

  fetch: (aziendaId: string, type?: string) => Promise<void>
  fetchByNameId: (nameId: string) => Promise<Entity[]>
  fetchChildren: (parentId: string) => Promise<Entity[]>
  create: (entity: Partial<Entity> & { type: string; display_name: string }) => Promise<Entity | null>
  update: (id: string, data: Partial<Entity>) => Promise<void>
  remove: (id: string) => Promise<void>

  // Filtered views
  byType: (type: string) => Entity[]
  fatture: () => Entity[]
  preventivi: () => Entity[]
  ordini: () => Entity[]
  progetti: () => Entity[]
  conti: () => Entity[]
  documenti: () => Entity[]
  rimborsi: () => Entity[]
  eventi: () => Entity[]
}

function parseEntityRow(row: any): Entity {
  return {
    ...row,
    metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {}),
  }
}

export const useEntityStore = create<EntityState>((set, get) => ({
  entities: [],
  loading: false,
  error: null,

  fetch: async (aziendaId: string, type?: string) => {
    set({ loading: true, error: null })
    let query = supabase.from('entity').select('*').eq('azienda_id', aziendaId)
    if (type) query = query.eq('type', type)
    // Exclude chat data from general fetches
    if (!type) query = query.not('type', 'in', '("chat_message","chat_session")')
    const { data, error } = await query.order('created_at', { ascending: false }).limit(200)
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    set({ entities: (data || []).map(parseEntityRow), loading: false })
  },

  fetchByNameId: async (nameId: string) => {
    const { data } = await supabase.from('entity').select('*').eq('name_id', nameId).order('type').order('created_at', { ascending: false })
    return (data || []).map(parseEntityRow)
  },

  fetchChildren: async (parentId: string) => {
    const { data } = await supabase.from('entity').select('*').eq('parent_id', parentId).order('ordine')
    return (data || []).map(parseEntityRow)
  },

  create: async (entity) => {
    const slug = entity.display_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 80)
    const { data, error } = await supabase.from('entity').insert({
      ...entity,
      slug,
      path: `/entity/${entity.type}/${slug}`,
      metadata: JSON.stringify(entity.metadata || {}),
    }).select('*').single()
    if (error || !data) return null
    const parsed = parseEntityRow(data)
    set({ entities: [parsed, ...get().entities] })
    return parsed
  },

  update: async (id, data) => {
    const updateData: Record<string, unknown> = { ...data }
    if (data.metadata) {
      const existing = get().entities.find(e => e.id === id)
      if (existing) {
        updateData.metadata = JSON.stringify({ ...existing.metadata, ...data.metadata })
      } else {
        updateData.metadata = JSON.stringify(data.metadata)
      }
    }
    const { error } = await supabase.from('entity').update(updateData).eq('id', id)
    if (error) return
    set({ entities: get().entities.map(e => e.id === id ? { ...e, ...data } : e) })
  },

  remove: async (id) => {
    const { error } = await supabase.from('entity').delete().eq('id', id)
    if (error) return
    set({ entities: get().entities.filter(e => e.id !== id) })
  },

  byType: (type) => get().entities.filter(e => e.type === type),
  fatture: () => get().entities.filter(e => e.type === 'fattura'),
  preventivi: () => get().entities.filter(e => e.type === 'preventivo'),
  ordini: () => get().entities.filter(e => e.type === 'ordine'),
  progetti: () => get().entities.filter(e => e.type === 'progetto'),
  conti: () => get().entities.filter(e => e.type === 'conto'),
  documenti: () => get().entities.filter(e => e.type === 'documento'),
  rimborsi: () => get().entities.filter(e => e.type === 'rimborso'),
  eventi: () => get().entities.filter(e => e.type === 'evento'),
}))
