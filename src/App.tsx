import { useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from './store'
import ChatLayout from './components/layout/ChatLayout'
import Login from './pages/auth/Login'
// Admin is now an overlay inside ChatLayout, no separate route needed

function AuthGuard({ children }: { children: React.ReactNode }) {
  const session = useAuthStore((s) => s.session)
  const loading = useAuthStore((s) => s.loading)
  const location = useLocation()

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="text-gold font-display text-2xl font-bold animate-pulse">BERNARDINI OS</div>
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <>{children}</>
}

function GuestGuard({ children }: { children: React.ReactNode }) {
  const session = useAuthStore((s) => s.session)
  const loading = useAuthStore((s) => s.loading)

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="text-gold font-display text-2xl font-bold animate-pulse">BERNARDINI OS</div>
      </div>
    )
  }

  if (session) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}

export default function App() {
  const initialize = useAuthStore((s) => s.initialize)

  useEffect(() => {
    initialize()
  }, [initialize])

  return (
    <Routes>
      <Route path="/login" element={<GuestGuard><Login /></GuestGuard>} />
      <Route path="/" element={<AuthGuard><ChatLayout /></AuthGuard>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
