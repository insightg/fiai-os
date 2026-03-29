import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import type { NoteBoard, NoteColumn, NoteCard, Evento } from '../types'

interface PersonalState {
  board: NoteBoard | null
  events: Evento[]
  loading: boolean
  error: string | null

  // Board
  fetchBoard: (userId: string) => Promise<void>
  createColumn: (boardId: string, nome: string) => Promise<NoteColumn | null>
  updateColumn: (id: string, data: Partial<NoteColumn>) => Promise<void>
  deleteColumn: (id: string) => Promise<void>

  // Cards
  createCard: (columnId: string, card: Partial<NoteCard>) => Promise<NoteCard | null>
  updateCard: (id: string, data: Partial<NoteCard>) => Promise<void>
  moveCard: (cardId: string, targetColumnId: string, newOrdine: number) => Promise<void>
  deleteCard: (id: string) => Promise<void>

  // Events
  fetchEvents: (userId: string, month: number, year: number) => Promise<void>
  createEvent: (evento: Omit<Evento, 'id' | 'created_at' | 'updated_at'>) => Promise<Evento | null>
  updateEvent: (id: string, data: Partial<Evento>) => Promise<void>
  deleteEvent: (id: string) => Promise<void>
}

const DEFAULT_COLUMNS = [
  { nome: 'Da Fare', ordine: 0, colore: '#3B82F6' },
  { nome: 'In Corso', ordine: 1, colore: '#F59E0B' },
  { nome: 'Completato', ordine: 2, colore: '#10B981' },
]

