import { create } from 'zustand'

interface UiState {
  sidebarOpen: boolean
  globalLoading: boolean
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setGlobalLoading: (loading: boolean) => void
}

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: true,
  globalLoading: false,

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open: boolean) => set({ sidebarOpen: open }),
  setGlobalLoading: (loading: boolean) => set({ globalLoading: loading }),
}))
