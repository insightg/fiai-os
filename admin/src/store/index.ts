import { create } from 'zustand'
import { api, setToken, getToken } from '../lib/api'

interface AdminState {
  user: { id: string; email: string; name: string } | null
  loading: boolean
  login: (email: string, password: string) => Promise<boolean>
  logout: () => void
  checkAuth: () => void
}

export const useAdminStore = create<AdminState>((set) => ({
  user: null,
  loading: true,

  login: async (email, password) => {
    try {
      const data = await api.login(email, password)
      setToken(data.token)
      set({ user: data.user })
      return true
    } catch {
      return false
    }
  },

  logout: () => {
    setToken(null)
    set({ user: null })
  },

  checkAuth: () => {
    const token = getToken()
    if (token) {
      // Decode JWT to get user info (without verification — server will verify)
      try {
        const payload = JSON.parse(atob(token.split('.')[1]))
        set({ user: { id: payload.id, email: payload.email, name: payload.name || 'Admin' }, loading: false })
      } catch {
        setToken(null)
        set({ user: null, loading: false })
      }
    } else {
      set({ loading: false })
    }
  },
}))
