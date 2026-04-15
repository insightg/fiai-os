import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from './store'
import ChatLayout from './components/layout/ChatLayout'
import Login from './pages/auth/Login'
import { loadBranding, getBranding } from './lib/branding'

function AuthGuard({ children }: { children: React.ReactNode }) {
  const session = useAuthStore((s) => s.session)
  const loading = useAuthStore((s) => s.loading)
  const location = useLocation()
  const brand = getBranding()

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="text-gold font-display text-2xl font-bold animate-pulse">{brand.short_name} OS</div>
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
  const brand = getBranding()

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="text-gold font-display text-2xl font-bold animate-pulse">{brand.short_name} OS</div>
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
  const [brandLoaded, setBrandLoaded] = useState(false)

  useEffect(() => {
    loadBranding().then(() => {
      setBrandLoaded(true)
      initialize()
    })
  }, [initialize])

  if (!brandLoaded) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="text-gray-400 font-display text-2xl font-bold animate-pulse">...</div>
      </div>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={<GuestGuard><Login /></GuestGuard>} />
      <Route path="/" element={<AuthGuard><ChatLayout /></AuthGuard>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