export const usePersonalStore = create<PersonalState>((set, get) => ({
  board: null,
  events: [],
  loading: false,
  error: null,

  fetchBoard: async (userId: string) => {
    set({ loading: true, error: null })

    // Try to find existing board
    const { data: boards, error: boardErr } = await supabase
      .from('note_boards')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(1)

    if (boardErr) {
      set({ loading: false, error: boardErr.message })
      return
    }

    let board: NoteBoard

    if (!boards || (boards as NoteBoard[]).length === 0) {
      // Create default board
      const { data: newBoard, error: createErr } = await supabase
        .from('note_boards')
        .insert({ user_id: userId, nome: 'La mia board' })
        .select()
        .single()

      if (createErr || !newBoard) {
        set({ loading: false, error: createErr?.message ?? 'Errore nella creazione della board' })
        return
      }

      board = newBoard as NoteBoard

      // Create default columns
      for (const col of DEFAULT_COLUMNS) {
        await supabase.from('note_columns').insert({
          board_id: board.id,
          nome: col.nome,
          ordine: col.ordine,
          colore: col.colore,
        })
      }
    } else {
      board = (boards as NoteBoard[])[0]
    }

    // Fetch columns
    const { data: columns } = await supabase
      .from('note_columns')
      .select('*')
      .eq('board_id', board.id)
      .order('ordine', { ascending: true })

    const cols = (columns ?? []) as NoteColumn[]

    // Fetch cards for all columns
    if (cols.length > 0) {
      const colIds = cols.map((c) => c.id)
      const { data: cards } = await supabase
        .from('note_cards')
        .select('*')
        .in('column_id', colIds)
        .order('ordine', { ascending: true })

      const allCards = (cards ?? []) as NoteCard[]

      // Nest cards into columns
      for (const col of cols) {
        col.cards = allCards.filter((card) => card.column_id === col.id)
      }
    } else {
      for (const col of cols) {
        col.cards = []
      }
    }

    board.columns = cols
    set({ board, loading: false })
  },

  createColumn: async (boardId, nome) => {
    const board = get().board
    const maxOrdine = board?.columns?.reduce((max, c) => Math.max(max, c.ordine), -1) ?? -1

    const { data, error } = await supabase
      .from('note_columns')
      .insert({ board_id: boardId, nome, ordine: maxOrdine + 1 })
      .select()
      .single()

    if (error || !data) return null

    const newCol: NoteColumn = { ...(data as NoteColumn), cards: [] }
    if (board) {
      set({ board: { ...board, columns: [...(board.columns ?? []), newCol] } })
    }
    return newCol
  },

  updateColumn: async (id, updates) => {
    const { error } = await supabase.from('note_columns').update(updates).eq('id', id)
    if (error) return

    const board = get().board
    if (board?.columns) {
      set({
        board: {
          ...board,
          columns: board.columns.map((c) => (c.id === id ? { ...c, ...updates } : c)),
        },
      })
    }
  },

  deleteColumn: async (id) => {
    const { error } = await supabase.from('note_columns').delete().eq('id', id)
    if (error) return

    const board = get().board
    if (board?.columns) {
      set({
        board: {
          ...board,
          columns: board.columns.filter((c) => c.id !== id),
        },
      })
    }
  },

  createCard: async (columnId, card) => {
    const board = get().board
    const column = board?.columns?.find((c) => c.id === columnId)
    const maxOrdine = column?.cards?.reduce((max, c) => Math.max(max, c.ordine), -1) ?? -1

    const { data, error } = await supabase
      .from('note_cards')
      .insert({
        column_id: columnId,
        titolo: card.titolo ?? 'Nuova nota',
        contenuto: card.contenuto ?? null,
        colore: card.colore ?? null,
        priorita: card.priorita ?? 'media',
        scadenza: card.scadenza ?? null,
        completata: card.completata ?? false,
        ordine: maxOrdine + 1,
      })
      .select()
      .single()

    if (error || !data) return null

    const newCard = data as NoteCard
    if (board?.columns) {
      set({
        board: {
          ...board,
          columns: board.columns.map((c) =>
            c.id === columnId ? { ...c, cards: [...(c.cards ?? []), newCard] } : c
          ),
        },
      })
    }
    return newCard
  },

  updateCard: async (id, updates) => {
    const { error } = await supabase.from('note_cards').update(updates).eq('id', id)
    if (error) return

    const board = get().board
    if (board?.columns) {
      set({
        board: {
          ...board,
          columns: board.columns.map((col) => ({
            ...col,
            cards: col.cards?.map((c) => (c.id === id ? { ...c, ...updates } : c)),
          })),
        },
      })
    }
  },

  moveCard: async (cardId, targetColumnId, newOrdine) => {
    const { error } = await supabase
      .from('note_cards')
      .update({ column_id: targetColumnId, ordine: newOrdine })
      .eq('id', cardId)

    if (error) return

    const board = get().board
    if (!board?.columns) return

    // Find and remove card from current column
    let movedCard: NoteCard | null = null
    const updatedColumns = board.columns.map((col) => {
      const card = col.cards?.find((c) => c.id === cardId)
      if (card) {
        movedCard = { ...card, column_id: targetColumnId, ordine: newOrdine }
        return { ...col, cards: col.cards?.filter((c) => c.id !== cardId) }
      }
      return col
    })

    if (!movedCard) return

    // Add card to target column
    const finalColumns = updatedColumns.map((col) => {
      if (col.id === targetColumnId) {
        const cards = [...(col.cards ?? []), movedCard!].sort((a, b) => a.ordine - b.ordine)
        return { ...col, cards }
      }
      return col
    })

    set({ board: { ...board, columns: finalColumns } })
  },

  deleteCard: async (id) => {
    const { error } = await supabase.from('note_cards').delete().eq('id', id)
    if (error) return

    const board = get().board
    if (board?.columns) {
      set({
        board: {
          ...board,
          columns: board.columns.map((col) => ({
            ...col,
            cards: col.cards?.filter((c) => c.id !== id),
          })),
        },
      })
    }
  },

  fetchEvents: async (userId, month, year) => {
    set({ loading: true, error: null })

    const startDate = new Date(year, month, 1).toISOString()
    const endDate = new Date(year, month + 1, 0, 23, 59, 59).toISOString()

    const { data, error } = await supabase
      .from('eventi')
      .select('*')
      .eq('user_id', userId)
      .gte('data_inizio', startDate)
      .lte('data_inizio', endDate)
      .order('data_inizio', { ascending: true })

    if (error) {
      set({ loading: false, error: error.message })
      return
    }

    set({ events: (data ?? []) as Evento[], loading: false })
  },

  createEvent: async (evento) => {
    const { data, error } = await supabase.from('eventi').insert(evento).select().single()
    if (error || !data) return null

    const created = data as Evento
    set({ events: [...get().events, created] })
    return created
  },

  updateEvent: async (id, updates) => {
    const { error } = await supabase.from('eventi').update(updates).eq('id', id)
    if (error) return

    set({
      events: get().events.map((e) => (e.id === id ? { ...e, ...updates } : e)),
    })
  },

  deleteEvent: async (id) => {
    const { error } = await supabase.from('eventi').delete().eq('id', id)
    if (error) return

    set({ events: get().events.filter((e) => e.id !== id) })
  },
}))
